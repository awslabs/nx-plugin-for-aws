# AG-UI / Harness validation spike — hand-written prototype

Snapshot of the hand-written code used to validate `DESIGN-react-agentcore-harness-connection.md`
against a real deployed Harness (Epic #5). This is **not** the generator (Epic #13)  — it's the
throwaway prototype the spike deployed, kept here for reference alongside the findings in
`SPIKE-agui-harness-validation.md`.

## How it was exercised

A scratch workspace was created outside this repo with the published `@aws/nx-plugin`:

```bash
pnpm create @aws/nx-workspace spike-agui-harness --no-interactive --iac=cdk --no-gitSecrets
cd spike-agui-harness
pnpm nx g @aws/nx-plugin:ts#api --no-interactive --name=chatApi --framework=trpc --infra=rest-lambda --auth=iam
pnpm nx g @aws/nx-plugin:agentcore-harness --no-interactive --name=chatHarness
pnpm nx g @aws/nx-plugin:ts#infra --no-interactive --name=infra
```

Then, on top of the generated projects:

- `chat-api-agui/converse-to-agui.ts` + `handler.ts` were copied to
  `packages/chat-api/src/agui/` in the scratch workspace.
- `infra/application-stack.ts` replaced the generated
  `packages/infra/src/stacks/application-stack.ts`.
- `@ag-ui/core`, `@ag-ui/encoder`, `@aws-sdk/client-bedrock-agentcore` were added as dependencies
  of `chat-api` (`pnpm --filter <chat-api> add ...`).

## What this answers about the generator design (Q4)

The `/agui` route is attached directly to `chatApi.api.root` (the public CDK `RestApi` L2 the
`ChatApi` construct exposes) from the application stack — **no change to the generated `ChatApi`
construct was needed**. `chatApi.api.root.addResource('agui').addMethod('POST', new
LambdaIntegration(aguiHandler, { responseTransferMode: ResponseTransferMode.STREAM }))` is enough;
the API's CORS-preflight `Aspect` (attached to the `ChatApi` construct's scope) and
`defaultMethodOptions` (IAM authorizer) both apply automatically because the new resource is a
descendant of that scope. See `SPIKE-agui-harness-validation.md` for the full write-up.
