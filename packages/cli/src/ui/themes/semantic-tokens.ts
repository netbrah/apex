/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { lightTheme, darkTheme } from './theme.js';

export interface SemanticColors {
  text: {
    primary: string;
    secondary: string;
    link: string;
    accent: string;
    response: string;
  };
  background: {
    primary: string;
    message: string;
    input: string;
    focus: string;
    diff: {
      added: string;
      removed: string;
    };
  };
  border: {
    default: string;
  };
  ui: {
    comment: string;
    symbol: string;
    active: string;
    dark: string;
    focus: string;
    gradient: string[] | undefined;
  };
  status: {
    error: string;
    success: string;
    warning: string;
    // Dim variants for less intense UI elements
    errorDim: string;
    warningDim: string;
  };

  // --- V2 optional token groups (FQ-26) ---

  /** Surface elevation tokens for layered backgrounds */
  surface?: {
    canvas: string;
    panel: string;
    panelMuted: string;
    overlay: string;
  };

  /** Interactive state tokens */
  interactive?: {
    hover: string;
    active: string;
    selected: string;
  };

  /** Badge / pill tokens */
  badge?: {
    info: string;
    tool: string;
    agent: string;
  };

  /** Prompt prefix / placeholder tokens */
  prompt?: {
    prefix: string;
    placeholder: string;
  };
}

export const lightSemanticColors: SemanticColors = {
  text: {
    primary: lightTheme.Foreground,
    secondary: lightTheme.Gray,
    link: lightTheme.AccentBlue,
    accent: lightTheme.AccentPurple,
    response: lightTheme.Foreground,
  },
  background: {
    primary: lightTheme.Background,
    message: lightTheme.MessageBackground!,
    input: lightTheme.InputBackground!,
    focus: lightTheme.FocusBackground!,
    diff: {
      added: lightTheme.DiffAdded,
      removed: lightTheme.DiffRemoved,
    },
  },
  border: {
    default: lightTheme.DarkGray,
  },
  ui: {
    comment: lightTheme.Comment,
    symbol: lightTheme.Gray,
    active: lightTheme.AccentBlue,
    dark: lightTheme.DarkGray,
    focus: lightTheme.AccentGreen,
    gradient: lightTheme.GradientColors,
  },
  status: {
    error: lightTheme.AccentRed,
    success: lightTheme.AccentGreen,
    warning: lightTheme.AccentYellow,
    errorDim: lightTheme.AccentRedDim,
    warningDim: lightTheme.AccentYellowDim,
  },
  // V2 tokens — reasonable light-theme defaults
  surface: {
    canvas: lightTheme.Background,
    panel: '#f0f1f3',
    panelMuted: '#f5f5f7',
    overlay: '#e8e9ec',
  },
  interactive: {
    hover: '#e8e9ec',
    active: '#dcdde0',
    selected: lightTheme.AccentBlue,
  },
  badge: {
    info: lightTheme.AccentBlue,
    tool: lightTheme.AccentCyan,
    agent: lightTheme.AccentPurple,
  },
  prompt: {
    prefix: lightTheme.AccentPurple,
    placeholder: lightTheme.Gray,
  },
};

export const darkSemanticColors: SemanticColors = {
  text: {
    primary: darkTheme.Foreground,
    secondary: darkTheme.Gray,
    link: darkTheme.AccentBlue,
    accent: darkTheme.AccentPurple,
    response: darkTheme.Foreground,
  },
  background: {
    primary: darkTheme.Background,
    message: darkTheme.MessageBackground!,
    input: darkTheme.InputBackground!,
    focus: darkTheme.FocusBackground!,
    diff: {
      added: darkTheme.DiffAdded,
      removed: darkTheme.DiffRemoved,
    },
  },
  border: {
    default: darkTheme.DarkGray,
  },
  ui: {
    comment: darkTheme.Comment,
    symbol: darkTheme.Gray,
    active: darkTheme.AccentBlue,
    dark: darkTheme.DarkGray,
    focus: darkTheme.AccentGreen,
    gradient: darkTheme.GradientColors,
  },
  status: {
    error: darkTheme.AccentRed,
    success: darkTheme.AccentGreen,
    warning: darkTheme.AccentYellow,
    errorDim: darkTheme.AccentRedDim,
    warningDim: darkTheme.AccentYellowDim,
  },
  // V2 tokens — reasonable dark-theme defaults
  surface: {
    canvas: darkTheme.Background,
    panel: '#252535',
    panelMuted: '#1f1f2e',
    overlay: '#2a2a3c',
  },
  interactive: {
    hover: '#2a2a3c',
    active: '#333348',
    selected: darkTheme.AccentBlue,
  },
  badge: {
    info: darkTheme.AccentBlue,
    tool: darkTheme.AccentCyan,
    agent: darkTheme.AccentPurple,
  },
  prompt: {
    prefix: darkTheme.AccentPurple,
    placeholder: darkTheme.Gray,
  },
};
