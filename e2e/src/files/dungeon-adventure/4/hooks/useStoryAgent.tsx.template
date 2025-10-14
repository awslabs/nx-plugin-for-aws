import { useAuth } from 'react-oidc-context';
import { useRuntimeConfig } from './useRuntimeConfig';
import { useMemo } from 'react';

export interface GenerateStoryInput {
  playerName: string;
  genre: string;
  actions: { role: string; content: string }[];
}

const generateSessionId = (playerName: string): string => {
  const targetLength = 34;
  const uuidLength = targetLength - playerName.length;

  const randomSegment = crypto
    .randomUUID()
    .replace(/-/g, '')
    .substring(0, uuidLength);

  return `${playerName}${randomSegment}`;
};

export const useStoryAgent = () => {
  const { agentArn } = useRuntimeConfig();
  const region = agentArn.split(':')[3];
  const url = `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodeURIComponent(agentArn)}/invocations?qualifier=DEFAULT`;

  const { user } = useAuth();

  return useMemo(
    () => ({
      generateStory: async function* (
        opts: GenerateStoryInput,
      ): AsyncIterableIterator<string> {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${user?.id_token}`,
            'Content-Type': 'application/json',
            'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': generateSessionId(
              opts.playerName,
            ),
          },
          method: 'POST',
          body: JSON.stringify(opts),
        });

        const reader = response.body
          ?.pipeThrough(new TextDecoderStream())
          .getReader();

        if (!reader) return;

        while (true) {
          const { value, done } = await reader.read();

          if (done) return;

          // Parse SSE format - each chunk may contain multiple events
          const lines = value.split('\n');

          for (const line of lines) {
            // SSE events start with "data: "
            if (line.startsWith('data: ')) {
              const data = line.slice(6); // Remove "data: " prefix

              try {
                const parsed = JSON.parse(data);

                // Extract text from contentBlockDelta events
                if (parsed.event?.contentBlockDelta?.delta?.text) {
                  yield parsed.event.contentBlockDelta.delta.text;
                }
                if (parsed.event?.messageStop) {
                  yield '\n';
                }
              } catch (e) {
                // Skip lines that aren't valid JSON (like Python debug output)
                continue;
              }
            }
          }
        }
      },
    }),
    [url, user?.id_token],
  );
};
