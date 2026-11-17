/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  logger,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import {
  assertContainerConnectionConstraints,
  containerServiceNames,
  resolveContainerComponent,
} from '../../../connection/container-connection.js';
import { addContainerServiceTargetToLocalDev } from '../../../connection/local-dev.js';
import { addTsDependencies } from '../../../utils/add-dependencies.js';
import { declareDependencies } from '../../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { installDependencies } from '../../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
import { assertSupportedNxVersion } from '../../../utils/nx-version.js';
import { toProjectRelativePath } from '../../../utils/paths.js';
import { runtimeConfigGenerator } from '../../react-website/runtime-config/generator.js';
import type { TsContainerReactConnectionGeneratorSchema } from './schema';
import { reactContainerWiringMessage } from './wiring.js';

/** The metadata this generator records, which its predicates read. */
export interface TsContainerReactConnectionMetadata {
  readonly auth: string;
}

// The browser signs requests with the identity pool's credentials for iam, and
// sends the Cognito access token for cognito.
export const DEPENDENCIES =
  declareDependencies<TsContainerReactConnectionMetadata>()({
    ts: [
      { name: 'oidc-client-ts', when: (m) => m.auth === 'iam' },
      { name: 'aws4fetch', when: (m) => m.auth === 'iam' },
      {
        name: '@aws-sdk/credential-provider-cognito-identity',
        when: (m) => m.auth === 'iam',
      },
      {
        name: 'react-oidc-context',
        when: (m) => m.auth === 'iam' || m.auth === 'cognito',
      },
      { name: '@smithy/types', when: (m) => m.auth === 'iam', dev: true },
    ],
  });

export const TS_CONTAINER_REACT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Connect a React website to a ts#container or py#container service.
 */
export const tsContainerReactConnectionGenerator = async (
  tree: Tree,
  options: TsContainerReactConnectionGeneratorSchema,
): Promise<GeneratorCallback> => {
  // Refuse an older Nx major before any file is written.
  assertSupportedNxVersion(tree);
  const website = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const serviceProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );
  const component = resolveContainerComponent(
    serviceProject,
    options.targetComponent,
    'target',
  );
  const names = containerServiceNames(serviceProject, component);

  assertContainerConnectionConstraints(
    `ts#react-website -> ${component.generator}`,
    { target: component },
    {
      source: website.name,
      target: `${serviceProject.name} (${names.prefix})`,
    },
  );

  const metadata: TsContainerReactConnectionMetadata = {
    auth: component.auth,
  };

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
    website.root,
    { nameClassName: names.nameClassName, auth: metadata.auth },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  if (metadata.auth === 'iam') {
    generateFiles(
      tree,
      joinPathFragments(
        import.meta.dirname,
        '../../../utils/files/website/hooks/sigv4',
      ),
      joinPathFragments(website.sourceRoot, 'hooks'),
      {},
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
  }

  await runtimeConfigGenerator(tree, {
    project: website.name,
    preferInstallDependencies: false,
  });

  await addContainerServiceTargetToLocalDev(
    tree,
    website.name,
    serviceProject.name,
    {
      serviceClassName: names.nameClassName,
      port: names.port,
      serveTarget: `${names.prefix}-serve`,
    },
  );

  addTsDependencies(tree, DEPENDENCIES, {
    metadata,
    projectRoot: website.root,
  });

  // Recorded so the version sync knows this connection's dependencies are ours.
  addComponentGeneratorMetadata(
    tree,
    website.name,
    TS_CONTAINER_REACT_CONNECTION_GENERATOR_INFO,
    toProjectRelativePath(
      website,
      joinPathFragments(
        website.sourceRoot,
        'hooks',
        `use${names.nameClassName}`,
      ),
    ),
    names.nameClassName,
    metadata,
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_CONTAINER_REACT_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);

  // Only an iam service needs a grant in the user's stack. Printed from the
  // callback so it appears after Nx lists the changed files.
  const message =
    metadata.auth === 'iam'
      ? reactContainerWiringMessage({ ...names, iac: names.iac })
      : undefined;
  return async () => {
    await installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
    if (message) {
      logger.info(message);
    }
  };
};

export default tsContainerReactConnectionGenerator;
