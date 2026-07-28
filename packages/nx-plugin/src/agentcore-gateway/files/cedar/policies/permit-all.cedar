<%_ if (auth === 'cognito') { _%>
// Default policy: permit any Cognito-authenticated caller.
// The gateway's JWT authorizer already validates the token's user pool and
// client, so any principal reaching policy evaluation is an authenticated
// OAuth user. The PolicyEngine runs in ENFORCE mode (default-deny) — deleting
// this file without a replacement permit denies every call. See
// policies/README.md.

permit (
  principal is AgentCore::OAuthUser,
  action,
  resource == AgentCore::Gateway::"<%%= gatewayArn %>"
);
<%_ } else { _%>
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
<%_ } _%>
