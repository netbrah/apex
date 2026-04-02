/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import fs from 'node:fs';
import path from 'node:path';
import { glob, escape } from 'glob';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
  type PolicyUpdateOptions,
  type ToolConfirmationOutcome,
} from './tools.js';
import { shortenPath, makeRelative } from '../utils/paths.js';
import { type Config } from '../config/config.js';
import { DEFAULT_FILE_FILTERING_OPTIONS } from '../config/constants.js';
import { ToolErrorType } from './tool-error.js';
import { GLOB_TOOL_NAME, GLOB_DISPLAY_NAME } from './tool-names.js';
import { buildPatternArgsPattern } from '../policy/utils.js';
import { getErrorMessage } from '../utils/errors.js';
import { debugLogger } from '../utils/debugLogger.js';
import { GLOB_DEFINITION } from './definitions/coreTools.js';
import { resolveToolDeclaration } from './definitions/resolver.js';

// Subset of 'Path' interface provided by 'glob' that we can implement for testing
export interface GlobPath {
  fullpath(): string;
  mtimeMs?: number;
}

/**
 * Sorts file entries based on recency and then alphabetically.
 * Recent files (modified within recencyThresholdMs) are listed first, newest to oldest.
 * Older files are listed after recent ones, sorted alphabetically by path.
 */
export function sortFileEntries(
  entries: GlobPath[],
  nowTimestamp: number,
  recencyThresholdMs: number,
): GlobPath[] {
  const sortedEntries = [...entries];
  sortedEntries.sort((a, b) => {
    const mtimeA = a.mtimeMs ?? 0;
    const mtimeB = b.mtimeMs ?? 0;
    const aIsRecent = nowTimestamp - mtimeA < recencyThresholdMs;
    const bIsRecent = nowTimestamp - mtimeB < recencyThresholdMs;

    if (aIsRecent && bIsRecent) {
      return mtimeB - mtimeA;
    } else if (aIsRecent) {
      return -1;
    } else if (bIsRecent) {
      return 1;
    } else {
      return a.fullpath().localeCompare(b.fullpath());
    }
  });
  return sortedEntries;
}

/**
 * Parameters for the GlobTool
 */
export interface GlobToolParams {
  /**
   * The glob pattern to match files against
   */
  pattern: string;

  /**
   * The directory to search in (optional, defaults to current directory)
   */
  dir_path?: string;

  /**
   * Whether the search should be case-sensitive (optional, defaults to false)
   */
  case_sensitive?: boolean;

  /**
   * Whether to respect .gitignore patterns (optional, defaults to true)
   */
  respect_git_ignore?: boolean;

  /**
   * Whether to respect .geminiignore patterns (optional, defaults to true)
   */
  respect_gemini_ignore?: boolean;
}

class GlobToolInvocation extends BaseToolInvocation<
  GlobToolParams,
  ToolResult
