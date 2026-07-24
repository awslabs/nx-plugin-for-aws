/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 14: Invalid or failed streams cannot report success
 * Validates: Requirements 9.6, 9.9
 *
 * For all event sequences containing a service `error` event or lacking
 * `messageStop`, stream consumption REJECTS - the non-zero-exit
 * precondition of Requirements 9.6 and 9.9 - while preserving exactly the
 * text already emitted before the failure and reporting failure details
 * through the rejection rather than standard-output response text.
 *
 * Two failure classes are generated constructively:
 *
 * - ERROR-EVENT class (Requirement 9.6): a valid completing sequence
 *   (optional `messageStart`, N content blocks, `messageStop`, with
 *   metadata/unknown noise interleaved) receives one
 *   `internalServerException`, `validationException`, or
 *   `runtimeClientError` event at an ARBITRARY position - before any
 *   deltas, mid-block, after all blocks, and (as a pinned edge variant)
 *   after `messageStop` itself, because error events must fail the stream
 *   even when the message already completed. Events after the error
 *   position exist but must never be consumed: the rejection stops
 *   consumption at the error event.
 *
 * - INCOMPLETE class (Requirement 9.9): a sequence that ends WITHOUT
 *   `messageStop` (optional `messageStart`, content blocks, metadata and
 *   unknown noise, possibly empty) must reject with an incomplete-stream
 *   diagnostic mentioning `messageStop` after consuming every event.
 *
 * The generated Invocation Client is template output, so this property
 * runs the generator ONCE, reads the rendered `invoke-harness.ts` from the
 * tree, transpiles the rendered TypeScript to CommonJS, and evaluates it
 * with stubbed module imports. The REAL exported `consumeHarnessStream` is
 * the primary unit under test, and each case is ALSO composed through the
 * real exported `runHarnessCli` (with injected env/io/client
 * collaborators) to establish that the CLI entry point cannot resolve - it
 * can only reach a non-zero exit - for either failure class, while
 * preserving the same prior stdout text and never writing the success
 * epilogue newline.
 *
 * Because generation is constructive and tagged, the expected preserved
 * stdout (delta texts strictly before the error position, or all delta
 * texts for incomplete streams), the expected consumed-event count, and
 * the expected diagnostic contents derive from the construction tags
 * rather than from the projection logic under test.
 */
import fc from 'fast-check';
import ts from 'typescript';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Generated identity: name 'my-harness'. */
const PROJECT_ROOT = 'packages/my-harness';

/** Valid parseable ARN for the composed runHarnessCli runs (Region us-west-2). */
const HARNESS_ARN =
  'arn:aws:bedrock-agentcore:us-west-2:123456789012:harness/my-harness-abc';

/** Supplied session id (39 chars, inside 33-100) so UUIDs are never needed. */
const SESSION_ID = 'property-14-session-id-0123456789abcdef';

// ---------------------------------------------------------------------------
// Rendered-module evaluation
// ---------------------------------------------------------------------------

/** Output channels injected into the real rendered stream consumer. */
interface HarnessStreamIo {
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}

/** Typed view of the evaluated `invoke-harness.ts` exports under test. */
interface InvocationClientModule {
  consumeHarnessStream(
    stream: AsyncIterable<Record<string, unknown>>,
    io: HarnessStreamIo,
  ): Promise<unknown>;
  runHarnessCli(
    prompt: string,
    deps?: Record<string, unknown>,
  ): Promise<number>;
}

const transpileToCjs = (source: string): string =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

/**
 * Evaluate the rendered `invoke-harness.ts` with stubbed imports and return
 * its real exports. Every module-level collaborator that a failing stream
 * run must never need THROWS on use: the direct projection calls touch no
 * import at all, and the composed CLI runs inject their own session id,
 * Harness ARN, and client factory, so module-level UUID generation,
 * Runtime Configuration reads, and real SDK client construction would each
 * falsify the property by themselves. Only `InvokeHarnessCommand` is
 * constructible, because `runHarnessCli` always builds the request command
 * before the injected `send` receives (and ignores) it.
 */
