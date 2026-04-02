/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ColorsTheme, Theme } from './theme.js';
import { lightSemanticColors } from './semantic-tokens.js';

const apexLightColors: ColorsTheme = {
  type: 'light',
  Background: '#f8f9fa',
  Foreground: '#5c6166',
  LightBlue: '#55b4d4',
  AccentBlue: '#399ee6',
  AccentPurple: '#a37acc',
  AccentCyan: '#4cbf99',
  AccentGreen: '#86b300',
  AccentYellow: '#f2ae49',
  AccentRed: '#f07171',
  AccentYellowDim: '#8B7000',
  AccentRedDim: '#993333',
  DiffAdded: '#86b300',
  DiffRemoved: '#f07171',
  Comment: '#ABADB1',
  Gray: '#CCCFD3',
  GradientColors: ['#399ee6', '#86b300'],
};

export const ApexLight: Theme = new Theme(
  'Qwen Light',
  'light',
  {
    hljs: {
      display: 'block',
      overflowX: 'auto',
      padding: '0.5em',
      background: apexLightColors.Background,
      color: apexLightColors.Foreground,
    },
    'hljs-comment': {
      color: apexLightColors.Comment,
      fontStyle: 'italic',
    },
    'hljs-quote': {
      color: apexLightColors.AccentCyan,
      fontStyle: 'italic',
    },
    'hljs-string': {
      color: apexLightColors.AccentGreen,
    },
    'hljs-constant': {
      color: apexLightColors.AccentCyan,
    },
    'hljs-number': {
      color: apexLightColors.AccentPurple,
    },
    'hljs-keyword': {
      color: apexLightColors.AccentYellow,
    },
    'hljs-selector-tag': {
      color: apexLightColors.AccentYellow,
    },
    'hljs-attribute': {
      color: apexLightColors.AccentYellow,
    },
    'hljs-variable': {
      color: apexLightColors.Foreground,
    },
    'hljs-variable.language': {
      color: apexLightColors.LightBlue,
      fontStyle: 'italic',
    },
    'hljs-title': {
      color: apexLightColors.AccentBlue,
    },
    'hljs-section': {
      color: apexLightColors.AccentGreen,
      fontWeight: 'bold',
    },
    'hljs-type': {
      color: apexLightColors.LightBlue,
    },
    'hljs-class .hljs-title': {
      color: apexLightColors.AccentBlue,
    },
    'hljs-tag': {
      color: apexLightColors.LightBlue,
    },
    'hljs-name': {
      color: apexLightColors.AccentBlue,
    },
    'hljs-builtin-name': {
      color: apexLightColors.AccentYellow,
    },
    'hljs-meta': {
      color: apexLightColors.AccentYellow,
    },
    'hljs-symbol': {
      color: apexLightColors.AccentRed,
    },
    'hljs-bullet': {
      color: apexLightColors.AccentYellow,
    },
    'hljs-regexp': {
      color: apexLightColors.AccentCyan,
    },
    'hljs-link': {
      color: apexLightColors.LightBlue,
    },
    'hljs-deletion': {
      color: apexLightColors.AccentRed,
    },
    'hljs-addition': {
      color: apexLightColors.AccentGreen,
    },
    'hljs-emphasis': {
      fontStyle: 'italic',
    },
    'hljs-strong': {
      fontWeight: 'bold',
    },
    'hljs-literal': {
      color: apexLightColors.AccentCyan,
    },
    'hljs-built_in': {
      color: apexLightColors.AccentRed,
    },
    'hljs-doctag': {
      color: apexLightColors.AccentRed,
    },
    'hljs-template-variable': {
      color: apexLightColors.AccentCyan,
    },
    'hljs-selector-id': {
      color: apexLightColors.AccentRed,
    },
  },
  apexLightColors,
  lightSemanticColors,
);
