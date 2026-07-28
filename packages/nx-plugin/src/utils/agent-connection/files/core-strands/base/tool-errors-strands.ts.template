import {
  AfterToolCallEvent,
  type LocalAgent,
  TextBlock,
} from '@strands-agents/sdk';

/** Logs tool execution errors, including the tool name and underlying error or message when available. */
export const logToolErrors = (agent: LocalAgent): void => {
  agent.addHook(AfterToolCallEvent, (event) => {
    if (event.result.status !== 'error') return;
    const error = event.result.error ?? event.error;
    const message =
      error?.message ??
      event.result.content
        .filter((block): block is TextBlock => block instanceof TextBlock)
        .map((block) => block.text)
        .join(' ');
    console.error(
      `Tool '${event.toolUse.name}' failed${message ? `: ${message}` : ''}`,
    );
  });
};
