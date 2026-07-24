/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 7: Runtime Configuration registration is a preserving map update
 * Validates: Requirements 5.9, 6.9, 10.6, 13.7
 *
 * For all existing Runtime Configuration objects and generated Harness
 * keys, registering a Harness ARN preserves every entry with a different
 * key, assigns the requested ARN to exactly the generated key under
 * `agentcore.harnesses`, and produces the same semantic map through CDK
 * and Terraform registration paths.
 *
 * Neither provider executes its registration at generation time: the CDK
 * construct updates the RuntimeConfig singleton at synth time with a
 * read-merge-write expression (`rc.set('agentcore', 'harnesses', {
 * ...rc.get('agentcore').harnesses, <ClassName>: arn })`), and the
 * Terraform entry module writes an isolated leaf JSON file
 * (`entries/agentcore/harnesses-<sha256(content)>.json`) that the reader
 * deep-merges with every other leaf at apply time. The property therefore
 * tests FAITHFUL TYPESCRIPT MIRRORS of both registration semantics across
 * arbitrary existing Runtime Configuration states (other harness entries,
 * sibling gateway maps, unrelated namespace keys), compares the two
 * mirrors for semantic equality (13.7), and separately TIES each mirror to
 * the rendered artifacts with content-level assertions: the construct's
 * exact read-merge-write expression plus the rendered RuntimeConfig
 * get/set bodies the CDK mirror re-implements, and the module's
 * entry-module block plus the rendered leaf-write and deep-merge
 * implementations the Terraform mirror re-implements. The tie is what
 * makes the mirror results evidence about the generated templates rather
 * than about the test itself.
 */
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';
import { resolveAgentcoreHarnessOptions } from './resolve-options';

// ---------------------------------------------------------------------------
// Model: the registration contract from the requirements, restated
// independently of both implementations.
//
// - 5.9 / 6.9: the Harness ARN is merged into the Runtime Configuration Key
//   `agentcore.harnesses.<ClassName>` without removing existing
//   `agentcore.harnesses` entries.
// - 10.6: other Harness entries in Runtime Configuration are preserved
//   while the generated Harness is registered.
// - 13.7: both providers represent the same Runtime Configuration Key, so
//   for the same existing state and new entry the two registration paths
//   must produce the same semantic namespace map.
// ---------------------------------------------------------------------------

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const isJsonObject = (
  value: JsonValue | undefined,
): value is { [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The merged `agentcore.harnesses` map every registration must produce. */
const expectedHarnessesAfter = (
  existingHarnesses: ReadonlyArray<readonly [string, string]>,
  newClassName: string,
  newArn: string,
): Record<string, string> => ({
  ...Object.fromEntries(existingHarnesses),
  [newClassName]: newArn,
});

// ---------------------------------------------------------------------------
// CDK mirror: the RuntimeConfig store plus the construct's registration
// expression (tied to the rendered artifacts by the template-tie property
// below).
// ---------------------------------------------------------------------------

/**
 * The RuntimeConfig singleton's namespace store. The rendered core
 * construct (`packages/common/constructs/src/core/runtime-config.ts`)
 * declares `private readonly _namespaces = new Map<string, Record<string,
 * any>>()`, and `any` is retained here so the mirror stays literal.
 */
// biome-ignore lint/suspicious/noExplicitAny: faithful to the rendered template
type RuntimeConfigNamespaces = Map<string, Record<string, any>>;

/**
 * Faithful mirror of the rendered `RuntimeConfig.set`:
 *
 *   set(namespace: string, key: string, value: any): void {
 *     let data = this._namespaces.get(namespace);
 *     if (!data) {
 *       data = {};
 *       this._namespaces.set(namespace, data);
 *     }
 *     data[key] = value;
 *   }
 */
const rcSet = (
  namespaces: RuntimeConfigNamespaces,
  namespace: string,
  key: string,
  // biome-ignore lint/suspicious/noExplicitAny: faithful to the rendered template
  value: any,
): void => {
  let data = namespaces.get(namespace);
  if (!data) {
    data = {};
    namespaces.set(namespace, data);
  }
  data[key] = value;
};

/**
 * Faithful mirror of the rendered `RuntimeConfig.get`:
 *
 *   get(namespace: string): Record<string, any> {
 *     let data = this._namespaces.get(namespace);
 *     if (!data) {
 *       data = {};
 *       this._namespaces.set(namespace, data);
 *     }
 *     return data;
 *   }
 */
const rcGet = (
  namespaces: RuntimeConfigNamespaces,
  namespace: string,
  // biome-ignore lint/suspicious/noExplicitAny: faithful to the rendered template
): Record<string, any> => {
  let data = namespaces.get(namespace);
  if (!data) {
    data = {};
    namespaces.set(namespace, data);
  }
  return data;
};

/**
 * Faithful mirror of the generated construct's registration statement:
 *
 *   const rc = RuntimeConfig.ensure(this);
 *   rc.set('agentcore', 'harnesses', {
 *     ...rc.get('agentcore').harnesses,
 *     <ClassName>: this.harness.attrArn,
 *   });
 *
 * `{ ...undefined }` is `{}`, so the first registration in a fresh store
 * is safe without any special casing - exactly as in the template.
 */
const registerHarnessCdk = (
  namespaces: RuntimeConfigNamespaces,
  className: string,
  arn: string,
): void => {
  rcSet(namespaces, 'agentcore', 'harnesses', {
    ...rcGet(namespaces, 'agentcore').harnesses,
    [className]: arn,
  });
};

// ---------------------------------------------------------------------------
// Terraform mirror: entry-module leaf writes plus the reader's deep merge
// (tied to the rendered artifacts by the template-tie property below).
// ---------------------------------------------------------------------------

/**
 * Canonical JSON with recursively sorted object keys. Terraform's
 * `jsonencode` sorts map keys, so the leaf-file hash is a pure function of
 * the (key, value) CONTENT and never of insertion order.
 */
const canonicalJson = (value: JsonValue): string => {
  const sortKeysDeep = (input: JsonValue): JsonValue => {
    if (Array.isArray(input)) {
      return input.map(sortKeysDeep);
    }
    if (isJsonObject(input)) {
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, sortKeysDeep(input[key])]),
      );
    }
    return input;
  };
  return JSON.stringify(sortKeysDeep(value));
};

