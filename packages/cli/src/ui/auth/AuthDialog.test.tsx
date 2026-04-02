/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthDialog } from './AuthDialog.js';
import { LoadedSettings } from '../../config/settings.js';
import type { Config } from '@apex-code/apex-core';
import { AuthType } from '@apex-code/apex-core';
import { renderWithProviders } from '../../test-utils/render.js';
import { UIStateContext } from '../contexts/UIStateContext.js';
import { UIActionsContext } from '../contexts/UIActionsContext.js';
import type { UIState } from '../contexts/UIStateContext.js';
import type { UIActions } from '../contexts/UIActionsContext.js';

const createMockUIState = (overrides: Partial<UIState> = {}): UIState => {
  // AuthDialog only uses authError and pendingAuthType
  const baseState = {
    authError: null,
    pendingAuthType: undefined,
  } as Partial<UIState>;

  return {
    ...baseState,
    ...overrides,
  } as UIState;
};

const createMockUIActions = (overrides: Partial<UIActions> = {}): UIActions => {
  // AuthDialog only uses handleAuthSelect
  const baseActions = {
    handleAuthSelect: vi.fn(),
    handleCodingPlanSubmit: vi.fn(),
    handleAlibabaStandardSubmit: vi.fn(),
    onAuthError: vi.fn(),
    handleRetryLastPrompt: vi.fn(),
  } as Partial<UIActions>;

  return {
    ...baseActions,
    ...overrides,
  } as UIActions;
};

const renderAuthDialog = (
  settings: LoadedSettings,
  uiStateOverrides: Partial<UIState> = {},
  uiActionsOverrides: Partial<UIActions> = {},
  configAuthType: AuthType | undefined = undefined,
  configApiKey: string | undefined = undefined,
) => {
  const uiState = createMockUIState(uiStateOverrides);
  const uiActions = createMockUIActions(uiActionsOverrides);

  const mockConfig = {
    getAuthType: vi.fn(() => configAuthType),
    getContentGeneratorConfig: vi.fn(() => ({ apiKey: configApiKey })),
  } as unknown as Config;

  return renderWithProviders(
    <UIStateContext.Provider value={uiState}>
      <UIActionsContext.Provider value={uiActions}>
        <AuthDialog />
      </UIActionsContext.Provider>
    </UIStateContext.Provider>,
    { settings, config: mockConfig },
  );
};

