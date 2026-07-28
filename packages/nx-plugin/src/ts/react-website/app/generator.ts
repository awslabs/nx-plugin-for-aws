/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  names,
  OverwriteStrategy,
  readProjectConfiguration,
  removeDependenciesFromPackageJson,
  type Tree,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { applicationGenerator } from '@nx/react';
import { relative, sep } from 'path';
import {
  addDestructuredImport,
  addSingleImport,
  applyGritQL,
} from '../../../utils/ast';
import { addDependenciesToPackageJson } from '../../../utils/dependencies';
import { formatFilesInSubtree } from '../../../utils/format';
import { resolveIac } from '../../../utils/iac';
import { installDependencies } from '../../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { kebabCase, toClassName, toKebabCase } from '../../../utils/names';
import { getNpmScopePrefix } from '../../../utils/npm-scope';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
} from '../../../utils/nx';
import { sortObjectKeys } from '../../../utils/object';
import { getRelativePathToRoot } from '../../../utils/paths';
import { getPackageManagerDisplayCommands } from '../../../utils/pkg-manager';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_SHADCN_DIR,
} from '../../../utils/shared-constructs-constants';
import { sharedShadcnGenerator } from '../../../utils/shared-shadcn';
import { type ITsDepVersion, withVersions } from '../../../utils/versions';
import { addWebsiteInfra } from '../../../utils/website-constructs/website-constructs';
import { configureTsProject } from '../../lib/ts-project-utils';
// typescript factory imports removed — now using GritQL for vite config transforms
import type { TsReactWebsiteGeneratorSchema } from './schema';

export const SUPPORTED_UX_PROVIDERS = ['none', 'cloudscape', 'shadcn'] as const;

export type UxOption = (typeof SUPPORTED_UX_PROVIDERS)[number];

export type Ux = UxOption;

