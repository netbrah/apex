/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text } from 'ink';
import { theme } from '../semantic-colors.js';

export const ContextUsageDisplay = ({
  promptTokenCount,
  terminalWidth,
  contextWindowSize,
}: {
  promptTokenCount: number;
  terminalWidth: number;
  contextWindowSize: number;
}) => {
  if (promptTokenCount === 0) {
    return null;
  }

  const percentage = promptTokenCount / contextWindowSize;
  const percentageUsed = (percentage * 100).toFixed(1);

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
  };

  const color =
    percentage >= 0.8
      ? theme.status.error
      : percentage >= 0.6
        ? theme.status.warning
        : theme.text.secondary;

  const used = formatTokens(promptTokenCount);
  const total = formatTokens(contextWindowSize);

  if (terminalWidth < 80) {
    return (
      <Text color={color}>
        {used}/{total} ({percentageUsed}%)
      </Text>
    );
  }

  return (
    <Text color={color}>
      {used}/{total} tokens ({percentageUsed}% context used)
    </Text>
  );
};
