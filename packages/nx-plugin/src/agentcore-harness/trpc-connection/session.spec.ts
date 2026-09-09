/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// session.ts is pure (only node:crypto + a type-only aws-lambda import), so
// it's exercised directly against the generator's own template source —
// copied to a real .ts module alongside this spec purely so this file can
// import it (files/ is excluded from the plugin's own tsc build).
const templatePath = path.join(
  import.meta.dirname,
  'files',
  'agui',
  'session.ts.template',
);
const tempModulePath = path.join(
  import.meta.dirname,
  '.session.generated-for-test.ts',
);
fs.writeFileSync(tempModulePath, fs.readFileSync(templatePath, 'utf-8'));
afterAll(() => fs.rmSync(tempModulePath, { force: true }));

const { actorIdFromEvent, runtimeSessionIdFor } = await import(
  pathToFileURL(tempModulePath).href
);

const eventWithUserArn = (userArn: string | undefined) =>
  ({
    requestContext: { identity: { userArn } },
  }) as any;

const eventWithCognitoSub = (sub: string | undefined) =>
  ({
    requestContext: { authorizer: { claims: { sub } } },
  }) as any;

describe('actorIdFromEvent', () => {
  it('sanitizes an IAM principal ARN to the allowed charset', () => {
    // Bug #9: InvokeHarness rejects ':' and '/', which every ARN contains.
    const actorId = actorIdFromEvent(
      eventWithUserArn(
        'arn:aws:sts::123456789012:assumed-role/MyRole/session-name',
      ),
    );
    expect(actorId).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(actorId).not.toContain(':');
    expect(actorId).not.toContain('/');
  });

  it('falls back to "anonymous" when no principal ARN is present', () => {
    expect(actorIdFromEvent(eventWithUserArn(undefined))).toBe('anonymous');
  });

  it('derives the actor id from the validated JWT `sub` claim under a Cognito authorizer', () => {
    const actorId = actorIdFromEvent(
      eventWithCognitoSub('12345678-abcd-4321-abcd-1234567890ab'),
    );
    expect(actorId).toBe('12345678-abcd-4321-abcd-1234567890ab');
  });

  it('prefers the Cognito `sub` claim over an IAM principal ARN when both are present', () => {
    const event = {
      requestContext: {
        identity: { userArn: 'arn:aws:sts::123456789012:assumed-role/Foo/bar' },
        authorizer: { claims: { sub: 'cognito-sub-123' } },
      },
    } as any;
    expect(actorIdFromEvent(event)).toBe('cognito-sub-123');
  });

  it('falls back to "anonymous" when the authorizer context has no claims (e.g. a custom authorizer)', () => {
    const event = {
      requestContext: { authorizer: { principalId: 'some-custom-principal' } },
    } as any;
    expect(actorIdFromEvent(event)).toBe('anonymous');
  });

  it('falls back to "anonymous" when requestContext itself is absent, as in the local tRPC dev server\'s mock event', () => {
    expect(actorIdFromEvent({} as any)).toBe('anonymous');
  });
});

describe('runtimeSessionIdFor', () => {
  it('produces a valid AgentCore runtime session id', () => {
    const sessionId = runtimeSessionIdFor('actor-1', 'thread-1');
    expect(sessionId.length).toBeGreaterThanOrEqual(33);
    expect(sessionId).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
  });

  it('does not collapse distinct threads for a long actorId (bug #8)', () => {
    // A real IAM assumed-role ARN, sanitized, is easily >100 chars — long
    // enough that the old `${actorId}_${threadId}`.slice(0, 100) derivation
    // dropped the threadId suffix entirely, so every thread from the same
    // caller collapsed onto the same Memory session.
    const longActorId = 'a'.repeat(157);
    const sessionA = runtimeSessionIdFor(longActorId, 'thread-alpha');
    const sessionB = runtimeSessionIdFor(longActorId, 'thread-beta');

    expect(sessionA).not.toEqual(sessionB);
  });

  it('is deterministic for the same actorId/threadId pair', () => {
    expect(runtimeSessionIdFor('actor-1', 'thread-1')).toEqual(
      runtimeSessionIdFor('actor-1', 'thread-1'),
    );
  });
});
