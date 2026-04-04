/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { canUseFd, ensureFdPath, resetFdState } from './getFd.js';
import { Storage } from '../config/storage.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

// Mock the fetch global to prevent real network calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const originalGetGlobalBinDir = Storage.getGlobalBinDir.bind(Storage);
const storageSpy = vi.spyOn(Storage, 'getGlobalBinDir');

describe('getFd', () => {
  let tempDir: string;
  let binDir: string;

  beforeEach(async () => {
    // Reset fd cached state between tests
    resetFdState();
    mockFetch.mockReset();
    mockFetch.mockRejectedValue(new Error('Network error'));

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'getfd-test-'));
    binDir = path.join(tempDir, 'bin');
    await fs.mkdir(binDir, { recursive: true });
    // Redirect getGlobalBinDir to our test-specific temp dir
    storageSpy.mockImplementation(() => binDir);
  });

  afterEach(async () => {
    storageSpy.mockImplementation(() => originalGetGlobalBinDir());
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('canUseFd', () => {
    it('should return true when fd binary exists in bin directory', async () => {
      const fdBinaryName = process.platform === 'win32' ? 'fd.exe' : 'fd';
      const fdPath = path.join(binDir, fdBinaryName);
      await fs.writeFile(fdPath, 'fake-binary');
      await fs.chmod(fdPath, 0o755);

      const result = await canUseFd();
      expect(result).toBe(true);
    });

    it('should return false when fd binary does not exist and download fails', async () => {
      // binDir is empty, fetch is mocked to fail
      const result = await canUseFd();
      expect(result).toBe(false);
    });
  });

  describe('ensureFdPath', () => {
    it('should return path when fd binary exists', async () => {
      const fdBinaryName = process.platform === 'win32' ? 'fd.exe' : 'fd';
      const fdPath = path.join(binDir, fdBinaryName);
      await fs.writeFile(fdPath, 'fake-binary');
      await fs.chmod(fdPath, 0o755);

      const result = await ensureFdPath();
      expect(result).toBe(fdPath);
    });

    it('should throw when fd is not available and download fails', async () => {
      // binDir is empty, fetch fails
      await expect(ensureFdPath()).rejects.toThrow('Cannot use fd.');
    });
  });
});
