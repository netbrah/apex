/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let apexFeatherLogo: string | null = null;
function getFeatherLogo(): string {
  if (apexFeatherLogo === null) {
    try {
      apexFeatherLogo = readFileSync(
        join(__dirname, 'apex-feather.ansi'),
        'utf8',
      );
    } catch {
      apexFeatherLogo = '  🪶 APEX\n';
    }
  }
  return apexFeatherLogo;
}

const qwenAsciiLogo = `
 ▄▄▄▄▄▄  ▄▄     ▄▄ ▄▄▄▄▄▄▄ ▄▄▄    ▄▄
██╔═══██╗██║    ██║██╔════╝████╗  ██║
██║   ██║██║ █╗ ██║█████╗  ██╔██╗ ██║
██║▄▄ ██║██║███╗██║██╔══╝  ██║╚██╗██║
╚██████╔╝╚███╔███╔╝███████╗██║ ╚████║
 ╚══▀▀═╝  ╚══╝╚══╝ ╚══════╝╚═╝  ╚═══╝
`;

const brand = process.env['QWEN_CODE_BRAND'] ?? '';

export const shortAsciiLogo =
  brand === 'APEX' ? getFeatherLogo() : qwenAsciiLogo;
