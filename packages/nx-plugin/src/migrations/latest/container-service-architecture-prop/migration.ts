/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * `ts#container` and `py#container` now take an `architecture` option, and the
 * per-service construct and module they vend pass it on. The reusable core
 * construct and module they pass it to are written `KeepExisting`, so an
 * upgraded workspace still has the versions that accept no architecture at all.
 * Nothing breaks until that workspace adds another container service: the new
 * per-service subclass passes `architecture` to a core construct whose
 * `EcsServiceProps` has no such property, which fails to compile for the whole
 * `common/constructs` package, and the new Terraform app module passes
 * `cpu_architecture` to a core module that does not declare the variable, which
 * Terraform rejects as an unsupported argument.
 *
 * This gives the core construct and module the input, by editing the lines
 * that hold the architecture rather than overwriting the files, so an
 * unrelated change the user made to either is kept. Both default the input to
 * ARM64, which is what the previous versions hard-coded, so an existing
 * service's synth and plan do not change: it is a new input, not a new
 * default.
 *
 * Guardrails:
 * - Every edit is checked before any is written, and a file missing one anchor
 *   is left entirely alone and reported through `nextSteps`. A half-rewritten
 *   construct would be worse than one the user fixes by hand. A file that
 *   matches every anchor comes out byte-identical to a freshly generated one.
 * - Idempotent. A file that already names the architecture input is skipped
 *   before the anchors are read, so a second run writes nothing and reports
 *   nothing.
 * - A rewritten file is reported too. A user whose vended infrastructure
 *   changed in a patch release should not have to diff it to find out.
 *
 * Known limitation: most anchors span several lines with `\n`, so a working
 * copy checked out with CRLF line endings (Git for Windows `core.autocrlf`)
 * matches none of them. Such a file is reported as diverged, with the manual
 * step, rather than being half-rewritten. No workspace is vended a
 * `.gitattributes`, so that cohort is real.
 */

/** One known old form and the new form that replaces it. */
export interface Edit {
  readonly from: string;
  readonly to: string;
}

const CONSTRUCTS_CORE = joinPathFragments(
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  'src',
  'core',
  'container',
);
const TERRAFORM_CORE = joinPathFragments(
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
  'src',
  'core',
  'container',
  'ecs-service',
);

const ECS_SERVICE_TS = joinPathFragments(CONSTRUCTS_CORE, 'ecs-service.ts');
const ECS_SERVICE_TF = joinPathFragments(TERRAFORM_CORE, 'ecs-service.tf');
const VARIABLES_TF = joinPathFragments(TERRAFORM_CORE, 'variables.tf');

/**
 * The `EcsService` construct, hunk by hunk. Replaced as literal text rather
 * than through GritQL: every old and new form is known exactly, and most of
 * these are doc comments, which GritQL does not match.
 */
const CDK_EDITS: readonly Edit[] = [
  {
    from: `       * Directory holding a Dockerfile, built as a linux/arm64 CDK image asset
       * at deploy time.`,
    to: `       * Directory holding a Dockerfile, built as a CDK image asset at deploy
       * time for the platform matching the service's \`architecture\`.`,
  },
  {
    from: `       * locally. For an ECR image the execution role is granted pull on it.
       */
      readonly imageUri: string;`,
    to: `       * locally. For an ECR image the execution role is granted pull on it.
       * The image must be built for the service's \`architecture\`.
       */
      readonly imageUri: string;`,
  },
  {
    from: ` * Properties for an ECS service on AWS Fargate (linux/arm64) in an existing VPC.
 */`,
    to: ` * CPU architecture the task runs on. \`ARM64\` runs on AWS Graviton, which costs
 * less per task on AWS Fargate; \`X86_64\` runs on Intel or AMD.
 */
export type EcsServiceArchitecture = 'ARM64' | 'X86_64';

/**
 * Properties for an ECS service on AWS Fargate in an existing VPC.
 */`,
  },
  {
    from: `  readonly image: EcsServiceImage;
  /**
   * Port the server listens on inside the container, passed as \`PORT\`.`,
    to: `  readonly image: EcsServiceImage;
  /**
   * CPU architecture the task runs on. An \`image.directory\` asset is built for
   * the matching platform, so the image and the task always agree.
   *
   * @default 'ARM64'
   */
  readonly architecture?: EcsServiceArchitecture;
  /**
   * Port the server listens on inside the container, passed as \`PORT\`.`,
  },
  {
    from: `/**
 * An ECS service on AWS Fargate (linux/arm64) in an existing VPC, with no load
 * balancer and no inbound rule on its security group.`,
    to: `/** The task CPU architecture and image build platform each architecture means. */
const ARCHITECTURES: Record<
  EcsServiceArchitecture,
  { readonly cpu: CpuArchitecture; readonly platform: Platform }
> = {
  ARM64: { cpu: CpuArchitecture.ARM64, platform: Platform.LINUX_ARM64 },
  X86_64: { cpu: CpuArchitecture.X86_64, platform: Platform.LINUX_AMD64 },
};

/**
 * An ECS service on AWS Fargate in an existing VPC, with no load balancer and
 * no inbound rule on its security group.`,
  },
  {
    from: `  /** The Fargate task definition (linux/arm64). */`,
    to: `  /** The Fargate task definition. */`,
  },
  {
    from: `    const containerPort = props.containerPort ?? 8080;`,
    to: `    const containerPort = props.containerPort ?? 8080;
    const architecture = ARCHITECTURES[props.architecture ?? 'ARM64'];`,
  },
  {
    from: `        cpuArchitecture: CpuArchitecture.ARM64,`,
    to: `        cpuArchitecture: architecture.cpu,`,
  },
  {
    from: `      image: this.containerImage(props.image),`,
    to: `      image: this.containerImage(props.image, architecture.platform),`,
  },
  {
    from: `  private containerImage(image: EcsServiceImage): ContainerImage {
    if ('directory' in image) {
      return ContainerImage.fromAsset(image.directory, {
        platform: Platform.LINUX_ARM64,
      });
    }`,
    to: `  private containerImage(
    image: EcsServiceImage,
    platform: Platform,
  ): ContainerImage {
    if ('directory' in image) {
      return ContainerImage.fromAsset(image.directory, { platform });
    }`,
  },
];

