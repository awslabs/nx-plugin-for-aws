/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Tree,
  joinPathFragments,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsRdbStrandsAgentConnectionGeneratorSchema } from './schema';
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

export const TS_RDB_STRANDS_AGENT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsRdbStrandsAgentConnectionGenerator = async (
  tree: Tree,
  options: TsRdbStrandsAgentConnectionGeneratorSchema,
): Promise<void> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  const agentName = options.sourceComponent?.name ?? 'agent';
  const serveLocalTarget = `${agentName}-serve-local`;

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

  const components: any[] = (sourceProject.metadata as any)?.components ?? [];
  const agentComponent = components.find(
    (c) =>
      c.generator === 'ts#strands-agent' && (c.name ?? 'agent') === agentName,
  );
  const protocol: string = agentComponent?.protocol ?? 'HTTP';

  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    'src',
    agentName,
  );
  const initPath = joinPathFragments(agentSourceDir, 'init.ts');
  const indexPath = joinPathFragments(agentSourceDir, 'index.ts');
  const routerPath = joinPathFragments(agentSourceDir, 'router.ts');
  const agentPath = joinPathFragments(agentSourceDir, 'agent.ts');

  if (protocol === 'HTTP') {
    if (tree.exists(initPath)) {
      await addDestructuredImport(
        tree,
        initPath,
        [getterAlias],
        rdbPackageAlias,
      );

      await applyGritQL(
        tree,
        initPath,
        `\`interface Context { $members }\` where {
          $members <: not some \`${rdbNameCamel}: $_\`,
          $members += \`\n  ${rdbNameCamel}: Awaited<ReturnType<typeof get${rdbNamePascal}>>\`
        }`,
      );
    }

    if (tree.exists(indexPath)) {
      await addDestructuredImport(
        tree,
        indexPath,
        [getterAlias],
        rdbPackageAlias,
      );

      await applyGritQL(
        tree,
        indexPath,
        `\`const createContext = ($p): Context => $b\` => \`const createContext = async ($p): Promise<Context> => $b\``,
      );

      await applyGritQL(
        tree,
        indexPath,
        `\`const createContext = async ($p): Promise<Context> => { $body }\` => raw\`const createContext = async ($p): Promise<Context> => {
  const ${rdbNameCamel} = await get${rdbNamePascal}();
  $body
}\` where { $body <: not some \`const ${rdbNameCamel} = await get${rdbNamePascal}()\` }`,
      );

      await applyGritQL(
        tree,
        indexPath,
        `\`return { $props }\` where {
          $props <: not some \`${rdbNameCamel}\`,
          $props += \`\n    ${rdbNameCamel}\`
        }`,
      );
    }

    if (tree.exists(routerPath)) {
      const dbAlreadyInCall = await matchGritQL(
        tree,
        routerPath,
        `\`getAgent($_, { $ctx })\` where { $ctx <: contains \`${rdbNameCamel}\` }`,
      );
      if (!dbAlreadyInCall) {
        const hasCtxDestructure = await matchGritQL(
          tree,
          routerPath,
          `\`const { $_ } = opts.ctx\``,
        );
        if (hasCtxDestructure) {
          await applyGritQL(
            tree,
            routerPath,
            `\`const { $vars } = opts.ctx\` where {
              $vars <: not some \`${rdbNameCamel}\`,
              $vars += \`, ${rdbNameCamel}\`
            }`,
          );
        } else {
          await applyGritQL(
            tree,
            routerPath,
            `\`const agent = await getAgent($sessionId)\` => \`const { ${rdbNameCamel} } = opts.ctx;\n      const agent = await getAgent($sessionId)\``,
          );
        }

        const hasSecondCallArg = await matchGritQL(
          tree,
          routerPath,
          `\`getAgent($_, { $_ })\``,
        );
        if (hasSecondCallArg) {
          await applyGritQL(
            tree,
            routerPath,
            `\`getAgent($sessionId, { $ctx })\` => \`getAgent($sessionId, { $ctx, ${rdbNameCamel} })\``,
          );
        } else {
          await applyGritQL(
            tree,
            routerPath,
            `\`getAgent($sessionId)\` => \`getAgent($sessionId, { ${rdbNameCamel} })\``,
          );
        }
      }
    }

    if (tree.exists(agentPath)) {
      await addDestructuredImport(
        tree,
        agentPath,
        [getterAlias],
        rdbPackageAlias,
      );

      const dbAlreadyInParam = await matchGritQL(
        tree,
        agentPath,
        `\`getAgent = async ($_, { $params }: $_) => $_\` where { $params <: contains \`${rdbNameCamel}\` }`,
      );
      if (!dbAlreadyInParam) {
        const hasSecondParam = await matchGritQL(
          tree,
          agentPath,
          `\`getAgent = async ($_, { $_ }: { $_ }) => $_\``,
        );
        if (hasSecondParam) {
          await applyGritQL(
            tree,
            agentPath,
            `\`export const getAgent = async ($session: string, { $params }: { $types }) => $body\` => \`export const getAgent = async ($session: string, { $params, ${rdbNameCamel} }: { $types, ${rdbNameCamel}: Awaited<ReturnType<typeof get${rdbNamePascal}>> }) => $body\``,
          );
        } else {
          await applyGritQL(
            tree,
            agentPath,
            `\`export const getAgent = async ($session: string) => $body\` => \`export const getAgent = async ($session: string, { ${rdbNameCamel} }: { ${rdbNameCamel}: Awaited<ReturnType<typeof get${rdbNamePascal}>> }) => $body\``,
          );
        }
      }
    }
  } else if (protocol === 'A2A') {
    if (tree.exists(indexPath)) {
      await addDestructuredImport(
        tree,
        indexPath,
        [getterAlias],
        rdbPackageAlias,
      );

      const alreadyHasDecl = await matchGritQL(
        tree,
        indexPath,
        `\`const ${rdbNameCamel} = await get${rdbNamePascal}()\``,
      );
      if (!alreadyHasDecl) {
        await applyGritQL(
          tree,
          indexPath,
          `\`const server = new A2AExpressServer($args)\` => \`const ${rdbNameCamel} = await get${rdbNamePascal}();\n  const server = new A2AExpressServer($args)\``,
        );
      }

      const dbAlreadyInCall = await matchGritQL(
        tree,
        indexPath,
        `\`getAgent($_, { $ctx })\` where { $ctx <: contains \`${rdbNameCamel}\` }`,
      );
      if (!dbAlreadyInCall) {
        const hasSecondCallArg = await matchGritQL(
          tree,
          indexPath,
          `\`getAgent($_, { $_ })\``,
        );
        if (hasSecondCallArg) {
          await applyGritQL(
            tree,
            indexPath,
            `\`getAgent($session, { $ctx })\` => \`getAgent($session, { $ctx, ${rdbNameCamel} })\``,
          );
        } else {
          await applyGritQL(
            tree,
            indexPath,
            `\`getAgent($session)\` => \`getAgent($session, { ${rdbNameCamel} })\``,
          );
        }
      }
    }

    if (tree.exists(agentPath)) {
      await addDestructuredImport(
        tree,
        agentPath,
        [getterAlias],
        rdbPackageAlias,
      );

      const dbAlreadyInParam = await matchGritQL(
        tree,
        agentPath,
        `\`getAgent = async ($_, { $params }: $_) => $_\` where { $params <: contains \`${rdbNameCamel}\` }`,
      );
      if (!dbAlreadyInParam) {
        const hasSecondParam = await matchGritQL(
          tree,
          agentPath,
          `\`getAgent = async ($_, { $_ }: { $_ }) => $_\``,
        );
        if (hasSecondParam) {
          await applyGritQL(
            tree,
            agentPath,
            `\`export const getAgent = async ($session: string, { $params }: { $types }) => $body\` => \`export const getAgent = async ($session: string, { $params, ${rdbNameCamel} }: { $types, ${rdbNameCamel}: Awaited<ReturnType<typeof get${rdbNamePascal}>> }) => $body\``,
          );
        } else {
          await applyGritQL(
            tree,
            agentPath,
            `\`export const getAgent = async ($session: string) => $body\` => \`export const getAgent = async ($session: string, { ${rdbNameCamel} }: { ${rdbNameCamel}: Awaited<ReturnType<typeof get${rdbNamePascal}>> }) => $body\``,
          );
        }
      }
    }
  }

  await addGeneratorMetricsIfApplicable(tree, [
    TS_RDB_STRANDS_AGENT_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
};

export default tsRdbStrandsAgentConnectionGenerator;
