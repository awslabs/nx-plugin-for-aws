import { publicProcedure, t } from './init.js';
import { z } from 'zod';
import { zAsyncIterable } from './schema/z-async-iterable.js';
import { getAgent } from './agent.js';

export const router = t.router;

export const appRouter = router({
  invoke: publicProcedure
    .input(z.object({ message: z.string() }))
    .output(
      zAsyncIterable({
        yield: z.string(),
        tracked: false,
      }),
    )
    .subscription(async function* (opts) {
      const agent = await getAgent(opts.ctx.sessionId);

      for await (const event of agent.stream(opts.input.message)) {
        if (
          event.type === 'modelStreamUpdateEvent' &&
          event.event.type === 'modelContentBlockDeltaEvent' &&
          event.event.delta.type === 'textDelta'
        ) {
          yield event.event.delta.text;
        } else if (event.type === 'modelMessageEvent') {
          yield '\n';
        }
      }
      return;
    }),
});

export type AppRouter = typeof appRouter;
