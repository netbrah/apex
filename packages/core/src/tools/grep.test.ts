/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GrepTool, type GrepToolParams } from './grep.js';
import type { ToolResult, GrepResult } from './tools.js';
import path from 'node:path';
import { isSubpath } from '../utils/paths.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import type { Config } from '../config/config.js';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';
import { ToolErrorType } from './tool-error.js';
import * as glob from 'glob';
import { createMockMessageBus } from '../test-utils/mock-message-bus.js';
import { execStreaming } from '../utils/shell-utils.js';

vi.mock('glob', { spy: true });
vi.mock('../utils/shell-utils.js', () => ({
  execStreaming: vi.fn(),
}));

// Mock the child_process module to control grep/git grep behavior
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => {
      // Create a proper mock EventEmitter-like child process
      const listeners: Map<
        string,
        Set<(...args: unknown[]) => void>
      > = new Map();

      const createStream = () => ({
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          const key = `stream:${event}`;
          if (!listeners.has(key)) listeners.set(key, new Set());
          listeners.get(key)!.add(cb);
        }),
        removeListener: vi.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            const key = `stream:${event}`;
            listeners.get(key)?.delete(cb);
          },
        ),
      });

      return {
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          const key = `child:${event}`;
          if (!listeners.has(key)) listeners.set(key, new Set());
          listeners.get(key)!.add(cb);

          // Simulate command not found or error for git grep and system grep
          // to force it to fall back to JS implementation.
          if (event === 'error') {
            setTimeout(() => cb(new Error('Command not found')), 0);
          } else if (event === 'close') {
            setTimeout(() => cb(1), 0); // Exit code 1 for error
          }
        }),
        removeListener: vi.fn(
          (event: string, cb: (...args: unknown[]) => void) => {
            const key = `child:${event}`;
            listeners.get(key)?.delete(cb);
          },
        ),
        stdout: createStream(),
        stderr: createStream(),
        connected: false,
        disconnect: vi.fn(),
      };
    }),
    exec: vi.fn(
      (
        cmd: string,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        // Mock exec to fail for git grep commands
        callback(new Error('Command not found'), '', '');
      },
    ),
  };
});

