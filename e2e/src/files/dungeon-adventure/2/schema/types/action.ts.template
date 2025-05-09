import { z } from 'zod';

export const ActionSchema = z.object({
  playerName: z.string(),
  timestamp: z.string().datetime(),
  role: z.enum(['assistant', 'user']),
  content: z.string(),
});

export type IAction = z.TypeOf<typeof ActionSchema>;
