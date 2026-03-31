/* eslint-disable */
// @ts-nocheck
/**
 * Native ONTAP Discover tool — deterministic API/SMF/CLI discovery.
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { logTool } from '../lib/logger.js';
import { handleDiscoverDocs } from './discovery-tool.js';
import type { DiscoverDocsArgs } from './discovery-tool.js';

export const ontapDiscoverTool = createTool({
  id: 'ontap_discover',
  description:
    'Deterministic ONTAP API discovery — structured lookup across REST endpoints, SMF tables, and CLI commands.',
  inputSchema: {} as any,
  execute: async (input: DiscoverDocsArgs) => {
    const invocationId = logTool.start('ontap_discover', {
      action: input.action,
      query: input.query,
      tableName: input.tableName,
      path: input.path,
    });
    const start = Date.now();
    try {
      const result = await handleDiscoverDocs(input);
      const duration = Date.now() - start;
      logTool.end(invocationId, { success: true, duration: `${duration}ms` });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logTool.end(invocationId, { success: false, error: message });
      return { success: false, error: message };
    }
  },
});
