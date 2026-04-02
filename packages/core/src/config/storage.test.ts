/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, it, expect, vi, afterEach } from 'vitest';

vi.unmock('./storage.js');
vi.unmock('./projectRegistry.js');
vi.unmock('./storageMigration.js');

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    realpathSync: vi.fn(actual.realpathSync),
  };
});

import { Storage } from './storage.js';
import { APEX_DIR, homedir, resolveToRealPath } from '../utils/paths.js';
import { ProjectRegistry } from './projectRegistry.js';
import { StorageMigration } from './storageMigration.js';

const PROJECT_SLUG = 'project-slug';

vi.mock('./projectRegistry.js');
vi.mock('./storageMigration.js');

describe('Storage – initialize', () => {
  const projectRoot = '/tmp/project';
  let storage: Storage;

  beforeEach(() => {
    ProjectRegistry.prototype.initialize = vi.fn().mockResolvedValue(undefined);
    ProjectRegistry.prototype.getShortId = vi
      .fn()
      .mockReturnValue(PROJECT_SLUG);
    storage = new Storage(projectRoot);
    vi.clearAllMocks();

    // Mock StorageMigration.migrateDirectory
    vi.mocked(StorageMigration.migrateDirectory).mockResolvedValue(undefined);
  });

  it('sets up the registry and performs migration if `getProjectTempDir` is called', async () => {
    await storage.initialize();
    expect(storage.getProjectTempDir()).toBe(
      path.join(os.homedir(), APEX_DIR, 'tmp', PROJECT_SLUG),
    );

    // Verify registry initialization
    expect(ProjectRegistry).toHaveBeenCalled();
    expect(vi.mocked(ProjectRegistry).prototype.initialize).toHaveBeenCalled();
    expect(
      vi.mocked(ProjectRegistry).prototype.getShortId,
    ).toHaveBeenCalledWith(projectRoot);

    // Verify migration calls
    // We can't easily get the hash here without repeating logic, but we can verify it's called twice
    expect(StorageMigration.migrateDirectory).toHaveBeenCalledTimes(2);

    // Verify identifier is set by checking a path
    expect(storage.getProjectTempDir()).toContain(PROJECT_SLUG);
  });
});

vi.mock('../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/paths.js')>();
  return {
    ...actual,
    homedir: vi.fn(actual.homedir),
  };
});

describe('Storage – getGlobalSettingsPath', () => {
  it('returns path to ~/.apex/settings.json', () => {
    const expected = path.join(os.homedir(), APEX_DIR, 'settings.json');
    expect(Storage.getGlobalSettingsPath()).toBe(expected);
  });
});

describe('Storage - Security', () => {
  it('falls back to tmp for gemini but returns empty for agents if the home directory cannot be determined', () => {
    vi.mocked(homedir).mockReturnValue('');

    // .gemini falls back for backward compatibility
    expect(Storage.getGlobalGeminiDir()).toBe(
      path.join(os.tmpdir(), APEX_DIR),
    );

    // .agents returns empty to avoid insecure fallback WITHOUT throwing error
    expect(Storage.getGlobalAgentsDir()).toBe('');

    vi.mocked(homedir).mockReturnValue(os.homedir());
  });
});

