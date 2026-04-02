/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MessageType, type HistoryItemCompression } from '../types.js';
import { CommandKind, type SlashCommand } from './types.js';

export const compressCommand: SlashCommand = {
  name: 'compress',
  altNames: ['summarize', 'compact'],
  description: 'Compresses the context by replacing it with a summary',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    const { ui } = context;
    const executionMode = context.executionMode ?? 'interactive';
    const abortSignal = context.abortSignal;

    if (executionMode === 'interactive' && ui.pendingItem) {
      ui.addItem(
        {
          type: MessageType.ERROR,
          text: t('Already compressing, wait for previous request to complete'),
        },
        Date.now(),
      );
      return;
    }

    const pendingMessage: HistoryItemCompression = {
      type: MessageType.COMPRESSION,
      compression: {
        isPending: true,
        originalTokenCount: null,
        newTokenCount: null,
        compressionStatus: null,
      },
    };

    const config = context.services.config;
    const geminiClient = config?.getGeminiClient();
    if (!config || !geminiClient) {
      return {
        type: 'message',
        messageType: 'error',
        content: t('Config not loaded.'),
      };
    }

    const doCompress = async () => {
      const promptId = `compress-${Date.now()}`;
      const compressed =
        await context.services.agentContext?.geminiClient?.tryCompressChat(
          promptId,
          true,
        );
      if (compressed) {
        ui.addItem(
          {
            type: MessageType.COMPRESSION,
            compression: {
              isPending: false,
              originalTokenCount: compressed.originalTokenCount,
              newTokenCount: compressed.newTokenCount,
              compressionStatus: compressed.compressionStatus,
            },
          } as HistoryItemCompression,
          Date.now(),
        );
        return;
      }

      return {
        type: 'message',
        messageType: 'info',
        content: `Context compressed (${compressed.originalTokenCount} -> ${compressed.newTokenCount}).`,
      };
    } catch (e) {
      // If cancelled via ESC, don't show error — cancelSlashCommand already handled UI
      if (abortSignal?.aborted) {
        return;
      }
      if (executionMode === 'interactive') {
        ui.addItem(
          {
            type: MessageType.ERROR,
            text: t('Failed to compress chat history: {{error}}', {
              error: e instanceof Error ? e.message : String(e),
            }),
          },
          Date.now(),
        );
        return;
      }

      return {
        type: 'message',
        messageType: 'error',
        content: t('Failed to compress chat history: {{error}}', {
          error: e instanceof Error ? e.message : String(e),
        }),
      };
    } finally {
      if (executionMode === 'interactive') {
        ui.setPendingItem(null);
      }
    }
  },
};
