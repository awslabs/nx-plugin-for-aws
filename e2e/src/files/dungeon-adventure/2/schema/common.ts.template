import { z } from 'zod';

export const QueryInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().optional().default(100),
});

export const createPaginatedQueryOutput = <ItemType extends z.ZodTypeAny>(
  itemSchema: ItemType,
) => {
  return z.object({
    items: z.array(itemSchema),
    cursor: z.string().nullable(),
  });
};

export type IQueryInput = z.TypeOf<typeof QueryInputSchema>;