describe('Storage – additional helpers', () => {
  const projectRoot = '/tmp/project';
  const storage = new Storage(projectRoot);

  beforeEach(() => {
    ProjectRegistry.prototype.getShortId = vi
      .fn()
      .mockReturnValue(PROJECT_SLUG);
  });

  it('getWorkspaceSettingsPath returns project/.apex/settings.json', () => {
    const expected = path.join(projectRoot, APEX_DIR, 'settings.json');
    expect(storage.getWorkspaceSettingsPath()).toBe(expected);
  });

  it('getUserCommandsDir returns ~/.apex/commands', () => {
    const expected = path.join(os.homedir(), APEX_DIR, 'commands');
    expect(Storage.getUserCommandsDir()).toBe(expected);
  });

  it('getProjectCommandsDir returns project/.apex/commands', () => {
    const expected = path.join(projectRoot, APEX_DIR, 'commands');
    expect(storage.getProjectCommandsDir()).toBe(expected);
  });

  it('getUserSkillsDir returns ~/.apex/skills', () => {
    const expected = path.join(os.homedir(), APEX_DIR, 'skills');
    expect(Storage.getUserSkillsDir()).toBe(expected);
  });

  it('getProjectSkillsDir returns project/.apex/skills', () => {
    const expected = path.join(projectRoot, APEX_DIR, 'skills');
    expect(storage.getProjectSkillsDir()).toBe(expected);
  });

  it('getUserAgentsDir returns ~/.apex/agents', () => {
    const expected = path.join(os.homedir(), APEX_DIR, 'agents');
    expect(Storage.getUserAgentsDir()).toBe(expected);
  });

  it('getProjectAgentsDir returns project/.apex/agents', () => {
    const expected = path.join(projectRoot, APEX_DIR, 'agents');
    expect(storage.getProjectAgentsDir()).toBe(expected);
  });

  it('getProjectMemoryDir returns ~/.apex/tmp/<identifier>/memory', async () => {
    await storage.initialize();
    const expected = path.join(
      os.homedir(),
      APEX_DIR,
      'tmp',
      PROJECT_SLUG,
      'memory',
    );
    expect(storage.getProjectMemoryDir()).toBe(expected);
  });

  it('getMcpOAuthTokensPath returns ~/.apex/mcp-oauth-tokens.json', () => {
    const expected = path.join(
      os.homedir(),
      APEX_DIR,
      'mcp-oauth-tokens.json',
    );
    expect(Storage.getMcpOAuthTokensPath()).toBe(expected);
  });

  it('getGlobalBinDir returns ~/.apex/tmp/bin', () => {
    const expected = path.join(os.homedir(), APEX_DIR, 'tmp', 'bin');
    expect(Storage.getGlobalBinDir()).toBe(expected);
  });

  it('getProjectTempPlansDir returns ~/.apex/tmp/<identifier>/plans when no sessionId is provided', async () => {
    await storage.initialize();
    const tempDir = storage.getProjectTempDir();
    const expected = path.join(tempDir, 'plans');
    expect(storage.getProjectTempPlansDir()).toBe(expected);
  });

  it('getProjectTempPlansDir returns ~/.apex/tmp/<identifier>/<sessionId>/plans when sessionId is provided', async () => {
    const sessionId = 'test-session-id';
    const storageWithSession = new Storage(projectRoot, sessionId);
    ProjectRegistry.prototype.getShortId = vi
      .fn()
      .mockReturnValue(PROJECT_SLUG);
    await storageWithSession.initialize();
    const tempDir = storageWithSession.getProjectTempDir();
    const expected = path.join(tempDir, sessionId, 'plans');
    expect(storageWithSession.getProjectTempPlansDir()).toBe(expected);
  });

  it('getProjectTempTrackerDir returns ~/.apex/tmp/<identifier>/tracker when no sessionId is provided', async () => {
    await storage.initialize();
    const tempDir = storage.getProjectTempDir();
    const expected = path.join(tempDir, 'tracker');
    expect(storage.getProjectTempTrackerDir()).toBe(expected);
  });

  it('getProjectTempTrackerDir returns ~/.apex/tmp/<identifier>/<sessionId>/tracker when sessionId is provided', async () => {
    const sessionId = 'test-session-id';
    const storageWithSession = new Storage(projectRoot, sessionId);
    ProjectRegistry.prototype.getShortId = vi
      .fn()
      .mockReturnValue(PROJECT_SLUG);
    await storageWithSession.initialize();
    const tempDir = storageWithSession.getProjectTempDir();
    const expected = path.join(tempDir, sessionId, 'tracker');
    expect(storageWithSession.getProjectTempTrackerDir()).toBe(expected);
  });

  describe('Session and JSON Loading', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('listProjectChatFiles returns sorted sessions from chats directory', async () => {
      const readdirSpy = vi
        .spyOn(fs.promises, 'readdir')
        /* eslint-disable @typescript-eslint/no-explicit-any */
        .mockResolvedValue([
          'session-1.json',
          'session-2.json',
          'not-a-session.txt',
        ] as any);

      const statSpy = vi
        .spyOn(fs.promises, 'stat')
        .mockImplementation(async (p: any) => {
          if (p.toString().endsWith('session-1.json')) {
            return {
              mtime: new Date('2026-02-01'),
              mtimeMs: 1000,
            } as any;
          }
          return {
            mtime: new Date('2026-02-02'),
            mtimeMs: 2000,
          } as any;
        });
      /* eslint-enable @typescript-eslint/no-explicit-any */

      const sessions = await storage.listProjectChatFiles();

      expect(readdirSpy).toHaveBeenCalledWith(expect.stringContaining('chats'));
      expect(sessions).toHaveLength(2);
      // Sorted by mtime desc
      expect(sessions[0].filePath).toBe(path.join('chats', 'session-2.json'));
      expect(sessions[1].filePath).toBe(path.join('chats', 'session-1.json'));
      expect(sessions[0].lastUpdated).toBe(
        new Date('2026-02-02').toISOString(),
      );

      readdirSpy.mockRestore();
      statSpy.mockRestore();
    });

    it('loadProjectTempFile loads and parses JSON from relative path', async () => {
      const readFileSpy = vi
        .spyOn(fs.promises, 'readFile')
        .mockResolvedValue(JSON.stringify({ hello: 'world' }));

      const result = await storage.loadProjectTempFile<{ hello: string }>(
        'some/file.json',
      );

      expect(readFileSpy).toHaveBeenCalledWith(
        expect.stringContaining(path.join(PROJECT_SLUG, 'some/file.json')),
        'utf8',
      );
      expect(result).toEqual({ hello: 'world' });

      readFileSpy.mockRestore();
    });

    it('loadProjectTempFile returns null if file does not exist', async () => {
      const error = new Error('File not found');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error as any).code = 'ENOENT';
      const readFileSpy = vi
        .spyOn(fs.promises, 'readFile')
        .mockRejectedValue(error);

      const result = await storage.loadProjectTempFile('missing.json');

      expect(result).toBeNull();

      readFileSpy.mockRestore();
    });
  });

  describe('getPlansDir', () => {
    interface TestCase {
      name: string;
      customDir: string | undefined;
      expected: string | (() => string);
      expectedError?: string;
      setup?: () => () => void;
    }

    const testCases: TestCase[] = [
      {
        name: 'custom relative path',
        customDir: '.my-plans',
        expected: path.resolve(projectRoot, '.my-plans'),
      },
      {
        name: 'custom absolute path outside throws',
        customDir: '/absolute/path/to/plans',
        expected: '',
        expectedError: `Custom plans directory '/absolute/path/to/plans' resolves to '/absolute/path/to/plans', which is outside the project root '${resolveToRealPath(projectRoot)}'.`,
      },
      {
        name: 'absolute path that happens to be inside project root',
        customDir: path.join(projectRoot, 'internal-plans'),
        expected: path.join(projectRoot, 'internal-plans'),
      },
      {
        name: 'relative path that stays within project root',
        customDir: 'subdir/../plans',
        expected: path.resolve(projectRoot, 'plans'),
      },
      {
        name: 'dot path',
        customDir: '.',
        expected: projectRoot,
      },
      {
        name: 'default behavior when customDir is undefined',
        customDir: undefined,
        expected: () => storage.getProjectTempPlansDir(),
      },
      {
        name: 'escaping relative path throws',
        customDir: '../escaped-plans',
        expected: '',
        expectedError: `Custom plans directory '../escaped-plans' resolves to '${resolveToRealPath(path.resolve(projectRoot, '../escaped-plans'))}', which is outside the project root '${resolveToRealPath(projectRoot)}'.`,
      },
      {
        name: 'hidden directory starting with ..',
        customDir: '..plans',
        expected: path.resolve(projectRoot, '..plans'),
      },
      {
        name: 'security escape via symbolic link throws',
        customDir: 'symlink-to-outside',
        setup: () => {
          vi.mocked(fs.realpathSync).mockImplementation((p: fs.PathLike) => {
            if (p.toString().includes('symlink-to-outside')) {
              return '/outside/project/root';
            }
            return p.toString();
          });
          return () => vi.mocked(fs.realpathSync).mockRestore();
        },
        expected: '',
        expectedError:
          "Custom plans directory 'symlink-to-outside' resolves to '/outside/project/root', which is outside the project root '/tmp/project'.",
      },
    ];

    testCases.forEach(({ name, customDir, expected, expectedError, setup }) => {
      it(`should handle ${name}`, async () => {
        const cleanup = setup?.();
        try {
          if (name.includes('default behavior')) {
            await storage.initialize();
          }

          storage.setCustomPlansDir(customDir);
          if (expectedError) {
            expect(() => storage.getPlansDir()).toThrow(expectedError);
          } else {
            const expectedValue =
              typeof expected === 'function' ? expected() : expected;
            expect(storage.getPlansDir()).toBe(expectedValue);
          }
        } finally {
          cleanup?.();
        }
      });
    });
  });
});

