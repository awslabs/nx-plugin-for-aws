/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Invocation Client example and boundary tests.
 *
 * Validates: Requirements 7.8, 8.1-8.10, 9.1-9.10, 11.5, 11.6, 14.4
 *
 * The generated Invocation Client is template output, so these tests run
 * the generator ONCE, read the rendered `invoke-harness.ts` and `invoke.ts`
 * from the tree, transpile the rendered TypeScript to CommonJS, and
 * evaluate it with stubbed module imports (`node:crypto`, the Powertools
 * AppConfig reader, and the AgentCore SDK client/command). That makes the
 * REAL generated functions directly callable, and every collaborator -
 * Runtime Configuration, UUID generation, the SDK client and its event
 * stream, stdout, and stderr - is mocked through the client's dependency
 * injection seam (`RunHarnessCliDeps`) plus the stubbed imports:
 *
 * - `invoke-harness.ts` exports `resolveHarnessArn`, `resolveSessionId`,
 *   `parseHarnessRegion`, `consumeHarnessStream`, and `runHarnessCli`,
 *   which the tests exercise with recording fakes.
 * - `invoke.ts` is top-level CLI code, so each test evaluates it with a
 *   synthetic `process` (argv/exitCode) and `console`, verifying the
 *   deterministic argv join/trim and the throw-to-exit-code-1 wrapper
 *   behaviourally rather than by content inspection.
 *
 * No AWS endpoint, credential source, or real stream is ever contacted.
 */
import ts from 'typescript';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Generated identity: name 'my-harness' -> class 'MyHarness'. */
const RUNTIME_CONFIG_KEY = 'MyHarness';
const PROJECT_ROOT = 'packages/my-harness';
const INVOKE_TARGET = 'nx run @proj/my-harness:invoke';

const HARNESS_ARN =
  'arn:aws:bedrock-agentcore:us-west-2:123456789012:harness/my-harness-abc';

/** UUID returned by the injected generator (36 chars, inside 33-100). */
const STUB_UUID = '00000000-0000-4000-8000-000000000000';
/** UUID returned by the stubbed module-level `node:crypto` import. */
const MODULE_CRYPTO_UUID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

// Modeled stream events, shaped as the pinned SDK union members.
const MESSAGE_START = { messageStart: { role: 'assistant' } };
const CONTENT_BLOCK_START = { contentBlockStart: { contentBlockIndex: 0 } };
const CONTENT_BLOCK_STOP = { contentBlockStop: { contentBlockIndex: 0 } };
const MESSAGE_STOP = { messageStop: { stopReason: 'end_turn' } };
const textDelta = (text: string) => ({
  contentBlockDelta: { contentBlockIndex: 0, delta: { text } },
});
const metadataEvent = (value: Record<string, unknown>) => ({
  metadata: value,
});

/** Default happy-path stream used when a test does not supply events. */
const SUCCESS_EVENTS: ReadonlyArray<Record<string, unknown>> = [
  MESSAGE_START,
  CONTENT_BLOCK_START,
  textDelta('Hello'),
  CONTENT_BLOCK_STOP,
  MESSAGE_STOP,
];

// ---------------------------------------------------------------------------
// Rendered-module evaluation
// ---------------------------------------------------------------------------

interface HarnessEnv {
  HARNESS_ARN?: string;
  HARNESS_SESSION_ID?: string;
  RUNTIME_CONFIG_APP_ID?: string;
}

interface StreamIo {
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}

interface StreamSummary {
  sawMessageStart: boolean;
  sawMessageStop: boolean;
  contentBlockCount: number;
  textDeltaCount: number;
  metadataEventCount: number;
}

/** Typed view of the evaluated `invoke-harness.ts` exports. */
interface InvocationClientModule {
  resolveHarnessArn(
    env: HarnessEnv,
    readRuntimeConfig: (application: string) => Promise<unknown>,
  ): Promise<string>;
  resolveSessionId(env: HarnessEnv, randomUuid: () => string): string;
  parseHarnessRegion(harnessArn: string): string;
  consumeHarnessStream(
    stream: AsyncIterable<Record<string, unknown>>,
    io: StreamIo,
  ): Promise<StreamSummary>;
  runHarnessCli(
    prompt: string,
    deps?: Record<string, unknown>,
  ): Promise<number>;
}

/** Records every `new InvokeHarnessCommand(input)` the client constructs. */
class RecordedInvokeHarnessCommand {
  constructor(readonly input: Record<string, unknown>) {}
}

