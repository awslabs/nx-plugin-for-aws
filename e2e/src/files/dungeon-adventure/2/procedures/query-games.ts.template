import { createGameEntity } from '../entities/game.js';
import {
  GameSchema,
  IGame,
  QueryInputSchema,
  createPaginatedQueryOutput,
} from '../schema/index.js';
import { publicProcedure } from '../init.js';

export const queryGames = publicProcedure
  .input(QueryInputSchema)
  .output(createPaginatedQueryOutput(GameSchema))
  .query(async ({ input, ctx }) => {
    const gameEntity = createGameEntity(ctx.dynamoDb);
    const result = await gameEntity.scan.go({
      cursor: input.cursor,
      count: input.limit,
    });

    return {
      items: result.data as IGame[],
      cursor: result.cursor,
    };
  });
