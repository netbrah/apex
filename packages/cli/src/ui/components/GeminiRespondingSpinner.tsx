/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text, useIsScreenReaderEnabled } from 'ink';
import Spinner from 'ink-spinner';
import type { SpinnerName } from 'cli-spinners';
import { useStreamingContext } from '../contexts/StreamingContext.js';
import { StreamingState } from '../types.js';
import {
  SCREEN_READER_LOADING,
  SCREEN_READER_RESPONDING,
} from '../textConstants.js';
import { theme } from '../semantic-colors.js';

const SHIMMER_SPINNER_SEQUENCE = ['dots', 'dots2', 'dots3'] as const;

interface GeminiRespondingSpinnerProps {
  /**
   * Optional string to display when not in Responding state.
   * If not provided and not Responding, renders null.
   */
  nonRespondingDisplay?: string;
  spinnerType?: SpinnerName;
  shimmerPhase?: number;
}

export const GeminiRespondingSpinner: React.FC<
  GeminiRespondingSpinnerProps
> = ({ nonRespondingDisplay, spinnerType = 'dots', shimmerPhase = 0 }) => {
  const streamingState = useStreamingContext();
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  if (streamingState === StreamingState.Responding) {
    return (
      <GeminiSpinner
        spinnerType={
          SHIMMER_SPINNER_SEQUENCE[
            shimmerPhase % SHIMMER_SPINNER_SEQUENCE.length
          ] ?? spinnerType
        }
        altText={SCREEN_READER_RESPONDING}
        shimmerPhase={shimmerPhase}
      />
    );
  } else if (nonRespondingDisplay) {
    return isScreenReaderEnabled ? (
      <Text>{SCREEN_READER_LOADING}</Text>
    ) : (
      <Text color={theme.text.primary}>{nonRespondingDisplay}</Text>
    );
  }
  return null;
};

interface GeminiSpinnerProps {
  spinnerType?: SpinnerName;
  altText?: string;
  shimmerPhase?: number;
}

export const GeminiSpinner: React.FC<GeminiSpinnerProps> = ({
  spinnerType = 'dots',
  altText,
  shimmerPhase = 0,
}) => {
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  return isScreenReaderEnabled ? (
    <Text>{altText}</Text>
  ) : (
    <Text
      color={shimmerPhase % 2 === 0 ? theme.text.primary : theme.text.accent}
      bold={shimmerPhase % 3 === 0}
    >
      <Spinner type={spinnerType} />
    </Text>
  );
};
