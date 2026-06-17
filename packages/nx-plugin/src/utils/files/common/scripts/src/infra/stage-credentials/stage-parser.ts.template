/**
 * Extracts the CDK stage name from the first positional argument.
 *
 * Examples:
 *   parseStageName('my-app-dev/*')  → 'my-app-dev'
 *   parseStageName('my-app-dev')    → 'my-app-dev'
 *   parseStageName('--verbose')     → undefined (flag, not a stage)
 *   parseStageName(undefined)       → undefined
 */
export function parseStageName(
  firstArg: string | undefined,
): string | undefined {
  if (!firstArg || firstArg.startsWith('-')) return undefined;
  return firstArg.includes('/') ? firstArg.split('/')[0] : firstArg;
}
