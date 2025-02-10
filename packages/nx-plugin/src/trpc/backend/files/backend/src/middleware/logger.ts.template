import { initTRPC } from '@trpc/server';
import { Logger } from '@aws-lambda-powertools/logger';

export interface ILoggerContext {
  logger?: Logger;
}

export const createLoggerPlugin = () => {
  const t = initTRPC.context<ILoggerContext>().create();
  return t.procedure.use(async (opts) => {
    const logger = new Logger();

    const response = await opts.next({
      ctx: {
        ...opts.ctx,
        logger,
      },
    });

    if (!response.ok) {
      logger.error('Unexpected error occured', response.error.cause ?? '');
    }

    return response;
  });
};
