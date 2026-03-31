/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { glob } from 'glob';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const coreVendorDir = join(root, 'packages', 'core', 'vendor');

// Create the dist directory if it doesn't exist
if (!existsSync(distDir)) {
  mkdirSync(distDir);
}

// Find and copy all .sb files from packages to the root of the dist directory
const sbFiles = glob.sync('packages/**/*.sb', { cwd: root });
for (const file of sbFiles) {
  copyFileSync(join(root, file), join(distDir, basename(file)));
}

console.log('Copied sandbox profiles to dist/');

// Copy vendor directory (contains ripgrep binaries)
console.log('Copying vendor directory...');
if (existsSync(coreVendorDir)) {
  const destVendorDir = join(distDir, 'vendor');
  copyRecursiveSync(coreVendorDir, destVendorDir);
  console.log('Copied vendor directory to dist/');
} else {
  console.warn(`Warning: Vendor directory not found at ${coreVendorDir}`);
}

// Copy native tree-sitter bindings sidecar when available.
copyTreeSitterBindings();
copyTreeSitterNodeModulesSidecar();

// Copy bundled skills (e.g. /review) so they are available at runtime.
// In the esbuild bundle, import.meta.url resolves to dist/cli.js, so
// SkillManager looks for bundled skills at dist/bundled/.
const bundledSkillsDir = join(
  root,
  'packages',
  'core',
  'src',
  'skills',
  'bundled',
);
if (existsSync(bundledSkillsDir)) {
  const destBundledDir = join(distDir, 'bundled');
  copyRecursiveSync(bundledSkillsDir, destBundledDir);
  console.log('Copied bundled skills to dist/bundled/');
} else {
  console.warn(
    `Warning: Bundled skills directory not found at ${bundledSkillsDir}`,
  );
}

// Copy APEX persona/config assets if present.
// Skills are sourced only from packages/core/src/skills/bundled.
const apexAssetsDir = join(root, 'apex-assets');
if (existsSync(apexAssetsDir)) {
  const apexDestDir = join(distDir, 'apex');
  mkdirSync(apexDestDir, { recursive: true });
  for (const file of ['APEX.md', 'settings.json']) {
    const src = join(apexAssetsDir, file);
    if (existsSync(src)) {
      copyFileSync(src, join(apexDestDir, file));
      console.log(`Copied ${file} to dist/apex/`);
    }
  }
}

console.log('\n✅ All bundle assets copied to dist/');

/**
 * Copy prebuilt native tree-sitter bindings from OpenGrok sidecar checkout.
 *
 * This enables native AST parsing (including perl) without requiring local
 * native compilation in the qwen-code workspace.
 */
function copyTreeSitterBindings() {
  const sourceBindingsDir = getTreeSitterBindingsSourceDir();
  if (!sourceBindingsDir) {
    console.warn(
      'Warning: tree-sitter bindings source not found. Native parser falls back to regex mode.',
    );
    return;
  }

  const destBindingsDir = join(distDir, 'bindings');
  mkdirSync(destBindingsDir, { recursive: true });

  const platformDirs = [
    'darwin-arm64',
    'darwin-x64',
    'linux-x64',
    'linux-arm64',
    'win32-x64',
    'win32-arm64',
  ];

  let copiedCount = 0;
  for (const platformDir of platformDirs) {
    const src = join(sourceBindingsDir, platformDir);
    if (!existsSync(src)) {
      continue;
    }
    copyRecursiveSync(src, join(destBindingsDir, platformDir));
    copiedCount++;
  }

  if (copiedCount === 0) {
    console.warn(
      `Warning: no platform binding directories found in ${sourceBindingsDir}`,
    );
    return;
  }

  console.log(
    `Copied tree-sitter bindings for ${copiedCount} platform(s) from ${sourceBindingsDir}`,
  );
}

function getTreeSitterBindingsSourceDir() {
  const home = process.env.HOME || homedir();
  const candidates = [
    process.env.TREE_SITTER_BINDINGS_DIR,
    join(home, 'Projects', 'opengrokmcp', 'vscode-mastra', 'bindings'),
    join(
      home,
      'Projects',
      'agent_tasks',
      'opengrokmcp',
      'vscode-mastra',
      'bindings',
    ),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}

function copyTreeSitterNodeModulesSidecar() {
  const sourceNodeModulesDir = getTreeSitterNodeModulesSourceDir();
  if (!sourceNodeModulesDir) {
    console.warn(
      'Warning: tree-sitter sidecar node_modules not found. Using bindings-only fallback.',
    );
    return;
  }

  const distNodeModulesDir = join(distDir, 'node_modules');
  mkdirSync(distNodeModulesDir, { recursive: true });

  const packageNames = [
    'tree-sitter',
    'tree-sitter-c',
    'tree-sitter-cpp',
    'tree-sitter-python',
    '@ganezdragon/tree-sitter-perl',
    'node-gyp-build',
  ];

  let copied = 0;
  for (const packageName of packageNames) {
    const sourcePath = join(sourceNodeModulesDir, ...packageName.split('/'));
    if (!existsSync(sourcePath)) {
      continue;
    }
    const destPath = join(distNodeModulesDir, ...packageName.split('/'));
    copyRecursiveSync(sourcePath, destPath);
    copied++;
  }

  if (copied > 0) {
    console.log(
      `Copied ${copied} tree-sitter sidecar package(s) from ${sourceNodeModulesDir}`,
    );
  } else {
    console.warn(
      `Warning: tree-sitter sidecar packages not found in ${sourceNodeModulesDir}`,
    );
  }
}

function getTreeSitterNodeModulesSourceDir() {
  const home = process.env.HOME || homedir();
  const candidates = [
    process.env.TREE_SITTER_NODE_MODULES_DIR,
    join(home, 'Projects', 'opengrokmcp', 'node_modules'),
    join(home, 'Projects', 'opengrokmcp', 'vscode-mastra', 'node_modules'),
    join(home, 'Projects', 'agent_tasks', 'opengrokmcp', 'node_modules'),
    join(
      home,
      'Projects',
      'agent_tasks',
      'opengrokmcp',
      'vscode-mastra',
      'node_modules',
    ),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * Recursively copy directory
 */
function copyRecursiveSync(src, dest) {
  if (!existsSync(src)) {
    return;
  }

  const stats = statSync(src);

  if (stats.isDirectory()) {
    if (!existsSync(dest)) {
      mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      // Skip .DS_Store files
      if (entry === '.DS_Store') {
        continue;
      }

      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      copyRecursiveSync(srcPath, destPath);
    }
  } else {
    copyFileSync(src, dest);
    // Preserve execute permissions for binaries
    const srcStats = statSync(src);
    if (srcStats.mode & 0o111) {
      fs.chmodSync(dest, srcStats.mode);
    }
  }
}
