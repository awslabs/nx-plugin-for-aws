import { createActionEntity } from '../entities/action.js';
import {
  ActionSchema,
  IAction,
  QueryInputSchema,
  createPaginatedQueryOutput,
} from ':dungeon-adventure/game-api-schema';
import { publicProcedure } from '../init.js';
import { z } from 'zod';

export const queryActions = publicProcedure
  .input(QueryInputSchema.extend({ playerName: z.string() }))
  .output(createPaginatedQueryOutput(ActionSchema))
  .query(async ({ input, ctx }) => {
    const actionEntity = createActionEntity(ctx.dynamoDb);
    const result = await actionEntity.query
      .primary({ playerName: input.playerName })
      .go({ cursor: input.cursor, count: input.limit });

    return {
      items: result.data as IAction[],
      cursor: result.cursor,
    };
  });
