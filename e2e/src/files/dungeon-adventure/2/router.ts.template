import { t } from './init.js';
import { queryActions } from './procedures/actions.js';
import { queryGames, saveGame } from './procedures/games.js';
import { queryInventory } from './procedures/inventory.js';

export const router = t.router;

export const appRouter = router({
  actions: router({
    query: queryActions,
  }),
  games: router({
    query: queryGames,
    save: saveGame,
  }),
  inventory: router({
    query: queryInventory,
  }),
});

export type AppRouter = typeof appRouter;
