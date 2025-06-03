import { ActionSchema, IAction } from '../schema/index.js';
import { publicProcedure } from '../init.js';
import { createActionEntity } from '../entities/action.js';
import { createGameEntity } from '../entities/game.js';

export const saveAction = publicProcedure
  .input(ActionSchema.omit({ timestamp: true }))
  .output(ActionSchema)
  .mutation(async ({ input, ctx }) => {
    const actionEntity = createActionEntity(ctx.dynamoDb);
    const gameEntity = createGameEntity(ctx.dynamoDb);

    const action = await actionEntity.put(input).go();
    await gameEntity
      .update({ playerName: input.playerName })
      .set({ lastUpdated: action.data.timestamp })
      .go();
    return action.data as IAction;
  });