const evaluateInvokeHarnessModule = (
  source: string,
): InvocationClientModule => {
  const requireStub = (specifier: string): unknown => {
    switch (specifier) {
      case 'node:crypto':
        return {
          randomUUID: () => {
            throw new Error(
              'failure runs supply HARNESS_SESSION_ID; module-level UUID generation must not run',
            );
          },
        };
      case '@aws-lambda-powertools/parameters/appconfig':
        return {
          getAppConfig: () => {
            throw new Error(
              'failure runs supply HARNESS_ARN; Runtime Configuration must not be read',
            );
          },
        };
      case '@aws-sdk/client-bedrock-agentcore':
        return {
          BedrockAgentCoreClient: class {
            constructor() {
              throw new Error(
                'failure runs inject createClient; the real SDK client must not be constructed',
              );
            }
          },
          InvokeHarnessCommand: class {
            readonly input: unknown;
            constructor(input: unknown) {
              this.input = input;
            }
          },
        };
      default:
        throw new Error(
          `unexpected import '${specifier}' in rendered invoke-harness.ts`,
        );
    }
  };

  const exportsObject: Record<string, unknown> = {};
  new Function('require', 'exports', 'module', transpileToCjs(source))(
    requireStub,
    exportsObject,
    { exports: exportsObject },
  );
  return exportsObject as unknown as InvocationClientModule;
};

// ---------------------------------------------------------------------------
// Model: the failure contract from the requirements, restated independently
// of the implementation.
//
// - 9.6: a stream carrying an `internalServerException`,
//   `validationException`, or `runtimeClientError` event REJECTS with the
//   service error details (the generated name and message), stdout keeps
//   exactly the delta text written before the error, and consumption stops
//   at the error event - events after it are never pulled. This holds even
//   when `messageStop` already succeeded before the error.
// - 9.9: a stream that ends without `messageStop` REJECTS with an
//   incomplete-stream diagnostic mentioning `messageStop`, after every
//   event was consumed, and stdout keeps all delta text.
// - Both classes: rejection is the CLI's non-zero-exit precondition, so
//   the composed `runHarnessCli` call can never resolve, and the
//   success-path trailing newline is never written to stdout.
//
// Sequences are generated constructively as tagged items, so every
// expectation below follows from the construction tags, never from the
// consumption logic under test.
// ---------------------------------------------------------------------------

/** The three service error event kinds modeled by the pinned SDK stream. */
type ServiceErrorKind =
  | 'internalServerException'
  | 'validationException'
  | 'runtimeClientError';

type TaggedItem =
  | { tag: 'messageStart' }
  | { tag: 'blockStart'; index: number }
  | { tag: 'delta'; index: number; text: string | undefined }
  | { tag: 'blockStop'; index: number }
  | { tag: 'messageStop' }
  | { tag: 'metadata'; payload: Record<string, unknown> }
  | { tag: 'unknown'; event: Record<string, unknown> }
  | { tag: 'error'; kind: ServiceErrorKind; name: string; message: string };

/** Map one tagged item onto the raw event object the SDK stream yields. */
const toEvent = (item: TaggedItem): Record<string, unknown> => {
  switch (item.tag) {
    case 'messageStart':
      return { messageStart: { role: 'assistant' } };
    case 'blockStart':
      return { contentBlockStart: { contentBlockIndex: item.index } };
    case 'delta':
      return {
        contentBlockDelta:
          item.text === undefined
            ? { contentBlockIndex: item.index }
            : { contentBlockIndex: item.index, delta: { text: item.text } },
      };
    case 'blockStop':
      return { contentBlockStop: { contentBlockIndex: item.index } };
    case 'messageStop':
      return { messageStop: { stopReason: 'end_turn' } };
    case 'metadata':
      return { metadata: item.payload };
    case 'unknown':
      return item.event;
    case 'error':
      return { [item.kind]: { name: item.name, message: item.message } };
  }
};

/**
 * Yield the raw events one at a time, like a real SDK event stream, while
 * counting how many events the consumer actually pulled. When the consumer
 * throws mid-loop, `for await` closes the generator, so `consumed` freezes
 * at the number of events pulled up to and including the throwing one -
 * exactly the observation Requirement 9.6 needs to prove consumption stops
 * at the error event.
 */
