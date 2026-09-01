/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { joinPathFragments, type Tree } from '@nx/devkit';
import { tsDynamoDBGenerator } from '../ts/dynamodb/generator.js';
import { resolveContainers } from './containers.js';
import { declareDependencies } from './declared-dependencies.js';
import { sharedConstructsGenerator } from './shared-constructs.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DEPENDENCIES,
  SHARED_TERRAFORM_DIR,
} from './shared-constructs-constants.js';
import { createTreeUsingTsSolutionSetup } from './test.js';

vi.mock('./containers', () => ({
  resolveContainers: vi.fn(),
}));

const PLUGIN_SRC = path.resolve(import.meta.dirname, '..');

const APPCONFIG_TEMPLATE =
  'utils/files/terraform/src/core/runtime-config/appconfig/appconfig.tf.template';
const APPCONFIG_DEPLOYMENT_TEMPLATE =
  'utils/files/terraform/src/core/runtime-config/appconfig-deployment/appconfig-deployment.tf.template';

const TERRAFORM_SRC = joinPathFragments(
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
  'src',
);
const APPCONFIG_FILE = joinPathFragments(
  TERRAFORM_SRC,
  'core/runtime-config/appconfig/appconfig.tf',
);
const APPCONFIG_DEPLOYMENT_FILE = joinPathFragments(
  TERRAFORM_SRC,
  'core/runtime-config/appconfig-deployment/appconfig-deployment.tf',
);

/** Every vended `.tf.template` under the plugin's source tree. */
const terraformTemplates = (): string[] => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.tf.template')) {
        found.push(path.relative(PLUGIN_SRC, full));
      }
    }
  };
  walk(PLUGIN_SRC);
  return found;
};

/**
 * Top-level HCL blocks in a file's text. Scanned textually rather than parsed:
 * most of these templates carry EJS control flow, which no HCL parser accepts.
 */
const topLevelBlocks = (contents: string): string[] => {
  const blocks: string[] = [];
  let current: string[] | undefined;
  for (const line of contents.split('\n')) {
    if (current === undefined) {
      if (/^\w+\s.*\{\s*$/.test(line)) {
        current = [line];
      }
      continue;
    }
    current.push(line);
    if (line === '}') {
      blocks.push(current.join('\n'));
      current = undefined;
    }
  }
  return blocks;
};

/**
 * The namespace each `core/runtime-config/entry` module invocation in a file
 * writes to. `null` stands for an invocation whose namespace isn't a literal,
 * which the invariant below can't verify.
 */
const entryNamespaces = (contents: string): (string | null)[] =>
  topLevelBlocks(contents)
    .filter((block) => /source\s*=\s*"[^"]*runtime-config\/entry"/.test(block))
    .map(
      (block) => /^\s*namespace\s*=\s*"([^"]+)"\s*$/m.exec(block)?.[1] ?? null,
    );

/** The `namespaces` variable's default list in an appconfig module's text. */
const namespacesDefault = (contents: string): string[] => {
  const block = topLevelBlocks(contents).find((b) =>
    b.startsWith('variable "namespaces"'),
  );
  if (!block) {
    throw new Error('No `namespaces` variable found');
  }
  const list = /^\s*default\s*=\s*\[([^\]]*)\]\s*$/m.exec(block)?.[1];
  if (list === undefined) {
    throw new Error('No `default` found on the `namespaces` variable');
  }
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
};

const readTemplate = (rel: string): string =>
  fs.readFileSync(path.join(PLUGIN_SRC, rel), 'utf-8');

describe('terraform runtime-config namespaces', () => {
  // A namespace only becomes an AppConfig configuration profile if it is in the
  // `namespaces` default, and only a profile gets aggregated and deployed. A
  // module contributing an entry to a namespace that isn't listed writes its
  // entry file to disk and nothing else — the value never reaches AppConfig and
  // the generated client throws when it reads it back.
  it('should expose a configuration profile for every namespace a vended entry module writes to', () => {
    const contributed = new Map<string, string[]>();
    for (const rel of terraformTemplates()) {
      for (const namespace of entryNamespaces(readTemplate(rel))) {
        expect(
          namespace,
          `${rel}: writes a runtime-config entry to a non-literal namespace, so it cannot be checked against the appconfig namespaces default`,
        ).not.toBeNull();
        contributed.set(namespace!, [
          ...(contributed.get(namespace!) ?? []),
          rel,
        ]);
      }
    }

    // Guards the scan itself: the invariant is worthless if it silently stops
    // finding the entry modules it is meant to check.
    expect(contributed.size).toBeGreaterThan(1);

    const provisioned = namespacesDefault(readTemplate(APPCONFIG_TEMPLATE));
    for (const [namespace, templates] of contributed) {
      expect(
        provisioned,
        `namespace "${namespace}" is written to by ${templates.join(', ')} but has no configuration profile — add it to the \`namespaces\` default in ${APPCONFIG_TEMPLATE}`,
      ).toContain(namespace);
    }
  });

  // `appconfig-deployment` drives the aggregation, hosted configuration version
  // and deployment, and indexes `configuration_profile_ids` by namespace — a
  // namespace in one default but not the other is either never deployed or a
  // plan-time lookup failure.
  it('should keep the appconfig and appconfig-deployment namespace defaults in sync', () => {
    expect(
      namespacesDefault(readTemplate(APPCONFIG_DEPLOYMENT_TEMPLATE)),
    ).toEqual(namespacesDefault(readTemplate(APPCONFIG_TEMPLATE)));
  });

  it('should provision a profile for the namespace a generated dynamodb table publishes to', async () => {
    const tree: Tree = createTreeUsingTsSolutionSetup();
    vi.mocked(resolveContainers).mockResolvedValue('docker');

    await sharedConstructsGenerator(
      tree,
      { iac: 'terraform' },
      declareDependencies()({ ts: [...SHARED_CONSTRUCTS_DEPENDENCIES] }),
    );
    await tsDynamoDBGenerator(tree, {
      name: 'MyTable',
      directory: 'packages',
      framework: 'electrodb',
      infra: 'dynamodb',
      iac: 'terraform',
    });

    const tableModule = tree.read(
      joinPathFragments(TERRAFORM_SRC, 'app/dynamodb/my-table/my-table.tf'),
      'utf-8',
    )!;
    expect(entryNamespaces(tableModule)).toEqual(['dynamodb']);

    for (const file of [APPCONFIG_FILE, APPCONFIG_DEPLOYMENT_FILE]) {
      expect(namespacesDefault(tree.read(file, 'utf-8')!)).toContain(
        'dynamodb',
      );
    }
  });
});
