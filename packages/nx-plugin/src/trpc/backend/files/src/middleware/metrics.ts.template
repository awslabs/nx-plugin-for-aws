import { initTRPC } from '@trpc/server';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

export interface IMetricsContext {
  metrics?: Metrics;
}

export const createMetricsPlugin = () => {
  const t = initTRPC.context<IMetricsContext>().create();

  return t.procedure.use(async (opts) => {
    const metrics = new Metrics();
    metrics.addDimensions({
      procedure: opts.path,
      type: opts.type,
    });
    metrics.captureColdStartMetric();
    metrics.addMetric('RequestCount', MetricUnit.Count, 1);

    try {
      const response = await opts.next({
        ctx: {
          ...opts.ctx,
          metrics,
        },
      });

      if (!response.ok) {
        metrics.addMetric('Failure', MetricUnit.Count, 1);
      } else {
        metrics.addMetric('Success', MetricUnit.Count, 1);
      }

      return response;
    } finally {
      metrics.publishStoredMetrics();
    }
  });
};
