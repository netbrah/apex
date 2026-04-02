/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { memoryCommand } from './memoryCommand.js';
import type { SlashCommand, CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  refreshMemory,
  refreshServerHierarchicalMemory,
  SimpleExtensionLoader,
  type FileDiscoveryService,
  showMemory,
  addMemory,
  listMemoryFiles,
  flattenMemory,
} from '@apex-code/apex-core';

vi.mock('@apex-code/apex-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@apex-code/apex-core')>();
  return {
    ...original,
    getErrorMessage: vi.fn((error: unknown) => {
      if (error instanceof Error) return error.message;
      return String(error);
    }),
    refreshMemory: vi.fn(async (config) => {
      if (config.isJitContextEnabled()) {
        await config.getContextManager()?.refresh();
        const memoryContent = original.flattenMemory(config.getUserMemory());
        const fileCount = config.getGeminiMdFileCount() || 0;
        return {
          type: 'message',
          messageType: 'info',
          content: `Memory reloaded successfully. Loaded ${memoryContent.length} characters from ${fileCount} file(s).`,
        };
      }
      return {
        type: 'message',
        messageType: 'info',
        content: 'Memory reloaded successfully.',
      };
    }),
    showMemory: vi.fn(),
    addMemory: vi.fn(),
    listMemoryFiles: vi.fn(),
    refreshServerHierarchicalMemory: vi.fn(),
  };
});

const mockRefreshMemory = refreshMemory as Mock;
const mockRefreshServerHierarchicalMemory =
  refreshServerHierarchicalMemory as Mock;

