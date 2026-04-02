/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import path from 'node:path';
import toml from '@iarna/toml';
import { glob } from 'glob';
import { z } from 'zod';
import { Storage, coreEvents, type Config } from '@apex-code/apex-core';
import type { ICommandLoader } from './types.js';
import {
  parseMarkdownCommand,
  MarkdownCommandDefSchema,
} from './markdown-command-parser.js';
import {
  ConfirmationRequiredError,
  ShellProcessor,
} from './prompt-processors/shellProcessor.js';
import { AtFileProcessor } from './prompt-processors/atFileProcessor.js';
import { sanitizeForDisplay } from '../ui/utils/textUtils.js';

interface CommandDirectory {
  path: string;
  kind: CommandKind;
  extensionName?: string;
  extensionId?: string;
}

const debugLogger = createDebugLogger('FILE_COMMAND_LOADER');

/**
 * Defines the Zod schema for a command definition file. This serves as the
 * single source of truth for both validation and type inference.
 */
const TomlCommandDefSchema = z.object({
  prompt: z.string({
    required_error: "The 'prompt' field is required.",
    invalid_type_error: "The 'prompt' field must be a string.",
  }),
  description: z.string().optional(),
});

/**
 * Discovers and loads custom slash commands from .toml files in both the
 * user's global config directory and the current project's directory.
 *
 * This loader is responsible for:
 * - Recursively scanning command directories.
 * - Parsing and validating TOML files.
 * - Adapting valid definitions into executable SlashCommand objects.
 * - Handling file system errors and malformed files gracefully.
 */
export class FileCommandLoader implements ICommandLoader {
  private readonly projectRoot: string;
  private readonly folderTrustEnabled: boolean;
  private readonly isTrustedFolder: boolean;

  constructor(private readonly config: Config | null) {
    this.folderTrustEnabled = !!config?.getFolderTrust();
    this.isTrustedFolder = !!config?.isTrustedFolder();
    this.projectRoot = config?.getProjectRoot() || process.cwd();
  }

  /**
   * Loads all commands from user, project, and extension directories.
   * Returns commands in order: user → project → extensions (alphabetically).
   *
   * Order is important for conflict resolution in CommandService:
   * - User/project commands (without extensionName) use "last wins" strategy
   * - Extension commands (with extensionName) get renamed if conflicts exist
   *
   * @param signal An AbortSignal to cancel the loading process.
   * @returns A promise that resolves to an array of all loaded SlashCommands.
   */
  async loadCommands(signal: AbortSignal): Promise<SlashCommand[]> {
    if (this.folderTrustEnabled && !this.isTrustedFolder) {
      return [];
    }

    const allCommands: SlashCommand[] = [];
    const globOptions = {
      nodir: true,
      dot: true,
      signal,
      follow: true,
    };

    // Load commands from each directory
    const commandDirs = this.getCommandDirectories();
    for (const dirInfo of commandDirs) {
      try {
        // Scan both .toml and .md files
        const tomlFiles = await glob('**/*.toml', {
          ...globOptions,
          cwd: dirInfo.path,
        });
        const mdFiles = await glob('**/*.md', {
          ...globOptions,
          cwd: dirInfo.path,
        });

        if (this.folderTrustEnabled && !this.folderTrust) {
          return [];
        }

        // Process TOML files
        const tomlCommandPromises = tomlFiles.map((file) =>
          this.parseAndAdaptTomlFile(
            path.join(dirInfo.path, file),
            dirInfo.path,
            dirInfo.kind,
            dirInfo.extensionName,
            dirInfo.extensionId,
          ),
        );

        // Process Markdown files
        const mdCommandPromises = mdFiles.map((file) =>
          this.parseAndAdaptMarkdownFile(
            path.join(dirInfo.path, file),
            dirInfo.path,
            dirInfo.extensionName,
          ),
        );

        const commands = (
          await Promise.all([...tomlCommandPromises, ...mdCommandPromises])
        ).filter((cmd): cmd is SlashCommand => cmd !== null);

        // Add all commands without deduplication
        allCommands.push(...commands);
      } catch (error) {
        if (
          !signal.aborted &&
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          (error as { code?: string })?.code !== 'ENOENT'
        ) {
          coreEvents.emitFeedback(
            'error',
            `[FileCommandLoader] Error loading commands from ${dirInfo.path}:`,
            error,
          );
        }
      }
    }

    return allCommands;
  }

