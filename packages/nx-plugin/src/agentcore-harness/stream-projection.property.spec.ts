/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 13: Stream projection preserves text order and channel separation
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.10
 *
 * For all valid event sequences containing one completed message and any
 * interleaved unknown event objects, standard output equals the ordered
 * concatenation of all non-empty `contentBlockDelta.delta.text` values,
 * lifecycle and unknown event objects never appear in either output
 * channel, metadata appears only in diagnostics (one stderr line per
 * `metadata` event, in order), and the summary records a successful
 * `messageStop`: stream consumption RESOLVES, which is the zero-exit
 * precondition of Requirement 9.4.
 *
 * The generated Invocation Client is template output, so this property runs
 * the generator ONCE, reads the rendered `invoke-harness.ts` from the tree,
 * transpiles the rendered TypeScript to CommonJS, and evaluates it with
 * stubbed module imports (`node:crypto`, the Powertools AppConfig reader,
 * and the AgentCore SDK client/command) that all THROW on use: projecting
 * a stream must never generate UUIDs, read Runtime Configuration, or touch
 * the SDK. The REAL exported `consumeHarnessStream` is the unit under
 * test. Each run constructively generates one valid completing sequence -
 * an optional `messageStart`, N content blocks each holding
 * `contentBlockStart`, zero to five `contentBlockDelta` events (Unicode,
 * whitespace, empty, and missing-text payloads), and `contentBlockStop`,
 * then `messageStop` - with `metadata` events and UNKNOWN events (SDK
 * `$unknown` tuples and unmodeled keys) interleaved at arbitrary positions
 * before, between, and after blocks, including after `messageStop`.
 * Because generation is constructive and tagged, the expected stdout
 * concatenation, stderr metadata lines, and summary counters are derived
 * from the construction tags rather than by re-running the projection
 * logic under test.
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

// ---------------------------------------------------------------------------
// Rendered-module evaluation
// ---------------------------------------------------------------------------

/** Output channels injected into the real rendered stream consumer. */
interface HarnessStreamIo {
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}

/** Protocol summary returned by the rendered `consumeHarnessStream`. */
interface StreamSummary {
  sawMessageStart: boolean;
  sawMessageStop: boolean;
  contentBlockCount: number;
  textDeltaCount: number;
  metadataEventCount: number;
}

