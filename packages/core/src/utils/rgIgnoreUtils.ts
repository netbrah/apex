/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const USER_RGIGNORE_FILENAME = '.rgignore';

/**
 * Returns the user's global ripgrep ignore file path if it exists.
 */
export function getUserRgIgnorePath(): string | null {
  try {
    const homeDir = os.homedir();
    if (!homeDir) {
      return null;
    }

    const rgIgnorePath = path.join(homeDir, USER_RGIGNORE_FILENAME);
    return fs.existsSync(rgIgnorePath) ? rgIgnorePath : null;
  } catch {
    return null;
  }
}

/**
 * Loads non-empty, non-comment patterns from ~/.rgignore.
 */
export function loadUserRgIgnorePatterns(): string[] {
  const rgIgnorePath = getUserRgIgnorePath();
  if (!rgIgnorePath) {
    return [];
  }

  try {
    return fs
      .readFileSync(rgIgnorePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}
