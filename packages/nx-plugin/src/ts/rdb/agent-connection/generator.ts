/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import camelCase from 'lodash.camelcase';
import { addDestructuredImport, applyGritQL } from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { pascalCase } from '../../../utils/names';
import { toScopeAlias } from '../../../utils/npm-scope';
import {
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { injectRdsCaBundleIntoDockerfile } from '../utils';
import type { TsRdbAgentConnectionGeneratorSchema } from './schema';

export const TS_RDB_AGENT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export const tsRdbAgentConnectionGenerator = async (
  tree: Tree,
  options: TsRdbAgentConnectionGeneratorSchema,
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
  const devTarget = `${agentName}-dev`;

  if (sourceProject.targets?.[devTarget]) {
    addDependencyToTargetIfNotPresent(sourceProject, devTarget, {
      projects: [targetProject.name],
      target: 'dev',
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  const rdbBaseName = targetProject.name.split('/').pop();
  const rdbNameCamel = camelCase(rdbBaseName);
  const rdbNamePascal = pascalCase(rdbBaseName);
  const rdbPackageAlias = toScopeAlias(targetProject.name);
  const getterAlias = `getPrisma as get${rdbNamePascal}`;

  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    'src',
    agentName,
  );
  const agentPath = joinPathFragments(agentSourceDir, 'agent.ts');

  // Dockerfile: install RDS CA bundle for direct Aurora SSL connections
  const dockerfilePath = joinPathFragments(agentSourceDir, 'Dockerfile');
  injectRdsCaBundleIntoDockerfile(tree, dockerfilePath);

  if (tree.exists(agentPath)) {
    await addDestructuredImport(
      tree,
      agentPath,
      [getterAlias],
      rdbPackageAlias,
    );

    // Block body form: export const getAgent = async () => { ... }
    await applyGritQL(
      tree,
      agentPath,
      `\`export const getAgent = async () => { $body }\` => raw\`export const getAgent = async () => {
  const ${rdbNameCamel} = await get${rdbNamePascal}();
  $body
}\` where { $body <: not some \`const ${rdbNameCamel} = await get${rdbNamePascal}()\` }`,
    );

    // Expression body form: export const getAgent = async () => expr
    await applyGritQL(
      tree,
      agentPath,
      `\`export const getAgent = async () => $expr\` => raw\`export const getAgent = async () => {
  const ${rdbNameCamel} = await get${rdbNamePascal}();
  return $expr;
}\` where { $expr <: not \`{ $_ }\` }`,
    );

    // Add $on error handler after the db declaration.
    // Done via string replacement because GritQL treats $on as a metavariable.
    const dbDecl = `const ${rdbNameCamel} = await get${rdbNamePascal}();`;
    const onCall = `${rdbNameCamel}.$on('error', console.error);`;
    const content = tree.read(agentPath, 'utf-8')!;
    if (content.includes(dbDecl) && !content.includes(`${rdbNameCamel}.$on`)) {
      tree.write(agentPath, content.replace(dbDecl, `${dbDecl}\n  ${onCall}`));
    }
  }

  await addGeneratorMetricsIfApplicable(tree, [
    TS_RDB_AGENT_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
};

export default tsRdbAgentConnectionGenerator;
