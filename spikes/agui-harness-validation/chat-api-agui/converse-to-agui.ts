/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { BaseEvent } from '@ag-ui/core';
import { EventType } from '@ag-ui/core';
import type {
  HarnessMessage,
  InvokeHarnessStreamOutput,
} from '@aws-sdk/client-bedrock-agentcore';
import type { RunAgentInput } from '@ag-ui/core';

/**
 * Builds the single Harness message to forward for this turn. The Harness owns
 * conversation continuity via `runtimeSessionId`, so only the newest user
 * message is sent — the full `RunAgentInput.messages` history is the client's
 * local thread state, not what should be replayed to the Harness.
 */
export function toHarnessMessages(
  messages: RunAgentInput['messages'],
): HarnessMessage[] {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') {
    throw new Error(
      'Expected the last message in RunAgentInput to be a user message',
    );
  }
  const text =
    typeof last.content === 'string'
      ? last.content
      : (last.content ?? [])
          .filter(
            (block): block is { type: 'text'; text: string } =>
              block.type === 'text',
          )
          .map((block) => block.text)
          .join('\n');
  return [{ role: 'user', content: [{ text }] }];
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}

/**
 * Maps the Harness's `InvokeHarness` stream (Converse-shaped events) to AG-UI
 * events. Assistant text becomes TEXT_MESSAGE_*; tool-use content blocks
 * become TOOL_CALL_* (contentBlockStart.toolUse -> TOOL_CALL_START,
 * contentBlockDelta.toolUse.input -> TOOL_CALL_ARGS, contentBlockStop ->
 * TOOL_CALL_END). Unrecognised event members (metadata, exceptions) are
 * skipped rather than surfaced as AG-UI events.
 */
export async function* mapHarnessStreamToAgui(
  stream: AsyncIterable<InvokeHarnessStreamOutput>,
  ctx: { threadId: string; runId: string },
): AsyncGenerator<BaseEvent> {
  yield {
    type: EventType.RUN_STARTED,
    threadId: ctx.threadId,
    runId: ctx.runId,
  } as BaseEvent;

  let textMessageId: string | undefined;
  // contentBlockIndex -> the AG-UI toolCallId minted for that block.
  const toolCallIdByBlockIndex = new Map<number, string>();

  try {
    for await (const event of stream) {
      if (
        event.contentBlockStart?.start &&
        'toolUse' in event.contentBlockStart.start &&
        event.contentBlockStart.start.toolUse
      ) {
        const { toolUseId, name } = event.contentBlockStart.start.toolUse;
        const toolCallId = toolUseId ?? nextId('tool');
        toolCallIdByBlockIndex.set(
          event.contentBlockStart.contentBlockIndex ?? 0,
          toolCallId,
        );
        yield {
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: name ?? 'unknown',
        } as BaseEvent;
        continue;
      }

      const delta = event.contentBlockDelta?.delta;
      if (delta && 'text' in delta && delta.text !== undefined) {
        if (!textMessageId) {
          textMessageId = nextId('msg');
          yield {
            type: EventType.TEXT_MESSAGE_START,
            messageId: textMessageId,
            role: 'assistant',
          } as BaseEvent;
        }
        yield {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: textMessageId,
          delta: delta.text,
        } as BaseEvent;
        continue;
      }

      if (delta && 'toolUse' in delta && delta.toolUse) {
        const toolCallId = toolCallIdByBlockIndex.get(
          event.contentBlockDelta?.contentBlockIndex ?? 0,
        );
        if (toolCallId) {
          yield {
            type: EventType.TOOL_CALL_ARGS,
            toolCallId,
            delta: delta.toolUse.input ?? '',
          } as BaseEvent;
        }
        continue;
      }

      if (event.contentBlockStop) {
        const toolCallId = toolCallIdByBlockIndex.get(
          event.contentBlockStop.contentBlockIndex ?? 0,
        );
        if (toolCallId) {
          yield { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent;
          toolCallIdByBlockIndex.delete(
            event.contentBlockStop.contentBlockIndex ?? 0,
          );
        }
        continue;
      }
      // messageStart / messageStop / metadata / exceptions: no AG-UI equivalent, skipped.
    }
  } finally {
    if (textMessageId) {
      yield {
        type: EventType.TEXT_MESSAGE_END,
        messageId: textMessageId,
      } as BaseEvent;
    }
  }

  yield {
    type: EventType.RUN_FINISHED,
    threadId: ctx.threadId,
    runId: ctx.runId,
  } as BaseEvent;
}
