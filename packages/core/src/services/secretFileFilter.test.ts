/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  isSecretFile,
  getSecretFileReason,
  findSecretFiles,
  getSecretFileFindArgs,
} from './secretFileFilter.js';

// Mock fs for findSecretFiles
vi.mock('node:fs/promises', async () => {
  const actual =
    await vi.importActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    );
  return {
    ...actual,
    default: {
      ...actual,
      readdir: vi.fn(),
    },
    readdir: vi.fn(),
  };
});

import fsPromises from 'node:fs/promises';
import type fs from 'node:fs';

describe('secretFileFilter', () => {
  describe('isSecretFile', () => {
    // .env exact match
    it('should return true for .env', () => {
      expect(isSecretFile('.env')).toBe(true);
    });

    // .env.* prefix matches
    it('should return true for .env.local', () => {
      expect(isSecretFile('.env.local')).toBe(true);
    });

    it('should return true for .env.production', () => {
      expect(isSecretFile('.env.production')).toBe(true);
    });

    it('should return true for .env.development', () => {
      expect(isSecretFile('.env.development')).toBe(true);
    });

    it('should return true for .env.staging', () => {
      expect(isSecretFile('.env.staging')).toBe(true);
    });

    it('should return true for .env.test', () => {
      expect(isSecretFile('.env.test')).toBe(true);
    });

    // secrets.env exact match
    it('should return true for secrets.env', () => {
      expect(isSecretFile('secrets.env')).toBe(true);
    });

    // *.secret suffix matches
    it('should return true for db.secret', () => {
      expect(isSecretFile('db.secret')).toBe(true);
    });

    it('should return true for api.secret', () => {
      expect(isSecretFile('api.secret')).toBe(true);
    });

    // *.secrets suffix matches
    it('should return true for app.secrets', () => {
      expect(isSecretFile('app.secrets')).toBe(true);
    });

    // Full paths — should work with basename extraction
    it('should return true for /path/to/.env', () => {
      expect(isSecretFile('/path/to/.env')).toBe(true);
    });

    it('should return true for /path/to/.env.local', () => {
      expect(isSecretFile('/path/to/.env.local')).toBe(true);
    });

    it('should return true for /workspace/secrets.env', () => {
      expect(isSecretFile('/workspace/secrets.env')).toBe(true);
    });

    // Non-secret files (no over-filtering)
    it('should return false for regular files', () => {
      expect(isSecretFile('package.json')).toBe(false);
      expect(isSecretFile('index.ts')).toBe(false);
      expect(isSecretFile('.gitignore')).toBe(false);
      expect(isSecretFile('README.md')).toBe(false);
      expect(isSecretFile('config.json')).toBe(false);
      expect(isSecretFile('tsconfig.json')).toBe(false);
    });

    it('should return false for files that look similar but are not secret', () => {
      // ".environment" is not ".env"
      expect(isSecretFile('.environment')).toBe(false);
      // "env" without the dot
      expect(isSecretFile('env')).toBe(false);
      // ".envrc" does NOT start with ".env." (no dot after env)
      expect(isSecretFile('.envrc')).toBe(false);
    });

    it('should return false for .env-backup (dash, not dot)', () => {
      // ".env-backup" does not start with ".env." prefix
      expect(isSecretFile('.env-backup')).toBe(false);
    });
  });

  describe('getSecretFileReason', () => {
    it('should return reason for .env', () => {
      const reason = getSecretFileReason('.env');
      expect(reason).toBeDefined();
      expect(reason).toContain('.env');
    });

    it('should return reason for .env.local', () => {
      const reason = getSecretFileReason('.env.local');
      expect(reason).toBeDefined();
    });

    it('should return reason for secrets.env', () => {
      const reason = getSecretFileReason('secrets.env');
      expect(reason).toBeDefined();
      expect(reason).toContain('secrets.env');
    });

    it('should return undefined for non-secret files', () => {
      expect(getSecretFileReason('package.json')).toBeUndefined();
      expect(getSecretFileReason('index.ts')).toBeUndefined();
    });
  });

  describe('findSecretFiles', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should find secret files in the root directory', async () => {
      vi.mocked(fsPromises.readdir).mockImplementation(((dir: string) => {
        if (dir === '/workspace') {
          return Promise.resolve([
            { name: '.env', isDirectory: () => false, isFile: () => true },
            {
              name: 'package.json',
              isDirectory: () => false,
              isFile: () => true,
            },
            { name: 'src', isDirectory: () => true, isFile: () => false },
          ] as unknown as fs.Dirent[]);
        }
        return Promise.resolve([] as unknown as fs.Dirent[]);
      }) as unknown as typeof fsPromises.readdir);

      const secrets = await findSecretFiles('/workspace');
      expect(secrets).toEqual([path.join('/workspace', '.env')]);
    });

    it('should find multiple secret files', async () => {
      vi.mocked(fsPromises.readdir).mockImplementation(((dir: string) => {
        if (dir === '/workspace') {
          return Promise.resolve([
            { name: '.env', isDirectory: () => false, isFile: () => true },
            {
              name: '.env.local',
              isDirectory: () => false,
              isFile: () => true,
            },
            {
              name: 'secrets.env',
              isDirectory: () => false,
              isFile: () => true,
            },
            {
              name: 'package.json',
              isDirectory: () => false,
              isFile: () => true,
            },
          ] as unknown as fs.Dirent[]);
        }
        return Promise.resolve([] as unknown as fs.Dirent[]);
      }) as unknown as typeof fsPromises.readdir);

      const secrets = await findSecretFiles('/workspace');
      expect(secrets).toHaveLength(3);
      expect(secrets).toContain(path.join('/workspace', '.env'));
      expect(secrets).toContain(path.join('/workspace', '.env.local'));
      expect(secrets).toContain(path.join('/workspace', 'secrets.env'));
    });

    it('should NOT scan deeper than maxDepth (shallow by default)', async () => {
      vi.mocked(fsPromises.readdir).mockImplementation(((dir: string) => {
        if (dir === '/workspace') {
          return Promise.resolve([
            { name: '.env', isDirectory: () => false, isFile: () => true },
            {
              name: 'packages',
              isDirectory: () => true,
              isFile: () => false,
            },
          ] as unknown as fs.Dirent[]);
        }
        if (dir === path.join('/workspace', 'packages')) {
          return Promise.resolve([
            {
              name: '.env.local',
              isDirectory: () => false,
              isFile: () => true,
            },
          ] as unknown as fs.Dirent[]);
        }
        return Promise.resolve([] as unknown as fs.Dirent[]);
      }) as unknown as typeof fsPromises.readdir);

      const secrets = await findSecretFiles('/workspace');
      expect(secrets).toEqual([path.join('/workspace', '.env')]);
      // Should NOT have scanned subdirectory with default maxDepth=1
      expect(fsPromises.readdir).toHaveBeenCalledTimes(1);
    });

    it('should skip node_modules and .git directories', async () => {
      vi.mocked(fsPromises.readdir).mockImplementation(((dir: string) => {
        if (dir === '/workspace') {
          return Promise.resolve([
            {
              name: 'node_modules',
              isDirectory: () => true,
              isFile: () => false,
            },
            { name: '.git', isDirectory: () => true, isFile: () => false },
            { name: 'src', isDirectory: () => true, isFile: () => false },
          ] as unknown as fs.Dirent[]);
        }
        return Promise.resolve([] as unknown as fs.Dirent[]);
      }) as unknown as typeof fsPromises.readdir);

      const secrets = await findSecretFiles('/workspace', 3);
      expect(secrets).toEqual([]);
      // Should have scanned /workspace and /workspace/src, but NOT node_modules or .git
      expect(fsPromises.readdir).toHaveBeenCalledTimes(2);
      expect(fsPromises.readdir).not.toHaveBeenCalledWith(
        expect.stringContaining('node_modules'),
        expect.anything(),
      );
      expect(fsPromises.readdir).not.toHaveBeenCalledWith(
        expect.stringContaining('.git'),
        expect.anything(),
      );
    });

    it('should handle read errors gracefully', async () => {
      vi.mocked(fsPromises.readdir).mockRejectedValue(
        new Error('EACCES: permission denied'),
      );

      const secrets = await findSecretFiles('/workspace');
      expect(secrets).toEqual([]);
    });

    it('should not include non-file entries', async () => {
      vi.mocked(fsPromises.readdir).mockImplementation(((dir: string) => {
        if (dir === '/workspace') {
          return Promise.resolve([
            // A directory named .env (unusual but possible)
            { name: '.env', isDirectory: () => true, isFile: () => false },
          ] as unknown as fs.Dirent[]);
        }
        return Promise.resolve([] as unknown as fs.Dirent[]);
      }) as unknown as typeof fsPromises.readdir);

      const secrets = await findSecretFiles('/workspace');
      // Directories named .env should not be listed as secret files
      expect(secrets).toEqual([]);
    });
  });

  describe('getSecretFileFindArgs', () => {
    it('should return valid find arguments', () => {
      const args = getSecretFileFindArgs();
      expect(args[0]).toBe('(');
      expect(args[args.length - 1]).toBe(')');
      expect(args).toContain('-name');
    });

    it('should include patterns for all secret file types', () => {
      const args = getSecretFileFindArgs();
      const argStr = args.join(' ');
      expect(argStr).toContain('.env');
      expect(argStr).toContain('.env.*');
      expect(argStr).toContain('secrets.env');
    });
  });
});
