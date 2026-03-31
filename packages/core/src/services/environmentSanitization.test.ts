/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  sanitizeEnvironment,
  isSecretEnvVar,
  getSecureSanitizationConfig,
  SECRET_ENV_PATTERNS,
  SECRET_ENV_EXACT,
  DEFAULT_ALLOWLIST,
} from './environmentSanitization.js';

describe('environmentSanitization', () => {
  const defaultConfig = getSecureSanitizationConfig();

  describe('isSecretEnvVar', () => {
    it('should identify env vars ending with _KEY as secret', () => {
      expect(isSecretEnvVar('OPENAI_API_KEY', defaultConfig)).toBe(true);
      expect(isSecretEnvVar('MY_SERVICE_KEY', defaultConfig)).toBe(true);
      expect(isSecretEnvVar('ENCRYPTION_KEY', defaultConfig)).toBe(true);
    });

    it('should identify env vars ending with _SECRET as secret', () => {
      expect(isSecretEnvVar('JWT_SECRET', defaultConfig)).toBe(true);
      expect(isSecretEnvVar('APP_SECRET', defaultConfig)).toBe(true);
      expect(isSecretEnvVar('COOKIE_SECRET', defaultConfig)).toBe(true);
    });

    it('should identify env vars ending with _TOKEN as secret', () => {
      expect(isSecretEnvVar('GITHUB_TOKEN', defaultConfig)).toBe(true);
      expect(isSecretEnvVar('NPM_TOKEN', defaultConfig)).toBe(true);
      expect(isSecretEnvVar('AWS_SESSION_TOKEN', defaultConfig)).toBe(true);
    });

    it('should identify env vars ending with _PASSWORD as secret', () => {
      expect(isSecretEnvVar('DB_PASSWORD', defaultConfig)).toBe(true);
      expect(isSecretEnvVar('REDIS_PASSWORD', defaultConfig)).toBe(true);
    });

    it('should identify exact match secrets', () => {
      expect(isSecretEnvVar('DATABASE_URL', defaultConfig)).toBe(true);
      expect(isSecretEnvVar('REDIS_URL', defaultConfig)).toBe(true);
      expect(isSecretEnvVar('MONGO_URI', defaultConfig)).toBe(true);
    });

    it('should be case-insensitive for pattern matching', () => {
      expect(isSecretEnvVar('my_api_key', defaultConfig)).toBe(true);
      expect(isSecretEnvVar('My_Secret', defaultConfig)).toBe(true);
      expect(isSecretEnvVar('some_token', defaultConfig)).toBe(true);
    });

    it('should NOT flag allowlisted vars even if they match patterns', () => {
      expect(isSecretEnvVar('PATH', defaultConfig)).toBe(false);
      expect(isSecretEnvVar('HOME', defaultConfig)).toBe(false);
      expect(isSecretEnvVar('NODE_ENV', defaultConfig)).toBe(false);
      expect(isSecretEnvVar('SHELL', defaultConfig)).toBe(false);
      expect(isSecretEnvVar('TERM', defaultConfig)).toBe(false);
    });

    it('should NOT flag normal env vars', () => {
      expect(isSecretEnvVar('MY_APP_NAME', defaultConfig)).toBe(false);
      expect(isSecretEnvVar('LOG_LEVEL', defaultConfig)).toBe(false);
      expect(isSecretEnvVar('PORT', defaultConfig)).toBe(false);
      expect(isSecretEnvVar('HOSTNAME', defaultConfig)).toBe(false);
    });

    it('should respect additional allowlist', () => {
      const config = getSecureSanitizationConfig({
        additionalAllowlist: new Set(['CUSTOM_API_KEY']),
      });
      expect(isSecretEnvVar('CUSTOM_API_KEY', config)).toBe(false);
      expect(isSecretEnvVar('OTHER_API_KEY', config)).toBe(true);
    });
  });

  describe('sanitizeEnvironment', () => {
    it('should strip secret env vars from the environment', () => {
      const env: NodeJS.ProcessEnv = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        OPENAI_API_KEY: 'sk-secret-value',
        GITHUB_TOKEN: 'ghp_secret',
        NODE_ENV: 'production',
        MY_APP_PORT: '3000',
      };

      const sanitized = sanitizeEnvironment(env);

      expect(sanitized['PATH']).toBe('/usr/bin');
      expect(sanitized['HOME']).toBe('/home/user');
      expect(sanitized['NODE_ENV']).toBe('production');
      expect(sanitized['MY_APP_PORT']).toBe('3000');
      expect(sanitized['OPENAI_API_KEY']).toBeUndefined();
      expect(sanitized['GITHUB_TOKEN']).toBeUndefined();
    });

    it('should preserve all allowlisted vars', () => {
      const env: NodeJS.ProcessEnv = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        SHELL: '/bin/zsh',
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
        EDITOR: 'vim',
        CI: 'true',
        DEBUG: '1',
        QWEN_CODE: '1',
      };

      const sanitized = sanitizeEnvironment(env);

      for (const key of Object.keys(env)) {
        expect(sanitized[key]).toBe(env[key]);
      }
    });

    it('should strip multiple secret patterns', () => {
      const env: NodeJS.ProcessEnv = {
        AWS_ACCESS_KEY_ID: 'AKIA...',
        AWS_SECRET_ACCESS_KEY: 'secret...',
        AWS_SESSION_TOKEN: 'token...',
        DB_PASSWORD: 'hunter2',
        ANTHROPIC_API_KEY: 'sk-ant-...',
        JWT_SECRET: 'mysecret',
        PATH: '/usr/bin',
      };

      const sanitized = sanitizeEnvironment(env);

      expect(sanitized['PATH']).toBe('/usr/bin');
      expect(sanitized['AWS_ACCESS_KEY_ID']).toBeUndefined();
      expect(sanitized['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
      expect(sanitized['AWS_SESSION_TOKEN']).toBeUndefined();
      expect(sanitized['DB_PASSWORD']).toBeUndefined();
      expect(sanitized['ANTHROPIC_API_KEY']).toBeUndefined();
      expect(sanitized['JWT_SECRET']).toBeUndefined();
    });

    it('should skip undefined values', () => {
      const env: NodeJS.ProcessEnv = {
        DEFINED: 'yes',
        UNDEFINED_VAR: undefined,
      };

      const sanitized = sanitizeEnvironment(env);
      expect(sanitized['DEFINED']).toBe('yes');
      expect('UNDEFINED_VAR' in sanitized).toBe(false);
    });

    it('should handle empty environment', () => {
      const sanitized = sanitizeEnvironment({});
      expect(Object.keys(sanitized)).toHaveLength(0);
    });

    it('should handle custom config overrides', () => {
      const env: NodeJS.ProcessEnv = {
        CUSTOM_CREDENTIAL: 'secret',
        NORMAL_VAR: 'value',
        PATH: '/usr/bin',
      };

      const sanitized = sanitizeEnvironment(env, {
        secretPatterns: ['_CREDENTIAL'],
      });

      expect(sanitized['NORMAL_VAR']).toBe('value');
      expect(sanitized['PATH']).toBe('/usr/bin');
      expect(sanitized['CUSTOM_CREDENTIAL']).toBeUndefined();
    });

    it('should support additional allowlist via config', () => {
      const env: NodeJS.ProcessEnv = {
        SPECIAL_API_KEY: 'needed-for-build',
        OTHER_API_KEY: 'should-be-stripped',
        PATH: '/usr/bin',
      };

      const sanitized = sanitizeEnvironment(env, {
        additionalAllowlist: new Set(['SPECIAL_API_KEY']),
      });

      expect(sanitized['SPECIAL_API_KEY']).toBe('needed-for-build');
      expect(sanitized['OTHER_API_KEY']).toBeUndefined();
      expect(sanitized['PATH']).toBe('/usr/bin');
    });

    it('should not modify the original env object', () => {
      const env: NodeJS.ProcessEnv = {
        OPENAI_API_KEY: 'sk-secret',
        PATH: '/usr/bin',
      };

      const originalKeys = Object.keys(env);
      sanitizeEnvironment(env);
      expect(Object.keys(env)).toEqual(originalKeys);
      expect(env['OPENAI_API_KEY']).toBe('sk-secret');
    });

    it('should preserve Windows system vars', () => {
      const env: NodeJS.ProcessEnv = {
        SYSTEMROOT: 'C:\\Windows',
        WINDIR: 'C:\\Windows',
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
        APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
        USERPROFILE: 'C:\\Users\\test',
        OPENAI_API_KEY: 'sk-secret',
      };

      const sanitized = sanitizeEnvironment(env);

      expect(sanitized['SYSTEMROOT']).toBe('C:\\Windows');
      expect(sanitized['WINDIR']).toBe('C:\\Windows');
      expect(sanitized['COMSPEC']).toBe('C:\\Windows\\System32\\cmd.exe');
      expect(sanitized['APPDATA']).toBe('C:\\Users\\test\\AppData\\Roaming');
      expect(sanitized['OPENAI_API_KEY']).toBeUndefined();
    });
  });

  describe('getSecureSanitizationConfig', () => {
    it('should return default config when no overrides provided', () => {
      const config = getSecureSanitizationConfig();
      expect(config.secretPatterns).toBe(SECRET_ENV_PATTERNS);
      expect(config.secretExact).toBe(SECRET_ENV_EXACT);
      expect(config.allowlist).toBe(DEFAULT_ALLOWLIST);
    });

    it('should allow overriding individual fields', () => {
      const customPatterns = ['_CUSTOM'] as const;
      const config = getSecureSanitizationConfig({
        secretPatterns: customPatterns,
      });
      expect(config.secretPatterns).toBe(customPatterns);
      expect(config.secretExact).toBe(SECRET_ENV_EXACT);
      expect(config.allowlist).toBe(DEFAULT_ALLOWLIST);
    });
  });

  describe('regression: sandbox still functions after filtering', () => {
    it('should always pass through QWEN_CODE marker', () => {
      const env: NodeJS.ProcessEnv = {
        QWEN_CODE: '1',
        OPENAI_API_KEY: 'sk-secret',
      };
      const sanitized = sanitizeEnvironment(env);
      expect(sanitized['QWEN_CODE']).toBe('1');
    });

    it('should always pass through PATH', () => {
      const env: NodeJS.ProcessEnv = {
        PATH: '/usr/local/bin:/usr/bin',
        OPENAI_API_KEY: 'sk-secret',
      };
      const sanitized = sanitizeEnvironment(env);
      expect(sanitized['PATH']).toBe('/usr/local/bin:/usr/bin');
    });

    it('should preserve Git-related env vars', () => {
      const env: NodeJS.ProcessEnv = {
        GIT_AUTHOR_NAME: 'Test User',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_PAGER: 'cat',
        GITHUB_TOKEN: 'ghp_secret',
      };
      const sanitized = sanitizeEnvironment(env);
      expect(sanitized['GIT_AUTHOR_NAME']).toBe('Test User');
      expect(sanitized['GIT_AUTHOR_EMAIL']).toBe('test@example.com');
      expect(sanitized['GIT_PAGER']).toBe('cat');
      expect(sanitized['GITHUB_TOKEN']).toBeUndefined();
    });

    it('should preserve development tooling vars', () => {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'development',
        DEBUG: 'app:*',
        FORCE_COLOR: '1',
        EDITOR: 'code',
        VIRTUAL_ENV: '/path/to/venv',
        NVM_DIR: '/home/user/.nvm',
      };
      const sanitized = sanitizeEnvironment(env);
      for (const [key, value] of Object.entries(env)) {
        expect(sanitized[key]).toBe(value);
      }
    });
  });
});