export const REACT_WEBSITE_APP_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export async function tsReactWebsiteGenerator(
  tree: Tree,
  schema: TsReactWebsiteGeneratorSchema,
) {
  const tailwind = schema.tailwind ?? true;
  const tanstackRouter = schema.tanstackRouter ?? true;
  const ux: Ux = schema.ux ?? 'shadcn';
  if (ux === 'shadcn' && !tailwind) {
    throw new Error('Shadcn requires TailwindCSS to be enabled.');
  }
  const npmScopePrefix = getNpmScopePrefix(tree);
  const scopeAlias = npmScopePrefix;
  const websiteNameClassName = toClassName(schema.name);
  const websiteNameKebabCase = toKebabCase(schema.name);
  const fullyQualifiedName = `${npmScopePrefix}${websiteNameKebabCase}`;
  // NB: interactive nx generator cli can pass empty string
  const websiteContentPath = joinPathFragments(
    schema.directory || '.',
    schema.subDirectory || websiteNameKebabCase,
  );

  const projectAlreadyExists = tree.exists(
    joinPathFragments(websiteContentPath, 'project.json'),
  );

  // TODO: consider exposing and supporting e2e tests
  const e2eTestRunner = 'none';

  if (!projectAlreadyExists) {
    await applicationGenerator(tree, {
      ...schema,
      name: fullyQualifiedName,
      directory: websiteContentPath,
      routing: false,
      e2eTestRunner,
      linter: 'none',
      bundler: 'vite',
      unitTestRunner: 'vitest',
      useProjectJson: true,
      style: 'css',
      // Register the @nx/vite and @nx/vitest plugins so build/serve/test
      // targets are inferred rather than emitting deprecated executor targets.
      addPlugin: true,
    });

    // Pin the inferred target names. The vite production build is exposed as
    // `bundle` (which produces the deployable artifact), leaving `build` as an
    // aggregator over lint/compile/test/bundle. vite's own typecheck is dropped
    // in favour of the tsc `compile`.
    updateJson(tree, 'nx.json', (nxJson) => {
      for (const plugin of nxJson.plugins ?? []) {
        if (typeof plugin === 'string') continue;
        if (plugin.plugin === '@nx/vite/plugin') {
          plugin.options = {
            ...plugin.options,
            buildTargetName: 'bundle',
            // Map both of vite's inferred dev-server targets onto `serve` so the
            // plugin doesn't emit a separate `dev`; we author our own `dev`
            // below running the local-dev vite mode.
            serveTargetName: 'serve',
            devTargetName: 'serve',
            previewTargetName: 'preview',
            serveStaticTargetName: 'serve-static',
            typecheckTargetName: 'vite:typecheck',
          };
        } else if (plugin.plugin === '@nx/vitest') {
          plugin.options = {
            ...plugin.options,
            testTargetName: 'test',
          };
        }
      }
      return nxJson;
    });

    // Replace with simpler sample source code
    tree.delete(joinPathFragments(websiteContentPath, 'src'));
  }

  const projectConfiguration = readProjectConfiguration(
    tree,
    fullyQualifiedName,
  );

  const targets = projectConfiguration.targets;

  const infra = schema.infra ?? 'cloudfront-s3';

  // Configure load:runtime-config target based on IaC provider (only when infra is not none)
  const iac = infra !== 'none' ? await resolveIac(tree, schema.iac) : undefined;

  if (iac === 'cdk') {
    targets['load:runtime-config'] = {
      executor: 'nx:run-commands',
      metadata: {
        description: `Load runtime config from your deployed stack for dev purposes. You must set your AWS CLI credentials whilst calling '${getPackageManagerDisplayCommands().exec} nx run ${fullyQualifiedName}:load:runtime-config'`,
      },
      options: {
        command: `aws s3 cp s3://\`aws cloudformation describe-stacks --query "Stacks[?starts_with(StackName, '${kebabCase(npmScopePrefix)}-')][].Outputs[] | [?contains(OutputKey, '${websiteNameClassName}WebsiteBucketName')].OutputValue" --output text\`/runtime-config.json "{projectRoot}/public/runtime-config.json"`,
      },
    };
  } else if (iac === 'terraform') {
    targets['load:runtime-config'] = {
      executor: 'nx:run-commands',
      metadata: {
        description:
          "Load runtime config from most recently applied terraform env for dev purposes. Copies the runtime config from the Terraform dist directory to the website's public directory.",
      },
      options: {
        command:
          'node -e "const fs=require(\'fs\');fs.mkdirSync(process.env.DEST_DIR,{recursive:true});fs.copyFileSync(process.env.SRC_FILE,process.env.DEST_FILE);"',
        env: {
          SRC_FILE: 'dist/packages/common/terraform/runtime-config.json',
          DEST_DIR: `{projectRoot}/public`,
          DEST_FILE: `{projectRoot}/public/runtime-config.json`,
        },
      },
    };
  }

  if (!projectAlreadyExists) {
    targets['compile'] = {
      dependsOn: ['^build'],
      executor: 'nx:run-commands',
      outputs: ['{workspaceRoot}/dist/{projectRoot}/tsc'],
      options: {
        command: 'tsc --build tsconfig.app.json',
        cwd: '{projectRoot}',
      },
    };
    // bundle is the @nx/vite/plugin inferred `vite build` (writing to the
    // bundle dir configured in vite.config) — it produces the deployable
    // artifact. build aggregates lint/compile/test/bundle.
    targets['build'] = {
      dependsOn: ['lint', 'compile', 'test', 'bundle'],
    };

    // Run the website and its connected dependencies locally. Mirrors the
    // inferred `serve` target but with the local-dev vite mode.
    targets['dev'] = {
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        command: 'vite --mode local-dev',
        cwd: '{projectRoot}',
      },
    };
  }

  projectConfiguration.targets = sortObjectKeys(targets);

  updateProjectConfiguration(tree, fullyQualifiedName, projectConfiguration);
  addGeneratorMetadata(
    tree,
    projectConfiguration.name,
    REACT_WEBSITE_APP_GENERATOR_INFO,
    {
      ux,
      framework: 'react',
      infra,
    },
  );

  await configureTsProject(tree, {
    dir: websiteContentPath,
    fullyQualifiedName,
  });

  if (ux === 'shadcn') {
    await sharedShadcnGenerator(tree);
  }

  if (iac) {
    await sharedConstructsGenerator(tree, {
      iac,
    });

    await addWebsiteInfra(tree, {
      iac,
      websiteProjectName: fullyQualifiedName,
      scopeAlias,
      websiteContentPath: joinPathFragments('dist', websiteContentPath),
      websiteNameKebabCase,
      websiteNameClassName,
    });
  }

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);
  const libraryRoot = projectConfig.root;
  const sharedShadcnStylesImport = relative(
    joinPathFragments(libraryRoot, 'src'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_SHADCN_DIR,
      'src',
      'styles',
      'globals.css',
    ),
  )
    .split(sep)
    .join('/');
  const sharedShadcnTsconfigRef = relative(
    joinPathFragments(tree.root, websiteContentPath),
    joinPathFragments(
      tree.root,
      PACKAGES_DIR,
      SHARED_SHADCN_DIR,
      'tsconfig.json',
    ),
  )
    .split(sep)
    .join('/');
  const templateOptions = {
    ...schema,
    fullyQualifiedName,
    pkgMgrCmd: getPackageManagerDisplayCommands().exec,
    tailwind,
    tanstackRouter,
    scopeAlias,
    sharedShadcnStylesImport,
  };
  tree.delete(joinPathFragments(libraryRoot, 'src', 'app'));
  const appCommonTemplatePath = joinPathFragments(
    import.meta.dirname,
    './files/app/common',
  );
  const appTemplatePath = joinPathFragments(
    import.meta.dirname,
    `./files/app/${ux.toLowerCase()}`,
  );

  generateFiles(
    tree, // the virtual file system
    appCommonTemplatePath, // path to the file templates
    libraryRoot, // destination path of the files
    templateOptions, // config object to replace variable in file templates
    {
      // User-editable source - preserve any edits on re-run
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree, // the virtual file system
    appTemplatePath, // path to the file templates
    libraryRoot, // destination path of the files
    templateOptions, // config object to replace variable in file templates
    {
      // User-editable source - preserve any edits on re-run
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  if (tanstackRouter) {
    const routerCommonTemplatePath = joinPathFragments(
      import.meta.dirname,
      './files/tanstack-router/common',
    );
    const routerTemplatePath = joinPathFragments(
      import.meta.dirname,
      `./files/tanstack-router/${ux.toLowerCase()}`,
    );

    generateFiles(
      tree,
      routerCommonTemplatePath,
      libraryRoot,
      templateOptions,
      {
        // User-editable source (and the TanStack-managed route tree) - preserve on re-run
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );

    generateFiles(
      tree,
      routerTemplatePath,
      libraryRoot,
      templateOptions, // config object to replace variable in file templates
      {
        // User-editable source - preserve any edits on re-run
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
    tree.delete(joinPathFragments(websiteContentPath, 'src', 'app.tsx'));
  }

  if (e2eTestRunner !== 'none') {
    const e2eFullyQualifiedName = `${fullyQualifiedName}-e2e`;
    const e2eRoot = readProjectConfiguration(tree, e2eFullyQualifiedName).root;
    generateFiles(
      tree, // the virtual file system
      joinPathFragments(import.meta.dirname, `./files/e2e/${e2eTestRunner}`), // path to the file templates
      e2eRoot, // destination path of the files
      { ...schema, ...names(fullyQualifiedName) },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
    await configureTsProject(tree, {
      fullyQualifiedName: e2eFullyQualifiedName,
      dir: e2eRoot,
    });
  }
  const viteConfigPath = joinPathFragments(libraryRoot, 'vite.config.mts');

  if (tree.exists(viteConfigPath)) {
    // Add Tanstack Router import if enabled
    if (tanstackRouter) {
      await addDestructuredImport(
        tree,
        viteConfigPath,
        ['tanstackRouter'],
        '@tanstack/router-plugin/vite',
      );

      await addDestructuredImport(tree, viteConfigPath, ['resolve'], 'path');
    }

    // Add TailwindCSS import if enabled
    if (tailwind) {
      await addSingleImport(
        tree,
        viteConfigPath,
        'tailwindcss',
        '@tailwindcss/vite',
      );
    }

    // Update build.outDir. The inferred `vite build` target writes here, so
    // point it at the bundle dir the website infrastructure consumes.
    const outDir = joinPathFragments(
      getRelativePathToRoot(tree, fullyQualifiedName),
      'dist',
      websiteContentPath,
      'bundle',
    );
    await applyGritQL(
      tree,
      viteConfigPath,
      `\`build: { $bprops }\` where { $bprops <: contains \`outDir: $_\` => \`outDir: '${outDir}'\` }`,
    );

    // Add plugins to the plugins array
    if (tanstackRouter) {
      // Prepend tanstackRouter (must be first plugin) — rewrite works for both single/multi-element
      await applyGritQL(
        tree,
        viteConfigPath,
        "`plugins: [$items]` => `plugins: [tanstackRouter({ routesDirectory: resolve(__dirname, 'src/routes'), generatedRouteTree: resolve(__dirname, 'src/routeTree.gen.ts') }), $items]` where { $items <: within `defineConfig($_)`, $items <: not contains `tanstackRouter` }",
      );
    }

    if (tailwind) {
      await applyGritQL(
        tree,
        viteConfigPath,
        '`plugins: [$items]` => `plugins: [$items, tailwindcss()]` where { $items <: within `defineConfig($_)`, $items <: not some `tailwindcss()` }',
      );
    }

    // Use Vite's native tsconfig paths resolution (replaces vite-tsconfig-paths).
    // `dedupe` forces a single copy of react/react-dom into the bundle: each
    // project declares its own react dependency, so without this a workspace
    // library's hoisted copy can produce a second React instance and the
    // "Invalid hook call" runtime crash.
    await applyGritQL(
      tree,
      viteConfigPath,
      "or { `defineConfig(() => ({ $props }))` where { $props <: not some `resolve: $_`, $props += `resolve: { tsconfigPaths: true, dedupe: ['react', 'react-dom'] }` }, `defineConfig({ $props })` where { $props <: not some `resolve: $_`, $props += `resolve: { tsconfigPaths: true, dedupe: ['react', 'react-dom'] }` } }",
    );

    // Add define: { global: {} } to the config (handles both callback and direct forms)
    await applyGritQL(
      tree,
      viteConfigPath,
      'or { `defineConfig(() => ({ $props }))` where { $props <: not contains `define`, $props += `define: { global: {} }` }, `defineConfig({ $props })` where { $props <: not contains `define`, $props += `define: { global: {} }` } }',
    );
  }

  updateJson(
    tree,
    joinPathFragments(websiteContentPath, 'tsconfig.json'),
    (tsconfig) => ({
      ...tsconfig,
      compilerOptions: {
        ...tsconfig.compilerOptions,
        moduleResolution: 'Bundler',
        module: 'Preserve',
      },
    }),
  );
  const outDirToRootRelativePath = relative(
    joinPathFragments(tree.root, websiteContentPath),
    tree.root,
  );
  const distDir = joinPathFragments(
    outDirToRootRelativePath,
    'dist',
    websiteContentPath,
    'tsc',
  );
  updateJson(
    tree,
    joinPathFragments(websiteContentPath, 'tsconfig.app.json'),
    (tsconfig) => ({
      ...tsconfig,
      compilerOptions: {
        ...tsconfig.compilerOptions,
        outDir: distDir,
        tsBuildInfoFile: joinPathFragments(distDir, 'tsconfig.lib.tsbuildinfo'),
        lib: ['DOM'],
      },
      references:
        ux === 'shadcn'
          ? [
              ...(tsconfig.references ?? []).filter(
                (ref) => ref.path !== sharedShadcnTsconfigRef,
              ),
              {
                path: sharedShadcnTsconfigRef,
              },
            ]
          : tsconfig.references,
    }),
  );

  const dependencies: ITsDepVersion[] = ['react', 'react-dom'];
  // Build/test tooling imported only from vite.config.mts stays at the root.
  const rootDevDependencies: ITsDepVersion[] = ['@nx/react', '@vitest/ui'];

  if (ux === 'cloudscape') {
    dependencies.push(
      '@cloudscape-design/components',
      '@cloudscape-design/board-components',
      '@cloudscape-design/global-styles',
    );
  } else if (ux === 'shadcn') {
    // Shared shadcn components live in the common/shadcn package, but the
    // website's own generated components (e.g. the tanstack-router sidebar)
    // import lucide-react directly, so the website must declare it.
    if (tanstackRouter) {
      dependencies.push('lucide-react');
    }
  }

  if (tailwind) {
    dependencies.push('tailwindcss');
    rootDevDependencies.push('@tailwindcss/vite');
  }
  if (tanstackRouter) {
    dependencies.push('@tanstack/react-router');
    rootDevDependencies.push(
      '@tanstack/router-plugin',
      '@tanstack/router-generator',
      '@tanstack/virtual-file-routes',
      '@tanstack/router-utils',
    );
  }

  addDependenciesToPackageJson(
    tree,
    withVersions(dependencies),
    {},
    joinPathFragments(libraryRoot, 'package.json'),
  );
  addDependenciesToPackageJson(tree, {}, withVersions(rootDevDependencies));

  // @nx/react's applicationGenerator seeds react/react-dom into the root
  // manifest. The website now declares its own pinned versions, so drop the
  // root copies: without catalogs (npm) the root's floating range resolves to
  // a different version than the website's pin, installing a second React and
  // producing the "Invalid hook call" runtime crash.
  removeDependenciesFromPackageJson(tree, ['react', 'react-dom'], []);

  await addGeneratorMetricsIfApplicable(tree, [
    REACT_WEBSITE_APP_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  // The generated vite.config.mts imports these, and Nx's inferred `@nx/vite`
  // plugin loads that config when computing the project graph — so they must be
  // installed even if the caller would otherwise prefer to defer.
  return () =>
    installDependencies(tree, schema.preferInstallDependencies, {
      languages: ['typescript'],
      ensureResolvable: [
        ...(tailwind ? (['@tailwindcss/vite'] as const) : []),
        ...(tanstackRouter ? (['@tanstack/router-plugin'] as const) : []),
      ],
    });
}
export default tsReactWebsiteGenerator;