> {
  private fileService: FileDiscoveryService;

  constructor(
    private config: Config,
    params: GlobToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    let description = `'${this.params.pattern}'`;
    if (this.params.dir_path) {
      const searchDir = path.resolve(
        this.config.getTargetDir(),
        this.params.dir_path || '.',
      );
      const relativePath = makeRelative(searchDir, this.config.getTargetDir());
      description += ` within ${shortenPath(relativePath)}`;
    }

    return description;
  }

  override getPolicyUpdateOptions(
    _outcome: ToolConfirmationOutcome,
  ): PolicyUpdateOptions | undefined {
    return {
      argsPattern: buildPatternArgsPattern(this.params.pattern),
    };
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    try {
      // Determine which directories to search
      const searchDirs: string[] = [];
      let searchLocationDescription: string;

      // If a specific path is provided, resolve it and check if it's within workspace
      let searchDirectories: readonly string[];
      if (this.params.dir_path) {
        const searchDirAbsolute = path.resolve(
          this.config.getTargetDir(),
          this.params.dir_path,
        );
        const validationError = this.config.validatePathAccess(
          searchDirAbsolute,
          'read',
        );
        if (validationError) {
          return {
            llmContent: validationError,
            returnDisplay: 'Path not in workspace.',
            error: {
              message: validationError,
              type: ToolErrorType.PATH_NOT_IN_WORKSPACE,
            },
          };
        }
        searchDirectories = [searchDirAbsolute];
      } else {
        // No path specified — search all workspace directories
        const workspaceDirs = this.config
          .getWorkspaceContext()
          .getDirectories();
        searchDirs.push(...workspaceDirs);
        searchLocationDescription =
          workspaceDirs.length > 1
            ? `across ${workspaceDirs.length} workspace directories`
            : `in the workspace directory`;
      }

      // Get centralized file discovery service
      const fileDiscovery = this.config.getFileService();

      // Collect entries from all search directories
      const allEntries: GlobPath[] = [];
      for (const searchDir of searchDirectories) {
        let pattern = this.params.pattern;
        const fullPath = path.join(searchDir, pattern);
        if (fs.existsSync(fullPath)) {
          pattern = escape(pattern);
        }

        const entries = (await glob(pattern, {
          cwd: searchDir,
          withFileTypes: true,
          nodir: true,
          stat: true,
          nocase: !this.params.case_sensitive,
          dot: true,
          ignore: this.config.getFileExclusions().getGlobExcludes(),
          follow: false,
          signal,
        })) as GlobPath[];

        allEntries.push(...entries);
      }

      const relativePaths = allEntries.map((p) =>
        path.relative(this.config.getTargetDir(), p.fullpath()),
      );

      const { filteredPaths, ignoredCount } =
        fileDiscovery.filterFilesWithReport(relativePaths, {
          respectGitIgnore:
            this.params?.respect_git_ignore ??
            this.config.getFileFilteringOptions().respectGitIgnore ??
            DEFAULT_FILE_FILTERING_OPTIONS.respectGitIgnore,
          respectGeminiIgnore:
            this.params?.respect_gemini_ignore ??
            this.config.getFileFilteringOptions().respectGeminiIgnore ??
            DEFAULT_FILE_FILTERING_OPTIONS.respectGeminiIgnore,
        });

      const filteredAbsolutePaths = new Set(
        filteredPaths.map((p) => path.resolve(this.config.getTargetDir(), p)),
      );

      const filteredEntries = allEntries.filter((entry) =>
        filteredAbsolutePaths.has(entry.fullpath()),
      );

      if (!filteredEntries || filteredEntries.length === 0) {
        let message = `No files found matching pattern "${this.params.pattern}"`;
        if (searchDirectories.length === 1) {
          message += ` within ${searchDirectories[0]}`;
        } else {
          message += ` within ${searchDirectories.length} workspace directories`;
        }
        if (ignoredCount > 0) {
          message += ` (${ignoredCount} files were ignored)`;
        }
        return {
          llmContent: `No files found matching pattern "${this.params.pattern}" ${searchLocationDescription}`,
          returnDisplay: `No files found`,
        };
      }

      // Set filtering such that we first show the most recent files
      const oneDayInMs = 24 * 60 * 60 * 1000;
      const nowTimestamp = new Date().getTime();

      // Sort the filtered entries using the new helper function
      const sortedEntries = sortFileEntries(
        filteredEntries,
        nowTimestamp,
        oneDayInMs,
      );

      const totalFileCount = sortedEntries.length;
      const fileLimit = Math.min(
        MAX_FILE_COUNT,
        this.config.getTruncateToolOutputLines(),
      );
      const truncated = totalFileCount > fileLimit;

      // Limit to fileLimit if needed
      const entriesToShow = truncated
        ? sortedEntries.slice(0, fileLimit)
        : sortedEntries;

      const sortedAbsolutePaths = entriesToShow.map((entry) =>
        entry.fullpath(),
      );
      const fileListDescription = sortedAbsolutePaths.join('\n');

      let resultMessage = `Found ${totalFileCount} file(s) matching "${this.params.pattern}" ${searchLocationDescription}`;
      resultMessage += `, sorted by modification time (newest first):\n---\n${fileListDescription}`;

      // Add truncation notice if needed
      if (truncated) {
        const omittedFiles = totalFileCount - fileLimit;
        const fileTerm = omittedFiles === 1 ? 'file' : 'files';
        resultMessage += `\n---\n[${omittedFiles} ${fileTerm} truncated] ...`;
      }
      if (ignoredCount > 0) {
        resultMessage += ` (${ignoredCount} additional files were ignored)`;
      }
      resultMessage += `, sorted by modification time (newest first):\n${fileListDescription}`;

      return {
        llmContent: resultMessage,
        returnDisplay: `Found ${totalFileCount} matching file(s)${truncated ? ' (truncated)' : ''}`,
      };
    } catch (error) {
      debugLogger.warn(`GlobLogic execute Error`, error);
      const errorMessage = getErrorMessage(error);
      const rawError = `Error during glob search operation: ${errorMessage}`;
      return {
        llmContent: rawError,
        returnDisplay: `Error: ${errorMessage || 'An unexpected error occurred.'}`,
        error: {
          message: rawError,
          type: ToolErrorType.GLOB_EXECUTION_ERROR,
        },
      };
    }
  }

  private getFileFilteringOptions(): FileFilteringOptions {
    const options = this.config.getFileFilteringOptions?.();
    return {
      respectGitIgnore:
        options?.respectGitIgnore ??
        DEFAULT_FILE_FILTERING_OPTIONS.respectGitIgnore,
      respectApexIgnore:
        options?.respectApexIgnore ??
        DEFAULT_FILE_FILTERING_OPTIONS.respectApexIgnore,
    };
  }
}

