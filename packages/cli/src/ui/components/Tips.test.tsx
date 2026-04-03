/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '../../test-utils/render.js';
import { Tips } from './Tips.js';
import { describe, it, expect, vi } from 'vitest';
import type { Config } from '@apex-code/apex-core';

describe('Tips', () => {
  it.each([
    { fileCount: 0, description: 'renders all tips including APEX.md tip' },
    { fileCount: 5, description: 'renders fewer tips when APEX.md exists' },
  ])('$description', async ({ fileCount }) => {
    const config = {
      getGeminiMdFileCount: vi.fn().mockReturnValue(fileCount),
    } as unknown as Config;

    const { lastFrame, unmount } = await render(<Tips config={config} />);
    expect(lastFrame()).toMatchSnapshot();
    unmount();
  });
});
