/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import yaml from 'js-yaml';
import { valid as validSemver } from 'semver';
import { z } from 'zod';
import { validateComponentName } from './naming.js';

export const NEXT_VERSION_SENTINELS = [
  'NEXT_PATCH',
  'NEXT_MINOR',
  'NEXT_MAJOR',
] as const;

export type NextVersionSentinel = (typeof NEXT_VERSION_SENTINELS)[number];

/** Whether a value requests deploy-time component version resolution. */
export const isNextVersionSentinel = (
  value: string,
): value is NextVersionSentinel =>
  NEXT_VERSION_SENTINELS.includes(value as NextVersionSentinel);

/** Maps a version sentinel to its semantic-version bump strategy. */
export const nextVersionStrategy = (
  sentinel: NextVersionSentinel,
): 'patch' | 'minor' | 'major' => {
  switch (sentinel) {
    case 'NEXT_PATCH':
      return 'patch';
    case 'NEXT_MINOR':
      return 'minor';
    case 'NEXT_MAJOR':
      return 'major';
  }
};

/** Whether a value is a semantic version or a deploy-time version sentinel. */
export const isValidComponentVersion = (value: string): boolean =>
  Boolean(validSemver(value)) || isNextVersionSentinel(value);

/**
 * Typed model of the Greengrass v2 recipe format (`RecipeFormatVersion`
 * `2020-01-25`) and a zod schema over it.
 *
 * `recipe.yaml` is user-owned (vended once with `OverwriteStrategy.KeepExisting`,
 * never rewritten wholesale), so validation covers ONLY the fields the plugin
 * itself reads or rewrites: `ComponentName`, `ComponentVersion`, and the
 * manifest/artifact/lifecycle paths a future build step touches. Every schema
 * below is a loose object: fields the plugin does not model pass through
 * `parseRecipe`/`validateRecipe` untouched rather than being stripped or
 * rejected. There is deliberately no whole-document string substitution
 * anywhere in this module; a caller that needs to rewrite a value does so on
 * the parsed object at its specific path (eg. `raw.Manifests[0].Artifacts[0].Uri`)
 * and re-serializes with `yaml.dump`.
 */

/**
 * A component lifecycle step's arguments. Step names (`Run`, `Install`,
 * `Startup`, `Shutdown`, `Bootstrap`, `Recover`, ...) and each step's shape
 * (a bare script string, an object with `script`/`requiresPrivilege`/`setEnv`/
 * `timeout`, or a per-platform selection map) are entirely user-authored and
 * not modeled field-by-field here, so an unrecognised step or key is
 * preserved rather than rejected.
 */
export type Lifecycle = Record<string, unknown>;

/** `Manifests[].Platform`. */
export interface RecipePlatform {
  readonly os?: string;
  readonly architecture?: string;
  readonly [key: string]: unknown;
}

/** `Manifests[].Artifacts[]`. */
export interface RecipeArtifact {
  readonly Uri: string;
  readonly [key: string]: unknown;
}

/** `Manifests[]`. */
export interface RecipeManifest {
  readonly Platform?: RecipePlatform;
  readonly Name?: string;
  readonly Lifecycle?: Lifecycle;
  readonly Artifacts?: readonly RecipeArtifact[];
  readonly Selections?: readonly string[];
  readonly [key: string]: unknown;
}

