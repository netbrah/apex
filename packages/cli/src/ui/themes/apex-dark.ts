/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ColorsTheme, Theme } from './theme.js';
import { darkSemanticColors } from './semantic-tokens.js';

const apexDarkColors: ColorsTheme = {
  type: 'dark',
  Background: '#0b0e14',
  Foreground: '#bfbdb6',
  LightBlue: '#59C2FF',
  AccentBlue: '#39BAE6',
  AccentPurple: '#D2A6FF',
  AccentCyan: '#95E6CB',
  AccentGreen: '#AAD94C',
  AccentYellow: '#FFD700',
  AccentRed: '#F26D78',
  AccentYellowDim: '#8B7530',
  AccentRedDim: '#8B3A4A',
  DiffAdded: '#AAD94C',
  DiffRemoved: '#F26D78',
  Comment: '#646A71',
  Gray: '#3D4149',
  GradientColors: ['#FFD700', '#da7959'],
};

export const ApexDark: Theme = new Theme(
  'Qwen Dark',
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
      color: apexDarkColors.AccentYellow,
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
    'hljs-doctag': {
      fontWeight: 'bold',
    },
    'hljs-strong': {
      fontWeight: 'bold',
    },
    'hljs-emphasis': {
      fontStyle: 'italic',
    },
  },
  apexDarkColors,
  darkSemanticColors,
);
