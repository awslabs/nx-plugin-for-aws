/**
 * Builds the CDK command as an array of arguments for spawnSync.
 *
 * Defaults to --require-approval=never (standard for local dev deploys).
 * If the user explicitly passes --require-approval with any value, we
 * respect their choice and don't add the default.
 *
 * Pass --express to opt into CloudFormation express mode for faster
 * iteration; it is not enabled by default so deploys wait for full
 * resource stabilization.
 */
export function buildCdkCommand(
  action: string,
  remainingArgs: string[],
): string[] {
  const hasRequireApproval = remainingArgs.some(
    (a) => a === '--require-approval' || a.startsWith('--require-approval='),
  );
  const defaults = hasRequireApproval ? [] : ['--require-approval=never'];
  return ['cdk', action, ...defaults, ...remainingArgs];
}
