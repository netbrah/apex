/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mocked,
} from 'vitest';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';
import {
  DiscoveredMCPTool,
  generateValidName,
  formatMcpToolName,
} from './mcp-tool.js'; // Added getStringifiedResultForDisplay
import { ToolConfirmationOutcome, type ToolResult } from './tools.js';
import type { CallableTool, Part } from '@google/genai';
import { ToolErrorType } from './tool-error.js';
import {
  createMockMessageBus,
  getMockMessageBusInstance,
} from '../test-utils/mock-message-bus.js';

vi.mock('node:fs/promises');

// Mock @google/genai mcpToTool and CallableTool
// We only need to mock the parts of CallableTool that DiscoveredMCPTool uses.
const mockCallTool = vi.fn();
const mockToolMethod = vi.fn();

const mockCallableToolInstance: Mocked<CallableTool> = {
  tool: mockToolMethod as any, // Not directly used by DiscoveredMCPTool instance methods
  callTool: mockCallTool as any,
  // Add other methods if DiscoveredMCPTool starts using them
};

const createSdkResponse = (
  toolName: string,
  response: Record<string, any>,
): Part[] => [
  {
    functionResponse: {
      name: toolName,
      response,
    },
  },
];

describe('generateValidName', () => {
  it('should return a valid name for a simple function', () => {
    expect(generateValidName('myFunction')).toBe('mcp_myFunction');
  });

  it('should replace invalid characters with underscores', () => {
    expect(generateValidName('invalid-name with spaces')).toBe(
      'mcp_invalid-name_with_spaces',
    );
  });

  it('should truncate long names', () => {
    expect(generateValidName('x'.repeat(80))).toBe(
      'mcp_xxxxxxxxxxxxxxxxxxxxxxxxxx...xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    );
  });

  it('should handle names with only invalid characters', () => {
    expect(generateValidName('!@#$%^&*()')).toBe('mcp___________');
  });

  it.each([
    { length: 63, expected: 63, description: 'exactly 63 characters' },
    { length: 64, expected: 63, description: 'exactly 64 characters' },
    { length: 80, expected: 63, description: 'longer than 64 characters' },
  ])(
    'should handle names that are $description long',
    ({ length, expected }) => {
      expect(generateValidName('a'.repeat(length)).length).toBe(expected);
    },
  );
});

describe('formatMcpToolName', () => {
  it('should format a fully qualified name', () => {
    expect(formatMcpToolName('github', 'list_repos')).toBe(
      'mcp_github_list_repos',
    );
  });

  it('should handle global wildcards', () => {
    expect(formatMcpToolName('*')).toBe('mcp_*');
  });

  it('should handle tool-level wildcards', () => {
    expect(formatMcpToolName('github', '*')).toBe('mcp_github_*');
  });

  it('should handle both server and tool wildcards', () => {
    expect(formatMcpToolName('*', '*')).toBe('mcp_*');
  });

  it('should handle undefined toolName as a tool-level wildcard', () => {
    expect(formatMcpToolName('github')).toBe('mcp_github_*');
  });

  it('should format explicitly global wildcard with specific tool', () => {
    expect(formatMcpToolName('*', 'list_repos')).toBe('mcp_*_list_repos');
  });
});

describe('DiscoveredMCPTool', () => {
  const serverName = 'mock-mcp-server';
  const serverToolName = 'actual-server-tool-name';
  const baseDescription = 'A test MCP tool.';
  const inputSchema: Record<string, unknown> = {
    type: 'object' as const,
    properties: { param: { type: 'string' } },
    required: ['param'],
  };

  let tool: DiscoveredMCPTool;

  beforeEach(() => {
    mockCallTool.mockClear();
    mockToolMethod.mockClear();
    const bus = createMockMessageBus();
    getMockMessageBusInstance(bus).defaultToolDecision = 'ask_user';
    tool = new DiscoveredMCPTool(
      mockCallableToolInstance,
      serverName,
      serverToolName,
      baseDescription,
      inputSchema,
      bus,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should set properties correctly', () => {
      expect(tool.name).toBe('mcp_mock-mcp-server_actual-server-tool-name');
      expect(tool.schema.name).toBe(
        'mcp_mock-mcp-server_actual-server-tool-name',
      );
      expect(tool.schema.description).toBe(baseDescription);
      expect(tool.schema.parameters).toBeUndefined();
      expect(tool.schema.parametersJsonSchema).toEqual({
        ...inputSchema,
        properties: {
          ...(inputSchema['properties'] as Record<string, unknown>),
          wait_for_previous: {
            type: 'boolean',
            description:
              'Set to true to wait for all previously requested tools in this turn to complete before starting. Set to false (or omit) to run in parallel. Use true when this tool depends on the output of previous tools.',
          },
        },
      });
      expect(tool.serverToolName).toBe(serverToolName);
    });
  });

  describe('getDisplayTitle and getExplanation', () => {
    const commandTool = new DiscoveredMCPTool(
      mockCallableToolInstance,
      serverName,
      serverToolName,
      baseDescription,
      {
        type: 'object',
        properties: { command: { type: 'string' }, path: { type: 'string' } },
        required: ['command'],
      },
      createMockMessageBus(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    it('should return command as title if it exists', () => {
      const invocation = commandTool.build({ command: 'ls -la' });
      expect(invocation.getDisplayTitle?.()).toBe('ls -la');
    });

    it('should return displayName if command does not exist', () => {
      const invocation = tool.build({ param: 'testValue' });
      expect(invocation.getDisplayTitle?.()).toBe(tool.displayName);
    });

    it('should return stringified json for getExplanation', () => {
      const params = { command: 'ls -la', path: '/' };
      const invocation = commandTool.build(params);
      expect(invocation.getExplanation?.()).toBe(safeJsonStringify(params));
    });

    it('should truncate and summarize long json payloads for getExplanation', () => {
      const longString = 'a'.repeat(600);
      const params = { command: 'echo', text: longString, other: 'value' };
      const invocation = commandTool.build(params);
      const explanation = invocation.getExplanation?.() ?? '';
      expect(explanation).toMatch(
        /^\[Payload omitted due to length with parameters: command, text, other\]$/,
      );
    });
  });

  describe('execute', () => {
    it('should call mcpTool.callTool with correct parameters and format display output', async () => {
      const params = { param: 'testValue' };
      const mockToolSuccessResultObject = {
        success: true,
        details: 'executed',
      };
      const mockFunctionResponseContent = [
        {
          type: 'text',
          text: JSON.stringify(mockToolSuccessResultObject),
        },
      ];
      const mockMcpToolResponseParts: Part[] = [
        {
          functionResponse: {
            name: serverToolName,
            response: { content: mockFunctionResponseContent },
          },
        },
      ];
      mockCallTool.mockResolvedValue(mockMcpToolResponseParts);

      const invocation = tool.build(params);
      const toolResult: ToolResult = await invocation.execute(
        new AbortController().signal,
      );

      expect(mockCallTool).toHaveBeenCalledWith([
        { name: serverToolName, args: params },
      ]);

      const stringifiedResponseContent = JSON.stringify(
        mockToolSuccessResultObject,
      );
      expect(toolResult.llmContent).toEqual([
        { text: stringifiedResponseContent },
      ]);
      expect(toolResult.returnDisplay).toBe(stringifiedResponseContent);
    });

    it('should handle empty result from getDisplayFromParts', async () => {
      const params = { param: 'testValue' };
      const mockMcpToolResponsePartsEmpty: Part[] = [];
      mockCallTool.mockResolvedValue(mockMcpToolResponsePartsEmpty);
      const invocation = tool.build(params);
      const toolResult: ToolResult = await invocation.execute(
        new AbortController().signal,
      );
      expect(toolResult.returnDisplay).toBe(
        '[Error: Could not parse tool response]',
      );
      expect(toolResult.llmContent).toEqual([
        { text: '[Error: Could not parse tool response]' },
      ]);
    });

    it('should propagate rejection if mcpTool.callTool rejects', async () => {
      const params = { param: 'failCase' };
      const expectedError = new Error('MCP call failed');
      mockCallTool.mockRejectedValue(expectedError);

      const invocation = tool.build(params);
      await expect(
        invocation.execute(new AbortController().signal),
      ).rejects.toThrow(expectedError);
    });

    it.each([
      { isErrorValue: true, description: 'true (bool)' },
      { isErrorValue: 'true', description: '"true" (str)' },
    ])(
      'should return a structured error if MCP tool reports an error',
      async ({ isErrorValue }) => {
        const tool = new DiscoveredMCPTool(
          mockCallableToolInstance,
          serverName,
          serverToolName,
          baseDescription,
          inputSchema,
          createMockMessageBus(),
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
        );
        const params = { param: 'isErrorTrueCase' };
        const functionCall = {
          name: serverToolName,
          args: params,
        };

        const errorResponse = { isError: isErrorValue };
        const mockMcpToolResponseParts: Part[] = [
          {
            functionResponse: {
              name: serverToolName,
              response: { error: errorResponse },
            },
          },
        ];
        mockCallTool.mockResolvedValue(mockMcpToolResponseParts);
        const expectedErrorMessage = `MCP tool '${
          serverToolName
        }' reported tool error for function call: ${safeJsonStringify(
          functionCall,
        )} with response: ${safeJsonStringify(mockMcpToolResponseParts)}`;
        const invocation = tool.build(params);
        const result = await invocation.execute(new AbortController().signal);

        expect(result.error?.type).toBe(ToolErrorType.MCP_TOOL_ERROR);
        expect(result.llmContent).toBe(expectedErrorMessage);
        expect(result.returnDisplay).toContain(
          `Error: MCP tool '${serverToolName}' reported an error.`,
        );
      },
    );

    it('should return a structured error if MCP tool reports a top-level isError (spec compliant)', async () => {
      const tool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        createMockMessageBus(),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      const params = { param: 'isErrorTopLevelCase' };
      const functionCall = {
        name: serverToolName,
        args: params,
      };

      // Spec compliant error response: { isError: true } at the top level of content (or response object in this mapping)
      const errorResponse = { isError: true };
      const mockMcpToolResponseParts: Part[] = [
        {
          functionResponse: {
            name: serverToolName,
            response: errorResponse,
          },
        },
      ];
      mockCallTool.mockResolvedValue(mockMcpToolResponseParts);
      const expectedErrorMessage = `MCP tool '${serverToolName}' reported tool error for function call: ${safeJsonStringify(
        functionCall,
      )} with response: ${safeJsonStringify(mockMcpToolResponseParts)}`;
      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error?.type).toBe(ToolErrorType.MCP_TOOL_ERROR);
      expect(result.llmContent).toBe(expectedErrorMessage);
      expect(result.returnDisplay).toContain(
        `Error: MCP tool '${serverToolName}' reported an error.`,
      );
    });

    it.each([
      { isErrorValue: false, description: 'false (bool)' },
      { isErrorValue: 'false', description: '"false" (str)' },
    ])(
      'should consider a ToolResult with isError ${description} to be a success',
      async ({ isErrorValue }) => {
        const tool = new DiscoveredMCPTool(
          mockCallableToolInstance,
          serverName,
          serverToolName,
          baseDescription,
          inputSchema,
          createMockMessageBus(),
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
        );
        const params = { param: 'isErrorFalseCase' };
        const mockToolSuccessResultObject = {
          success: true,
          details: 'executed',
        };
        const mockFunctionResponseContent = [
          {
            type: 'text',
            text: JSON.stringify(mockToolSuccessResultObject),
          },
        ];

        const errorResponse = { isError: isErrorValue };
        const mockMcpToolResponseParts: Part[] = [
          {
            functionResponse: {
              name: serverToolName,
              response: {
                error: errorResponse,
                content: mockFunctionResponseContent,
              },
            },
          },
        ];
        mockCallTool.mockResolvedValue(mockMcpToolResponseParts);

        const invocation = tool.build(params);
        const toolResult = await invocation.execute(
          new AbortController().signal,
        );

        const stringifiedResponseContent = JSON.stringify(
          mockToolSuccessResultObject,
        );
        expect(toolResult.llmContent).toEqual([
          { text: stringifiedResponseContent },
        ]);
        expect(toolResult.returnDisplay).toBe(stringifiedResponseContent);
      },
    );

    it('should handle a simple text response correctly', async () => {
      const params = { param: 'test' };
      const successMessage = 'This is a success message.';

      mockCallTool.mockResolvedValue(
        createSdkResponse(serverToolName, {
          content: [{ type: 'text', text: successMessage }],
        }),
      );

      const invocation = tool.build(params);
      const toolResult = await invocation.execute(new AbortController().signal);

      // 1. Assert that the llmContent sent to the scheduler is a clean Part array.
      expect(toolResult.llmContent).toEqual([{ text: successMessage }]);

      // 2. Assert that the display output is the simple text message.
      expect(toolResult.returnDisplay).toBe(successMessage);

      // 3. Verify that the underlying callTool was made correctly.
      expect(mockCallTool).toHaveBeenCalledWith([
        { name: serverToolName, args: params },
      ]);
    });

    it('should handle an AudioBlock response', async () => {
      const params = { param: 'play' };
      mockCallTool.mockResolvedValue(
        createSdkResponse(serverToolName, {
          content: [
            {
              type: 'audio',
              data: 'BASE64_AUDIO_DATA',
              mimeType: 'audio/mp3',
            },
          ],
        }),
      );

      const invocation = tool.build(params);
      const toolResult = await invocation.execute(new AbortController().signal);

      expect(toolResult.llmContent).toEqual([
        {
          text: `[Tool '${serverToolName}' provided the following audio data with mime-type: audio/mp3]`,
        },
        {
          inlineData: {
            mimeType: 'audio/mp3',
            data: 'BASE64_AUDIO_DATA',
          },
        },
      ]);
      expect(toolResult.returnDisplay).toBe(
        `[Tool '${serverToolName}' provided the following audio data with mime-type: audio/mp3]\n[audio/mp3]`,
      );
    });

    it('should handle a ResourceLinkBlock response', async () => {
      const params = { param: 'get' };
      mockCallTool.mockResolvedValue(
        createSdkResponse(serverToolName, {
          content: [
            {
              type: 'resource_link',
              uri: 'file:///path/to/thing',
              name: 'resource-name',
              title: 'My Resource',
            },
          ],
        }),
      );

      const invocation = tool.build(params);
      const toolResult = await invocation.execute(new AbortController().signal);

      expect(toolResult.llmContent).toEqual([
        {
          text: 'Resource Link: My Resource at file:///path/to/thing',
        },
      ]);
      expect(toolResult.returnDisplay).toBe(
        'Resource Link: My Resource at file:///path/to/thing',
      );
    });

    it('should handle an embedded text ResourceBlock response', async () => {
      const params = { param: 'get' };
      mockCallTool.mockResolvedValue(
        createSdkResponse(serverToolName, {
          content: [
            {
              type: 'resource',
              resource: {
                uri: 'file:///path/to/text.txt',
                text: 'This is the text content.',
                mimeType: 'text/plain',
              },
            },
          ],
        }),
      );

      const invocation = tool.build(params);
      const toolResult = await invocation.execute(new AbortController().signal);

      expect(toolResult.llmContent).toEqual([
        { text: 'This is the text content.' },
      ]);
      expect(toolResult.returnDisplay).toBe('This is the text content.');
    });

    it('should handle an embedded binary ResourceBlock response', async () => {
      const params = { param: 'get' };
      mockCallTool.mockResolvedValue(
        createSdkResponse(serverToolName, {
          content: [
            {
              type: 'resource',
              resource: {
                uri: 'file:///path/to/data.bin',
                blob: 'BASE64_BINARY_DATA',
                mimeType: 'application/octet-stream',
              },
            },
          ],
        }),
      );

      const invocation = tool.build(params);
      const toolResult = await invocation.execute(new AbortController().signal);

      expect(toolResult.llmContent).toEqual([
        {
          text: `[Tool '${serverToolName}' provided the following embedded resource with mime-type: application/octet-stream]`,
        },
        {
          inlineData: {
            mimeType: 'application/octet-stream',
            data: 'BASE64_BINARY_DATA',
          },
        },
      ]);
      expect(toolResult.returnDisplay).toBe(
        `[Tool '${serverToolName}' provided the following embedded resource with mime-type: application/octet-stream]\n[application/octet-stream]`,
      );
    });

    it('should handle a mix of content block types', async () => {
      const params = { param: 'complex' };
      mockCallTool.mockResolvedValue(
        createSdkResponse(serverToolName, {
          content: [
            { type: 'text', text: 'First part.' },
            {
              type: 'image',
              data: 'BASE64_IMAGE_DATA',
              mimeType: 'image/jpeg',
            },
            { type: 'text', text: 'Second part.' },
          ],
        }),
      );

      const invocation = tool.build(params);
      const toolResult = await invocation.execute(new AbortController().signal);

      expect(toolResult.llmContent).toEqual([
        { text: 'First part.' },
        {
          text: `[Tool '${serverToolName}' provided the following image data with mime-type: image/jpeg]`,
        },
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: 'BASE64_IMAGE_DATA',
          },
        },
        { text: 'Second part.' },
      ]);
      expect(toolResult.returnDisplay).toBe(
        `First part.\n[Tool '${serverToolName}' provided the following image data with mime-type: image/jpeg]\n[image/jpeg]\nSecond part.`,
      );
    });

    it('should ignore unknown content block types', async () => {
      const params = { param: 'test' };
      mockCallTool.mockResolvedValue(
        createSdkResponse(serverToolName, {
          content: [
            { type: 'text', text: 'Valid part.' },
            { type: 'future_block', data: 'some-data' },
          ],
        }),
      );

      const invocation = tool.build(params);
      const toolResult = await invocation.execute(new AbortController().signal);

      expect(toolResult.llmContent).toEqual([{ text: 'Valid part.' }]);
      expect(toolResult.returnDisplay).toBe('Valid part.');
    });

    it('should handle a complex mix of content block types', async () => {
      const params = { param: 'super-complex' };
      mockCallTool.mockResolvedValue(
        createSdkResponse(serverToolName, {
          content: [
            { type: 'text', text: 'Here is a resource.' },
            {
              type: 'resource_link',
              uri: 'file:///path/to/resource',
              name: 'resource-name',
              title: 'My Resource',
            },
            {
              type: 'resource',
              resource: {
                uri: 'file:///path/to/text.txt',
                text: 'Embedded text content.',
                mimeType: 'text/plain',
              },
            },
            {
              type: 'image',
              data: 'BASE64_IMAGE_DATA',
              mimeType: 'image/jpeg',
            },
          ],
        }),
      );

      const invocation = tool.build(params);
      const toolResult = await invocation.execute(new AbortController().signal);

      expect(toolResult.llmContent).toEqual([
        { text: 'Here is a resource.' },
        {
          text: 'Resource Link: My Resource at file:///path/to/resource',
        },
        { text: 'Embedded text content.' },
        {
          text: `[Tool '${serverToolName}' provided the following image data with mime-type: image/jpeg]`,
        },
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: 'BASE64_IMAGE_DATA',
          },
        },
      ]);
      expect(toolResult.returnDisplay).toBe(
        `Here is a resource.\nResource Link: My Resource at file:///path/to/resource\nEmbedded text content.\n[Tool '${serverToolName}' provided the following image data with mime-type: image/jpeg]\n[image/jpeg]`,
      );
    });

    describe('AbortSignal support', () => {
      const MOCK_TOOL_DELAY = 1000;
      const ABORT_DELAY = 50;

      it('should abort immediately if signal is already aborted', async () => {
        const params = { param: 'test' };
        const controller = new AbortController();
        controller.abort();

        const invocation = tool.build(params);

        await expect(invocation.execute(controller.signal)).rejects.toThrow(
          'Tool call aborted',
        );

        // Tool should not be called if signal is already aborted
        expect(mockCallTool).not.toHaveBeenCalled();
      });

      it('should abort during tool execution', async () => {
        const params = { param: 'test' };
        const controller = new AbortController();

        // Mock a delayed response to simulate long-running tool
        mockCallTool.mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => {
                resolve([
                  {
                    functionResponse: {
                      name: serverToolName,
                      response: {
                        content: [{ type: 'text', text: 'Success' }],
                      },
                    },
                  },
                ]);
              }, MOCK_TOOL_DELAY);
            }),
        );

        const invocation = tool.build(params);
        const promise = invocation.execute(controller.signal);

        // Abort after a short delay to simulate cancellation during execution
        setTimeout(() => controller.abort(), ABORT_DELAY);

        await expect(promise).rejects.toThrow('Tool call aborted');
      });

      it('should complete successfully if not aborted', async () => {
        const params = { param: 'test' };
        const controller = new AbortController();

        mockCallTool.mockResolvedValue(
          createSdkResponse(serverToolName, {
            content: [{ type: 'text', text: 'Success' }],
          }),
        );

        const invocation = tool.build(params);
        const result = await invocation.execute(controller.signal);

        expect(result.llmContent).toEqual([{ text: 'Success' }]);
        expect(result.returnDisplay).toBe('Success');
        expect(mockCallTool).toHaveBeenCalledWith([
          { name: serverToolName, args: params },
        ]);
      });

      it('should handle tool error even when abort signal is provided', async () => {
        const params = { param: 'test' };
        const controller = new AbortController();

        mockCallTool.mockResolvedValue(
          createSdkResponse(serverToolName, { error: { isError: true } }),
        );

        const invocation = tool.build(params);
        const result = await invocation.execute(controller.signal);

        expect(result.error?.type).toBe(ToolErrorType.MCP_TOOL_ERROR);
        expect(result.returnDisplay).toContain(
          `Error: MCP tool '${serverToolName}' reported an error.`,
        );
      });

      it('should handle callTool rejection with abort signal', async () => {
        const params = { param: 'test' };
        const controller = new AbortController();
        const expectedError = new Error('Network error');

        mockCallTool.mockRejectedValue(expectedError);

        const invocation = tool.build(params);

        await expect(invocation.execute(controller.signal)).rejects.toThrow(
          expectedError,
        );
      });

      it.each([
        {
          name: 'successful completion',
          setup: () => {
            mockCallTool.mockResolvedValue(
              createSdkResponse(serverToolName, {
                content: [{ type: 'text', text: 'Success' }],
              }),
            );
          },
          expectError: false,
        },
        {
          name: 'error',
          setup: () => {
            mockCallTool.mockRejectedValue(new Error('Tool execution failed'));
          },
          expectError: true,
        },
      ])(
        'should cleanup event listeners properly on $name',
        async ({ setup, expectError }) => {
          const params = { param: 'test' };
          const controller = new AbortController();

          setup();

          const invocation = tool.build(params);

          if (expectError) {
            try {
              await invocation.execute(controller.signal);
            } catch {
              // Expected error
            }
          } else {
            await invocation.execute(controller.signal);
          }

          // Verify cleanup by aborting after execution
          controller.abort();
          expect(controller.signal.aborted).toBe(true);
        },
      );
    });
  });

  describe('getDefaultPermission and getConfirmationDetails', () => {
    it('should return allow when trust is true', async () => {
      const trustedTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        createMockMessageBus(),
        true,
        undefined,
        undefined,
        { isTrustedFolder: () => true } as any,
        undefined,
        undefined,
      );
      const invocation = trustedTool.build({ param: 'mock' });
      expect(await invocation.getDefaultPermission()).toBe('allow');
    });

    it('should return ask if not trusted', async () => {
      const invocation = tool.build({ param: 'mock' });
      expect(await invocation.getDefaultPermission()).toBe('ask');
    });

    it('should return confirmation details when permission is ask', async () => {
      const invocation = tool.build({ param: 'mock' });
      expect(await invocation.getDefaultPermission()).toBe('ask');
      const confirmation = await invocation.getConfirmationDetails(
        new AbortController().signal,
      );
      expect(confirmation.type).toBe('mcp');
      if (confirmation.type === 'mcp') {
        expect(confirmation.serverName).toBe(serverName);
        expect(confirmation.toolName).toBe(serverToolName);
      }
    });

    it.each([
      {
        outcome: ToolConfirmationOutcome.ProceedAlwaysServer,
        description: 'add server to allowlist on ProceedAlwaysServer',
        shouldAddServer: true,
        shouldAddTool: false,
      },
      {
        outcome: ToolConfirmationOutcome.ProceedAlwaysTool,
        description: 'add tool to allowlist on ProceedAlwaysTool',
        shouldAddServer: false,
        shouldAddTool: true,
      },
      {
        outcome: ToolConfirmationOutcome.Cancel,
        description: 'handle Cancel confirmation outcome',
        shouldAddServer: false,
        shouldAddTool: false,
      },
      {
        outcome: ToolConfirmationOutcome.ProceedOnce,
        description: 'handle ProceedOnce confirmation outcome',
        shouldAddServer: false,
        shouldAddTool: false,
      },
    ])(
      'should $description',
      async ({ outcome, shouldAddServer, shouldAddTool }) => {
        const toolAllowlistKey = `${serverName}.${serverToolName}`;
        const invocation = tool.build({ param: 'mock' }) as any;
        const confirmation = await invocation.shouldConfirmExecute(
          new AbortController().signal,
        );

        expect(confirmation).not.toBe(false);
        if (
          confirmation &&
          typeof confirmation === 'object' &&
          'onConfirm' in confirmation &&
          typeof confirmation.onConfirm === 'function'
        ) {
          await confirmation.onConfirm(outcome);
          expect(invocation.constructor.allowlist.has(serverName)).toBe(
            shouldAddServer,
          );
          expect(invocation.constructor.allowlist.has(toolAllowlistKey)).toBe(
            shouldAddTool,
          );
        } else {
          throw new Error(
            'Confirmation details or onConfirm not in expected format',
          );
        }
      },
    );
  });

  describe('shouldConfirmExecute with folder trust', () => {
    const mockConfig = (isTrusted: boolean | undefined) => ({
      isTrustedFolder: () => isTrusted,
    });

    it.each([
      {
        trust: true,
        isTrusted: true,
        shouldConfirm: false,
        description: 'return false if trust is true and folder is trusted',
      },
      {
        trust: true,
        isTrusted: false,
        shouldConfirm: true,
        description:
          'return confirmation details if trust is true but folder is not trusted',
      },
      {
        trust: false,
        isTrusted: true,
        shouldConfirm: true,
        description:
          'return confirmation details if trust is false, even if folder is trusted',
      },
    ])('should $description', async ({ trust, isTrusted, shouldConfirm }) => {
      const bus = createMockMessageBus();
      getMockMessageBusInstance(bus).defaultToolDecision = 'ask_user';
      const testTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        bus,
        trust,
        undefined,
        undefined,
        mockConfig(isTrusted) as any,
        undefined,
        undefined,
      );
      const invocation = testTool.build({ param: 'mock' });
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );

      if (shouldConfirm) {
        expect(confirmation).not.toBe(false);
        expect(confirmation).toHaveProperty('type', 'mcp');
      } else {
        expect(confirmation).toBe(false);
      }
    });
  });

  describe('getDefaultPermission with folder trust', () => {
    const mockConfig = (isTrusted: boolean | undefined) => ({
      isTrustedFolder: () => isTrusted,
    });

    it('should return allow when trust is true and folder is trusted', async () => {
      const trustedTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        true, // trust = true
        undefined,
        mockConfig(true) as any, // isTrustedFolder = true
      );
      const invocation = trustedTool.build({ param: 'mock' });
      expect(await invocation.getDefaultPermission()).toBe('allow');
    });

    it('should return ask if trust is true but folder is not trusted', async () => {
      const trustedTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        true, // trust = true
        undefined,
        mockConfig(false) as any, // isTrustedFolder = false
      );
      const invocation = trustedTool.build({ param: 'mock' });
      expect(await invocation.getDefaultPermission()).toBe('ask');
    });

    it('should return ask if trust is false, even if folder is trusted', async () => {
      const untrustedTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        false, // trust = false
        undefined,
        mockConfig(true) as any, // isTrustedFolder = true
      );
      const invocation = untrustedTool.build({ param: 'mock' });
      expect(await invocation.getDefaultPermission()).toBe('ask');
    });
  });

  describe('DiscoveredMCPToolInvocation', () => {
    it('should return the stringified params from getDescription', () => {
      const params = { param: 'testValue', param2: 'anotherOne' };
      const invocation = tool.build(params);
      const description = invocation.getDescription();
      expect(description).toBe('{"param":"testValue","param2":"anotherOne"}');
    });
  });

  describe('output truncation for large MCP results', () => {
    const THRESHOLD = 1000;
    const TRUNCATE_LINES = 50;

    const mockConfigWithTruncation = {
      getTruncateToolOutputThreshold: () => THRESHOLD,
      getTruncateToolOutputLines: () => TRUNCATE_LINES,
      getUsageStatisticsEnabled: () => false,
      storage: {
        getProjectTempDir: () => '/tmp/test-project',
      },
      isTrustedFolder: () => true,
    } as any;

    it('should truncate large text results from direct client execution', async () => {
      const largeText = 'Line of text content\n'.repeat(200); // ~4200 chars, well over THRESHOLD
      const mockMcpClient: McpDirectClient = {
        callTool: vi.fn(async () => ({
          content: [{ type: 'text', text: largeText }],
        })),
      };

      const truncTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        true, // trust
        undefined,
        mockConfigWithTruncation,
        mockMcpClient,
      );

      const invocation = truncTool.build({ param: 'test' });
      const result = await invocation.execute(new AbortController().signal);

      // The text part in llmContent should be truncated
      const textParts = (result.llmContent as Part[]).filter(
        (p: Part) => p.text,
      );
      const combinedText = textParts.map((p: Part) => p.text).join('');
      expect(combinedText.length).toBeLessThan(largeText.length);
      expect(combinedText).toContain('CONTENT TRUNCATED');
      expect(result.returnDisplay).toContain('CONTENT TRUNCATED');
    });

    it('should truncate large text results from callable tool execution', async () => {
      const largeText = 'Line of text content\n'.repeat(200);
      const mockMcpToolResponseParts: Part[] = [
        {
          functionResponse: {
            name: serverToolName,
            response: {
              content: [{ type: 'text', text: largeText }],
            },
          },
        },
      ];
      mockCallTool.mockResolvedValue(mockMcpToolResponseParts);

      const truncTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        true,
        undefined,
        mockConfigWithTruncation,
      );

      const invocation = truncTool.build({ param: 'test' });
      const result = await invocation.execute(new AbortController().signal);

      const textParts = (result.llmContent as Part[]).filter(
        (p: Part) => p.text,
      );
      const combinedText = textParts.map((p: Part) => p.text).join('');
      expect(combinedText.length).toBeLessThan(largeText.length);
      expect(combinedText).toContain('CONTENT TRUNCATED');
      expect(result.returnDisplay).toContain('CONTENT TRUNCATED');
    });

    it('should not truncate small text results', async () => {
      const smallText = 'Small response';
      const mockMcpClient: McpDirectClient = {
        callTool: vi.fn(async () => ({
          content: [{ type: 'text', text: smallText }],
        })),
      };

      const truncTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        true,
        undefined,
        mockConfigWithTruncation,
        mockMcpClient,
      );

      const invocation = truncTool.build({ param: 'test' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toEqual([{ text: smallText }]);
      expect(result.returnDisplay).not.toContain('Output too long');
    });

    it('should not truncate non-text content (images, audio)', async () => {
      const mockMcpClient: McpDirectClient = {
        callTool: vi.fn(async () => ({
          content: [
            {
              type: 'image',
              data: 'x'.repeat(5000), // large base64 data
              mimeType: 'image/png',
            },
          ],
        })),
      };

      const truncTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        true,
        undefined,
        mockConfigWithTruncation,
        mockMcpClient,
      );

      const invocation = truncTool.build({ param: 'test' });
      const result = await invocation.execute(new AbortController().signal);

      // Image data should not be truncated
      const inlineDataParts = (result.llmContent as Part[]).filter(
        (p: Part) => p.inlineData,
      );
      expect(inlineDataParts[0].inlineData!.data).toBe('x'.repeat(5000));
    });

    it('should truncate only text parts in mixed content', async () => {
      const largeText = 'Line of text content\n'.repeat(200);
      const mockMcpClient: McpDirectClient = {
        callTool: vi.fn(async () => ({
          content: [
            { type: 'text', text: largeText },
            {
              type: 'image',
              data: 'IMAGE_DATA',
              mimeType: 'image/png',
            },
          ],
        })),
      };

      const truncTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        true,
        undefined,
        mockConfigWithTruncation,
        mockMcpClient,
      );

      const invocation = truncTool.build({ param: 'test' });
      const result = await invocation.execute(new AbortController().signal);

      const parts = result.llmContent as Part[];
      // Text should be truncated
      const textPart = parts.find(
        (p: Part) => p.text && !p.text.startsWith('[Tool'),
      );
      expect(textPart!.text!.length).toBeLessThan(largeText.length);
      expect(textPart!.text).toContain('CONTENT TRUNCATED');
      // Image should be preserved
      const imagePart = parts.find((p: Part) => p.inlineData);
      expect(imagePart!.inlineData!.data).toBe('IMAGE_DATA');
    });

    it('should not truncate when config is not provided', async () => {
      const largeText = 'Line of text content\n'.repeat(200);
      const mockMcpClient: McpDirectClient = {
        callTool: vi.fn(async () => ({
          content: [{ type: 'text', text: largeText }],
        })),
      };

      // No cliConfig provided
      const truncTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        undefined,
        undefined,
        undefined, // no config
        mockMcpClient,
      );

      const invocation = truncTool.build({ param: 'test' });
      const result = await invocation.execute(new AbortController().signal);

      // Without config, should return untouched
      expect(result.llmContent).toEqual([{ text: largeText }]);
    });
  });

  describe('streaming progress for long-running MCP tools', () => {
    it('should have canUpdateOutput set to true so the scheduler creates liveOutputCallback', () => {
      // For long-running MCP tools (e.g., browseruse), the scheduler needs
      // canUpdateOutput=true to create a liveOutputCallback. Without this,
      // users see no progress during potentially minutes-long operations.
      expect(tool.canUpdateOutput).toBe(true);
    });

    it('should forward MCP progress notifications to updateOutput callback during execution', async () => {
      const params = { param: 'https://example.com' };

      // Create a mock MCP direct client that simulates progress notifications.
      // When callTool is called with an onprogress callback, it invokes
      // the callback to simulate the MCP server sending progress updates.
      const mockMcpClient: McpDirectClient = {
        callTool: vi.fn(async (_params, _schema, options) => {
          // Simulate 3 progress notifications from the MCP server
          for (let i = 1; i <= 3; i++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            options?.onprogress?.({
              progress: i,
              total: 3,
              message: `Step ${i} of 3`,
            });
          }
          return {
            content: [
              {
                type: 'text',
                text: 'Browser automation completed successfully.',
              },
            ],
          };
        }),
      };

      // Create a tool with the direct MCP client
      const streamingTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        undefined, // trust
        undefined, // nameOverride
        undefined, // cliConfig
        mockMcpClient,
      );

      const invocation = streamingTool.build(params);
      const updateOutputSpy = vi.fn();

      const result = await invocation.execute(
        new AbortController().signal,
        updateOutputSpy,
      );

      // The final result should still be correct
      expect(result.llmContent).toEqual([
        { text: 'Browser automation completed successfully.' },
      ]);

      // The updateOutput callback SHOULD have been called at least once
      // with intermediate progress, so users can see what's happening
      // during the long wait.
      expect(updateOutputSpy).toHaveBeenCalled();
      expect(updateOutputSpy).toHaveBeenCalledTimes(3);
      // Verify progress data contains structured MCP progress info
      expect(updateOutputSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp_tool_progress',
          progress: 1,
          total: 3,
          message: 'Step 1 of 3',
        }),
      );
      expect(updateOutputSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp_tool_progress',
          progress: 3,
          total: 3,
          message: 'Step 3 of 3',
        }),
      );
    });

    it('should show incremental progress for multi-step browser automation', async () => {
      const params = { param: 'fill-form' };
      const steps = [
        'Navigating to page...',
        'Filling username field...',
        'Filling password field...',
        'Clicking submit...',
      ];

      const mockMcpClient: McpDirectClient = {
        callTool: vi.fn(async (_params, _schema, options) => {
          for (let i = 0; i < steps.length; i++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            options?.onprogress?.({
              progress: i + 1,
              total: steps.length,
              message: steps[i],
            });
          }
          return {
            content: [{ type: 'text', text: steps.join('\n') }],
          };
        }),
      };

      const streamingTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        undefined,
        undefined,
        undefined,
        mockMcpClient,
      );

      const invocation = streamingTool.build(params);
      const receivedUpdates: unknown[] = [];
      const updateOutputCallback = (output: unknown) => {
        receivedUpdates.push(output);
      };

      await invocation.execute(
        new AbortController().signal,
        updateOutputCallback,
      );

      // User should have received one update per step
      expect(receivedUpdates.length).toBeGreaterThan(0);
      expect(receivedUpdates).toHaveLength(steps.length);
      // Each update should be structured McpToolProgressData
      expect(receivedUpdates[0]).toEqual({
        type: 'mcp_tool_progress',
        progress: 1,
        total: steps.length,
        message: 'Navigating to page...',
      });
      expect(receivedUpdates[3]).toEqual({
        type: 'mcp_tool_progress',
        progress: 4,
        total: steps.length,
        message: 'Clicking submit...',
      });
    });
  });
});