/**
 * Faithful mirror of the rendered entry module
 * (`core/runtime-config/entry`): one isolated leaf file per entry, named
 * by a content hash so identical contributions collapse to one leaf:
 *
 *   entry_id        = sha256(jsonencode({ key = var.key, value = var.value }))
 *   entry_file_path = ".../entries/<namespace>/<key>-<entry_id>.json"
 *   content         = jsonencode(var.value)
 *
 * The entries directory of one namespace is modeled as filename ->
 * parsed-content; `Map.set` on an existing filename models the filesystem
 * overwrite of an identical file.
 */
const tfWriteEntry = (
  entries: Map<string, JsonValue>,
  key: string,
  value: JsonValue,
): void => {
  const entryId = createHash('sha256')
    .update(canonicalJson({ key, value }))
    .digest('hex');
  entries.set(
    `${key}-${entryId}.json`,
    JSON.parse(JSON.stringify(value)) as JsonValue,
  );
};

/**
 * Faithful mirror of the rendered reader aggregation
 * (`core/runtime-config/read`, duplicated in `appconfig`): every leaf of
 * the namespace directory is parsed in sorted filename order, its section
 * is the stem minus the trailing `-<hash>` (Python
 * `stem.rsplit('-', 1)[0]`), and object contributions to one section are
 * deep-merged:
 *
 *   def deep_merge(target: dict, source: dict) -> dict:
 *       for k, v in source.items():
 *           if k in target and isinstance(target[k], dict) and isinstance(v, dict):
 *               deep_merge(target[k], v)
 *           else:
 *               target[k] = v
 *       return target
 */
