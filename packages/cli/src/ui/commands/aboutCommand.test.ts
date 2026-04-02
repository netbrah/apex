/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { aboutCommand } from './aboutCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import { IdeClient, getVersion } from '@apex-code/apex-core';

vi.mock('@apex-code/apex-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@apex-code/apex-core')>();
  return {
    ...actual,
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        getDetectedIdeDisplayName: vi.fn().mockReturnValue('test-ide'),
      }),
    },
    UserAccountManager: vi.fn().mockImplementation(() => ({
      getCachedGoogleAccount: vi.fn().mockReturnValue('test-email@example.com'),
    })),
    getVersion: vi.fn(),
  };
});

describe('aboutCommand', () => {
  let mockContext: CommandContext;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockContext = createMockCommandContext({
      services: {
        agentContext: {
          config: {
            getModel: vi.fn(),
            getIdeMode: vi.fn().mockReturnValue(true),
            getUserTierName: vi.fn().mockReturnValue(undefined),
          },
        },
        settings: {
          merged: {
            security: {
              auth: {
                selectedType: 'test-auth',
              },
            },
          },
        },
      },
      ui: {
        addItem: vi.fn(),
      },
    } as unknown as CommandContext);

    vi.mocked(getVersion).mockResolvedValue('test-version');
    vi.spyOn(
      mockContext.services.agentContext!.config,
      'getModel',
    ).mockReturnValue('test-model');
    process.env['GOOGLE_CLOUD_PROJECT'] = 'test-gcp-project';
    Object.defineProperty(process, 'platform', {
      value: 'test-os',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('should have the correct name and description', () => {
    expect(aboutCommand.name).toBe('about');
    expect(aboutCommand.description).toBe('Show version info');
  });

  it('should call addItem with all version info', async () => {
    if (!aboutCommand.action) {
      throw new Error('The about command must have an action.');
    }

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith({
      type: MessageType.ABOUT,
      cliVersion: 'test-version',
      osVersion: 'test-os',
      sandboxEnv: 'no sandbox',
      modelVersion: 'test-model',
      selectedAuthType: 'test-auth',
      gcpProject: 'test-gcp-project',
      ideClient: 'test-ide',
      userEmail: 'test-email@example.com',
      tier: undefined,
    });
  });

  it('should show the correct sandbox environment variable', async () => {
    vi.mocked(systemInfoUtils.getExtendedSystemInfo).mockResolvedValue({
      cliVersion: 'test-version',
      osPlatform: 'test-os',
      osArch: 'x64',
      osRelease: '22.0.0',
      nodeVersion: 'v20.0.0',
      npmVersion: '10.0.0',
      sandboxEnv: 'gemini-sandbox',
      modelVersion: 'test-model',
      selectedAuthType: 'test-auth',
      ideClient: 'test-ide',
      sessionId: 'test-session-id',
      memoryUsage: '100 MB',
      baseUrl: undefined,
    });

    if (!aboutCommand.action) {
      throw new Error('The about command must have an action.');
    }

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ABOUT,
        systemInfo: expect.objectContaining({
          sandboxEnv: 'gemini-sandbox',
        }),
      }),
    );
  });

  it('should show sandbox-exec profile when applicable', async () => {
    vi.mocked(systemInfoUtils.getExtendedSystemInfo).mockResolvedValue({
      cliVersion: 'test-version',
      osPlatform: 'test-os',
      osArch: 'x64',
      osRelease: '22.0.0',
      nodeVersion: 'v20.0.0',
      npmVersion: '10.0.0',
      sandboxEnv: 'sandbox-exec (test-profile)',
      modelVersion: 'test-model',
      selectedAuthType: 'test-auth',
      ideClient: 'test-ide',
      sessionId: 'test-session-id',
      memoryUsage: '100 MB',
      baseUrl: undefined,
    });

    if (!aboutCommand.action) {
      throw new Error('The about command must have an action.');
    }

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        systemInfo: expect.objectContaining({
          sandboxEnv: 'sandbox-exec (test-profile)',
        }),
      }),
    );
  });

  it('should not show ide client when it is not detected', async () => {
    vi.mocked(IdeClient.getInstance).mockResolvedValue({
      getDetectedIdeDisplayName: vi.fn().mockReturnValue(undefined),
    } as unknown as IdeClient);

    process.env['SANDBOX'] = '';
    if (!aboutCommand.action) {
      throw new Error('The about command must have an action.');
    }

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ABOUT,
        systemInfo: expect.objectContaining({
          cliVersion: 'test-version',
          osPlatform: 'test-os',
          osArch: 'x64',
          osRelease: '22.0.0',
          nodeVersion: 'v20.0.0',
          npmVersion: '10.0.0',
          sandboxEnv: 'no sandbox',
          modelVersion: 'test-model',
          selectedAuthType: 'test-auth',
          ideClient: '',
          sessionId: 'test-session-id',
          memoryUsage: '100 MB',
          baseUrl: undefined,
        }),
      }),
      expect.any(Number),
    );
  });

  it('should show unknown npmVersion when npm command fails', async () => {
    vi.mocked(systemInfoUtils.getExtendedSystemInfo).mockResolvedValue({
      cliVersion: 'test-version',
      osPlatform: 'test-os',
      osArch: 'x64',
      osRelease: '22.0.0',
      nodeVersion: 'v20.0.0',
      npmVersion: 'unknown',
      sandboxEnv: 'no sandbox',
      modelVersion: 'test-model',
      selectedAuthType: 'test-auth',
      ideClient: 'test-ide',
      sessionId: 'test-session-id',
      memoryUsage: '100 MB',
      baseUrl: undefined,
    });

    if (!aboutCommand.action) {
      throw new Error('The about command must have an action.');
    }

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        systemInfo: expect.objectContaining({
          npmVersion: 'unknown',
        }),
      }),
      expect.any(Number),
    );
  });

  it('should show unknown sessionId when config is not available', async () => {
    vi.mocked(systemInfoUtils.getExtendedSystemInfo).mockResolvedValue({
      cliVersion: 'test-version',
      osPlatform: 'test-os',
      osArch: 'x64',
      osRelease: '22.0.0',
      nodeVersion: 'v20.0.0',
      npmVersion: '10.0.0',
      sandboxEnv: 'no sandbox',
      modelVersion: 'Unknown',
      selectedAuthType: 'test-auth',
      ideClient: '',
      sessionId: 'unknown',
      memoryUsage: '100 MB',
      baseUrl: undefined,
    });

    if (!aboutCommand.action) {
      throw new Error('The about command must have an action.');
    }

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        systemInfo: expect.objectContaining({
          sessionId: 'unknown',
        }),
      }),
    );
  });

  it('should display the tier when getUserTierName returns a value', async () => {
    vi.mocked(
      mockContext.services.agentContext!.config.getUserTierName,
    ).mockReturnValue('Enterprise Tier');
    if (!aboutCommand.action) {
      throw new Error('The about command must have an action.');
    }

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: 'Enterprise Tier',
      }),
    );
  });
});
