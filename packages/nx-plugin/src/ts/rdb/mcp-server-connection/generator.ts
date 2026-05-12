/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Tree,
  joinPathFragments,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsRdbMcpServerConnectionGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { formatFilesInSubtree } from '../../../utils/format';
import { pascalCase } from '../../../utils/names';
import camelCase from 'lodash.camelcase';
import { toScopeAlias } from '../../../utils/npm-scope';
import {
  addDestructuredImport,
  applyGritQL,
  matchGritQL,
} from '../../../utils/ast';

export const TS_RDB_MCP_SERVER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsRdbMcpServerConnectionGenerator = async (
  tree: Tree,
  options: TsRdbMcpServerConnectionGeneratorSchema,
): Promise<void> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  const mcpServerName = options.sourceComponent?.name ?? 'mcp-server';
  const serveLocalTarget = `${mcpServerName}-serve-local`;

  if (sourceProject.targets?.[serveLocalTarget]) {
    addDependencyToTargetIfNotPresent(sourceProject, serveLocalTarget, {
      projects: [targetProject.name],
      target: 'serve-local',
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  const rdbBaseName = targetProject.name.split('/').pop();
  const rdbNameCamel = camelCase(rdbBaseName);
  const rdbNamePascal = pascalCase(rdbBaseName);
  const rdbPackageAlias = toScopeAlias(targetProject.name);
  const getterAlias = `getPrisma as get${rdbNamePascal}`;

  const mcpSourceDir = joinPathFragments(
    sourceProject.root,
    'src',
    mcpServerName,
  );
  const serverPath = joinPathFragments(mcpSourceDir, 'server.ts');
  const httpPath = joinPathFragments(mcpSourceDir, 'http.ts');
  const stdioPath = joinPathFragments(mcpSourceDir, 'stdio.ts');

  // Update server.ts: add db to createServer signature
  if (tree.exists(serverPath)) {
    await addDestructuredImport(
      tree,
      serverPath,
      [getterAlias],
      rdbPackageAlias,
    );

    const hasExistingParams = await matchGritQL(
      tree,
      serverPath,
      `\`export const createServer = ({ $_ }: { $_ }) => $_\``,
    );
    if (hasExistingParams) {
      await applyGritQL(
        tree,
        serverPath,
        `\`export const createServer = ({ $params }: { $types }) => $body\` where {
          $params <: not some \`${rdbNameCamel}\`,
          $params += \`, ${rdbNameCamel}\`,
          $types <: not some \`${rdbNameCamel}: $_\`,
          $types += \`\n  ${rdbNameCamel}: Awaited<ReturnType<typeof get${rdbNamePascal}>>\`
        }`,
      );
    } else {
      await applyGritQL(
        tree,
        serverPath,
        `\`export const createServer = () => $body\` => \`export const createServer = ({ ${rdbNameCamel} }: { ${rdbNameCamel}: Awaited<ReturnType<typeof get${rdbNamePascal}>> }) => $body\``,
      );
    }
  }

  // Update http.ts: insert db above `const server = createServer()`, pass db to call
  if (tree.exists(httpPath)) {
    await addDestructuredImport(tree, httpPath, [getterAlias], rdbPackageAlias);

    const alreadyHasDeclHttp = await matchGritQL(
      tree,
      httpPath,
      `\`const ${rdbNameCamel} = await get${rdbNamePascal}()\``,
    );
    if (!alreadyHasDeclHttp) {
      await applyGritQL(
        tree,
        httpPath,
        `\`const server = createServer($args)\` => \`const ${rdbNameCamel} = await get${rdbNamePascal}();\n    const server = createServer($args)\``,
      );
    }

    const dbAlreadyInHttpCall = await matchGritQL(
      tree,
      httpPath,
      `\`createServer({ $ctx })\` where { $ctx <: contains \`${rdbNameCamel}\` }`,
    );
    if (!dbAlreadyInHttpCall) {
      const hasObjArg = await matchGritQL(
        tree,
        httpPath,
        `\`createServer({ $_ })\``,
      );
      if (hasObjArg) {
        await applyGritQL(
          tree,
          httpPath,
          `\`createServer({ $ctx })\` => \`createServer({ $ctx, ${rdbNameCamel} })\``,
        );
      } else {
        await applyGritQL(
          tree,
          httpPath,
          `\`createServer()\` => \`createServer({ ${rdbNameCamel} })\``,
        );
      }
    }
  }

  // Update stdio.ts: insert db before `await createServer().connect(transport)`, pass db to call
  if (tree.exists(stdioPath)) {
    await addDestructuredImport(
      tree,
      stdioPath,
      [getterAlias],
      rdbPackageAlias,
    );

    const alreadyHasDeclStdio = await matchGritQL(
      tree,
      stdioPath,
      `\`const ${rdbNameCamel} = await get${rdbNamePascal}()\``,
    );
    if (!alreadyHasDeclStdio) {
      await applyGritQL(
        tree,
        stdioPath,
        `\`await createServer($args).connect($transport)\` => \`const ${rdbNameCamel} = await get${rdbNamePascal}();\n  await createServer($args).connect($transport)\``,
      );
    }

    const dbAlreadyInStdioCall = await matchGritQL(
      tree,
      stdioPath,
      `\`createServer({ $ctx })\` where { $ctx <: contains \`${rdbNameCamel}\` }`,
    );
    if (!dbAlreadyInStdioCall) {
      const hasObjArg = await matchGritQL(
        tree,
        stdioPath,
        `\`createServer({ $_ })\``,
      );
      if (hasObjArg) {
        await applyGritQL(
          tree,
          stdioPath,
          `\`createServer({ $ctx })\` => \`createServer({ $ctx, ${rdbNameCamel} })\``,
        );
      } else {
        await applyGritQL(
          tree,
          stdioPath,
          `\`createServer()\` => \`createServer({ ${rdbNameCamel} })\``,
        );
      }
    }
  }

  await addGeneratorMetricsIfApplicable(tree, [
    TS_RDB_MCP_SERVER_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
};

export default tsRdbMcpServerConnectionGenerator;