/** Typed view of the evaluated `invoke-harness.ts` exports under test. */
interface InvocationClientModule {
  consumeHarnessStream(
    stream: AsyncIterable<Record<string, unknown>>,
    io: HarnessStreamIo,
  ): Promise<StreamSummary>;
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
 * its real exports. `consumeHarnessStream` is a pure projection from an
 * event iterable onto the injected io channels, so EVERY stubbed
 * module-level collaborator throws on use: a stream projection that
 * generated a UUID, read Runtime Configuration, or constructed an SDK
 * client or command would falsify the property by itself.
 */
const evaluateInvokeHarnessModule = (
  source: string,
): InvocationClientModule => {
  const requireStub = (specifier: string): unknown => {
    switch (specifier) {
      case 'node:crypto':
        return {
          randomUUID: () => {
            throw new Error('consumeHarnessStream must never generate UUIDs');
          },
        };
      case '@aws-lambda-powertools/parameters/appconfig':
        return {
          getAppConfig: () => {
            throw new Error(
              'consumeHarnessStream must never read Runtime Configuration',
            );
          },
        };
      case '@aws-sdk/client-bedrock-agentcore':
        return {
          BedrockAgentCoreClient: class {
            constructor() {
              throw new Error(
                'consumeHarnessStream must never construct an SDK client',
              );
            }
          },
          InvokeHarnessCommand: class {
            constructor() {
              throw new Error(
                'consumeHarnessStream must never construct an SDK command',
              );
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
// Model: the stream-projection contract from the requirements, restated
// independently of the implementation.
//
// - 9.1: every `contentBlockDelta` carrying non-empty text is written to
//   stdout in event order, so joined stdout equals the ordered
//   concatenation of exactly those texts.
// - 9.2: `messageStart`, `contentBlockStart`, `contentBlockStop`, and
//   `messageStop` are recognized (summary flags/counters) without any
//   serialized event object reaching either channel.
// - 9.3: each `metadata` event produces exactly one stderr diagnostic line
//   containing the metadata JSON, in event order, and nothing on stdout.
// - 9.4: a sequence completing after `messageStop` without an error event
//   RESOLVES (the CLI's zero-exit precondition), even when metadata or
//   unknown events trail `messageStop`.
// - 9.10: event kinds not modeled by the pinned SDK - `$unknown` tuples
//   and unmodeled keys - contribute NOTHING to stdout or stderr.
//
// Sequences are generated constructively as tagged items, so every
// expectation below follows from the construction tags, never from the
// projection logic under test.
// ---------------------------------------------------------------------------

type TaggedItem =
  | { tag: 'messageStart' }
  | { tag: 'blockStart'; index: number }
  | { tag: 'delta'; index: number; text: string | undefined }
  | { tag: 'blockStop'; index: number }
  | { tag: 'messageStop' }
  | { tag: 'metadata'; payload: Record<string, unknown> }
  | { tag: 'unknown'; event: Record<string, unknown> };

/** A generated run: the final tagged sequence plus construction facts. */
interface StreamCase {
  hasMessageStart: boolean;
  blockCount: number;
  sequence: TaggedItem[];
}

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
  }
};

/** Yield the raw events one at a time, like a real SDK event stream. */
const toStream = (
  events: ReadonlyArray<Record<string, unknown>>,
): AsyncIterable<Record<string, unknown>> => ({
  async *[Symbol.asyncIterator]() {
    for (const event of events) {
      yield event;
    }
  },
});

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Delta payload texts: arbitrary Unicode graphemes plus targeted
 * whitespace-only, empty, multi-codepoint, and missing-text shapes.
 * `undefined` renders a `contentBlockDelta` without a `delta.text` value;
 * like the empty string it must contribute nothing to stdout and must not
 * count as a written text delta. Generated texts never contain the
 * `[object` sentinel so the serialization guard below cannot false-positive.
 */
const arbDeltaText: fc.Arbitrary<string | undefined> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .string({ unit: 'grapheme', maxLength: 12 })
      .filter((text) => !text.includes('[object')),
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

/**
 * Metadata payloads: JSON-serializable usage/metrics/trace shapes built
 * from fixed keys, numbers, and hex strings, so their JSON never contains
 * the `[object` sentinel.
 */
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
 * unmodeled keys. None of these objects carries a recognized member key,
 * so Requirement 9.10 demands complete silence on both channels.
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

/** Noise items interleaved into the completing core sequence. */
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

/**
 * One valid completing stream case. The core sequence is an optional
 * `messageStart`, N in-order content blocks, and a final `messageStop`.
 * Interleaved noise items are inserted at arbitrary clamped slots before,
 * between, and after blocks (slots at or past the core length land after
 * `messageStop`), and a dedicated trailing batch guarantees frequent
 * metadata/unknown coverage after `messageStop`.
 */
const arbStreamCase: fc.Arbitrary<StreamCase> = fc
  .tuple(
    fc.oneof(
      { weight: 4, arbitrary: fc.constant(true) },
      { weight: 1, arbitrary: fc.constant(false) },
    ),
    fc.array(arbBlock, { maxLength: 4 }),
    fc.array(fc.tuple(arbNoiseItem, fc.nat({ max: 30 })), { maxLength: 6 }),
    fc.array(arbNoiseItem, { maxLength: 3 }),
  )
  .map(([hasMessageStart, blocks, interleaved, trailing]) => {
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
    core.push({ tag: 'messageStop' });

    // Bucket each noise item into its clamped slot: slot i lands before
    // core item i, slot core.length lands after messageStop. Insertion is
    // stable, so noise order within one slot is preserved.
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

    return { hasMessageStart, blockCount: blocks.length, sequence };
  });

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('agentcore-harness stream projection (Property 13)', () => {
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

  // Feature: agentcore-harness-generator, Property 13: Stream projection preserves text order and channel separation
  // **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.10**
  it('projects every valid completing sequence onto ordered stdout text, ordered metadata diagnostics, silence for lifecycle and unknown events, and a completed summary', async () => {
    await fc.assert(
      fc.asyncProperty(arbStreamCase, async (streamCase) => {
        const { hasMessageStart, blockCount, sequence } = streamCase;

        // Expected outcomes derive from the construction tags alone.
        const writtenDeltaTexts = sequence.flatMap((item) =>
          item.tag === 'delta' && item.text ? [item.text] : [],
        );
        const expectedStdout = writtenDeltaTexts.join('');
        const expectedMetadataPayloads = sequence.flatMap((item) =>
          item.tag === 'metadata' ? [item.payload] : [],
        );
        const expectedSummary: StreamSummary = {
          sawMessageStart: hasMessageStart,
          sawMessageStop: true,
          contentBlockCount: blockCount,
          textDeltaCount: writtenDeltaTexts.length,
          metadataEventCount: expectedMetadataPayloads.length,
        };

        const stdout: string[] = [];
        const stderr: string[] = [];
        const io: HarnessStreamIo = {
          writeStdout: (text) => {
            stdout.push(text);
          },
          writeStderr: (text) => {
            stderr.push(text);
          },
        };

        // 9.4: a valid completing sequence RESOLVES - the zero-exit
        // precondition - even with metadata or unknown events trailing
        // messageStop; any rejection fails the property here.
        const summary = await client.consumeHarnessStream(
          toStream(sequence.map(toEvent)),
          io,
        );

        // 9.1: joined stdout is EXACTLY the ordered concatenation of the
        // non-empty delta texts; lifecycle, metadata, unknown, empty, and
        // missing-text events contribute nothing (9.2, 9.3, 9.10).
        expect(stdout.join('')).toBe(expectedStdout);

        // 9.3: exactly one stderr diagnostic line per metadata event, in
        // event order, carrying that payload's JSON - and nothing else on
        // stderr, so lifecycle and unknown events are silent there too
        // (9.2, 9.10).
        expect(stderr).toEqual(
          expectedMetadataPayloads.map(
            (payload) => `Harness metadata: ${JSON.stringify(payload)}\n`,
          ),
        );

        // 9.2/9.10: no accidental default object serialization reaches
        // either channel (generated texts never contain the sentinel).
        for (const chunk of [...stdout, ...stderr]) {
          expect(chunk).not.toContain('[object');
        }

        // 9.2/9.4: the summary records recognition of every lifecycle
        // event and successful completion: messageStart per presence,
        // messageStop true, one contentBlockStart per generated block,
        // written text deltas only, and one count per metadata event.
        expect(summary).toEqual(expectedSummary);
      }),
      // At least 150 runs required by the task; each run is one direct
      // call against the transpiled module with an in-memory async
      // generator, so 200 runs stay fast.
      { numRuns: 200 },
    );
  });
});
