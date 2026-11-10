/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../test.js';
import {
  assertValidComponentName,
  buildDefaultComponentName,
  MAX_COMPONENT_NAME_LENGTH,
  validateComponentName,
} from './naming.js';

describe('greengrass naming', () => {
  describe('validateComponentName', () => {
    it('should accept a name using only the allowed characters', () => {
      expect(validateComponentName('com.example.MyComponent')).toEqual([]);
    });

    it('should reject illegal characters', () => {
      const issues = validateComponentName('com.example.My Component!');
      expect(issues).toHaveLength(1);
      expect(issues[0].reason).toBe('invalid-characters');
    });

    it('should reject a name over the length limit', () => {
      const tooLong = 'a'.repeat(MAX_COMPONENT_NAME_LENGTH + 1);
      const issues = validateComponentName(tooLong);
      expect(issues).toHaveLength(1);
      expect(issues[0].reason).toBe('too-long');
    });

    it('should accept a name at exactly the length limit', () => {
      const exact = 'a'.repeat(MAX_COMPONENT_NAME_LENGTH);
      expect(validateComponentName(exact)).toEqual([]);
    });

    it('should reject the reserved aws.greengrass. prefix', () => {
      const issues = validateComponentName('aws.greengrass.SomeComponent');
      expect(issues).toHaveLength(1);
      expect(issues[0].reason).toBe('reserved-prefix');
    });

    it('should report every violated constraint at once', () => {
      const tooLongReserved = `aws.greengrass.${'a'.repeat(MAX_COMPONENT_NAME_LENGTH)} !`;
      const issues = validateComponentName(tooLongReserved);
      expect(issues.map((issue) => issue.reason).sort()).toEqual(
        ['invalid-characters', 'reserved-prefix', 'too-long'].sort(),
      );
    });
  });

  describe('assertValidComponentName', () => {
    it('should not throw for a valid name', () => {
      expect(() =>
        assertValidComponentName('com.example.MyComponent'),
      ).not.toThrow();
    });

    it('should throw naming the reserved prefix violation', () => {
      expect(() =>
        assertValidComponentName('aws.greengrass.SomeComponent'),
      ).toThrow(/reserves/);
    });

    it('should throw naming the illegal character violation', () => {
      expect(() => assertValidComponentName('bad name!')).toThrow(
        /letters, digits, hyphens, underscores and dots/,
      );
    });
  });

  describe('buildDefaultComponentName', () => {
    it('should build com.<scope>.<PascalName> from the workspace npm scope', () => {
      const tree = createTreeUsingTsSolutionSetup();
      tree.write(
        'package.json',
        JSON.stringify({ name: '@my-org/my-workspace' }),
      );

      expect(buildDefaultComponentName(tree, 'my-component')).toBe(
        'com.my-org.MyComponent',
      );
    });

    it('should fall back to monorepo when the workspace has no npm scope', () => {
      const tree = createTreeUsingTsSolutionSetup();
      tree.delete('package.json');

      expect(buildDefaultComponentName(tree, 'my-component')).toBe(
        'com.monorepo.MyComponent',
      );
    });

    it('should sanitize scope characters the ComponentName pattern disallows', () => {
      const tree = createTreeUsingTsSolutionSetup();
      tree.write(
        'package.json',
        JSON.stringify({ name: '@My.Org~Team/my-workspace' }),
      );

      const componentName = buildDefaultComponentName(tree, 'my-component');
      expect(componentName).toMatch(/^[a-zA-Z0-9-_.]+$/);
      expect(componentName).toBe('com.my.org-team.MyComponent');
    });

    it('should always produce a name that passes validateComponentName', () => {
      const tree = createTreeUsingTsSolutionSetup();
      tree.write('package.json', JSON.stringify({ name: '@Weird_Scope/w' }));

      const componentName = buildDefaultComponentName(tree, 'thing');
      expect(validateComponentName(componentName)).toEqual([]);
    });
  });
});
