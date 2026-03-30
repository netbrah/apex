#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 NetApp
 * SPDX-License-Identifier: Apache-2.0
 */

import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, userInfo } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  buildApexRuntimeEnv,
  deriveConfluenceUsername,
  hasCliModelArg,
  trustedFoldersPayload,
} from './apex-launcher-env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apexHome = process.env.APEX_HOME || join(homedir(), '.apex');
const cliEntry = join(__dirname, 'cli.js');

mkdirSync(apexHome, { recursive: true });

const workspace = detectWorkspace(process.cwd());
const runtime = buildApexRuntimeEnv({
  baseEnv: process.env,
  apexHome,
  fileExists: existsSync,
});

if (workspace.root) {
  writeFileSync(
    join(apexHome, 'trustedFolders.json'),
    trustedFoldersPayload(workspace.root),
  );
}

if (!runtime.env.CONFLUENCE_USERNAME) {
  runtime.env.CONFLUENCE_USERNAME = deriveConfluenceUsername(workspace.user);
}

warnMissingMcpEnv(runtime.env, runtime.proxyKey);

const args = process.argv.slice(2);
if (!hasCliModelArg(args)) {
  args.push('--model', runtime.model);
}

const child = spawn(process.execPath, [cliEntry, ...args], {
  stdio: 'inherit',
  env: runtime.env,
});

child.on('error', (error) => {
  console.error(`Failed to launch apex: ${error.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 1);
});

function detectWorkspace(cwd) {
  const root = runCommand('git', ['rev-parse', '--show-toplevel'], cwd);
  const fallbackUser =
    process.env.USER || process.env.USERNAME || safeUserName();
  if (!root) {
    return { root: '', user: fallbackUser, client: '' };
  }

  const gitUser =
    runCommand('git', ['config', 'user.name'], cwd) || fallbackUser;
  return {
    root,
    user: gitUser,
    client: `git:${basename(root)}`,
  };
}

function runCommand(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

function safeUserName() {
  try {
    return userInfo().username;
  } catch {
    return 'unknown';
  }
}

function warnMissingMcpEnv(env, proxyKey) {
  const missing = [];
  if (!env.OPENAI_API_KEY && !proxyKey) {
    missing.push('OPENAI_API_KEY (or APEX_LLM_PROXY_KEY/CODEX_LLM_PROXY_KEY)');
  }
  if (!env.OPENAI_BASE_URL) {
    missing.push('OPENAI_BASE_URL');
  }
  if (!env.NODE_EXTRA_CA_CERTS) {
    missing.push('NODE_EXTRA_CA_CERTS');
  }
  if (!env.JIRA_TOKEN) {
    missing.push('JIRA_TOKEN');
  }
  if (!env.CONFLUENCE_TOKEN) {
    missing.push('CONFLUENCE_TOKEN');
  }
  if (!env.CONFLUENCE_USERNAME) {
    missing.push('CONFLUENCE_USERNAME');
  }
  if (!env.REVIEWBOARD_API_TOKEN) {
    missing.push('REVIEWBOARD_API_TOKEN');
  }

  if (missing.length === 0) {
    return;
  }

  console.error(
    'warning: MCP servers may be partially unavailable; missing env:',
  );
  for (const name of missing) {
    console.error(`  - ${name}`);
  }
}