describe('Storage - System Paths', () => {
  const originalEnv = process.env['APEX_SYSTEM_SETTINGS_PATH'];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['APEX_SYSTEM_SETTINGS_PATH'] = originalEnv;
    } else {
      delete process.env['APEX_SYSTEM_SETTINGS_PATH'];
    }
  });

  it('getSystemSettingsPath returns correct path based on platform (default)', () => {
    delete process.env['APEX_SYSTEM_SETTINGS_PATH'];

    const platform = os.platform();
    const result = Storage.getSystemSettingsPath();

    if (platform === 'darwin') {
      expect(result).toBe(
        '/Library/Application Support/GeminiCli/settings.json',
      );
    } else if (platform === 'win32') {
      expect(result).toBe('C:\\ProgramData\\apex\\settings.json');
    } else {
      expect(result).toBe('/etc/apex/settings.json');
    }
  });

  it('getSystemSettingsPath follows APEX_SYSTEM_SETTINGS_PATH if set', () => {
    const customPath = '/custom/path/settings.json';
    process.env['APEX_SYSTEM_SETTINGS_PATH'] = customPath;
    expect(Storage.getSystemSettingsPath()).toBe(customPath);
  });

  it('getSystemPoliciesDir returns correct path based on platform and ignores env var', () => {
    process.env['APEX_SYSTEM_SETTINGS_PATH'] =
      '/custom/path/settings.json';
    const platform = os.platform();
    const result = Storage.getSystemPoliciesDir();

    expect(result).not.toContain('/custom/path');

    if (platform === 'darwin') {
      expect(result).toBe('/Library/Application Support/GeminiCli/policies');
    } else if (platform === 'win32') {
      expect(result).toBe('C:\\ProgramData\\apex\\policies');
    } else {
      expect(result).toBe('/etc/apex/policies');
    }
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
