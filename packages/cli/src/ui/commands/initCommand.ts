/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { getCurrentGeminiMdFilename } from '@apex-code/apex-core';
import { CommandKind } from './types.js';
import { performInit } from '@apex-code/apex-core';

export const initCommand: SlashCommand = {
  name: 'init',
  description: 'Analyzes the project and creates a tailored APEX.md file',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (
    context: CommandContext,
    _args: string,
  ): Promise<SlashCommandActionReturn> => {
    if (!context.services.agentContext?.config) {
      return {
        type: 'message',
        messageType: 'error',
        content: t('Configuration not available.'),
      };
    }
    const targetDir = context.services.agentContext.config.getTargetDir();
    const geminiMdPath = path.join(targetDir, 'APEX.md');

    const result = performInit(fs.existsSync(geminiMdPath));

    if (result.type === 'submit_prompt') {
      // Create an empty APEX.md file
      fs.writeFileSync(geminiMdPath, '', 'utf8');

      context.ui.addItem(
        {
          type: 'info',
          text: 'Empty APEX.md created. Now analyzing the project to populate it.',
        },
        Date.now(),
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return result as SlashCommandActionReturn;
  },
};
