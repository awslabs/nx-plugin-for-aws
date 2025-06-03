import { z } from 'zod';

export const GameSchema = z.object({
  playerName: z.string(),
  genre: z.enum(['zombie', 'superhero', 'medieval']),
  lastUpdated: z.string().datetime(),
});

export type IGame = z.TypeOf<typeof GameSchema>;
