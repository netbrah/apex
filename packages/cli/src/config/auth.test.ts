/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from '@google/gemini-cli-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateAuthMethod } from './auth.js';
import * as settings from './settings.js';

vi.mock('./settings.js', () => ({
  loadEnvironment: vi.fn(),
  loadSettings: vi.fn().mockReturnValue({
    merged: vi.fn().mockReturnValue({}),
  }),
}));

describe('validateAuthMethod', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', undefined);
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', undefined);
    vi.stubEnv('GOOGLE_CLOUD_LOCATION', undefined);
    vi.stubEnv('GOOGLE_API_KEY', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    {
      description: 'should return null for LOGIN_WITH_GOOGLE',
      authType: AuthType.LOGIN_WITH_GOOGLE,
      envs: {},
      expected: null,
    },
    {
      description: 'should return null for COMPUTE_ADC',
      authType: AuthType.COMPUTE_ADC,
      envs: {},
      expected: null,
    },
    {
      description: 'should return null for USE_GEMINI if GEMINI_API_KEY is set',
      authType: AuthType.USE_GEMINI,
      envs: { GEMINI_API_KEY: 'test-key' },
      expected: null,
    },
    {
      description:
        'should return an error message for USE_GEMINI if GEMINI_API_KEY is not set',
      authType: AuthType.USE_GEMINI,
      envs: {},
      expected:
        'When using Gemini API, you must specify the GEMINI_API_KEY environment variable.\n' +
        'Update your environment and try again (no reload needed if using .env)!',
    },
    {
      description:
        'should return null for USE_VERTEX_AI if GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are set',
      authType: AuthType.USE_VERTEX_AI,
      envs: {
        GOOGLE_CLOUD_PROJECT: 'test-project',
        GOOGLE_CLOUD_LOCATION: 'test-location',
      },
      expected: null,
    },
    {
      description:
        'should return null for USE_VERTEX_AI if GOOGLE_API_KEY is set',
      authType: AuthType.USE_VERTEX_AI,
      envs: { GOOGLE_API_KEY: 'test-api-key' },
      expected: null,
    },
    {
      description:
        'should return an error message for USE_VERTEX_AI if no required environment variables are set',
      authType: AuthType.USE_VERTEX_AI,
      envs: {},
      expected:
        'When using Vertex AI, you must specify either:\n' +
        '• GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION environment variables.\n' +
        '• GOOGLE_API_KEY environment variable (if using express mode).\n' +
        'Update your environment and try again (no reload needed if using .env)!',
    },
    {
      description: 'should return an error message for an invalid auth method',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      authType: 'invalid-method' as any,
      envs: {},
      expected: 'Invalid auth method selected.',
    },
  ])('$description', ({ authType, envs, expected }) => {
    for (const [key, value] of Object.entries(envs)) {
      vi.stubEnv(key, value as string);
    }
    expect(validateAuthMethod(authType)).toBe(expected);
  });

  it('should return null for USE_ANTHROPIC with custom envKey and baseUrl', () => {
    vi.mocked(settings.loadSettings).mockReturnValue({
      merged: {
        model: { name: 'claude-3' },
        modelProviders: {
          anthropic: [
            {
              id: 'claude-3',
              envKey: 'CUSTOM_ANTHROPIC_KEY',
              baseUrl: 'https://api.anthropic.com',
            },
          ],
        },
      },
    } as unknown as ReturnType<typeof settings.loadSettings>);
    process.env['CUSTOM_ANTHROPIC_KEY'] = 'custom-anthropic-key';

    expect(validateAuthMethod(AuthType.USE_ANTHROPIC)).toBeNull();
  });

  it('should return error for USE_ANTHROPIC when baseUrl is missing', () => {
    vi.mocked(settings.loadSettings).mockReturnValue({
      merged: {
        model: { name: 'claude-3' },
        modelProviders: {
          anthropic: [{ id: 'claude-3', envKey: 'CUSTOM_ANTHROPIC_KEY' }],
        },
      },
    } as unknown as ReturnType<typeof settings.loadSettings>);
    process.env['CUSTOM_ANTHROPIC_KEY'] = 'custom-key';

    const result = validateAuthMethod(AuthType.USE_ANTHROPIC);
    expect(result).toContain('modelProviders[].baseUrl');
  });

  it('should return null for USE_VERTEX_AI with custom envKey', () => {
    vi.mocked(settings.loadSettings).mockReturnValue({
      merged: {
        model: { name: 'vertex-model' },
        modelProviders: {
          'vertex-ai': [
            { id: 'vertex-model', envKey: 'GOOGLE_API_KEY_VERTEX' },
          ],
        },
      },
    } as unknown as ReturnType<typeof settings.loadSettings>);
    process.env['GOOGLE_API_KEY_VERTEX'] = 'vertex-key';

    expect(validateAuthMethod(AuthType.USE_VERTEX_AI)).toBeNull();
  });

  it('should use config.getModelsConfig().getModel() when Config is provided', () => {
    // Settings has a different model
    vi.mocked(settings.loadSettings).mockReturnValue({
      merged: {
        model: { name: 'settings-model' },
        modelProviders: {
          openai: [
            { id: 'settings-model', envKey: 'SETTINGS_API_KEY' },
            { id: 'cli-model', envKey: 'CLI_API_KEY' },
          ],
        },
      },
    } as unknown as ReturnType<typeof settings.loadSettings>);

    // Mock Config object that returns a different model (e.g., from CLI args)
    const mockConfig = {
      getModelsConfig: vi.fn().mockReturnValue({
        getModel: vi.fn().mockReturnValue('cli-model'),
      }),
    } as unknown as import('@apex-code/apex-core').Config;

    // Set the env key for the CLI model, not the settings model
    process.env['CLI_API_KEY'] = 'cli-key';

    // Should use 'cli-model' from config.getModelsConfig().getModel(), not 'settings-model'
    const result = validateAuthMethod(AuthType.USE_OPENAI, mockConfig);
    expect(result).toBeNull();
    expect(mockConfig.getModelsConfig).toHaveBeenCalled();
  });

  it('should fail validation when Config provides different model without matching env key', () => {
    // Clean up any existing env keys first
    delete process.env['CLI_API_KEY'];
    delete process.env['SETTINGS_API_KEY'];
    delete process.env['OPENAI_API_KEY'];

    vi.mocked(settings.loadSettings).mockReturnValue({
      merged: {
        model: { name: 'settings-model' },
        modelProviders: {
          openai: [
            { id: 'settings-model', envKey: 'SETTINGS_API_KEY' },
            { id: 'cli-model', envKey: 'CLI_API_KEY' },
          ],
        },
      },
    } as unknown as ReturnType<typeof settings.loadSettings>);

    const mockConfig = {
      getModelsConfig: vi.fn().mockReturnValue({
        getModel: vi.fn().mockReturnValue('cli-model'),
      }),
    } as unknown as import('@apex-code/apex-core').Config;

    // Don't set CLI_API_KEY - validation should fail
    const result = validateAuthMethod(AuthType.USE_OPENAI, mockConfig);
    expect(result).not.toBeNull();
    expect(result).toContain('CLI_API_KEY');
  });
});
