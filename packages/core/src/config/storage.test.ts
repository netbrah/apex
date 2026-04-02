/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { Storage } from './storage.js';

describe('Storage – getGlobalSettingsPath', () => {
  it('returns path to ~/.apex/settings.json', () => {
    const expected = path.join(os.homedir(), '.apex', 'settings.json');
    expect(Storage.getGlobalSettingsPath()).toBe(expected);
  });
});

describe('Storage – additional helpers', () => {
  const projectRoot = '/tmp/project';
  const storage = new Storage(projectRoot);

  it('getWorkspaceSettingsPath returns project/.apex/settings.json', () => {
    const expected = path.join(projectRoot, '.apex', 'settings.json');
    expect(storage.getWorkspaceSettingsPath()).toBe(expected);
  });

  it('getUserCommandsDir returns ~/.apex/commands', () => {
    const expected = path.join(os.homedir(), '.apex', 'commands');
    expect(Storage.getUserCommandsDir()).toBe(expected);
  });

  it('getProjectCommandsDir returns project/.apex/commands', () => {
    const expected = path.join(projectRoot, '.apex', 'commands');
    expect(storage.getProjectCommandsDir()).toBe(expected);
  });

  it('getMcpOAuthTokensPath returns ~/.apex/mcp-oauth-tokens.json', () => {
    const expected = path.join(os.homedir(), '.apex', 'mcp-oauth-tokens.json');
    expect(Storage.getMcpOAuthTokensPath()).toBe(expected);
  });
});

describe('Storage – getRuntimeBaseDir / setRuntimeBaseDir', () => {
  const originalEnv = process.env['APEX_RUNTIME_DIR'];

  beforeEach(() => {
    // Reset state before each test
    Storage.setRuntimeBaseDir(null);
    delete process.env['APEX_RUNTIME_DIR'];
  });

  afterEach(() => {
    // Restore original env
    Storage.setRuntimeBaseDir(null);
    if (originalEnv !== undefined) {
      process.env['APEX_RUNTIME_DIR'] = originalEnv;
    } else {
      delete process.env['APEX_RUNTIME_DIR'];
    }
  });

  it('defaults to getGlobalApexDir() when nothing is configured', () => {
    expect(Storage.getRuntimeBaseDir()).toBe(Storage.getGlobalApexDir());
  });

  it('uses setRuntimeBaseDir value when set with absolute path', () => {
    const runtimeDir = path.resolve('custom', 'runtime');
    Storage.setRuntimeBaseDir(runtimeDir);
    expect(Storage.getRuntimeBaseDir()).toBe(runtimeDir);
  });

  it('env var APEX_RUNTIME_DIR takes priority over setRuntimeBaseDir', () => {
    const settingsDir = path.resolve('from-settings');
    const envDir = path.resolve('from-env');
    Storage.setRuntimeBaseDir(settingsDir);
    process.env['APEX_RUNTIME_DIR'] = envDir;
    expect(Storage.getRuntimeBaseDir()).toBe(envDir);
  });

  it('expands tilde (~) in setRuntimeBaseDir', () => {
    Storage.setRuntimeBaseDir('~/custom-runtime');
    const expected = path.join(os.homedir(), 'custom-runtime');
    expect(Storage.getRuntimeBaseDir()).toBe(expected);
  });

  it('expands Windows-style tilde paths in setRuntimeBaseDir', () => {
    Storage.setRuntimeBaseDir('~\\custom-runtime');
    const expected = path.join(os.homedir(), 'custom-runtime');
    expect(Storage.getRuntimeBaseDir()).toBe(expected);
  });

  it('expands tilde (~) in APEX_RUNTIME_DIR env var', () => {
    process.env['APEX_RUNTIME_DIR'] = '~/env-runtime';
    const expected = path.join(os.homedir(), 'env-runtime');
    expect(Storage.getRuntimeBaseDir()).toBe(expected);
  });

  it('resolves relative paths in setRuntimeBaseDir using process.cwd by default', () => {
    Storage.setRuntimeBaseDir('relative/path');
    const expected = path.resolve('relative/path');
    expect(Storage.getRuntimeBaseDir()).toBe(expected);
  });

  it('resolves relative paths in setRuntimeBaseDir using explicit cwd', () => {
    const cwd = path.resolve('workspace', 'projectA');
    Storage.setRuntimeBaseDir('.apex', cwd);
    expect(Storage.getRuntimeBaseDir()).toBe(path.join(cwd, '.apex'));
  });

  it('ignores cwd when path is absolute', () => {
    const absolutePath = path.resolve('absolute', 'path');
    const cwd = path.resolve('workspace', 'projectA');
    Storage.setRuntimeBaseDir(absolutePath, cwd);
    expect(Storage.getRuntimeBaseDir()).toBe(absolutePath);
  });

  it('ignores cwd when path starts with tilde', () => {
    Storage.setRuntimeBaseDir(
      '~/runtime',
      path.resolve('workspace', 'projectA'),
    );
    const expected = path.join(os.homedir(), 'runtime');
    expect(Storage.getRuntimeBaseDir()).toBe(expected);
  });

  it('resolves relative paths in APEX_RUNTIME_DIR env var', () => {
    process.env['APEX_RUNTIME_DIR'] = 'relative/env-path';
    const expected = path.resolve('relative/env-path');
    expect(Storage.getRuntimeBaseDir()).toBe(expected);
  });

  it('resets to default when setRuntimeBaseDir is called with null', () => {
    const customDir = path.resolve('custom');
    Storage.setRuntimeBaseDir(customDir);
    expect(Storage.getRuntimeBaseDir()).toBe(customDir);

    Storage.setRuntimeBaseDir(null);
    expect(Storage.getRuntimeBaseDir()).toBe(Storage.getGlobalApexDir());
  });

  it('resets to default when setRuntimeBaseDir is called with undefined', () => {
    Storage.setRuntimeBaseDir(path.resolve('custom'));
    Storage.setRuntimeBaseDir(undefined);
    expect(Storage.getRuntimeBaseDir()).toBe(Storage.getGlobalApexDir());
  });

  it('resets to default when setRuntimeBaseDir is called with empty string', () => {
    Storage.setRuntimeBaseDir(path.resolve('custom'));
    Storage.setRuntimeBaseDir('');
    expect(Storage.getRuntimeBaseDir()).toBe(Storage.getGlobalApexDir());
  });

  it('handles bare tilde (~) as home directory', () => {
    Storage.setRuntimeBaseDir('~');
    expect(Storage.getRuntimeBaseDir()).toBe(os.homedir());
  });
});

