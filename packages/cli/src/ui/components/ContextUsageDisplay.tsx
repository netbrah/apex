/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text } from 'ink';
import { theme } from '../semantic-colors.js';

export const ContextUsageDisplay = ({
  promptTokenCount,
  outputTokenCount = 0,
  toolTokenCount = 0,
  cachedTokenCount = 0,
  terminalWidth,
  contextWindowSize,
  compactionThreshold,
}: {
  promptTokenCount: number;
  outputTokenCount?: number;
  toolTokenCount?: number;
  cachedTokenCount?: number;
  terminalWidth: number;
  contextWindowSize: number;
  compactionThreshold?: number;
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

  const hasBreakdown = outputTokenCount > 0 || toolTokenCount > 0;

  let compactIndicator = '';
  if (compactionThreshold && compactionThreshold > 0) {
    const thresholdTokens = Math.floor(compactionThreshold * contextWindowSize);
    const tokensLeft = thresholdTokens - promptTokenCount;
    const compactLabel = `compact@${formatTokens(thresholdTokens)}`;
    if (tokensLeft <= 0) {
      compactIndicator = compactLabel;
    } else {
      compactIndicator = `${compactLabel} (${formatTokens(tokensLeft)} left)`;
    }
  }

  if (terminalWidth >= 100 && (hasBreakdown || compactIndicator)) {
    const parts: string[] = [];
    // cachedTokenCount is a subset of promptTokenCount (cached input tokens),
    // not an additional bucket. Subtract it from input to avoid double-counting.
    const pureInput = promptTokenCount - outputTokenCount - toolTokenCount;
    if (pureInput > 0) {
      const label =
        cachedTokenCount > 0
          ? `in:${formatTokens(pureInput)}(${formatTokens(cachedTokenCount)}⚡)`
          : `in:${formatTokens(pureInput)}`;
      parts.push(label);
    }
    if (outputTokenCount > 0)
      parts.push(`out:${formatTokens(outputTokenCount)}`);
    if (toolTokenCount > 0) parts.push(`tool:${formatTokens(toolTokenCount)}`);
    const breakdown = parts.length > 0 ? ` | ${parts.join(' ')}` : '';
    const compact = compactIndicator ? ` | ${compactIndicator}` : '';

    return (
      <Text color={color}>
        {used}/{total} tokens ({percentageUsed}% used)
        {breakdown}
        {compact}
      </Text>
    );
  }

  if (terminalWidth < 80) {
    return (
      <Text color={color}>
        {used}/{total} ({percentageUsed}%)
      </Text>
    );
  }

  const compactSuffix = compactIndicator ? ` | ${compactIndicator}` : '';

  return (
    <Text color={color}>
      {used}/{total} tokens ({percentageUsed}% context used)
      {compactSuffix}
    </Text>
  );
};
