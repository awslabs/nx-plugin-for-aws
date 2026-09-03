/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventType } from '@ag-ui/core';
import type { InvokeHarnessStreamOutput } from '@aws-sdk/client-bedrock-agentcore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// The mapper is pure (no CDK/Lambda dependencies), so it's exercised directly
// against the generator's own template source — copied to a real .ts module
// alongside this spec (rather than under files/, which is excluded from the
// plugin's own tsc build) purely so this file can import it.
const templatePath = path.join(
  import.meta.dirname,
  'files',
  'agui',
  'converse-to-agui.ts.template',
);
const tempModulePath = path.join(
  import.meta.dirname,
  '.converse-to-agui.generated-for-test.ts',
);
fs.writeFileSync(tempModulePath, fs.readFileSync(templatePath, 'utf-8'));
afterAll(() => fs.rmSync(tempModulePath, { force: true }));

const { mapHarnessStreamToAgui, toHarnessMessages } = await import(
  pathToFileURL(tempModulePath).href
);

async function* chunks(events: InvokeHarnessStreamOutput[]) {
  for (const event of events) yield event;
}

describe('toHarnessMessages', () => {
  it('forwards only the newest user message as text', () => {
    const messages = toHarnessMessages([
      { id: '1', role: 'user', content: 'hello' },
      { id: '2', role: 'assistant', content: 'hi there' },
      { id: '3', role: 'user', content: 'how are you' },
    ] as never);
    expect(messages).toEqual([
      { role: 'user', content: [{ text: 'how are you' }] },
    ]);
  });

  it('throws when the last message is not from the user', () => {
    expect(() =>
      toHarnessMessages([
        { id: '1', role: 'user', content: 'hello' },
        { id: '2', role: 'assistant', content: 'hi there' },
      ] as never),
    ).toThrow(/last message/);
  });
});

describe('mapHarnessStreamToAgui', () => {
  it('maps assistant text deltas to TEXT_MESSAGE_* framed by RUN_STARTED/RUN_FINISHED', async () => {
    const events: InvokeHarnessStreamOutput[] = [
      { messageStart: { role: 'assistant' } } as InvokeHarnessStreamOutput,
      {
        contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'Hel' } },
      } as InvokeHarnessStreamOutput,
      {
        contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'lo!' } },
      } as InvokeHarnessStreamOutput,
      {
        contentBlockStop: { contentBlockIndex: 0 },
      } as InvokeHarnessStreamOutput,
      { messageStop: {} } as InvokeHarnessStreamOutput,
    ];

    const out = [];
    for await (const e of mapHarnessStreamToAgui(chunks(events), {
      threadId: 't1',
      runId: 'r1',
    }))
      out.push(e);

    expect(out[0]).toMatchObject({
      type: EventType.RUN_STARTED,
      threadId: 't1',
      runId: 'r1',
    });
    expect(out[1]).toMatchObject({
      type: EventType.TEXT_MESSAGE_START,
      role: 'assistant',
    });
    expect(out[2]).toMatchObject({
      type: EventType.TEXT_MESSAGE_CONTENT,
      delta: 'Hel',
    });
    expect(out[3]).toMatchObject({
      type: EventType.TEXT_MESSAGE_CONTENT,
      delta: 'lo!',
    });
    expect(out[4]).toMatchObject({ type: EventType.TEXT_MESSAGE_END });
    expect(out[5]).toMatchObject({
      type: EventType.RUN_FINISHED,
      threadId: 't1',
      runId: 'r1',
    });
  });

  it('maps tool-use content blocks to TOOL_CALL_*', async () => {
    const events: InvokeHarnessStreamOutput[] = [
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { toolUseId: 'tool-1', name: 'get_weather' } },
        },
      } as InvokeHarnessStreamOutput,
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: '{"city":"Sea' } },
        },
      } as InvokeHarnessStreamOutput,
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: 'ttle"}' } },
        },
      } as InvokeHarnessStreamOutput,
      {
        contentBlockStop: { contentBlockIndex: 0 },
      } as InvokeHarnessStreamOutput,
    ];

    const out = [];
    for await (const e of mapHarnessStreamToAgui(chunks(events), {
      threadId: 't1',
      runId: 'r1',
    }))
      out.push(e);

    expect(out).toContainEqual(
      expect.objectContaining({
        type: EventType.TOOL_CALL_START,
        toolCallId: 'tool-1',
        toolCallName: 'get_weather',
      }),
    );
    expect(out).toContainEqual(
      expect.objectContaining({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: 'tool-1',
        delta: '{"city":"Sea',
      }),
    );
    expect(out).toContainEqual(
      expect.objectContaining({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: 'tool-1',
        delta: 'ttle"}',
      }),
    );
    expect(out).toContainEqual(
      expect.objectContaining({
        type: EventType.TOOL_CALL_END,
        toolCallId: 'tool-1',
      }),
    );
  });
});
