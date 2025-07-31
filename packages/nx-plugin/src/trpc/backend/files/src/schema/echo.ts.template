import { z } from 'zod';

export const EchoInputSchema = z.object({
  message: z.string(),
});

export type IEchoInput = z.TypeOf<typeof EchoInputSchema>;

export const EchoOutputSchema = z.object({
  result: z.string(),
});

export type IEchoOutput = z.TypeOf<typeof EchoOutputSchema>;