describe('memoryCommand', () => {
  let mockContext: CommandContext;

  const getSubCommand = (
    name: 'show' | 'add' | 'reload' | 'list',
  ): SlashCommand => {
    const subCommand = memoryCommand.subCommands?.find(
      (cmd) => cmd.name === name,
    );
    if (!subCommand) {
      throw new Error(`/memory ${name} command not found.`);
    }
    return subCommand;
  };

  describe('/memory show', () => {
    let showCommand: SlashCommand;
    let mockGetUserMemory: Mock;
    let mockGetGeminiMdFileCount: Mock;

    beforeEach(() => {
      setGeminiMdFilename('APEX.md');
      mockReadFile.mockReset();
      vi.restoreAllMocks();

      showCommand = getSubCommand('show');

      mockGetUserMemory = vi.fn();
      mockGetGeminiMdFileCount = vi.fn();

      vi.mocked(showMemory).mockImplementation((config) => {
        const memoryContent = flattenMemory(config.getUserMemory());
        const fileCount = config.getGeminiMdFileCount() || 0;
        let content;
        if (memoryContent.length > 0) {
          content = `Current memory content from ${fileCount} file(s):\n\n---\n${memoryContent}\n---`;
        } else {
          content = 'Memory is currently empty.';
        }
        return {
          type: 'message',
          messageType: 'info',
          content,
        };
      });

      mockContext = createMockCommandContext({
        services: {
          agentContext: {
            config: {
              getUserMemory: mockGetUserMemory,
              getGeminiMdFileCount: mockGetGeminiMdFileCount,
              getExtensionLoader: () => new SimpleExtensionLoader([]),
            },
          },
        },
      });
    });

    it('should display a message if memory is empty', async () => {
      if (!showCommand.action) throw new Error('Command has no action');

      mockGetUserMemory.mockReturnValue('');
      mockGetGeminiMdFileCount.mockReturnValue(0);

      await showCommand.action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Memory is currently empty.',
        },
        expect.any(Number),
      );
    });

    it('should display the memory content and file count if it exists', async () => {
      if (!showCommand.action) throw new Error('Command has no action');

      const memoryContent = 'This is a test memory.';

      mockGetUserMemory.mockReturnValue(memoryContent);
      mockGetGeminiMdFileCount.mockReturnValue(1);

      await showCommand.action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Current memory content from 1 file(s):\n\n---\n${memoryContent}\n---`,
        },
        expect.any(Number),
      );
    });

    it('should show project memory from the configured context file', async () => {
      const projectCommand = showCommand.subCommands?.find(
        (cmd) => cmd.name === '--project',
      );
      if (!projectCommand?.action) throw new Error('Command has no action');

      setGeminiMdFilename('AGENTS.md');
      vi.spyOn(process, 'cwd').mockReturnValue('/test/project');
      mockReadFile.mockResolvedValue('project memory');

      await projectCommand.action(mockContext, '');

      const expectedProjectPath = path.join('/test/project', 'AGENTS.md');
      expect(mockReadFile).toHaveBeenCalledWith(expectedProjectPath, 'utf-8');
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: expect.stringContaining(expectedProjectPath),
        },
        expect.any(Number),
      );
    });

    it('should show global memory from the configured context file', async () => {
      const globalCommand = showCommand.subCommands?.find(
        (cmd) => cmd.name === '--global',
      );
      if (!globalCommand?.action) throw new Error('Command has no action');

      setGeminiMdFilename('AGENTS.md');
      vi.spyOn(os, 'homedir').mockReturnValue('/home/user');
      mockReadFile.mockResolvedValue('global memory');

      await globalCommand.action(mockContext, '');

      const expectedGlobalPath = path.join('/home/user', APEX_DIR, 'AGENTS.md');
      expect(mockReadFile).toHaveBeenCalledWith(expectedGlobalPath, 'utf-8');
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: expect.stringContaining('Global memory content'),
        },
        expect.any(Number),
      );
    });

    it('should fall back to AGENTS.md when APEX.md does not exist for --project', async () => {
      const projectCommand = showCommand.subCommands?.find(
        (cmd) => cmd.name === '--project',
      );
      if (!projectCommand?.action) throw new Error('Command has no action');

      setGeminiMdFilename(['APEX.md', 'AGENTS.md']);
      vi.spyOn(process, 'cwd').mockReturnValue('/test/project');
      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('AGENTS.md')) return 'agents memory content';
        throw new Error('ENOENT');
      });

      await projectCommand.action(mockContext, '');

      const expectedPath = path.join('/test/project', 'AGENTS.md');
      expect(mockReadFile).toHaveBeenCalledWith(expectedPath, 'utf-8');
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: expect.stringContaining('agents memory content'),
        },
        expect.any(Number),
      );
    });

    it('should fall back to AGENTS.md when APEX.md does not exist for --global', async () => {
      const globalCommand = showCommand.subCommands?.find(
        (cmd) => cmd.name === '--global',
      );
      if (!globalCommand?.action) throw new Error('Command has no action');

      setGeminiMdFilename(['APEX.md', 'AGENTS.md']);
      vi.spyOn(os, 'homedir').mockReturnValue('/home/user');
      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('AGENTS.md')) return 'global agents memory';
        throw new Error('ENOENT');
      });

      await globalCommand.action(mockContext, '');

      const expectedPath = path.join('/home/user', APEX_DIR, 'AGENTS.md');
      expect(mockReadFile).toHaveBeenCalledWith(expectedPath, 'utf-8');
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: expect.stringContaining('global agents memory'),
        },
        expect.any(Number),
      );
    });

    it('should show content from both APEX.md and AGENTS.md for --project when both exist', async () => {
      const projectCommand = showCommand.subCommands?.find(
        (cmd) => cmd.name === '--project',
      );
      if (!projectCommand?.action) throw new Error('Command has no action');

      setGeminiMdFilename(['APEX.md', 'AGENTS.md']);
      vi.spyOn(process, 'cwd').mockReturnValue('/test/project');
      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('APEX.md')) return 'qwen memory';
        if (filePath.endsWith('AGENTS.md')) return 'agents memory';
        throw new Error('ENOENT');
      });

      await projectCommand.action(mockContext, '');

      expect(mockReadFile).toHaveBeenCalledWith(
        path.join('/test/project', 'APEX.md'),
        'utf-8',
      );
      expect(mockReadFile).toHaveBeenCalledWith(
        path.join('/test/project', 'AGENTS.md'),
        'utf-8',
      );
      const addItemCall = (mockContext.ui.addItem as Mock).mock.calls[0][0];
      expect(addItemCall.text).toContain('qwen memory');
      expect(addItemCall.text).toContain('agents memory');
    });

    it('should show content from both files for --global when both exist', async () => {
      const globalCommand = showCommand.subCommands?.find(
        (cmd) => cmd.name === '--global',
      );
      if (!globalCommand?.action) throw new Error('Command has no action');

      setGeminiMdFilename(['APEX.md', 'AGENTS.md']);
      vi.spyOn(os, 'homedir').mockReturnValue('/home/user');
      mockReadFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('APEX.md')) return 'global qwen memory';
        if (filePath.endsWith('AGENTS.md')) return 'global agents memory';
        throw new Error('ENOENT');
      });

      await globalCommand.action(mockContext, '');

      expect(mockReadFile).toHaveBeenCalledWith(
        path.join('/home/user', APEX_DIR, 'APEX.md'),
        'utf-8',
      );
      expect(mockReadFile).toHaveBeenCalledWith(
        path.join('/home/user', APEX_DIR, 'AGENTS.md'),
        'utf-8',
      );
      const addItemCall = (mockContext.ui.addItem as Mock).mock.calls[0][0];
      expect(addItemCall.text).toContain('global qwen memory');
      expect(addItemCall.text).toContain('global agents memory');
    });
  });

  describe('/memory add', () => {
    let addCommand: SlashCommand;

    beforeEach(() => {
      addCommand = getSubCommand('add');
      vi.mocked(addMemory).mockImplementation((args) => {
        if (!args || args.trim() === '') {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /memory add <text to remember>',
          };
        }
        return {
          type: 'tool',
          toolName: 'save_memory',
          toolArgs: { fact: args.trim() },
        };
      });
      mockContext = createMockCommandContext();
    });

    it('should return an error message if no arguments are provided', () => {
      if (!addCommand.action) throw new Error('Command has no action');

      const result = addCommand.action(mockContext, '  ');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Usage: /memory add [--global|--project] <text to remember>',
      });

      expect(mockContext.ui.addItem).not.toHaveBeenCalled();
    });

    it('should return a tool action and add an info message when arguments are provided', () => {
      if (!addCommand.action) throw new Error('Command has no action');

      const fact = 'remember this';
      const result = addCommand.action(mockContext, `  ${fact}  `);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Attempting to save to memory : "${fact}"`,
        },
        expect.any(Number),
      );

      expect(result).toEqual({
        type: 'tool',
        toolName: 'save_memory',
        toolArgs: { fact },
      });
    });

    it('should handle --global flag and add scope to tool args', () => {
      if (!addCommand.action) throw new Error('Command has no action');

      const fact = 'remember this globally';
      const result = addCommand.action(mockContext, `--global ${fact}`);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Attempting to save to memory (global): "${fact}"`,
        },
        expect.any(Number),
      );

      expect(result).toEqual({
        type: 'tool',
        toolName: 'save_memory',
        toolArgs: { fact, scope: 'global' },
      });
    });

    it('should handle --project flag and add scope to tool args', () => {
      if (!addCommand.action) throw new Error('Command has no action');

      const fact = 'remember this for project';
      const result = addCommand.action(mockContext, `--project ${fact}`);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Attempting to save to memory (project): "${fact}"`,
        },
        expect.any(Number),
      );

      expect(result).toEqual({
        type: 'tool',
        toolName: 'save_memory',
        toolArgs: { fact, scope: 'project' },
      });
    });

    it('should return error if flag is provided but no fact follows', () => {
      if (!addCommand.action) throw new Error('Command has no action');

      const result = addCommand.action(mockContext, '--global   ');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Usage: /memory add [--global|--project] <text to remember>',
      });

      expect(mockContext.ui.addItem).not.toHaveBeenCalled();
    });
  });

  describe('/memory reload', () => {
    let reloadCommand: SlashCommand;
    let mockSetUserMemory: Mock;
    let mockSetGeminiMdFileCount: Mock;
    let mockSetGeminiMdFilePaths: Mock;
    let mockContextManagerRefresh: Mock;

    beforeEach(() => {
      reloadCommand = getSubCommand('reload');
      mockSetUserMemory = vi.fn();
      mockSetGeminiMdFileCount = vi.fn();
      mockSetGeminiMdFilePaths = vi.fn();
      mockContextManagerRefresh = vi.fn().mockResolvedValue(undefined);

      const mockConfig = {
        setUserMemory: mockSetUserMemory,
        setGeminiMdFileCount: mockSetGeminiMdFileCount,
        setGeminiMdFilePaths: mockSetGeminiMdFilePaths,
        getWorkingDir: () => '/test/dir',
        getDebugMode: () => false,
        getFileService: () => ({}) as FileDiscoveryService,
        getExtensionLoader: () => new SimpleExtensionLoader([]),
        getExtensions: () => [],
        shouldLoadMemoryFromIncludeDirectories: () => false,
        getWorkspaceContext: () => ({
          getDirectories: () => [],
        }),
        getFileFilteringOptions: () => ({
          ignore: [],
          include: [],
        }),
        isTrustedFolder: () => false,
        updateSystemInstructionIfInitialized: vi
          .fn()
          .mockResolvedValue(undefined),
        isJitContextEnabled: vi.fn().mockReturnValue(false),
        getContextManager: vi.fn().mockReturnValue({
          refresh: mockContextManagerRefresh,
        }),
        getUserMemory: vi.fn().mockReturnValue(''),
        getGeminiMdFileCount: vi.fn().mockReturnValue(0),
      };

      mockContext = createMockCommandContext({
        services: {
          agentContext: { config: mockConfig },
          settings: {
            merged: {
              memoryDiscoveryMaxDirs: 1000,
              context: {
                importFormat: 'tree',
              },
            },
          } as unknown as LoadedSettings,
        },
      });
      mockRefreshMemory.mockClear();
    });

    it('should use ContextManager.refresh when JIT is enabled', async () => {
      if (!reloadCommand.action) throw new Error('Command has no action');

      // Enable JIT in mock config
      const config = mockContext.services.agentContext?.config;
      if (!config) throw new Error('Config is undefined');

      vi.mocked(config.isJitContextEnabled).mockReturnValue(true);
      vi.mocked(config.getUserMemory).mockReturnValue('JIT Memory Content');
      vi.mocked(config.getGeminiMdFileCount).mockReturnValue(3);

      await reloadCommand.action(mockContext, '');

      expect(mockContextManagerRefresh).toHaveBeenCalledOnce();
      expect(mockRefreshServerHierarchicalMemory).not.toHaveBeenCalled();

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Memory reloaded successfully. Loaded 18 characters from 3 file(s).',
        },
        expect.any(Number),
      );
    });

    it('should display success message when memory is reloaded with content (Legacy)', async () => {
      if (!reloadCommand.action) throw new Error('Command has no action');

      const successMessage = {
        type: 'message',
        messageType: MessageType.INFO,
        content:
          'Memory reloaded successfully. Loaded 18 characters from 2 file(s).',
      };
      mockRefreshMemory.mockResolvedValue(successMessage);

      await reloadCommand.action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Reloading memory from source files...',
        },
        expect.any(Number),
      );

      expect(mockRefreshMemory).toHaveBeenCalledOnce();

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Memory reloaded successfully. Loaded 18 characters from 2 file(s).',
        },
        expect.any(Number),
      );
    });

    it('should display success message when memory is reloaded with no content', async () => {
      if (!reloadCommand.action) throw new Error('Command has no action');

      const successMessage = {
        type: 'message',
        messageType: MessageType.INFO,
        content: 'Memory reloaded successfully. No memory content found.',
      };
      mockRefreshMemory.mockResolvedValue(successMessage);

      await reloadCommand.action(mockContext, '');

      expect(mockRefreshMemory).toHaveBeenCalledOnce();

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Memory reloaded successfully. No memory content found.',
        },
        expect.any(Number),
      );
    });

    it('should display an error message if reloading fails', async () => {
      if (!reloadCommand.action) throw new Error('Command has no action');

      const error = new Error('Failed to read memory files.');
      mockRefreshMemory.mockRejectedValue(error);

      await reloadCommand.action(mockContext, '');

      expect(mockRefreshMemory).toHaveBeenCalledOnce();
      expect(mockSetUserMemory).not.toHaveBeenCalled();
      expect(mockSetGeminiMdFileCount).not.toHaveBeenCalled();
      expect(mockSetGeminiMdFilePaths).not.toHaveBeenCalled();

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.ERROR,
          text: `Error reloading memory: ${error.message}`,
        },
        expect.any(Number),
      );
    });

    it('should not throw if config service is unavailable', async () => {
      if (!reloadCommand.action) throw new Error('Command has no action');

      const nullConfigContext = createMockCommandContext({
        services: { agentContext: null },
      });

      await expect(
        reloadCommand.action(nullConfigContext, ''),
      ).resolves.toBeUndefined();

      expect(nullConfigContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Reloading memory from source files...',
        },
        expect.any(Number),
      );

      expect(mockRefreshMemory).not.toHaveBeenCalled();
    });
  });

  describe('/memory list', () => {
    let listCommand: SlashCommand;
    let mockGetGeminiMdfilePaths: Mock;

    beforeEach(() => {
      listCommand = getSubCommand('list');
      mockGetGeminiMdfilePaths = vi.fn();
      vi.mocked(listMemoryFiles).mockImplementation((config) => {
        const filePaths = config.getGeminiMdFilePaths() || [];
        const fileCount = filePaths.length;
        let content;
        if (fileCount > 0) {
          content = `There are ${fileCount} APEX.md file(s) in use:\n\n${filePaths.join('\n')}`;
        } else {
          content = 'No APEX.md files in use.';
        }
        return {
          type: 'message',
          messageType: 'info',
          content,
        };
      });
      mockContext = createMockCommandContext({
        services: {
          agentContext: {
            config: {
              getGeminiMdFilePaths: mockGetGeminiMdfilePaths,
            },
          },
        },
      });
    });

    it('should display a message if no APEX.md files are found', async () => {
      if (!listCommand.action) throw new Error('Command has no action');

      mockGetGeminiMdfilePaths.mockReturnValue([]);

      await listCommand.action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'No APEX.md files in use.',
        },
        expect.any(Number),
      );
    });

    it('should display the file count and paths if they exist', async () => {
      if (!listCommand.action) throw new Error('Command has no action');

      const filePaths = ['/path/one/APEX.md', '/path/two/APEX.md'];
      mockGetGeminiMdfilePaths.mockReturnValue(filePaths);

      await listCommand.action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `There are 2 APEX.md file(s) in use:\n\n${filePaths.join('\n')}`,
        },
        expect.any(Number),
      );
    });
  });
});
