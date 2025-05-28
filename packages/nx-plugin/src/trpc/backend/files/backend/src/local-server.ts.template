import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { appRouter } from './router.js';
import cors from 'cors';

const PORT = 2022;

createHTTPServer({
  router: appRouter,
  middleware: cors(),
  createContext() {
    return {
      event: {} as any,
      context: {} as any,
      info: {} as any,
    };
  },
}).listen(PORT);

console.log(`Local TRPC server listening on port ${PORT}`);
