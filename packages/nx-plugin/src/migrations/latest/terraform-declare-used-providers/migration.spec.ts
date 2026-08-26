/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { TERRAFORM_VERSIONS } from '../../../utils/versions.js';
import migration from './migration.js';

const TF_SRC = 'packages/common/terraform/src';
const REST_API = `${TF_SRC}/app/apis/my-api/my-api.tf`;

/** A vended REST API app module as an older release produced it: only `aws`. */
const restApiBefore = `terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "${TERRAFORM_VERSIONS.aws}"
    }
  }
}

resource "random_string" "suffix" {
  length  = 8
  special = false
  upper   = false
}

data "archive_file" "lambda_zip" {
  type       = "zip"
  source_dir = "\${path.module}/../bundle"
}

resource "aws_lambda_function" "api" {
  function_name    = "MyApi-\${random_string.suffix.result}"
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
}
`;

describe('terraform-declare-used-providers migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should declare the providers a vended module uses but omits', async () => {
    tree.write(REST_API, restApiBefore);

    const { nextSteps } = await migration(tree);

    const contents = tree.read(REST_API, 'utf-8')!;
    expect(contents).toContain(`source  = "hashicorp/random"`);
    expect(contents).toContain(`version = "${TERRAFORM_VERSIONS.random}"`);
    expect(contents).toContain(`source  = "hashicorp/archive"`);
    expect(contents).toContain(`version = "${TERRAFORM_VERSIONS.archive}"`);
    // The provider it already declared is untouched, and nothing is asked of
    // the user.
    expect(contents).toContain(`source  = "hashicorp/aws"`);
    expect(nextSteps).toEqual([]);
  });

  it('should declare a provider a sibling file in the same module uses', async () => {
    // Terraform merges every `.tf` in a directory into one module, so a
    // sibling's use of a provider is the module's to declare.
    tree.write(
      `${TF_SRC}/app/dbs/my-db/my-db.tf`,
      `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "${TERRAFORM_VERSIONS.aws}"
    }
  }
}
`,
    );
    tree.write(
      `${TF_SRC}/app/dbs/my-db/bundle.tf`,
      `data "external" "docker_digest" {
  program = ["bash", "digest.sh"]
}
`,
    );

    await migration(tree);

    expect(tree.read(`${TF_SRC}/app/dbs/my-db/my-db.tf`, 'utf-8')).toContain(
      `source  = "hashicorp/external"`,
    );
  });

  it('should leave a module that already declares everything untouched', async () => {
    const already = `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "${TERRAFORM_VERSIONS.aws}"
    }
    random = {
      source  = "hashicorp/random"
      version = "${TERRAFORM_VERSIONS.random}"
    }
  }
}

resource "random_string" "suffix" {
  length = 8
}
`;
    tree.write(REST_API, already);

    const { nextSteps } = await migration(tree);

    expect(tree.read(REST_API, 'utf-8')).toEqual(already);
    expect(nextSteps).toEqual([]);
  });

  it('should not treat an embedded script as a provider reference', async () => {
    // A `local-exec` heredoc's Python identifiers look like HCL references.
    const withScript = `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "${TERRAFORM_VERSIONS.aws}"
    }
  }
}

resource "aws_s3_object" "upload" {
  bucket = "b"
  key    = "k"

  provisioner "local-exec" {
    command = <<-EOT
      python -c "
local_path_obj = Path(local_path)
for f in local_path_obj.rglob('*'):
    print(f)
"
    EOT
  }
}
`;
    tree.write(REST_API, withScript);

    await migration(tree);

    expect(tree.read(REST_API, 'utf-8')).toEqual(withScript);
  });

  it('should skip and report a module with no required_providers block', async () => {
    const noBlock = `resource "random_string" "suffix" {
  length = 8
}
`;
    tree.write(`${TF_SRC}/metrics/metrics.tf`, noBlock);

    const { nextSteps } = await migration(tree);

    expect(tree.read(`${TF_SRC}/metrics/metrics.tf`, 'utf-8')).toEqual(noBlock);
    expect(nextSteps).toEqual([
      expect.stringContaining('has no terraform required_providers block'),
    ]);
  });

  it('should be idempotent', async () => {
    tree.write(REST_API, restApiBefore);

    await migration(tree);
    const afterFirst = tree.read(REST_API, 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(tree.read(REST_API, 'utf-8')).toEqual(afterFirst);
    expect(nextSteps).toEqual([]);
  });
});
