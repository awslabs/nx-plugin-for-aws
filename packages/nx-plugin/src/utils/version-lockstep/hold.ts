/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IPyDepVersion, ITerraformProviderVersion } from '../versions.js';
import type { IVersionedDep, LockstepNote } from './lockstep.js';

/**
 * A pin the version update must not move, why, and what lets it move again.
 *
 * The npm equivalent is a `reject` entry in `.ncurc.cjs`. pip-check-updates
 * has no exclude option and Terraform providers are resolved from the
 * registry, so Python and Terraform pins are held here instead.
 */
export interface VersionHold<Name extends IVersionedDep = IVersionedDep> {
  name: Name;
  reason: string;
  liftWhen: string;
}

const ADOT_DEPENDENCY_LIFT_WHEN =
  'the vended ADOT distribution and Langfuse resolve together and the Python Langfuse runtime tests pass';

/** Python pins the version update keeps at their current version. */
export const PY_VERSION_HOLDS: readonly VersionHold<IPyDepVersion>[] = [
  {
    name: 'opentelemetry-api',
    reason: 'the generated ADOT distribution requires opentelemetry-api 1.45.1',
    liftWhen: ADOT_DEPENDENCY_LIFT_WHEN,
  },
  {
    name: 'opentelemetry-exporter-otlp-proto-http',
    reason:
      'the generated ADOT distribution requires opentelemetry-exporter-otlp-proto-http 1.45.1',
    liftWhen: ADOT_DEPENDENCY_LIFT_WHEN,
  },
  {
    name: 'opentelemetry-propagator-aws-xray',
    reason:
      'the generated ADOT distribution requires opentelemetry-propagator-aws-xray 1.0.2',
    liftWhen: ADOT_DEPENDENCY_LIFT_WHEN,
  },
  {
    name: 'opentelemetry-sdk',
    reason: 'the generated ADOT distribution requires opentelemetry-sdk 1.45.1',
    liftWhen: ADOT_DEPENDENCY_LIFT_WHEN,
  },
  {
    name: 'opentelemetry-sdk-extension-aws',
    reason:
      'the generated ADOT distribution requires opentelemetry-sdk-extension-aws 2.1.0',
    liftWhen: ADOT_DEPENDENCY_LIFT_WHEN,
  },
  {
    name: 'ty',
    reason:
      'ty is 0.x and its releases add diagnostics that fail the vended Python templates',
    liftWhen:
      'a newer ty has been checked against all vended Python templates (run the py-client, py#dynamodb and other Python-typecheck specs with it)',
  },
  {
    name: 'strands-agents-tools',
    reason:
      'strands-agents-tools 0.9.0 removed current_time, which the vended py#agent strands template imports and passes as a tool',
    liftWhen:
      'the py#agent strands template injects the current time with ContextInjector and a migration moves existing agent.py files off current_time',
  },
];

/** Terraform providers the version update keeps at their current version. */
export const TERRAFORM_VERSION_HOLDS: readonly VersionHold<ITerraformProviderVersion>[] =
  [];

/**
 * Put each held pin the run proposed moving back to its current version.
 *
 * Mutates `proposed`, which holds versions not yet written anywhere, and
 * returns a note for each pin it held so the reason reaches the update's PR.
 */
export const holdPinnedVersions = <Name extends IVersionedDep>(
  holds: readonly VersionHold<Name>[],
  current: Readonly<Partial<Record<Name, string>>>,
  proposed: Partial<Record<Name, string>>,
): LockstepNote[] => {
  const notes: LockstepNote[] = [];

  for (const { name, reason, liftWhen } of holds) {
    const held = current[name];
    const available = proposed[name];
    if (held === undefined || available === undefined || available === held) {
      continue;
    }
    proposed[name] = held;
    notes.push({
      name,
      note: `${name} held at ${held} (${available} available): ${reason}. Lift when ${liftWhen}`,
    });
  }

  return notes;
};
