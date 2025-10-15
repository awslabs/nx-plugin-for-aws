import { z } from 'zod';

export const ItemSchema = z.object({
  playerName: z.string(),
  itemName: z.string(),
  emoji: z.string().optional(),
  lastUpdated: z.iso.datetime(),
  quantity: z.number(),
});

export type IItem = z.TypeOf<typeof ItemSchema>;
