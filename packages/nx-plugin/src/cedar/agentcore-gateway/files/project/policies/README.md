# Cedar policies for <%= nameClassName %>

Every `.cedar` file in this directory is deployed as a separate `Policy`
resource attached to this gateway's `PolicyEngine`. The engine runs in
`ENFORCE` mode, so policies are evaluated and decisions are enforced at
runtime.

## Default policy

`permit-all.cedar` permits any IAM caller from the deploying AWS account.
It is scoped to your account because AgentCore's policy validator rejects
truly unrestricted permits (`permit (principal, action, resource)`) as
"Overly Permissive".

**If you delete this file without adding replacement `permit` policies, the
gateway will deny every request** — Cedar uses a default-deny evaluation
model, so every request requires at least one matching `permit` to be
allowed.

## Placeholder tokens

These strings are substituted at synth/plan time:

- `${gateway_arn}` — this gateway's ARN
- `${account_id}` — the AWS account this gateway is deployed into

## Adding a new policy

1. Create `policies/<my-policy>.cedar` alongside the existing files.
2. Write Cedar rules — see the **Writing Policies** section of the
   [AgentCore Gateway guide](https://awslabs.github.io/nx-plugin-for-aws/guides/agentcore-gateway/)
   for valid patterns and validator gotchas.
3. Re-synth / plan your infrastructure to deploy the new policy.

Policy names are derived from file names: `my-policy.cedar` becomes the
policy `MyPolicy`. Keep file names unique within this directory.

## Further reading

- [Cedar policy language reference](https://docs.cedarpolicy.com/)
- [AgentCore policy semantics](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-understanding-cedar.html)
- [AgentCore common policy patterns](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-common-patterns.html)
