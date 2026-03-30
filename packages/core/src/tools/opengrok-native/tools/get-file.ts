/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Get File Content Tool
 *
 * Read source file content from OpenGrok.
 * Supports explicit startLine/endLine params or #L suffix for line ranges.
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { z } from '../lib/zod-shim.js';
import { getFileContent, DEFAULT_PROJECT } from '../lib/opengrok.js';
import { TOOL_DESCRIPTIONS } from '../prompts/index.js';
import { classifyError } from '../lib/errors.js';
import { logTool } from '../lib/logger.js';

const MAX_LINES_HARD_CAP = 2000;
const DEFAULT_MAX_LINES = 1000;

/**
 * Parse line range from filePath suffix like #L100-L200 or #L100-200 or #L100
 * Returns { cleanPath, startLine, endLine } or { cleanPath } if no range
 */
function parseLineRange(filePath: string): {
  cleanPath: string;
  startLine?: number;
  endLine?: number;
} {
  const match = filePath.match(/#L(\d+)(?:-L?(\d+))?$/);
  if (!match) {
    return { cleanPath: filePath };
  }

  const cleanPath = filePath.replace(/#L\d+(?:-L?\d+)?$/, '');
  const startLine = parseInt(match[1], 10);
  const endLine = match[2] ? parseInt(match[2], 10) : startLine + 50; // Default to 50 lines if no end

  return { cleanPath, startLine, endLine };
}

/** Output schema for file content */
const GetFileOutputSchema = z.object({
  success: z.boolean().describe('Whether the file was retrieved successfully'),
  content: z.string().optional().describe('File content (may be truncated)'),
  lines: z.number().optional().describe('Number of lines in returned content'),
  totalLines: z
    .number()
    .optional()
    .describe('Total lines in the file (always present on success)'),
  truncated: z
    .boolean()
    .optional()
    .describe('Whether the content was truncated'),
  range: z
    .object({
      start: z.number().describe('Start line number (1-based)'),
      end: z.number().describe('End line number (1-based, inclusive)'),
    })
    .optional()
    .describe('Line range if requested'),
  error: z.string().optional().describe('Error message if retrieval failed'),
});

export const getFileTool = createTool({
  id: 'get_file',
  description: TOOL_DESCRIPTIONS.get_file,
  mcp: {
    annotations: {
      title: 'Get Source File',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  inputSchema: z.object({
    filePath: z
      .string()
      .describe(
        'Path to the file. Supports #L100-L200 suffix for line range (startLine/endLine params take precedence)',
      ),
    startLine: z
      .number()
      .optional()
      .describe(
        'Start line (1-based). Use with endLine for exact range. Takes precedence over #L suffix',
      ),
    endLine: z
      .number()
      .optional()
      .describe(
        'End line (1-based, inclusive). Defaults to startLine + 50 if only startLine given',
      ),
    maxLines: z
      .number()
      .optional()
      .describe(
        'Max lines to return for non-range requests (default 1000, hard cap 2000)',
      ),
  }),

  outputSchema: GetFileOutputSchema,

  execute: async ({
    filePath,
    startLine: inputStartLine,
    endLine: inputEndLine,
    maxLines: inputMaxLines,
  }) => {
    const invocationId = logTool.start('get_file', {
      filePath,
      startLine: inputStartLine,
      endLine: inputEndLine,
    });
    const project = DEFAULT_PROJECT;
    try {
      // Parse line range from path suffix (e.g., file.cc#L100-L200)
      const {
        cleanPath,
        startLine: suffixStart,
        endLine: suffixEnd,
      } = parseLineRange(filePath);

      // Explicit params win over #L suffix
      const startLine = inputStartLine ?? suffixStart;
      const endLine = inputEndLine ?? (inputStartLine ? undefined : suffixEnd);
      const maxLines = Math.min(
        inputMaxLines ?? DEFAULT_MAX_LINES,
        MAX_LINES_HARD_CAP,
      );

      // getFileContent caches the full file regardless of line range
      let content: string | null;
      try {
        content = await getFileContent(cleanPath, project);
      } catch (error) {
        if (error instanceof Error) {
          return { success: false, error: error.message };
        }
        throw error;
      }

      if (!content) {
        return { success: false, error: `File not found: ${cleanPath}` };
      }

      const allLines = content.split('\n');
      const totalLines = allLines.length;

      // If line range specified, return just those lines
      if (startLine !== undefined) {
        const start = Math.max(0, startLine - 1); // Convert to 0-indexed
        const end = Math.min(allLines.length, endLine ?? start + 50);
        const selectedLines = allLines.slice(start, end);

        const result = {
          success: true as const,
          content: selectedLines.join('\n'),
          lines: selectedLines.length,
          totalLines,
          range: { start: startLine, end: Math.min(end, allLines.length) },
        };
        logTool.end(invocationId, {
          success: true,
          lines: selectedLines.length,
        });
        return result;
      }

      // No range - return full file (truncated at maxLines)
      const truncated = allLines.length > maxLines;
      const outputContent = truncated
        ? allLines.slice(0, maxLines).join('\n') +
          `\n... (truncated at ${maxLines} of ${totalLines} lines)`
        : content;

      logTool.end(invocationId, {
        success: true,
        lines: allLines.length,
        truncated,
      });
      return {
        success: true,
        content: outputContent,
        lines: truncated ? maxLines : allLines.length,
        totalLines,
        truncated,
      };
    } catch (error) {
      const classified = classifyError(error);
      logTool.end(invocationId, { success: false, error: classified.message });
      return {
        success: false,
        error: classified.message,
        errorType: classified.errorType,
        retryable: classified.retryable,
      };
    }
  },
});
