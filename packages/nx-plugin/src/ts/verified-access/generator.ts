/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  getProjects,
  joinPathFragments,
  type Tree,
} from '@nx/devkit';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { resolveIac } from '../../utils/iac.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { kebabCase, toClassName } from '../../utils/names.js';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx.js';
import { assertSupportedNxVersion } from '../../utils/nx-version.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants.js';
import {
  assertVendedCurrent,
  REST_API_SAME_ACCOUNT_GRANT,
  SIGV4_CUSTOM_DOMAINS,
  USER_IDENTITY_CALLBACK_URLS,
} from '../../utils/vended-shapes.js';
import { addVerifiedAccessCdkConstructs } from '../../utils/verified-access-constructs/verified-access-constructs.js';
import { assertRestApiProject } from '../react-website/app/api-gateway-hosting.js';
import type { TsVerifiedAccessGeneratorSchema } from './schema';

export const DEPENDENCIES = declareDependencies()({
  ts: [...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES)],
});

export const TS_VERIFIED_ACCESS_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Stops when a file another generator vended, which the door relies on,
 * predates what it needs. The plugin's migrations bring such files up to date.
 */
const assertDoorFilesCurrent = async (tree: Tree, apiName: string) => {
  const generator = 'ts#verified-access';
  const constructsSrc = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
  );
  await assertVendedCurrent(
    tree,
    joinPathFragments(constructsSrc, 'core', 'user-identity.ts'),
    USER_IDENTITY_CALLBACK_URLS,
    "UserIdentity's addCallbackUrl, for the door's sign-in callback",
    generator,
  );
  const apiConstruct = joinPathFragments(
    constructsSrc,
    'app',
    'apis',
    `${kebabCase(apiName)}.ts`,
  );
  if ((tree.read(apiConstruct, 'utf-8') ?? '').includes('grantInvokeAccess(')) {
    await assertVendedCurrent(
      tree,
      apiConstruct,
      REST_API_SAME_ACCOUNT_GRANT,
      'a grantInvokeAccess that names a same-account grantee in its own policy alone',
      generator,
    );
  }
  // Only the websites connected to this API call it through the door
  for (const project of getProjects(tree).values()) {
    const hooks = joinPathFragments(
      project.sourceRoot ?? joinPathFragments(project.root, 'src'),
      'hooks',
    );
    if (
      !tree.exists(joinPathFragments(hooks, `use${toClassName(apiName)}.tsx`))
    ) {
      continue;
    }
    await assertVendedCurrent(
      tree,
      joinPathFragments(hooks, 'useSigV4.tsx'),
      SIGV4_CUSTOM_DOMAINS,
      "signing for API Gateway behind the door's custom domain",
      generator,
    );
  }
};

export const tsVerifiedAccessGenerator = async (
  tree: Tree,
  options: TsVerifiedAccessGeneratorSchema,
): Promise<GeneratorCallback> => {
  assertSupportedNxVersion(tree);
  const iac = await resolveIac(tree, options.iac ?? 'inherit');
  if (iac !== 'cdk') {
    throw new Error('ts#verified-access is only supported with CDK');
  }
  assertRestApiProject(tree, options.apiProject);
  const apiProject = readProjectConfigurationUnqualified(
    tree,
    options.apiProject,
  );
  await assertDoorFilesCurrent(
    tree,
    (apiProject.metadata as { apiName?: string } | undefined)?.apiName ?? '',
  );

  await sharedConstructsGenerator(tree, { iac }, DEPENDENCIES);
  await addVerifiedAccessCdkConstructs(tree);

  addComponentGeneratorMetadata(
    tree,
    apiProject.name,
    TS_VERIFIED_ACCESS_GENERATOR_INFO,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'verified-access.ts',
    ),
    undefined,
    { iac },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_VERIFIED_ACCESS_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, undefined, { languages: ['typescript'] });
};

export default tsVerifiedAccessGenerator;
