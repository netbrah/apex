/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as child_process from 'node:child_process';
import * as process from 'node:process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { IDE_DEFINITIONS, type IdeInfo } from './detect-ide.js';
import { APEX_COMPANION_EXTENSION_NAME } from './constants.js';

function getVsCodeCommand(platform: NodeJS.Platform = process.platform) {
  return platform === 'win32' ? 'code.cmd' : 'code';
}

export interface IdeInstaller {
  install(): Promise<InstallResult>;
}

export interface InstallResult {
  success: boolean;
  message: string;
}

async function findVsCodeCommand(
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  // 1. Check PATH first.
  const vscodeCommand = getVsCodeCommand(platform);
  try {
    if (platform === 'win32') {
      const result = child_process
        .execSync(`where.exe ${vscodeCommand}`)
        .toString()
        .trim();
      // `where.exe` can return multiple paths. Return the first one.
      const firstPath = result.split(/\r?\n/)[0];
      if (firstPath) {
        return firstPath;
      }
    } else {
      child_process.execSync(`command -v ${vscodeCommand}`, {
        stdio: 'ignore',
      });
      return vscodeCommand;
    }
  } catch {
    // Not in PATH, continue to check common locations.
  }

  // 2. Check common installation locations.
  const locations: string[] = [];
  const homeDir = os.homedir();

  if (platform === 'darwin') {
    // macOS
    locations.push(
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      path.join(homeDir, 'Library/Application Support/Code/bin/code'),
    );
  } else if (platform === 'linux') {
    // Linux
    locations.push(
      '/usr/share/code/bin/code',
      '/snap/bin/code',
      path.join(homeDir, '.local/share/code/bin/code'),
    );
  } else if (platform === 'win32') {
    // Windows
    locations.push(
      path.join(
        process.env['ProgramFiles'] || 'C:\\Program Files',
        'Microsoft VS Code',
        'bin',
        'code.cmd',
      ),
      path.join(
        homeDir,
        'AppData',
        'Local',
        'Programs',
        'Microsoft VS Code',
        'bin',
        'code.cmd',
      ),
    );
  }

  for (const location of locations) {
    if (fs.existsSync(location)) {
      return location;
    }
  }

  return null;
}

class VsCodeInstaller implements IdeInstaller {
  private vsCodeCommand: Promise<string | null>;

  constructor(
    readonly ideInfo: IdeInfo,
    readonly platform = process.platform,
  ) {
    this.vsCodeCommand = findVsCodeCommand(platform);
  }

  private findBundledVsix(): string | null {
    const candidates = [
      // Relative to cli.js (npm install / npm link / SEA runtime)
      path.join(
        path.dirname(process.argv[1] || ''),
        'apex-vscode-ide-companion-1.0.0.vsix',
      ),
      // Relative to this file (dev mode)
      path.join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'vscode-ide-companion',
        'apex-vscode-ide-companion-1.0.0.vsix',
      ),
      // APEX_HOME
      path.join(
        process.env['APEX_HOME'] || path.join(os.homedir(), '.apex'),
        'apex-vscode-ide-companion-1.0.0.vsix',
      ),
    ];
    return candidates.find((c) => fs.existsSync(c)) ?? null;
  }

  async install(): Promise<InstallResult> {
    const commandPath = await this.vsCodeCommand;
    if (!commandPath) {
      return {
        success: false,
        message: `${this.ideInfo.displayName} CLI not found. Please ensure 'code' is in your system's PATH. For help, see https://code.visualstudio.com/docs/configure/command-line#_code-is-not-recognized-as-an-internal-or-external-command. You can also install the '${APEX_COMPANION_EXTENSION_NAME}' extension manually from the VS Code marketplace.`,
      };
    }

    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? `"${commandPath}"` : commandPath;

    // Try bundled .vsix first (works offline / behind firewall)
    const vsixPath = this.findBundledVsix();
    if (vsixPath) {
      try {
        const result = child_process.spawnSync(
          cmd,
          ['--install-extension', vsixPath, '--force'],
          { stdio: 'pipe', shell: isWindows },
        );
        if (result.status === 0) {
          return {
            success: true,
            message: `${this.ideInfo.displayName} companion extension was installed successfully.`,
          };
        }
      } catch {
        // Fall through to marketplace install
      }
    }

    // Fall back to marketplace
    try {
      const result = child_process.spawnSync(
        cmd,
        ['--install-extension', 'netapp.apex-vscode-ide-companion', '--force'],
        { stdio: 'pipe', shell: isWindows },
      );

      if (result.status !== 0) {
        throw new Error(
          `Failed to install extension: ${result.stderr?.toString()}`,
        );
      }

      return {
        success: true,
        message: `${this.ideInfo.displayName} companion extension was installed successfully.`,
      };
    } catch (_error) {
      return {
        success: false,
        message: `Failed to install ${this.ideInfo.displayName} companion extension. Please try installing '${APEX_COMPANION_EXTENSION_NAME}' manually from the ${this.ideInfo.displayName} extension marketplace.`,
      };
    }
  }
}

export function getIdeInstaller(
  ide: IdeInfo,
  platform = process.platform,
): IdeInstaller | null {
  switch (ide.name) {
    case IDE_DEFINITIONS.vscode.name:
    case IDE_DEFINITIONS.firebasestudio.name:
      return new VsCodeInstaller(ide, platform);
    default:
      return null;
  }
}
