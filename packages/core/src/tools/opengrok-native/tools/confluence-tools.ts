/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Confluence Tools — native wrapper for get_confluence_page.
 *
 * Delegates directly to the vendored confluence-client lib for REST API calls.
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { z } from '../lib/zod-shim.js';
import {
  getConfluencePage,
  isConfluenceConfigured,
  isConfluenceError,
} from '../lib/confluence-client.js';
import { TOOL_DESCRIPTIONS } from '../prompts/index.js';
import { logTool } from '../lib/logger.js';

// Simple HTML-to-text converter for Confluence storage format
function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '')
    .replace(
      /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|thead|tbody)[^>]*>/gi,
      '\n',
    )
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============================================================================
// Tool: get_confluence_page
// ============================================================================

const getConfluencePageTool = createTool({
  id: 'get_confluence_page',
  description: TOOL_DESCRIPTIONS.get_confluence_page,

  inputSchema: z.object({
    page_id: z.string().describe('Confluence page ID'),
  }),

  execute: async (input) => {
    const invocationId = logTool.start('get_confluence_page', input);

    if (!isConfluenceConfigured()) {
      const msg = 'CONFLUENCE_TOKEN not set.';
      logTool.end(invocationId, { success: false, error: msg });
      return { success: false, error: msg };
    }

    try {
      const pageId = input.page_id;
      logTool.step('get_confluence_page', 'fetching page', { pageId });

      const result = await getConfluencePage(pageId);

      if (isConfluenceError(result)) {
        logTool.end(invocationId, {
          success: false,
          error: result.message,
        });
        return { success: false, error: result.message };
      }

      const content = htmlToText(result.html);

      logTool.end(invocationId, {
        success: true,
        pageId,
        title: result.title,
      });

      return {
        success: true,
        id: result.id,
        title: result.title,
        url: result.url,
        space: result.spaceKey,
        content,
        version: result.version,
        lastModified: result.lastModified,
        lastModifiedBy: result.lastModifiedBy,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logTool.end(invocationId, { success: false, error: message });
      return { success: false, error: message };
    }
  },
});

// ============================================================================
// Factory
// ============================================================================

export function createConfluenceTools() {
  return {
    get_confluence_page: getConfluencePageTool,
  };
}
