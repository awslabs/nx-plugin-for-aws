/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * Behavioural tests for the session-context helpers vended into the
 * agent-connection project. The generator specs assert that agents are wired to
 * these functions; this asserts the functions themselves enforce isolation,
 * since a silent regression here would reintroduce a cross-user data leak.
 */
interface SessionContextModule {
  getJwtSubject: (header: string | undefined) => string | undefined;
  getSessionStorageKey: (sessionId: string, userId?: string) => string;
  runWithUserId: <T>(userId: string, callback: () => T) => T;
}

const loadSessionContext = (): SessionContextModule => {
  const templatePath = join(
    import.meta.dirname,
    'files',
    'core-runtime-config',
    'session-context.ts.template',
  );
  // The template has no EJS tags, so it compiles as-is.
  const source = readFileSync(templatePath, 'utf-8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} as SessionContextModule };
  new Function('exports', 'require', 'module', outputText)(
    module.exports,
    require,
    module,
  );
  return module.exports;
};

describe('agent-connection session context', () => {
  const { getJwtSubject, getSessionStorageKey, runWithUserId } =
    loadSessionContext();

  const encodeJwt = (claims: Record<string, unknown>): string =>
    `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

  describe('getJwtSubject', () => {
    it('should extract the sub claim', () => {
      expect(getJwtSubject(`Bearer ${encodeJwt({ sub: 'alice-sub' })}`)).toBe(
        'alice-sub',
      );
    });

    it('should accept a token without the Bearer prefix', () => {
      expect(getJwtSubject(encodeJwt({ sub: 'alice-sub' }))).toBe('alice-sub');
    });

    it.each([
      ['no header', undefined],
      ['a malformed token', 'Bearer not-a-jwt'],
      ['an undecodable payload', 'Bearer header.!!!not-base64!!!.signature'],
    ])('should return undefined for %s', (_case, header) => {
      expect(getJwtSubject(header)).toBeUndefined();
    });

    it.each([
      ['absent', {}],
      ['empty', { sub: '' }],
      ['not a string', { sub: 42 }],
    ])('should return undefined when sub is %s', (_case, claims) => {
      expect(getJwtSubject(`Bearer ${encodeJwt(claims)}`)).toBeUndefined();
    });
  });

  describe('getSessionStorageKey', () => {
    it('should namespace the key by the current user', () => {
      expect(
        runWithUserId('alice-sub', () => getSessionStorageKey('thread')),
      ).toBe('u-alice_2dsub-thread');
    });

    it('should only emit characters Strands accepts for a session id', () => {
      // Strands validates session ids against /^[a-z0-9_-]+$/, which excludes
      // uppercase and path separators.
      const key = runWithUserId('Alice/Sub', () =>
        getSessionStorageKey('Thread/One'),
      );

      expect(key).toMatch(/^[a-z0-9_-]+$/);
    });

    it('should encode distinct conversations to distinct keys', () => {
      // The client pads short thread ids, so near-identical ids are common.
      const keys = ['abc', 'abc0', 'Abc', 'a-b', 'a--b', 'a_b'].map((id) =>
        getSessionStorageKey(id),
      );

      expect(new Set(keys).size).toBe(keys.length);
    });

    it('should not let a session id forge another namespace', () => {
      const alice = runWithUserId('a-b', () => getSessionStorageKey('c'));
      const forged = runWithUserId('a', () => getSessionStorageKey('b--c'));

      expect(alice).not.toBe(forged);
    });

    it('should resolve different keys for two users sharing a session id', () => {
      const alice = runWithUserId('alice-sub', () =>
        getSessionStorageKey('shared-thread'),
      );
      const bob = runWithUserId('bob-sub', () =>
        getSessionStorageKey('shared-thread'),
      );

      expect(alice).not.toBe(bob);
    });

    it('should prefer an explicitly passed user over the current one', () => {
      expect(
        runWithUserId('alice-sub', () =>
          getSessionStorageKey('thread', 'bob-sub'),
        ),
      ).toBe('u-bob_2dsub-thread');
    });

    it('should not allow a session id to traverse out of its namespace', () => {
      const key = runWithUserId('alice-sub', () =>
        getSessionStorageKey('../../bob-sub/thread'),
      );

      expect(key).toMatch(/^[a-z0-9_-]+$/);
      expect(key.startsWith('u-alice_2dsub-')).toBe(true);
    });

    it('should encode the user id too', () => {
      expect(getSessionStorageKey('thread', 'a/b')).toMatch(/^[a-z0-9_-]+$/);
    });

    it('should refuse an empty user rather than silently unnamespacing', () => {
      // Otherwise a bug binding '' would share one namespace across all callers.
      expect(() => getSessionStorageKey('thread', '')).toThrow(
        /refusing to resolve an unnamespaced storage key/,
      );
    });

    it('should fall back to an unnamespaced key when no user is bound', () => {
      // auth=iam has no verified caller identity available in the container.
      expect(getSessionStorageKey('thread')).toBe('s-thread');
    });

    it('should keep namespaced and unnamespaced key spaces disjoint', () => {
      // Otherwise a crafted conversation id could land on a namespaced key.
      const unnamespaced = getSessionStorageKey('a-b');
      const namespaced = runWithUserId('a', () => getSessionStorageKey('b'));

      expect(unnamespaced).not.toBe(namespaced);
    });

    it('should encode astral-plane characters without collapsing them', () => {
      // A variable-width escape would map these two onto one key.
      expect(getSessionStorageKey('\u{1F600}')).not.toBe(
        getSessionStorageKey('\u{1F60}0'),
      );
    });

    it('should still encode when unnamespaced', () => {
      expect(getSessionStorageKey('a/b')).toMatch(/^[a-z0-9_-]+$/);
    });
  });
});
