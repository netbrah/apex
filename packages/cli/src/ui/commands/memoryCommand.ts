/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  addMemory,
  listMemoryFiles,
  refreshMemory,
  showMemory,
} from '@google/gemini-cli-core';
import { MessageType } from '../types.js';
import {
  CommandKind,
  type SlashCommand,
  type SlashCommandActionReturn,
} from './types.js';

export const memoryCommand: SlashCommand = {
  name: 'memory',
  description: 'Commands for interacting with memory',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [
    {
      name: 'show',
      description: 'Show the current memory contents',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: async (context) => {
        const config = context.services.agentContext?.config;
        if (!config) return;
        const result = showMemory(config);

        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: result.content,
          },
          Date.now(),
        );
      },
      subCommands: [
        {
          name: '--project',
          get description() {
            return t('Show project-level memory contents.');
          },
          kind: CommandKind.BUILT_IN,
          action: async (context) => {
            const workingDir =
              context.services.config?.getWorkingDir?.() ?? process.cwd();
            const results = await findAllExistingMemoryFiles(workingDir);

            if (results.length > 0) {
              const combined = results
                .map((r) =>
                  t(
                    'Project memory content from {{path}}:\n\n---\n{{content}}\n---',
                    { path: r.filePath, content: r.content },
                  ),
                )
                .join('\n\n');
              context.ui.addItem(
                {
                  type: MessageType.INFO,
                  text: combined,
                },
                Date.now(),
              );
            } else {
              context.ui.addItem(
                {
                  type: MessageType.INFO,
                  text: t(
                    'Project memory file not found or is currently empty.',
                  ),
                },
                Date.now(),
              );
            }
          },
        },
        {
          name: '--global',
          get description() {
            return t('Show global memory contents.');
          },
          kind: CommandKind.BUILT_IN,
          action: async (context) => {
            const globalDir = path.join(os.homedir(), APEX_DIR);
            const results = await findAllExistingMemoryFiles(globalDir);

            if (results.length > 0) {
              const combined = results
                .map((r) =>
                  t('Global memory content:\n\n---\n{{content}}\n---', {
                    content: r.content,
                  }),
                )
                .join('\n\n');
              context.ui.addItem(
                {
                  type: MessageType.INFO,
                  text: combined,
                },
                Date.now(),
              );
            } else {
              context.ui.addItem(
                {
                  type: MessageType.INFO,
                  text: t(
                    'Global memory file not found or is currently empty.',
                  ),
                },
                Date.now(),
              );
            }
          },
        },
      ],
    },
    {
      name: 'add',
      description: 'Add content to the memory',
      kind: CommandKind.BUILT_IN,
      autoExecute: false,
      action: (context, args): SlashCommandActionReturn | void => {
        const result = addMemory(args);

        if (result.type === 'message') {
          return result;
        }

        const trimmedArgs = args.trim();
        let scope: 'global' | 'project' | undefined;
        let fact: string;

        // Check for scope flags
        if (trimmedArgs.startsWith('--global ')) {
          scope = 'global';
          fact = trimmedArgs.substring('--global '.length).trim();
        } else if (trimmedArgs.startsWith('--project ')) {
          scope = 'project';
          fact = trimmedArgs.substring('--project '.length).trim();
        } else if (trimmedArgs === '--global' || trimmedArgs === '--project') {
          // Flag provided but no text after it
          return {
            type: 'message',
            messageType: 'error',
            content: t(
              'Usage: /memory add [--global|--project] <text to remember>',
            ),
          };
        } else {
          // No scope specified, will be handled by the tool
          fact = trimmedArgs;
        }

        if (!fact || fact.trim() === '') {
          return {
            type: 'message',
            messageType: 'error',
            content: t(
              'Usage: /memory add [--global|--project] <text to remember>',
            ),
          };
        }

        const scopeText = scope ? `(${scope})` : '';
        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: t('Attempting to save to memory {{scope}}: "{{fact}}"', {
              scope: scopeText,
              fact,
            }),
          },
          Date.now(),
        );

        return result;
      },
      subCommands: [
        {
          name: '--project',
          get description() {
            return t('Add content to project-level memory.');
          },
          kind: CommandKind.BUILT_IN,
          action: (context, args): SlashCommandActionReturn | void => {
            if (!args || args.trim() === '') {
              return {
                type: 'message',
                messageType: 'error',
                content: t('Usage: /memory add --project <text to remember>'),
              };
            }

            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: t('Attempting to save to project memory: "{{text}}"', {
                  text: args.trim(),
                }),
              },
              Date.now(),
            );

            return {
              type: 'tool',
              toolName: 'save_memory',
              toolArgs: { fact: args.trim(), scope: 'project' },
            };
          },
        },
        {
          name: '--global',
          get description() {
            return t('Add content to global memory.');
          },
          kind: CommandKind.BUILT_IN,
          action: (context, args): SlashCommandActionReturn | void => {
            if (!args || args.trim() === '') {
              return {
                type: 'message',
                messageType: 'error',
                content: t('Usage: /memory add --global <text to remember>'),
              };
            }

            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: t('Attempting to save to global memory: "{{text}}"', {
                  text: args.trim(),
                }),
              },
              Date.now(),
            );

            return {
              type: 'tool',
              toolName: 'save_memory',
              toolArgs: { fact: args.trim(), scope: 'global' },
            };
          },
        },
      ],
    },
    {
      name: 'reload',
      altNames: ['refresh'],
      description: 'Reload the memory from the source',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: async (context) => {
        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: 'Reloading memory from source files...',
          },
          Date.now(),
        );

        try {
          const config = context.services.agentContext?.config;
          if (config) {
            const result = await refreshMemory(config);

            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: result.content,
              },
              Date.now(),
            );
          }
        } catch (error) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              text: `Error reloading memory: ${(error as Error).message}`,
            },
            Date.now(),
          );
        }
      },
    },
    {
      name: 'list',
      description: 'Lists the paths of the GEMINI.md files in use',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: async (context) => {
        const config = context.services.agentContext?.config;
        if (!config) return;
        const result = listMemoryFiles(config);

        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: result.content,
          },
          Date.now(),
        );
      },
    },
  ],
};