  /**
   * Get all command directories in order for loading.
   * User commands → Project commands → Extension commands
   * This order ensures extension commands can detect all conflicts.
   */
  private getCommandDirectories(): CommandDirectory[] {
    const dirs: CommandDirectory[] = [];

    const storage = this.config?.storage ?? new Storage(this.projectRoot);

    // 1. User commands
    dirs.push({
      path: Storage.getUserCommandsDir(),
      kind: CommandKind.USER_FILE,
    });

    // 2. Project commands
    dirs.push({
      path: storage.getProjectCommandsDir(),
      kind: CommandKind.WORKSPACE_FILE,
    });

    // 3. Extension commands (processed last to detect all conflicts)
    if (this.config) {
      const activeExtensions = this.config
        .getExtensions()
        .filter((ext) => ext.isActive)
        .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically for deterministic loading

      const extensionCommandDirs = activeExtensions.map((ext) => ({
        path: path.join(ext.path, 'commands'),
        kind: CommandKind.EXTENSION_FILE,
        extensionName: ext.name,
        extensionId: ext.id,
      }));

        for (const cmdPath of commandsPaths) {
          dirs.push({
            path: cmdPath,
            extensionName: ext.name,
          });
        }
      }
    }

    return dirs;
  }

  /**
   * Get commands paths from an extension.
   * Returns paths from config.commands if specified, otherwise defaults to 'commands' directory.
   */
  private getExtensionCommandsPaths(ext: {
    path: string;
    name: string;
  }): string[] {
    // Try to get extension config
    try {
      const configPath = path.join(ext.path, EXTENSIONS_CONFIG_FILENAME);
      if (fsSync.existsSync(configPath)) {
        const configContent = fsSync.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);

        if (config.commands) {
          const commandsArray = Array.isArray(config.commands)
            ? config.commands
            : [config.commands];

          return commandsArray
            .map((cmdPath: string) =>
              path.isAbsolute(cmdPath) ? cmdPath : path.join(ext.path, cmdPath),
            )
            .filter((cmdPath: string) => {
              try {
                return fsSync.existsSync(cmdPath);
              } catch {
                return false;
              }
            });
        }
      }
    } catch (error) {
      debugLogger.warn(
        `Failed to read extension config for ${ext.name}:`,
        error,
      );
    }

    // Default fallback: use 'commands' directory
    const defaultPath = path.join(ext.path, 'commands');
    try {
      if (fsSync.existsSync(defaultPath)) {
        return [defaultPath];
      }
    } catch {
      // Ignore
    }

    return [];
  }

  /**
   * Parses a single .toml file and transforms it into a SlashCommand object.
   * @param filePath The absolute path to the .toml file.
   * @param baseDir The root command directory for name calculation.
   * @param kind The CommandKind.
   * @param extensionName Optional extension name to prefix commands with.
   * @returns A promise resolving to a SlashCommand, or null if the file is invalid.
   */
  private async parseAndAdaptTomlFile(
    filePath: string,
    baseDir: string,
    kind: CommandKind,
    extensionName?: string,
    extensionId?: string,
  ): Promise<SlashCommand | null> {
    let fileContent: string;
    try {
      fileContent = await fs.readFile(filePath, 'utf-8');
    } catch (error: unknown) {
      coreEvents.emitFeedback(
        'error',
        `[FileCommandLoader] Failed to read file ${filePath}:`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }

    let parsed: unknown;
    try {
      parsed = toml.parse(fileContent);
    } catch (error: unknown) {
      coreEvents.emitFeedback(
        'error',
        `[FileCommandLoader] Failed to parse TOML file ${filePath}:`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }

    const validationResult = TomlCommandDefSchema.safeParse(parsed);

    if (!validationResult.success) {
      coreEvents.emitFeedback(
        'error',
        `[FileCommandLoader] Skipping invalid command file: ${filePath}. Validation errors:`,
        validationResult.error.flatten(),
      );
      return null;
    }

    const validDef = validationResult.data;

    const relativePathWithExt = path.relative(baseDir, filePath);
    const relativePath = relativePathWithExt.substring(
      0,
      relativePathWithExt.length - 5, // length of '.toml'
    );
    const baseCommandName = relativePath
      .split(path.sep)
      // Sanitize each path segment to prevent ambiguity, replacing non-allowlisted characters with underscores.
      // Since ':' is our namespace separator, this ensures that colons do not cause naming conflicts.
      .map((segment) => {
        let sanitized = segment.replace(/[^a-zA-Z0-9_\-.]/g, '_');

        // Truncate excessively long segments to prevent UI overflow
        if (sanitized.length > 50) {
          sanitized = sanitized.substring(0, 47) + '...';
        }
        return sanitized;
      })
      .join(':');

    // Add extension name tag for extension commands
    const defaultDescription = `Custom command from ${path.basename(filePath)}`;
    let description = validDef.description || defaultDescription;

    description = sanitizeForDisplay(description, 100);

    if (extensionName) {
      description = `[${extensionName}] ${description}`;
    }

    const processors: IPromptProcessor[] = [];
    const usesArgs = validDef.prompt.includes(SHORTHAND_ARGS_PLACEHOLDER);
    const usesShellInjection = validDef.prompt.includes(
      SHELL_INJECTION_TRIGGER,
    );
    const usesAtFileInjection = validDef.prompt.includes(
      AT_FILE_INJECTION_TRIGGER,
    );

    // 1. @-File Injection (Security First).
    // This runs first to ensure we're not executing shell commands that
    // could dynamically generate malicious @-paths.
    if (usesAtFileInjection) {
      processors.push(new AtFileProcessor(baseCommandName));
    }

    // 2. Argument and Shell Injection.
    // This runs after file content has been safely injected.
    if (usesShellInjection || usesArgs) {
      processors.push(new ShellProcessor(baseCommandName));
    }

    // 3. Default Argument Handling.
    // Appends the raw invocation if no explicit {{args}} are used.
    if (!usesArgs) {
      processors.push(new DefaultArgumentProcessor());
    }

    return {
      name: baseCommandName,
      description,
      kind,
      extensionName,
      extensionId,
      action: async (
        context: CommandContext,
        _args: string,
      ): Promise<SlashCommandActionReturn> => {
        if (!context.invocation) {
          coreEvents.emitFeedback(
            'error',
            `[FileCommandLoader] Critical error: Command '${baseCommandName}' was executed without invocation context.`,
          );
          return {
            type: 'submit_prompt',
            content: [{ text: validDef.prompt }], // Fallback to unprocessed prompt
          };
        }

  /**
   * Parses a single .md file and transforms it into a SlashCommand object.
   * @param filePath The absolute path to the .md file.
   * @param baseDir The root command directory for name calculation.
   * @param extensionName Optional extension name to prefix commands with.
   * @returns A promise resolving to a SlashCommand, or null if the file is invalid.
   */
  private async parseAndAdaptMarkdownFile(
    filePath: string,
    baseDir: string,
    extensionName?: string,
  ): Promise<SlashCommand | null> {
    let fileContent: string;
    try {
      fileContent = await fs.readFile(filePath, 'utf-8');
    } catch (error: unknown) {
      debugLogger.error(
        `[FileCommandLoader] Failed to read file ${filePath}:`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }

    let parsed: ReturnType<typeof parseMarkdownCommand>;
    try {
      parsed = parseMarkdownCommand(fileContent);
    } catch (error: unknown) {
      debugLogger.error(
        `[FileCommandLoader] Failed to parse Markdown file ${filePath}:`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }

    const validationResult = MarkdownCommandDefSchema.safeParse(parsed);

    if (!validationResult.success) {
      debugLogger.error(
        `[FileCommandLoader] Skipping invalid command file: ${filePath}. Validation errors:`,
        validationResult.error.flatten(),
      );
      return null;
    }

    const validDef = validationResult.data;

    // Convert to CommandDefinition format
    const definition: CommandDefinition = {
      prompt: validDef.prompt,
      description:
        validDef.frontmatter?.description &&
        typeof validDef.frontmatter.description === 'string'
          ? validDef.frontmatter.description
          : undefined,
    };

    // Use factory to create command
    return createSlashCommandFromDefinition(
      filePath,
      baseDir,
      definition,
      extensionName,
      '.md',
    );
  }
}
