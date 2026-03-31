/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ColorsTheme, Theme } from './theme.js';
import type { SemanticColors } from './semantic-tokens.js';

const apexDarkColors: ColorsTheme = {
  type: 'dark',
  Background: '#1E1E2E',
  Foreground: '',
  LightBlue: '#ADD8E6',
  AccentBlue: '#89B4FA',
  AccentPurple: '#CBA6F7',
  AccentCyan: '#89DCEB',
  AccentGreen: '#A6E3A1',
  AccentYellow: '#F9E2AF',
  AccentRed: '#F38BA8',
  AccentYellowDim: '#8B7530',
  AccentRedDim: '#8B3A4A',
  DiffAdded: '#28350B',
  DiffRemoved: '#430000',
  Comment: '#6C7086',
  Gray: '#6C7086',
  GradientColors: ['#4796E4', '#847ACE', '#C3677F'],
};

const apexDarkSemanticColors: SemanticColors = {
  text: {
    primary: '',
    secondary: '#6C7086',
    link: '#89B4FA',
    accent: '#CBA6F7',
    code: '#ADD8E6',
  },
  background: {
    primary: '#1E1E2E',
    diff: {
      added: '#28350B',
      removed: '#430000',
    },
  },
  border: {
    default: '#6C7086',
    focused: '#89B4FA',
  },
  ui: {
    comment: '#6C7086',
    symbol: '#6C7086',
    gradient: ['#4796E4', '#847ACE', '#C3677F'],
  },
  status: {
    error: '#F38BA8',
    success: '#A6E3A1',
    warning: '#F9E2AF',
    errorDim: '#8B3A4A',
    warningDim: '#8B7530',
  },
  surface: {
    canvas: '#1E1E2E',
    panel: '#252535',
    panelMuted: '#1f1f2e',
    overlay: '#2a2a3c',
  },
  interactive: {
    hover: '#2a2a3c',
    active: '#333348',
    selected: '#89B4FA',
  },
  badge: {
    info: '#89B4FA',
    tool: '#89DCEB',
    agent: '#CBA6F7',
  },
  prompt: {
    prefix: '#CBA6F7',
    placeholder: '#6C7086',
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
