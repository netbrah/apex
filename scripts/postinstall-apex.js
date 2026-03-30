#!/usr/bin/env node
/**
 * postinstall script for @netapp/seclab-apex
 *
 * Downloads MCP server binaries to ~/.apex/bin/ if not already cached.
 * Same artifacts and layout as the turnkey ontap-apex launcher.
 */

import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  chmodSync,
  renameSync,
  rmSync,
  copyFileSync,
  readFileSync,
  writeFileSync as writeFile,
} from 'node:fs';
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

// Deploy settings.json + APEX.md to ~/.apex/ if not already present
const pkgDir = new URL('.', import.meta.url).pathname;
const apexAssetsDir = join(pkgDir, 'apex');

// Deploy APEX.md (straight copy)
{
  const dest = join(APEX_HOME, 'APEX.md');
  const src = join(apexAssetsDir, 'APEX.md');
  if (!existsSync(dest) && existsSync(src)) {
    mkdirSync(APEX_HOME, { recursive: true });
    copyFileSync(src, dest);
    console.log('  ✓ Deployed APEX.md');
  }
}

// Deploy LSP bridge scripts to ~/.apex/bin/
{
  const bridgeFiles = ['ontap_lsp_bridge.py', 'smoke_airlock.py'];
  const bridgeSrc = join(pkgDir, 'bin');
  for (const fname of bridgeFiles) {
    const src = join(bridgeSrc, fname);
    const dest = join(BIN_DIR, fname);
    if (existsSync(src)) {
      mkdirSync(BIN_DIR, { recursive: true });
      copyFileSync(src, dest);
      console.log(`  ✓ Deployed ${fname}`);
    }
  }
}

// Deploy settings.json with MCP binary paths resolved to absolute paths.
// The template uses $RB_INDEX, $MASTRA_BIN, $CIT_BIN, $MASTRA_NODE_PATH which
// the turnkey launcher script exports as env vars before exec. npm installs
// don't have a launcher, so we resolve them here at install time. User tokens
// like $REVIEWBOARD_API_TOKEN stay as env-var references (resolved at runtime).
{
  const settingsDest = join(APEX_HOME, 'settings.json');
  const settingsSrc = join(apexAssetsDir, 'settings.json');
  const mastraV = process.env.MASTRA_VERSION || 'latest';
  const rbV = process.env.RB_VERSION || 'latest';
  const citV = process.env.CIT_VERSION || 'latest';
  const pathVars = {
    MASTRA_BIN: join(
      BIN_DIR,
      `mastra-search-mcp-${mastraV}`,
      'mastra-search-mcp',
    ),
    MASTRA_NODE_PATH: join(
      BIN_DIR,
      `mastra-search-mcp-${mastraV}`,
      'node_modules',
    ),
    RB_INDEX: join(BIN_DIR, `reviewboard-mcp-${rbV}`, 'index.js'),
    CIT_BIN: join(BIN_DIR, `cit-mcp-${citV}`),
  };

  function resolveMcpPaths(raw) {
    for (const [name, resolved] of Object.entries(pathVars)) {
      raw = raw.replaceAll(`$${name}`, resolved);
    }
    return raw;
  }

  if (!existsSync(settingsDest)) {
    // Fresh install — deploy from template
    if (existsSync(settingsSrc)) {
      mkdirSync(APEX_HOME, { recursive: true });
      writeFile(
        settingsDest,
        resolveMcpPaths(readFileSync(settingsSrc, 'utf8')),
      );
      console.log('  ✓ Deployed settings.json (MCP paths resolved)');
    }
  } else {
    // Existing install — fix unresolved $RB_INDEX / $MASTRA_BIN if present
    const existing = readFileSync(settingsDest, 'utf8');
    if (
      existing.includes('"$RB_INDEX"') ||
      existing.includes('"$MASTRA_BIN"') ||
      existing.includes('"$CIT_BIN"')
    ) {
      writeFile(settingsDest, resolveMcpPaths(existing));
      console.log('  ✓ Fixed settings.json (resolved MCP binary paths)');
    }
  }
}

// Skills are loaded from dist/bundled/ by SkillManager at runtime.
// No need to deploy them to ~/.apex/skills/ (avoids exposing SKILL.md files).

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
  console.log(`\n  Downloaded ${downloaded} MCP server(s) to ${BIN_DIR}`);
} else {
  console.log('\n  All MCP servers cached.');
}

// env.sh is no longer needed — settings.json 'env' field auto-derives
// OPENAI_API_KEY, ANTHROPIC_API_KEY, etc. from APEX_LLM_PROXY_KEY at runtime.
// MCP binary paths are resolved at install time in settings.json above.
console.log('\n  Setup: Add to ~/.bashrc:');
console.log('    export APEX_LLM_PROXY_KEY="user=<sso>&key=<key>"');
console.log('  Then run: apex\n');
