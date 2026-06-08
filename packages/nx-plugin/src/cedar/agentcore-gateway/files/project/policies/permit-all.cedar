// Default policy: permit any IAM caller from the deploying AWS account.
//
// WARNING: The gateway's PolicyEngine runs in ENFORCE mode. If you delete or
// break this file without adding replacement permit policies, the gateway
// will DENY ALL calls (Cedar default-deny semantics).
//
// To restrict access: add additional .cedar files in this directory. Each
// file becomes one Policy resource attached to the PolicyEngine. forbid
// policies override permits.
//
// Why this is account-scoped: AgentCore's policy validator rejects bare
// `permit (principal, action, resource)` policies as "Overly Permissive".
// Scoping to the deploying account is restrictive enough to satisfy the
// validator while permitting any caller from your own account.
//
// Placeholders substituted at synth/plan time:
//   ${gateway_arn}  → this gateway's ARN
//   ${account_id}   → the AWS account this gateway is deployed into
//
// See the "Writing Policies" section of the AgentCore Gateway guide for
// more patterns and gotchas.

permit (
  principal is AgentCore::IamEntity,
  action,
  resource == AgentCore::Gateway::"${gateway_arn}"
) when {
  principal.id like "arn:aws:*::${account_id}:*"
};
