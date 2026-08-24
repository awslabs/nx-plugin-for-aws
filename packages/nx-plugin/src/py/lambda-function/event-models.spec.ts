/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { eventModuleFor } from './generator.js';

/**
 * The handler template interpolates the chosen event model straight into an
 * import, so an enum value the installed `aws-lambda-powertools` does not
 * export produces a Lambda that fails at import time — every invocation
 * fails, and nothing before deployment catches it.
 *
 * These tests pin each enum value to the module it is importable from,
 * mirroring the package layout: most models are re-exported by the `models`
 * package, while the IoT Core registry events live only in the submodule that
 * defines them.
 */
describe('py#lambda-function event models', () => {
  const eventEnum: string[] = JSON.parse(
    readFileSync(join(__dirname, 'schema.json'), 'utf-8'),
  ).properties.event.enum;

  const models = eventEnum.filter((e) => e !== 'Any');

  it('offers event models to choose from', () => {
    expect(models.length).toBeGreaterThan(0);
  });

  it.each(models)('resolves a module for %s', (event) => {
    expect(eventModuleFor(event)).toMatch(
      /^aws_lambda_powertools\.utilities\.parser\.models(\.[a-z_]+)?$/,
    );
  });

  it('imports the IoT Core registry events from their own submodule', () => {
    const iotEvents = models.filter((e) => e.startsWith('IoTCore'));
    expect(iotEvents.length).toBeGreaterThan(0);
    for (const event of iotEvents) {
      expect(eventModuleFor(event)).toBe(
        'aws_lambda_powertools.utilities.parser.models.iot_registry_events',
      );
    }
  });

  it('imports every other model from the models package', () => {
    for (const event of models.filter((e) => !e.startsWith('IoTCore'))) {
      expect(eventModuleFor(event)).toBe(
        'aws_lambda_powertools.utilities.parser.models',
      );
    }
  });

  it('spells CloudWatch with the casing powertools exports', () => {
    expect(models).toContain('CloudWatchLogsModel');
    expect(models).not.toContain('CloudwatchLogsModel');
  });
});