/**
 * Implementation of the Glob tool logic
 */
export class GlobTool extends BaseDeclarativeTool<GlobToolParams, ToolResult> {
  static readonly Name = GLOB_TOOL_NAME;
  constructor(
    private config: Config,
    messageBus: MessageBus,
  ) {
    super(
      GlobTool.Name,
      GLOB_DISPLAY_NAME,
      GLOB_DEFINITION.base.description!,
      Kind.Search,
      GLOB_DEFINITION.base.parametersJsonSchema,
      messageBus,
      true,
      false,
    );
  }

  /**
   * Validates the parameters for the tool.
   */
  protected override validateToolParamValues(
    params: GlobToolParams,
  ): string | null {
    const searchDirAbsolute = path.resolve(
      this.config.getTargetDir(),
      params.dir_path || '.',
    );

    const validationError = this.config.validatePathAccess(
      searchDirAbsolute,
      'read',
    );
    if (validationError) {
      return validationError;
    }

    const targetDir = searchDirAbsolute || this.config.getTargetDir();
    try {
      if (!fs.existsSync(targetDir)) {
        return `Search path does not exist ${targetDir}`;
      }
      if (!fs.statSync(targetDir).isDirectory()) {
        return `Search path is not a directory: ${targetDir}`;
      }
    } catch (e: unknown) {
      return `Error accessing search path: ${e}`;
    }

    if (
      !params.pattern ||
      typeof params.pattern !== 'string' ||
      params.pattern.trim() === ''
    ) {
      return "The 'pattern' parameter cannot be empty.";
    }

    // Only validate path if one is provided
    if (params.path) {
      try {
        resolveAndValidatePath(this.config, params.path, {
          allowExternalPaths: true,
        });
      } catch (error) {
        return getErrorMessage(error);
      }
    }

    return null;
  }

  protected createInvocation(
    params: GlobToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<GlobToolParams, ToolResult> {
    return new GlobToolInvocation(
      this.config,
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
    );
  }

  override getSchema(modelId?: string) {
    return resolveToolDeclaration(GLOB_DEFINITION, modelId);
  }
}