const toTrackedStream = (
  events: ReadonlyArray<Record<string, unknown>>,
): {
  stream: AsyncIterable<Record<string, unknown>>;
  tracker: { consumed: number };
} => {
  const tracker = { consumed: 0 };
  const stream: AsyncIterable<Record<string, unknown>> = {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        tracker.consumed += 1;
        yield event;
      }
    },
  };
  return { stream, tracker };
};

/** Ordered non-empty delta texts among the first `end` tagged items. */
const deltaTextsBefore = (
  sequence: ReadonlyArray<TaggedItem>,
  end: number,
): string =>
  sequence
    .slice(0, end)
    .flatMap((item) => (item.tag === 'delta' && item.text ? [item.text] : []))
    .join('');

// ---------------------------------------------------------------------------
// Arbitraries (delta/block/noise shapes shared with Property 13)
// ---------------------------------------------------------------------------

/**
 * Delta payload texts: arbitrary Unicode graphemes plus targeted
 * whitespace-only, empty, multi-codepoint, and missing-text shapes.
 * `undefined` renders a `contentBlockDelta` without a `delta.text` value;
 * like the empty string it contributes nothing to preserved stdout.
 */
const arbDeltaText: fc.Arbitrary<string | undefined> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.string({ unit: 'grapheme', maxLength: 12 }),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      '',
      ' ',
      '\t',
      '\n',
      '  ',
      'héllo wörld',
      '中文文本',
      '😀🎉',
      ' leading',
      'trailing ',
    ),
  },
  { weight: 1, arbitrary: fc.constant(undefined) },
);

/** One content block: zero to five delta payload texts. */
const arbBlock = fc.array(arbDeltaText, { maxLength: 5 });

/** Metadata payloads: JSON-serializable usage/metrics/trace shapes. */
const arbMetadataPayload: fc.Arbitrary<Record<string, unknown>> = fc.record(
  {
    usage: fc.record({
      inputTokens: fc.nat({ max: 100000 }),
      outputTokens: fc.nat({ max: 100000 }),
      totalTokens: fc.nat({ max: 200000 }),
    }),
    metrics: fc.record({ latencyMs: fc.nat({ max: 600000 }) }),
    traceId: fc.string({
      unit: fc.constantFrom(...'abcdef0123456789'.split('')),
      minLength: 1,
      maxLength: 12,
    }),
  },
  { requiredKeys: ['usage'] },
);

/** Values carried by unknown events; their content must never surface. */
const arbUnknownValue = fc.oneof(
  fc.string({ unit: 'grapheme-ascii', maxLength: 10 }),
  fc.nat({ max: 1000 }),
  fc.record({ detail: fc.string({ unit: 'grapheme-ascii', maxLength: 8 }) }),
);

/**
 * Event kinds not modeled by the pinned SDK: the SDK's `$unknown`
 * `[memberName, value]` tuple representation plus plausible future
 * unmodeled keys. None carries a recognized member key, so they never
 * complete a message and never fail one either.
 */
const arbUnknownEvent: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  fc
    .tuple(
      fc.constantFrom('futureEvent', 'traceDelta', 'heartbeat'),
      arbUnknownValue,
    )
    .map(([memberName, value]) => ({ $unknown: [memberName, value] })),
  fc
    .tuple(
      fc.constantFrom(
        'citationEvent',
        'reasoningContentDelta',
        'serverHeartbeat',
        'futureLifecycle',
      ),
      arbUnknownValue,
    )
    .map(([key, value]) => ({ [key]: value })),
);

/** Noise items interleaved into a sequence; never a `messageStop`. */
const arbNoiseItem: fc.Arbitrary<TaggedItem> = fc.oneof(
  {
    weight: 2,
    arbitrary: arbMetadataPayload.map(
      (payload): TaggedItem => ({ tag: 'metadata', payload }),
    ),
  },
  {
    weight: 3,
    arbitrary: arbUnknownEvent.map(
      (event): TaggedItem => ({ tag: 'unknown', event }),
    ),
  },
);

/** `messageStart` is usually present, sometimes absent. */
const arbHasMessageStart = fc.oneof(
  { weight: 4, arbitrary: fc.constant(true) },
  { weight: 1, arbitrary: fc.constant(false) },
);

