import { AsyncLocalStorage } from 'node:async_hooks';

const sessionStorage = new AsyncLocalStorage<string>();

/** Run `callback` with `sessionId` as the current session. */
export const runWithSessionId = <T>(sessionId: string, callback: () => T): T =>
  sessionStorage.run(sessionId, callback);

/**
 * Bind `sessionId` onto the current async flow.
 *
 * Use from inside async generators (e.g. tRPC subscriptions), where the
 * generator is iterated outside any `run()` callback.
 */
export const enterSessionContext = (sessionId: string): void => {
  sessionStorage.enterWith(sessionId);
};

/** The session ID for the current async scope, or `undefined`. */
export const getCurrentSessionId = (): string | undefined =>
  sessionStorage.getStore();
