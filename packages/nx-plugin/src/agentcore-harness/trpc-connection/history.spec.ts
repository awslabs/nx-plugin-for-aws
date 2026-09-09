/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-bedrock-agentcore', () => ({
  BedrockAgentCoreClient: class {
    send(cmd: unknown) {
      return sendMock(cmd);
    }
  },
  ListEventsCommand: class {
    constructor(public input: unknown) {}
  },
}));

// history.ts.template is otherwise pure (its only side effects are the
// mocked AWS SDK call and the tRPC procedure wrapper), so it's exercised
// directly against the generator's own template source, mirroring
// session.spec.ts / converse-to-agui.spec.ts. Its EJS `esm` conditionals are
// rendered away (esm: false) and its `../agui/session` / `../agui/runtime-config`
// / `../init` imports are pointed at local stubs standing in for the real
// session/runtime-config helpers and the real tRPC `publicProcedure` builder,
// since only the transformation logic in this file is under test here.
const dir = import.meta.dirname;
const sessionStubPath = path.join(
  dir,
  '.history.session-stub.generated-for-test.ts',
);
const runtimeConfigStubPath = path.join(
  dir,
  '.history.runtime-config-stub.generated-for-test.ts',
);
const initStubPath = path.join(dir, '.history.init-stub.generated-for-test.ts');
const tempModulePath = path.join(dir, '.history.generated-for-test.ts');

fs.writeFileSync(
  sessionStubPath,
  [
    'export function actorIdFromEvent(): string {',
    "  return 'actor-1';",
    '}',
    '',
    'export function runtimeSessionIdFor(): string {',
    "  return 'session-1';",
    '}',
    '',
  ].join('\n'),
);
fs.writeFileSync(
  runtimeConfigStubPath,
  [
    'export async function getHarnessConnection() {',
    "  return { harnessArn: 'harness-1', memoryArn: 'memory-1' };",
    '}',
    '',
  ].join('\n'),
);
fs.writeFileSync(
  initStubPath,
  [
    'export const publicProcedure = {',
    '  input: () => ({',
    '    output: () => ({',
    '      query: (handler: unknown) => handler,',
    '    }),',
    '  }),',
    '};',
    '',
  ].join('\n'),
);

const templatePath = path.join(
  dir,
  'files',
  'procedures',
  'history.ts.template',
);
const rendered = fs
  .readFileSync(templatePath, 'utf-8')
  .replace(/<% if \(esm\) \{ %>\.js<% \} %>/g, '')
  .replace("'../agui/session'", `'./${path.basename(sessionStubPath, '.ts')}'`)
  .replace(
    "'../agui/runtime-config'",
    `'./${path.basename(runtimeConfigStubPath, '.ts')}'`,
  )
  .replace("'../init'", `'./${path.basename(initStubPath, '.ts')}'`);
fs.writeFileSync(tempModulePath, rendered);

afterAll(() => {
  for (const p of [
    sessionStubPath,
    runtimeConfigStubPath,
    initStubPath,
    tempModulePath,
  ]) {
    fs.rmSync(p, { force: true });
  }
});

const { history } = await import(pathToFileURL(tempModulePath).href);

function conversationalEvent(
  role: 'USER' | 'ASSISTANT',
  timestamp: number,
  parts: unknown[],
) {
  return {
    eventTimestamp: new Date(timestamp),
    payload: [
      {
        conversational: {
          role,
          content: { text: JSON.stringify({ message: { content: parts } }) },
        },
      },
    ],
  };
}

async function callHistory() {
  return history({
    input: { threadId: 'thread-1' },
    ctx: { event: {} },
  });
}

describe('history', () => {
  it('reconstructs a plain-text conversation, oldest-to-newest regardless of event order', async () => {
    sendMock.mockResolvedValueOnce({
      events: [
        // most-recent-first, as ListEvents actually returns them
        conversationalEvent('ASSISTANT', 2000, [{ text: 'hi there' }]),
        conversationalEvent('USER', 1000, [{ text: 'hello' }]),
      ],
    });

    const { messages } = await callHistory();

    expect(messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  it('reconstructs a full tool exchange with linked ids: user -> assistant toolUse -> user toolResult -> assistant text', async () => {
    sendMock.mockResolvedValueOnce({
      events: [
        conversationalEvent('ASSISTANT', 4000, [
          { text: "It's 72F and sunny in Seattle." },
        ]),
        conversationalEvent('USER', 3000, [
          {
            toolResult: {
              toolUseId: 'tool-1',
              status: 'success',
              content: [{ text: '72F and sunny' }],
            },
          },
        ]),
        conversationalEvent('ASSISTANT', 2000, [
          {
            toolUse: {
              toolUseId: 'tool-1',
              name: 'get_weather',
              input: { city: 'Seattle' },
            },
          },
        ]),
        conversationalEvent('USER', 1000, [
          { text: "What's the weather in Seattle?" },
        ]),
      ],
    });

    const { messages } = await callHistory();

    expect(messages).toEqual([
      { role: 'user', content: "What's the weather in Seattle?" },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'tool-1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Seattle"}' },
          },
        ],
      },
      { role: 'tool', content: '72F and sunny', toolCallId: 'tool-1' },
      { role: 'assistant', content: "It's 72F and sunny in Seattle." },
    ]);

    // The tool call and its result must link via the same id so an AG-UI
    // client can render the tool-call chip alongside its result.
    const assistantToolCallMessage = messages[1];
    const toolResultMessage = messages[2];
    expect(assistantToolCallMessage.toolCalls[0].id).toEqual(
      toolResultMessage.toolCallId,
    );
  });

  it('combines text and toolUse blocks from the same assistant turn into one message', async () => {
    sendMock.mockResolvedValueOnce({
      events: [
        conversationalEvent('ASSISTANT', 1000, [
          { text: 'Let me check that for you.' },
          {
            toolUse: {
              toolUseId: 'tool-2',
              name: 'get_weather',
              input: { city: 'Perth' },
            },
          },
        ]),
      ],
    });

    const { messages } = await callHistory();

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: 'Let me check that for you.',
        toolCalls: [
          {
            id: 'tool-2',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Perth"}' },
          },
        ],
      },
    ]);
  });
});
