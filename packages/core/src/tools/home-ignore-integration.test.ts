/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests that verify both rg (ripgrep) and fd honor .ignore files,
 * including project-level .ignore and ~/.ignore (home-directory global ignore).
 *
 * Both tools natively read .ignore files in the search directory. For the
 * global ~/.ignore, APEX explicitly passes --ignore-file ~/.ignore.
 *
 * These tests spawn real rg/fd binaries to verify end-to-end behavior.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

/**
 * Helper: spawn a process and collect stdout lines.
 */
function spawnCollect(
  cmd: string,
  args: string[],
): Promise<{ stdout: string[]; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let buffer = '';
    const lines: string[] = [];

    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed) lines.push(trimmed);
      }
    });

    child.on('error', reject);
    child.on('close', (exitCode) => {
      if (buffer.trim()) lines.push(buffer.trim());
      resolve({ stdout: lines, exitCode });
    });
  });
}

/**
 * Resolve a binary from the managed bin directory or PATH.
 */
async function resolveBinary(name: string): Promise<string | null> {
  const managedPath = path.join(os.homedir(), '.apex', 'tmp', 'bin', name);
  try {
    await fs.access(managedPath, fs.constants.X_OK);
    return managedPath;
  } catch {
    // Not in managed dir
  }

  try {
    const result = await spawnCollect(name, ['--version']);
    if (result.exitCode === 0) return name;
  } catch {
    // Not on PATH
  }

  // On Debian/Ubuntu, fd is packaged as 'fdfind' to avoid a name conflict
  // with the fdclone package. Check that alternative name too.
  if (name === 'fd') {
    try {
      const result = await spawnCollect('fdfind', ['--version']);
      if (result.exitCode === 0) return 'fdfind';
    } catch {
      // Not available
    }
  }

  return null;
}

