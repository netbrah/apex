/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { themeManager } from './themes/theme-manager.js';
import type { SemanticColors } from './themes/semantic-tokens.js';

export const theme: SemanticColors = {
  get text() {
    return themeManager.getSemanticColors().text;
  },
  get background() {
    return themeManager.getSemanticColors().background;
  },
  get border() {
    return themeManager.getSemanticColors().border;
  },
  get ui() {
    return themeManager.getSemanticColors().ui;
  },
  get status() {
    return themeManager.getSemanticColors().status;
  },
  // V2 token groups (FQ-26)
  get surface() {
    return themeManager.getSemanticColors().surface;
  },
  get interactive() {
    return themeManager.getSemanticColors().interactive;
  },
  get badge() {
    return themeManager.getSemanticColors().badge;
  },
  get prompt() {
    return themeManager.getSemanticColors().prompt;
  },
};
