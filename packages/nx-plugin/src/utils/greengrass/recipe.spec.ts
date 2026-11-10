/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  type GreengrassRecipe,
  NEXT_VERSION_SENTINELS,
  nextVersionStrategy,
  parseRecipe,
  validateRecipe,
} from './recipe.js';

/** A minimal, valid recipe used as the base for each test's variation. */
const baseRecipe = {
  RecipeFormatVersion: '2020-01-25',
  ComponentName: 'com.example.MyComponent',
  ComponentVersion: '1.0.0',
  ComponentDescription: 'An example component',
  ComponentPublisher: 'example',
  ComponentConfiguration: {
    DefaultConfiguration: {
      Message: 'hello',
    },
  },
  Manifests: [
    {
      Platform: { os: 'linux', architecture: 'amd64' },
      Lifecycle: {
        Run: 'python3 -u {artifacts:decompressedPath}/MyComponent/main.py',
      },
      Artifacts: [
        {
          Uri: 's3://BUCKET_NAME/COMPONENT_NAME/COMPONENT_VERSION/MyComponent.zip',
        },
      ],
    },
  ],
};

describe('greengrass recipe', () => {
  describe('validateRecipe - validation table', () => {
    it('should accept a valid recipe with no issues', () => {
      expect(validateRecipe(baseRecipe)).toEqual([]);
    });

    it.each(NEXT_VERSION_SENTINELS)(
      'should accept %s as a ComponentVersion',
      (componentVersion) => {
        expect(
          validateRecipe({ ...baseRecipe, ComponentVersion: componentVersion }),
        ).toEqual([]);
      },
    );

    it('should reject the reserved aws.greengrass. component name prefix', () => {
      const issues = validateRecipe({
        ...baseRecipe,
        ComponentName: 'aws.greengrass.SomeComponent',
      });
      expect(issues.some((issue) => /reserves/.test(issue.message))).toBe(true);
    });

    it('should reject illegal ComponentName characters', () => {
      const issues = validateRecipe({
        ...baseRecipe,
        ComponentName: 'com.example.My Component!',
      });
      expect(
        issues.some((issue) =>
          /letters, digits, hyphens, underscores and dots/.test(issue.message),
        ),
      ).toBe(true);
    });

    it('should reject a non-semver ComponentVersion', () => {
      const issues = validateRecipe({
        ...baseRecipe,
        ComponentVersion: 'not-a-version',
      });
      expect(
        issues.some((issue) => /semantic version/.test(issue.message)),
      ).toBe(true);
    });

    it.each(['NEXT_PATCH ', 'next_patch', 'NEXT_BUILD'])(
      'should reject %s as a ComponentVersion',
      (componentVersion) => {
        const issues = validateRecipe({
          ...baseRecipe,
          ComponentVersion: componentVersion,
        });
        expect(
          issues.some((issue) =>
            issue.message.includes('NEXT_PATCH, NEXT_MINOR, NEXT_MAJOR'),
          ),
        ).toBe(true);
      },
    );

    it('should report both a bad name and a bad version together', () => {
      const issues = validateRecipe({
        ...baseRecipe,
        ComponentName: 'aws.greengrass.Bad',
        ComponentVersion: 'latest',
      });
      expect(issues.length).toBeGreaterThanOrEqual(2);
    });

    it('should preserve unknown top-level keys rather than reject them', () => {
      const withUnknownTopLevel = {
        ...baseRecipe,
        SomeFutureField: { nested: true },
      };
      expect(validateRecipe(withUnknownTopLevel)).toEqual([]);
    });

    it('should preserve unknown manifest keys rather than reject them', () => {
      const withUnknownManifestKey = {
        ...baseRecipe,
        Manifests: [
          { ...baseRecipe.Manifests[0], SomeFutureManifestField: 'x' },
        ],
      };
      expect(validateRecipe(withUnknownManifestKey)).toEqual([]);
    });

    it('should preserve unknown lifecycle keys rather than reject them', () => {
      const withUnknownLifecycleKey = {
        ...baseRecipe,
        Manifests: [
          {
            ...baseRecipe.Manifests[0],
            Lifecycle: {
              ...baseRecipe.Manifests[0].Lifecycle,
              Startup: { script: 'echo starting' },
            },
          },
        ],
      };
      expect(validateRecipe(withUnknownLifecycleKey)).toEqual([]);
    });
  });

  describe('parseRecipe', () => {
    it('should return both the typed recipe and the raw parsed object', () => {
      const source = yaml.dump(baseRecipe);
      const { recipe, raw } = parseRecipe(source);

      expect(recipe.ComponentName).toBe('com.example.MyComponent');
      expect(recipe.ComponentVersion).toBe('1.0.0');
      expect(raw).toEqual(baseRecipe);
    });

    it('should throw naming every violated constraint when invalid', () => {
      const source = yaml.dump({
        ...baseRecipe,
        ComponentName: 'aws.greengrass.Bad',
        ComponentVersion: 'latest',
      });

      expect(() => parseRecipe(source)).toThrow(/ComponentName/);
      expect(() => parseRecipe(source)).toThrow(/ComponentVersion/);
    });

    it.each(NEXT_VERSION_SENTINELS)(
      'should parse %s as a ComponentVersion',
      (componentVersion) => {
        const { recipe } = parseRecipe(
          yaml.dump({ ...baseRecipe, ComponentVersion: componentVersion }),
        );
        expect(recipe.ComponentVersion).toBe(componentVersion);
      },
    );

    it('should round-trip an authoring model with unknown fields without loss', () => {
      const authored: GreengrassRecipe = {
        ...baseRecipe,
        ComponentDependencies: {
          'aws.greengrass.TokenExchangeService': {
            VersionRequirement: '^2.0.0',
            DependencyType: 'HARD',
          },
        },
        // Fields this module does not model, which must survive untouched.
        SomeVendorSpecificField: 'kept',
        Manifests: [
          {
            ...baseRecipe.Manifests[0],
            Lifecycle: {
              ...baseRecipe.Manifests[0].Lifecycle,
              Startup: { script: 'echo starting', timeout: 30 },
            },
            Selections: ['linux'],
          },
        ],
      };

      const source = yaml.dump(authored);
      const { raw } = parseRecipe(source);

      expect(raw).toEqual(authored);
      // Re-serializing the untouched raw object reproduces the same document.
      expect(yaml.dump(raw as object)).toBe(source);
    });
  });

  describe('nextVersionStrategy', () => {
    it.each([
      ['NEXT_PATCH', 'patch'],
      ['NEXT_MINOR', 'minor'],
      ['NEXT_MAJOR', 'major'],
    ] as const)('should map %s to %s', (sentinel, strategy) => {
      expect(nextVersionStrategy(sentinel)).toBe(strategy);
    });
  });
});
