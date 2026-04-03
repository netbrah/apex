/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SandboxConfig } from '@apex-code/apex-core';

export function createMockSandboxConfig(
  overrides?: Partial<SandboxConfig>,
): SandboxConfig {
  return {
    enabled: true,
    allowedPaths: [],
    networkAccess: false,
    ...overrides,
  };
}