describe('.ignore file integration tests', () => {
  let projectDir: string;
  let homeIgnoreDir: string;
  let homeIgnorePath: string;
  let rgBin: string | null;
  let fdBin: string | null;

  beforeAll(async () => {
    rgBin = await resolveBinary('rg');
    fdBin = await resolveBinary('fd');

    // --- Project-level .ignore setup ---
    projectDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ignore-integration-'),
    );

    await fs.writeFile(
      path.join(projectDir, '.ignore'),
      '*.proj-ignored\nproject-build/\n',
    );

    await fs.writeFile(path.join(projectDir, 'visible.txt'), 'hello world');
    await fs.writeFile(
      path.join(projectDir, 'secret.proj-ignored'),
      'excluded by project .ignore',
    );
    await fs.writeFile(path.join(projectDir, 'readme.md'), 'documentation');
    await fs.mkdir(path.join(projectDir, 'project-build'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'project-build', 'output.js'),
      'compiled',
    );
    await fs.mkdir(path.join(projectDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'src', 'main.ts'), 'source code');

    // --- Home-level ~/.ignore setup (separate dir for --ignore-file test) ---
    homeIgnoreDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'home-ignore-test-'),
    );
    homeIgnorePath = path.join(homeIgnoreDir, '.ignore');
    await fs.writeFile(homeIgnorePath, '*.home-ignored\nhome-excluded/\n');

    // Files that match ~/.ignore patterns (in the project dir)
    await fs.writeFile(
      path.join(projectDir, 'data.home-ignored'),
      'excluded by home ignore',
    );
    await fs.mkdir(path.join(projectDir, 'home-excluded'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'home-excluded', 'deep.txt'),
      'deep',
    );
  });

  afterAll(async () => {
    if (projectDir) {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
    if (homeIgnoreDir) {
      await fs.rm(homeIgnoreDir, { recursive: true, force: true });
    }
  });

  describe('rg: project-level .ignore', () => {
    it('should exclude files matching .ignore patterns by default', async () => {
      if (!rgBin) return;
      const result = await spawnCollect(rgBin, ['--files', projectDir]);
      const files = result.stdout.map((f) => path.basename(f));

      expect(files).toContain('visible.txt');
      expect(files).toContain('readme.md');
      expect(files).toContain('main.ts');
      expect(files).not.toContain('secret.proj-ignored');
      expect(files).not.toContain('output.js');
    });

    it('should include excluded files when --no-ignore is passed', async () => {
      if (!rgBin) return;
      const result = await spawnCollect(rgBin, [
        '--files',
        '--no-ignore',
        projectDir,
      ]);
      const files = result.stdout.map((f) => path.basename(f));

      expect(files).toContain('visible.txt');
      expect(files).toContain('secret.proj-ignored');
      expect(files).toContain('output.js');
    });

    it('should still honor .ignore when --no-ignore-vcs is used', async () => {
      if (!rgBin) return;
      const result = await spawnCollect(rgBin, [
        '--files',
        '--no-ignore-vcs',
        projectDir,
      ]);
      const files = result.stdout.map((f) => path.basename(f));

      expect(files).not.toContain('secret.proj-ignored');
      expect(files).not.toContain('output.js');
      expect(files).toContain('visible.txt');
    });
  });

  describe('rg: ~/.ignore via --ignore-file', () => {
    it('should exclude files matching ~/.ignore when passed via --ignore-file', async () => {
      if (!rgBin) return;
      const result = await spawnCollect(rgBin, [
        '--files',
        '--ignore-file',
        homeIgnorePath,
        projectDir,
      ]);
      const files = result.stdout.map((f) => path.basename(f));

      // Project .ignore still honored
      expect(files).not.toContain('secret.proj-ignored');
      // Home .ignore also honored
      expect(files).not.toContain('data.home-ignored');
      expect(files).not.toContain('deep.txt');
      // Visible files present
      expect(files).toContain('visible.txt');
      expect(files).toContain('readme.md');
    });

    it('should not exclude home-ignored files without --ignore-file', async () => {
      if (!rgBin) return;
      const result = await spawnCollect(rgBin, ['--files', projectDir]);
      const files = result.stdout.map((f) => path.basename(f));

      // Without --ignore-file, home .ignore patterns are NOT applied
      expect(files).toContain('data.home-ignored');
      expect(files).toContain('deep.txt');
    });
  });

  describe('fd: project-level .ignore', () => {
    it('should exclude files matching .ignore patterns by default', async () => {
      if (!fdBin) return;
      const result = await spawnCollect(fdBin, [
        '--type',
        'f',
        '.',
        projectDir,
      ]);
      const files = result.stdout.map((f) => path.basename(f));

      expect(files).toContain('visible.txt');
      expect(files).toContain('readme.md');
      expect(files).toContain('main.ts');
      expect(files).not.toContain('secret.proj-ignored');
      expect(files).not.toContain('output.js');
    });

    it('should include excluded files when --no-ignore is passed', async () => {
      if (!fdBin) return;
      const result = await spawnCollect(fdBin, [
        '--type',
        'f',
        '--no-ignore',
        '.',
        projectDir,
      ]);
      const files = result.stdout.map((f) => path.basename(f));

      expect(files).toContain('visible.txt');
      expect(files).toContain('secret.proj-ignored');
      expect(files).toContain('output.js');
    });

    it('should still honor .ignore when --no-ignore-vcs is used', async () => {
      if (!fdBin) return;
      const result = await spawnCollect(fdBin, [
        '--type',
        'f',
        '--no-ignore-vcs',
        '.',
        projectDir,
      ]);
      const files = result.stdout.map((f) => path.basename(f));

      expect(files).not.toContain('secret.proj-ignored');
      expect(files).not.toContain('output.js');
      expect(files).toContain('visible.txt');
    });
  });

  describe('fd: ~/.ignore via --ignore-file', () => {
    it('should exclude files matching ~/.ignore when passed via --ignore-file', async () => {
      if (!fdBin) return;
      const result = await spawnCollect(fdBin, [
        '--type',
        'f',
        '--ignore-file',
        homeIgnorePath,
        '.',
        projectDir,
      ]);
      const files = result.stdout.map((f) => path.basename(f));

      // Project .ignore still honored
      expect(files).not.toContain('secret.proj-ignored');
      // Home .ignore also honored
      expect(files).not.toContain('data.home-ignored');
      expect(files).not.toContain('deep.txt');
      // Visible files present
      expect(files).toContain('visible.txt');
      expect(files).toContain('readme.md');
    });

    it('should not exclude home-ignored files without --ignore-file', async () => {
      if (!fdBin) return;
      const result = await spawnCollect(fdBin, [
        '--type',
        'f',
        '.',
        projectDir,
      ]);
      const files = result.stdout.map((f) => path.basename(f));

      // Without --ignore-file, home .ignore patterns are NOT applied
      expect(files).toContain('data.home-ignored');
      expect(files).toContain('deep.txt');
    });

    it('should honor ~/.ignore in --glob mode (as used by APEX glob tool)', async () => {
      if (!fdBin) return;
      const result = await spawnCollect(fdBin, [
        '--type',
        'f',
        '--glob',
        '--ignore-file',
        homeIgnorePath,
        '*',
        projectDir,
      ]);
      const files = result.stdout.map((f) => path.basename(f));

      expect(files).toContain('visible.txt');
      expect(files).not.toContain('data.home-ignored');
      expect(files).not.toContain('secret.proj-ignored');
    });
  });

  describe('cross-tool consistency', () => {
    it('rg and fd should agree on exclusions with --ignore-file', async () => {
      if (!rgBin || !fdBin) return;
      const rgResult = await spawnCollect(rgBin, [
        '--files',
        '--ignore-file',
        homeIgnorePath,
        projectDir,
      ]);
      const fdResult = await spawnCollect(fdBin, [
        '--type',
        'f',
        '--ignore-file',
        homeIgnorePath,
        '.',
        projectDir,
      ]);

      const rgFiles = new Set(rgResult.stdout.map((f) => path.basename(f)));
      const fdFiles = new Set(fdResult.stdout.map((f) => path.basename(f)));

      expect(rgFiles).toEqual(fdFiles);

      // Neither should include ignored files
      for (const excluded of [
        'secret.proj-ignored',
        'data.home-ignored',
        'output.js',
        'deep.txt',
      ]) {
        expect(rgFiles.has(excluded)).toBe(false);
        expect(fdFiles.has(excluded)).toBe(false);
      }
    });
  });
});
