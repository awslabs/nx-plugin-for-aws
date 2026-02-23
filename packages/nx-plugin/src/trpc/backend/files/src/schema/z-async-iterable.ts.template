import { isTrackedEnvelope, tracked, type TrackedEnvelope } from '@trpc/server';
import { z } from 'zod';

function isAsyncIterable<TValue, TReturn = unknown>(
  value: unknown,
): value is AsyncIterable<TValue, TReturn> {
  return !!value && typeof value === 'object' && Symbol.asyncIterator in value;
}

/**
 * A Zod schema helper designed specifically for validating async iterables. This schema ensures that:
 * 1. The value being validated is an async iterable.
 * 2. Each item yielded by the async iterable conforms to a specified type.
 * 3. The return value of the async iterable, if any, also conforms to a specified type.
 */

// Non-tracked overload
export function ZodAsyncIterable<
  TYieldIn,
  TYieldOut,
  TReturnIn = void,
  TReturnOut = void,
>(opts: {
  yield: z.ZodType<TYieldOut, TYieldIn>;
  return?: z.ZodType<TReturnOut, TReturnIn>;
  tracked?: false;
}): z.ZodPipe<
  z.ZodCustom<
    AsyncIterable<TYieldIn, TReturnIn>,
    AsyncIterable<TYieldIn, TReturnIn>
  >,
  z.ZodTransform<
    AsyncGenerator<
      Awaited<TYieldOut>,
      Awaited<TReturnOut> | undefined,
      unknown
    >,
    AsyncIterable<TYieldIn, TReturnIn>
  >
>;

// Tracked overload
export function ZodAsyncIterable<
  TYieldIn,
  TYieldOut,
  TReturnIn = void,
  TReturnOut = void,
>(opts: {
  yield: z.ZodType<TYieldOut, TYieldIn>;
  return?: z.ZodType<TReturnOut, TReturnIn>;
  tracked: true;
}): z.ZodPipe<
  z.ZodCustom<
    AsyncIterable<TrackedEnvelope<TYieldIn>, TReturnIn>,
    AsyncIterable<TrackedEnvelope<TYieldIn>, TReturnIn>
  >,
  z.ZodTransform<
    AsyncGenerator<
      TrackedEnvelope<Awaited<TYieldOut>>,
      Awaited<TReturnOut> | undefined,
      unknown
    >,
    AsyncIterable<TrackedEnvelope<TYieldIn>, TReturnIn>
  >
>;

// Implementation
export function ZodAsyncIterable<
  TYieldIn,
  TYieldOut,
  TReturnIn = void,
  TReturnOut = void,
>(opts: {
  /**
   * Validate the value yielded by the async generator
   */
  yield: z.ZodType<TYieldOut, TYieldIn>;
  /**
   * Validate the return value of the async generator
   * @remark not applicable for subscriptions
   */
  return?: z.ZodType<TReturnOut, TReturnIn>;
  /**
   * Whether if the yielded values are tracked
   * @remark only applicable for subscriptions
   */
  tracked?: boolean;
}) {
  return z
    .custom<AsyncIterable<TYieldIn | TrackedEnvelope<TYieldIn>, TReturnIn>>(
      (val) => isAsyncIterable(val),
    )
    .transform(async function* (iter) {
      const iterator = iter[Symbol.asyncIterator]();
      try {
        let next;
        while ((next = await iterator.next()) && !next.done) {
          if (opts.tracked) {
            const [id, data] = z
              .custom<TrackedEnvelope<unknown>>(isTrackedEnvelope)
              .parse(next.value);
            yield tracked(id, await opts.yield.parseAsync(data));
            continue;
          }
          yield opts.yield.parseAsync(next.value);
        }
        if (opts.return) {
          return await opts.return.parseAsync(next.value);
        }
        return;
      } finally {
        await iterator.return?.();
      }
    });
}
