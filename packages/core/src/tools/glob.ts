/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { glob, escape } from 'glob';
import { spawn } from 'node:child_process';
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
import { ensureFdPath } from './getFd.js';

const DEFAULT_MAX_RESULTS = 200;

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
   * Whether to respect .apexignore patterns (optional, defaults to true)
   */
  respect_gemini_ignore?: boolean;

  /**
   * Maximum number of results to return (optional, defaults to 200)
   */
  max_results?: number;
}

/**
 * Executes file search using fd with glob pattern matching.
 *
 * Maps glob parameters to fd flags:
 *   pattern          → --glob '<pattern>' (with --full-path when pattern contains /)
 *   dir_path         → --base-directory <path>
 *   case_sensitive   → --case-sensitive / --ignore-case
 *   respect_git_ignore → default / --no-ignore-vcs
 *   max_results      → --max-results N
 *
 * Returns absolute paths of matching files.
 */
async function executeFdSearch(
  fdPath: string,
  pattern: string,
  searchDir: string,
  params: GlobToolParams,
  maxResults: number,
  signal: AbortSignal,
): Promise<string[]> {
  const args: string[] = [];

  // Always search for files only (matching glob's nodir: true)
  args.push('--type', 'f');

  // Glob mode (not regex)
  args.push('--glob');

  // Full path matching when pattern contains path separators
  if (pattern.includes('/')) {
    args.push('--full-path');
  }

  // Hidden files — match glob's dot: true behavior
  args.push('--hidden');

  // Case sensitivity
  if (params.case_sensitive) {
    args.push('--case-sensitive');
  } else {
    args.push('--ignore-case');
  }

  // Git ignore handling
  if (params.respect_git_ignore === false) {
    args.push('--no-ignore-vcs');
  }

  // Max results
  args.push('--max-results', maxResults.toString());

  // Do not follow symlinks (matching glob's follow: false)
  // fd defaults to not following symlinks

  // The pattern (fd expects the pattern before the search path)
  args.push(pattern);

  // The search directory
  args.push(searchDir);

  return new Promise((resolve, reject) => {
    const results: string[] = [];
    let buffer = '';

    const child = spawn(fdPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const onAbort = () => {
      if (!child.killed) child.kill();
    };

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          results.push(trimmed);
        }
      }
    });

    child.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', () => {
      signal.removeEventListener('abort', onAbort);
      if (buffer.trim()) {
        results.push(buffer.trim());
      }
      resolve(results);
    });
  });
}

/**
 * Converts a list of absolute file paths into GlobPath entries by stat-ing each file.
 * This preserves mtime sorting capability when using fd.
 */
async function pathsToGlobEntries(
  absolutePaths: string[],
): Promise<GlobPath[]> {
  const entries: GlobPath[] = [];
  // Stat files in parallel for performance
  const statPromises = absolutePaths.map(async (filePath) => {
    try {
      const stats = await fsPromises.stat(filePath);
      return {
        fullpath: () => filePath,
        mtimeMs: stats.mtimeMs,
      } as GlobPath;
    } catch {
      // File may have been deleted between fd returning and stat
      return null;
    }
  });

  const results = await Promise.all(statPromises);
  for (const result of results) {
    if (result) {
      entries.push(result);
    }
  }
  return entries;
}

