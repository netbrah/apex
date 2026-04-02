/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { clearCommand } from './clearCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import {
  SessionEndReason,
  SessionStartSource,
} from '@apex-code/apex-core';

// Mock the telemetry service
vi.mock('@apex-code/apex-core', async () => {
  const actual = await vi.importActual('@apex-code/apex-core');
  return {
    ...actual,
    uiTelemetryService: {
      setLastPromptTokenCount: vi.fn(),
      clear: vi.fn(),
    },
  };
});

import { uiTelemetryService, type GeminiClient } from '@google/gemini-cli-core';

describe('clearCommand', () => {
  let mockContext: CommandContext;
  let mockResetChat: ReturnType<typeof vi.fn>;
  let mockHintClear: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockResetChat = vi.fn().mockResolvedValue(undefined);
    mockHintClear = vi.fn();
    const mockGetChatRecordingService = vi.fn();
    vi.clearAllMocks();

    mockContext = createMockCommandContext({
      services: {
        agentContext: {
          config: {
            getEnableHooks: vi.fn().mockReturnValue(false),
            setSessionId: vi.fn(),
            getMessageBus: vi.fn().mockReturnValue(undefined),
            getHookSystem: vi.fn().mockReturnValue({
              fireSessionEndEvent: vi.fn().mockResolvedValue(undefined),
              fireSessionStartEvent: vi.fn().mockResolvedValue(undefined),
            }),
            injectionService: {
              clear: mockHintClear,
            },
          },
          geminiClient: {
            resetChat: mockResetChat,
            getChat: () => ({
              getChatRecordingService: mockGetChatRecordingService,
            }),
          } as unknown as GeminiClient,
        },
      },
      session: {
        startNewSession: vi.fn(),
      },
    });
  });

  it('should set debug message, reset chat, reset telemetry, clear hints, and clear UI when config is available', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    await clearCommand.action(mockContext, '');

    expect(mockContext.ui.setDebugMessage).toHaveBeenCalledWith(
      'Starting a new session, resetting chat, and clearing terminal.',
    );
    expect(mockContext.ui.setDebugMessage).toHaveBeenCalledTimes(1);

    expect(mockResetChat).toHaveBeenCalledTimes(1);
    expect(mockHintClear).toHaveBeenCalledTimes(1);
    expect(uiTelemetryService.clear).toHaveBeenCalled();
    expect(uiTelemetryService.clear).toHaveBeenCalledTimes(1);
    expect(mockContext.ui.clear).toHaveBeenCalledTimes(1);

    // Check the order of operations.
    const setDebugMessageOrder = (mockContext.ui.setDebugMessage as Mock).mock
      .invocationCallOrder[0];
    const resetChatOrder = mockResetChat.mock.invocationCallOrder[0];
    const resetTelemetryOrder = (uiTelemetryService.clear as Mock).mock
      .invocationCallOrder[0];
    const clearOrder = (mockContext.ui.clear as Mock).mock
      .invocationCallOrder[0];

  it('should fire SessionEnd event before clearing and SessionStart event after clearing', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    await clearCommand.action(mockContext, '');

    expect(mockGetHookSystem).toHaveBeenCalled();
    expect(mockFireSessionEndEvent).toHaveBeenCalledWith(
      SessionEndReason.Clear,
    );
    expect(mockFireSessionStartEvent).toHaveBeenCalledWith(
      SessionStartSource.Clear,
      'test-model',
      expect.any(String), // permissionMode
    );

    // SessionEnd should be called before SessionStart
    const sessionEndCallOrder =
      mockFireSessionEndEvent.mock.invocationCallOrder[0];
    const sessionStartCallOrder =
      mockFireSessionStartEvent.mock.invocationCallOrder[0];
    expect(sessionEndCallOrder).toBeLessThan(sessionStartCallOrder);
  });

  it('should handle hook errors gracefully and continue execution', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    mockFireSessionEndEvent.mockRejectedValue(
      new Error('SessionEnd hook failed'),
    );
    mockFireSessionStartEvent.mockRejectedValue(
      new Error('SessionStart hook failed'),
    );

    await clearCommand.action(mockContext, '');

    // Should still complete the clear operation despite hook errors
    expect(mockStartNewSession).toHaveBeenCalledTimes(1);
    expect(mockResetChat).toHaveBeenCalledTimes(1);
    expect(mockContext.ui.clear).toHaveBeenCalledTimes(1);
  });

  it('should clear UI before resetChat for immediate responsiveness', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    const callOrder: string[] = [];
    (mockContext.ui.clear as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        callOrder.push('ui.clear');
      },
    );
    mockResetChat.mockImplementation(async () => {
      callOrder.push('resetChat');
    });

    await clearCommand.action(mockContext, '');

    // ui.clear should be called before resetChat for immediate UI feedback
    const clearIndex = callOrder.indexOf('ui.clear');
    const resetIndex = callOrder.indexOf('resetChat');
    expect(clearIndex).toBeGreaterThanOrEqual(0);
    expect(resetIndex).toBeGreaterThanOrEqual(0);
    expect(clearIndex).toBeLessThan(resetIndex);
  });

  it('should not await hook events (fire-and-forget)', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    // Make hooks take a long time - they should not block
    let sessionEndResolved = false;
    let sessionStartResolved = false;
    mockFireSessionEndEvent.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            sessionEndResolved = true;
            resolve(undefined);
          }, 5000);
        }),
    );
    mockFireSessionStartEvent.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            sessionStartResolved = true;
            resolve(undefined);
          }, 5000);
        }),
    );

    await clearCommand.action(mockContext, '');

    // The action should complete immediately without waiting for hooks
    expect(mockContext.ui.clear).toHaveBeenCalledTimes(1);
    expect(mockResetChat).toHaveBeenCalledTimes(1);
    // Hooks should have been called but not necessarily resolved
    expect(mockFireSessionEndEvent).toHaveBeenCalled();
    expect(mockFireSessionStartEvent).toHaveBeenCalled();
    // Hooks should NOT have resolved yet since they have 5s timeouts
    expect(sessionEndResolved).toBe(false);
    expect(sessionStartResolved).toBe(false);
  });

  it('should not attempt to reset chat if config service is not available', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    const nullConfigContext = createMockCommandContext({
      services: {
        agentContext: null,
      },
      session: {
        startNewSession: vi.fn(),
      },
    });

    await clearCommand.action(nullConfigContext, '');

    expect(nullConfigContext.ui.setDebugMessage).toHaveBeenCalledWith(
      'Starting a new session and clearing.',
    );
    expect(mockResetChat).not.toHaveBeenCalled();
    expect(uiTelemetryService.clear).toHaveBeenCalled();
    expect(uiTelemetryService.clear).toHaveBeenCalledTimes(1);
    expect(nullConfigContext.ui.clear).toHaveBeenCalledTimes(1);
  });
});
