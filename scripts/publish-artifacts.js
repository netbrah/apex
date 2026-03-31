#!/usr/bin/env node
/**
 * Upload APEX artifacts to Artifactory generic repo.
 *
 * Reads version from package.json so there's nothing to hardcode.
 * Requires VPN + curl with -u palanisd (will prompt for password once,
 * then reuse the netrc/credential cache for subsequent uploads).
 *
 * Usage:
 *   npm run publish:turnkey          # upload SEA binary + launcher + npm tar
 *   node scripts/publish-artifacts.js  # same
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const { version } = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
);
const BASE = `https://generic.repo.eng.netapp.com/user/palanisd/apex/${version}`;

const artifacts = [
  {
    label: 'SEA binary',
    src: '.bin/qwen-code-linux-amd64',
    dest: 'apex-linux-amd64',
  },
  { label: 'Turnkey launcher', src: '.bin/ontap-apex', dest: 'ontap-apex' },
  {
    label: 'npm tarball',
    src: `dist/netapp-seclab-apex-${version}.tgz`,
    dest: `netapp-seclab-apex-${version}.tgz`,
  },
];

console.log(`\nPublishing APEX v${version} to Artifactory\n`);

for (const { label, src, dest } of artifacts) {
  const fullPath = join(root, src);
  if (!existsSync(fullPath)) {
    console.error(`  ✗ ${label} — ${src} not found, skipping`);
    continue;
  }
  const url = `${BASE}/${dest}`;
  console.log(`  ⟳ ${label} → ${url}`);
  try {
    execSync(`curl -f -u palanisd -T "${fullPath}" "${url}"`, {
      stdio: 'inherit',
      cwd: root,
    });
    console.log(`  ✓ ${label}\n`);
  } catch {
    console.error(`  ✗ ${label} — upload failed\n`);
    process.exit(1);
  }
}

console.log(`All artifacts published for v${version}\n`);
