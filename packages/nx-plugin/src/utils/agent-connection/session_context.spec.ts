/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Behavioural tests for the Python session-context helpers vended into the
 * agent-connection project, mirroring `session-context.spec.ts` for TypeScript.
 * A silent regression here would reintroduce a cross-user data leak, so the
 * isolation rules are asserted directly rather than only through the generated
 * wiring.
 *
 * The template is exec'd in a Python subprocess, so these tests are skipped
 * where no interpreter is available.
 */
const TEMPLATE_PATH = join(
  import.meta.dirname,
  'files',
  'py-core-runtime-config',
  'session_context.py.template',
);

const hasPython = (): boolean => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** Run `body` against the helpers, returning whatever it prints as JSON. */
const runPython = (body: string): unknown => {
  const source = readFileSync(TEMPLATE_PATH, 'utf-8');
  // The template has no EJS tags, so it execs as-is.
  expect(source).not.toContain('<%');
  const script = [
    'import base64, json, types',
    `source = ${JSON.stringify(source)}`,
    'mod = types.ModuleType("sc")',
    'exec(compile(source, "session_context.py", "exec"), mod.__dict__)',
    'def encode_jwt(claims):',
    '    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")',
    '    return f"Bearer header.{payload}.signature"',
    body,
  ].join('\n');
  return JSON.parse(
    execFileSync('python3', ['-c', script], { encoding: 'utf-8' }),
  );
};

describe.skipIf(!hasPython())('agent-connection python session context', () => {
  it('should extract the sub claim', () => {
    expect(
      runPython(
        'print(json.dumps(mod.get_jwt_subject(encode_jwt({"sub": "alice-sub"}))))',
      ),
    ).toBe('alice-sub');
  });

  it('should accept a token without the Bearer prefix', () => {
    expect(
      runPython(
        'print(json.dumps(mod.get_jwt_subject(encode_jwt({"sub": "a"}).replace("Bearer ", ""))))',
      ),
    ).toBe('a');
  });

  it('should return None for absent, malformed or undecodable tokens', () => {
    expect(
      runPython(
        `print(json.dumps([
    mod.get_jwt_subject(None),
    mod.get_jwt_subject("Bearer not-a-jwt"),
    mod.get_jwt_subject("Bearer header.!!!.signature"),
    mod.get_jwt_subject(encode_jwt({"aud": "x"})),
    mod.get_jwt_subject(encode_jwt({"sub": ""})),
    mod.get_jwt_subject(encode_jwt({"sub": 42})),
]))`,
      ),
    ).toEqual([null, null, null, null, null, null]);
  });

  it('should namespace the key by the current user', () => {
    expect(
      runPython(
        `with mod.user_id_context("alice-sub"):
    print(json.dumps(mod.get_session_storage_key("thread")))`,
      ),
    ).toBe('u-alice_2dsub-thread');
  });

  it('should resolve different keys for two users sharing a session id', () => {
    const [alice, bob] = runPython(
      `with mod.user_id_context("alice-sub"):
    alice = mod.get_session_storage_key("shared-thread")
with mod.user_id_context("bob-sub"):
    bob = mod.get_session_storage_key("shared-thread")
print(json.dumps([alice, bob]))`,
    ) as string[];

    expect(alice).toBe('u-alice_2dsub-shared_2dthread');
    expect(bob).toBe('u-bob_2dsub-shared_2dthread');
    expect(alice).not.toBe(bob);
  });

  it('should prefer an explicitly passed user over the current one', () => {
    expect(
      runPython(
        `with mod.user_id_context("alice-sub"):
    print(json.dumps(mod.get_session_storage_key("thread", "bob-sub")))`,
      ),
    ).toBe('u-bob_2dsub-thread');
  });

  it('should not allow a session id to traverse out of its namespace', () => {
    const key = runPython(
      `with mod.user_id_context("alice-sub"):
    print(json.dumps(mod.get_session_storage_key("../../bob-sub/thread")))`,
    ) as string;

    // Strands rejects path separators in a session id.
    expect(key).toMatch(/^[a-z0-9_-]+$/);
    expect(key.startsWith('u-alice_2dsub-')).toBe(true);
  });

  it('should only emit characters Strands accepts for a session id', () => {
    expect(
      runPython(
        `with mod.user_id_context("Alice/Sub"):
    print(json.dumps(mod.get_session_storage_key("Thread/One")))`,
      ) as string,
    ).toMatch(/^[a-z0-9_-]+$/);
  });

  it('should keep namespaced and unnamespaced key spaces disjoint', () => {
    const [unnamespaced, namespaced] = runPython(
      `print(json.dumps([
    mod.get_session_storage_key("a-b"),
    mod.get_session_storage_key("b", "a"),
]))`,
    ) as string[];

    expect(unnamespaced).not.toBe(namespaced);
  });

  it('should encode astral-plane characters without collapsing them', () => {
    // A variable-width escape would map these two onto one key, and would also
    // diverge from the TypeScript implementation.
    const [emoji, lookalike] = runPython(
      `print(json.dumps([
    mod.get_session_storage_key("U0001F600"),
    mod.get_session_storage_key("\u1f600"),
]))`,
    ) as string[];

    expect(emoji).not.toBe(lookalike);
  });

  it('should encode distinct conversations to distinct keys', () => {
    const keys = runPython(
      `print(json.dumps([mod.get_session_storage_key(i) for i in ["abc", "abc0", "Abc", "a-b", "a--b", "a_b"]]))`,
    ) as string[];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('should refuse an empty user rather than silently unnamespacing', () => {
    // Otherwise a bug binding '' would share one namespace across all callers.
    expect(
      runPython(
        `try:
    mod.get_session_storage_key("thread", "")
    print(json.dumps("no-error"))
except ValueError as e:
    print(json.dumps("refused"))`,
      ),
    ).toBe('refused');
  });

  it('should fall back to an unnamespaced but sanitised key without a user', () => {
    // auth=iam has no verified caller identity available in the container.
    expect(
      runPython(
        `print(json.dumps([
    mod.get_session_storage_key("thread"),
    mod.get_session_storage_key("a/b"),
]))`,
      ),
    ).toEqual(['s-thread', 's-a_2fb']);
  });
});
