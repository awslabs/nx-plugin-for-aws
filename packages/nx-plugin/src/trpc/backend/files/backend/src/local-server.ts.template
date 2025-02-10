import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { appRouter } from './router.js';

const PORT = 2022;

createHTTPServer({
  router: appRouter,
  createContext() {
    return {
      event: {} as any,
      context: {} as any,
      info: {} as any,
    };
  },
}).listen(PORT);

console.log(`Local TRPC server listening on port ${PORT}`);
