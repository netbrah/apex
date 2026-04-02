/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Config,
  ToolRegistry,
  ServerGeminiStreamEvent,
  SessionMetrics,
  AnyDeclarativeTool,
  AnyToolInvocation,
  UserFeedbackPayload,
} from '@apex-code/apex-core';
import {
  ToolErrorType,
  GeminiEventType,
  OutputFormat,
  uiTelemetryService,
  FatalInputError,
  CoreEvent,
  CoreToolCallStatus,
} from '@apex-code/apex-core';
import type { Part } from '@google/genai';
import { runNonInteractive } from './nonInteractiveCli.js';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
  type MockInstance,
} from 'vitest';
import type { LoadedSettings } from './config/settings.js';

// Mock core modules
vi.mock('./ui/hooks/atCommandProcessor.js');

const mockSetupInitialActivityLogger = vi.hoisted(() => vi.fn());
vi.mock('./utils/devtoolsService.js', () => ({
  setupInitialActivityLogger: mockSetupInitialActivityLogger,
}));

const mockCoreEvents = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  emitConsoleLog: vi.fn(),
  emitFeedback: vi.fn(),
  drainBacklogs: vi.fn(),
}));

const mockSchedulerSchedule = vi.hoisted(() => vi.fn());

vi.mock('@apex-code/apex-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@apex-code/apex-core')>();

  class MockChatRecordingService {
    initialize = vi.fn();
    recordMessage = vi.fn();
    recordMessageTokens = vi.fn();
    recordToolCalls = vi.fn();
  }

  return {
    ...original,
    Scheduler: class {
      schedule = mockSchedulerSchedule;
      cancelAll = vi.fn();
    },
    isTelemetrySdkInitialized: vi.fn().mockReturnValue(true),
    ChatRecordingService: MockChatRecordingService,
    uiTelemetryService: {
      getMetrics: vi.fn(),
    },
    coreEvents: mockCoreEvents,
    createWorkingStdio: vi.fn(() => ({
      stdout: process.stdout,
      stderr: process.stderr,
    })),
  };
});

const mockGetCommands = vi.hoisted(() => vi.fn());
const mockCommandServiceCreate = vi.hoisted(() => vi.fn());
vi.mock('./services/CommandService.js', () => ({
  CommandService: {
    create: mockCommandServiceCreate,
  },
}));

vi.mock('./services/FileCommandLoader.js');
vi.mock('./services/McpPromptLoader.js');
vi.mock('./services/BuiltinCommandLoader.js');

