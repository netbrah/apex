#!/usr/bin/env node
/**
 * postinstall script for @netapp/seclab-apex
 *
 * Downloads MCP server binaries to ~/.apex/bin/ if not already cached.
 * Same artifacts and layout as the turnkey ontap-apex launcher.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const APEX_HOME = process.env.APEX_HOME || join(homedir(), '.apex');
const BIN_DIR = join(APEX_HOME, 'bin');
const BASE_URL = 'https://generic.repo.eng.netapp.com/user/palanisd';

const artifacts = [
  {
    name: 'mastra-search-mcp',
    version: process.env.MASTRA_VERSION || 'latest',
    get url() {
      return `${BASE_URL}/mastra-search-mcp/${this.version}/mastra-search-mcp-linux-amd64.tar.gz`;
    },
    get dir() {
      return join(BIN_DIR, `mastra-search-mcp-${this.version}`);
    },
    get check() {
      return join(this.dir, 'mastra-search-mcp');
    },
    isTar: true,
  },
  {
    name: 'reviewboard-mcp',
    version: process.env.RB_VERSION || 'latest',
    get url() {
      return `${BASE_URL}/reviewboard-mcp/${this.version}/reviewboard-mcp.tar.gz`;
    },
    get dir() {
      return join(BIN_DIR, `reviewboard-mcp-${this.version}`);
    },
    get check() {
      return join(this.dir, 'index.js');
    },
    isTar: true,
  },
  {
    name: 'cit-mcp',
    version: process.env.CIT_VERSION || 'latest',
    get url() {
      return `${BASE_URL}/cit-mcp/${this.version}/cit-mcp-linux-amd64`;
    },
    get dest() {
      return join(BIN_DIR, `cit-mcp-${this.version}`);
    },
    get check() {
      return this.dest;
    },
    isTar: false,
  },
];

function download(url, dest, isTar) {
  const destDir = isTar ? dest : join(dest, '..');
  mkdirSync(destDir, { recursive: true });
  const tmp = join(destDir, '_download.tmp');
  try {
    execSync(`curl -fSL -o "${tmp}" "${url}"`, { stdio: 'pipe' });
    if (isTar) {
      mkdirSync(dest, { recursive: true });
      execSync(`tar xzf "${tmp}" -C "${dest}"`, { stdio: 'pipe' });
      rmSync(tmp, { force: true });
    } else {
      chmodSync(tmp, 0o755);
      renameSync(tmp, dest);
    }
    return true;
  } catch (_e) {
    rmSync(tmp, { force: true });
    return false;
  }
}

console.log('\n  APEX postinstall — checking MCP servers...\n');
mkdirSync(BIN_DIR, { recursive: true });

let downloaded = 0;
for (const art of artifacts) {
  if (existsSync(art.check)) {
    console.log(`  ✓ ${art.name} (cached)`);
    continue;
  }
  process.stdout.write(`  ⟳ ${art.name}...`);
  const target = art.isTar ? art.dir : art.dest;
  if (download(art.url, target, art.isTar)) {
    if (art.isTar && existsSync(art.check)) {
      chmodSync(art.check, 0o755);
    }
    console.log(' ✓');
    downloaded++;
  } else {
    console.log(' ✗ (failed — MCP server will be unavailable)');
  }
}

if (downloaded > 0) {
  console.log(`\n  Downloaded ${downloaded} MCP server(s) to ${BIN_DIR}\n`);
} else {
  console.log('\n  All MCP servers cached.\n');
}
