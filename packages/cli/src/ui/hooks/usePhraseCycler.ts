/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import type { ThoughtSummary } from '@apex-code/apex-core';
import { t } from '../../i18n/index.js';
import {
  APEX_LOADING_PHRASES,
  LOADING_PHRASE_ROTATION_MS,
  selectHybridLoadingPhrase,
} from './loadingPhrases.js';

export const WITTY_LOADING_PHRASES: string[] = APEX_LOADING_PHRASES;

export const PHRASE_CHANGE_INTERVAL_MS = LOADING_PHRASE_ROTATION_MS;

/**
 * Custom hook to manage cycling through loading phrases.
 * @param isActive Whether the phrase cycling should be active.
 * @param isWaiting Whether to show a specific waiting phrase.
 * @returns The current loading phrase.
 */
export const usePhraseCycler = (
  isActive: boolean,
  isWaiting: boolean,
  customPhrases?: string[],
  thought?: ThoughtSummary | null,
) => {
  // Get phrases from translations if available
  const loadingPhrases = useMemo(() => {
    if (customPhrases && customPhrases.length > 0) {
      return customPhrases;
    }
    return WITTY_LOADING_PHRASES;
  }, [customPhrases]);

  const [currentLoadingPhrase, setCurrentLoadingPhrase] = useState(
    loadingPhrases[0],
  );
  const phraseIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const cycleIndexRef = useRef(0);

  useEffect(() => {
    if (isWaiting) {
      setCurrentLoadingPhrase(t('Waiting for user confirmation...'));
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
    } else if (isActive) {
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
      }

      setCurrentLoadingPhrase(
        selectHybridLoadingPhrase({
          thought: thought ?? undefined,
          translatedPhrases: loadingPhrases,
          cycleIndex: cycleIndexRef.current,
        }),
      );

      phraseIntervalRef.current = setInterval(() => {
        cycleIndexRef.current += 1;
        setCurrentLoadingPhrase(
          selectHybridLoadingPhrase({
            thought: thought ?? undefined,
            translatedPhrases: loadingPhrases,
            cycleIndex: cycleIndexRef.current,
          }),
        );
      }, PHRASE_CHANGE_INTERVAL_MS);
    } else {
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
      setCurrentLoadingPhrase(
        selectHybridLoadingPhrase({
          thought: thought ?? undefined,
          translatedPhrases: loadingPhrases,
          cycleIndex: cycleIndexRef.current,
        }),
      );
    }

    return () => {
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
    };
  }, [isActive, isWaiting, loadingPhrases, thought]);

  return currentLoadingPhrase;
};