/**
 * Build one tagged sequence: an optional `messageStart`, N in-order
 * content blocks, and - only when `includeMessageStop` - a final
 * `messageStop`, with noise items inserted at arbitrary clamped slots
 * before, between, and after core items (slot i lands before core item i,
 * slots at or past the core length land after it), plus a trailing noise
 * batch. Insertion is stable, so noise order within one slot is preserved.
 */
const buildSequence = (
  hasMessageStart: boolean,
  blocks: ReadonlyArray<ReadonlyArray<string | undefined>>,
  interleaved: ReadonlyArray<readonly [TaggedItem, number]>,
  trailing: ReadonlyArray<TaggedItem>,
  includeMessageStop: boolean,
): TaggedItem[] => {
  const core: TaggedItem[] = [];
  if (hasMessageStart) {
    core.push({ tag: 'messageStart' });
  }
  blocks.forEach((deltaTexts, index) => {
    core.push({ tag: 'blockStart', index });
    for (const text of deltaTexts) {
      core.push({ tag: 'delta', index, text });
    }
    core.push({ tag: 'blockStop', index });
  });
  if (includeMessageStop) {
    core.push({ tag: 'messageStop' });
  }

  const slots: TaggedItem[][] = Array.from(
    { length: core.length + 1 },
    () => [],
  );
  for (const [noise, position] of interleaved) {
    slots[Math.min(position, core.length)].push(noise);
  }

  const sequence: TaggedItem[] = [];
  core.forEach((item, index) => {
    sequence.push(...slots[index], item);
  });
  sequence.push(...slots[core.length], ...trailing);
  return sequence;
};

/** Service error names/messages are non-empty so detail checks cannot pass vacuously. */
const arbErrorDetailText = fc.string({
  unit: 'grapheme',
  minLength: 1,
  maxLength: 16,
});

/** ERROR-EVENT class case: one service error inside an otherwise valid stream. */
interface ErrorStreamCase {
  /** Full tagged sequence including the error and its unconsumed tail. */
  sequence: TaggedItem[];
  /** Index of the error event within `sequence`. */
  errorIndex: number;
  errorName: string;
  errorMessage: string;
  /** EDGE variant: `messageStop` already succeeded before the error. */
  errorAfterMessageStop: boolean;
}

/**
 * ERROR-EVENT class (Requirement 9.6). A valid completing sequence (with
 * interleaved noise) receives one generated service error event at an
 * arbitrary position in [0, length]: before any deltas, mid-block, between
 * noise items, or after `messageStop`. The weight-1 `forceAfterMessageStop`
 * branch pins the error past the COMPLETE sequence so the edge variant -
 * error events must reject even after a successful `messageStop` - is
 * exercised in a guaranteed share of runs (the modulo branch also reaches
 * it whenever the position lands past the `messageStop` index). Everything
 * originally at or after the chosen position, plus an extra noise tail,
 * follows the error and must never be consumed.
 */
const arbErrorStreamCase: fc.Arbitrary<ErrorStreamCase> = fc
  .tuple(
    arbHasMessageStart,
    fc.array(arbBlock, { maxLength: 4 }),
    fc.array(fc.tuple(arbNoiseItem, fc.nat({ max: 30 })), { maxLength: 6 }),
    fc.array(arbNoiseItem, { maxLength: 3 }),
    fc.constantFrom<ServiceErrorKind>(
      'internalServerException',
      'validationException',
      'runtimeClientError',
    ),
    arbErrorDetailText,
    arbErrorDetailText,
    fc.nat({ max: 9999 }),
    fc.oneof(
      { weight: 3, arbitrary: fc.constant(false) },
      { weight: 1, arbitrary: fc.constant(true) },
    ),
    fc.array(arbNoiseItem, { maxLength: 3 }),
  )
  .map(
    ([
      hasMessageStart,
      blocks,
      interleaved,
      trailing,
      kind,
      name,
      message,
      positionSeed,
      forceAfterMessageStop,
      unreachableTail,
    ]) => {
      const completing = buildSequence(
        hasMessageStart,
        blocks,
        interleaved,
        trailing,
        true,
      );
      const errorIndex = forceAfterMessageStop
        ? completing.length
        : positionSeed % (completing.length + 1);
      const errorItem: TaggedItem = { tag: 'error', kind, name, message };
      const sequence = [
        ...completing.slice(0, errorIndex),
        errorItem,
        ...completing.slice(errorIndex),
        ...unreachableTail,
      ];
      return {
        sequence,
        errorIndex,
        errorName: name,
        errorMessage: message,
        errorAfterMessageStop: completing
          .slice(0, errorIndex)
          .some((item) => item.tag === 'messageStop'),
      };
    },
  );