const tfReadNamespace = (
  entries: ReadonlyMap<string, JsonValue>,
  filenameOrder?: readonly string[],
): Record<string, JsonValue> => {
  const deepMerge = (
    target: { [key: string]: JsonValue },
    source: { [key: string]: JsonValue },
  ): void => {
    for (const [key, value] of Object.entries(source)) {
      const existing = target[key];
      if (key in target && isJsonObject(existing) && isJsonObject(value)) {
        deepMerge(existing, value);
      } else {
        target[key] = value;
      }
    }
  };

  const merged: Record<string, JsonValue> = {};
  const filenames = filenameOrder ?? [...entries.keys()].sort();
  for (const filename of filenames) {
    const stem = filename.slice(0, -'.json'.length);
    const section = stem.slice(0, stem.lastIndexOf('-'));
    // Each read re-parses the leaf file, so contributions are fresh values.
    const contribution = structuredClone(entries.get(filename)!);
    const existing = merged[section];
    if (isJsonObject(existing) && isJsonObject(contribution)) {
      deepMerge(existing, contribution);
    } else {
      merged[section] = contribution;
    }
  }
  return merged;
};

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ALNUM_CHARS = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
];

/**
 * Superset of the `toClassName` output shape (`_?[A-Za-z0-9]+`): every
 * PascalCase Runtime Configuration segment the generator can produce is in
 * this space, including the `_`-prefixed digit-leading forms.
 */
const arbClassName = fc
  .tuple(
    fc.constantFrom('', '_'),
    fc.string({
      unit: fc.constantFrom(...ALNUM_CHARS),
      minLength: 1,
      maxLength: 20,
    }),
  )
  .map(([prefix, body]) => prefix + body);

/**
 * Registered values are opaque strings: deploy-time Harness ARNs across
 * partitions, CDK synth-time tokens (what `this.harness.attrArn` actually
 * is when `rc.set` runs), and arbitrary text.
 */
const arbArnValue = fc.oneof(
  fc
    .tuple(
      fc.constantFrom('aws', 'aws-cn', 'aws-us-gov'),
      fc.constantFrom('us-east-1', 'eu-central-1', 'ap-southeast-2'),
      fc.string({
        unit: fc.constantFrom(...'0123456789'.split('')),
        minLength: 12,
        maxLength: 12,
      }),
      fc.string({
        unit: fc.constantFrom(...ALNUM_CHARS),
        minLength: 1,
        maxLength: 12,
      }),
    )
    .map(
      ([partition, region, account, id]) =>
        `arn:${partition}:bedrock-agentcore:${region}:${account}:harness/${id}`,
    ),
  fc.constant('${Token[TOKEN.660]}'),
  fc.string({ minLength: 1, maxLength: 24 }),
);

/** Existing `agentcore.harnesses` entries: distinct class-name keys. */
const arbExistingHarnesses = fc.uniqueArray(
  fc.tuple(arbClassName, arbArnValue),
  { maxLength: 6, selector: ([className]) => className },
);

/**
 * Sibling namespace keys other generators own (`agentcore.gateways` etc.).
 * Hyphens are included to exercise the reader's `rsplit('-', 1)` section
 * extraction; `harnesses` itself is excluded because that key is exactly
 * what the registration under test owns.
 */
const arbSiblingKey = fc
  .oneof(
    fc.constantFrom('gateways', 'runtimes', 'memories', 'browser-tools'),
    fc.string({
      unit: fc.constantFrom(...ALNUM_CHARS, '-', '_'),
      minLength: 1,
      maxLength: 16,
    }),
  )
  .filter((key) => key !== 'harnesses' && key !== '__proto__');

/** Sibling values: opaque strings or flat maps (eg a gateway name->URL map). */
const arbSiblingValue: fc.Arbitrary<JsonValue> = fc.oneof(
  arbArnValue,
  fc
    .uniqueArray(fc.tuple(arbClassName, arbArnValue), {
      maxLength: 4,
      selector: ([key]) => key,
    })
    .map((entries) => Object.fromEntries(entries) as JsonValue),
);

/** Existing sibling entries of the `agentcore` namespace: distinct keys. */
const arbSiblings = fc.uniqueArray(fc.tuple(arbSiblingKey, arbSiblingValue), {
  maxLength: 4,
  selector: ([key]) => key,
});

