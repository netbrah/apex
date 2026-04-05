/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * fd binary acquisition module.
 *
 * Follows the same pattern as ripgrep (see ripGrep.ts):
 * 1. Check for a managed fd binary in the global bin directory
 * 2. If not found, download from GitHub releases
 * 3. Cache the resolved path for subsequent calls
 *
 * fd is the Rust-based `find` alternative by @sharkdp:
 * https://github.com/sharkdp/fd
 */

import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileExists } from '../utils/fileUtils.js';
import { Storage } from '../config/storage.js';
import { debugLogger } from '../utils/debugLogger.js';

const FD_VERSION = 'v10.2.0';
const REPOSITORY = 'sharkdp/fd';

function getFdCandidateFilenames(): readonly string[] {
  return process.platform === 'win32' ? ['fd.exe', 'fd'] : ['fd'];
}

/**
 * Returns platform-specific target string for fd GitHub releases.
 */
function getFdTarget(): string {
  const arch = os.arch();
  const platform = os.platform();

  switch (platform) {
    case 'darwin':
      switch (arch) {
        case 'arm64':
          return 'aarch64-apple-darwin.tar.gz';
        default:
          return 'x86_64-apple-darwin.tar.gz';
      }
    case 'win32':
      switch (arch) {
        case 'x64':
          return 'x86_64-pc-windows-msvc.zip';
        case 'arm64':
          return 'aarch64-pc-windows-msvc.zip';
        default:
          return 'i686-pc-windows-msvc.zip';
      }
    case 'linux':
      switch (arch) {
        case 'x64':
          return 'x86_64-unknown-linux-musl.tar.gz';
        case 'arm64':
          return 'aarch64-unknown-linux-gnu.tar.gz';
        default:
          return 'x86_64-unknown-linux-musl.tar.gz';
      }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Checks the managed bin directory for an existing fd binary.
 */
async function resolveExistingFdPath(): Promise<string | null> {
  const binDir = Storage.getGlobalBinDir();
  for (const fileName of getFdCandidateFilenames()) {
    const candidatePath = path.join(binDir, fileName);
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }
  return null;
}

/**
 * Downloads the fd binary from GitHub releases into the given directory.
 */
async function downloadFd(destDir: string): Promise<void> {
  const target = getFdTarget();
  const fdArchiveName = `fd-${FD_VERSION}-${target}`;
  const url = `https://github.com/${REPOSITORY}/releases/download/${FD_VERSION}/${fdArchiveName}`;

  debugLogger.log(`[getFd] Downloading fd from ${url}`);

  // Create a temporary directory for the download
  const tmpDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'download-fd-'),
  );

  try {
    const archivePath = path.join(tmpDir, fdArchiveName);

    // Download using fetch (Node.js 20+ built-in)
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(
        `Failed to download fd: HTTP ${response.status} ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    await fsPromises.writeFile(archivePath, Buffer.from(arrayBuffer));

    // Ensure destination directory exists
    await fsPromises.mkdir(destDir, { recursive: true });

    // Extract based on archive type
    if (archivePath.endsWith('.tar.gz')) {
      // Extract tar.gz — fd tarballs contain a directory like fd-v10.2.0-x86_64-unknown-linux-musl/
      execFileSync('tar', ['xf', archivePath, '-C', tmpDir], {
        stdio: 'pipe',
      });

      // Find the fd binary inside the extracted directory
      const extractedDirName = fdArchiveName.replace(/\.tar\.gz$/, '');
      const extractedDir = path.join(tmpDir, extractedDirName);
      const fdBinaryName = process.platform === 'win32' ? 'fd.exe' : 'fd';
      const extractedBinary = path.join(extractedDir, fdBinaryName);

      if (fs.existsSync(extractedBinary)) {
        const destPath = path.join(destDir, fdBinaryName);
        await fsPromises.copyFile(extractedBinary, destPath);
        await fsPromises.chmod(destPath, 0o755);
      } else {
        throw new Error(
          `fd binary not found in extracted archive at ${extractedBinary}`,
        );
      }
    } else if (archivePath.endsWith('.zip')) {
      // For Windows zip files, use PowerShell's Expand-Archive
      execFileSync(
        'powershell',
        [
          '-Command',
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force`,
        ],
        { stdio: 'pipe' },
      );

      const extractedDirName = fdArchiveName.replace(/\.zip$/, '');
      const extractedDir = path.join(tmpDir, extractedDirName);
      const extractedBinary = path.join(extractedDir, 'fd.exe');

      if (fs.existsSync(extractedBinary)) {
        const destPath = path.join(destDir, 'fd.exe');
        await fsPromises.copyFile(extractedBinary, destPath);
      } else {
        throw new Error(
          `fd.exe not found in extracted archive at ${extractedBinary}`,
        );
      }
    } else {
      throw new Error(`Unsupported archive format: ${archivePath}`);
    }

    debugLogger.log(`[getFd] Successfully installed fd to ${destDir}`);
  } finally {
    // Clean up temp directory
    await fsPromises
      .rm(tmpDir, { recursive: true, force: true })
      .catch(() => {});
  }
}

let fdAcquisitionPromise: Promise<string | null> | null = null;

/**
 * Ensures an fd binary is available.
 *
 * Resolution order:
 * 1. Check managed bin directory (Storage.getGlobalBinDir())
 * 2. If not found, download from GitHub releases
 *
 * This follows the same pattern as ensureRipgrepAvailable() in ripGrep.ts.
 */
async function ensureFdAvailable(): Promise<string | null> {
  const existingPath = await resolveExistingFdPath();
  if (existingPath) {
    return existingPath;
  }
  if (!fdAcquisitionPromise) {
    fdAcquisitionPromise = (async () => {
      try {
        await downloadFd(Storage.getGlobalBinDir());
        return await resolveExistingFdPath();
      } catch (error) {
        debugLogger.log(`[getFd] Download failed: ${error}`);
        return null;
      } finally {
        fdAcquisitionPromise = null;
      }
    })();
  }
  return fdAcquisitionPromise;
}

/**
 * Checks if fd is available (managed binary or downloadable).
 */
export async function canUseFd(): Promise<boolean> {
  return (await ensureFdAvailable()) !== null;
}

/**
 * Returns the path to the fd binary, or throws if not available.
 */
export async function ensureFdPath(): Promise<string> {
  const resolvedPath = await ensureFdAvailable();
  if (resolvedPath) {
    return resolvedPath;
  }
  throw new Error('Cannot use fd.');
}

/**
 * Resets the fd acquisition promise. Used for testing.
 */
export function resetFdState(): void {
  fdAcquisitionPromise = null;
}
