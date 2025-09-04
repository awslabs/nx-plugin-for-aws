import { TRPCRouterRecord, AnyTRPCRouter } from '@trpc/server';
import { OperationDetails } from './utils.js';
import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';

/**
 * Helper type that recursively extracts procedure names from a tRPC router.
 * This type traverses the router structure and builds fully qualified procedure names
 * with dot notation for nested routers.
 *
 * @template T - The tRPC router record type
 * @template Prefix - The current path prefix for nested procedures
 */
type _Procedures<T extends TRPCRouterRecord, Prefix extends string = ''> = {
  [K in keyof T]: K extends string
    ? T[K] extends TRPCRouterRecord
      ? _Procedures<T[K], `${Prefix}${K}.`>
      : `${Prefix}${K}`
    : never;
}[keyof T];

/**
 * Extracts all procedure names from a tRPC router as a union of string literals.
 * This type is used to provide type-safe access to procedure names throughout the API.
 *
 * @template TRouter - The tRPC router type
 */
export type Procedures<TRouter extends AnyTRPCRouter> = _Procedures<
  TRouter['_def']['record']
>;

/**
 * Converts a tRPC router to a map of API operations.
 * This method recursively traverses the router structure and creates operation details
 * for each procedure, mapping queries to GET methods and mutations to POST methods.
 *
 * @param router - The tRPC router to convert
 * @param prefix - The current path prefix for nested procedures
 * @returns A map of procedure names to their API operation details
 */
export const routerToOperations = <TRouter extends AnyTRPCRouter>(
  router: TRouter,
  prefix = '',
): Record<Procedures<TRouter>, OperationDetails> => {
  return Object.fromEntries(
    Object.entries(router._def.procedures).flatMap(
      ([op, procedureOrRouter]: [string, any]) => {
        const fullPath = prefix ? `${prefix}.${op}` : op;
        return procedureOrRouter._def?.router
          ? Object.entries(
              routerToOperations<TRouter>(procedureOrRouter, fullPath),
            )
          : [
              [
                fullPath,
                {
                  path: fullPath,
                  method:
                    procedureOrRouter._def.type === 'query'
                      ? HttpMethod.GET
                      : HttpMethod.POST,
                },
              ],
            ];
      },
    ),
  ) as Record<Procedures<TRouter>, OperationDetails>;
};
