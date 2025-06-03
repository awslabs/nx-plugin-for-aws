import { createGameEntity } from '../entities/game.js';
import { GameSchema, IGame } from '../schema/index.js';
import { publicProcedure } from '../init.js';

export const saveGame = publicProcedure
  .input(GameSchema.omit({ lastUpdated: true }))
  .output(GameSchema)
  .mutation(async ({ input, ctx }) => {
    const gameEntity = createGameEntity(ctx.dynamoDb);

    const result = await gameEntity.put(input).go();
    return result.data as IGame;
  });
