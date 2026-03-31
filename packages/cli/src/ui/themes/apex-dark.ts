/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ColorsTheme, Theme } from './theme.js';
import type { SemanticColors } from './semantic-tokens.js';

const apexDarkColors: ColorsTheme = {
  type: 'dark',
  Background: '#0a0a0f',
  Foreground: '#c8c8d4',
  LightBlue: '#38bdf8',
  AccentBlue: '#38bdf8',
  AccentPurple: '#a78bfa',
  AccentCyan: '#22d3ee',
  AccentGreen: '#4ade80',
  AccentYellow: '#f59e0b',
  AccentRed: '#ef4444',
  AccentYellowDim: '#92600a',
  AccentRedDim: '#7f1d1d',
  DiffAdded: '#1a2e1a',
  DiffRemoved: '#2e1a1a',
  Comment: '#4a4a5e',
  Gray: '#4a4a5e',
  GradientColors: ['#f97316', '#ef4444', '#a78bfa'],
};

const apexDarkSemanticColors: SemanticColors = {
  text: {
    primary: '#c8c8d4',
    secondary: '#7a7a8e',
    link: '#38bdf8',
    accent: '#a78bfa',
    code: '#38bdf8',
  },
  background: {
    primary: '#0a0a0f',
    diff: {
      added: '#1a2e1a',
      removed: '#2e1a1a',
    },
  },
  border: {
    default: '#2d2d3f',
    focused: '#f59e0b',
  },
  ui: {
    comment: '#4a4a5e',
    symbol: '#22d3ee',
    gradient: ['#f97316', '#ef4444', '#a78bfa'],
  },
  status: {
    error: '#ef4444',
    success: '#4ade80',
    warning: '#f59e0b',
    errorDim: '#7f1d1d',
    warningDim: '#92600a',
  },
  surface: {
    canvas: '#0a0a0f',
    panel: '#12121a',
    panelMuted: '#0e0e16',
    overlay: '#1a1a28',
  },
  interactive: {
    hover: '#1e1e2a',
    active: '#2a2a3c',
    selected: '#38bdf8',
  },
  badge: {
    info: '#38bdf8',
    tool: '#22d3ee',
    agent: '#a78bfa',
  },
  prompt: {
    prefix: '#f59e0b',
    placeholder: '#4a4a5e',
  },
};

export const ApexDark: Theme = new Theme(
  'Apex Dark',
  'dark',
  {
    hljs: {
      display: 'block',
      overflowX: 'auto',
      padding: '0.5em',
      background: apexDarkColors.Background,
      color: apexDarkColors.Foreground,
    },
    'hljs-keyword': {
      color: apexDarkColors.AccentYellow,
    },
    'hljs-literal': {
      color: apexDarkColors.AccentPurple,
    },
    'hljs-symbol': {
      color: apexDarkColors.AccentCyan,
    },
    'hljs-name': {
      color: apexDarkColors.LightBlue,
    },
    'hljs-link': {
      color: apexDarkColors.AccentBlue,
    },
    'hljs-function .hljs-keyword': {
      color: apexDarkColors.AccentYellow,
    },
    'hljs-subst': {
      color: apexDarkColors.Foreground,
    },
    'hljs-string': {
      color: apexDarkColors.AccentGreen,
    },
    'hljs-title': {
      color: apexDarkColors.AccentYellow,
    },
    'hljs-type': {
      color: apexDarkColors.AccentBlue,
    },
    'hljs-built_in': {
      color: apexDarkColors.AccentCyan,
    },
    'hljs-attribute': {
      color: apexDarkColors.AccentYellow,
    },
    'hljs-bullet': {
      color: apexDarkColors.AccentYellow,
    },
    'hljs-addition': {
      color: apexDarkColors.AccentGreen,
    },
    'hljs-variable': {
      color: apexDarkColors.Foreground,
    },
    'hljs-template-tag': {
      color: apexDarkColors.AccentYellow,
    },
    'hljs-template-variable': {
      color: apexDarkColors.AccentPurple,
    },
    'hljs-comment': {
      color: apexDarkColors.Comment,
      fontStyle: 'italic',
    },
    'hljs-quote': {
      color: apexDarkColors.AccentCyan,
      fontStyle: 'italic',
    },
    'hljs-deletion': {
      color: apexDarkColors.AccentRed,
    },
    'hljs-meta': {
      color: apexDarkColors.AccentYellow,
    },
    'hljs-number': {
      color: apexDarkColors.AccentPurple,
    },
    'hljs-regexp': {
      color: apexDarkColors.AccentCyan,
    },
    'hljs-class': {
      color: apexDarkColors.AccentBlue,
    },
    'hljs-params': {
      color: apexDarkColors.Foreground,
    },
    'hljs-doctag': {
      fontWeight: 'bold',
    },
    'hljs-strong': {
      fontWeight: 'bold',
    },
    'hljs-emphasis': {
      fontStyle: 'italic',
    },
    'hljs-section': {
      color: apexDarkColors.AccentYellow,
    },
    'hljs-tag': {
      color: apexDarkColors.LightBlue,
    },
    'hljs-selector-tag': {
      color: apexDarkColors.AccentYellow,
    },
    'hljs-selector-id': {
      color: apexDarkColors.AccentYellow,
    },
    'hljs-selector-class': {
      color: apexDarkColors.AccentYellow,
    },
  },
  apexDarkColors,
  apexDarkSemanticColors,
);
