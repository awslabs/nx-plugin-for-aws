# Docs PR Preview Infrastructure

CDK app for the ephemeral per-PR documentation preview system. It provisions a
single private S3 bucket, a CloudFront distribution, and a GitHub Actions OIDC
deploy role. Every PR's preview is served from the same distribution under a
`pr-<number>/` key prefix.

This app is **deployed manually by maintainers** and is intentionally separate
from the Nx workspace - it is not part of `pnpm nx run-many --target build`.

## Architecture

```
pull_request                                  workflow_run
┌─────────────────────────────┐               ┌──────────────────────────────────┐
│ pr-docs-preview.yml         │   artifact    │ pr-docs-preview-deploy.yml         │
│  • astro build              │ ────────────► │  • maintainer approves (env gate)  │
│    DOCS_BASE_PATH=/pr-<n>   │  (docs-dist)  │  • OIDC assume DeployRole          │
│  • upload artifact          │               │  • s3 sync → pr-<n>/               │
└─────────────────────────────┘               │  • cloudfront invalidation         │
                                               │  • comment preview link on PR      │
                                               └──────────────────────────────────┘
                                                              │
                          pull_request_target (closed)        ▼
                          ┌──────────────────────────┐   S3 bucket  ◄── CloudFront
                          │ pr-docs-preview-cleanup   │   pr-1/...       (OAC + URL
                          │  • s3 rm pr-<n>/          │   pr-2/...        rewrite fn)
                          └──────────────────────────┘   pr-N/...
```

## Deploy

```bash
cd docs-preview-infra
npm install
npx cdk bootstrap         # once per account/region, if not already bootstrapped
npx cdk deploy
# Override the allowed repo if forked:
#   npx cdk deploy -c githubRepo=my-org/my-fork
```

Deploy to `us-east-1` (the workflows assume this region).

> **Prerequisite:** the account must already have a GitHub Actions OIDC provider
> (`token.actions.githubusercontent.com`). The stack references it rather than
> creating it, to avoid clashing with one that may already exist. If absent,
> create it once (`aws iam create-open-id-connect-provider ...`) before deploying.

## Wire up GitHub

After `cdk deploy`, take the stack outputs and set these **repository secrets**:

| Secret                         | From output              |
| ------------------------------ | ------------------------ |
| `DOCS_PREVIEW_DEPLOY_ROLE_ARN` | `DeployRoleArn`          |
| `DOCS_PREVIEW_BUCKET`          | `PreviewBucketName`      |
| `DOCS_PREVIEW_DISTRIBUTION_ID` | `DistributionId`         |
| `DOCS_PREVIEW_DOMAIN`          | `DistributionDomainName` |

Then create a repository **environment** named `docs-preview` with **required
reviewers** set to the maintainer team. The deploy workflow references this
environment, so a maintainer approves each preview deployment before it is
published.