/** INCOMPLETE class case: a stream that never yields `messageStop`. */
interface IncompleteStreamCase {
  sequence: TaggedItem[];
}

/**
 * INCOMPLETE class (Requirement 9.9). The constructive core keeps its
 * lifecycle events (`messageStart`, `contentBlockStart`,
 * `contentBlockStop`) and deltas, and metadata/unknown noise is
 * interleaved and trailed as usual, but `messageStop` is OMITTED - noise
 * items never contain one - so every generated sequence (including the
 * empty one) ends without message completion.
 */
const arbIncompleteStreamCase: fc.Arbitrary<IncompleteStreamCase> = fc
  .tuple(
    arbHasMessageStart,
    fc.array(arbBlock, { maxLength: 4 }),
    fc.array(fc.tuple(arbNoiseItem, fc.nat({ max: 30 })), { maxLength: 6 }),
    fc.array(arbNoiseItem, { maxLength: 3 }),
  )
  .map(([hasMessageStart, blocks, interleaved, trailing]) => ({
    sequence: buildSequence(
      hasMessageStart,
      blocks,
      interleaved,
      trailing,
      false,
    ),
  }));

// ---------------------------------------------------------------------------
// Observation helpers: run one failing stream directly through the real
// consumeHarnessStream, and composed through the real runHarnessCli.
// ---------------------------------------------------------------------------

/** Uniform observation shape captured from one run against the rendered module. */
interface FailureObservation {
  /** The captured rejection; undefined means the run wrongly succeeded. */
  rejection: unknown;
  /** Concatenated stdout text observed before the failure. */
  stdout: string;
  /** Number of events the consumer pulled from the stream. */
  consumed: number;
}

/** Direct projection call: the primary unit under test. */
const consumeDirectly = async (
  client: InvocationClientModule,
  events: ReadonlyArray<Record<string, unknown>>,
): Promise<FailureObservation> => {
  const { stream, tracker } = toTrackedStream(events);
  const stdout: string[] = [];
  const stderr: string[] = [];
  let rejection: unknown;
  try {
    await client.consumeHarnessStream(stream, {
      writeStdout: (text) => {
        stdout.push(text);
      },
      writeStderr: (text) => {
        stderr.push(text);
      },
    });
  } catch (error) {
    rejection = error;
  }
  return { rejection, stdout: stdout.join(''), consumed: tracker.consumed };
};

/**
 * Composed CLI call: the same failing stream delivered through the real
 * `runHarnessCli` with injected collaborators. Resolution would mean the
 * CLI reported success for an invalid stream; the diagnostic session line
 * goes to stderr, so stdout still carries response text only, and the
 * success-path trailing newline must never be written.
 */