/** The core module's task definition, which read a hard-coded architecture. */
const TERRAFORM_MODULE_EDITS: readonly Edit[] = [
  {
    from: `    cpu_architecture        = "ARM64"`,
    to: `    cpu_architecture        = var.cpu_architecture`,
  },
];

/**
 * The core module's inputs. The new variable goes after `memory`, where the
 * generator writes it, so a migrated module matches a generated one. `terraform
 * fmt` aligns `=` within a run of consecutive assignments, and this block joins
 * no existing run, so nothing is re-padded.
 */
const TERRAFORM_VARIABLES_EDITS: readonly Edit[] = [
  {
    from: `# Inputs of the reusable ECS service module (AWS Fargate, linux/arm64) in an
# existing VPC. The module never creates a VPC.`,
    to: `# Inputs of the reusable ECS service module (AWS Fargate) in an existing VPC.
# The module never creates a VPC.`,
  },
  {
    from: `variable "memory" {
  description = "Task memory in MiB."
  type        = number
  default     = 512
}
`,
    to: `variable "memory" {
  description = "Task memory in MiB."
  type        = number
  default     = 512
}

variable "cpu_architecture" {
  description = "CPU architecture the task runs on. ARM64 runs on AWS Graviton, which costs less per task on AWS Fargate; X86_64 runs on Intel or AMD. The image in image_uri must be built for it."
  type        = string
  default     = "ARM64"

  validation {
    condition     = contains(["ARM64", "X86_64"], var.cpu_architecture)
    error_message = "cpu_architecture must be ARM64 or X86_64."
  }
}
`,
  },
];

/** A vended core file, what marks it as already migrated, and its edits. */
export interface CoreFile {
  readonly path: string;
  /** Present once the file takes the architecture input. */
  readonly migratedMarker: string;
  readonly edits: readonly Edit[];
  /** What the user has to do when the file has diverged. */
  readonly manualStep: string;
}

export const CORE_FILES: readonly CoreFile[] = [
  {
    path: ECS_SERVICE_TS,
    migratedMarker: 'EcsServiceArchitecture',
    edits: CDK_EDITS,
    manualStep: `add an optional \`architecture\` prop to \`EcsServiceProps\` that sets both \`runtimePlatform.cpuArchitecture\` and the \`ContainerImage.fromAsset\` platform, defaulting to ARM64`,
  },
  {
    path: ECS_SERVICE_TF,
    migratedMarker: 'var.cpu_architecture',
    edits: TERRAFORM_MODULE_EDITS,
    manualStep: `set \`cpu_architecture = var.cpu_architecture\` in the \`runtime_platform\` block of \`aws_ecs_task_definition\``,
  },
  {
    path: VARIABLES_TF,
    migratedMarker: 'variable "cpu_architecture"',
    edits: TERRAFORM_VARIABLES_EDITS,
    manualStep: `declare a \`cpu_architecture\` variable defaulting to "ARM64"`,
  },
];

/**
 * Applies a file's edits, or none of them. Returns whether it wrote.
 */
const migrateCoreFile = (
  tree: Tree,
  file: CoreFile,
  nextSteps: string[],
): boolean => {
  if (!tree.exists(file.path)) {
    // No container service was vended with this IaC provider in this workspace.
    return false;
  }

  const contents = tree.read(file.path, 'utf-8') ?? '';
  if (contents.includes(file.migratedMarker)) {
    // Already migrated, by an earlier run of this migration or by hand.
    return false;
  }

  const missing = file.edits.filter((edit) => !contents.includes(edit.from));
  if (missing.length > 0) {
    nextSteps.push(
      `${file.path} has diverged from the version this release replaces, so it was left alone. To add the architecture input by hand, ${file.manualStep}. Until then, adding another container service to this workspace generates infrastructure that passes an architecture this file does not accept.`,
    );
    return false;
  }

  tree.write(
    file.path,
    file.edits.reduce(
      // A replacer function, so a `$` in the new text is literal.
      (text, edit) => text.replace(edit.from, () => edit.to),
      contents,
    ),
  );
  return true;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];
  const migrated: string[] = [];

  for (const file of CORE_FILES) {
    if (migrateCoreFile(tree, file, nextSteps)) {
      migrated.push(file.path);
    }
  }

  if (migrated.length > 0) {
    nextSteps.push(
      `Your container service infrastructure now takes a CPU architecture: ${migrated.join(', ')}. It defaults to ARM64, which these files previously hard-coded, so your deployed services do not change. Re-deploy at your convenience and check the diff is empty.`,
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
