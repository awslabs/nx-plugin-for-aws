/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { execSync } from 'child_process';
import { join, relative } from 'path';
import { FsTree } from 'nx/src/generators/tree';
import { SHARED_SHADCN_NAME } from '../../packages/nx-plugin/src/utils/shared-constructs-constants';

const SHADCN_COMPONENTS = [
  'alert',
  'breadcrumb',
  'button',
  'card',
  'input',
  'separator',
  'sheet',
  'sidebar',
  'skeleton',
  'spinner',
  'tooltip',
];

const SHADCN_TEMPLATE_ROOT = join(
  process.cwd(),
  'packages',
  'nx-plugin',
  'src',
  'utils',
  'files',
  'common',
  'shadcn',
  'src',
);

const applyShadcnTemplateAliases = (contents: string): string =>
  contents.replace(/@\//g, `<%= scopeAlias %>${SHARED_SHADCN_NAME}/`);

export const refreshShadcnTemplates = (
  tree: FsTree,
  shadcnVersion: string,
  tmpDir: string,
): string[] => {
  const shadcnDir = join(tmpDir, 'shadcn');
  const shadcnSrcDir = join(shadcnDir, 'src');
  const shadcnUiDir = join(shadcnSrcDir, 'components', 'ui');
  const updatedTemplates: string[] = [];

  rmSync(shadcnDir, { recursive: true, force: true });
  mkdirSync(shadcnUiDir, { recursive: true });
  mkdirSync(join(shadcnSrcDir, 'lib'), { recursive: true });
  mkdirSync(join(shadcnSrcDir, 'hooks'), { recursive: true });
  mkdirSync(join(shadcnSrcDir, 'styles'), { recursive: true });

  // Update the current globals.css.template instead of starting from a blank file.
  const globalsTemplatePath = join(
    SHADCN_TEMPLATE_ROOT,
    'styles',
    'globals.css.template',
  );
  writeFileSync(
    join(shadcnSrcDir, 'styles', 'globals.css'),
    readFileSync(globalsTemplatePath, 'utf-8'),
  );

  writeFileSync(
    join(shadcnDir, 'package.json'),
    JSON.stringify(
      {
        name: 'shadcn-template-refresh',
        private: true,
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(shadcnDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
          },
        },
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(shadcnDir, 'components.json'),
    JSON.stringify(
      {
        $schema: 'https://ui.shadcn.com/schema.json',
        style: 'new-york',
        rsc: true,
        tsx: true,
        tailwind: {
          config: '',
          css: 'src/styles/globals.css',
          baseColor: 'zinc',
          cssVariables: true,
        },
        iconLibrary: 'lucide',
        aliases: {
          components: '@/components',
          utils: '@/lib/utils',
          hooks: '@/hooks',
          lib: '@/lib',
          ui: '@/components/ui',
        },
      },
      null,
      2,
    ),
  );

  console.log('Refreshing Shadcn templates...');
  execSync(
    `npx -y shadcn@${shadcnVersion} add ${SHADCN_COMPONENTS.join(' ')}`,
    {
      cwd: shadcnDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        CI: '1',
      },
    },
  );

  const writeTemplateFile = (sourcePath: string, targetPath: string): void => {
    const sourceContents = readFileSync(sourcePath, 'utf-8');
    const templatedContents = applyShadcnTemplateAliases(sourceContents);
    const targetRelativePath = relative(process.cwd(), targetPath);
    tree.write(targetRelativePath, templatedContents);
    updatedTemplates.push(targetRelativePath);
  };

  for (const component of SHADCN_COMPONENTS) {
    const sourcePath = join(shadcnUiDir, `${component}.tsx`);
    if (!existsSync(sourcePath)) {
      console.warn(
        `Skipping Shadcn component output (not generated): ${sourcePath}`,
      );
      continue;
    }
    const targetPath = join(
      SHADCN_TEMPLATE_ROOT,
      'components',
      'ui',
      `${component}.tsx.template`,
    );
    writeTemplateFile(sourcePath, targetPath);
  }

  (['hooks', 'lib'] as const).forEach((dirName) => {
    const sourceDir = join(shadcnSrcDir, dirName);
    if (existsSync(sourceDir)) {
      const entries = readdirSync(sourceDir, { withFileTypes: true });
      entries
        .filter((entry) => entry.isFile())
        .forEach((entry) => {
          const sourcePath = join(sourceDir, entry.name);
          const targetPath = join(
            SHADCN_TEMPLATE_ROOT,
            dirName,
            `${entry.name}.template`,
          );
          writeTemplateFile(sourcePath, targetPath);
        });
    }
  });

  writeTemplateFile(
    join(shadcnSrcDir, 'styles', 'globals.css'),
    join(SHADCN_TEMPLATE_ROOT, 'styles', 'globals.css.template'),
  );

  console.log('Shadcn templates refreshed.');
  return updatedTemplates;
};
