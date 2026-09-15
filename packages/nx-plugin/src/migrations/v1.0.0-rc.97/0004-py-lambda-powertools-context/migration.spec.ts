/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { LAMBDA_FUNCTION_GENERATOR_INFO } from '../../../py/lambda-function/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PROJECT_ROOT = 'packages/my_app';
const HANDLER_REL = 'proj_my_app/any_fn.py';
const HANDLER_PY = `${PROJECT_ROOT}/${HANDLER_REL}`;

const setUpProject = (tree: Tree, handlerPath = HANDLER_REL) => {
  addProjectConfiguration(tree, 'my_app', {
    root: PROJECT_ROOT,
    sourceRoot: `${PROJECT_ROOT}/proj_my_app`,
    targets: {},
    metadata: {
      components: [
        {
          generator: LAMBDA_FUNCTION_GENERATOR_INFO.id,
          path: handlerPath,
          name: 'any-fn',
        },
      ],
    } as any,
  });
};

const GENERATED_HANDLER = `import os

from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.typing import LambdaContext

os.environ["POWERTOOLS_METRICS_NAMESPACE"] = "AnyFn"
os.environ["POWERTOOLS_SERVICE_NAME"] = "AnyFn"

logger: Logger = Logger()
metrics: Metrics = Metrics()
tracer: Tracer = Tracer()


@tracer.capture_lambda_handler
@metrics.log_metrics
def lambda_handler(event: dict, context: LambdaContext):
    logger.info("Received event", extra={"event": event})
    metrics.add_metric(name="InvocationCount", unit=MetricUnit.Count, value=1)

    try:
        # TODO: Implement
        metrics.add_metric(name="SuccessCount", unit=MetricUnit.Count, value=1)
        # TODO: Implement success response if required
    except Exception as e:
        logger.exception(e)
        metrics.add_metric(name="ErrorCount", unit=MetricUnit.Count, value=1)
        # TODO: Implement error response if required
`;

const GENERATED_HANDLER_WITH_PARSER = `import os

from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.parser import event_parser
from aws_lambda_powertools.utilities.parser.models import EventBridgeModel
from aws_lambda_powertools.utilities.typing import LambdaContext

logger: Logger = Logger()
metrics: Metrics = Metrics()
tracer: Tracer = Tracer()


@tracer.capture_lambda_handler
@metrics.log_metrics
@event_parser(model=EventBridgeModel)
def lambda_handler(event: EventBridgeModel, context: LambdaContext):
    logger.info("Received event", extra={"event": event.model_dump()})
    metrics.add_metric(name="InvocationCount", unit=MetricUnit.Count, value=1)
`;

describe('py-lambda-powertools-context migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add context injection and the cold start metric to a generated handler', async () => {
    setUpProject(tree);
    tree.write(HANDLER_PY, GENERATED_HANDLER);

    const result = await migration(tree);

    const updated = tree.read(HANDLER_PY, 'utf-8');
    expect(updated).toContain('@logger.inject_lambda_context');
    expect(updated).toContain(
      '@metrics.log_metrics(capture_cold_start_metric=True)',
    );
    // The decorator order matters: the tracer stays outermost
    expect(updated).toContain(`@tracer.capture_lambda_handler
@logger.inject_lambda_context
@metrics.log_metrics(capture_cold_start_metric=True)
def lambda_handler(`);
    expect(result.nextSteps).toEqual([]);
  });

  it('should preserve an event_parser decorator below the metrics decorator', async () => {
    setUpProject(tree);
    tree.write(HANDLER_PY, GENERATED_HANDLER_WITH_PARSER);

    await migration(tree);

    expect(tree.read(HANDLER_PY, 'utf-8')).toContain(
      `@tracer.capture_lambda_handler
@logger.inject_lambda_context
@metrics.log_metrics(capture_cold_start_metric=True)
@event_parser(model=EventBridgeModel)
def lambda_handler(`,
    );
  });

  it('should preserve user code in the handler body', async () => {
    setUpProject(tree);
    tree.write(
      HANDLER_PY,
      GENERATED_HANDLER.replace(
        '        # TODO: Implement\n',
        '        my_custom_business_logic()\n',
      ),
    );

    await migration(tree);

    const updated = tree.read(HANDLER_PY, 'utf-8');
    expect(updated).toContain('my_custom_business_logic()');
    expect(updated).toContain('@logger.inject_lambda_context');
  });

  it('should leave a `log_metrics` decorating another function alone', async () => {
    setUpProject(tree);
    tree.write(
      HANDLER_PY,
      `${GENERATED_HANDLER}

@metrics.log_metrics
def my_other_function():
    pass
`,
    );

    await migration(tree);

    const updated = tree.read(HANDLER_PY, 'utf-8');
    expect(updated).toContain(`@metrics.log_metrics
def my_other_function():`);
    expect(updated).toContain(`@tracer.capture_lambda_handler
@logger.inject_lambda_context
@metrics.log_metrics(capture_cold_start_metric=True)
def lambda_handler(`);
  });

  it('should skip and report a handler which has diverged', async () => {
    setUpProject(tree);
    const diverged = GENERATED_HANDLER.replace(
      '@tracer.capture_lambda_handler\n@metrics.log_metrics\n',
      '@my_own_decorator\n',
    );
    tree.write(HANDLER_PY, diverged);

    const result = await migration(tree);

    expect(tree.read(HANDLER_PY, 'utf-8')).toBe(diverged);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps?.[0]).toContain(HANDLER_PY);
  });

  it('should leave a handler which already captures the cold start metric untouched', async () => {
    setUpProject(tree);
    const already = GENERATED_HANDLER.replace(
      '@metrics.log_metrics\n',
      '@logger.inject_lambda_context\n@metrics.log_metrics(capture_cold_start_metric=True)\n',
    );
    tree.write(HANDLER_PY, already);

    const result = await migration(tree);

    expect(tree.read(HANDLER_PY, 'utf-8')).toBe(already);
    expect(result.nextSteps).toEqual([]);
  });

  it('should ignore projects with no py#lambda-function components', async () => {
    addProjectConfiguration(tree, 'other', {
      root: 'packages/other',
      targets: {},
    });
    tree.write('packages/other/other/handler.py', GENERATED_HANDLER);

    const result = await migration(tree);

    expect(tree.read('packages/other/other/handler.py', 'utf-8')).toBe(
      GENERATED_HANDLER,
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    setUpProject(tree);
    tree.write(HANDLER_PY, GENERATED_HANDLER);

    await migration(tree);
    const afterFirst = tree.read(HANDLER_PY, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(HANDLER_PY, 'utf-8')).toBe(afterFirst);
    expect(result.nextSteps).toEqual([]);
  });
});
