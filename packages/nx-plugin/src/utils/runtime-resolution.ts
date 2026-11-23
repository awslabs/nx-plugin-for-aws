/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The resolution both managed-runtime pins share: take the newest runtime
 * `aws-cdk-lib` lists, capped at a ceiling this repo sets.
 *
 * `aws-cdk-lib` publishes a runtime when CDK adds it, not when the service makes
 * it generally available, so neither the Lambda `Runtime.ALL` list nor the
 * `AgentCoreRuntime` member list can decide on its own when a vended runtime
 * moves. The Lambda and AgentCore resolutions differ only in the pins they start
 * from, how an identifier is spelled, and what is held, so each supplies those
 * and shares the rest from here.
 *
 * Lives in the plugin rather than beside the version update script so it is
 * covered by the plugin's test suite; the script supplies the runtime list.
 */

/** Compare two dotted numeric versions (`24`, `3.14`) ascending. */
export const compareRuntimeVersions = (a: string, b: string): number => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
};

/**
 * Why a language's runtime stayed on its pin: `aws-cdk-lib` listed no runtime
 * for it, or this repo holds it below what was listed.
 */
export type UnresolvedReason = 'no-runtimes-listed' | 'held-below-ceiling';

/**
 * A runtime deliberately kept below what `aws-cdk-lib` offers, why, and the
 * event that ends the hold.
 *
 * `liftWhen` reaches the weekly PR body with the reason, so a reader can tell
 * whether a hold has outlived itself without opening the file that sets it.
 * Shaped after `VersionHold` in `version-lockstep/hold.ts`, which reports Python
 * and Terraform holds the same way.
 */
export interface RuntimeCeiling {
  readonly ceiling: string;
  readonly reason: string;
  readonly liftWhen: string;
}

/** A language whose runtime the resolution left on a version of its own choosing. */
export type UnresolvedRuntime =
  | {
      readonly language: string;
      readonly kept: string;
      readonly reason: 'no-runtimes-listed';
    }
  | {
      readonly language: string;
      readonly kept: string;
      readonly reason: 'held-below-ceiling';
      /** Why the runtime is held. */
      readonly detail: string;
      /** The event that ends the hold. */
      readonly liftWhen: string;
    };

export interface RuntimeResolution {
  /** Runtime version per language, holding the current pin where unresolved. */
  readonly versions: Record<string, string>;
  /** Languages the resolution did not move to the newest runtime listed, and why. */
  readonly unresolved: UnresolvedRuntime[];
}

export interface RuntimeResolutionRequest<Language extends string> {
  /** The pins the resolution starts from, per language. */
  readonly current: Readonly<Record<Language, string>>;
  /** The runtime identifiers `aws-cdk-lib` publishes. */
  readonly identifiers: readonly string[];
  /** Reads the language and version an identifier names, or undefined to skip it. */
  readonly parse: (
    identifier: string,
  ) => { language: Language; version: string } | undefined;
  /** Runtimes held below what the list offers. */
  readonly ceilings: Partial<Record<Language, RuntimeCeiling>>;
}

/**
 * The runtime each language resolves to, and the languages left on a version the
 * list did not choose.
 *
 * Never moves a runtime backwards: a pin ahead of what `aws-cdk-lib` offers
 * stays. A language the list says nothing about, or whose newest listed runtime
 * is above its ceiling, keeps its pin (or rises only to the ceiling) and is
 * reported through `unresolved`, so a gap or a hold costs this bump alone rather
 * than the whole version update.
 */
export const resolveRuntimeVersions = <Language extends string>({
  current,
  identifiers,
  parse,
  ceilings,
}: RuntimeResolutionRequest<Language>): RuntimeResolution => {
  const unresolved: UnresolvedRuntime[] = [];

  const versions = Object.fromEntries(
    (Object.keys(current) as Language[]).map((language) => {
      const pin = current[language];
      const available = identifiers.flatMap((identifier) => {
        const parsed = parse(identifier);
        return parsed?.language === language ? [parsed.version] : [];
      });

      if (available.length === 0) {
        unresolved.push({ language, kept: pin, reason: 'no-runtimes-listed' });
        return [language, pin];
      }

      const latest = available.reduce((best, version) =>
        compareRuntimeVersions(version, best) > 0 ? version : best,
      );

      // Reported whenever the list offers something the ceiling refuses, so a
      // hold that has outlived its reason is visible in every PR body rather
      // than only in the file that sets it.
      const held = ceilings[language];
      if (held && compareRuntimeVersions(latest, held.ceiling) > 0) {
        // A ceiling above the pin still moves the runtime up to the ceiling, so
        // the note names the version the run kept rather than the one it
        // started from.
        const kept =
          compareRuntimeVersions(held.ceiling, pin) > 0 ? held.ceiling : pin;
        unresolved.push({
          language,
          kept,
          reason: 'held-below-ceiling',
          detail: held.reason,
          liftWhen: held.liftWhen,
        });
        return [language, kept];
      }

      return [language, compareRuntimeVersions(latest, pin) > 0 ? latest : pin];
    }),
  );

  return { versions, unresolved };
};
