/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IPyDepVersion, ITsDepVersion } from './versions';

/**
 * Which vended dependencies each generator is responsible for.
 *
 * A generator declares every dependency it may add, including those added on its
 * behalf by helpers it calls, and passes the declaration to each helper. The
 * version sync migration reads the declarations of the generators a workspace has
 * run to decide which dependencies it owns — so a package the user added
 * themselves is left alone.
 *
 * Declaring is enforced two ways: `withVersions` only accepts declared packages
 * (a type error otherwise), and a helper's signature rejects a caller whose
 * declaration doesn't cover what the helper adds.
 */
export interface DependencyDeclaration<
  Ts extends readonly ITsDepVersion[] = readonly ITsDepVersion[],
  Py extends readonly IPyDepVersion[] = readonly IPyDepVersion[],
> {
  readonly ts: Ts;
  readonly py: Py;
}

/**
 * Declare the dependencies a generator owns. Spread the `*_DEPENDENCIES` of any
 * helper called, so the declaration covers what those helpers add too.
 */
export const declareDependencies = <
  const Ts extends readonly ITsDepVersion[] = [],
  const Py extends readonly IPyDepVersion[] = [],
>(declaration: {
  ts?: Ts;
  py?: Py;
}): DependencyDeclaration<Ts, Py> => ({
  ts: declaration.ts ?? ([] as unknown as Ts),
  py: declaration.py ?? ([] as unknown as Py),
});

/**
 * Requires a caller's declaration to cover `Needed`, naming whatever is missing
 * in the type error. Helpers that add dependencies take this alongside the
 * declaration so a forgotten spread can't compile.
 */
export type MustDeclare<
  Needed extends readonly ITsDepVersion[],
  D extends DependencyDeclaration,
> = [Exclude<Needed[number], D['ts'][number]>] extends [never]
  ? unknown
  : {
      __missingDeclaredDependencies: Exclude<Needed[number], D['ts'][number]>;
    };

/** `MustDeclare` for Python dependencies. */
export type MustDeclarePy<
  Needed extends readonly IPyDepVersion[],
  D extends DependencyDeclaration,
> = [Exclude<Needed[number], D['py'][number]>] extends [never]
  ? unknown
  : {
      __missingDeclaredPyDependencies: Exclude<Needed[number], D['py'][number]>;
    };

/**
 * The dependencies a declaration covers, for typing a conditional list without
 * widening it to every vended package.
 */
export type DeclaredTs<D extends DependencyDeclaration> = D['ts'][number];

/** `DeclaredTs` for Python dependencies. */
export type DeclaredPy<D extends DependencyDeclaration> = D['py'][number];

/**
 * Narrows a caller's declaration to the subset a helper adds, which
 * `MustDeclare` has already proven the caller covers.
 */
export const forDependencies = <
  const Ts extends readonly ITsDepVersion[] = [],
  const Py extends readonly IPyDepVersion[] = [],
>(
  declaration: DependencyDeclaration,
): DependencyDeclaration<Ts, Py> =>
  declaration as unknown as DependencyDeclaration<Ts, Py>;