describe('Storage – runtime path methods use getRuntimeBaseDir', () => {
  const originalEnv = process.env['APEX_RUNTIME_DIR'];

  beforeEach(() => {
    Storage.setRuntimeBaseDir(null);
    delete process.env['APEX_RUNTIME_DIR'];
  });

  afterEach(() => {
    Storage.setRuntimeBaseDir(null);
    if (originalEnv !== undefined) {
      process.env['APEX_RUNTIME_DIR'] = originalEnv;
    } else {
      delete process.env['APEX_RUNTIME_DIR'];
    }
  });

  it('getGlobalTempDir uses custom runtime base dir', () => {
    const customDir = path.resolve('custom');
    Storage.setRuntimeBaseDir(customDir);
    expect(Storage.getGlobalTempDir()).toBe(path.join(customDir, 'tmp'));
  });

  it('getGlobalDebugDir uses custom runtime base dir', () => {
    const customDir = path.resolve('custom');
    Storage.setRuntimeBaseDir(customDir);
    expect(Storage.getGlobalDebugDir()).toBe(path.join(customDir, 'debug'));
  });

  it('getDebugLogPath uses custom runtime base dir', () => {
    const customDir = path.resolve('custom');
    Storage.setRuntimeBaseDir(customDir);
    expect(Storage.getDebugLogPath('session-123')).toBe(
      path.join(customDir, 'debug', 'session-123.txt'),
    );
  });

  it('getGlobalIdeDir uses custom runtime base dir', () => {
    const customDir = path.resolve('custom');
    Storage.setRuntimeBaseDir(customDir);
    expect(Storage.getGlobalIdeDir()).toBe(path.join(customDir, 'ide'));
  });

  it('getProjectDir uses custom runtime base dir', () => {
    const customDir = path.resolve('custom');
    Storage.setRuntimeBaseDir(customDir);
    const storage = new Storage('/tmp/project');
    expect(storage.getProjectDir()).toContain(path.join(customDir, 'projects'));
  });

  it('getHistoryDir uses custom runtime base dir', () => {
    const customDir = path.resolve('custom');
    Storage.setRuntimeBaseDir(customDir);
    const storage = new Storage('/tmp/project');
    expect(storage.getHistoryDir()).toContain(path.join(customDir, 'history'));
  });

  it('getProjectTempDir uses custom runtime base dir', () => {
    const customDir = path.resolve('custom');
    Storage.setRuntimeBaseDir(customDir);
    const storage = new Storage('/tmp/project');
    expect(storage.getProjectTempDir()).toContain(path.join(customDir, 'tmp'));
  });

  it('getProjectTempCheckpointsDir uses custom runtime base dir', () => {
    const customDir = path.resolve('custom');
    Storage.setRuntimeBaseDir(customDir);
    const storage = new Storage('/tmp/project');
    expect(storage.getProjectTempCheckpointsDir()).toContain(
      path.join(customDir, 'tmp'),
    );
    expect(storage.getProjectTempCheckpointsDir()).toMatch(/checkpoints$/);
  });

  it('getHistoryFilePath uses custom runtime base dir', () => {
    const customDir = path.resolve('custom');
    Storage.setRuntimeBaseDir(customDir);
    const storage = new Storage('/tmp/project');
    expect(storage.getHistoryFilePath()).toContain(path.join(customDir, 'tmp'));
    expect(storage.getHistoryFilePath()).toMatch(/shell_history$/);
  });
});

