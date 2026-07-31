/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IPyDepVersion, ITsDepVersion } from './versions';

/**
 * Which vended dependencies each generator is responsible for, and when each
 * applies.
 *
 * A generator declares every dependency it may add — including those added on
 * its behalf by helpers it calls — once, and `addTsDependencies` /
 * `addPyDependencies` add the subset whose `when` predicate the generator's
 * metadata satisfies. The declaration is the only place packages are listed.
 *
 * The same declaration drives the version sync migration, which replays the
 * predicates against the metadata recorded on each project. Pass the very object
 * you record as metadata, so what a generator added and what the migration owns
 * cannot drift.
 */

/**
 * The metadata a generator records, which its predicates read. Deliberately
 * `object` rather than an index signature, so a generator can type its
 * declaration against a plain interface.
 */
export type DependencyMetadata = object;

/** A declared dependency, optionally limited to when its predicate holds. */
export interface DeclaredDependency<Name, M extends DependencyMetadata> {
  readonly name: Name;
  /**
   * Whether this dependency applies. Reads the metadata the generator records,
   * so the migration can evaluate the same predicate later.
   */
  readonly when?: (metadata: M) => boolean;
  /** Added as a dev dependency rather than a runtime one. */
  readonly dev?: boolean;
  /** Added to the workspace root manifest rather than the project's. */
  readonly root?: boolean;
  /** Added to this pyproject dependency group rather than the main list. */
  readonly group?: string;
  /**
   * Declared only so the version sync keeps its pinned version current — an
   * `overrides` entry, say. Never installed as a dependency.
   */
  readonly versionOnly?: boolean;
}

export interface DependencyDeclaration<
  Ts extends readonly DeclaredDependency<
    ITsDepVersion,
    never
  >[] = readonly DeclaredDependency<ITsDepVersion, never>[],
  Py extends readonly DeclaredDependency<
    IPyDepVersion,
    never
  >[] = readonly DeclaredDependency<IPyDepVersion, never>[],
> {
  readonly ts: Ts;
  readonly py: Py;
}

/**
 * Declare the dependencies a generator owns, typed against the metadata it
 * records. Spread the `*_DEPENDENCIES` of any helper called, so the declaration
 * covers what those helpers add too.
 */
export const declareDependencies =
  <M extends DependencyMetadata = Record<string, never>>() =>
  <
    const Ts extends readonly DeclaredDependency<ITsDepVersion, M>[],
    const Py extends readonly DeclaredDependency<IPyDepVersion, M>[],
  >(declaration: {
    ts?: Ts;
    py?: Py;
  }): DependencyDeclaration<Ts, Py> =>
    ({
      ts: declaration.ts ?? [],
      py: declaration.py ?? [],
    }) as unknown as DependencyDeclaration<Ts, Py>;

/**
 * Narrow entries to a further condition, keeping the one each already carries.
 *
 * For a helper's constant spread into a generator that calls it down one branch:
 * the branch gates the whole set, and each entry's own predicate still gates it
 * within that branch. Replacing `when` outright would widen ownership to the
 * helper's every branch.
 */
export const onlyWhen = <
  M extends DependencyMetadata,
  const Entries extends readonly { readonly name: unknown }[],
>(
  entries: Entries,
  condition: (metadata: M) => boolean,
): {
  readonly [K in keyof Entries]: Omit<Entries[K], 'when'> & {
    when: (m: M) => boolean;
  };
} =>
  entries.map((entry) => {
    // A declaration erases the metadata its predicates read, so calling one back
    // requires naming the type the caller narrows to.
    const own = (entry as { when?: (m: M) => boolean }).when;
    return {
      ...entry,
      when: (metadata: M) => condition(metadata) && (own?.(metadata) ?? true),
    };
  }) as never;

/**
 * Mark entries as declared for ownership but never installed here — a helper's
 * constant spread into a generator that doesn't own the project the helper adds
 * them to.
 */
export const ownedElsewhere = <const Entries extends readonly unknown[]>(
  entries: Entries,
): { readonly [K in keyof Entries]: Entries[K] & { versionOnly: true } } =>
  entries.map((entry) => ({
    ...(entry as object),
    versionOnly: true,
  })) as never;

/** Every package a declaration names, whatever its predicate. */
export const declaredNames = <Name>(
  entries: readonly { readonly name: Name }[],
): Name[] => entries.map((entry) => entry.name);

/**
 * The entries of a declaration whose condition the given metadata satisfies —
 * everything this occurrence is responsible for, installed here or not.
 *
 * A predicate that throws — reading a field the metadata doesn't carry, say —
 * counts as not applying. The migration evaluates these against whatever a
 * project happened to record, and must not claim a branch it cannot confirm.
 */
export const ownedDependencyEntries = <
  Name,
  M extends DependencyMetadata,
  Entry extends DeclaredDependency<Name, M>,
>(
  entries: readonly Entry[],
  metadata: M,
): Entry[] =>
  entries.filter((entry) => {
    if (!entry.when) {
      return true;
    }
    try {
      return entry.when(metadata) === true;
    } catch {
      return false;
    }
  });

/**
 * The entries to install for the given metadata: those it owns, less the ones
 * declared for their version alone. A `versionOnly` entry is still owned — the
 * sync keeps its pin current wherever it already sits.
 */
export const applicableDependencies = <
  Name,
  M extends DependencyMetadata,
  Entry extends DeclaredDependency<Name, M>,
>(
  entries: readonly Entry[],
  metadata: M,
): Entry[] =>
  ownedDependencyEntries(entries, metadata).filter(
    (entry) => !entry.versionOnly,
  );

/**
 * Requires a caller's declaration to cover `Needed`, naming whatever is missing
 * in the type error. Helpers that add dependencies take this alongside the
 * declaration so a forgotten spread can't compile.
 */
export type MustDeclare<
  Needed extends readonly { readonly name: ITsDepVersion }[],
  D extends DependencyDeclaration,
> = [Exclude<Needed[number]['name'], D['ts'][number]['name']>] extends [never]
  ? unknown
  : {
      __missingDeclaredDependencies: Exclude<
        Needed[number]['name'],
        D['ts'][number]['name']
      >;
    };

/** `MustDeclare` for Python dependencies. */
export type MustDeclarePy<
  Needed extends readonly { readonly name: IPyDepVersion }[],
  D extends DependencyDeclaration,
> = [Exclude<Needed[number]['name'], D['py'][number]['name']>] extends [never]
  ? unknown
  : {
      __missingDeclaredPyDependencies: Exclude<
        Needed[number]['name'],
        D['py'][number]['name']
      >;
    };

/**
 * The dependencies a declaration covers, for typing a conditional list without
 * widening it to every vended package.
 */
export type DeclaredTs<D extends DependencyDeclaration> =
  D['ts'][number]['name'];

/** `DeclaredTs` for Python dependencies. */
export type DeclaredPy<D extends DependencyDeclaration> =
  D['py'][number]['name'];

/**
 * Narrows a caller's declaration to the subset a helper adds, which
 * `MustDeclare` has already proven the caller covers.
 */
export const forDependencies = <
  const Ts extends readonly DeclaredDependency<ITsDepVersion, never>[] = [],
  const Py extends readonly DeclaredDependency<IPyDepVersion, never>[] = [],
>(
  declaration: DependencyDeclaration,
): DependencyDeclaration<Ts, Py> =>
  declaration as unknown as DependencyDeclaration<Ts, Py>;
