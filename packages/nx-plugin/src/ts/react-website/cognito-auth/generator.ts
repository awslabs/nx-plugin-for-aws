/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  generateFiles,
  Tree,
  addDependenciesToPackageJson,
  installPackagesTask,
  OverwriteStrategy,
} from '@nx/devkit';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { TsReactWebsiteAuthGeneratorSchema as TsReactWebsiteAuthGeneratorSchema } from './schema';
import { runtimeConfigGenerator } from '../runtime-config/generator';
import { withVersions } from '../../../utils/versions';
import {
  addDestructuredImport,
  addSingleImport,
  applyGritQL,
} from '../../../utils/ast';
import { readFileSync } from 'fs';
import { join } from 'path';
import { formatFilesInSubtree } from '../../../utils/format';
import {
  NxGeneratorInfo,
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { addHookResultToRouterProviderContext } from '../../../utils/ast/website';
import { addIdentityInfra } from '../../../utils/identity-constructs/identity-constructs';
import { resolveIacProvider } from '../../../utils/iac';
import {
  addCloudscapeAuthMenu,
  addNoneAuthMenu,
  addShadcnAuthMenu,
} from './utils';
import { toProjectRelativePath } from '../../../utils/paths';

const readGritPattern = (name: string): string =>
  readFileSync(join(__dirname, 'grit', `${name}.grit`), 'utf-8').trim();

export const COGNITO_AUTH_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsReactWebsiteAuthGenerator(
  tree: Tree,
  options: TsReactWebsiteAuthGeneratorSchema,
) {
  const projectConfig = readProjectConfigurationUnqualified(
    tree,
    options.project,
  );
  const srcRoot = projectConfig.sourceRoot;
  if (
    tree.exists(joinPathFragments(srcRoot, 'components/CognitoAuth/index.tsx'))
  ) {
    throw new Error(
      `This generator has already been run on ${options.project}.`,
    );
  }

  if (!options.cognitoDomain) {
    throw new Error('A Cognito domain must be specified!');
  }

  await runtimeConfigGenerator(tree, {
    project: options.project,
  });

  const iacProvider = await resolveIacProvider(tree, options.iacProvider);

  await sharedConstructsGenerator(tree, {
    iacProvider,
  });

  await addIdentityInfra(tree, {
    iacProvider,
    allowSignup: options.allowSignup,
    cognitoDomain: options.cognitoDomain,
  });

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'app'),
    srcRoot,
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  addDependenciesToPackageJson(
    tree,
    withVersions(['oidc-client-ts', 'react-oidc-context']),
    {},
  );

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

  const uxProvider =
    (projectConfiguration.metadata as any)?.uxProvider ?? 'Cloudscape';

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
    switch (uxProvider) {
      case 'Cloudscape':
        await addCloudscapeAuthMenu(tree, appLayoutTsxPath);
        break;
      case 'Shadcn':
        await addShadcnAuthMenu(tree, appLayoutTsxPath);
        break;
      case 'None':
        await addNoneAuthMenu(tree, appLayoutTsxPath);
        break;
      default:
        throw new Error(
          `Top-level navigation menu to show the signed-in user for uxProvider "${uxProvider}" is not implemented.`,
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
  );

  await addGeneratorMetricsIfApplicable(tree, [COGNITO_AUTH_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}
export default tsReactWebsiteAuthGenerator;
