/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';
import { coerce, minVersion, subset } from 'semver';
import { describe, expect, it } from 'vitest';
import PluginPackageJson from '../../package.json' with { type: 'json' };
import { TS_VERSIONS } from './versions';

const require = createRequire(import.meta.url);

const NODE_ENGINES = '^22.13.0 || ^24.0.0 || >=26.0.0';

// Tools the plugin adds to generated projects that declare engines.node.
const VENDED_TOOLS_WITH_ENGINES = ['vitest', 'jsdom'] as const;

describe('@aws/nx-plugin engines.node', () => {
  it('should declare the supported Node.js range', () => {
    expect(PluginPackageJson.engines.node).toBe(NODE_ENGINES);
  });

  it.each(VENDED_TOOLS_WITH_ENGINES)(
    'should only accept Node.js versions the vended %s supports',
    (tool) => {
      // Every Node.js version the plugin accepts must run the tools it adds to
      // generated projects. A bump that narrows a tool's range fails here.
      const toolPackageJson = require(`${tool}/package.json`);
      expect(toolPackageJson.version).toBe(TS_VERSIONS[tool]);
      const toolEngines: string = toolPackageJson.engines.node;
      const pluginEngines = PluginPackageJson.engines.node;
      expect(
        subset(pluginEngines, toolEngines),
        `plugin engines.node "${pluginEngines}" is not within ${tool} engines.node "${toolEngines}"`,
      ).toBe(true);
    },
  );

  it('should document the minimum Node.js version in the prerequisites', () => {
    const snippet = readFileSync(
      join(
        __dirname,
        '../../../../docs/src/content/docs/en/snippets/required-prerequisites.mdx',
      ),
      'utf-8',
    );
    // Accepts "Node >= 22.13", "Node.js ≥ v22.13.0" and similar wording.
    const match = snippet.match(
      /Node(?:\.js)?\s*(?:>=|≥|&gt;=)\s*v?(\d+(?:\.\d+){0,2})/i,
    );
    expect(
      match,
      'required-prerequisites.mdx must state the minimum Node.js version as "Node >= <version>"',
    ).not.toBeNull();
    expect(coerce(match?.[1])?.version).toBe(
      minVersion(PluginPackageJson.engines.node)?.version,
    );
  });
});