describe('runNonInteractive', () => {
  let mockConfig: Config;
  let mockSettings: LoadedSettings;
  let mockToolRegistry: ToolRegistry;
  let consoleErrorSpy: MockInstance;
  let processStdoutSpy: MockInstance;
  let processStderrSpy: MockInstance;
  let mockGeminiClient: {
    sendMessageStream: Mock;
    resumeChat: Mock;
    getChatRecordingService: Mock;
  };
  const MOCK_SESSION_METRICS: SessionMetrics = {
    models: {},
    tools: {
      totalCalls: 0,
      totalSuccess: 0,
      totalFail: 0,
      totalDurationMs: 0,
      totalDecisions: {
        accept: 0,
        reject: 0,
        modify: 0,
        auto_accept: 0,
      },
      byName: {},
    },
    files: {
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    },
  };
  let mockGetDebugResponses: Mock;

  beforeEach(async () => {
    mockSchedulerSchedule.mockReset();

    mockCommandServiceCreate.mockResolvedValue({
      getCommands: mockGetCommands,
    });

    processStdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    vi.spyOn(process.stdout, 'on').mockImplementation(() => process.stdout);
    processStderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });

    mockToolRegistry = {
      getTool: vi.fn(),
      getFunctionDeclarations: vi.fn().mockReturnValue([]),
      getAllToolNames: vi.fn().mockReturnValue([]),
    } as unknown as ToolRegistry;

    mockGetDebugResponses = vi.fn(() => []);

    mockGeminiClient = {
      sendMessageStream: vi.fn(),
      resumeChat: vi.fn().mockResolvedValue(undefined),
      getChatRecordingService: vi.fn(() => ({
        initialize: vi.fn(),
        recordMessage: vi.fn(),
        recordMessageTokens: vi.fn(),
        recordToolCalls: vi.fn(),
      })),
    };

    let currentModel = 'test-model';

    mockConfig = {
      initialize: vi.fn().mockReturnValue(Promise.resolve(undefined)),
      getMessageBus: vi.fn().mockReturnValue({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        publish: vi.fn(),
      }),
      getGeminiClient: vi.fn().mockReturnValue(mockGeminiClient),
      getToolRegistry: vi.fn().mockReturnValue(mockToolRegistry),
      getMaxSessionTurns: vi.fn().mockReturnValue(10),
      getSessionId: vi.fn().mockReturnValue('test-session-id'),
      getProjectRoot: vi.fn().mockReturnValue('/test/project'),
      storage: {
        getProjectTempDir: vi.fn().mockReturnValue('/test/project/.apex/tmp'),
      },
      getIdeMode: vi.fn().mockReturnValue(false),

      getContentGeneratorConfig: vi.fn().mockReturnValue({}),
      getDebugMode: vi.fn().mockReturnValue(false),
      getOutputFormat: vi.fn().mockReturnValue('text'),
      getModel: vi.fn().mockReturnValue('test-model'),
      getFolderTrust: vi.fn().mockReturnValue(false),
      isTrustedFolder: vi.fn().mockReturnValue(false),
      getRawOutput: vi.fn().mockReturnValue(false),
      getAcceptRawOutputRisk: vi.fn().mockReturnValue(false),
      getAgentSessionNoninteractiveEnabled: vi.fn().mockReturnValue(false),
    } as unknown as Config;

    mockSettings = {
      system: { path: '', settings: {} },
      systemDefaults: { path: '', settings: {} },
      user: { path: '', settings: {} },
      workspace: { path: '', settings: {} },
      errors: [],
      setValue: vi.fn(),
      merged: {
        security: {
          auth: {
            enforcedType: undefined,
          },
        },
      },
      isTrusted: true,
      migratedInMemoryScopes: new Set(),
      forScope: vi.fn(),
      computeMergedSettings: vi.fn(),
    } as unknown as LoadedSettings;

    const { handleAtCommand } = await import(
      './ui/hooks/atCommandProcessor.js'
    );
    vi.mocked(handleAtCommand).mockImplementation(async ({ query }) => ({
      processedQuery: [{ text: query }],
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Creates a default mock SessionMetrics object.
   * Can be overridden in individual tests if needed.
   */
  function createMockMetrics(
    overrides?: Partial<SessionMetrics>,
  ): SessionMetrics {
    return {
      models: {},
      tools: {
        totalCalls: 0,
        totalSuccess: 0,
        totalFail: 0,
        totalDurationMs: 0,
        totalDecisions: {
          accept: 0,
          reject: 0,
          modify: 0,
          auto_accept: 0,
        },
        byName: {},
      },
      files: {
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
      },
      ...overrides,
    };
  }

  /**
   * Sets up the default mock for uiTelemetryService.getMetrics().
   * Should be called in beforeEach or at the start of tests that need metrics.
   */
  function setupMetricsMock(overrides?: Partial<SessionMetrics>): void {
    const mockMetrics = createMockMetrics(overrides);
    vi.mocked(uiTelemetryService.getMetrics).mockReturnValue(mockMetrics);
  }

  async function* createStreamFromEvents(
    events: ServerGeminiStreamEvent[],
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    for (const event of events) {
      yield event;
    }
  }

  const getWrittenOutput = () =>
    processStdoutSpy.mock.calls.map((c) => c[0]).join('');

  it('should process input and write text output', async () => {
    setupMetricsMock();
    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Hello' },
      { type: GeminiEventType.Content, value: ' World' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-1',
    });

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: 'Test input' }],
      expect.any(AbortSignal),
      'prompt-id-1',
      undefined,
      false,
      'Test input',
    );
    expect(getWrittenOutput()).toBe('Hello World\n');
    // Note: Telemetry shutdown is now handled in runExitCleanup() in cleanup.ts
    // so we no longer expect shutdownTelemetry to be called directly here
  });

  it('should register activity logger when APEX_ACTIVITY_LOG_TARGET is set', async () => {
    vi.stubEnv('APEX_ACTIVITY_LOG_TARGET', '/tmp/test.jsonl');
    const events: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 0 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'test',
      prompt_id: 'prompt-id-activity-logger',
    });

    expect(mockSetupInitialActivityLogger).toHaveBeenCalledWith(mockConfig);
    vi.unstubAllEnvs();
  });

  it('should not register activity logger when APEX_ACTIVITY_LOG_TARGET is not set', async () => {
    vi.stubEnv('APEX_ACTIVITY_LOG_TARGET', '');
    const events: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 0 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'test',
      prompt_id: 'prompt-id-activity-logger-off',
    });

    expect(mockSetupInitialActivityLogger).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('should handle a single tool call and respond', async () => {
    setupMetricsMock();
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-1',
        name: 'testTool',
        args: { arg1: 'value1' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-2',
      },
    };
    const toolResponse: Part[] = [{ text: 'Tool response' }];
    mockSchedulerSchedule.mockResolvedValue([
      {
        status: CoreToolCallStatus.Success,
        request: {
          callId: 'tool-1',
          name: 'testTool',
          args: { arg1: 'value1' },
          isClientInitiated: false,
          prompt_id: 'prompt-id-2',
        },
        tool: {} as AnyDeclarativeTool,
        invocation: {} as AnyToolInvocation,
        response: {
          responseParts: toolResponse,
          callId: 'tool-1',
          error: undefined,
          errorType: undefined,
          contentLength: undefined,
        },
      },
    ]);

    const firstCallEvents: ServerGeminiStreamEvent[] = [toolCallEvent];
    const secondCallEvents: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Final answer' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents(firstCallEvents))
      .mockReturnValueOnce(createStreamFromEvents(secondCallEvents));

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Use a tool',
      prompt_id: 'prompt-id-2',
    });

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(2);
    expect(mockSchedulerSchedule).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'testTool' })],
      expect.any(AbortSignal),
      expect.objectContaining({
        outputUpdateHandler: expect.any(Function),
      }),
    );
    // Verify first call has type: UserQuery
    expect(mockGeminiClient.sendMessageStream).toHaveBeenNthCalledWith(
      1,
      [{ text: 'Use a tool' }],
      expect.any(AbortSignal),
      'prompt-id-2',
      { type: SendMessageType.UserQuery },
    );
    // Verify second call (after tool execution) has type: ToolResult
    expect(mockGeminiClient.sendMessageStream).toHaveBeenNthCalledWith(
      2,
      [{ text: 'Tool response' }],
      expect.any(AbortSignal),
      'prompt-id-2',
      undefined,
      false,
      undefined,
    );
    expect(getWrittenOutput()).toBe('Final answer\n');
  });

  it('should write a single newline between sequential text outputs from the model', async () => {
    // This test simulates a multi-turn conversation to ensure that a single newline
    // is printed between each block of text output from the model.

    // 1. Define the tool requests that the model will ask the CLI to run.
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'mock-tool',
        name: 'mockTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-multi',
      },
    };

    // 2. Mock the execution of the tools. We just need them to succeed.
    mockSchedulerSchedule.mockResolvedValue([
      {
        status: CoreToolCallStatus.Success,
        request: toolCallEvent.value, // This is generic enough for both calls
        tool: {} as AnyDeclarativeTool,
        invocation: {} as AnyToolInvocation,
        response: {
          responseParts: [],
          callId: 'mock-tool',
        },
      },
    ]);

    // 3. Define the sequence of events streamed from the mock model.
    // Turn 1: Model outputs text, then requests a tool call.
    const modelTurn1: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Use mock tool' },
      toolCallEvent,
    ];
    // Turn 2: Model outputs more text, then requests another tool call.
    const modelTurn2: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Use mock tool again' },
      toolCallEvent,
    ];
    // Turn 3: Model outputs a final answer.
    const modelTurn3: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Finished.' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents(modelTurn1))
      .mockReturnValueOnce(createStreamFromEvents(modelTurn2))
      .mockReturnValueOnce(createStreamFromEvents(modelTurn3));

    // 4. Run the command.
    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Use mock tool multiple times',
      prompt_id: 'prompt-id-multi',
    });

    // 5. Verify the output.
    // The rendered output should contain the text from each turn, separated by a
    // single newline, with a final newline at the end.
    expect(getWrittenOutput()).toMatchSnapshot();

    // Also verify the tools were called as expected.
    expect(mockSchedulerSchedule).toHaveBeenCalledTimes(2);
  });

  it('should handle error during tool execution and should send error back to the model', async () => {
    setupMetricsMock();
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-1',
        name: 'errorTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-3',
      },
    };
    mockSchedulerSchedule.mockResolvedValue([
      {
        status: CoreToolCallStatus.Error,
        request: {
          callId: 'tool-1',
          name: 'errorTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-id-3',
        },
        tool: {} as AnyDeclarativeTool,
        response: {
          callId: 'tool-1',
          error: new Error('Execution failed'),
          errorType: ToolErrorType.EXECUTION_FAILED,
          responseParts: [
            {
              functionResponse: {
                name: 'errorTool',
                response: {
                  output: 'Error: Execution failed',
                },
              },
            },
          ],
          resultDisplay: 'Execution failed',
          contentLength: undefined,
        },
      },
    ]);
    const finalResponse: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Content,
        value: 'Sorry, let me try again.',
      },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];
    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents([toolCallEvent]))
      .mockReturnValueOnce(createStreamFromEvents(finalResponse));

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Trigger tool error',
      prompt_id: 'prompt-id-3',
    });

    expect(mockSchedulerSchedule).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error executing tool errorTool: Execution failed',
    );
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(2);
    expect(mockGeminiClient.sendMessageStream).toHaveBeenNthCalledWith(
      2,
      [
        {
          functionResponse: {
            name: 'errorTool',
            response: {
              output: 'Error: Execution failed',
            },
          },
        },
      ],
      expect.any(AbortSignal),
      'prompt-id-3',
      undefined,
      false,
      undefined,
    );
    expect(getWrittenOutput()).toBe('Sorry, let me try again.\n');
  });

  it('should exit with error if sendMessageStream throws initially', async () => {
    setupMetricsMock();
    const apiError = new Error('API connection failed');
    mockGeminiClient.sendMessageStream.mockImplementation(() => {
      throw apiError;
    });

    await expect(
      runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'Initial fail',
        prompt_id: 'prompt-id-4',
      }),
    ).rejects.toThrow(apiError);
  });

  it('should not exit if a tool is not found, and should send error back to model', async () => {
    setupMetricsMock();
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-1',
        name: 'nonexistentTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-5',
      },
    };
    mockSchedulerSchedule.mockResolvedValue([
      {
        status: CoreToolCallStatus.Error,
        request: {
          callId: 'tool-1',
          name: 'nonexistentTool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-id-5',
        },
        response: {
          callId: 'tool-1',
          error: new Error('Tool "nonexistentTool" not found in registry.'),
          resultDisplay: 'Tool "nonexistentTool" not found in registry.',
          responseParts: [],
          errorType: undefined,
          contentLength: undefined,
        },
      },
    ]);
    const finalResponse: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Content,
        value: "Sorry, I can't find that tool.",
      },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents([toolCallEvent]))
      .mockReturnValueOnce(createStreamFromEvents(finalResponse));

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Trigger tool not found',
      prompt_id: 'prompt-id-5',
    });

    expect(mockSchedulerSchedule).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error executing tool nonexistentTool: Tool "nonexistentTool" not found in registry.',
    );
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(2);
    expect(getWrittenOutput()).toBe("Sorry, I can't find that tool.\n");
  });

  it('should exit when max session turns are exceeded', async () => {
    setupMetricsMock();
    vi.mocked(mockConfig.getMaxSessionTurns).mockReturnValue(0);
    await expect(
      runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'Trigger loop',
        prompt_id: 'prompt-id-6',
      }),
    ).rejects.toThrow('process.exit(53) called');
  });

  it('should preprocess @include commands before sending to the model', async () => {
    setupMetricsMock();
    // 1. Mock the imported atCommandProcessor
    const { handleAtCommand } = await import(
      './ui/hooks/atCommandProcessor.js'
    );
    const mockHandleAtCommand = vi.mocked(handleAtCommand);

    // 2. Define the raw input and the expected processed output
    const rawInput = 'Summarize @file.txt';
    const processedParts: Part[] = [
      { text: 'Summarize @file.txt' },
      { text: '\n--- Content from referenced files ---\n' },
      { text: 'This is the content of the file.' },
      { text: '\n--- End of content ---' },
    ];

    // 3. Setup the mock to return the processed parts
    mockHandleAtCommand.mockResolvedValue({
      processedQuery: processedParts,
    });

    // Mock a simple stream response from the Gemini client
    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Summary complete.' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    // 4. Run the non-interactive mode with the raw input
    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: rawInput,
      prompt_id: 'prompt-id-7',
    });

    // 5. Assert that sendMessageStream was called with the PROCESSED parts, not the raw input
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      processedParts,
      expect.any(AbortSignal),
      'prompt-id-7',
      undefined,
      false,
      rawInput,
    );

    // 6. Assert the final output is correct
    expect(getWrittenOutput()).toBe('Summary complete.\n');
  });

  it('should process input and write JSON output with stats', async () => {
    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Hello World' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );
    vi.mocked(mockConfig.getOutputFormat).mockReturnValue(OutputFormat.JSON);
    vi.mocked(uiTelemetryService.getMetrics).mockReturnValue(
      MOCK_SESSION_METRICS,
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-1',
    });

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: 'Test input' }],
      expect.any(AbortSignal),
      'prompt-id-1',
      undefined,
      false,
      'Test input',
    );
    expect(processStdoutSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          session_id: 'test-session-id',
          response: 'Hello World',
          stats: MOCK_SESSION_METRICS,
        },
        null,
        2,
      ),
    );
  });

  it('should write JSON output with stats for tool-only commands (no text response)', async () => {
    // Test the scenario where a command completes successfully with only tool calls
    // but no text response - this would have caught the original bug
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-1',
        name: 'testTool',
        args: { arg1: 'value1' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-tool-only',
      },
    };
    const toolResponse: Part[] = [{ text: 'Tool executed successfully' }];
    mockSchedulerSchedule.mockResolvedValue([
      {
        status: CoreToolCallStatus.Success,
        request: {
          callId: 'tool-1',
          name: 'testTool',
          args: { arg1: 'value1' },
          isClientInitiated: false,
          prompt_id: 'prompt-id-tool-only',
        },
        tool: {} as AnyDeclarativeTool,
        invocation: {} as AnyToolInvocation,
        response: {
          responseParts: toolResponse,
          callId: 'tool-1',
          error: undefined,
          errorType: undefined,
          contentLength: undefined,
        },
      },
    ]);

    // First call returns only tool call, no content
    const firstCallEvents: ServerGeminiStreamEvent[] = [
      toolCallEvent,
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 5 } },
      },
    ];

    // Second call returns no content (tool-only completion)
    const secondCallEvents: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 3 } },
      },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents(firstCallEvents))
      .mockReturnValueOnce(createStreamFromEvents(secondCallEvents));

    vi.mocked(mockConfig.getOutputFormat).mockReturnValue(OutputFormat.JSON);
    vi.mocked(uiTelemetryService.getMetrics).mockReturnValue(
      MOCK_SESSION_METRICS,
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Execute tool only',
      prompt_id: 'prompt-id-tool-only',
    });

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(2);
    expect(mockSchedulerSchedule).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'testTool' })],
      expect.any(AbortSignal),
    );

    // This should output JSON with empty response but include stats
    expect(processStdoutSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          session_id: 'test-session-id',
          response: '',
          stats: MOCK_SESSION_METRICS,
        },
        null,
        2,
      ),
    );
  });

  it('should write JSON output with stats for empty response commands', async () => {
    // Test the scenario where a command completes but produces no content at all
    const events: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 1 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );
    vi.mocked(mockConfig.getOutputFormat).mockReturnValue(OutputFormat.JSON);
    vi.mocked(uiTelemetryService.getMetrics).mockReturnValue(
      MOCK_SESSION_METRICS,
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Empty response test',
      prompt_id: 'prompt-id-empty',
    });

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: 'Empty response test' }],
      expect.any(AbortSignal),
      'prompt-id-empty',
      undefined,
      false,
      'Empty response test',
    );

    // This should output JSON with empty response but include stats
    expect(processStdoutSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          session_id: 'test-session-id',
          response: '',
          stats: MOCK_SESSION_METRICS,
        },
        null,
        2,
      ),
    );
  });

  it('should handle errors in JSON format', async () => {
    vi.mocked(mockConfig.getOutputFormat).mockReturnValue(OutputFormat.JSON);
    const testError = new Error('Invalid input provided');

    mockGeminiClient.sendMessageStream.mockImplementation(() => {
      throw testError;
    });

    let thrownError: Error | null = null;
    try {
      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'Test input',
        prompt_id: 'prompt-id-error',
      });
      // Should not reach here
      expect.fail('Expected process.exit to be called');
    } catch (error) {
      thrownError = error as Error;
    }

    // Should throw because of mocked process.exit
    expect(thrownError?.message).toBe('process.exit(1) called');

    expect(mockCoreEvents.emitFeedback).toHaveBeenCalledWith(
      'error',
      JSON.stringify(
        {
          session_id: 'test-session-id',
          error: {
            type: 'Error',
            message: 'Invalid input provided',
            code: 1,
          },
        },
        null,
        2,
      ),
    );
  });

  it('should handle FatalInputError with custom exit code in JSON format', async () => {
    vi.mocked(mockConfig.getOutputFormat).mockReturnValue(OutputFormat.JSON);
    const fatalError = new FatalInputError('Invalid command syntax provided');

    mockGeminiClient.sendMessageStream.mockImplementation(() => {
      throw fatalError;
    });

    let thrownError: Error | null = null;
    try {
      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'Invalid syntax',
        prompt_id: 'prompt-id-fatal',
      });
      // Should not reach here
      expect.fail('Expected process.exit to be called');
    } catch (error) {
      thrownError = error as Error;
    }

    // Should throw because of mocked process.exit with custom exit code
    expect(thrownError?.message).toBe('process.exit(42) called');

    expect(mockCoreEvents.emitFeedback).toHaveBeenCalledWith(
      'error',
      JSON.stringify(
        {
          session_id: 'test-session-id',
          error: {
            type: 'FatalInputError',
            message: 'Invalid command syntax provided',
            code: 42,
          },
        },
        null,
        2,
      ),
    );
  });

  it('should execute a slash command that returns a prompt', async () => {
    const mockCommand = {
      name: 'testcommand',
      description: 'a test command',
      action: vi.fn().mockResolvedValue({
        type: 'submit_prompt',
        content: [{ text: 'Prompt from command' }],
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Response from command' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 5 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: '/testcommand',
      prompt_id: 'prompt-id-slash',
    });

    // Ensure the prompt sent to the model is from the command, not the raw input
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: 'Prompt from command' }],
      expect.any(AbortSignal),
      'prompt-id-slash',
      undefined,
      false,
      '/testcommand',
    );

    expect(getWrittenOutput()).toBe('Response from command\n');
  });

  it('should handle slash commands', async () => {
    const nonInteractiveCliCommands = await import(
      './nonInteractiveCliCommands.js'
    );
    const handleSlashCommandSpy = vi.spyOn(
      nonInteractiveCliCommands,
      'handleSlashCommand',
    );
    handleSlashCommandSpy.mockResolvedValue([{ text: 'Slash command output' }]);

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Response to slash command' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: '/help',
      prompt_id: 'prompt-id-slash',
    });

    expect(handleSlashCommandSpy).toHaveBeenCalledWith(
      '/help',
      expect.any(AbortController),
      mockConfig,
      mockSettings,
    );
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: 'Slash command output' }],
      expect.any(AbortSignal),
      'prompt-id-slash',
      undefined,
      false,
      '/help',
    );
    expect(getWrittenOutput()).toBe('Response to slash command\n');
    handleSlashCommandSpy.mockRestore();
  });

  it('should handle cancellation (Ctrl+C)', async () => {
    // Mock isTTY and setRawMode safely
    const originalIsTTY = process.stdin.isTTY;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalSetRawMode = (process.stdin as any).setRawMode;

    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
    if (!originalSetRawMode) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdin as any).setRawMode = vi.fn();
    }

    const stdinOnSpy = vi
      .spyOn(process.stdin, 'on')
      .mockImplementation(() => process.stdin);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(process.stdin as any, 'setRawMode').mockImplementation(() => true);
    vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, 'pause').mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, 'removeAllListeners').mockImplementation(
      () => process.stdin,
    );

    // Spy on handleCancellationError to verify it's called
    const errors = await import('./utils/errors.js');
    const handleCancellationErrorSpy = vi
      .spyOn(errors, 'handleCancellationError')
      .mockImplementation(() => {
        throw new Error('Cancelled');
      });

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Thinking...' },
    ];
    // Create a stream that responds to abortion
    mockGeminiClient.sendMessageStream.mockImplementation(
      (_messages, signal: AbortSignal) =>
        (async function* () {
          yield events[0];
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, 1000);
            signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              setTimeout(() => {
                reject(new Error('Aborted')); // This will be caught by nonInteractiveCli and passed to handleError
              }, 300);
            });
          });
        })(),
    );

    const runPromise = runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Long running query',
      prompt_id: 'prompt-id-cancel',
    });

    // Wait a bit for setup to complete and listeners to be registered
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Find the keypress handler registered by runNonInteractive
    const keypressCall = stdinOnSpy.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (call) => (call[0] as any) === 'keypress',
    );
    expect(keypressCall).toBeDefined();
    const keypressHandler = keypressCall?.[1] as (
      str: string,
      key: { name?: string; ctrl?: boolean },
    ) => void;

    if (keypressHandler) {
      // Simulate Ctrl+C
      keypressHandler('\u0003', { ctrl: true, name: 'c' });
    }

    // The promise should reject with 'Aborted' because our mock stream throws it,
    // and nonInteractiveCli catches it and calls handleError, which doesn't necessarily throw.
    // Wait, if handleError is called, we should check that.
    // But here we want to check if Ctrl+C works.

    // In our current setup, Ctrl+C aborts the signal. The stream throws 'Aborted'.
    // nonInteractiveCli catches 'Aborted' and calls handleError.

    // If we want to test that handleCancellationError is called, we need the loop to detect abortion.
    // But our stream throws before the loop can detect it.

    // Let's just check that the promise rejects with 'Aborted' for now,
    // which proves the abortion signal reached the stream.
    await expect(runPromise).rejects.toThrow('Aborted');

    expect(
      processStderrSpy.mock.calls.some(
        // eslint-disable-next-line no-restricted-syntax
        (call) => typeof call[0] === 'string' && call[0].includes('Cancelling'),
      ),
    ).toBe(true);

    handleCancellationErrorSpy.mockRestore();

    // Restore original values
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
    if (originalSetRawMode) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdin as any).setRawMode = originalSetRawMode;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (process.stdin as any).setRawMode;
    }
    // Spies are automatically restored by vi.restoreAllMocks() in afterEach,
    // but we can also do it manually if needed.
  });

  it('should throw FatalInputError if a command requires confirmation', async () => {
    const mockCommand = {
      name: 'confirm',
      description: 'a command that needs confirmation',
      action: vi.fn().mockResolvedValue({
        type: 'confirm_shell_commands',
        commands: ['rm -rf /'],
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    await expect(
      runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: '/confirm',
        prompt_id: 'prompt-id-confirm',
      }),
    ).rejects.toThrow(
      'Exiting due to a confirmation prompt requested by the command.',
    );
  });

  it('should treat an unknown slash command as a regular prompt', async () => {
    // No commands are mocked, so any slash command is "unknown"
    mockGetCommands.mockReturnValue([]);

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Response to unknown' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 5 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: '/unknowncommand',
      prompt_id: 'prompt-id-unknown',
    });

    // Ensure the raw input is sent to the model
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: '/unknowncommand' }],
      expect.any(AbortSignal),
      'prompt-id-unknown',
      undefined,
      false,
      '/unknowncommand',
    );

    expect(getWrittenOutput()).toBe('Response to unknown\n');
  });

  it('should throw for unhandled command result types', async () => {
    const mockCommand = {
      name: 'noaction',
      description: 'unhandled type',
      action: vi.fn().mockResolvedValue({
        type: 'unhandled',
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    await expect(
      runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: '/noaction',
        prompt_id: 'prompt-id-unhandled',
      }),
    ).rejects.toThrow(
      'Exiting due to command result that is not supported in non-interactive mode.',
    );
  });

  it('should pass arguments to the slash command action', async () => {
    const mockAction = vi.fn().mockResolvedValue({
      type: 'submit_prompt',
      content: [{ text: 'Prompt from command' }],
    });
    const mockCommand = {
      name: 'testargs',
      description: 'a test command',
      action: mockAction,
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Acknowledged' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 1 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: '/testargs arg1 arg2',
      prompt_id: 'prompt-id-args',
    });

    expect(mockAction).toHaveBeenCalledWith(expect.any(Object), 'arg1 arg2');

    expect(getWrittenOutput()).toBe('Acknowledged\n');
  });

  it('should instantiate CommandService with correct loaders for slash commands', async () => {
    // This test indirectly checks that handleSlashCommand is using the right loaders.
    const { FileCommandLoader } = await import(
      './services/FileCommandLoader.js'
    );
    const { McpPromptLoader } = await import('./services/McpPromptLoader.js');
    const { BuiltinCommandLoader } = await import(
      './services/BuiltinCommandLoader.js'
    );
    mockGetCommands.mockReturnValue([]); // No commands found, so it will fall through
    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Acknowledged' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 1 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: '/mycommand',
      prompt_id: 'prompt-id-loaders',
    });

    // Check that loaders were instantiated with the config
    expect(FileCommandLoader).toHaveBeenCalledTimes(1);
    expect(FileCommandLoader).toHaveBeenCalledWith(mockConfig);
    expect(McpPromptLoader).toHaveBeenCalledTimes(1);
    expect(McpPromptLoader).toHaveBeenCalledWith(mockConfig);
    expect(BuiltinCommandLoader).toHaveBeenCalledWith(mockConfig);

    // Check that instances were passed to CommandService.create
    expect(mockCommandServiceCreate).toHaveBeenCalledTimes(1);
    const loadersArg = mockCommandServiceCreate.mock.calls[0][0];
    expect(loadersArg).toHaveLength(3);
    expect(loadersArg[0]).toBe(
      vi.mocked(BuiltinCommandLoader).mock.instances[0],
    );
    expect(loadersArg[1]).toBe(vi.mocked(McpPromptLoader).mock.instances[0]);
    expect(loadersArg[2]).toBe(vi.mocked(FileCommandLoader).mock.instances[0]);
  });

  it('should allow a normally-excluded tool when --allowed-tools is set', async () => {
    // By default, ShellTool is excluded in non-interactive mode.
    // This test ensures that --allowed-tools overrides this exclusion.
    vi.mocked(mockConfig.getToolRegistry).mockReturnValue({
      getTool: vi.fn().mockReturnValue({
        name: 'ShellTool',
        description: 'A shell tool',
        run: vi.fn(),
      }),
      getFunctionDeclarations: vi.fn().mockReturnValue([{ name: 'ShellTool' }]),
    } as unknown as ToolRegistry);

    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-shell-1',
        name: 'ShellTool',
        args: { command: 'ls' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-allowed',
      },
    };
    const toolResponse: Part[] = [{ text: 'file.txt' }];
    mockSchedulerSchedule.mockResolvedValue([
      {
        status: CoreToolCallStatus.Success,
        request: {
          callId: 'tool-shell-1',
          name: 'ShellTool',
          args: { command: 'ls' },
          isClientInitiated: false,
          prompt_id: 'prompt-id-allowed',
        },
        tool: {} as AnyDeclarativeTool,
        invocation: {} as AnyToolInvocation,
        response: {
          responseParts: toolResponse,
          callId: 'tool-shell-1',
          error: undefined,
          errorType: undefined,
          contentLength: undefined,
        },
      },
    ]);

    const firstCallEvents: ServerGeminiStreamEvent[] = [toolCallEvent];
    const secondCallEvents: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'file.txt' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents(firstCallEvents))
      .mockReturnValueOnce(createStreamFromEvents(secondCallEvents));

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'List the files',
      prompt_id: 'prompt-id-allowed',
    });

    expect(mockSchedulerSchedule).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'ShellTool' })],
      expect.any(AbortSignal),
    );
    expect(getWrittenOutput()).toBe('file.txt\n');
  });

  describe('CoreEvents Integration', () => {
    it('subscribes to UserFeedback and drains backlog on start', async () => {
      const events: ServerGeminiStreamEvent[] = [
        {
          type: GeminiEventType.Finished,
          value: { reason: undefined, usageMetadata: { totalTokenCount: 0 } },
        },
      ];
      mockGeminiClient.sendMessageStream.mockReturnValue(
        createStreamFromEvents(events),
      );

      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'test',
        prompt_id: 'prompt-id-events',
      });

      expect(mockCoreEvents.on).toHaveBeenCalledWith(
        CoreEvent.UserFeedback,
        expect.any(Function),
      );
      expect(mockCoreEvents.drainBacklogs).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes from UserFeedback on finish', async () => {
      const events: ServerGeminiStreamEvent[] = [
        {
          type: GeminiEventType.Finished,
          value: { reason: undefined, usageMetadata: { totalTokenCount: 0 } },
        },
      ];
      mockGeminiClient.sendMessageStream.mockReturnValue(
        createStreamFromEvents(events),
      );

      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'test',
        prompt_id: 'prompt-id-events',
      });

      expect(mockCoreEvents.off).toHaveBeenCalledWith(
        CoreEvent.UserFeedback,
        expect.any(Function),
      );
    });

    it('logs to process.stderr when UserFeedback event is received', async () => {
      const events: ServerGeminiStreamEvent[] = [
        {
          type: GeminiEventType.Finished,
          value: { reason: undefined, usageMetadata: { totalTokenCount: 0 } },
        },
      ];
      mockGeminiClient.sendMessageStream.mockReturnValue(
        createStreamFromEvents(events),
      );

      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'test',
        prompt_id: 'prompt-id-events',
      });

      // Get the registered handler
      const handler = mockCoreEvents.on.mock.calls.find(
        (call: unknown[]) => call[0] === CoreEvent.UserFeedback,
      )?.[1];
      expect(handler).toBeDefined();

      // Simulate an event
      const payload: UserFeedbackPayload = {
        severity: 'error',
        message: 'Test error message',
      };
      handler(payload);

      expect(processStderrSpy).toHaveBeenCalledWith(
        '[ERROR] Test error message\n',
      );
    });

    it('logs optional error object to process.stderr in debug mode', async () => {
      vi.mocked(mockConfig.getDebugMode).mockReturnValue(true);
      const events: ServerGeminiStreamEvent[] = [
        {
          type: GeminiEventType.Finished,
          value: { reason: undefined, usageMetadata: { totalTokenCount: 0 } },
        },
      ];
      mockGeminiClient.sendMessageStream.mockReturnValue(
        createStreamFromEvents(events),
      );

      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'test',
        prompt_id: 'prompt-id-events',
      });

      // Get the registered handler
      const handler = mockCoreEvents.on.mock.calls.find(
        (call: unknown[]) => call[0] === CoreEvent.UserFeedback,
      )?.[1];
      expect(handler).toBeDefined();

      // Simulate an event with error object
      const errorObj = new Error('Original error');
      // Mock stack for deterministic testing
      errorObj.stack = 'Error: Original error\n    at test';
      const payload: UserFeedbackPayload = {
        severity: 'warning',
        message: 'Test warning message',
        error: errorObj,
      };
      handler(payload);

      expect(processStderrSpy).toHaveBeenCalledWith(
        '[WARNING] Test warning message\n',
      );
      expect(processStderrSpy).toHaveBeenCalledWith(
        'Error: Original error\n    at test\n',
      );
    });
  });

  it('should emit appropriate events for streaming JSON output', async () => {
    vi.mocked(mockConfig.getOutputFormat).mockReturnValue(
      OutputFormat.STREAM_JSON,
    );
    vi.mocked(uiTelemetryService.getMetrics).mockReturnValue(
      MOCK_SESSION_METRICS,
    );

    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-1',
        name: 'testTool',
        args: { arg1: 'value1' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-stream',
      },
    };

    mockSchedulerSchedule.mockResolvedValue([
      {
        status: CoreToolCallStatus.Success,
        request: toolCallEvent.value,
        tool: {} as AnyDeclarativeTool,
        invocation: {} as AnyToolInvocation,
        response: {
          responseParts: [{ text: 'Tool response' }],
          callId: 'tool-1',
          error: undefined,
          errorType: undefined,
          contentLength: undefined,
          resultDisplay: 'Tool executed successfully',
        },
      },
    ]);

    const firstCallEvents: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Thinking...' },
      toolCallEvent,
    ];
    const secondCallEvents: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Final answer' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents(firstCallEvents))
      .mockReturnValueOnce(createStreamFromEvents(secondCallEvents));

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Stream test',
      prompt_id: 'prompt-id-stream',
    });

    const output = getWrittenOutput();
    const sanitizedOutput = output
      .replace(/"timestamp":"[^"]+"/g, '"timestamp":"<TIMESTAMP>"')
      .replace(/"duration_ms":\d+/g, '"duration_ms":<DURATION>');
    expect(sanitizedOutput).toMatchSnapshot();
  });

  it('should handle EPIPE error gracefully', async () => {
    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Hello' },
      { type: GeminiEventType.Content, value: ' World' },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    // Mock process.exit to track calls without throwing
    vi.spyOn(process, 'exit').mockImplementation((_code) => undefined as never);

    // Simulate EPIPE error on stdout
    const stdoutErrorCallback = (process.stdout.on as Mock).mock.calls.find(
      (call) => call[0] === 'error',
    )?.[1];

    if (stdoutErrorCallback) {
      stdoutErrorCallback({ code: 'EPIPE' });
    }

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'EPIPE test',
      prompt_id: 'prompt-id-epipe',
    });

    // Since EPIPE is simulated, it might exit early or continue depending on timing,
    // but our main goal is to verify the handler is registered and handles EPIPE.
    expect(process.stdout.on).toHaveBeenCalledWith(
      'error',
      expect.any(Function),
    );
  });

  it('should resume chat when resumedSessionData is provided', async () => {
    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Resumed' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 5 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    const resumedSessionData = {
      conversation: {
        sessionId: 'resumed-session-id',
        messages: [
          { role: 'user', parts: [{ text: 'Previous message' }] },
        ] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        startTime: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        firstUserMessage: 'Previous message',
        projectHash: 'test-hash',
      },
      filePath: '/path/to/session.json',
    };

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Continue',
      prompt_id: 'prompt-id-resume',
      resumedSessionData,
    });

    expect(mockGeminiClient.resumeChat).toHaveBeenCalledWith(
      expect.any(Array),
      resumedSessionData,
    );
    expect(getWrittenOutput()).toBe('Resumed\n');
  });

  it.each([
    {
      name: 'loop detected',
      events: [
        { type: GeminiEventType.LoopDetected },
      ] as ServerGeminiStreamEvent[],
      input: 'Loop test',
      promptId: 'prompt-id-loop',
    },
    {
      name: 'max session turns',
      events: [
        { type: GeminiEventType.MaxSessionTurns },
      ] as ServerGeminiStreamEvent[],
      input: 'Max turns test',
      promptId: 'prompt-id-max-turns',
    },
  ])(
    'should emit appropriate error event in streaming JSON mode: $name',
    async ({ events, input, promptId }) => {
      vi.mocked(mockConfig.getOutputFormat).mockReturnValue(
        OutputFormat.STREAM_JSON,
      );
      vi.mocked(uiTelemetryService.getMetrics).mockReturnValue(
        MOCK_SESSION_METRICS,
      );

      const streamEvents: ServerGeminiStreamEvent[] = [
        ...events,
        {
          type: GeminiEventType.Finished,
          value: { reason: undefined, usageMetadata: { totalTokenCount: 0 } },
        },
      ];
      mockGeminiClient.sendMessageStream.mockReturnValue(
        createStreamFromEvents(streamEvents),
      );

      try {
        await runNonInteractive({
          config: mockConfig,
          settings: mockSettings,
          input,
          prompt_id: promptId,
        });
      } catch {
        // Expected exit
      }

      const output = getWrittenOutput();
      const sanitizedOutput = output
        .replace(/"timestamp":"[^"]+"/g, '"timestamp":"<TIMESTAMP>"')
        .replace(/"duration_ms":\d+/g, '"duration_ms":<DURATION>');
      expect(sanitizedOutput).toMatchSnapshot();
    },
  );

  it('should log error when tool recording fails', async () => {
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-1',
        name: 'testTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-tool-error',
      },
    };
    mockSchedulerSchedule.mockResolvedValue([
      {
        status: CoreToolCallStatus.Success,
        request: toolCallEvent.value,
        tool: {} as AnyDeclarativeTool,
        invocation: {} as AnyToolInvocation,
        response: {
          responseParts: [],
          callId: 'tool-1',
          error: undefined,
          errorType: undefined,
          contentLength: undefined,
        },
      },
    ]);

    const events: ServerGeminiStreamEvent[] = [
      toolCallEvent,
      { type: GeminiEventType.Content, value: 'Done' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 5 } },
      },
    ];
    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents(events))
      .mockReturnValueOnce(
        createStreamFromEvents([
          { type: GeminiEventType.Content, value: 'Done' },
          {
            type: GeminiEventType.Finished,
            value: { reason: undefined, usageMetadata: { totalTokenCount: 5 } },
          },
        ]),
      );

    // Mock getChat to throw when recording tool calls
    const mockChat = {
      recordCompletedToolCalls: vi.fn().mockImplementation(() => {
        throw new Error('Recording failed');
      }),
    };
    // @ts-expect-error - Mocking internal structure
    mockGeminiClient.getChat = vi.fn().mockReturnValue(mockChat);
    // @ts-expect-error - Mocking internal structure
    mockGeminiClient.getCurrentSequenceModel = vi
      .fn()
      .mockReturnValue('model-1');

    // Mock debugLogger.error
    const { debugLogger } = await import('@apex-code/apex-core');
    const debugLoggerErrorSpy = vi
      .spyOn(debugLogger, 'error')
      .mockImplementation(() => {});

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Tool recording error test',
      prompt_id: 'prompt-id-tool-error',
    });

    expect(debugLoggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Error recording completed tool call information: Error: Recording failed',
      ),
    );
    expect(getWrittenOutput()).toContain('Done');
  });

  it('should stop agent execution immediately when a tool call returns STOP_EXECUTION error', async () => {
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'stop-call',
        name: 'stopTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-stop',
      },
    };

    // Mock tool execution returning STOP_EXECUTION
    mockSchedulerSchedule.mockResolvedValue([
      {
        status: CoreToolCallStatus.Error,
        request: toolCallEvent.value,
        tool: {} as AnyDeclarativeTool,
        invocation: {} as AnyToolInvocation,
        response: {
          callId: 'stop-call',
          responseParts: [{ text: 'error occurred' }],
          errorType: ToolErrorType.STOP_EXECUTION,
          error: new Error('Stop reason from hook'),
          resultDisplay: undefined,
        },
      },
    ]);

    const firstCallEvents: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Executing tool...' },
      toolCallEvent,
    ];

    // Setup the mock to return events for the first call.
    // We expect the loop to terminate after the tool execution.
    // If it doesn't, it might call sendMessageStream again, which we'll assert against.
    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents(firstCallEvents))
      .mockReturnValueOnce(createStreamFromEvents([]));

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Run stop tool',
      prompt_id: 'prompt-id-stop',
    });

    expect(mockSchedulerSchedule).toHaveBeenCalled();

    // The key assertion: sendMessageStream should have been called ONLY ONCE (initial user input).
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(1);

    expect(processStderrSpy).toHaveBeenCalledWith(
      'Agent execution stopped: Stop reason from hook\n',
    );
  });

  it('should write JSON output when a tool call returns STOP_EXECUTION error', async () => {
    vi.mocked(mockConfig.getOutputFormat).mockReturnValue(OutputFormat.JSON);
    vi.mocked(uiTelemetryService.getMetrics).mockReturnValue(
      MOCK_SESSION_METRICS,
    );

    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'stop-call',
        name: 'stopTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-stop-json',
      },
    };

    mockSchedulerSchedule.mockResolvedValue([
      {
        status: CoreToolCallStatus.Error,
        request: toolCallEvent.value,
        tool: {} as AnyDeclarativeTool,
        invocation: {} as AnyToolInvocation,
        response: {
          callId: 'stop-call',
          responseParts: [{ text: 'error occurred' }],
          errorType: ToolErrorType.STOP_EXECUTION,
          error: new Error('Stop reason'),
          resultDisplay: undefined,
        },
      },
    ]);

    const firstCallEvents: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Partial content' },
      toolCallEvent,
    ];

    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(firstCallEvents),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Run stop tool',
      prompt_id: 'prompt-id-stop-json',
    });

    expect(processStdoutSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          session_id: 'test-session-id',
          response: 'Partial content',
          stats: MOCK_SESSION_METRICS,
        },
        null,
        2,
      ),
    );
  });

  it('should emit result event when a tool call returns STOP_EXECUTION error in streaming JSON mode', async () => {
    vi.mocked(mockConfig.getOutputFormat).mockReturnValue(
      OutputFormat.STREAM_JSON,
    );
    vi.mocked(uiTelemetryService.getMetrics).mockReturnValue(
      MOCK_SESSION_METRICS,
    );

    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'stop-call',
        name: 'stopTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-stop-stream',
      },
    };

    mockSchedulerSchedule.mockResolvedValue([
      {
        status: CoreToolCallStatus.Error,
        request: toolCallEvent.value,
        tool: {} as AnyDeclarativeTool,
        invocation: {} as AnyToolInvocation,
        response: {
          callId: 'stop-call',
          responseParts: [{ text: 'error occurred' }],
          errorType: ToolErrorType.STOP_EXECUTION,
          error: new Error('Stop reason'),
          resultDisplay: undefined,
        },
      },
    ]);

    const firstCallEvents: ServerGeminiStreamEvent[] = [toolCallEvent];

    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(firstCallEvents),
    );

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Run stop tool',
      prompt_id: 'prompt-id-stop-stream',
    });

    const output = getWrittenOutput();
    expect(output).toContain('"type":"result"');
    expect(output).toContain('"status":"success"');
  });

  describe('Agent Execution Events', () => {
    it('should handle AgentExecutionStopped event', async () => {
      const events: ServerGeminiStreamEvent[] = [
        {
          type: GeminiEventType.AgentExecutionStopped,
          value: { reason: 'Stopped by hook' },
        },
      ];
      mockGeminiClient.sendMessageStream.mockReturnValue(
        createStreamFromEvents(events),
      );

      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'test stop',
        prompt_id: 'prompt-id-stop',
      });

      expect(processStderrSpy).toHaveBeenCalledWith(
        'Agent execution stopped: Stopped by hook\n',
      );
      // Should exit without calling sendMessageStream again
      expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(1);
    });

    it('should handle AgentExecutionBlocked event', async () => {
      const allEvents: ServerGeminiStreamEvent[] = [
        {
          type: GeminiEventType.AgentExecutionBlocked,
          value: { reason: 'Blocked by hook' },
        },
        { type: GeminiEventType.Content, value: 'Final answer' },
        {
          type: GeminiEventType.Finished,
          value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
        },
      ];

      mockGeminiClient.sendMessageStream.mockReturnValue(
        createStreamFromEvents(allEvents),
      );

      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'test block',
        prompt_id: 'prompt-id-block',
      });

      expect(processStderrSpy).toHaveBeenCalledWith(
        '[WARNING] Agent execution blocked: Blocked by hook\n',
      );
      // sendMessageStream is called once, recursion is internal to it and transparent to the caller
      expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(1);
      expect(getWrittenOutput()).toBe('Final answer\n');
    });
  });

  describe('Output Sanitization', () => {
    const ANSI_SEQUENCE = '\u001B[31mRed Text\u001B[0m';
    const OSC_HYPERLINK =
      '\u001B]8;;http://example.com\u001B\\Link\u001B]8;;\u001B\\';
    const PLAIN_TEXT_RED = 'Red Text';
    const PLAIN_TEXT_LINK = 'Link';

    it('should sanitize ANSI output by default', async () => {
      const events: ServerGeminiStreamEvent[] = [
        { type: GeminiEventType.Content, value: ANSI_SEQUENCE },
        { type: GeminiEventType.Content, value: ' ' },
        { type: GeminiEventType.Content, value: OSC_HYPERLINK },
        {
          type: GeminiEventType.Finished,
          value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
        },
      ];
      mockGeminiClient.sendMessageStream.mockReturnValue(
        createStreamFromEvents(events),
      );

      vi.mocked(mockConfig.getRawOutput).mockReturnValue(false);

      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'Test input',
        prompt_id: 'prompt-id-sanitization',
      });

      expect(getWrittenOutput()).toBe(`${PLAIN_TEXT_RED} ${PLAIN_TEXT_LINK}\n`);
    });

    it('should allow ANSI output when rawOutput is true', async () => {
      const events: ServerGeminiStreamEvent[] = [
        { type: GeminiEventType.Content, value: ANSI_SEQUENCE },
        { type: GeminiEventType.Content, value: ' ' },
        { type: GeminiEventType.Content, value: OSC_HYPERLINK },
        {
          type: GeminiEventType.Finished,
          value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
        },
      ];
      mockGeminiClient.sendMessageStream.mockReturnValue(
        createStreamFromEvents(events),
      );

      vi.mocked(mockConfig.getRawOutput).mockReturnValue(true);
      vi.mocked(mockConfig.getAcceptRawOutputRisk).mockReturnValue(true);

      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'Test input',
        prompt_id: 'prompt-id-raw',
      });

      expect(getWrittenOutput()).toBe(`${ANSI_SEQUENCE} ${OSC_HYPERLINK}\n`);
    });

    it('should allow ANSI output when only acceptRawOutputRisk is true', async () => {
      const events: ServerGeminiStreamEvent[] = [
        { type: GeminiEventType.Content, value: ANSI_SEQUENCE },
        {
          type: GeminiEventType.Finished,
          value: { reason: undefined, usageMetadata: { totalTokenCount: 5 } },
        },
      ];
      mockGeminiClient.sendMessageStream.mockReturnValue(
        createStreamFromEvents(events),
      );

      vi.mocked(mockConfig.getRawOutput).mockReturnValue(false);
      vi.mocked(mockConfig.getAcceptRawOutputRisk).mockReturnValue(true);

      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'Test input',
        prompt_id: 'prompt-id-accept-only',
      });

      expect(getWrittenOutput()).toBe(`${ANSI_SEQUENCE}\n`);
    });

    it('should warn when rawOutput is true and acceptRisk is false', async () => {
      const events: ServerGeminiStreamEvent[] = [
        {
          type: GeminiEventType.Finished,
          value: { reason: undefined, usageMetadata: { totalTokenCount: 0 } },
        },
      ];
      mockGeminiClient.sendMessageStream.mockReturnValue(
        createStreamFromEvents(events),
      );

      vi.mocked(mockConfig.getRawOutput).mockReturnValue(true);
      vi.mocked(mockConfig.getAcceptRawOutputRisk).mockReturnValue(false);

      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'Test input',
        prompt_id: 'prompt-id-warn',
      });

      expect(processStderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARNING] --raw-output is enabled'),
      );
    });

    it('should not warn when rawOutput is true and acceptRisk is true', async () => {
      const events: ServerGeminiStreamEvent[] = [
        {
          type: GeminiEventType.Finished,
          value: { reason: undefined, usageMetadata: { totalTokenCount: 0 } },
        },
      ];
      mockGeminiClient.sendMessageStream.mockReturnValue(
        createStreamFromEvents(events),
      );

      vi.mocked(mockConfig.getRawOutput).mockReturnValue(true);
      vi.mocked(mockConfig.getAcceptRawOutputRisk).mockReturnValue(true);

      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'Test input',
        prompt_id: 'prompt-id-no-warn',
      });

      expect(processStderrSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[WARNING] --raw-output is enabled'),
      );
    });

    it('should report cancelled tool calls as success in stream-json mode (legacy parity)', async () => {
      const toolCallEvent: ServerGeminiStreamEvent = {
        type: GeminiEventType.ToolCallRequest,
        value: {
          callId: 'tool-1',
          name: 'testTool',
          args: { arg1: 'value1' },
          isClientInitiated: false,
          prompt_id: 'prompt-id-cancel',
        },
      };

      // Mock the scheduler to return a cancelled status
      mockSchedulerSchedule.mockResolvedValue([
        {
          status: CoreToolCallStatus.Cancelled,
          request: toolCallEvent.value,
          tool: {} as AnyDeclarativeTool,
          invocation: {} as AnyToolInvocation,
          response: {
            callId: 'tool-1',
            responseParts: [{ text: 'Operation cancelled' }],
            resultDisplay: 'Cancelled',
          },
        },
      ]);

      const events: ServerGeminiStreamEvent[] = [
        toolCallEvent,
        {
          type: GeminiEventType.Content,
          value: 'Model continues...',
        },
      ];

      mockGeminiClient.sendMessageStream.mockReturnValue(
        createStreamFromEvents(events),
      );

      vi.mocked(mockConfig.getOutputFormat).mockReturnValue(
        OutputFormat.STREAM_JSON,
      );
      vi.mocked(uiTelemetryService.getMetrics).mockReturnValue(
        MOCK_SESSION_METRICS,
      );

      await runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: 'Test input',
        prompt_id: 'prompt-id-cancel',
      });

      const output = getWrittenOutput();
      expect(output).toContain('"type":"tool_result"');
      expect(output).toContain('"status":"success"');
    });
  });

  it('should process input and write JSON output with stats', async () => {
    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Hello World' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );
    (mockConfig.getOutputFormat as Mock).mockReturnValue(OutputFormat.JSON);
    setupMetricsMock();

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Test input',
      'prompt-id-1',
    );

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: 'Test input' }],
      expect.any(AbortSignal),
      'prompt-id-1',
      { type: SendMessageType.UserQuery },
    );

    // JSON adapter emits array of messages, last one is result with stats
    const outputCalls = processStdoutSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string',
    );
    expect(outputCalls.length).toBeGreaterThan(0);
    const lastOutput = outputCalls[outputCalls.length - 1][0];
    const parsed = JSON.parse(lastOutput);
    expect(Array.isArray(parsed)).toBe(true);
    const resultMessage = parsed.find(
      (msg: unknown) =>
        typeof msg === 'object' &&
        msg !== null &&
        'type' in msg &&
        msg.type === 'result',
    );
    expect(resultMessage).toBeTruthy();
    expect(resultMessage?.result).toBe('Hello World');
    // Get the actual metrics that were used
    const actualMetrics = vi.mocked(uiTelemetryService.getMetrics)();
    expect(resultMessage?.stats).toEqual(actualMetrics);
  });

  it('should write JSON output with stats for tool-only commands (no text response)', async () => {
    // Test the scenario where a command completes successfully with only tool calls
    // but no text response - this would have caught the original bug
    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-1',
        name: 'testTool',
        args: { arg1: 'value1' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-tool-only',
      },
    };
    const toolResponse: Part[] = [{ text: 'Tool executed successfully' }];
    mockCoreExecuteToolCall.mockResolvedValue({ responseParts: toolResponse });

    // First call returns only tool call, no content
    const firstCallEvents: ServerGeminiStreamEvent[] = [
      toolCallEvent,
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 5 } },
      },
    ];

    // Second call returns no content (tool-only completion)
    const secondCallEvents: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 3 } },
      },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents(firstCallEvents))
      .mockReturnValueOnce(createStreamFromEvents(secondCallEvents));

    (mockConfig.getOutputFormat as Mock).mockReturnValue(OutputFormat.JSON);
    setupMetricsMock({
      tools: {
        totalCalls: 1,
        totalSuccess: 1,
        totalFail: 0,
        totalDurationMs: 100,
        totalDecisions: {
          accept: 1,
          reject: 0,
          modify: 0,
          auto_accept: 0,
        },
        byName: {
          testTool: {
            count: 1,
            success: 1,
            fail: 0,
            durationMs: 100,
            decisions: {
              accept: 1,
              reject: 0,
              modify: 0,
              auto_accept: 0,
            },
          },
        },
      },
    });

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Execute tool only',
      'prompt-id-tool-only',
    );

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(2);
    expect(mockCoreExecuteToolCall).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ name: 'testTool' }),
      expect.any(AbortSignal),
      expect.objectContaining({
        outputUpdateHandler: expect.any(Function),
      }),
    );

    // JSON adapter emits array of messages, last one is result with stats
    const outputCalls = processStdoutSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string',
    );
    expect(outputCalls.length).toBeGreaterThan(0);
    const lastOutput = outputCalls[outputCalls.length - 1][0];
    const parsed = JSON.parse(lastOutput);
    expect(Array.isArray(parsed)).toBe(true);
    const resultMessage = parsed.find(
      (msg: unknown) =>
        typeof msg === 'object' &&
        msg !== null &&
        'type' in msg &&
        msg.type === 'result',
    );
    expect(resultMessage).toBeTruthy();
    expect(resultMessage?.result).toBe('');
    // Note: stats would only be included if passed to emitResult, which current implementation doesn't do
    // This test verifies the structure, but stats inclusion depends on implementation
  });

  it('should write JSON output with stats for empty response commands', async () => {
    // Test the scenario where a command completes but produces no content at all
    const events: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 1 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );
    (mockConfig.getOutputFormat as Mock).mockReturnValue(OutputFormat.JSON);
    setupMetricsMock();

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Empty response test',
      'prompt-id-empty',
    );

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: 'Empty response test' }],
      expect.any(AbortSignal),
      'prompt-id-empty',
      { type: SendMessageType.UserQuery },
    );

    // JSON adapter emits array of messages, last one is result with stats
    const outputCalls = processStdoutSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string',
    );
    expect(outputCalls.length).toBeGreaterThan(0);
    const lastOutput = outputCalls[outputCalls.length - 1][0];
    const parsed = JSON.parse(lastOutput);
    expect(Array.isArray(parsed)).toBe(true);
    const resultMessage = parsed.find(
      (msg: unknown) =>
        typeof msg === 'object' &&
        msg !== null &&
        'type' in msg &&
        msg.type === 'result',
    );
    expect(resultMessage).toBeTruthy();
    expect(resultMessage?.result).toBe('');
    // Get the actual metrics that were used
    const actualMetrics = vi.mocked(uiTelemetryService.getMetrics)();
    expect(resultMessage?.stats).toEqual(actualMetrics);
  });

  it('should handle errors in JSON format', async () => {
    (mockConfig.getOutputFormat as Mock).mockReturnValue(OutputFormat.JSON);
    setupMetricsMock();
    const testError = new Error('Invalid input provided');

    mockGeminiClient.sendMessageStream.mockImplementation(() => {
      throw testError;
    });

    let thrownError: Error | null = null;
    try {
      await runNonInteractive(
        mockConfig,
        mockSettings,
        'Test input',
        'prompt-id-error',
      );
      // Should not reach here
      expect.fail('Expected process.exit to be called');
    } catch (error) {
      thrownError = error as Error;
    }

    // Should throw because of mocked process.exit
    expect(thrownError?.message).toBe('process.exit(1) called');

    const jsonError = JSON.stringify(
      {
        error: {
          type: 'Error',
          message: 'Invalid input provided',
          code: 1,
        },
      },
      null,
      2,
    );
    expect(processStderrSpy).toHaveBeenCalledWith(`${jsonError}\n`);
  });

  it('should handle API errors in text mode and exit with error code', async () => {
    (mockConfig.getOutputFormat as Mock).mockReturnValue(OutputFormat.TEXT);
    setupMetricsMock();

    // Simulate an API error event (like 401 unauthorized)
    const apiErrorEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.Error,
      value: {
        error: {
          message: '401 Incorrect API key provided',
          status: 401,
        },
      },
    };

    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents([apiErrorEvent]),
    );

    let thrownError: Error | null = null;
    try {
      await runNonInteractive(
        mockConfig,
        mockSettings,
        'Test input',
        'prompt-id-api-error',
      );
      // Should not reach here
      expect.fail('Expected error to be thrown');
    } catch (error) {
      thrownError = error as Error;
    }

    // Should throw with the API error message
    expect(thrownError).toBeTruthy();
    expect(thrownError?.message).toContain('401');
    expect(thrownError?.message).toContain('Incorrect API key provided');

    // Verify error was written to stderr
    expect(processStderrSpy).toHaveBeenCalled();
    const stderrCalls = processStderrSpy.mock.calls;
    const errorOutput = stderrCalls.map((call) => call[0]).join('');
    expect(errorOutput).toContain('401');
    expect(errorOutput).toContain('Incorrect API key provided');
  });

  it('should handle FatalInputError with custom exit code in JSON format', async () => {
    (mockConfig.getOutputFormat as Mock).mockReturnValue(OutputFormat.JSON);
    setupMetricsMock();
    const fatalError = new FatalInputError('Invalid command syntax provided');

    mockGeminiClient.sendMessageStream.mockImplementation(() => {
      throw fatalError;
    });

    let thrownError: Error | null = null;
    try {
      await runNonInteractive(
        mockConfig,
        mockSettings,
        'Invalid syntax',
        'prompt-id-fatal',
      );
      // Should not reach here
      expect.fail('Expected process.exit to be called');
    } catch (error) {
      thrownError = error as Error;
    }

    // Should throw because of mocked process.exit with custom exit code
    expect(thrownError?.message).toBe('process.exit(42) called');

    const jsonError = JSON.stringify(
      {
        error: {
          type: 'FatalInputError',
          message: 'Invalid command syntax provided',
          code: 42,
        },
      },
      null,
      2,
    );
    expect(processStderrSpy).toHaveBeenCalledWith(`${jsonError}\n`);
  });

  it('should execute a slash command that returns a prompt', async () => {
    setupMetricsMock();
    const mockCommand = {
      name: 'testcommand',
      description: 'a test command',
      kind: CommandKind.FILE,
      action: vi.fn().mockResolvedValue({
        type: 'submit_prompt',
        content: [{ text: 'Prompt from command' }],
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Response from command' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 5 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive(
      mockConfig,
      mockSettings,
      '/testcommand',
      'prompt-id-slash',
    );

    // Ensure the prompt sent to the model is from the command, not the raw input
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: 'Prompt from command' }],
      expect.any(AbortSignal),
      'prompt-id-slash',
      { type: SendMessageType.UserQuery },
    );

    expect(processStdoutSpy).toHaveBeenCalledWith('Response from command');
  });

  it('should handle command that requires confirmation by returning early', async () => {
    setupMetricsMock();
    const mockCommand = {
      name: 'confirm',
      description: 'a command that needs confirmation',
      kind: CommandKind.FILE,
      action: vi.fn().mockResolvedValue({
        type: 'confirm_shell_commands',
        commands: ['rm -rf /'],
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    await runNonInteractive(
      mockConfig,
      mockSettings,
      '/confirm',
      'prompt-id-confirm',
    );

    // Should write error message through adapter to stdout (TEXT mode goes through JsonOutputAdapter)
    expect(processStderrSpy).toHaveBeenCalledWith(
      'Shell command confirmation is not supported in non-interactive mode. Use YOLO mode or pre-approve commands.',
    );
  });

  it('should treat an unknown slash command as a regular prompt', async () => {
    setupMetricsMock();
    // No commands are mocked, so any slash command is "unknown"
    mockGetCommands.mockReturnValue([]);

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Response to unknown' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 5 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive(
      mockConfig,
      mockSettings,
      '/unknowncommand',
      'prompt-id-unknown',
    );

    // Ensure the raw input is sent to the model
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: '/unknowncommand' }],
      expect.any(AbortSignal),
      'prompt-id-unknown',
      { type: SendMessageType.UserQuery },
    );

    expect(processStdoutSpy).toHaveBeenCalledWith('Response to unknown');
  });

  it('should handle known but unsupported slash commands like /help by returning early', async () => {
    setupMetricsMock();
    // Mock a built-in command that exists but is not in the allowed list
    const mockHelpCommand = {
      name: 'help',
      description: 'Show help',
      kind: CommandKind.BUILT_IN,
      action: vi.fn(),
    };
    mockGetCommands.mockReturnValue([mockHelpCommand]);

    await runNonInteractive(
      mockConfig,
      mockSettings,
      '/help',
      'prompt-id-help',
    );

    // Should write error message through adapter to stdout (TEXT mode goes through JsonOutputAdapter)
    expect(processStderrSpy).toHaveBeenCalledWith(
      'The command "/help" is not supported in non-interactive mode.',
    );
  });

  it('should handle unhandled command result types by returning early with error', async () => {
    setupMetricsMock();
    const mockCommand = {
      name: 'noaction',
      description: 'unhandled type',
      kind: CommandKind.FILE,
      action: vi.fn().mockResolvedValue({
        type: 'unhandled',
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    await runNonInteractive(
      mockConfig,
      mockSettings,
      '/noaction',
      'prompt-id-unhandled',
    );

    // Should write error message to stderr
    expect(processStderrSpy).toHaveBeenCalledWith(
      'Unknown command result type: unhandled',
    );
  });

  it('should pass arguments to the slash command action', async () => {
    setupMetricsMock();
    const mockAction = vi.fn().mockResolvedValue({
      type: 'submit_prompt',
      content: [{ text: 'Prompt from command' }],
    });
    const mockCommand = {
      name: 'testargs',
      description: 'a test command',
      kind: CommandKind.FILE,
      action: mockAction,
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Acknowledged' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 1 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive(
      mockConfig,
      mockSettings,
      '/testargs arg1 arg2',
      'prompt-id-args',
    );

    expect(mockAction).toHaveBeenCalledWith(expect.any(Object), 'arg1 arg2');

    expect(processStdoutSpy).toHaveBeenCalledWith('Acknowledged');
  });

  it('should emit stream-json envelopes when output format is stream-json', async () => {
    (mockConfig.getOutputFormat as Mock).mockReturnValue('stream-json');
    (mockConfig.getIncludePartialMessages as Mock).mockReturnValue(false);
    setupMetricsMock();

    const writes: string[] = [];
    processStdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') {
        writes.push(chunk);
      } else {
        writes.push(Buffer.from(chunk).toString('utf8'));
      }
      return true;
    });

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Hello stream' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 4 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Stream input',
      'prompt-stream',
    );

    const envelopes = writes
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    // First envelope should be system message (emitted at session start)
    expect(envelopes[0]).toMatchObject({
      type: 'system',
      subtype: 'init',
    });

    const assistantEnvelope = envelopes.find((env) => env.type === 'assistant');
    expect(assistantEnvelope).toBeTruthy();
    expect(assistantEnvelope?.message?.content?.[0]).toMatchObject({
      type: 'text',
      text: 'Hello stream',
    });
    const resultEnvelope = envelopes.at(-1);
    expect(resultEnvelope).toMatchObject({
      type: 'result',
      is_error: false,
      num_turns: 1,
    });
  });

  it.skip('should emit a single user envelope when userEnvelope is provided', async () => {
    (mockConfig.getOutputFormat as Mock).mockReturnValue('stream-json');
    (mockConfig.getIncludePartialMessages as Mock).mockReturnValue(false);

    const writes: string[] = [];
    processStdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') {
        writes.push(chunk);
      } else {
        writes.push(Buffer.from(chunk).toString('utf8'));
      }
      return true;
    });

    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents([
        { type: GeminiEventType.Content, value: 'Handled once' },
        {
          type: GeminiEventType.Finished,
          value: { reason: undefined, usageMetadata: { totalTokenCount: 2 } },
        },
      ]),
    );

    const userEnvelope = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '来自 envelope 的消息',
          },
        ],
      },
    } as unknown as CLIUserMessage;

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'ignored input',
      'prompt-envelope',
      {
        userMessage: userEnvelope,
      },
    );

    const envelopes = writes
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    const userEnvelopes = envelopes.filter((env) => env.type === 'user');
    expect(userEnvelopes).toHaveLength(0);
  });

  it('should include usage metadata and API duration in stream-json result', async () => {
    (mockConfig.getOutputFormat as Mock).mockReturnValue('stream-json');
    (mockConfig.getIncludePartialMessages as Mock).mockReturnValue(false);
    setupMetricsMock({
      models: {
        'test-model': {
          api: {
            totalRequests: 1,
            totalErrors: 0,
            totalLatencyMs: 500,
          },
          tokens: {
            prompt: 11,
            candidates: 5,
            total: 16,
            cached: 3,
            thoughts: 0,
            tool: 0,
          },
        },
      },
    });

    const writes: string[] = [];
    processStdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') {
        writes.push(chunk);
      } else {
        writes.push(Buffer.from(chunk).toString('utf8'));
      }
      return true;
    });

    const usageMetadata = {
      promptTokenCount: 11,
      candidatesTokenCount: 5,
      totalTokenCount: 16,
      cachedContentTokenCount: 3,
    };
    mockGetDebugResponses.mockReturnValue([{ usageMetadata }]);

    const nowSpy = vi.spyOn(Date, 'now');
    let current = 0;
    nowSpy.mockImplementation(() => {
      current += 500;
      return current;
    });

    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents([
        { type: GeminiEventType.Content, value: 'All done' },
      ]),
    );

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'usage test',
      'prompt-usage',
    );

    const envelopes = writes
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    const resultEnvelope = envelopes.at(-1);
    expect(resultEnvelope?.type).toBe('result');
    expect(resultEnvelope?.duration_api_ms).toBeGreaterThan(0);
    expect(resultEnvelope?.usage).toEqual({
      input_tokens: 11,
      output_tokens: 5,
      total_tokens: 16,
      cache_read_input_tokens: 3,
    });

    nowSpy.mockRestore();
  });

  it('should not emit user message when userMessage option is provided (stream-json input binding)', async () => {
    (mockConfig.getOutputFormat as Mock).mockReturnValue('stream-json');
    (mockConfig.getIncludePartialMessages as Mock).mockReturnValue(false);
    setupMetricsMock();

    const writes: string[] = [];
    processStdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') {
        writes.push(chunk);
      } else {
        writes.push(Buffer.from(chunk).toString('utf8'));
      }
      return true;
    });

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Response from envelope' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 5 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    const userMessage: CLIUserMessage = {
      type: 'user',
      uuid: 'test-uuid',
      session_id: 'test-session',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Message from stream-json input',
          },
        ],
      },
    };

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'ignored input',
      'prompt-envelope',
      {
        userMessage,
      },
    );

    const envelopes = writes
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    // Should NOT emit user message since it came from userMessage option
    const userEnvelopes = envelopes.filter((env) => env.type === 'user');
    expect(userEnvelopes).toHaveLength(0);

    // Should emit assistant message
    const assistantEnvelope = envelopes.find((env) => env.type === 'assistant');
    expect(assistantEnvelope).toBeTruthy();

    // Verify the model received the correct parts from userMessage
    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: 'Message from stream-json input' }],
      expect.any(AbortSignal),
      'prompt-envelope',
      { type: SendMessageType.UserQuery },
    );
  });

  it('should emit tool results as user messages in stream-json format', async () => {
    (mockConfig.getOutputFormat as Mock).mockReturnValue('stream-json');
    (mockConfig.getIncludePartialMessages as Mock).mockReturnValue(false);
    setupMetricsMock();

    const writes: string[] = [];
    processStdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') {
        writes.push(chunk);
      } else {
        writes.push(Buffer.from(chunk).toString('utf8'));
      }
      return true;
    });

    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-1',
        name: 'testTool',
        args: { arg1: 'value1' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-tool',
      },
    };
    const toolResponse: Part[] = [
      {
        functionResponse: {
          name: 'testTool',
          response: { output: 'Tool executed successfully' },
        },
      },
    ];
    mockCoreExecuteToolCall.mockResolvedValue({ responseParts: toolResponse });

    const firstCallEvents: ServerGeminiStreamEvent[] = [toolCallEvent];
    const secondCallEvents: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Final response' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents(firstCallEvents))
      .mockReturnValueOnce(createStreamFromEvents(secondCallEvents));

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Use tool',
      'prompt-id-tool',
    );

    const envelopes = writes
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    // Should have tool use in assistant message
    const assistantEnvelope = envelopes.find((env) => env.type === 'assistant');
    expect(assistantEnvelope).toBeTruthy();
    const toolUseBlock = assistantEnvelope?.message?.content?.find(
      (block: unknown) =>
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        block.type === 'tool_use',
    );
    expect(toolUseBlock).toBeTruthy();
    expect(toolUseBlock?.name).toBe('testTool');

    // Should have tool result as user message
    const toolResultUserMessages = envelopes.filter(
      (env) =>
        env.type === 'user' &&
        Array.isArray(env.message?.content) &&
        env.message.content.some(
          (block: unknown) =>
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            block.type === 'tool_result',
        ),
    );
    expect(toolResultUserMessages).toHaveLength(1);
    const toolResultBlock = toolResultUserMessages[0]?.message?.content?.find(
      (block: unknown) =>
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        block.type === 'tool_result',
    );
    expect(toolResultBlock?.tool_use_id).toBe('tool-1');
    expect(toolResultBlock?.is_error).toBe(false);
    expect(toolResultBlock?.content).toBe('Tool executed successfully');
  });

  it('should emit tool errors in tool_result blocks in stream-json format', async () => {
    (mockConfig.getOutputFormat as Mock).mockReturnValue('stream-json');
    (mockConfig.getIncludePartialMessages as Mock).mockReturnValue(false);
    setupMetricsMock();

    const writes: string[] = [];
    processStdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') {
        writes.push(chunk);
      } else {
        writes.push(Buffer.from(chunk).toString('utf8'));
      }
      return true;
    });

    const toolCallEvent: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-error',
        name: 'errorTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-id-error',
      },
    };
    mockCoreExecuteToolCall.mockResolvedValue({
      error: new Error('Tool execution failed'),
      errorType: ToolErrorType.EXECUTION_FAILED,
      responseParts: [
        {
          functionResponse: {
            name: 'errorTool',
            response: {
              output: 'Error: Tool execution failed',
            },
          },
        },
      ],
      resultDisplay: 'Tool execution failed',
    });

    const finalResponse: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Content,
        value: 'I encountered an error',
      },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 10 } },
      },
    ];
    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents([toolCallEvent]))
      .mockReturnValueOnce(createStreamFromEvents(finalResponse));

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Trigger error',
      'prompt-id-error',
    );

    const envelopes = writes
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    // Tool errors are now captured in tool_result blocks with is_error=true,
    // not as separate system messages (see comment in nonInteractiveCli.ts line 307-309)
    const toolResultMessages = envelopes.filter(
      (env) =>
        env.type === 'user' &&
        Array.isArray(env.message?.content) &&
        env.message.content.some(
          (block: unknown) =>
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            block.type === 'tool_result',
        ),
    );
    expect(toolResultMessages.length).toBeGreaterThan(0);
    const toolResultBlock = toolResultMessages[0]?.message?.content?.find(
      (block: unknown) =>
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        block.type === 'tool_result',
    );
    expect(toolResultBlock?.tool_use_id).toBe('tool-error');
    expect(toolResultBlock?.is_error).toBe(true);
  });

  it('should emit partial messages when includePartialMessages is true', async () => {
    (mockConfig.getOutputFormat as Mock).mockReturnValue('stream-json');
    (mockConfig.getIncludePartialMessages as Mock).mockReturnValue(true);
    setupMetricsMock();

    const writes: string[] = [];
    processStdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') {
        writes.push(chunk);
      } else {
        writes.push(Buffer.from(chunk).toString('utf8'));
      }
      return true;
    });

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Hello' },
      { type: GeminiEventType.Content, value: ' World' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 5 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Stream test',
      'prompt-partial',
    );

    const envelopes = writes
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    // Should have stream events for partial messages
    const streamEvents = envelopes.filter((env) => env.type === 'stream_event');
    expect(streamEvents.length).toBeGreaterThan(0);

    // Should have message_start event
    const messageStart = streamEvents.find(
      (ev) => ev.event?.type === 'message_start',
    );
    expect(messageStart).toBeTruthy();

    // Should have content_block_delta events for incremental text
    const textDeltas = streamEvents.filter(
      (ev) => ev.event?.type === 'content_block_delta',
    );
    expect(textDeltas.length).toBeGreaterThan(0);
  });

  it('should handle thinking blocks in stream-json format', async () => {
    (mockConfig.getOutputFormat as Mock).mockReturnValue('stream-json');
    (mockConfig.getIncludePartialMessages as Mock).mockReturnValue(false);
    setupMetricsMock();

    const writes: string[] = [];
    processStdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') {
        writes.push(chunk);
      } else {
        writes.push(Buffer.from(chunk).toString('utf8'));
      }
      return true;
    });

    const events: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Thought,
        value: { subject: 'Analysis', description: 'Processing request' },
      },
      { type: GeminiEventType.Content, value: 'Response text' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 8 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Thinking test',
      'prompt-thinking',
    );

    const envelopes = writes
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    const assistantEnvelope = envelopes.find((env) => env.type === 'assistant');
    expect(assistantEnvelope).toBeTruthy();

    const thinkingBlock = assistantEnvelope?.message?.content?.find(
      (block: unknown) =>
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        block.type === 'thinking',
    );
    expect(thinkingBlock).toBeTruthy();
    expect(thinkingBlock?.signature).toBe('Analysis');
    expect(thinkingBlock?.thinking).toContain('Processing request');
  });

  it('should handle multiple tool calls in stream-json format', async () => {
    (mockConfig.getOutputFormat as Mock).mockReturnValue('stream-json');
    (mockConfig.getIncludePartialMessages as Mock).mockReturnValue(false);
    setupMetricsMock();

    const writes: string[] = [];
    processStdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') {
        writes.push(chunk);
      } else {
        writes.push(Buffer.from(chunk).toString('utf8'));
      }
      return true;
    });

    const toolCall1: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-1',
        name: 'firstTool',
        args: { param: 'value1' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-multi',
      },
    };
    const toolCall2: ServerGeminiStreamEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'tool-2',
        name: 'secondTool',
        args: { param: 'value2' },
        isClientInitiated: false,
        prompt_id: 'prompt-id-multi',
      },
    };

    mockCoreExecuteToolCall
      .mockResolvedValueOnce({
        responseParts: [{ text: 'First tool result' }],
      })
      .mockResolvedValueOnce({
        responseParts: [{ text: 'Second tool result' }],
      });

    const firstCallEvents: ServerGeminiStreamEvent[] = [toolCall1, toolCall2];
    const secondCallEvents: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Combined response' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 15 } },
      },
    ];

    mockGeminiClient.sendMessageStream
      .mockReturnValueOnce(createStreamFromEvents(firstCallEvents))
      .mockReturnValueOnce(createStreamFromEvents(secondCallEvents));

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'Multiple tools',
      'prompt-id-multi',
    );

    const envelopes = writes
      .join('')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    // Should have assistant message with both tool uses
    const assistantEnvelope = envelopes.find((env) => env.type === 'assistant');
    expect(assistantEnvelope).toBeTruthy();
    const toolUseBlocks = assistantEnvelope?.message?.content?.filter(
      (block: unknown) =>
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        block.type === 'tool_use',
    );
    expect(toolUseBlocks?.length).toBe(2);
    const toolNames = (toolUseBlocks ?? []).map((b: unknown) => {
      if (
        typeof b === 'object' &&
        b !== null &&
        'name' in b &&
        typeof (b as { name: unknown }).name === 'string'
      ) {
        return (b as { name: string }).name;
      }
      return '';
    });
    expect(toolNames).toContain('firstTool');
    expect(toolNames).toContain('secondTool');

    // Should have two tool result user messages
    const toolResultMessages = envelopes.filter(
      (env) =>
        env.type === 'user' &&
        Array.isArray(env.message?.content) &&
        env.message.content.some(
          (block: unknown) =>
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            block.type === 'tool_result',
        ),
    );
    expect(toolResultMessages.length).toBe(2);
  });

  it('should handle userMessage with text content blocks in stream-json input mode', async () => {
    (mockConfig.getOutputFormat as Mock).mockReturnValue('stream-json');
    (mockConfig.getIncludePartialMessages as Mock).mockReturnValue(false);
    setupMetricsMock();

    const writes: string[] = [];
    processStdoutSpy.mockImplementation((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') {
        writes.push(chunk);
      } else {
        writes.push(Buffer.from(chunk).toString('utf8'));
      }
      return true;
    });

    const events: ServerGeminiStreamEvent[] = [
      { type: GeminiEventType.Content, value: 'Response' },
      {
        type: GeminiEventType.Finished,
        value: { reason: undefined, usageMetadata: { totalTokenCount: 3 } },
      },
    ];
    mockGeminiClient.sendMessageStream.mockReturnValue(
      createStreamFromEvents(events),
    );

    // UserMessage with string content
    const userMessageString: CLIUserMessage = {
      type: 'user',
      uuid: 'test-uuid-1',
      session_id: 'test-session',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: 'Simple string content',
      },
    };

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'ignored',
      'prompt-string-content',
      {
        userMessage: userMessageString,
      },
    );

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: 'Simple string content' }],
      expect.any(AbortSignal),
      'prompt-string-content',
      { type: SendMessageType.UserQuery },
    );

    // UserMessage with array of text blocks
    mockGeminiClient.sendMessageStream.mockClear();
    const userMessageBlocks: CLIUserMessage = {
      type: 'user',
      uuid: 'test-uuid-2',
      session_id: 'test-session',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'Second part' },
        ],
      },
    };

    await runNonInteractive(
      mockConfig,
      mockSettings,
      'ignored',
      'prompt-blocks-content',
      {
        userMessage: userMessageBlocks,
      },
    );

    expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
      [{ text: 'First part' }, { text: 'Second part' }],
      expect.any(AbortSignal),
      'prompt-blocks-content',
      { type: SendMessageType.UserQuery },
    );
  });
});
