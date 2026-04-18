import { Agent, tool } from '@strands-agents/sdk';
import { z } from 'zod';

const multiply = tool({
  name: 'Multiply',
  description: 'Multiply two numbers',
  inputSchema: z.object({
    a: z.number(),
    b: z.number(),
  }),
  callback: ({ a, b }) => a * b,
});

export const getAgent = async (sessionId: string) => {
  console.log(`Creating agent for session ${sessionId}`);
  return new Agent({
    systemPrompt: `You are a mathematical wizard.
  Use your tools for mathematical tasks.
  Refer to tools as your 'spellbook'.`,
    tools: [multiply],
  });
};