describe('Storage – config paths remain at ~/.apex regardless of runtime dir', () => {
  const originalEnv = process.env['APEX_RUNTIME_DIR'];
  const globalApexDir = Storage.getGlobalApexDir();

  beforeEach(() => {
    Storage.setRuntimeBaseDir(path.resolve('custom-runtime'));
    process.env['APEX_RUNTIME_DIR'] = path.resolve('env-runtime');
  });

  afterEach(() => {
    Storage.setRuntimeBaseDir(null);
    if (originalEnv !== undefined) {
      process.env['APEX_RUNTIME_DIR'] = originalEnv;
    } else {
      delete process.env['APEX_RUNTIME_DIR'];
    }
  });

  it('getGlobalSettingsPath still uses ~/.apex', () => {
    expect(Storage.getGlobalSettingsPath()).toBe(
      path.join(globalApexDir, 'settings.json'),
    );
  });

  it('getInstallationIdPath still uses ~/.apex', () => {
    expect(Storage.getInstallationIdPath()).toBe(
      path.join(globalApexDir, 'installation_id'),
    );
  });

  it('getGoogleAccountsPath still uses ~/.apex', () => {
    expect(Storage.getGoogleAccountsPath()).toBe(
      path.join(globalApexDir, 'google_accounts.json'),
    );
  });

  it('getMcpOAuthTokensPath still uses ~/.apex', () => {
    expect(Storage.getMcpOAuthTokensPath()).toBe(
      path.join(globalApexDir, 'mcp-oauth-tokens.json'),
    );
  });

  it('getOAuthCredsPath still uses ~/.apex', () => {
    expect(Storage.getOAuthCredsPath()).toBe(
      path.join(globalApexDir, 'oauth_creds.json'),
    );
  });

  it('getUserCommandsDir still uses ~/.apex', () => {
    expect(Storage.getUserCommandsDir()).toBe(
      path.join(globalApexDir, 'commands'),
    );
  });

  it('getGlobalMemoryFilePath still uses ~/.apex', () => {
    expect(Storage.getGlobalMemoryFilePath()).toBe(
      path.join(globalApexDir, 'memory.md'),
    );
  });

  it('getGlobalBinDir still uses ~/.apex', () => {
    expect(Storage.getGlobalBinDir()).toBe(path.join(globalApexDir, 'bin'));
  });

  it('getUserSkillsDirs still includes ~/.apex/skills', () => {
    const storage = new Storage('/tmp/project');
    const skillsDirs = storage.getUserSkillsDirs();
    expect(
      skillsDirs.some((dir) => dir === path.join(globalApexDir, 'skills')),
    ).toBe(true);
  });
});

describe('Storage – runtime base dir async context isolation', () => {
  const originalEnv = process.env['APEX_RUNTIME_DIR'];

  beforeEach(() => {
    Storage.setRuntimeBaseDir(null);
    delete process.env['APEX_RUNTIME_DIR'];
  });

  afterEach(() => {
    Storage.setRuntimeBaseDir(null);
    if (originalEnv !== undefined) {
      process.env['APEX_RUNTIME_DIR'] = originalEnv;
    } else {
      delete process.env['APEX_RUNTIME_DIR'];
    }
  });

  it('uses contextual runtime dir inside runWithRuntimeBaseDir', async () => {
    Storage.setRuntimeBaseDir(path.resolve('global-runtime'));
    const cwd = path.resolve('workspace', 'project-a');

    await Storage.runWithRuntimeBaseDir('.apex', cwd, async () => {
      expect(Storage.getRuntimeBaseDir()).toBe(path.join(cwd, '.apex'));
    });
  });

  it('keeps concurrent contexts isolated', async () => {
    const cwdA = path.resolve('workspace', 'a');
    const cwdB = path.resolve('workspace', 'b');

    const runA = Storage.runWithRuntimeBaseDir('.qwen-a', cwdA, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Storage.getRuntimeBaseDir();
    });

    const runB = Storage.runWithRuntimeBaseDir('.qwen-b', cwdB, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return Storage.getRuntimeBaseDir();
    });

    const [a, b] = await Promise.all([runA, runB]);
    expect(a).toBe(path.join(cwdA, '.qwen-a'));
    expect(b).toBe(path.join(cwdB, '.qwen-b'));
  });
});