describe('GrepTool', () => {
  let tempRootDir: string;
  let grepTool: GrepTool;
  const abortSignal = new AbortController().signal;
  let mockConfig: Config;

  beforeEach(async () => {
    tempRootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grep-tool-root-'));

    mockConfig = {
      getTargetDir: () => tempRootDir,
      getWorkspaceContext: () => createMockWorkspaceContext(tempRootDir),
      getFileExclusions: () => ({
        getGlobExcludes: () => [],
      }),
      getFileFilteringOptions: () => ({
        respectGitIgnore: true,
        respectGeminiIgnore: true,
        maxFileCount: 1000,
        searchTimeout: 30000,
        customIgnoreFilePaths: [],
      }),
      storage: {
        getProjectTempDir: vi.fn().mockReturnValue('/tmp/project'),
      },
      isPathAllowed(this: Config, absolutePath: string): boolean {
        const workspaceContext = this.getWorkspaceContext();
        if (workspaceContext.isPathWithinWorkspace(absolutePath)) {
          return true;
        }

        const projectTempDir = this.storage.getProjectTempDir();
        return isSubpath(path.resolve(projectTempDir), absolutePath);
      },
      validatePathAccess(this: Config, absolutePath: string): string | null {
        if (this.isPathAllowed(absolutePath)) {
          return null;
        }

        const workspaceDirs = this.getWorkspaceContext().getDirectories();
        const projectTempDir = this.storage.getProjectTempDir();
        return `Path not in workspace: Attempted path "${absolutePath}" resolves outside the allowed workspace directories: ${workspaceDirs.join(', ')} or the project temp directory: ${projectTempDir}`;
      },
    } as unknown as Config;

    grepTool = new GrepTool(mockConfig, createMockMessageBus());

    // Create some test files and directories
    await fs.writeFile(
      path.join(tempRootDir, 'fileA.txt'),
      'hello world\nsecond line with world',
    );
    await fs.writeFile(
      path.join(tempRootDir, 'fileB.js'),
      'const foo = "bar";\nfunction baz() { return "hello"; }',
    );
    await fs.mkdir(path.join(tempRootDir, 'sub'));
    await fs.writeFile(
      path.join(tempRootDir, 'sub', 'fileC.txt'),
      'another world in sub dir',
    );
    await fs.writeFile(
      path.join(tempRootDir, 'sub', 'fileD.md'),
      '# Markdown file\nThis is a test.',
    );
  });

  afterEach(async () => {
    await fs.rm(tempRootDir, { recursive: true, force: true });
  });

  describe('validateToolParams', () => {
    it('should return null for valid params (pattern only)', () => {
      const params: GrepToolParams = { pattern: 'hello' };
      expect(grepTool.validateToolParams(params)).toBeNull();
    });

    it('should return null for valid params (pattern and path)', () => {
      const params: GrepToolParams = { pattern: 'hello', dir_path: '.' };
      expect(grepTool.validateToolParams(params)).toBeNull();
    });

    it('should return null for valid params (pattern, path, and glob)', () => {
      const params: GrepToolParams = {
        pattern: 'hello',
        dir_path: '.',
        include_pattern: '*.txt',
      };
      expect(grepTool.validateToolParams(params)).toBeNull();
    });

    it('should return error if pattern is missing', () => {
      const params = { dir_path: '.' } as unknown as GrepToolParams;
      expect(grepTool.validateToolParams(params)).toBe(
        `params must have required property 'pattern'`,
      );
    });

    it('should return error for invalid regex pattern', () => {
      const params: GrepToolParams = { pattern: '[[' };
      expect(grepTool.validateToolParams(params)).toContain(
        'Invalid regular expression pattern',
      );
    });

    it('should return error if path does not exist', () => {
      const params: GrepToolParams = {
        pattern: 'hello',
        dir_path: 'nonexistent',
      };
      // Check for the core error message, as the full path might vary
      expect(grepTool.validateToolParams(params)).toContain(
        'Path does not exist',
      );
      expect(grepTool.validateToolParams(params)).toContain('nonexistent');
    });

    it('should return error if path is a file, not a directory', async () => {
      const filePath = path.join(tempRootDir, 'fileA.txt');
      const params: GrepToolParams = { pattern: 'hello', dir_path: filePath };
      expect(grepTool.validateToolParams(params)).toContain(
        `Path is not a directory: ${filePath}`,
      );
    });
  });

  function createLineGenerator(lines: string[]): AsyncGenerator<string> {
    return (async function* () {
      for (const line of lines) {
        yield line;
      }
    })();
  }

  describe('execute', () => {
    it('should find matches for a simple pattern in all files', async () => {
      const params: GrepToolParams = { pattern: 'world' };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain(
        'Found 3 matches for pattern "world" in the workspace directory',
      );
      expect(result.llmContent).toContain('File: fileA.txt');
      expect(result.llmContent).toContain('L1: hello world');
      expect(result.llmContent).toContain('L2: second line with world');
      expect(result.llmContent).toContain(
        `File: ${path.join('sub', 'fileC.txt')}`,
      );
      expect(result.llmContent).toContain('L1: another world in sub dir');
      expect((result.returnDisplay as GrepResult)?.summary).toBe(
        'Found 3 matches',
      );
    }, 30000);

    it('should include files that start with ".." in JS fallback', async () => {
      await fs.writeFile(path.join(tempRootDir, '..env'), 'world in ..env');
      const params: GrepToolParams = { pattern: 'world' };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain('File: ..env');
      expect(result.llmContent).toContain('L1: world in ..env');
    });

    it('should ignore system grep output that escapes base path', async () => {
      vi.mocked(execStreaming).mockImplementationOnce(() =>
        createLineGenerator(['..env:1:hello', '../secret.txt:2:leak']),
      );

      const params: GrepToolParams = { pattern: 'hello' };
      const invocation = grepTool.build(params) as unknown as {
        isCommandAvailable: (command: string) => Promise<boolean>;
        execute: (signal: AbortSignal) => Promise<ToolResult>;
      };
      invocation.isCommandAvailable = vi.fn(
        async (command: string) => command === 'grep',
      );

      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain('File: ..env');
      expect(result.llmContent).toContain('L1: hello');
      expect(result.llmContent).not.toContain('secret.txt');
    });

    it('should honor ~/.rgignore in fallback search', async () => {
      const tempHomeDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'grep-home-'),
      );
      const userRgIgnorePath = path.join(tempHomeDir, '.rgignore');
      await fs.writeFile(userRgIgnorePath, 'ignored.txt\n');
      await fs.writeFile(
        path.join(tempRootDir, 'ignored.txt'),
        'world should be filtered',
      );

      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempHomeDir);
      try {
        const rgIgnoreAwareTool = new GrepTool(mockConfig);
        const params: GrepToolParams = { pattern: 'world' };
        const invocation = rgIgnoreAwareTool.build(params);
        const result = await invocation.execute(abortSignal);

        expect(result.llmContent).toContain('Found 3 matches');
        expect(result.llmContent).not.toContain('ignored.txt');
      } finally {
        homedirSpy.mockRestore();
        await fs.rm(tempHomeDir, { recursive: true, force: true });
      }
    });

    it('should find matches in a specific path', async () => {
      const params: GrepToolParams = { pattern: 'world', dir_path: 'sub' };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain(
        'Found 1 match for pattern "world" in path "sub"',
      );
      expect(result.llmContent).toContain('File: fileC.txt'); // Path relative to 'sub'
      expect(result.llmContent).toContain('L1: another world in sub dir');
      expect((result.returnDisplay as GrepResult)?.summary).toBe(
        'Found 1 match',
      );
    }, 30000);

    it('should find matches with an include glob', async () => {
      const params: GrepToolParams = {
        pattern: 'hello',
        include_pattern: '*.js',
      };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain(
        'Found 1 match for pattern "hello" in the workspace directory (filter: "*.js"):',
      );
      expect(result.llmContent).toContain('File: fileB.js');
      expect(result.llmContent).toContain(
        'L2: function baz() { return "hello"; }',
      );
      expect((result.returnDisplay as GrepResult)?.summary).toBe(
        'Found 1 match',
      );
    }, 30000);

    it('should find matches with a glob filter and path', async () => {
      await fs.writeFile(
        path.join(tempRootDir, 'sub', 'another.js'),
        'const greeting = "hello";',
      );
      const params: GrepToolParams = {
        pattern: 'hello',
        dir_path: 'sub',
        include_pattern: '*.js',
      };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain(
        'Found 1 match for pattern "hello" in path "sub" (filter: "*.js")',
      );
      expect(result.llmContent).toContain('File: another.js');
      expect(result.llmContent).toContain('L1: const greeting = "hello";');
      expect((result.returnDisplay as GrepResult)?.summary).toBe(
        'Found 1 match',
      );
    }, 30000);

    it('should return "No matches found" when pattern does not exist', async () => {
      const params: GrepToolParams = { pattern: 'nonexistentpattern' };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain(
        'No matches found for pattern "nonexistentpattern" in the workspace directory.',
      );
      expect((result.returnDisplay as GrepResult)?.summary).toBe(
        'No matches found',
      );
    }, 30000);

    it('should handle regex special characters correctly', async () => {
      const params: GrepToolParams = { pattern: 'foo.*bar' }; // Matches 'const foo = "bar";'
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain(
        'Found 1 match for pattern "foo.*bar" in the workspace directory:',
      );
      expect(result.llmContent).toContain('File: fileB.js');
      expect(result.llmContent).toContain('L1: const foo = "bar";');
    }, 30000);

    it('should be case-insensitive by default (JS fallback)', async () => {
      const params: GrepToolParams = { pattern: 'HELLO' };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);
      expect(result.llmContent).toContain(
        'Found 2 matches for pattern "HELLO" in the workspace directory:',
      );
      expect(result.llmContent).toContain('File: fileA.txt');
      expect(result.llmContent).toContain('L1: hello world');
      expect(result.llmContent).toContain('File: fileB.js');
      expect(result.llmContent).toContain(
        'L2: function baz() { return "hello"; }',
      );
    }, 30000);

    it('should throw an error if params are invalid', async () => {
      const params = { dir_path: '.' } as unknown as GrepToolParams; // Invalid: pattern missing
      expect(() => grepTool.build(params)).toThrow(
        /params must have required property 'pattern'/,
      );
    }, 30000);

    it('should return a GREP_EXECUTION_ERROR on failure', async () => {
      vi.mocked(glob.globStream).mockRejectedValue(new Error('Glob failed'));
      const params: GrepToolParams = { pattern: 'hello' };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);
      expect(result.error?.type).toBe(ToolErrorType.GREP_EXECUTION_ERROR);
      vi.mocked(glob.globStream).mockReset();
    }, 30000);
  });

  describe('multi-directory workspace', () => {
    it('should search across all workspace directories when no path is specified', async () => {
      // Create additional directory with test files
      const secondDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'grep-tool-second-'),
      );
      await fs.writeFile(
        path.join(secondDir, 'other.txt'),
        'hello from second directory\nworld in second',
      );
      await fs.writeFile(
        path.join(secondDir, 'another.js'),
        'function world() { return "test"; }',
      );

      // Create a mock config with multiple directories
      const multiDirConfig = {
        getTargetDir: () => tempRootDir,
        getWorkspaceContext: () =>
          createMockWorkspaceContext(tempRootDir, [secondDir]),
        getFileExclusions: () => ({
          getGlobExcludes: () => [],
        }),
        getFileFilteringOptions: () => ({
          respectGitIgnore: true,
          respectGeminiIgnore: true,
          maxFileCount: 1000,
          searchTimeout: 30000,
          customIgnoreFilePaths: [],
        }),
        storage: {
          getProjectTempDir: vi.fn().mockReturnValue('/tmp/project'),
        },
        isPathAllowed(this: Config, absolutePath: string): boolean {
          const workspaceContext = this.getWorkspaceContext();
          if (workspaceContext.isPathWithinWorkspace(absolutePath)) {
            return true;
          }

          const projectTempDir = this.storage.getProjectTempDir();
          return isSubpath(path.resolve(projectTempDir), absolutePath);
        },
        validatePathAccess(this: Config, absolutePath: string): string | null {
          if (this.isPathAllowed(absolutePath)) {
            return null;
          }

          const workspaceDirs = this.getWorkspaceContext().getDirectories();
          const projectTempDir = this.storage.getProjectTempDir();
          return `Path not in workspace: Attempted path "${absolutePath}" resolves outside the allowed workspace directories: ${workspaceDirs.join(', ')} or the project temp directory: ${projectTempDir}`;
        },
      } as unknown as Config;

      const multiDirGrepTool = new GrepTool(
        multiDirConfig,
        createMockMessageBus(),
      );
      const params: GrepToolParams = { pattern: 'world' };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);

      // Should find matches in the target directory only
      expect(result.llmContent).toContain(
        'Found 3 matches for pattern "world" in the workspace directory',
      );

      // Matches from target directory
      expect(result.llmContent).toContain('fileA.txt');
      expect(result.llmContent).toContain('L1: hello world');
      expect(result.llmContent).toContain('L2: second line with world');
      expect(result.llmContent).toContain('fileC.txt');
      expect(result.llmContent).toContain('L1: another world in sub dir');
    });

    it('should search only specified path within workspace directories', async () => {
      // Create additional directory
      const secondDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'grep-tool-second-'),
      );
      await fs.mkdir(path.join(secondDir, 'sub'));
      await fs.writeFile(
        path.join(secondDir, 'sub', 'test.txt'),
        'hello from second sub directory',
      );

      // Create a mock config with multiple directories
      const multiDirConfig = {
        getTargetDir: () => tempRootDir,
        getWorkspaceContext: () =>
          createMockWorkspaceContext(tempRootDir, [secondDir]),
        getFileExclusions: () => ({
          getGlobExcludes: () => [],
        }),
        getFileFilteringOptions: () => ({
          respectGitIgnore: true,
          respectGeminiIgnore: true,
          maxFileCount: 1000,
          searchTimeout: 30000,
          customIgnoreFilePaths: [],
        }),
        storage: {
          getProjectTempDir: vi.fn().mockReturnValue('/tmp/project'),
        },
        isPathAllowed(this: Config, absolutePath: string): boolean {
          const workspaceContext = this.getWorkspaceContext();
          if (workspaceContext.isPathWithinWorkspace(absolutePath)) {
            return true;
          }

          const projectTempDir = this.storage.getProjectTempDir();
          return isSubpath(path.resolve(projectTempDir), absolutePath);
        },
        validatePathAccess(this: Config, absolutePath: string): string | null {
          if (this.isPathAllowed(absolutePath)) {
            return null;
          }

          const workspaceDirs = this.getWorkspaceContext().getDirectories();
          const projectTempDir = this.storage.getProjectTempDir();
          return `Path not in workspace: Attempted path "${absolutePath}" resolves outside the allowed workspace directories: ${workspaceDirs.join(', ')} or the project temp directory: ${projectTempDir}`;
        },
      } as unknown as Config;

      const multiDirGrepTool = new GrepTool(
        multiDirConfig,
        createMockMessageBus(),
      );

      // Search only in the 'sub' directory of the first workspace
      const params: GrepToolParams = { pattern: 'world', dir_path: 'sub' };
      const invocation = multiDirGrepTool.build(params);
      const result = await invocation.execute(abortSignal);

      // Should only find matches in the specified sub directory
      expect(result.llmContent).toContain(
        'Found 1 match for pattern "world" in path "sub"',
      );
      expect(result.llmContent).toContain('File: fileC.txt');
      expect(result.llmContent).toContain('L1: another world in sub dir');

      // Should not contain matches from second directory
      expect(result.llmContent).not.toContain('test.txt');

      // Clean up
      await fs.rm(secondDir, { recursive: true, force: true });
    });

    it('should respect total_max_matches and truncate results', async () => {
      // Use 'world' pattern which has 3 matches across fileA.txt and sub/fileC.txt
      const params: GrepToolParams = {
        pattern: 'world',
        total_max_matches: 2,
      };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('Found 2 matches');
      expect(result.llmContent).toContain(
        'results limited to 2 matches for performance',
      );
      // It should find matches in fileA.txt first (2 matches)
      expect(result.llmContent).toContain('File: fileA.txt');
      expect(result.llmContent).toContain('L1: hello world');
      expect(result.llmContent).toContain('L2: second line with world');
      // And sub/fileC.txt should be excluded because limit reached
      expect(result.llmContent).not.toContain('File: sub/fileC.txt');
      expect((result.returnDisplay as GrepResult)?.summary).toBe(
        'Found 2 matches (limited)',
      );
    });

    it('should respect max_matches_per_file in JS fallback', async () => {
      const params: GrepToolParams = {
        pattern: 'world',
        max_matches_per_file: 1,
      };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);

      // fileA.txt has 2 worlds, but should only return 1.
      // sub/fileC.txt has 1 world, so total matches = 2.
      expect(result.llmContent).toContain('Found 2 matches');
      expect(result.llmContent).toContain('File: fileA.txt');
      // Should be a match
      expect(result.llmContent).toContain('L1: hello world');
      // Should NOT be a match (but might be in context as L2-)
      expect(result.llmContent).not.toContain('L2: second line with world');
      expect(result.llmContent).toContain('File: sub/fileC.txt');
      expect(result.llmContent).toContain('L1: another world in sub dir');
    });

    it('should return only file paths when names_only is true', async () => {
      const params: GrepToolParams = {
        pattern: 'world',
        names_only: true,
      };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('Found 2 files with matches');
      expect(result.llmContent).toContain('fileA.txt');
      expect(result.llmContent).toContain('sub/fileC.txt');
      expect(result.llmContent).not.toContain('L1:');
      expect(result.llmContent).not.toContain('hello world');
    });

    it('should filter out matches based on exclude_pattern', async () => {
      await fs.writeFile(
        path.join(tempRootDir, 'copyright.txt'),
        'Copyright 2025 Google LLC\nCopyright 2026 Google LLC',
      );

      const params: GrepToolParams = {
        pattern: 'Copyright .* Google LLC',
        exclude_pattern: '2026',
        dir_path: '.',
      };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('Found 1 match');
      expect(result.llmContent).toContain('copyright.txt');
      // Should be a match
      expect(result.llmContent).toContain('L1: Copyright 2025 Google LLC');
      // Should NOT be a match (but might be in context as L2-)
      expect(result.llmContent).not.toContain('L2: Copyright 2026 Google LLC');
    });

    it('should include context when matches are <= 3', async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
      lines[50] = 'Target match';
      await fs.writeFile(
        path.join(tempRootDir, 'context.txt'),
        lines.join('\n'),
      );

      const params: GrepToolParams = { pattern: 'Target match' };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain(
        'Found 1 match for pattern "Target match"',
      );
      // Verify context before
      expect(result.llmContent).toContain('L40- Line 40');
      // Verify match line
      expect(result.llmContent).toContain('L51: Target match');
      // Verify context after
      expect(result.llmContent).toContain('L60- Line 60');
    });

    it('should truncate excessively long lines', async () => {
      const longString = 'a'.repeat(3000);
      await fs.writeFile(
        path.join(tempRootDir, 'longline.txt'),
        `Target match ${longString}`,
      );

      const params: GrepToolParams = { pattern: 'Target match' };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);

      // MAX_LINE_LENGTH_TEXT_FILE is 2000. It should be truncated.
      expect(result.llmContent).toContain('... [truncated]');
      expect(result.llmContent).not.toContain(longString);
    });
  });

  describe('getDescription', () => {
    it('should generate correct description with pattern only', () => {
      const params: GrepToolParams = { pattern: 'testPattern' };
      const invocation = grepTool.build(params);
      expect(invocation.getDescription()).toBe("'testPattern' in path './'");
    });

    it('should generate correct description with pattern and glob', () => {
      const params: GrepToolParams = {
        pattern: 'testPattern',
        include_pattern: '*.ts',
      };
      const invocation = grepTool.build(params);
      expect(invocation.getDescription()).toBe(
        "'testPattern' in path './' (filter: '*.ts')",
      );
    });

    it('should generate correct description with pattern and path', async () => {
      const dirPath = path.join(tempRootDir, 'src', 'app');
      await fs.mkdir(dirPath, { recursive: true });
      const params: GrepToolParams = {
        pattern: 'testPattern',
        dir_path: path.join('src', 'app'),
      };
      const invocation = grepTool.build(params);
      // The path will be relative to the tempRootDir, so we check for containment.
      expect(invocation.getDescription()).toContain("'testPattern' within");
      expect(invocation.getDescription()).toContain(path.join('src', 'app'));
    });

    it('should indicate searching across all workspace directories when no path specified', () => {
      // Create a mock config with multiple directories
      const multiDirConfig = {
        getTargetDir: () => tempRootDir,
        getWorkspaceContext: () =>
          createMockWorkspaceContext(tempRootDir, ['/another/dir']),
        getFileExclusions: () => ({
          getGlobExcludes: () => [],
        }),
        getFileFilteringOptions: () => ({
          respectGitIgnore: true,
          respectGeminiIgnore: true,
          maxFileCount: 1000,
          searchTimeout: 30000,
          customIgnoreFilePaths: [],
        }),
      } as unknown as Config;

      const multiDirGrepTool = new GrepTool(
        multiDirConfig,
        createMockMessageBus(),
      );
      const params: GrepToolParams = { pattern: 'testPattern' };
      const invocation = multiDirGrepTool.build(params);
      expect(invocation.getDescription()).toBe(
        "'testPattern' across all workspace directories",
      );
      expect(invocation.getDescription()).toContain("app'");
    });

    it('should indicate searching workspace directory when no path specified', () => {
      const params: GrepToolParams = { pattern: 'testPattern' };
      const invocation = grepTool.build(params);
      expect(invocation.getDescription()).toBe("'testPattern' in path './'");
    });

    it('should generate correct description with pattern, glob, and path', async () => {
      const dirPath = path.join(tempRootDir, 'src', 'app');
      await fs.mkdir(dirPath, { recursive: true });
      const params: GrepToolParams = {
        pattern: 'testPattern',
        include_pattern: '*.ts',
        dir_path: path.join('src', 'app'),
      };
      const invocation = grepTool.build(params);
      expect(invocation.getDescription()).toContain(
        "'testPattern' in path 'src",
      );
      expect(invocation.getDescription()).toContain("(filter: '*.ts')");
    });

    it('should use ./ for root path in description', () => {
      const params: GrepToolParams = { pattern: 'testPattern', dir_path: '.' };
      const invocation = grepTool.build(params);
      expect(invocation.getDescription()).toBe("'testPattern' in path '.'");
    });
  });

  describe('Result limiting', () => {
    beforeEach(async () => {
      // Create many test files with matches to test limiting
      for (let i = 1; i <= 30; i++) {
        const fileName = `test${i}.txt`;
        const content = `This is test file ${i} with the pattern testword in it.`;
        await fs.writeFile(path.join(tempRootDir, fileName), content);
      }
    });

    it('should show all results when no limit is specified', async () => {
      const params: GrepToolParams = { pattern: 'testword' };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);

      // New implementation shows all matches when limit is not specified
      expect(result.llmContent).toContain('Found 30 matches');
      expect(result.llmContent).not.toContain('truncated');
      expect(result.returnDisplay).toBe('Found 30 matches');
    });

    it('should respect custom limit parameter', async () => {
      const params: GrepToolParams = { pattern: 'testword', limit: 5 };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);

      // Should find 30 total but limit to 5
      expect(result.llmContent).toContain('Found 30 matches');
      expect(result.llmContent).toContain('25 lines truncated');
      expect(result.returnDisplay).toContain('Found 30 matches (truncated)');
    });

    it('should not show truncation warning when all results fit', async () => {
      const params: GrepToolParams = { pattern: 'testword', limit: 50 };
      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toContain('Found 30 matches');
      expect(result.llmContent).not.toContain('truncated');
      expect(result.returnDisplay).toBe('Found 30 matches');
    });

    it('should not validate limit parameter', () => {
      // limit parameter has no validation constraints in the new implementation
      const params = { pattern: 'test', limit: 5 };
      const error = grepTool.validateToolParams(params as GrepToolParams);
      expect(error).toBeNull();
    });

    it('should accept valid limit parameter', () => {
      const validParams = [
        { pattern: 'test', limit: 1 },
        { pattern: 'test', limit: 50 },
        { pattern: 'test', limit: 100 },
      ];

      validParams.forEach((params) => {
        const error = grepTool.validateToolParams(params);
        expect(error).toBeNull();
      });
    });
  });
});
