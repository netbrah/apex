/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Secret file filtering for sandboxed execution.
 *
 * Detects files that contain secrets or credentials (e.g., .env, secrets.env)
 * and prevents them from being visible during sandboxed tool execution.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Patterns for files that contain sensitive secrets or credentials.
 * These should be completely hidden from sandboxed tool execution.
 */
export interface SecretFilePattern {
  /** Human-readable description of what this pattern catches */
  description: string;
  /** Match type */
  type: 'exact' | 'prefix' | 'suffix';
  /** The pattern string */
  pattern: string;
}

export const SECRET_FILE_PATTERNS: readonly SecretFilePattern[] = [
  { description: '.env file', type: 'exact', pattern: '.env' },
  {
    description: '.env.* variants (e.g., .env.local, .env.production)',
    type: 'prefix',
    pattern: '.env.',
  },
  {
    description: 'secrets.env file',
    type: 'exact',
    pattern: 'secrets.env',
  },
  {
    description: '*.secret files (e.g., db.secret)',
    type: 'suffix',
    pattern: '.secret',
  },
  {
    description: '*.secrets files (e.g., app.secrets)',
    type: 'suffix',
    pattern: '.secrets',
  },
] as const;

/**
 * Checks if a given file name matches any of the secret file patterns.
 * Only checks the basename, not the full path.
 */
export function isSecretFile(fileName: string): boolean {
  const basename = path.basename(fileName);
  return SECRET_FILE_PATTERNS.some((p) => {
    switch (p.type) {
      case 'exact':
        return basename === p.pattern;
      case 'prefix':
        return basename.startsWith(p.pattern);
      case 'suffix':
        return basename.endsWith(p.pattern);
      default:
        return false;
    }
  });
}

/**
 * Returns a human-readable description of why a file was classified as secret.
 * Returns undefined if the file is not secret.
 */
export function getSecretFileReason(fileName: string): string | undefined {
  const basename = path.basename(fileName);
  const match = SECRET_FILE_PATTERNS.find((p) => {
    switch (p.type) {
      case 'exact':
        return basename === p.pattern;
      case 'prefix':
        return basename.startsWith(p.pattern);
      case 'suffix':
        return basename.endsWith(p.pattern);
      default:
        return false;
    }
  });
  return match?.description;
}

/**
 * Directories that are skipped during secret file scanning for performance.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  '__pycache__',
  'dist',
  'build',
  '.next',
  '.idea',
  '.vscode',
  '.svn',
  '.hg',
  'vendor',
  'target',
]);

/**
 * Finds all secret files in a directory up to a certain depth.
 * Default is shallow scan (depth 1) for performance.
 *
 * @param baseDir - Directory to scan
 * @param maxDepth - Maximum recursion depth (1 = only baseDir, 2 = one level of subdirs)
 * @returns Array of absolute paths to secret files
 */
export async function findSecretFiles(
  baseDir: string,
  maxDepth = 1,
): Promise<string[]> {
  const secrets: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) {
            await walk(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          if (isSecretFile(entry.name)) {
            secrets.push(fullPath);
          }
        }
      }
    } catch {
      // Ignore read errors (permission denied, etc.)
    }
  }

  await walk(baseDir, 1);
  return secrets;
}

/**
 * Returns arguments for the Linux `find` command to locate secret files.
 * Useful for OS-level sandbox configuration (e.g., seatbelt, bwrap).
 */
export function getSecretFileFindArgs(): string[] {
  const args: string[] = ['('];
  const namePatterns: string[] = [];

  for (const p of SECRET_FILE_PATTERNS) {
    switch (p.type) {
      case 'exact':
        namePatterns.push(p.pattern);
        break;
      case 'prefix':
        namePatterns.push(`${p.pattern}*`);
        break;
      case 'suffix':
        namePatterns.push(`*${p.pattern}`);
        break;
      default:
        break;
    }
  }

  namePatterns.forEach((pat, i) => {
    if (i > 0) args.push('-o');
    args.push('-name', pat);
  });

  args.push(')');
  return args;
}