/** `ComponentConfiguration`. */
export interface ComponentConfiguration {
  readonly DefaultConfiguration?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export type ComponentDependencyType = 'HARD' | 'SOFT';

/** A single entry of `ComponentDependencies`. */
export interface ComponentDependencyRequirement {
  readonly VersionRequirement?: string;
  readonly DependencyType?: ComponentDependencyType;
  readonly [key: string]: unknown;
}

/** `ComponentDependencies`, keyed by the dependency's `ComponentName`. */
export type ComponentDependencies = Record<
  string,
  ComponentDependencyRequirement
>;

/** The full Greengrass v2 recipe document. */
export interface GreengrassRecipe {
  readonly RecipeFormatVersion: string;
  readonly ComponentName: string;
  readonly ComponentVersion: string;
  readonly ComponentDescription?: string;
  readonly ComponentPublisher?: string;
  readonly ComponentConfiguration?: ComponentConfiguration;
  readonly ComponentDependencies?: ComponentDependencies;
  readonly Manifests: readonly RecipeManifest[];
  readonly [key: string]: unknown;
}

const RecipePlatformSchema = z.looseObject({
  os: z.string().optional(),
  architecture: z.string().optional(),
});

const RecipeArtifactSchema = z.looseObject({
  Uri: z.string(),
});

const LifecycleSchema = z.record(z.string(), z.unknown());

const RecipeManifestSchema = z.looseObject({
  Platform: RecipePlatformSchema.optional(),
  Name: z.string().optional(),
  Lifecycle: LifecycleSchema.optional(),
  Artifacts: z.array(RecipeArtifactSchema).optional(),
  Selections: z.array(z.string()).optional(),
});

const ComponentConfigurationSchema = z.looseObject({
  DefaultConfiguration: z.record(z.string(), z.unknown()).optional(),
});

const ComponentDependencyRequirementSchema = z.looseObject({
  VersionRequirement: z.string().optional(),
  DependencyType: z.enum(['HARD', 'SOFT']).optional(),
});

const ComponentDependenciesSchema = z.record(
  z.string(),
  ComponentDependencyRequirementSchema,
);

/**
 * Schema for the fields the plugin consumes. `.looseObject` at every level
 * means an unrecognised top-level key, manifest key or lifecycle key parses
 * through unchanged rather than being stripped; `ComponentName` and
 * `ComponentVersion` are the only fields checked against a service
 * constraint, via `superRefine` so both issues surface together when a
 * recipe violates both.
 */
export const GreengrassRecipeSchema = z
  .looseObject({
    RecipeFormatVersion: z.string(),
    ComponentName: z.string(),
    ComponentVersion: z.string(),
    ComponentDescription: z.string().optional(),
    ComponentPublisher: z.string().optional(),
    ComponentConfiguration: ComponentConfigurationSchema.optional(),
    ComponentDependencies: ComponentDependenciesSchema.optional(),
    Manifests: z.array(RecipeManifestSchema),
  })
  .superRefine((recipe, ctx) => {
    for (const issue of validateComponentName(recipe.ComponentName)) {
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        path: ['ComponentName'],
      });
    }

    if (!isValidComponentVersion(recipe.ComponentVersion)) {
      ctx.addIssue({
        code: 'custom',
        message: `ComponentVersion "${recipe.ComponentVersion}" must be a valid semantic version (eg. "1.0.0") or one of NEXT_PATCH, NEXT_MINOR, NEXT_MAJOR.`,
        path: ['ComponentVersion'],
      });
    }
  });

/** One validation failure, with the recipe path it applies to. */
export interface RecipeValidationIssue {
  /** Dot-separated path into the recipe, eg. `Manifests.0.Artifacts.0.Uri`. */
  readonly path: string;
  readonly message: string;
}

const toValidationIssues = (error: z.ZodError): RecipeValidationIssue[] =>
  error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));

/**
 * Validate an already-parsed recipe object against {@link GreengrassRecipeSchema},
 * returning every violation found rather than throwing on the first. Empty
 * when the recipe is valid.
 */
export const validateRecipe = (raw: unknown): RecipeValidationIssue[] => {
  const result = GreengrassRecipeSchema.safeParse(raw);
  return result.success ? [] : toValidationIssues(result.error);
};

export interface ParsedRecipe {
  /** The validated, typed view of the recipe. */
  readonly recipe: GreengrassRecipe;
  /** The unvalidated result of parsing the YAML, exactly as loaded. */
  readonly raw: unknown;
}

/**
 * Parse a recipe YAML document and validate it, throwing when the fields the
 * plugin consumes are invalid. `raw` is the plain object `js-yaml` produced,
 * before validation; a caller that needs to rewrite the recipe (eg. to
 * substitute an artifact URI) mutates `raw` at the specific path and
 * re-serializes it with `yaml.dump`, so fields this module does not model are
 * never disturbed.
 */
export const parseRecipe = (yamlSource: string): ParsedRecipe => {
  const raw = yaml.load(yamlSource);
  const result = GreengrassRecipeSchema.safeParse(raw);

  if (!result.success) {
    const issues = toValidationIssues(result.error)
      .map((issue) => `  - ${issue.path || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid Greengrass recipe:\n${issues}`);
  }

  return { recipe: result.data as GreengrassRecipe, raw };
};
