/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Patch: Unset NO_COLOR at the very top before any imports
if (process.env['NO_COLOR'] !== undefined) {
  delete process.env['NO_COLOR'];
}

import { describe, it, expect, beforeEach } from 'vitest';
import { ApexDark } from './apex-dark.js';
import { ApexLight } from './apex-light.js';
import { themeManager, DEFAULT_THEME } from './theme-manager.js';
import { createCustomTheme } from './theme.js';
import type { CustomTheme } from './theme.js';
import { lightenOrDarken, blendWithAlpha } from './color-utils.js';

describe('Apex Dark Theme', () => {
  it('should instantiate without error', () => {
    expect(ApexDark).toBeDefined();
    expect(ApexDark.name).toBe('Apex Dark');
    expect(ApexDark.type).toBe('dark');
  });

  it('should have all base SemanticColors fields as non-empty strings', () => {
    const sc = ApexDark.semanticColors;

    // text group
    expect(sc.text.primary).toBeTruthy();
    expect(sc.text.secondary).toBeTruthy();
    expect(sc.text.link).toBeTruthy();
    expect(sc.text.accent).toBeTruthy();
    expect(sc.text.code).toBeTruthy();

    // background group
    expect(sc.background.primary).toBeTruthy();
    expect(sc.background.diff.added).toBeTruthy();
    expect(sc.background.diff.removed).toBeTruthy();

    // border group
    expect(sc.border.default).toBeTruthy();
    expect(sc.border.focused).toBeTruthy();

    // ui group
    expect(sc.ui.comment).toBeTruthy();
    expect(sc.ui.symbol).toBeTruthy();
    expect(sc.ui.gradient).toBeDefined();
    expect(sc.ui.gradient!.length).toBeGreaterThan(0);

    // status group
    expect(sc.status.error).toBeTruthy();
    expect(sc.status.success).toBeTruthy();
    expect(sc.status.warning).toBeTruthy();
    expect(sc.status.errorDim).toBeTruthy();
    expect(sc.status.warningDim).toBeTruthy();
  });

  it('should have V2 surface/interactive/badge/prompt token groups populated', () => {
    const sc = ApexDark.semanticColors;

    // surface group
    expect(sc.surface).toBeDefined();
    expect(sc.surface!.canvas).toBeTruthy();
    expect(sc.surface!.panel).toBeTruthy();
    expect(sc.surface!.panelMuted).toBeTruthy();
    expect(sc.surface!.overlay).toBeTruthy();

    // interactive group
    expect(sc.interactive).toBeDefined();
    expect(sc.interactive!.hover).toBeTruthy();
    expect(sc.interactive!.active).toBeTruthy();
    expect(sc.interactive!.selected).toBeTruthy();

    // badge group
    expect(sc.badge).toBeDefined();
    expect(sc.badge!.info).toBeTruthy();
    expect(sc.badge!.tool).toBeTruthy();
    expect(sc.badge!.agent).toBeTruthy();

    // prompt group
    expect(sc.prompt).toBeDefined();
    expect(sc.prompt!.prefix).toBeTruthy();
    expect(sc.prompt!.placeholder).toBeTruthy();
  });
});

describe('lightenOrDarken', () => {
  it('should lighten a dark color', () => {
    const result = lightenOrDarken('#000000', 0.5);
    // #000000 lightened by 0.5 -> blend towards white = #808080
    expect(result).toBe('#808080');
  });

  it('should darken a light color', () => {
    const result = lightenOrDarken('#ffffff', -0.5);
    // #ffffff darkened by -0.5 -> factor = 0.5, each channel * 0.5 = 128
    expect(result).toBe('#808080');
  });

  it('should handle pure black', () => {
    const result = lightenOrDarken('#000000', 0.0);
    expect(result).toBe('#000000');
  });

  it('should handle pure white', () => {
    const result = lightenOrDarken('#ffffff', 0.0);
    expect(result).toBe('#ffffff');
  });

  it('should return empty string for empty input', () => {
    const result = lightenOrDarken('', 0.5);
    expect(result).toBe('');
  });

  it('should lighten a midtone color', () => {
    const result = lightenOrDarken('#1e1e2e', 0.1);
    // Should produce a lighter hex color
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    // Verify it's actually lighter (each channel increased)
    const origR = parseInt('1e', 16);
    const resultR = parseInt(result.slice(1, 3), 16);
    expect(resultR).toBeGreaterThan(origR);
  });
});

