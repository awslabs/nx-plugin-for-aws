// Default policy: permit any IAM caller from the deploying AWS account.
// The PolicyEngine runs in ENFORCE mode (default-deny) — deleting this file
// without a replacement permit denies every call. See policies/README.md.

permit (
  principal is AgentCore::IamEntity,
  action,
  resource == AgentCore::Gateway::"<%%= gatewayArn %>"
) when {
  principal.id like "arn:aws:*::<%%= accountId %>:*"
};
