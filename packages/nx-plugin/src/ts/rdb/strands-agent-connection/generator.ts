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
import { addDestructuredImport, applyGritQL } from '../../../utils/ast';

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

  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    'src',
    agentName,
  );
  const agentPath = joinPathFragments(agentSourceDir, 'agent.ts');

  // Dockerfile: install RDS CA bundle for direct Aurora SSL connections
  const dockerfilePath = joinPathFragments(agentSourceDir, 'Dockerfile');
  if (tree.exists(dockerfilePath)) {
    const dockerfileContent = tree.read(dockerfilePath, 'utf-8')!;
    const rdsCaRun = [
      'RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \\',
      '    rm -rf /var/lib/apt/lists/* && \\',
      '    curl -fsSL "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" \\',
      '    -o /usr/local/share/ca-certificates/rds-bundle.crt && \\',
      '    update-ca-certificates',
    ].join('\n');
    if (!dockerfileContent.includes('rds-bundle.crt')) {
      tree.write(
        dockerfilePath,
        dockerfileContent.replace(/^(EXPOSE \d+)/m, `${rdsCaRun}\n\n$1`),
      );
    }
  }

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
    TS_RDB_STRANDS_AGENT_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
};

export default tsRdbStrandsAgentConnectionGenerator;