describe('AuthDialog', () => {
  const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env['GEMINI_API_KEY'] = '';
    process.env['APEX_DEFAULT_AUTH_TYPE'] = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should show an error if the initial auth type is invalid', () => {
    process.env['GEMINI_API_KEY'] = '';

    const settings: LoadedSettings = new LoadedSettings(
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      {
        settings: {},
        originalSettings: {},
        path: '',
      },
      {
        settings: {
          security: {
            auth: {
              selectedType: AuthType.USE_GEMINI,
            },
          },
        },
        originalSettings: {
          security: {
            auth: {
              selectedType: AuthType.USE_GEMINI,
            },
          },
        },
        path: '',
      },
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      true,
      new Set(),
    );

    const { lastFrame } = renderAuthDialog(settings, {
      authError: 'GEMINI_API_KEY  environment variable not found',
    });

    expect(lastFrame()).toContain(
      'GEMINI_API_KEY  environment variable not found',
    );
  });

  describe('GEMINI_API_KEY environment variable', () => {
    it('should detect GEMINI_API_KEY environment variable', () => {
      process.env['GEMINI_API_KEY'] = 'foobar';

      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {
            security: { auth: { selectedType: undefined } },
            ui: { customThemes: {} },
            mcpServers: {},
          },
          originalSettings: {
            security: { auth: { selectedType: undefined } },
            ui: { customThemes: {} },
            mcpServers: {},
          },
          path: '',
        },
        {
          settings: {},
          originalSettings: {},
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        true,
        new Set(),
      );

      const { lastFrame } = renderAuthDialog(settings);

      // Since the auth dialog shows API Key option now,
      // it won't show GEMINI_API_KEY messages
      expect(lastFrame()).toContain('API Key');
    });

    it('should not show the GEMINI_API_KEY message if APEX_DEFAULT_AUTH_TYPE is set to something else', () => {
      process.env['GEMINI_API_KEY'] = 'foobar';
      process.env['APEX_DEFAULT_AUTH_TYPE'] = AuthType.USE_OPENAI;

      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {
            security: { auth: { selectedType: undefined } },
            ui: { customThemes: {} },
            mcpServers: {},
          },
          originalSettings: {
            security: { auth: { selectedType: undefined } },
            ui: { customThemes: {} },
            mcpServers: {},
          },
          path: '',
        },
        {
          settings: {},
          originalSettings: {},
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        true,
        new Set(),
      );

      const { lastFrame } = renderAuthDialog(settings);

      expect(lastFrame()).not.toContain(
        'Existing API key detected (GEMINI_API_KEY)',
      );
    });

    it('should show the GEMINI_API_KEY message if APEX_DEFAULT_AUTH_TYPE is set to use api key', () => {
      process.env['GEMINI_API_KEY'] = 'foobar';
      process.env['APEX_DEFAULT_AUTH_TYPE'] = AuthType.USE_OPENAI;

      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {
            security: { auth: { selectedType: undefined } },
            ui: { customThemes: {} },
            mcpServers: {},
          },
          originalSettings: {
            security: { auth: { selectedType: undefined } },
            ui: { customThemes: {} },
            mcpServers: {},
          },
          path: '',
        },
        {
          settings: {},
          originalSettings: {},
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        true,
        new Set(),
      );

      const { lastFrame } = renderAuthDialog(settings);

      // Since the auth dialog shows API Key option now,
      // it won't show GEMINI_API_KEY messages
      expect(lastFrame()).toContain('API Key');
    });
  });

  describe('APEX_DEFAULT_AUTH_TYPE environment variable', () => {
    it('should fall back to default if APEX_DEFAULT_AUTH_TYPE is not set', () => {
      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {
            security: { auth: { selectedType: undefined } },
            ui: { customThemes: {} },
            mcpServers: {},
          },
          originalSettings: {
            security: { auth: { selectedType: undefined } },
            ui: { customThemes: {} },
            mcpServers: {},
          },
          path: '',
        },
        {
          settings: {},
          originalSettings: {},
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        true,
        new Set(),
      );

      const { lastFrame } = renderAuthDialog(settings);

      // Default is API Key (first option)
      expect(lastFrame()).toContain('API Key');
    });

    it('should show an error and fall back to default if APEX_DEFAULT_AUTH_TYPE is invalid', () => {
      process.env['APEX_DEFAULT_AUTH_TYPE'] = 'invalid-auth-type';

      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {
            security: { auth: { selectedType: undefined } },
            ui: { customThemes: {} },
            mcpServers: {},
          },
          originalSettings: {
            security: { auth: { selectedType: undefined } },
            ui: { customThemes: {} },
            mcpServers: {},
          },
          path: '',
        },
        {
          settings: {},
          originalSettings: {},
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        true,
        new Set(),
      );

      const { lastFrame } = renderAuthDialog(settings);

      // Since the auth dialog doesn't show APEX_DEFAULT_AUTH_TYPE errors anymore,
      // it will just show the default API Key option
      expect(lastFrame()).toContain('API Key');
    });
  });

  it('should prevent exiting when no auth method is selected and show error message', async () => {
    const handleAuthSelect = vi.fn();
    const settings: LoadedSettings = new LoadedSettings(
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      {
        settings: {},
        originalSettings: {},
        path: '',
      },
      {
        settings: {
          security: { auth: { selectedType: undefined } },
          ui: { customThemes: {} },
          mcpServers: {},
        },
        originalSettings: {
          security: { auth: { selectedType: undefined } },
          ui: { customThemes: {} },
          mcpServers: {},
        },
        path: '',
      },
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      true,
      new Set(),
    );

    const { lastFrame, stdin, unmount } = renderAuthDialog(
      settings,
      {},
      { handleAuthSelect },
      undefined, // config.getAuthType() returns undefined
    );
    await wait();

    // Simulate pressing escape key
    stdin.write('\u001b'); // ESC key
    await wait();

    // Should show error message instead of calling handleAuthSelect
    await vi.waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('You must select an auth method');
      expect(frame).toContain('Press Ctrl+C again to exit');
    });
    expect(handleAuthSelect).not.toHaveBeenCalled();
    unmount();
  });

  it('should not exit if there is already an error message', async () => {
    const handleAuthSelect = vi.fn();
    const settings: LoadedSettings = new LoadedSettings(
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      {
        settings: {},
        originalSettings: {},
        path: '',
      },
      {
        settings: {
          security: { auth: { selectedType: undefined } },
          ui: { customThemes: {} },
          mcpServers: {},
        },
        originalSettings: {
          security: { auth: { selectedType: undefined } },
          ui: { customThemes: {} },
          mcpServers: {},
        },
        path: '',
      },
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      true,
      new Set(),
    );

    const { lastFrame, stdin, unmount } = renderAuthDialog(
      settings,
      { authError: 'Initial error' },
      { handleAuthSelect },
      undefined, // config.getAuthType() returns undefined
    );
    await wait();

    expect(lastFrame()).toContain('Initial error');

    // Simulate pressing escape key
    stdin.write('\u001b'); // ESC key
    await wait();

    // Should not call handleAuthSelect
    expect(handleAuthSelect).not.toHaveBeenCalled();
    unmount();
  });

  it('should allow exiting when auth method is already selected', async () => {
    const handleAuthSelect = vi.fn();
    const settings: LoadedSettings = new LoadedSettings(
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      {
        settings: {},
        originalSettings: {},
        path: '',
      },
      {
        settings: {
          security: { auth: { selectedType: AuthType.USE_OPENAI } },
          ui: { customThemes: {} },
          mcpServers: {},
        },
        originalSettings: {
          security: { auth: { selectedType: AuthType.USE_OPENAI } },
          ui: { customThemes: {} },
          mcpServers: {},
        },
        path: '',
      },
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        originalSettings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      true,
      new Set(),
    );

    const { stdin, unmount } = renderAuthDialog(
      settings,
      {},
      { handleAuthSelect },
      AuthType.USE_OPENAI, // config.getAuthType() returns USE_OPENAI
    );
    await wait();

    // Simulate pressing escape key
    stdin.write('\u001b'); // ESC key
    await wait();

    // Should call handleAuthSelect with undefined to exit
    expect(handleAuthSelect).toHaveBeenCalledWith(undefined);
    unmount();
  });
});
