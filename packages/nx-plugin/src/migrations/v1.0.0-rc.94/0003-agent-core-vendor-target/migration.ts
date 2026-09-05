/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type ProjectConfiguration,
  type TargetConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  ADOT_VENDOR_TARGET_NAME,
  adotVendorDir,
} from '../../../utils/agent-core-packaging.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * A TypeScript AgentCore code package installed the AWS Distro for OpenTelemetry
 * into the package directory as its last packaging step. That target's `inputs`
 * are the project's source, so editing an agent re-ran the install — several
 * seconds of npm work whose result depends only on the pinned ADOT version.
 *
 * The install moves to its own target Nx caches independently. It declares no
 * `inputs`, since the version it pins is part of the command and Nx hashes a
 * target's configuration, so a version bump still invalidates it while a source
 * edit no longer does. Packaging copies the vendored tree instead.
 *
 * The vendor directory is a sibling of the package directory, not a path inside
 * it: Nx replaces a cached target's whole declared output directory on restore,
 * so nesting one target's output inside another's makes each wipe the other's
 * work on a cache hit.
 *
 * A packaging target that no longer matches the shape the generator vended has
 * been reworked by the user, so it is left untouched and reported.
 *
 * The filesystem commands are spelled with `shx`: the migration that replaced the
 * single purpose CLIs was committed first, and `latest` migrations run in the
 * order their folders were committed, so it has already run by the time this one
 * does.
 */

/** The ADOT install as the packaging target ran it, capturing its `--prefix`. */
const ADOT_INSTALL =
  /^npm install --prefix (\S+) .*@aws\/aws-distro-opentelemetry-node-autoinstrumentation@(\S+)\s*$/;

const divergedStep = (projectName: string, targetName: string) =>
  `${projectName}:${targetName}: installs the OpenTelemetry distro but no longer matches the shape the generator produced - left untouched. To stop the install re-running whenever the project's source changes, move it to its own target with no \`inputs\` and an \`outputs\` directory outside this target's, and copy that directory in here instead.`;

/** Commands a target runs, as plain strings. */
const commandsOf = (target: TargetConfiguration): string[] => {
  const { commands } = (target.options ?? {}) as { commands?: unknown };
  return Array.isArray(commands)
    ? commands.filter((c): c is string => typeof c === 'string')
    : [];
};

/**
 * Copy the vendored `node_modules` into the package. `-R` and the trailing `/.`
 * merge the directory's contents rather than nesting it inside the destination.
 */
const copyCommand = (vendorDir: string, packageDir: string): string =>
  `shx cp -R ${joinPathFragments(vendorDir, 'node_modules')}/. ${joinPathFragments(packageDir, 'node_modules')}`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    let changed = false;
    const vendorDir = adotVendorDir(project.root);

    for (const [targetName, target] of Object.entries(project.targets ?? {})) {
      if (targetName === ADOT_VENDOR_TARGET_NAME) continue;

      const commands = commandsOf(target);
      const installIndex = commands.findIndex((c) => ADOT_INSTALL.test(c));
      if (installIndex < 0) continue;

      const install = commands[installIndex];
      const [, prefix] = ADOT_INSTALL.exec(install)!;

      // The install targets the directory this target packages into, and it
      // copies the bundle in with shx. Anything else has been reworked.
      const packageDir = prefix;
      const copiesBundle = commands.some(
        (c) => c !== install && c.startsWith('shx cp '),
      );
      const declaresPackageOutput = (target.outputs ?? []).some((o) =>
        o.endsWith(packageDir),
      );
      if (!copiesBundle || !declaresPackageOutput) {
        nextSteps.push(divergedStep(projectName, targetName));
        continue;
      }

      project.targets![ADOT_VENDOR_TARGET_NAME] ??= {
        cache: true,
        inputs: [],
        outputs: [`{workspaceRoot}/${vendorDir}`],
        executor: 'nx:run-commands',
        options: {
          commands: [
            `shx rm -rf ${vendorDir}`,
            `shx mkdir -p ${vendorDir}`,
            install.replace(prefix, vendorDir),
          ],
          parallel: false,
        },
      };

      const updated = [...commands];
      updated[installIndex] = copyCommand(vendorDir, packageDir);
      target.options!.commands = updated;
      target.dependsOn = [
        ...(target.dependsOn ?? []),
        ADOT_VENDOR_TARGET_NAME,
      ].filter((d, i, all) => all.indexOf(d) === i);

      changed = true;
    }

    if (changed) {
      updateProjectConfiguration(
        tree,
        projectName,
        project as ProjectConfiguration,
      );
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