describe('MCP Tool Naming Regression Fixes', () => {
  describe('generateValidName', () => {
    it('should replace spaces with underscores', () => {
      expect(generateValidName('My Tool')).toBe('mcp_My_Tool');
    });

    it('should allow colons', () => {
      expect(generateValidName('namespace:tool')).toBe('mcp_namespace:tool');
    });

    it('should ensure name starts with a letter or underscore', () => {
      expect(generateValidName('valid_tool_name')).toBe('mcp_valid_tool_name');
      expect(generateValidName('alsoValid-123.name')).toBe(
        'mcp_alsoValid-123.name',
      );
      expect(generateValidName('another:valid:name')).toBe(
        'mcp_another:valid:name',
      );
    });

    it('should handle very long names by truncating in the middle', () => {
      const longName = 'a'.repeat(40) + '__' + 'b'.repeat(40);
      const result = generateValidName(longName);
      expect(result.length).toBeLessThanOrEqual(63);
      expect(result).toMatch(/^mcp_a{26}\.\.\.b{30}$/);
    });

    it('should handle very long names starting with a digit', () => {
      const longName = '1' + 'a'.repeat(80);
      const result = generateValidName(longName);
      expect(result.length).toBeLessThanOrEqual(63);
      expect(result.startsWith('mcp_1')).toBe(true);
    });
  });

  describe('DiscoveredMCPTool qualified names', () => {
    it('should generate a valid qualified name even with spaces in server name', () => {
      const tool = new DiscoveredMCPTool(
        {} as any,
        'My Server',
        'my-tool',
        'desc',
        {},
        {} as any,
      );

      const qn = tool.getFullyQualifiedName();
      expect(qn).toBe('mcp_My_Server_my-tool');
    });

    it('should handle long server and tool names in qualified name', () => {
      const serverName = 'a'.repeat(40);
      const toolName = 'b'.repeat(40);
      const tool = new DiscoveredMCPTool(
        {} as any,
        serverName,
        toolName,
        'desc',
        {},
        {} as any,
      );

      const qn = tool.getFullyQualifiedName();
      expect(qn.length).toBeLessThanOrEqual(63);
      expect(qn).toContain('...');
    });

    it('should handle server names starting with digits', () => {
      const tool = new DiscoveredMCPTool(
        {} as any,
        '123-server',
        'tool',
        'desc',
        {},
        {} as any,
      );

      const qn = tool.getFullyQualifiedName();
      expect(qn).toBe('mcp_123-server_tool');
    });
  });
});
