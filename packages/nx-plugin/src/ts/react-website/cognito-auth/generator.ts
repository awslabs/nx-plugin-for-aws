/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import { readFileSync } from 'fs';
import { join } from 'path';
import { addTsDependencies } from '../../../utils/add-dependencies.js';
import { addHookResultToRouterProviderContext } from '../../../utils/ast/website.js';
import {
  addDestructuredImport,
  addSingleImport,
  applyGritQL,
} from '../../../utils/ast.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { resolveIac } from '../../../utils/iac.js';
import {
  addIdentityInfra,
  IDENTITY_CONSTRUCTS_PY_DEPENDENCIES,
} from '../../../utils/identity-constructs/identity-constructs.js';
import { installDependencies } from '../../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import { getNpmScope } from '../../../utils/npm-scope.js';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
import { toProjectRelativePath } from '../../../utils/paths.js';
import { getExistingProjectPort } from '../../../utils/port.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../../utils/shared-constructs.js';
import { runtimeConfigGenerator } from '../runtime-config/generator.js';
import type { TsReactWebsiteAuthGeneratorSchema } from './schema';
import {
  addCloudscapeAuthMenu,
  addNoneAuthMenu,
  addShadcnAuthMenu,
  deriveCognitoDomainPrefix,
} from './utils.js';

const readGritPattern = (name: string): string =>
  readFileSync(
    join(import.meta.dirname, 'grit', `${name}.grit`),
    'utf-8',
  ).trim();

export const DEPENDENCIES = declareDependencies()({
  ts: [
    { name: 'oidc-client-ts' },
    { name: 'react-oidc-context' },
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
  ],
  py: ownedElsewhere(IDENTITY_CONSTRUCTS_PY_DEPENDENCIES),
});

export const COGNITO_AUTH_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export async function tsReactWebsiteAuthGenerator(
  tree: Tree,
  options: TsReactWebsiteAuthGeneratorSchema,
) {
  const projectConfig = readProjectConfigurationUnqualified(
    tree,
    options.project,
  );
  const srcRoot = projectConfig.sourceRoot;

  const cognitoDomain =
    options.cognitoDomain && options.cognitoDomain.length > 0
      ? options.cognitoDomain
      : deriveCognitoDomainPrefix(getNpmScope(tree), projectConfig.name!);

  await runtimeConfigGenerator(tree, {
    project: options.project,
    preferInstallDependencies: false,
  });

  const iac = await resolveIac(tree, options.iac);

  await sharedConstructsGenerator(
    tree,
    {
      iac,
    },
    DEPENDENCIES,
  );

  // Falls back to Vite's own defaults when the website predates per-project
  // port assignment, matching the shared construct's own defaults.
  const localDevServerPort = getExistingProjectPort(projectConfig) ?? 4200;
  const localPreviewPort = localDevServerPort + 100;

  const portsNotAllowListed = await addIdentityInfra(tree, {
    iac,
    allowSignup: options.allowSignup,
    cognitoDomain,
    localCallbackPorts: [localDevServerPort, localPreviewPort],
  });

  if (portsNotAllowListed.length > 0) {
    console.warn(
      `Could not add ${portsNotAllowListed
        .map((p) => `http://localhost:${p}`)
        .join(
          ', ',
        )} to the local callback/logout URLs in the shared user identity ${
        iac === 'cdk' ? 'construct' : 'module'
      }, since it no longer matches the generated shape. Add them by hand, otherwise signing in against ${options.project}'s local dev server will fail.`,
    );
  }

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'app'),
    srcRoot,
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  addTsDependencies(tree, DEPENDENCIES, { projectRoot: projectConfig.root });

  const mainTsxPath = joinPathFragments(srcRoot, 'main.tsx');

  await addSingleImport(
    tree,
    mainTsxPath,
    'CognitoAuth',
    './components/CognitoAuth',
  );

  await addHookResultToRouterProviderContext(tree, mainTsxPath, {
    hook: 'useAuth',
    module: 'react-oidc-context',
    contextProp: 'auth',
  });

  const projectConfiguration = readProjectConfigurationUnqualified(
    tree,
    options.project,
  );

  const ux = (
    (projectConfiguration.metadata as any)?.ux ?? 'shadcn'
  ).toLowerCase();

  await applyGritQL(tree, mainTsxPath, readGritPattern('cognito-auth-wrapper'));
  // Update App Layout
  const appLayoutTsxPath = joinPathFragments(
    srcRoot,
    'components',
    'AppLayout',
    'index.tsx',
  );
  if (tree.exists(appLayoutTsxPath)) {
    await addDestructuredImport(
      tree,
      appLayoutTsxPath,
      ['useAuth'],
      'react-oidc-context',
    );
    await applyGritQL(
      tree,
      appLayoutTsxPath,
      readGritPattern('app-layout-use-auth'),
    );
    // TODO: update utils if they exist by appending to the array
    // Add a top-level navigation menu that shows the signed-in user's profile and actions
    switch (ux) {
      case 'cloudscape':
        await addCloudscapeAuthMenu(tree, appLayoutTsxPath);
        break;
      case 'shadcn':
        await addShadcnAuthMenu(tree, appLayoutTsxPath);
        break;
      case 'none':
        await addNoneAuthMenu(tree, appLayoutTsxPath);
        break;
      default:
        throw new Error(
          `Top-level navigation menu to show the signed-in user for ux "${ux}" is not implemented.`,
        );
    }
  } else {
    console.info(
      `Skipping update to ${appLayoutTsxPath} as it does not exist.`,
    );
  }
  // End update App Layout

  addComponentGeneratorMetadata(
    tree,
    options.project,
    COGNITO_AUTH_GENERATOR_INFO,
    toProjectRelativePath(
      projectConfig,
      joinPathFragments(srcRoot, 'components', 'CognitoAuth'),
    ),
    undefined,
    { iac },
  );

  await addGeneratorMetricsIfApplicable(tree, [COGNITO_AUTH_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
}
export default tsReactWebsiteAuthGenerator;