class GlobToolInvocation extends BaseToolInvocation<
  GlobToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    private useFd: boolean,
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
    if (this.useFd) {
      try {
        return await this.executeWithFd(signal);
      } catch (error) {
        debugLogger.log(
          `[GlobTool] fd execution failed, falling back to JS glob: ${error}`,
        );
        // Fall through to JS glob
      }
    }
    return this.executeWithJsGlob(signal);
  }

  /**
   * fd-backed execution path. Uses fd for file discovery, then stats results
   * for mtime sorting.
   */
  private async executeWithFd(signal: AbortSignal): Promise<ToolResult> {
    const workspaceContext = this.config.getWorkspaceContext();
    const workspaceDirectories = workspaceContext.getDirectories();
    const maxResults = this.params.max_results ?? DEFAULT_MAX_RESULTS;

    // Resolve search directories
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
      searchDirectories = workspaceDirectories;
    }

    const fdPath = await ensureFdPath();

    // Collect results from all search directories
    let allPaths: string[] = [];
    for (const searchDir of searchDirectories) {
      let pattern = this.params.pattern;
      // If the pattern is a literal file path that exists, escape it
      const fullPath = path.join(searchDir, pattern);
      if (fs.existsSync(fullPath)) {
        pattern = escape(pattern);
      }

      const results = await executeFdSearch(
        fdPath,
        pattern,
        searchDir,
        this.params,
        maxResults - allPaths.length,
        signal,
      );
      allPaths.push(...results);

      if (allPaths.length >= maxResults) {
        allPaths = allPaths.slice(0, maxResults);
        break;
      }
    }

    if (allPaths.length === 0) {
      let message = `No files found matching pattern "${this.params.pattern}"`;
      if (searchDirectories.length === 1) {
        message += ` within ${searchDirectories[0]}`;
      } else {
        message += ` within ${searchDirectories.length} workspace directories`;
      }
      return {
        llmContent: message,
        returnDisplay: `No files found`,
      };
    }

    // Apply .apexignore filtering (fd handles .gitignore natively but not .apexignore)
    const fileDiscovery = this.config.getFileService();
    const relativePaths = allPaths.map((p) =>
      path.relative(this.config.getTargetDir(), p),
    );

    const respectGeminiIgnore =
      this.params?.respect_gemini_ignore ??
      this.config.getFileFilteringOptions().respectGeminiIgnore ??
      DEFAULT_FILE_FILTERING_OPTIONS.respectGeminiIgnore;

    let filteredPaths: string[];
    let ignoredCount = 0;
    if (respectGeminiIgnore) {
      const report = fileDiscovery.filterFilesWithReport(relativePaths, {
        respectGitIgnore: false, // fd already handled .gitignore
        respectGeminiIgnore: true,
      });
      filteredPaths = report.filteredPaths;
      ignoredCount = report.ignoredCount;
    } else {
      filteredPaths = relativePaths;
    }

    const filteredAbsolutePaths = filteredPaths.map((p) =>
      path.resolve(this.config.getTargetDir(), p),
    );

    if (filteredAbsolutePaths.length === 0) {
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
        llmContent: message,
        returnDisplay: `No files found`,
      };
    }

    // Stat files for mtime and sort (preserves existing behavior)
    const entries = await pathsToGlobEntries(filteredAbsolutePaths);

    const oneDayInMs = 24 * 60 * 60 * 1000;
    const nowTimestamp = new Date().getTime();
    const sortedEntries = sortFileEntries(entries, nowTimestamp, oneDayInMs);

    const sortedAbsolutePaths = sortedEntries.map((entry) => entry.fullpath());
    const fileListDescription = sortedAbsolutePaths.join('\n');
    const fileCount = sortedAbsolutePaths.length;
    const truncated = allPaths.length >= maxResults;

    let resultMessage = `Found ${fileCount} file(s) matching "${this.params.pattern}"`;
    if (searchDirectories.length === 1) {
      resultMessage += ` within ${searchDirectories[0]}`;
    } else {
      resultMessage += ` across ${searchDirectories.length} workspace directories`;
    }
    if (ignoredCount > 0) {
      resultMessage += ` (${ignoredCount} additional files were ignored)`;
    }
    if (truncated) {
      resultMessage += ` (results capped at ${maxResults}; use max_results to adjust)`;
    }
    resultMessage += `, sorted by modification time (newest first):\n${fileListDescription}`;

    return {
      llmContent: resultMessage,
      returnDisplay: `Found ${fileCount} matching file(s)${truncated ? ' (capped)' : ''}`,
    };
  }

  /**
   * Original JS glob execution path. Used as fallback when fd is not available.
   */
  private async executeWithJsGlob(signal: AbortSignal): Promise<ToolResult> {
    try {
      const workspaceContext = this.config.getWorkspaceContext();
      const workspaceDirectories = workspaceContext.getDirectories();
      const maxResults = this.params.max_results ?? DEFAULT_MAX_RESULTS;

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
        // Search across all workspace directories
        searchDirectories = workspaceDirectories;
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
          llmContent: message,
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

      let sortedAbsolutePaths = sortedEntries.map((entry) => entry.fullpath());

      // Apply max_results cap
      const truncated = sortedAbsolutePaths.length > maxResults;
      if (truncated) {
        sortedAbsolutePaths = sortedAbsolutePaths.slice(0, maxResults);
      }

      const fileListDescription = sortedAbsolutePaths.join('\n');
      const fileCount = sortedAbsolutePaths.length;

      let resultMessage = `Found ${fileCount} file(s) matching "${this.params.pattern}"`;
      if (searchDirectories.length === 1) {
        resultMessage += ` within ${searchDirectories[0]}`;
      } else {
        resultMessage += ` across ${searchDirectories.length} workspace directories`;
      }
      if (ignoredCount > 0) {
        resultMessage += ` (${ignoredCount} additional files were ignored)`;
      }
      if (truncated) {
        resultMessage += ` (results capped at ${maxResults}; use max_results to adjust)`;
      }
      resultMessage += `, sorted by modification time (newest first):\n${fileListDescription}`;

      return {
        llmContent: resultMessage,
        returnDisplay: `Found ${fileCount} matching file(s)${truncated ? ' (capped)' : ''}`,
      };
    } catch (error) {
      debugLogger.warn(`GlobLogic execute Error`, error);
      const errorMessage = getErrorMessage(error);
      const rawError = `Error during glob search operation: ${errorMessage}`;
      return {
        llmContent: rawError,
        returnDisplay: `Error: An unexpected error occurred.`,
        error: {
          message: rawError,
          type: ToolErrorType.GLOB_EXECUTION_ERROR,
        },
      };
    }
  }
}

/**
 * Implementation of the Glob tool logic.
 *
 * When fd (Rust-based file finder) is available, uses fd for significantly
 * faster file discovery on large codebases. Falls back to the JS glob walker
 * when fd is not available, following the same pattern as ripgrep/grep fallback.
 */
export class GlobTool extends BaseDeclarativeTool<GlobToolParams, ToolResult> {
  static readonly Name = GLOB_TOOL_NAME;
  private useFd: boolean = false;

  constructor(
    private config: Config,
    messageBus: MessageBus,
    useFd: boolean = false,
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
    this.useFd = useFd;
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
      this.useFd,
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