interface RegistrationCandidate {
  /** Existing harness registrations (distinct class names). */
  existingHarnesses: Array<[string, string]>;
  /** Existing sibling entries of the `agentcore` namespace. */
  siblings: Array<[string, JsonValue]>;
  /** The registration under test. */
  newClassName: string;
  newArn: string;
}

/**
 * Candidate states for a new registration. In the real system each
 * ClassName owns exactly one construct/module and therefore one
 * registration, so the shared (cross-provider) input space is:
 *
 * - `fresh`: a class name not yet registered, with any ARN, and
 * - `regenerate`: an existing (ClassName, arn) pair registered again (a
 *   rerun renders the identical registration artifact).
 *
 * `withCdkOverwrite` additionally generates same-ClassName/different-ARN
 * updates, which the CDK read-merge-write handles deterministically
 * (last write wins) - CDK-mirror-only territory, since Terraform cannot
 * produce two differing leaves for one generated Harness.
 */
const arbRegistrationCandidate = (
  withCdkOverwrite: boolean,
): fc.Arbitrary<RegistrationCandidate> =>
  fc
    .tuple(arbExistingHarnesses, arbSiblings)
    .chain(([existingHarnesses, siblings]) => {
      const arms: fc.Arbitrary<[string, string]>[] = [
        // fresh: not colliding with any existing class name.
        fc.tuple(
          arbClassName.filter(
            (className) =>
              !existingHarnesses.some(([existing]) => existing === className),
          ),
          arbArnValue,
        ),
      ];
      if (existingHarnesses.length > 0) {
        // regenerate: one of the existing pairs, unchanged.
        arms.push(
          fc
            .nat({ max: existingHarnesses.length - 1 })
            .map((index) => [...existingHarnesses[index]] as [string, string]),
        );
        if (withCdkOverwrite) {
          // overwrite: an existing class name with a different ARN.
          arms.push(
            fc
              .tuple(fc.nat({ max: existingHarnesses.length - 1 }), arbArnValue)
              .map(
                ([index, arn]) =>
                  [existingHarnesses[index][0], arn] as [string, string],
              ),
          );
        }
      }
      return fc.oneof(...arms).map(([newClassName, newArn]) => ({
        existingHarnesses,
        siblings,
        newClassName,
        newArn,
      }));
    });

/** Seed the CDK store the way a real app does: one rc.set per entry. */
const seededCdkStore = (
  candidate: RegistrationCandidate,
): RuntimeConfigNamespaces => {
  const namespaces: RuntimeConfigNamespaces = new Map();
  for (const [key, value] of candidate.siblings) {
    rcSet(namespaces, 'agentcore', key, value);
  }
  for (const [className, arn] of candidate.existingHarnesses) {
    registerHarnessCdk(namespaces, className, arn);
  }
  return namespaces;
};

/** Seed the TF entries dir the way real modules do: one leaf per entry. */
const seededTfEntries = (
  candidate: RegistrationCandidate,
): Map<string, JsonValue> => {
  const entries = new Map<string, JsonValue>();
  for (const [className, arn] of candidate.existingHarnesses) {
    tfWriteEntry(entries, 'harnesses', { [className]: arn });
  }
  for (const [key, value] of candidate.siblings) {
    tfWriteEntry(entries, key, value);
  }
  return entries;
};

const expectedNamespaceKeys = (candidate: RegistrationCandidate): string[] =>
  [...candidate.siblings.map(([key]) => key), 'harnesses'].sort();

// ---------------------------------------------------------------------------
// Mirror properties
// ---------------------------------------------------------------------------