/** Call records for the stubbed module-level imports. */
const moduleImports = {
  cryptoUuidCalls: 0,
  getAppConfigCalls: [] as unknown[][],
  getAppConfigResult: undefined as unknown,
  sdkClientConfigs: [] as unknown[],
};

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
 * its real exports. The stubs cover the DEFAULT dependency fallbacks; tests
 * inject the mocked collaborators through `RunHarnessCliDeps` unless a test
 * exercises a default (e.g. the AppConfig reader convention).
 */
const evaluateInvokeHarnessModule = (
  source: string,
): InvocationClientModule => {
  const requireStub = (specifier: string): unknown => {
    switch (specifier) {
      case 'node:crypto':
        return {
          randomUUID: () => {
            moduleImports.cryptoUuidCalls += 1;
            return MODULE_CRYPTO_UUID;
          },
        };
      case '@aws-lambda-powertools/parameters/appconfig':
        return {
          getAppConfig: (...args: unknown[]) => {
            moduleImports.getAppConfigCalls.push(args);
            return Promise.resolve(moduleImports.getAppConfigResult);
          },
        };
      case '@aws-sdk/client-bedrock-agentcore':
        return {
          BedrockAgentCoreClient: class {
            constructor(config: unknown) {
              moduleImports.sdkClientConfigs.push(config);
            }
            send(): Promise<never> {
              return Promise.reject(
                new Error('the real SDK client must not be used in tests'),
              );
            }
          },
          InvokeHarnessCommand: RecordedInvokeHarnessCommand,
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
// Recording collaborators for runHarnessCli
// ---------------------------------------------------------------------------

interface RunOptions {
  env: HarnessEnv;
  /** Resolved Runtime Configuration document (any shape). */
  runtimeConfig?: unknown;
  /** Stream events; SUCCESS_EVENTS when omitted. */
  events?: ReadonlyArray<Record<string, unknown>>;
  /** Resolve the send() with no `stream` property. */
  missingStream?: boolean;
  /** Reject the send() call itself. */
  sendRejection?: Error;
  uuid?: string;
}

interface RunRecorder {
  stdout: string[];
  stderr: string[];
  uuidCalls: number;
  readCalls: string[];
  createdRegions: string[];
  sentCommands: RecordedInvokeHarnessCommand[];
  consumedEvents: Record<string, unknown>[];
}

/**
 * Build a full `RunHarnessCliDeps` object whose collaborators (Runtime
 * Configuration reader, UUID generator, SDK client/send, event stream,
 * stdout, stderr) record every interaction.
 */
const makeRun = (options: RunOptions) => {
  const recorder: RunRecorder = {
    stdout: [],
    stderr: [],
    uuidCalls: 0,
    readCalls: [],
    createdRegions: [],
    sentCommands: [],
    consumedEvents: [],
  };
  const events = options.events ?? SUCCESS_EVENTS;
  const deps = {
    env: options.env,
    io: {
      writeStdout: (text: string) => {
        recorder.stdout.push(text);
      },
      writeStderr: (text: string) => {
        recorder.stderr.push(text);
      },
    },
    randomUuid: () => {
      recorder.uuidCalls += 1;
      return options.uuid ?? STUB_UUID;
    },
    readRuntimeConfig: (application: string): Promise<unknown> => {
      recorder.readCalls.push(application);
      return Promise.resolve(options.runtimeConfig);
    },
    createClient: (region: string) => {
      recorder.createdRegions.push(region);
      return {
        send: async (command: RecordedInvokeHarnessCommand) => {
          recorder.sentCommands.push(command);
          if (options.sendRejection) {
            throw options.sendRejection;
          }
          if (options.missingStream) {
            return {};
          }
          return {
            stream: {
              async *[Symbol.asyncIterator]() {
                for (const event of events) {
                  recorder.consumedEvents.push(event);
                  yield event;
                }
              },
            },
          };
        },
      };
    },
  };
  return { deps, recorder };
};

/** Recording io plus a driven async iterable for consumeHarnessStream. */
const recordingIo = () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      writeStdout: (text: string) => {
        stdout.push(text);
      },
      writeStderr: (text: string) => {
        stderr.push(text);
      },
    },
  };
};

const asyncStream = (events: ReadonlyArray<Record<string, unknown>>) => {
  const consumed: Record<string, unknown>[] = [];
  return {
    consumed,
    stream: {
      async *[Symbol.asyncIterator]() {
        for (const event of events) {
          consumed.push(event);
          yield event;
        }
      },
    },
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agentcore-harness invocation client', () => {
  let renderedImpl: string;
  let cliJs: string;
  let client: InvocationClientModule;

  beforeAll(async () => {
    // One real generator run renders both Invocation Client files;
    // `infra: none` keeps the run project-only.
    const tree = createTreeUsingTsSolutionSetup();
    await agentcoreHarnessGenerator(tree, {
      name: 'my-harness',
      infra: 'none',
    });

    renderedImpl = tree.read(
      `${PROJECT_ROOT}/invoke-harness.ts`,
      'utf-8',
    ) as string;
    const renderedCli = tree.read(
      `${PROJECT_ROOT}/invoke.ts`,
      'utf-8',
    ) as string;
    expect(renderedImpl).toBeTruthy();
    expect(renderedCli).toBeTruthy();

    client = evaluateInvokeHarnessModule(renderedImpl);
    cliJs = transpileToCjs(renderedCli);
  });

  beforeEach(() => {
    moduleImports.cryptoUuidCalls = 0;
    moduleImports.getAppConfigCalls = [];
    moduleImports.getAppConfigResult = undefined;
    moduleImports.sdkClientConfigs = [];
  });

  /**
   * Evaluate the rendered `invoke.ts` CLI wrapper with a synthetic process
   * (argv/exitCode), a synthetic console, and the supplied runHarnessCli
   * implementation, then wait for its promise chain to settle.
   */
  const runCliWrapper = async (
    argv: readonly string[],
    runHarnessCli: (prompt: string) => Promise<number>,
  ) => {
    const prompts: string[] = [];
    const consoleErrors: string[] = [];
    const fakeProcess = {
      argv: ['node', 'invoke.ts', ...argv],
      exitCode: undefined as number | undefined,
    };
    const requireStub = (specifier: string): unknown => {
      if (specifier === './invoke-harness') {
        return {
          runHarnessCli: (prompt: string) => {
            prompts.push(prompt);
            return runHarnessCli(prompt);
          },
        };
      }
      throw new Error(`unexpected import '${specifier}' in rendered invoke.ts`);
    };
    const exportsObject: Record<string, unknown> = {};
    new Function('require', 'exports', 'module', 'process', 'console', cliJs)(
      requireStub,
      exportsObject,
      { exports: exportsObject },
      fakeProcess,
      { error: (message: unknown) => consoleErrors.push(String(message)) },
    );
    // The wrapper settles through .then/.catch microtasks; one macrotask
    // flush guarantees completion for immediately-settling implementations.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { prompts, consoleErrors, exitCode: fakeProcess.exitCode };
  };

  describe('Harness ARN discovery', () => {
    // Requirement 8.1: direct HARNESS_ARN wins without Runtime Configuration.
    it('uses a non-empty HARNESS_ARN without reading Runtime Configuration', async () => {
      const { deps, recorder } = makeRun({ env: { HARNESS_ARN } });

      await expect(client.runHarnessCli('hi', deps)).resolves.toBe(0);

      expect(recorder.readCalls).toEqual([]);
      expect(recorder.sentCommands[0]?.input.harnessArn).toBe(HARNESS_ARN);
    });

    // Requirement 8.2: fallback discovery reads exactly
    // agentcore.harnesses.<ClassName> for the configured application.
    it('falls back to the Runtime Configuration Key when HARNESS_ARN is absent', async () => {
      const { deps, recorder } = makeRun({
        env: { RUNTIME_CONFIG_APP_ID: 'app-123' },
        runtimeConfig: {
          harnesses: {
            [RUNTIME_CONFIG_KEY]: HARNESS_ARN,
            OtherHarness: 'arn:aws:bedrock-agentcore:eu-west-1:1:harness/other',
          },
          gateways: { SomeGateway: 'arn:aws:other' },
        },
      });

      await expect(client.runHarnessCli('hi', deps)).resolves.toBe(0);

      expect(recorder.readCalls).toEqual(['app-123']);
      expect(recorder.sentCommands[0]?.input.harnessArn).toBe(HARNESS_ARN);
    });

    // Requirement 8.1 boundary: empty string is absent, not a direct ARN.
    it('treats an empty-string HARNESS_ARN as absent and falls back', async () => {
      const { deps, recorder } = makeRun({
        env: { HARNESS_ARN: '', RUNTIME_CONFIG_APP_ID: 'app-123' },
        runtimeConfig: { harnesses: { [RUNTIME_CONFIG_KEY]: HARNESS_ARN } },
      });

      await expect(client.runHarnessCli('hi', deps)).resolves.toBe(0);

      expect(recorder.readCalls).toEqual(['app-123']);
      expect(recorder.sentCommands[0]?.input.harnessArn).toBe(HARNESS_ARN);
    });

    // Requirement 8.3: missing both sources names both remediation options.
    it.each([
      ['both variables unset', {}],
      [
        'both variables empty strings',
        { HARNESS_ARN: '', RUNTIME_CONFIG_APP_ID: '' },
      ],
    ])('fails naming HARNESS_ARN and RUNTIME_CONFIG_APP_ID when %s', async (_case, env: HarnessEnv) => {
      const { deps, recorder } = makeRun({ env });

      await expect(client.runHarnessCli('hi', deps)).rejects.toThrow(
        /HARNESS_ARN[\s\S]*RUNTIME_CONFIG_APP_ID/,
      );

      expect(recorder.readCalls).toEqual([]);
      expect(recorder.createdRegions).toEqual([]);
      expect(recorder.sentCommands).toEqual([]);
    });

    // Requirement 11.5: a lookup result lacking the generated Harness entry
    // identifies the exact missing Runtime Configuration Key.
    it.each([
      ['an empty document', {}],
      ['an empty harnesses map', { harnesses: {} }],
      [
        'a sibling-only harnesses map',
        { harnesses: { OtherHarness: 'arn:aws:x' } },
      ],
      [
        'an empty-string harness value',
        { harnesses: { [RUNTIME_CONFIG_KEY]: '' } },
      ],
      ['a null document', null],
      ['an undefined document', undefined],
    ])('identifies agentcore.harnesses.%s in the diagnostic for %s', async (_case, runtimeConfig) => {
      const { deps, recorder } = makeRun({
        env: { RUNTIME_CONFIG_APP_ID: 'app-123' },
        runtimeConfig,
      });

      await expect(client.runHarnessCli('hi', deps)).rejects.toThrow(
        `agentcore.harnesses.${RUNTIME_CONFIG_KEY}`,
      );

      expect(recorder.readCalls).toEqual(['app-123']);
      expect(recorder.createdRegions).toEqual([]);
      expect(recorder.sentCommands).toEqual([]);
    });

    // Requirement 8.2: the default reader follows the repository AppConfig
    // convention (agentcore document, application ID, default environment,
    // JSON transform).
    it('reads Runtime Configuration through the AppConfig convention by default', async () => {
      moduleImports.getAppConfigResult = {
        harnesses: { [RUNTIME_CONFIG_KEY]: HARNESS_ARN },
      };
      const { deps, recorder } = makeRun({
        env: { RUNTIME_CONFIG_APP_ID: 'app-42' },
      });
      // Drop the injected reader so the rendered default applies.
      const { readRuntimeConfig: _omitted, ...depsWithDefaultReader } = deps;

      await expect(
        client.runHarnessCli('hi', depsWithDefaultReader),
      ).resolves.toBe(0);

      expect(moduleImports.getAppConfigCalls).toEqual([
        [
          'agentcore',
          { application: 'app-42', environment: 'default', transform: 'json' },
        ],
      ]);
      expect(recorder.sentCommands[0]?.input.harnessArn).toBe(HARNESS_ARN);
    });
  });

  describe('prompt normalization and request mapping', () => {
    // Requirement 8.8: deterministic argv join/trim in the rendered CLI.
    it.each([
      [['a', 'b', 'c'], 'a b c'],
      [['  hi  '], 'hi'],
      [['hello   world'], 'hello   world'],
      [['a', '', 'b'], 'a  b'],
      [[' leading', 'trailing '], 'leading trailing'],
      [[], ''],
    ])('the CLI wrapper joins argv %j into prompt %j', async (argv: string[], expected: string) => {
      const { prompts, exitCode } = await runCliWrapper(argv, () =>
        Promise.resolve(0),
      );

      expect(prompts).toEqual([expected]);
      expect(exitCode).toBe(0);
    });

    // Requirement 8.9: a blank prompt fails with usage guidance before any
    // collaborator (UUID, Runtime Configuration, SDK client) is called.
    it.each([
      [''],
      ['   \t\n  '],
    ])('rejects blank prompt %j with usage guidance before any AWS access', async (prompt) => {
      const { deps, recorder } = makeRun({
        env: { HARNESS_ARN, RUNTIME_CONFIG_APP_ID: 'app-123' },
      });

      await expect(client.runHarnessCli(prompt, deps)).rejects.toThrow(
        INVOKE_TARGET,
      );

      expect(recorder.uuidCalls).toBe(0);
      expect(recorder.readCalls).toEqual([]);
      expect(recorder.createdRegions).toEqual([]);
      expect(recorder.sentCommands).toEqual([]);
    });

    // Requirement 8.8: the normalized prompt is preserved exactly as one
    // user message with one text block in one request.
    it.each([
      ['unicode', 'こんにちは 世界 – Grüße'],
      ['quotes and backslashes', 'she said "hi" and \'bye\' C:\\path\\x'],
      ['embedded newlines', 'line one\nline two\r\nline three'],
      ['emoji', 'rocket 🚀 sparkles ✨'],
      ['interpolation-like text', `weird \${jndi} \`backticks\` $(subshell)`],
    ])('preserves a %s prompt exactly in the request', async (_case, prompt) => {
      const { deps, recorder } = makeRun({ env: { HARNESS_ARN } });

      await expect(client.runHarnessCli(prompt, deps)).resolves.toBe(0);

      expect(recorder.sentCommands).toHaveLength(1);
      const command = recorder.sentCommands[0];
      expect(command).toBeInstanceOf(RecordedInvokeHarnessCommand);
      expect(command.input.messages).toEqual([
        { role: 'user', content: [{ text: prompt }] },
      ]);
    });

    // Requirement 8.8: exactly one InvokeHarness request with exactly the
    // three modeled input properties.
    it('sends exactly one command containing only harnessArn, runtimeSessionId and messages', async () => {
      const { deps, recorder } = makeRun({ env: { HARNESS_ARN } });

      await expect(client.runHarnessCli('hello', deps)).resolves.toBe(0);

      expect(recorder.sentCommands).toHaveLength(1);
      const input = recorder.sentCommands[0].input;
      expect(Object.keys(input).sort()).toEqual([
        'harnessArn',
        'messages',
        'runtimeSessionId',
      ]);
      expect(input.harnessArn).toBe(HARNESS_ARN);
      expect(input.runtimeSessionId).toBe(STUB_UUID);
    });
  });

  describe('Runtime Session ID resolution', () => {
    // Requirement 8.6 boundary: 32 characters is rejected before Runtime
    // Configuration lookup or SDK access.
    it.each([
      [32, 's'.repeat(32)],
      [101, 'l'.repeat(101)],
    ])('rejects a %i-character session ID before any AWS access', async (length, sessionId) => {
      const { deps, recorder } = makeRun({
        env: {
          HARNESS_SESSION_ID: sessionId,
          RUNTIME_CONFIG_APP_ID: 'app-123',
        },
        runtimeConfig: { harnesses: { [RUNTIME_CONFIG_KEY]: HARNESS_ARN } },
      });

      await expect(client.runHarnessCli('hi', deps)).rejects.toThrow(
        new RegExp(`33[\\s\\S]*100[\\s\\S]*${length}`),
      );

      expect(recorder.readCalls).toEqual([]);
      expect(recorder.createdRegions).toEqual([]);
      expect(recorder.sentCommands).toEqual([]);
      expect(recorder.uuidCalls).toBe(0);
    });

    // Requirement 8.4 boundaries: 33 and 100 characters are reused verbatim.
    it.each([
      [33, 'x'.repeat(33)],
      [100, 'y'.repeat(100)],
    ])('reuses a %i-character session ID verbatim without generating a UUID', async (_length, sessionId) => {
      const { deps, recorder } = makeRun({
        env: { HARNESS_ARN, HARNESS_SESSION_ID: sessionId },
      });

      await expect(client.runHarnessCli('hi', deps)).resolves.toBe(0);

      expect(recorder.uuidCalls).toBe(0);
      expect(recorder.sentCommands[0]?.input.runtimeSessionId).toBe(sessionId);
    });

    // Requirement 8.5: an absent (or empty) value generates exactly one UUID.
    it.each([
      ['absent', undefined],
      ['empty-string', ''],
    ])('generates the UUID exactly once for an %s HARNESS_SESSION_ID', async (_case, sessionId) => {
      const { deps, recorder } = makeRun({
        env: { HARNESS_ARN, HARNESS_SESSION_ID: sessionId },
      });

      await expect(client.runHarnessCli('hi', deps)).resolves.toBe(0);

      expect(recorder.uuidCalls).toBe(1);
      expect(recorder.sentCommands[0]?.input.runtimeSessionId).toBe(STUB_UUID);
    });

    // Requirement 8.7: the reusable session ID is reported on stderr,
    // separately from streamed response text on stdout.
    it.each([
      ['generated', undefined, STUB_UUID],
      ['supplied', 'z'.repeat(40), 'z'.repeat(40)],
    ])('writes the %s session ID to stderr and never stdout', async (_case, sessionId, expected) => {
      const { deps, recorder } = makeRun({
        env: { HARNESS_ARN, HARNESS_SESSION_ID: sessionId },
      });

      await expect(client.runHarnessCli('hi', deps)).resolves.toBe(0);

      expect(
        recorder.stderr.some((line) =>
          line.includes(`Harness session: ${expected}`),
        ),
      ).toBe(true);
      expect(recorder.stdout.join('')).not.toContain(expected);
    });
  });

  describe('Region derivation and client construction', () => {
    // Requirement 8.10: partition-independent Region extraction.
    it.each([
      [
        'arn:aws:bedrock-agentcore:us-west-2:123456789012:harness/x',
        'us-west-2',
      ],
      [
        'arn:aws-cn:bedrock-agentcore:cn-north-1:123456789012:harness/x',
        'cn-north-1',
      ],
      [
        'arn:aws-us-gov:bedrock-agentcore:us-gov-west-1:123456789012:harness/x',
        'us-gov-west-1',
      ],
    ])('derives the Region of %s as %s', (arn, region) => {
      expect(client.parseHarnessRegion(arn)).toBe(region);
    });

    // Requirement 8.10: the client is constructed with the derived Region.
    it('constructs the SDK client with the ARN-derived Region', async () => {
      const { deps, recorder } = makeRun({
        env: {
          HARNESS_ARN:
            'arn:aws-cn:bedrock-agentcore:cn-north-1:123456789012:harness/x',
        },
      });

      await expect(client.runHarnessCli('hi', deps)).resolves.toBe(0);

      expect(recorder.createdRegions).toEqual(['cn-north-1']);
    });

    // Requirement 11.6: malformed or regionless ARNs fail with an ARN
    // diagnostic before any SDK client exists.
    it.each([
      ['not-an-arn'],
      ['arn:aws:bedrock-agentcore::123456789012:harness/x'],
      ['arn:aws:bedrock-agentcore:us-west-2'],
      ['arn:aws:bedrock-agentcore:bad region:123456789012:harness/x'],
      ['xrn:aws:bedrock-agentcore:us-west-2:123456789012:harness/x'],
    ])('rejects unusable ARN %j before constructing a client', async (arn) => {
      const { deps, recorder } = makeRun({ env: { HARNESS_ARN: arn } });

      await expect(client.runHarnessCli('hi', deps)).rejects.toThrow(/Region/i);

      expect(recorder.createdRegions).toEqual([]);
      expect(recorder.sentCommands).toEqual([]);
    });

    // Requirement 7.8: the rendered client configuration contains only the
    // derived region - no explicit credentials property, so the standard
    // AWS SDK credential provider chain applies.
    it('renders a client configured with only { region } and no credential material', () => {
      expect(renderedImpl).toContain('new BedrockAgentCoreClient({ region })');
      expect(renderedImpl.split('new BedrockAgentCoreClient').length - 1).toBe(
        1,
      );
    });

    // Requirement 9.8: the client performs the InvokeHarness Data Plane
    // operation only - no Control Plane command is referenced.
    it('references only the InvokeHarness Data Plane command', () => {
      expect(renderedImpl).toContain('InvokeHarnessCommand');
      for (const controlPlaneCommand of [
        'CreateHarness',
        'GetHarness',
        'UpdateHarness',
        'DeleteHarness',
        'ListHarnesses',
      ]) {
        expect(renderedImpl).not.toContain(controlPlaneCommand);
      }
    });
  });

  describe('event stream consumption', () => {
    // Requirements 9.1, 9.2, 9.3: every modeled event kind in one complete
    // stream - ordered text on stdout, lifecycle recognition, metadata on
    // stderr, and an accurate protocol summary.
    it('handles every modeled event kind with ordered stdout text', async () => {
      const { io, stdout, stderr } = recordingIo();
      const usage = { usage: { inputTokens: 3, outputTokens: 7 } };
      const { stream } = asyncStream([
        MESSAGE_START,
        CONTENT_BLOCK_START,
        textDelta('Hello, '),
        textDelta('world'),
        CONTENT_BLOCK_STOP,
        MESSAGE_STOP,
        metadataEvent(usage),
      ]);

      const summary = await client.consumeHarnessStream(stream, io);

      expect(stdout).toEqual(['Hello, ', 'world']);
      expect(stderr).toHaveLength(1);
      expect(stderr[0]).toContain(JSON.stringify(usage));
      expect(summary).toEqual({
        sawMessageStart: true,
        sawMessageStop: true,
        contentBlockCount: 1,
        textDeltaCount: 2,
        metadataEventCount: 1,
      });
    });

    // Requirement 9.1 boundary: deltas without usable text are skipped.
    it('skips contentBlockDelta events with missing or empty text', async () => {
      const { io, stdout } = recordingIo();
      const { stream } = asyncStream([
        MESSAGE_START,
        { contentBlockDelta: { contentBlockIndex: 0 } },
        { contentBlockDelta: { contentBlockIndex: 0, delta: {} } },
        textDelta(''),
        textDelta('real'),
        MESSAGE_STOP,
      ]);

      const summary = await client.consumeHarnessStream(stream, io);

      expect(stdout).toEqual(['real']);
      expect(summary.textDeltaCount).toBe(1);
    });

    // Requirement 9.2: lifecycle events are recognized without serializing
    // anything to either channel.
    it('recognizes lifecycle events without writing them to any channel', async () => {
      const { io, stdout, stderr } = recordingIo();
      const { stream } = asyncStream([
        MESSAGE_START,
        CONTENT_BLOCK_START,
        CONTENT_BLOCK_STOP,
        MESSAGE_STOP,
      ]);

      const summary = await client.consumeHarnessStream(stream, io);

      expect(stdout).toEqual([]);
      expect(stderr).toEqual([]);
      expect(summary.sawMessageStart).toBe(true);
      expect(summary.contentBlockCount).toBe(1);
      expect(summary.sawMessageStop).toBe(true);
    });

    // Requirement 9.3: metadata goes to stderr both before and after
    // messageStop, never interleaving stdout.
    it('routes metadata to stderr before and after messageStop', async () => {
      const { io, stdout, stderr } = recordingIo();
      const before = { usage: { inputTokens: 1 } };
      const after = { metrics: { latencyMs: 42 } };
      const { stream } = asyncStream([
        MESSAGE_START,
        metadataEvent(before),
        textDelta('x'),
        MESSAGE_STOP,
        metadataEvent(after),
      ]);

      const summary = await client.consumeHarnessStream(stream, io);

      expect(stdout).toEqual(['x']);
      expect(stderr).toHaveLength(2);
      expect(stderr[0]).toContain(JSON.stringify(before));
      expect(stderr[1]).toContain(JSON.stringify(after));
      expect(summary.metadataEventCount).toBe(2);
      expect(summary.sawMessageStop).toBe(true);
    });

    // Requirement 9.10: unknown event kinds are ignored silently on both
    // channels ($unknown union tuples and unmodeled event keys alike).
    it('ignores unknown event kinds without writing to stdout or stderr', async () => {
      const { io, stdout, stderr } = recordingIo();
      const { stream } = asyncStream([
        MESSAGE_START,
        { $unknown: ['someFutureEventKind', { data: 42 }] },
        textDelta('kept'),
        { someUnmodeledEvent: { detail: 'ignored' } },
        MESSAGE_STOP,
      ]);

      const summary = await client.consumeHarnessStream(stream, io);

      expect(stdout).toEqual(['kept']);
      expect(stderr).toEqual([]);
      expect(summary).toEqual({
        sawMessageStart: true,
        sawMessageStop: true,
        contentBlockCount: 0,
        textDeltaCount: 1,
        metadataEventCount: 0,
      });
    });
  });

  describe('stream failure semantics', () => {
    // Requirement 9.5: a response without an event stream fails actionably.
    it('fails when the Data Plane response has no event stream', async () => {
      const { deps, recorder } = makeRun({
        env: { HARNESS_ARN },
        missingStream: true,
      });

      await expect(client.runHarnessCli('hi', deps)).rejects.toThrow(
        /no event stream[\s\S]*InvokeHarness/,
      );

      expect(recorder.sentCommands).toHaveLength(1);
      expect(recorder.stdout.join('')).toBe('');
    });

    // Requirement 9.6: each modeled error event fails with service details
    // and stops stream consumption.
    it.each([
      ['internalServerException', 'InternalServerException', 'server exploded'],
      ['validationException', 'ValidationException', 'bad request input'],
      ['runtimeClientError', 'RuntimeClientError', 'client-side failure'],
    ])('fails with details for a %s event', async (key, name, message) => {
      const { io, stdout } = recordingIo();
      const { stream, consumed } = asyncStream([
        MESSAGE_START,
        { [key]: { name, message } },
        textDelta('never-reached'),
        MESSAGE_STOP,
      ]);

      await expect(client.consumeHarnessStream(stream, io)).rejects.toThrow(
        `Harness invocation failed: ${name}: ${message}`,
      );

      // Consumption stops at the error event.
      expect(consumed).toHaveLength(2);
      expect(stdout).toEqual([]);
    });

    // Requirement 9.6 fallback: an error event without name/message still
    // reports the serialized service details.
    it('serializes detail-less error events into the failure', async () => {
      const { io } = recordingIo();
      const { stream } = asyncStream([{ runtimeClientError: {} }]);

      await expect(client.consumeHarnessStream(stream, io)).rejects.toThrow(
        'Harness invocation failed: {}',
      );
    });

    // Requirement 9.9: completion without messageStop is an incomplete
    // stream and cannot report success.
    it('fails when the stream ends without a messageStop event', async () => {
      const { io } = recordingIo();
      const { stream } = asyncStream([
        MESSAGE_START,
        CONTENT_BLOCK_START,
        textDelta('partial'),
        CONTENT_BLOCK_STOP,
      ]);

      await expect(client.consumeHarnessStream(stream, io)).rejects.toThrow(
        /messageStop/,
      );
    });

    // Requirements 9.6, 9.9: text already streamed is preserved on stdout
    // when the stream subsequently fails.
    it.each([
      [
        'an error event',
        [
          MESSAGE_START,
          textDelta('kept '),
          textDelta('text'),
          {
            validationException: { name: 'ValidationException', message: 'x' },
          },
        ],
      ],
      [
        'an incomplete stream',
        [MESSAGE_START, textDelta('kept '), textDelta('text')],
      ],
    ])('preserves already streamed text when %s fails the run', async (_case, events: Record<
      string,
      unknown
    >[]) => {
      const { deps, recorder } = makeRun({ env: { HARNESS_ARN }, events });

      await expect(client.runHarnessCli('hi', deps)).rejects.toThrow();

      expect(recorder.stdout.join('')).toBe('kept text');
      // The success-path trailing newline is never written on failure.
      expect(recorder.stdout).not.toContain('\n');
    });

    // Requirement 9.7: SDK request rejections propagate with their details.
    it('propagates an SDK send rejection', async () => {
      const { deps, recorder } = makeRun({
        env: { HARNESS_ARN },
        sendRejection: new Error(
          'AccessDeniedException: not authorized to perform InvokeHarness',
        ),
      });

      await expect(client.runHarnessCli('hi', deps)).rejects.toThrow(
        'AccessDeniedException: not authorized to perform InvokeHarness',
      );

      expect(recorder.sentCommands).toHaveLength(1);
      expect(recorder.stdout.join('')).toBe('');
    });
  });

  describe('CLI wrapper exit behaviour', () => {
    // Requirement 9.4: a completed stream maps to exit code 0, and the
    // streamed text gains one trailing newline.
    it('maps a successful run to exit code 0 with a trailing stdout newline', async () => {
      const { deps, recorder } = makeRun({ env: { HARNESS_ARN } });

      const { prompts, consoleErrors, exitCode } = await runCliWrapper(
        ['Hello,', 'world'],
        (prompt) => client.runHarnessCli(prompt, deps),
      );

      expect(prompts).toEqual(['Hello, world']);
      expect(exitCode).toBe(0);
      expect(consoleErrors).toEqual([]);
      expect(recorder.stdout.join('')).toBe('Hello\n');
      expect(recorder.sentCommands[0]?.input.messages).toEqual([
        { role: 'user', content: [{ text: 'Hello, world' }] },
      ]);
    });

    // Requirements 8.9, 9.6: end-to-end non-zero behaviour - every thrown
    // failure becomes one stderr diagnostic and exit code 1.
    it('maps a blank normalized prompt to usage guidance and exit code 1', async () => {
      const { deps, recorder } = makeRun({ env: { HARNESS_ARN } });

      const { consoleErrors, exitCode } = await runCliWrapper(
        ['   ', '\t'],
        (prompt) => client.runHarnessCli(prompt, deps),
      );

      expect(exitCode).toBe(1);
      expect(consoleErrors).toHaveLength(1);
      expect(consoleErrors[0]).toContain(INVOKE_TARGET);
      expect(recorder.sentCommands).toEqual([]);
    });

    it('maps a failed stream to exit code 1 while preserving streamed text', async () => {
      const { deps, recorder } = makeRun({
        env: { HARNESS_ARN },
        events: [
          MESSAGE_START,
          textDelta('partial'),
          {
            internalServerException: {
              name: 'InternalServerException',
              message: 'boom',
            },
          },
        ],
      });

      const { consoleErrors, exitCode } = await runCliWrapper(
        ['hi'],
        (prompt) => client.runHarnessCli(prompt, deps),
      );

      expect(exitCode).toBe(1);
      expect(consoleErrors).toHaveLength(1);
      expect(consoleErrors[0]).toContain(
        'Harness invocation failed: InternalServerException: boom',
      );
      expect(recorder.stdout.join('')).toBe('partial');
    });

    // Defensive wrapper coverage: non-Error rejections still map to one
    // diagnostic and exit code 1.
    it('maps a non-Error rejection to exit code 1', async () => {
      const { consoleErrors, exitCode } = await runCliWrapper(['hi'], () =>
        Promise.reject('string-failure'),
      );

      expect(exitCode).toBe(1);
      expect(consoleErrors).toEqual(['string-failure']);
    });
  });
});