describe('blendWithAlpha', () => {
  it('should produce valid hex output', () => {
    const result = blendWithAlpha('#ff0000', 0.5);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('should return foreground at alpha=1', () => {
    const result = blendWithAlpha('#ff0000', 1.0);
    expect(result).toBe('#ff0000');
  });

  it('should return background at alpha=0', () => {
    const result = blendWithAlpha('#ff0000', 0.0, '#00ff00');
    expect(result).toBe('#00ff00');
  });

  it('should blend 50/50 correctly', () => {
    const result = blendWithAlpha('#ff0000', 0.5, '#000000');
    // 255*0.5 = 128
    expect(result).toBe('#800000');
  });

  it('should return background for empty hex input', () => {
    const result = blendWithAlpha('', 0.5, '#112233');
    expect(result).toBe('#112233');
  });
});

describe('Existing themes get derived V2 tokens', () => {
  it('ApexDark should have auto-derived surface group', () => {
    const sc = ApexDark.semanticColors;
    expect(sc.surface).toBeDefined();
    expect(sc.surface!.canvas).toBeTruthy();
    expect(sc.surface!.panel).toBeTruthy();
    expect(sc.surface!.panelMuted).toBeTruthy();
    expect(sc.surface!.overlay).toBeTruthy();
  });

  it('ApexLight should have auto-derived surface group', () => {
    const sc = ApexLight.semanticColors;
    expect(sc.surface).toBeDefined();
    expect(sc.surface!.canvas).toBeTruthy();
    expect(sc.surface!.panel).toBeTruthy();
    expect(sc.surface!.panelMuted).toBeTruthy();
    expect(sc.surface!.overlay).toBeTruthy();
  });

  it('ApexDark should have auto-derived interactive group', () => {
    const sc = ApexDark.semanticColors;
    expect(sc.interactive).toBeDefined();
    expect(sc.interactive!.hover).toBeTruthy();
    expect(sc.interactive!.active).toBeTruthy();
    expect(sc.interactive!.selected).toBeTruthy();
  });

  it('ApexLight should have auto-derived badge group', () => {
    const sc = ApexLight.semanticColors;
    expect(sc.badge).toBeDefined();
    expect(sc.badge!.info).toBeTruthy();
    expect(sc.badge!.tool).toBeTruthy();
    expect(sc.badge!.agent).toBeTruthy();
  });

  it('ApexDark should have auto-derived prompt group', () => {
    const sc = ApexDark.semanticColors;
    expect(sc.prompt).toBeDefined();
    expect(sc.prompt!.prefix).toBeTruthy();
    expect(sc.prompt!.placeholder).toBeTruthy();
  });
});

describe('Theme Manager - Apex Dark', () => {
  beforeEach(() => {
    themeManager.loadCustomThemes({});
    themeManager.setActiveTheme(DEFAULT_THEME.name);
  });

  it('should include Apex Dark in available themes', () => {
    const available = themeManager.getAvailableThemes();
    expect(available.some((t) => t.name === 'Apex Dark')).toBe(true);
  });

  it('should find Apex Dark by name', () => {
    const found = themeManager.findThemeByName('Apex Dark');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Apex Dark');
    expect(found!.type).toBe('dark');
  });

  it('should set Apex Dark as active theme', () => {
    const result = themeManager.setActiveTheme('Apex Dark');
    expect(result).toBe(true);
    expect(themeManager.getActiveTheme().name).toBe('Apex Dark');
  });
});

describe('createCustomTheme with legacy-only properties (no regression)', () => {
  it('should still work with legacy properties only', () => {
    const legacyTheme: CustomTheme = {
      type: 'custom',
      name: 'Legacy Theme',
      Background: '#1a1a1a',
      Foreground: '#e0e0e0',
      LightBlue: '#ADD8E6',
      AccentBlue: '#0000FF',
      AccentPurple: '#800080',
      AccentCyan: '#00FFFF',
      AccentGreen: '#008000',
      AccentYellow: '#FFFF00',
      AccentRed: '#FF0000',
      AccentYellowDim: '#8B7530',
      AccentRedDim: '#8B3A4A',
      DiffAdded: '#00FF00',
      DiffRemoved: '#FF0000',
      Comment: '#808080',
      Gray: '#808080',
    };

    const theme = createCustomTheme(legacyTheme);
    expect(theme).toBeDefined();
    expect(theme.name).toBe('Legacy Theme');
    expect(theme.semanticColors.text.primary).toBe('#e0e0e0');
    expect(theme.semanticColors.background.primary).toBe('#1a1a1a');

    // V2 tokens should be auto-derived
    expect(theme.semanticColors.surface).toBeDefined();
    expect(theme.semanticColors.interactive).toBeDefined();
    expect(theme.semanticColors.badge).toBeDefined();
    expect(theme.semanticColors.prompt).toBeDefined();
  });
});
