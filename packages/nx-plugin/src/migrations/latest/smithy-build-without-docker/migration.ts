/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type ProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  DEPENDENCIES,
  SMITHY_PROJECT_GENERATOR_INFO,
  type SmithyProjectMetadata,
  smithyCompileCommands,
  smithyCompileOutputs,
  smithyGenerateSsdkTarget,
  writeSsdkBundleConfig,
} from '../../../smithy/project/generator';
import { addTsDependencies } from '../../../utils/add-dependencies';
import { formatFilesInSubtree } from '../../../utils/format';
import { FsCommands } from '../../../utils/fs';

/**
 * Move Smithy projects off the container build onto the Smithy CLI.
 *
 * A Smithy build used to run inside an image: the `build.Dockerfile` installed the
 * CLI, built the model, and — for a service — installed and bundled the generated
 * Server SDK. That made Docker a prerequisite for any workspace holding a Smithy
 * project. The CLI now runs on the machine, so the Dockerfile goes and the
 * `compile` target is rewritten to invoke it.
 *
 * The target's commands are replaced wholesale rather than patched: every one of
 * them changes, and they are generated configuration. A project whose commands the
 * user has edited is left alone and reported, since replacing them would discard
 * those edits.
 */

/** Where a consuming project's Dockerfile brought in a shape library's model. */
const WORKSPACE_CONTEXT_COPY = /COPY\s+--from=workspace\s+(\S+)\s+\S+/g;

/**
 * The metadata a Smithy model project records, as a workspace on an older release
 * may hold it — `smithyType` predates neither the generator nor this migration, so
 * it may be absent.
 */
interface SmithyMetadata extends Partial<SmithyProjectMetadata> {
  readonly generator?: string;
}

const smithyMetadata = (
  project: ProjectConfiguration,
): SmithyMetadata | undefined => project.metadata as SmithyMetadata | undefined;

/**
 * Whether a project's `compile` commands are the ones a previous release
 * generated, so replacing them discards nothing.
 *
 * Matched on the shape of the image build rather than the exact string: the engine
 * is `docker` or `finch` depending on the workspace's configuration, and the
 * commands around it moved between releases.
 */
const hasGeneratedDockerCompile = (project: ProjectConfiguration): boolean => {
  const commands: unknown = project.targets?.compile?.options?.commands;
  if (!Array.isArray(commands)) {
    return false;
  }
  const imageBuilds = commands.filter(
    (command): command is string =>
      typeof command === 'string' && command.includes('build.Dockerfile'),
  );
  // Exactly the one image build the generator wrote, in the form it wrote it.
  // Anything else means the user has been in here.
  return (
    imageBuilds.length === 1 &&
    /^(?:docker|finch) build /.test(imageBuilds[0]) &&
    imageBuilds[0].includes('--target export')
  );
};

/**
 * The shape libraries a Dockerfile copied in, as `imports` entries.
 *
 * Consuming a shape library used to need a `COPY --from=workspace` bringing its
 * built model into the image, and an `imports` entry pointing at where it landed.
 * With the build on the machine, `imports` reaches the built model directly — the
 * CLI resolves them relative to `smithy-build.json` — so each copy becomes a
 * relative path, and the Dockerfile is no longer needed to carry it.
 */
const importsFromDockerfileCopies = (
  dockerfile: string,
  projectRoot: string,
): string[] => {
  const upToRoot = projectRoot
    .split('/')
    .filter(Boolean)
    .map(() => '..')
    .join('/');
  return [...dockerfile.matchAll(WORKSPACE_CONTEXT_COPY)].map(
    ([, source]) => `${upToRoot}/${source}`,
  );
};

/** Add the imports a Dockerfile's copies stood for, keeping the user's own. */
const addImports = (tree: Tree, projectRoot: string, imports: string[]) => {
  if (imports.length === 0) {
    return;
  }
  const path = joinPathFragments(projectRoot, 'smithy-build.json');
  if (!tree.exists(path)) {
    return;
  }
  const smithyBuild = JSON.parse(tree.read(path, 'utf-8') ?? '{}');
  const existing: string[] = smithyBuild.imports ?? [];
  smithyBuild.imports = [
    ...existing,
    ...imports.filter((entry) => !existing.includes(entry)),
  ];
  tree.write(path, JSON.stringify(smithyBuild, null, 2));
};

const editedNextStep = (projectName: string): string =>
  `${projectName}: its compile target has been customised, so it was left as it is. Smithy projects now build with the Smithy CLI rather than a container — see https://awslabs.github.io/nx-plugin-for-aws/guides/smithy-project/ for the target it expects.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];
  const migrated: SmithyProjectMetadata[] = [];

  for (const [name, project] of getProjects(tree)) {
    const metadata = smithyMetadata(project);
    if (metadata?.generator !== SMITHY_PROJECT_GENERATOR_INFO.id) {
      continue;
    }

    const dockerfilePath = joinPathFragments(project.root, 'build.Dockerfile');
    if (!tree.exists(dockerfilePath)) {
      continue;
    }

    if (!hasGeneratedDockerCompile(project)) {
      nextSteps.push(editedNextStep(name));
      continue;
    }

    // A project generated before the type was recorded is a service: the shapes
    // type shipped with the metadata already in place.
    const type = metadata.smithyType ?? 'service';

    // Carry over the shape library dependencies the Dockerfile expressed as
    // build-context copies before dropping it.
    addImports(
      tree,
      project.root,
      importsFromDockerfileCopies(
        tree.read(dockerfilePath, 'utf-8') ?? '',
        project.root,
      ),
    );
    tree.delete(dockerfilePath);

    // Built from the same helpers the generator uses, so the targets a migrated
    // project gets cannot drift from a freshly generated one.
    const cmd = new FsCommands(tree, DEPENDENCIES);
    project.targets ??= {};
    project.targets.compile = {
      ...project.targets.compile,
      outputs: smithyCompileOutputs(type),
      options: {
        ...project.targets.compile?.options,
        commands: smithyCompileCommands(cmd, type),
      },
    };

    // A service's Server SDK moves to its own target, so the model build and the
    // SDK build cache separately.
    if (type === 'service') {
      project.targets['generate-ssdk'] = {
        ...project.targets['generate-ssdk'],
        ...smithyGenerateSsdkTarget(),
      };
      project.targets.build = {
        ...project.targets.build,
        dependsOn: ['compile', 'generate-ssdk'],
      };
    }
    updateProjectConfiguration(tree, name, project);

    if (type === 'service') {
      writeSsdkBundleConfig(tree, project.root);
    }
    migrated.push({ smithyType: type, namespace: metadata.namespace ?? '' });
  }

  // A service's SDK bundler, which the image used to carry. The Smithy CLI needs
  // nothing here — the target fetches mise with `npx`.
  //
  // Added per migrated project rather than once for the workspace, so a mix of
  // services and shape libraries gets the union of what each needs. All of these
  // go to the root manifest, so repeating one is a no-op.
  for (const metadata of migrated) {
    addTsDependencies(tree, DEPENDENCIES, { metadata });
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
