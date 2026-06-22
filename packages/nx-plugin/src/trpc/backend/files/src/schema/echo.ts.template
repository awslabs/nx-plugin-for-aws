import { z } from 'zod';

export const EchoInputSchema = z.object({
  message: z.string().max(1024),
});

export type IEchoInput = z.TypeOf<typeof EchoInputSchema>;

export const EchoOutputSchema = z.object({
  message: z.string().max(1024),
});

export type IEchoOutput = z.TypeOf<typeof EchoOutputSchema>;