const runComposedCli = async (
  client: InvocationClientModule,
  events: ReadonlyArray<Record<string, unknown>>,
): Promise<FailureObservation> => {
  const { stream, tracker } = toTrackedStream(events);
  const stdout: string[] = [];
  const stderr: string[] = [];
  let rejection: unknown;
  try {
    await client.runHarnessCli('trigger the failing stream', {
      env: { HARNESS_ARN, HARNESS_SESSION_ID: SESSION_ID },
      io: {
        writeStdout: (text: string) => {
          stdout.push(text);
        },
        writeStderr: (text: string) => {
          stderr.push(text);
        },
      },
      randomUuid: () => {
        throw new Error(
          'HARNESS_SESSION_ID is supplied; UUID generation must not run',
        );
      },
      readRuntimeConfig: () => {
        throw new Error(
          'HARNESS_ARN is supplied; Runtime Configuration must not be read',
        );
      },
      createClient: () => ({
        send: () => Promise.resolve({ stream }),
      }),
    });
  } catch (error) {
    rejection = error;
  }
  return { rejection, stdout: stdout.join(''), consumed: tracker.consumed };
};

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('agentcore-harness stream failure semantics (Property 14)', () => {
  let client: InvocationClientModule;

  beforeAll(async () => {
    // One real generator run renders the Invocation Client; `infra: none`
    // keeps the run project-only.
    const tree = createTreeUsingTsSolutionSetup();
    await agentcoreHarnessGenerator(tree, {
      name: 'my-harness',
      infra: 'none',
    });

    const renderedImpl = tree.read(
      `${PROJECT_ROOT}/invoke-harness.ts`,
      'utf-8',
    ) as string;
    expect(renderedImpl).toBeTruthy();

    client = evaluateInvokeHarnessModule(renderedImpl);
  });

  // Feature: agentcore-harness-generator, Property 14: Invalid or failed streams cannot report success
  // **Validates: Requirements 9.6, 9.9**
  it('rejects every stream carrying a service error event with the error details, preserving prior text and stopping consumption at the error', async () => {
    await fc.assert(
      fc.asyncProperty(arbErrorStreamCase, async (errorCase) => {
        const { sequence, errorIndex, errorName, errorMessage } = errorCase;
        const events = sequence.map(toEvent);

        // Expected outcomes derive from the construction tags alone: only
        // delta text STRICTLY BEFORE the error position is preserved, and
        // exactly the events up to and including the error are consumed.
        const expectedStdout = deltaTextsBefore(sequence, errorIndex);
        const expectedConsumed = errorIndex + 1;

        // The same generated case runs directly against
        // consumeHarnessStream and composed through runHarnessCli; both
        // must observe identical failure semantics. This uniformly covers
        // the EDGE variant where messageStop precedes the error
        // (errorCase.errorAfterMessageStop): error events always fail,
        // even after successful message completion.
        for (const observed of [
          await consumeDirectly(client, events),
          await runComposedCli(client, events),
        ]) {
          // 9.6: the run REJECTS - success is impossible - and the
          // rejection carries the service error details (the generated
          // name and message), outside standard-output response text.
          expect(observed.rejection).toBeInstanceOf(Error);
          const diagnostic = (observed.rejection as Error).message;
          expect(diagnostic).toContain('Harness invocation failed');
          expect(diagnostic).toContain(`${errorName}: ${errorMessage}`);

          // 9.6 preservation: stdout is EXACTLY the text streamed before
          // the error - nothing lost, nothing appended (no error details,
          // no success-path trailing newline).
          expect(observed.stdout).toBe(expectedStdout);

          // 9.6 consumption: the stream stops at the error event; the
          // events placed after the error position are never pulled.
          expect(observed.consumed).toBe(expectedConsumed);
        }
      }),
      // At least 150 runs required by the task; each run is two direct
      // calls against the transpiled module with in-memory async
      // generators, so 200 runs stay fast.
      { numRuns: 200 },
    );
  });

  // Feature: agentcore-harness-generator, Property 14: Invalid or failed streams cannot report success
  // **Validates: Requirements 9.6, 9.9**
  it('rejects every stream that ends without messageStop with an incomplete-stream diagnostic, preserving all streamed text', async () => {
    await fc.assert(
      fc.asyncProperty(arbIncompleteStreamCase, async (incompleteCase) => {
        const { sequence } = incompleteCase;
        const events = sequence.map(toEvent);

        // All non-empty delta texts are preserved, and the incompleteness
        // is only diagnosable after the whole stream was consumed.
        const expectedStdout = deltaTextsBefore(sequence, sequence.length);

        for (const observed of [
          await consumeDirectly(client, events),
          await runComposedCli(client, events),
        ]) {
          // 9.9: the run REJECTS - an incomplete stream cannot report
          // success - with a diagnostic naming the missing messageStop.
          expect(observed.rejection).toBeInstanceOf(Error);
          const diagnostic = (observed.rejection as Error).message;
          expect(diagnostic).toContain('messageStop');
          expect(diagnostic.toLowerCase()).toContain('incomplete');

          // 9.9 preservation: everything streamed before the end remains
          // on stdout, with no success-path trailing newline appended.
          expect(observed.stdout).toBe(expectedStdout);

          // The incomplete diagnosis requires consuming every event.
          expect(observed.consumed).toBe(sequence.length);
        }
      }),
      // At least 150 runs required by the task; 200 in-memory runs stay
      // fast.
      { numRuns: 200 },
    );
  });
});
