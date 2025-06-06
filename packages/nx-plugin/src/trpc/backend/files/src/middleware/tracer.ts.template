import { initTRPC } from '@trpc/server';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Subsegment } from 'aws-xray-sdk-core';

export interface ITracerContext {
  tracer?: Tracer;
}

export const createTracerPlugin = () => {
  const t = initTRPC.context<ITracerContext>().create();

  return t.procedure.use(async (opts) => {
    const tracer = new Tracer();
    const segment = tracer.getSegment();
    let handlerSegment: Subsegment | undefined;

    if (segment) {
      handlerSegment = segment.addNewSubsegment(`## ${opts.path}`);
      tracer.setSegment(handlerSegment);
    }

    tracer.annotateColdStart();
    tracer.addServiceNameAnnotation();

    try {
      const response = await opts.next({
        ctx: {
          ...opts.ctx,
          tracer,
        },
      });

      if (!response.ok && response.error.cause instanceof Error) {
        tracer.addErrorAsMetadata(response.error.cause);
      }
      return response;
    } finally {
      if (segment && handlerSegment) {
        handlerSegment.close();
        tracer.setSegment(segment);
      }
    }
  });
};