describe('agentcore-harness Runtime Configuration registration (Property 7)', () => {
  // Feature: agentcore-harness-generator, Property 7: Runtime Configuration registration is a preserving map update
  // **Validates: Requirements 5.9, 6.9, 10.6, 13.7**
  it('cdk: the read-merge-write update assigns exactly the generated key and preserves every other entry', () => {
    fc.assert(
      fc.property(arbRegistrationCandidate(true), (candidate) => {
        const { existingHarnesses, siblings, newClassName, newArn } = candidate;
        const namespaces = seededCdkStore(candidate);

        registerHarnessCdk(namespaces, newClassName, newArn);
        const after = rcGet(namespaces, 'agentcore');

        // (a) exactly the generated key holds the requested ARN
        // (add or overwrite), and (b) every other harness entry survives:
        // the resulting map is precisely existing-with-new-assigned.
        expect(after.harnesses[newClassName]).toBe(newArn);
        expect(after.harnesses).toEqual(
          expectedHarnessesAfter(existingHarnesses, newClassName, newArn),
        );

        // (c) sibling namespace entries are untouched - same object
        // identity, not merely equal content - and no key appears or
        // disappears at the namespace level.
        for (const [key, value] of siblings) {
          expect(after[key]).toBe(value);
        }
        expect(Object.keys(after).sort()).toEqual(
          expectedNamespaceKeys(candidate),
        );

        // (d) re-registering the same (ClassName, arn) is idempotent.
        const snapshot = structuredClone(after);
        registerHarnessCdk(namespaces, newClassName, newArn);
        expect(rcGet(namespaces, 'agentcore')).toEqual(snapshot);
      }),
      // At least 100 runs required; 300 across fresh/regenerate/overwrite.
      { numRuns: 300 },
    );
  });

  // Feature: agentcore-harness-generator, Property 7: Runtime Configuration registration is a preserving map update
  // **Validates: Requirements 5.9, 6.9, 10.6, 13.7**
  it('terraform: leaf-file deep merge preserves all entries, is order-insensitive, and dedupes identical leaves', () => {
    fc.assert(
      fc.property(arbRegistrationCandidate(false), (candidate) => {
        const { existingHarnesses, siblings, newClassName, newArn } = candidate;
        const entries = seededTfEntries(candidate);
        const leafCountBefore = entries.size;
        const isRegenerate = existingHarnesses.some(
          ([className, arn]) => className === newClassName && arn === newArn,
        );

        tfWriteEntry(entries, 'harnesses', { [newClassName]: newArn });

        // Content-hash filenames dedupe a regenerated identical leaf:
        // same content = same filename = one leaf on disk.
        expect(entries.size).toBe(leafCountBefore + (isRegenerate ? 0 : 1));

        // Merging every leaf yields all existing harness entries plus the
        // new one, with every sibling section preserved and no extra
        // section introduced.
        const merged = tfReadNamespace(entries);
        expect(merged.harnesses).toEqual(
          expectedHarnessesAfter(existingHarnesses, newClassName, newArn),
        );
        for (const [key, value] of siblings) {
          expect(merged[key]).toEqual(value);
        }
        expect(Object.keys(merged).sort()).toEqual(
          expectedNamespaceKeys(candidate),
        );

        // Order-insensitivity: the per-harness/per-sibling leaves carry
        // disjoint keys, so merging in reverse filename order produces the
        // same namespace map as the reader's sorted order.
        const reversedOrder = [...entries.keys()].sort().reverse();
        expect(tfReadNamespace(entries, reversedOrder)).toEqual(merged);

        // Idempotence: re-applying the same registration adds no leaf and
        // does not change the merged namespace.
        tfWriteEntry(entries, 'harnesses', { [newClassName]: newArn });
        expect(entries.size).toBe(leafCountBefore + (isRegenerate ? 0 : 1));
        expect(tfReadNamespace(entries)).toEqual(merged);
      }),
      // At least 100 runs required; 300 across fresh/regenerate states.
      { numRuns: 300 },
    );
  });

  // Feature: agentcore-harness-generator, Property 7: Runtime Configuration registration is a preserving map update
  // **Validates: Requirements 5.9, 6.9, 10.6, 13.7**
  it('cdk and terraform registration paths produce the same semantic namespace map', () => {
    fc.assert(
      fc.property(arbRegistrationCandidate(false), (candidate) => {
        const { existingHarnesses, newClassName, newArn } = candidate;

        const namespaces = seededCdkStore(candidate);
        registerHarnessCdk(namespaces, newClassName, newArn);
        const cdkNamespace = structuredClone(rcGet(namespaces, 'agentcore'));

        const entries = seededTfEntries(candidate);
        tfWriteEntry(entries, 'harnesses', { [newClassName]: newArn });
        const tfNamespace = tfReadNamespace(entries);

        // 13.7: same existing state + same new entry => the two provider
        // paths represent the same Runtime Configuration map: existing
        // entries ∪ { <ClassName>: arn } under agentcore.harnesses with
        // all sibling entries intact.
        expect(cdkNamespace).toEqual(tfNamespace);
        expect(cdkNamespace.harnesses).toEqual(
          expectedHarnessesAfter(existingHarnesses, newClassName, newArn),
        );
        expect(Object.keys(cdkNamespace).sort()).toEqual(
          expectedNamespaceKeys(candidate),
        );
      }),
      // At least 100 runs required.
      { numRuns: 300 },
    );
  });

  // -------------------------------------------------------------------------
  // Template tie: full generator runs proving the rendered artifacts carry
  // exactly the mirrored registration semantics, per harness, additively.
  // -------------------------------------------------------------------------

  const cdkConstructPath = (kebab: string): string =>
    `packages/common/constructs/src/app/harnesses/${kebab}/${kebab}.ts`;
  const tfModulePath = (kebab: string): string =>
    `packages/common/terraform/src/app/harnesses/${kebab}/${kebab}.tf`;
  const CDK_RUNTIME_CONFIG_PATH =
    'packages/common/constructs/src/core/runtime-config.ts';
  const TF_ENTRY_MODULE_PATH =
    'packages/common/terraform/src/core/runtime-config/entry/entry.tf';
  const TF_READ_MODULE_PATH =
    'packages/common/terraform/src/core/runtime-config/read/read.tf';

  const countOccurrences = (content: string, needle: string): number =>
    content.split(needle).length - 1;

  /** The construct's read-merge-write expression for one class name. */
  const rcSetPattern = (className: string): RegExp =>
    new RegExp(
      `rc\\.set\\('agentcore', 'harnesses', \\{\\s*` +
        `\\.\\.\\.rc\\.get\\('agentcore'\\)\\.harnesses,\\s*` +
        `${className}:\\s*this\\.harness\\.attrArn,?\\s*\\}\\)`,
    );

  /**
   * Name pairs drawn from disjoint seed families so the two harnesses of
   * one workspace always normalize to different project identities.
   */
  const arbHarnessNamePair = fc
    .tuple(
      fc.constantFrom('harness', 'My Harness', 'p7', 'runtime config'),
      fc.constantFrom('other', 'second-harness', '3d', 'Gateway Sibling'),
      fc.string({
        unit: fc.constantFrom('a', 'z', '0', '9', '-'),
        maxLength: 6,
      }),
      fc.string({
        unit: fc.constantFrom('b', 'y', '1', '8', '-'),
        maxLength: 6,
      }),
    )
    .map(
      ([seedA, seedB, decorationA, decorationB]) =>
        [seedA + decorationA, seedB + decorationB] as const,
    );

  // Feature: agentcore-harness-generator, Property 7: Runtime Configuration registration is a preserving map update
  // **Validates: Requirements 5.9, 6.9, 10.6, 13.7**
  it('renders exactly the mirrored registration semantics into both providers, additively per harness', async () => {
    // Full generator runs are comparatively slow (template rendering and
    // formatting), so this template-tie reinforcement uses a bounded run
    // count; the >=100-run requirement is satisfied by the mirror
    // properties above. Without this tie the mirrors would prove nothing
    // about the generated templates.
    await fc.assert(
      fc.asyncProperty(arbHarnessNamePair, async ([nameA, nameB]) => {
        // CDK: TWO sequential generator runs in ONE workspace - the
        // registration is per-harness additive at the artifact level.
        const cdkTree = createTreeUsingTsSolutionSetup();
        const resolvedA = resolveAgentcoreHarnessOptions(cdkTree, {
          name: nameA,
        });
        const resolvedB = resolveAgentcoreHarnessOptions(cdkTree, {
          name: nameB,
        });
        fc.pre(resolvedA.nameKebabCase !== resolvedB.nameKebabCase);
        await agentcoreHarnessGenerator(cdkTree, { name: nameA, iac: 'cdk' });
        await agentcoreHarnessGenerator(cdkTree, { name: nameB, iac: 'cdk' });

        // After BOTH runs, each construct still carries exactly its own
        // read-merge-write registration - the second harness added its
        // registration without replacing the first one.
        for (const resolved of [resolvedA, resolvedB]) {
          const construct = cdkTree.read(
            cdkConstructPath(resolved.nameKebabCase),
            'utf-8',
          );
          expect(construct).not.toBeNull();
          expect(construct).toContain('RuntimeConfig.ensure(this)');
          expect(construct).toMatch(rcSetPattern(resolved.nameClassName));
          expect(countOccurrences(construct!, 'rc.set(')).toBe(1);
        }

        // The REAL RuntimeConfig get/set logic the CDK mirror
        // re-implements: get-or-create namespace record, then
        // data[key] = value.
        const core = cdkTree.read(CDK_RUNTIME_CONFIG_PATH, 'utf-8');
        expect(core).not.toBeNull();
        expect(core).toMatch(
          /set\(namespace: string, key: string, value: any\): void \{\s*let data = this\._namespaces\.get\(namespace\);\s*if \(!data\) \{\s*data = \{\};\s*this\._namespaces\.set\(namespace, data\);\s*\}\s*data\[key\] = value;\s*\}/,
        );
        expect(core).toMatch(
          /get\(namespace: string\): Record<string, any> \{\s*let data = this\._namespaces\.get\(namespace\);\s*if \(!data\) \{\s*data = \{\};\s*this\._namespaces\.set\(namespace, data\);\s*\}\s*return data;\s*\}/,
        );

        // Terraform: the same two harnesses in ONE workspace.
        const tfTree = createTreeUsingTsSolutionSetup();
        await agentcoreHarnessGenerator(tfTree, {
          name: nameA,
          iac: 'terraform',
        });
        await agentcoreHarnessGenerator(tfTree, {
          name: nameB,
          iac: 'terraform',
        });

        // Each module carries exactly its own entry-module registration
        // under namespace `agentcore`, key `harnesses`, with a one-entry
        // { <ClassName> = arn } map.
        for (const resolved of [resolvedA, resolvedB]) {
          const module = tfTree.read(
            tfModulePath(resolved.nameKebabCase),
            'utf-8',
          );
          expect(module).not.toBeNull();
          expect(module).toContain(
            'module "add_harness_arn_to_runtime_config"',
          );
          expect(module).toContain(
            'source = "../../../core/runtime-config/entry"',
          );
          expect(module).toMatch(/namespace\s*=\s*"agentcore"/);
          expect(module).toMatch(/key\s*=\s*"harnesses"/);
          expect(module).toContain(
            `value     = { "${resolved.nameClassName}" = aws_bedrockagentcore_harness.this.arn }`,
          );
          expect(countOccurrences(module!, '\nmodule "')).toBe(1);
        }

        // The REAL entry-module leaf-write semantics the TF mirror
        // re-implements: content-hashed isolated leaf files.
        const entry = tfTree.read(TF_ENTRY_MODULE_PATH, 'utf-8');
        expect(entry).not.toBeNull();
        expect(entry).toContain(
          'entry_id        = sha256(jsonencode({ key = var.key, value = var.value }))',
        );
        expect(entry).toContain(
          'entry_file_path = "${local.entries_dir}/${var.namespace}/${var.key}-${local.entry_id}.json"',
        );
        expect(entry).toContain('content         = jsonencode(var.value)');

        // The REAL reader aggregation the TF mirror re-implements:
        // section = stem minus content hash, object contributions
        // deep-merged.
        const read = tfTree.read(TF_READ_MODULE_PATH, 'utf-8');
        expect(read).not.toBeNull();
        expect(read).toContain(
          'def deep_merge(target: dict, source: dict) -> dict:',
        );
        expect(read).toContain("section = entry_path.stem.rsplit('-', 1)[0]");
        expect(read).toContain('deep_merge(existing, contribution)');
      }),
      // 8 cases x 4 full generator runs stays within the suite budget.
      { numRuns: 8 },
    );
  }, 120_000);
});
