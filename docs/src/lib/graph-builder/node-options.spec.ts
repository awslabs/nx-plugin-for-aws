/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { nodeType } from './catalog';
import {
  effectiveNodeOptions,
  propertyApplies,
  propertyValueApplies,
  reconcileNodeOptions,
} from './node-options';

/**
 * The builder reads a schema's conditions the way the guides do, so a graph can
 * only hand over commands the generators accept.
 */
describe('conditional node options', () => {
  it('should leave an option a node type rules out off the type altogether', () => {
    // The Smithy namespace can never apply to a tRPC API: choosing the node type
    // answered `framework`.
    const trpc = nodeType('ts#trpc-api');
    const smithy = nodeType('ts#smithy-api');

    expect(trpc.properties.map((p) => p.name)).not.toContain('namespace');
    expect(smithy.properties.map((p) => p.name)).toContain('namespace');
  });

  it('should leave a value a node type rules out off its option', () => {
    // Smithy has no HTTP API integration, so its `infra` offers neither.
    const infra = nodeType('ts#smithy-api').properties.find(
      (p) => p.name === 'infra',
    );

    expect(infra?.enum).toEqual(['rest-lambda', 'none']);
    expect(
      nodeType('ts#trpc-api').properties.find((p) => p.name === 'infra')?.enum,
    ).toEqual(['rest-lambda', 'http-lambda', 'none']);
  });

  it('should read a condition against the values a run would use', () => {
    const gateway = nodeType('agentcore-gateway');
    const auth = gateway.properties.find((p) => p.name === 'auth');
    if (!auth) throw new Error('the gateway has no auth option');

    // Nothing chosen: `infra` falls back to hosting the gateway, so auth applies.
    expect(propertyApplies(auth, effectiveNodeOptions(gateway, {}))).toBe(true);
    // With no infrastructure there is nothing to authenticate.
    expect(
      propertyApplies(auth, effectiveNodeOptions(gateway, { infra: 'none' })),
    ).toBe(false);
  });

  it('should drop an option the rest of the values rule out', () => {
    const gateway = nodeType('agentcore-gateway');

    expect(
      reconcileNodeOptions(gateway, { infra: 'none', auth: 'cognito' }),
    ).toEqual({ infra: 'none' });
  });

  it('should keep an option that still applies', () => {
    const gateway = nodeType('agentcore-gateway');

    expect(
      reconcileNodeOptions(gateway, { infra: 'agentcore', auth: 'cognito' }),
    ).toEqual({ infra: 'agentcore', auth: 'cognito' });
  });

  it('should let go of a value another choice rules out', () => {
    const agent = nodeType('py#agent');
    const session = agent.properties.find((p) => p.name === 'session');
    if (!session) throw new Error('the agent has no session option');

    // Only the LangChain agent has a DynamoDB checkpointer to save to.
    expect(
      propertyValueApplies(
        session,
        'dynamodb-s3',
        effectiveNodeOptions(agent, { framework: 'langchain' }),
      ),
    ).toBe(true);
    expect(
      reconcileNodeOptions(agent, {
        framework: 'strands',
        session: 'dynamodb-s3',
      }),
    ).toEqual({ framework: 'strands' });
  });

  it('should name a value that applies where the fallback does not', () => {
    // Clearing Tailwind rules out shadcn, which a website falls back to, so the
    // command has to name a UX that doesn't need it.
    const website = nodeType('ts#react-website');
    const reconciled = reconcileNodeOptions(website, { tailwind: false });

    expect(reconciled.tailwind).toBe(false);
    expect(reconciled.ux).toBeDefined();
    expect(reconciled.ux).not.toBe('shadcn');
  });
});
