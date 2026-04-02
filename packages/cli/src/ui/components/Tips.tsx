/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { type Config } from '@apex-code/apex-core';

type Tip = string | { text: string; weight: number };

const startupTips: Tip[] = [
  'Use /compress when the conversation gets long to summarize history and free up context.',
  'Start a fresh idea with /clear or /new; the previous session stays available in history.',
  'Use /bug to submit issues to the maintainers when something goes off.',
  'Switch auth type quickly with /auth.',
  `You can run any shell commands from ${'Apex'} using ! (e.g. !ls).`,
  'Type / to open the command popup; Tab autocompletes slash commands and saved prompts.',
  `You can resume a previous conversation by running ${'apex'} --continue or ${'apex'} --resume.`,
  process.platform === 'win32'
    ? 'You can switch permission mode quickly with Tab or /approval-mode.'
    : 'You can switch permission mode quickly with Shift+Tab or /approval-mode.',
  {
    text: 'Try /insight to generate personalized insights from your chat history.',
    weight: 3,
  },
];

function tipText(tip: Tip): string {
  return typeof tip === 'string' ? tip : tip.text;
}

export const Tips: React.FC<TipsProps> = ({ config }) => {
  const geminiMdFileCount = config.getGeminiMdFileCount();

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.text.primary}>Tips for getting started:</Text>
      {geminiMdFileCount === 0 && (
        <Text color={theme.text.primary}>
          1. Create <Text bold>APEX.md</Text> files to customize your
          interactions
        </Text>
      )}
      <Text color={theme.text.primary}>
        {geminiMdFileCount === 0 ? '2.' : '1.'}{' '}
        <Text color={theme.text.secondary}>/help</Text> for more information
      </Text>
      <Text color={theme.text.primary}>
        {geminiMdFileCount === 0 ? '3.' : '2.'} Ask coding questions, edit code
        or run commands
      </Text>
      <Text color={theme.text.primary}>
        {geminiMdFileCount === 0 ? '4.' : '3.'} Be specific for the best results
      </Text>
    </Box>
  );
};
