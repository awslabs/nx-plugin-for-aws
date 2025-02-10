import { initTRPC, TRPCError } from '@trpc/server';

export const createErrorPlugin = () => {
  const t = initTRPC.context().create();
  return t.procedure.use(async (opts) => {
    const response = await opts.next({
      ctx: {
        ...opts.ctx,
      },
    });

    if (!response.ok) {
      if (response.error instanceof TRPCError) {
        throw response.error;
      }

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred, please try again later.',
        cause: response.error,
      });
    }

    return response;
  });
};
