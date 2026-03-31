/* eslint-disable */
// @ts-nocheck
/**
 * MCP Tool: discover_ontap_docs
 *
 * Unified discovery across Swagger, SMF, and Private CLI
 */

import {
  initializeMegaDocsIndex,
  getIndex,
  getStats,
} from './index-builder.js';
import { generateCurlExample, cliCommandToRest } from './private-cli-mapper.js';
import {
  isQueryable,
  canDebugSmdbShow,
  canDebugSmdbPost,
  isActionTable,
} from './smf-global-parser.js';
import { CliTree } from './cli-tree.js';
import { getFileContent } from '../lib/opengrok.js';
import type {
  UnifiedEndpoint,
  SmfTableInfo,
  SearchEntry,
  SmfField,
  MegaDocsIndex,
} from './types.js';

// ============================================================================
// Input Schema
// ============================================================================

export interface DiscoverDocsArgs {
  action:
    | 'search'
    | 'get_endpoint'
    | 'get_smf_table'
    | 'get_command'
    | 'browse_cli'
    | 'list_debug_smdb_tables'
    | 'list_tags'
    | 'list_domains'
    | 'cli_to_rest'
    | 'options'
    | 'stats';
  query?: string;
  limit?: number;
  domain?: string;
  source?: 'swagger' | 'smf-rest' | 'smf-debug' | 'private-cli' | 'smf-action';
  queryableOnly?: boolean;
  debugSmdbOnly?: boolean;
  path?: string;
  method?: string;
  tableName?: string;
  cliCommand?: string;
  cliPath?: string;
  includeCurl?: boolean;
  clusterIp?: string;
  includeExamples?: boolean;
}

// ============================================================================
// Handler
// ============================================================================

export async function handleDiscoverDocs(args: DiscoverDocsArgs): Promise<any> {
  await initializeMegaDocsIndex();
  const index = getIndex();

  switch (args.action) {
    case 'search':
      return handleSearch(args, index);

    case 'get_endpoint':
      return await handleGetEndpoint(args, index);

    case 'get_smf_table':
      return handleGetSmfTable(args, index);

    case 'get_command':
      return handleGetCommand(args, index);

    case 'browse_cli':
      return await handleBrowseCli(args);

    case 'list_debug_smdb_tables':
      return handleListDebugSmdbTables(args, index);

    case 'list_tags':
      return { tags: [...index.byTag.keys()].sort() };

    case 'list_domains':
      return { domains: [...index.byDomain.keys()].sort() };

    case 'cli_to_rest':
      return await handleCliToRest(args, index);

    case 'options':
      return handleOptions(args, index);

    case 'stats':
      return getStats();

    default:
      return { error: `Unknown action: ${args.action}` };
  }
}

// ============================================================================
// Search Handler
// ============================================================================

function handleSearch(args: DiscoverDocsArgs, index: MegaDocsIndex) {
  if (!args.query) {
    return {
      error: 'query required for search',
      results: [],
      total: 0,
      query: args.query,
    };
  }

  const queryLower = args.query.toLowerCase().trim();
  const queryTokens = [
    ...new Set(
      queryLower
        .split(/[^a-z0-9]+/g)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2),
    ),
  ];

  // Detect intent from query
  const intent = detectIntent(queryLower);

  // Score and filter entries
  const results: Array<{
    endpoint: UnifiedEndpoint;
    score: number;
    match: string[];
  }> = [];

  for (const entry of index.searchIndex) {
    // Apply filters
    if (args.domain && entry.domain !== args.domain) continue;
    if (args.source && entry.source !== args.source) continue;

    const endpoint = index.endpoints.get(entry.id);
    if (!endpoint) continue;

    if (args.queryableOnly && !endpoint.queryable) continue;
    if (
      args.debugSmdbOnly &&
      (!endpoint.accessPatterns || !endpoint.accessPatterns.debugSmdb)
    )
      continue;

    // Calculate score
    let score = 0;
    const match: string[] = [];

    const pathText = [endpoint.path, endpoint.privatePath, endpoint.debugPath]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const pathSegments = new Set(
      pathText
        .replace(/[{}]/g, '')
        .split(/[^a-z0-9]+/g)
        .filter(Boolean),
    );

    const summaryText = (endpoint.summary || '').toLowerCase();
    const cliText = (endpoint.cliCommand || '').toLowerCase();
    const tableText = (endpoint.smfTable?.tableName || '')
      .toLowerCase()
      .replace(/_/g, ' ');
    const denseText =
      `${pathText} ${summaryText} ${cliText} ${tableText}`.replace(
        /[^a-z0-9]+/g,
        '',
      );

    for (const token of queryTokens) {
      const inPath = pathSegments.has(token);
      const inSummary = summaryText.includes(token);
      const inCli = cliText.includes(token);
      const inTable = tableText.includes(token);
      const inDense = token.length >= 4 && denseText.includes(token);

      if (inPath) {
        score += 30;
        match.push(`path:${token}`);
      }
      if (inSummary) {
        score += 20;
        match.push(`summary:${token}`);
      }
      if (inCli) {
        score += 15;
        match.push(`cli:${token}`);
      }
      if (inTable) {
        score += 15;
        match.push(`smf:${token}`);
      }
      if (!inPath && !inSummary && !inCli && !inTable && inDense) {
        score += 10;
        match.push(`dense:${token}`);
      }

      // Fallback: use the index's pre-built token set and full text
      // (critical for short tokens like 'CPS', 'JOB', domain prefixes)
      if (entry.tokens.has(token)) {
        score += 10;
        match.push(`token:${token}`);
      }
      if (entry.text.includes(token)) {
        score += 5;
        match.push(`text:${token}`);
      }
    }

    // Phrase bonus (helps short queries)
    if (queryLower.length >= 4) {
      const haystack = `${pathText} ${summaryText} ${cliText} ${tableText}`;
      if (haystack.includes(queryLower)) {
        score += 25;
        match.push('phrase');
      }
    }

    // Apply intent boost
    if (intent.methods.length > 0) {
      const epMethod = Array.isArray(endpoint.method)
        ? endpoint.method[0]
        : endpoint.method;
      if (intent.methods.includes(epMethod)) {
        score *= 1.5;
      }
    }

    // Prefer public REST endpoints for generic keyword searches
    if (endpoint.source === 'swagger') score *= 1.15;

    // Heuristic: if the query is a single resource token (e.g., "nodes"),
    // strongly prefer the swagger endpoint that contains that path segment.
    if (queryTokens.length === 1) {
      const token = queryTokens[0];
      if (endpoint.source === 'swagger' && pathSegments.has(token)) {
        score += 80;
        match.push('swagger_resource');
      }
      if (
        endpoint.domain === 'test' ||
        endpoint.path.includes('/api/private/cli/test/')
      ) {
        score = Math.floor(score * 0.2);
      }
    }

    // For single generic tokens, down-weight if no structured match found.
    if (queryTokens.length === 1 && score > 0) {
      const strongMatch = match.some(
        (m) =>
          m.startsWith('path:') ||
          m.startsWith('summary:') ||
          m.startsWith('cli:') ||
          m.startsWith('smf:'),
      );
      if (!strongMatch) {
        score = Math.floor(score * 0.5);
      }
    }

    if (score > 0) {
      results.push({ endpoint, score, match });
    }
  }

  // Sort by score and limit
  results.sort((a, b) => b.score - a.score);
  const requested = args.limit ?? 10;
  const limited = results.slice(0, requested);

  // Summarize overall match distribution without returning huge result sets
  const bySource: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  for (const r of results) {
    bySource[r.endpoint.source] = (bySource[r.endpoint.source] || 0) + 1;
    byDomain[r.endpoint.domain] = (byDomain[r.endpoint.domain] || 0) + 1;
  }

  const refineSuggestions: Array<{
    args: Record<string, any>;
    reason: string;
  }> = [];
  if ((bySource.swagger || 0) > 0) {
    refineSuggestions.push({
      args: { query: args.query, source: 'swagger', limit: requested },
      reason: 'Focus on supported public REST endpoints',
    });
  }
  if (queryTokens.length === 1 && queryTokens[0] === 'nodes') {
    refineSuggestions.push({
      args: {
        query: 'nodes',
        source: 'swagger',
        domain: 'cluster',
        limit: requested,
      },
      reason: 'Cluster node REST resources',
    });
  }
  if (args.domain === 'keymanager') {
    refineSuggestions.push({
      args: {
        query: 'key-manager',
        source: 'swagger',
        domain: 'security',
        limit: requested,
      },
      reason:
        'Key management public REST endpoints live under the security domain',
    });
  }

  const swaggerHighlights = searchSwaggerHighlights(queryLower, index, 5);
  const nextCalls: Array<{
    action: string;
    args: Record<string, any>;
    reason: string;
  }> = [];
  if (results.length > limited.length) {
    nextCalls.push({
      action: 'search',
      args: {
        query: args.query,
        ...(args.domain ? { domain: args.domain } : {}),
        limit: Math.min(50, Math.max(requested, limited.length * 4)),
      },
      reason: 'Get a larger result page',
    });
  }
  if ((bySource.swagger || 0) > 0) {
    nextCalls.push({
      action: 'search',
      args: {
        query: args.query,
        source: 'swagger',
        limit: Math.min(50, Math.max(requested, limited.length * 4)),
      },
      reason: 'Return only public REST (swagger) endpoints',
    });
  }

  // Generate curl templates for actionability
  const hasSwagger =
    (bySource.swagger || 0) > 0 || swaggerHighlights.length > 0;
  const curlTemplates = hasSwagger
    ? {
        getExample:
          'curl -k -u admin:$PASS "https://$CLUSTER/api{path}?fields=*"',
        postExample:
          'curl -k -u admin:$PASS -X POST -H "Content-Type: application/json" -d \'{"key":"value"}\' "https://$CLUSTER/api{path}"',
        note: 'Replace {path} with any path from swaggerHighlights or results where source=swagger',
      }
    : undefined;

  return {
    query: args.query,
    intent: intent.methods.length > 0 ? { methods: intent.methods } : undefined,
    total: results.length,
    returned: limited.length,
    moreAvailable: Math.max(0, results.length - limited.length),
    // Put actionability hints EARLY so they're not truncated
    curlTemplates,
    tip: 'Use action="get_endpoint" with the returned path+method for full schema/curl. Use action="get_smf_table" with smfTable when present.',
    summary: {
      bySource,
      topDomains: Object.entries(byDomain)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([domain, count]) => ({ domain, count })),
    },
    refineSuggestions:
      refineSuggestions.length > 0 ? refineSuggestions : undefined,
    swaggerHighlights:
      swaggerHighlights.length > 0 ? swaggerHighlights : undefined,
    nextCalls: nextCalls.length > 0 ? nextCalls : undefined,
    results: limited.map((r) => formatSearchResult(r.endpoint, r.match)),
  };
}

function detectIntent(query: string): { methods: string[] } {
  const methods: string[] = [];

  if (/\b(create|add|new|enable|setup)\b/i.test(query)) methods.push('POST');
  if (/\b(list|show|get|view|display|query)\b/i.test(query))
    methods.push('GET');
  if (/\b(update|change|modify|set)\b/i.test(query)) methods.push('PATCH');
  if (/\b(delete|remove|disable)\b/i.test(query)) methods.push('DELETE');

  return { methods };
}

// ============================================================================
// Get Endpoint Handler
// ============================================================================

async function handleGetEndpoint(args: DiscoverDocsArgs, index: MegaDocsIndex) {
  if (!args.path) {
    return {
      error: 'path required for get_endpoint',
      path: '',
      method: args.method?.toUpperCase() || 'GET',
      domain: 'unknown',
    };
  }

  const method = args.method?.toUpperCase() || 'GET';
  let endpoint: UnifiedEndpoint | undefined;

  // 1. Try exact swagger ID (path as-is)
  endpoint = index.endpoints.get(`swagger:${method}:${args.path}`);

  // 2. Try without /api/ prefix (common agent mistake)
  if (!endpoint && args.path.startsWith('/api/')) {
    const stripped = args.path.replace(/^\/api/, '');
    endpoint = index.endpoints.get(`swagger:${method}:${stripped}`);
  }

  // 3. Try with /api/ prefix added (in case paths are stored with it)
  if (!endpoint && !args.path.startsWith('/api/')) {
    endpoint = index.endpoints.get(`swagger:${method}:/api${args.path}`);
  }

  // 4. Try resolving via CLI command cross-reference
  if (!endpoint && args.path) {
    const cmdLower = args.path.toLowerCase();
    // Maybe the "path" is actually a CLI command like "volume show"
    const epId = index.byCliCommand.get(cmdLower);
    if (epId) {
      endpoint = index.endpoints.get(epId);
    }
  }

  // 5. Try iterating all endpoints for path match
  if (!endpoint) {
    for (const ep of index.endpoints.values()) {
      if (
        ep.path === args.path ||
        ep.privatePath === args.path ||
        ep.debugPath === args.path
      ) {
        endpoint = ep;
        break;
      }
    }
  }

  if (!endpoint) {
    // Provide fuzzy suggestions
    const suggestions = findSimilarEndpoints(args.path, index, 5);
    return {
      error: `Endpoint not found: ${method} ${args.path}`,
      path: args.path,
      method,
      domain: 'unknown',
      hint: 'Swagger paths do NOT include /api/ prefix. Example: /storage/volumes, not /api/storage/volumes',
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      tip: 'Use action="search" with a query to find endpoints by keyword.',
    };
  }

  // Enrich with CLI examples — ONLY the related commands from swagger, not the whole table
  const enrichment: Record<string, any> = {};
  const cliCmds =
    endpoint.relatedCliCommands ||
    (endpoint.cliCommand ? [endpoint.cliCommand] : []);

  if (cliCmds.length > 0) {
    try {
      const { getHelpForCliCommand } = await import('./help-xml-search.js');
      const cmdDetails = await Promise.all(
        cliCmds.slice(0, 3).map((cmd) => getHelpForCliCommand(cmd)),
      );
      const found = cmdDetails.filter(Boolean);
      if (found.length > 0) {
        enrichment.cliCommands_detail = found.map((cmd) => ({
          name: cmd!.name,
          description: cmd!.description?.slice(0, 200) || '',
          restEndpoint: cmd!.restEndpoint,
          httpMethod: cmd!.httpMethod,
          curlExample: cmd!.curlExample,
          parameters: cmd!.parameters.slice(0, 10).map((p: any) => ({
            name: p.name,
            description: p.description?.slice(0, 120) || '',
            ...(p.defaultValue ? { defaultValue: p.defaultValue } : {}),
          })),
          examples: cmd!.examples.slice(0, 3).map((ex: any) => ({
            command: ex.command,
            description: ex.description?.slice(0, 120) || '',
          })),
        }));
      }
    } catch {
      /* OpenGrok offline — degrade gracefully */
    }
  }

  // Use swaggerToSmf cross-ref for richer SMF detail when available
  const smfTableNames = index.swaggerToSmf.get(endpoint.id) || [];
  if (smfTableNames.length > 0 && !endpoint.smfTable) {
    const table = index.smfTables.get(smfTableNames[0]);
    if (table) {
      enrichment.smfTableDetail = {
        tableName: table.tableName,
        storage: table.storage,
        queryable: canDebugSmdbShow(table),
        fields: table.fields.map((f) => ({
          name: f.name,
          type: f.type,
          role: f.role,
        })),
        keyFields: table.keyFields,
      };
    }
  }

  // Add parameter hints for endpoints with path parameters
  const hints = index.parameterHints.get(endpoint.id);
  if (hints && hints.length > 0) {
    enrichment.parameterHints = hints;
  }

  return { ...formatEndpointDetails(endpoint, args), ...enrichment };
}

// ============================================================================
// Get SMF Table Handler
// ============================================================================

async function handleGetSmfTable(args: DiscoverDocsArgs, index: MegaDocsIndex) {
  if (!args.tableName) {
    return {
      error: 'tableName required for get_smf_table',
      tableName: '',
      storage: 'unknown',
      fields: [],
      accessPatterns: emptyAccessPatterns(),
    };
  }

  // 1. Try exact match, then lowercase, then dashes→underscores
  let table = index.smfTables.get(args.tableName);
  if (!table) {
    const lower = args.tableName.toLowerCase();
    table = index.smfTables.get(lower);
  }
  if (!table) {
    const normalized = args.tableName.toLowerCase().replace(/-/g, '_');
    table = index.smfTables.get(normalized);
  }
  // 1b. Case-insensitive scan (handles camelCase like CryptomodStatus → cryptomodStatus)
  if (!table) {
    const inputLower = args.tableName.toLowerCase();
    for (const [key, val] of index.smfTables) {
      if (key.toLowerCase() === inputLower) {
        table = val;
        break;
      }
    }
  }

  // 2. Try resolving via CLI command cross-reference
  //    Agent might pass "volume show" or "volume" as tableName
  if (!table) {
    const cmdLower = args.tableName.toLowerCase();
    const tableNames = index.cliToSmfTables.get(cmdLower);
    if (tableNames && tableNames.length > 0) {
      table = index.smfTables.get(tableNames[0]);
      // If multiple tables match, return them all as options
      if (tableNames.length > 1) {
        return {
          resolvedViaCliCommand: cmdLower,
          note: `CLI command "${args.tableName}" maps to ${tableNames.length} SMF tables. Showing first.`,
          tables: tableNames,
          ...(table ? await buildSmfTableResponse(table, args, index) : {}),
        };
      }
    }
  }

  // 3. Try substring search over known table names
  //    Only if the input looks like a valid table name (alphanumeric + underscores)
  if (!table) {
    const normalized = args.tableName.toLowerCase().replace(/-/g, '_');
    const sanitized = normalized.replace(/[^a-z0-9_]/g, '');
    if (sanitized.length >= 3) {
      const matches: string[] = [];
      for (const name of index.smfTables.keys()) {
        const nameLower = name.toLowerCase();
        // Exact substring: input contains name or name contains input
        // Guard: require matched name to be at least 40% of input length
        // to prevent short names (e.g. "crs") matching long fuzzed inputs
        if (
          nameLower.includes(sanitized) ||
          (sanitized.includes(nameLower) &&
            nameLower.length >= sanitized.length * 0.4)
        ) {
          matches.push(name);
          if (matches.length >= 10) break;
        }
      }
      if (matches.length === 1) {
        table = index.smfTables.get(matches[0]);
      } else if (matches.length > 1) {
        return {
          error: `SMF table not found: "${args.tableName}"`,
          tableName: sanitized,
          storage: 'unknown',
          fields: [],
          accessPatterns: emptyAccessPatterns(),
          hint: `Found ${matches.length} tables containing "${sanitized}". Use an exact name:`,
          suggestions: matches.slice(0, 10),
        };
      }
    }
  }

  if (!table) {
    const suggestions = findSimilarTableNames(args.tableName, index, 5);
    return {
      error: `SMF table not found: "${args.tableName}"`,
      tableName: args.tableName.toLowerCase().replace(/-/g, '_'),
      storage: 'unknown',
      fields: [],
      accessPatterns: emptyAccessPatterns(),
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      tip: 'Use action="search" with a keyword to discover table names, or pass a CLI command (e.g., "volume show") to resolve via cross-reference.',
    };
  }

  return buildSmfTableResponse(table, args, index);
}

// ============================================================================
// Build SMF Table Response (shared by get_smf_table and get_command)
// ============================================================================

async function buildSmfTableResponse(
  table: SmfTableInfo,
  args: DiscoverDocsArgs,
  index: MegaDocsIndex,
) {
  const queryable = isQueryable(table);
  const debugSmdbQueryable = canDebugSmdbShow(table);
  const debugSmdbPostable = canDebugSmdbPost(table);

  // Build access patterns
  const hasCliMapping = !!(
    table.command ||
    (table.cliCommands && table.cliCommands.length > 0)
  );
  const accessPatterns = {
    publicRest: table.attributes.rest === true,
    privateCli: hasCliMapping,
    debugSmdb: debugSmdbQueryable || debugSmdbPostable,
  };

  // Cross-reference: related swagger endpoints
  const relatedSwaggerPaths = index.smfToSwagger.get(table.tableName) || [];
  const relatedSwaggerEndpoints = relatedSwaggerPaths
    .map((path) => index.endpoints.get(path))
    .filter(Boolean)
    .map((ep) => ({
      method: ep!.method,
      path: ep!.path,
      summary: ep!.summary,
      ...(ep!.introducedVersion
        ? { introducedVersion: ep!.introducedVersion }
        : {}),
      ...(ep!.crossClusterProxy ? { crossClusterProxy: true } : {}),
    }));

  // Cross-validate SMF field roles against swagger access modifiers
  const fieldRoleCrossValidation = buildFieldRoleCrossValidation(
    table,
    relatedSwaggerPaths,
    index,
  );

  // For methods-only tables (0 fields), synthesize fields from method arguments
  // so consumers always get a non-empty fields array for tables with an interface
  const synthesizedFields =
    table.fields.length === 0 &&
    table.extrinsicMethods &&
    table.extrinsicMethods.length > 0
      ? synthesizeFieldsFromMethods(table.extrinsicMethods)
      : undefined;
  // Return canonical fields only — no snake/camel alias expansion.
  // This keeps responses compact (e.g. volume: 340 fields vs 1,020 with aliases).
  const effectiveFields =
    table.fields.length > 0
      ? table.fields.map((f) => ({
          name: f.name,
          type: f.type || 'unknown',
          role: f.role || 'data',
          required: !f.prefixes.optional,
        }))
      : synthesizedFields || [];
  const effectiveFieldCount =
    table.fields.length > 0
      ? table.fields.length
      : synthesizedFields?.length || 0;

  const response: any = {
    tableName: table.tableName,
    tableType: table.tableType,
    description: table.description,
    storage: table.storage,
    accessPatterns,
    queryable,
    isActionOnly: isActionTable(table),
    queryMethod: debugSmdbPostable
      ? 'POST /api/private/cli/debug/smdb/table/' + table.tableName
      : queryable
        ? 'GET /api/private/cli/debug/smdb/table/' + table.tableName
        : null,
    // CLI commands from SMF parser
    cliCommands: table.cliCommands.length > 0 ? table.cliCommands : undefined,
    command: table.command || undefined,
    // Cross-referenced swagger endpoints
    relatedSwaggerEndpoints:
      relatedSwaggerEndpoints.length > 0 ? relatedSwaggerEndpoints : undefined,
    // SMF↔Swagger field role cross-validation
    fieldRoleCrossValidation: fieldRoleCrossValidation || undefined,
    ...(debugSmdbQueryable || debugSmdbPostable
      ? {
          debugSmdbInfo: {
            tableName: table.tableName,
            path: `/api/private/cli/debug/smdb/table/${table.tableName}`,
            method: debugSmdbPostable ? 'POST' : 'GET',
            requiresNode: table.storage === 'mdb',
            requiresVserver: table.attributes.vserverEnabled === true,
            curlExample: generateDebugSmdbCurl(table, args.clusterIp),
          },
        }
      : {}),
    fieldCount: effectiveFieldCount,
    fields: effectiveFields,
    keyFields: table.keyFields,
    generatedMethodCount: table.generatedMethods.length,
    generatedMethods: table.generatedMethods.slice(0, 25),
    extrinsicMethodCount: table.extrinsicMethods?.length || 0,
    extrinsicMethods: table.extrinsicMethods?.slice(0, 10).map((m) => ({
      name: m.name,
      description: m.description,
      privilege: m.privilege,
      command: m.command,
      attributes: m.attributes,
      argCount: m.args.length,
    })),
    attributes: table.attributes,
  };

  response.operationalNotes = [
    // CRITICAL: fields= parameter requirement for debug smdb tables
    queryable && !isActionTable(table)
      ? 'IMPORTANT: Private CLI debug smdb tables only return key fields by default. You MUST pass fields=<field1,field2,...> to get non-key field values. fields=* is NOT supported. Use field names from the fields array.'
      : null,
    table.storage === 'replicated' && !isActionTable(table)
      ? 'Cluster-wide replicated table — data consistent across nodes.'
      : null,
    table.storage === 'replicated' && isActionTable(table)
      ? 'Action table with replicated storage — invoke via POST on debug SMDB path (GET returns "invalid operation").'
      : null,
    table.storage === 'mdb' && !isActionTable(table)
      ? 'Node-local MDB table — must specify -node parameter; data varies per node.'
      : null,
    table.storage === 'mdb' && isActionTable(table)
      ? 'Action table with MDB storage — invoke via POST on debug SMDB path; may need -node.'
      : null,
    table.storage === 'ksmf-server' && !isActionTable(table)
      ? 'Kernel SMF server table — queryable via GET on debug smdb path.'
      : null,
    table.storage === 'ksmf-server' && isActionTable(table)
      ? 'Kernel SMF action table — invoke via POST on debug SMDB path (GET returns "invalid operation"). Write-role fields go in POST body; read-role fields are returned in response.'
      : null,
    table.storage === 'ksmf-client'
      ? 'Kernel SMF client table — NOT directly queryable; use related CLI commands.'
      : null,
    table.storage === 'persistent' && !isActionTable(table)
      ? 'Persistent local storage table — queryable via GET on debug smdb path.'
      : null,
    table.storage === 'persistent' && isActionTable(table)
      ? 'Action table with persistent storage — invoke via POST on debug SMDB path.'
      : null,
    table.storage === 'action'
      ? 'Action table — no persistent storage; triggers an operation when POSTed via private CLI path.'
      : null,
    table.attributes.rest
      ? 'Has public REST endpoint — prefer the swagger API over private CLI.'
      : null,
    table.attributes.vserverEnabled
      ? 'Vserver-scoped — requires vserver context for queries.'
      : null,
    table.keyFields.length > 0
      ? `Primary key: ${table.keyFields.join(', ')}`
      : null,
  ].filter(Boolean);

  response.privateCliPath = `/api/private/cli/debug/smdb/table/${table.tableName}`;

  if (relatedSwaggerEndpoints.length > 0) {
    const basePath = relatedSwaggerEndpoints[0].path;
    response.relatedSubResources = listRelatedSwaggerEndpoints(
      basePath,
      index,
      5,
    );
  }

  // ========================================================================
  // AUTO-FETCH FROM OPENGROK (deterministic enrichment)
  // ========================================================================

  // 1. Fetch help XMLs for CLI examples
  try {
    const { searchHelpXmls } = await import('./help-xml-search.js');
    const helpResult = await searchHelpXmls({
      tableName: table.tableName,
      includeRest: true,
      maxResults: 5,
    });

    if (helpResult.success && helpResult.commands.length > 0) {
      // Compact per-command detail: limit to 3 commands, truncate descriptions
      const cmds = helpResult.commands.slice(0, 3);
      response.cliCommands_detail = cmds.map((cmd) => ({
        name: cmd.name,
        description: cmd.description?.slice(0, 200) || '',
        restEndpoint: cmd.restEndpoint,
        httpMethod: cmd.httpMethod,
        curlExample: cmd.curlExample,
        parameters: cmd.parameters.slice(0, 10).map((p: any) => ({
          name: p.name,
          description: p.description?.slice(0, 120) || '',
          ...(p.defaultValue ? { defaultValue: p.defaultValue } : {}),
        })),
        examples: cmd.examples.slice(0, 3).map((ex: any) => ({
          command: ex.command,
          description: ex.description?.slice(0, 120) || '',
        })),
      }));
      response.helpXmlCommandCount = helpResult.commands.length;
      if (helpResult.commands.length > cmds.length) {
        response.helpXmlMoreCommands = helpResult.commands.length - cmds.length;
      }
    }
  } catch (err) {
    response.helpXmlError = `OpenGrok help XML fetch failed: ${err}`;
  }

  // 2. Fetch SMF source for enum definitions
  try {
    const { getSmfSourceForTable } = await import('./smf-source-parser.js');
    const sourceResult = await getSmfSourceForTable({
      tableName: table.tableName,
      includeEnums: true,
      includeTypes: true,
    });

    if (sourceResult.success && sourceResult.sourceInfo) {
      if (sourceResult.sourceInfo.enums.length > 0) {
        response.enumDefinitions = sourceResult.sourceInfo.enums
          .slice(0, 10)
          .map((e) => ({
            name: e.name,
            displayName: e.displayName,
            values: e.values.slice(0, 10).map((v) => ({
              name: v.name,
              value: v.value,
              description: v.description,
            })),
            totalValues: e.values.length,
          }));
      }

      if (sourceResult.sourceInfo.types.length > 0) {
        response.typeDefinitions = sourceResult.sourceInfo.types
          .filter((t) => t.constraints)
          .slice(0, 10)
          .map((t) => ({
            name: t.name,
            baseType: t.baseType,
            constraints: t.constraints,
          }));
      }

      response.smfSourceFile = sourceResult.sourceFile;
    }
  } catch (err) {
    response.smfSourceError = `OpenGrok SMF source fetch failed: ${err}`;
  }

  return response;
}

/**
 * For methods-only tables (0 regular fields), synthesize fields from method arguments.
 * Deduplicates by argument name so repeated args across methods appear only once.
 */
function synthesizeFieldsFromMethods(
  methods: SmfTableInfo['extrinsicMethods'],
): Array<{
  name: string;
  type: string;
  role: string;
  description: string;
  required: boolean;
}> {
  if (!methods || methods.length === 0) return [];
  const seen = new Set<string>();
  const fields: Array<{
    name: string;
    type: string;
    role: string;
    description: string;
    required: boolean;
  }> = [];
  for (const m of methods) {
    for (const arg of m.args) {
      const name = arg.name.replace(/-/g, '_');
      if (seen.has(name)) continue;
      seen.add(name);
      fields.push({
        name,
        type: arg.type || 'unknown',
        role: arg.role === 'in' || arg.role === 'in-noread' ? 'write' : 'read',
        description: arg.description || '',
        required: false,
      });
    }
  }
  return fields;
}

function emptyAccessPatterns() {
  return { publicRest: false, privateCli: false, debugSmdb: false };
}

// ============================================================================
// Get Command Handler (Unified lookup with CLI examples via cross-ref)
// ============================================================================

async function handleGetCommand(args: DiscoverDocsArgs, index: MegaDocsIndex) {
  let table: SmfTableInfo | undefined;
  let endpoint: UnifiedEndpoint | undefined;
  let resolvedVia: string | undefined;

  // 1. Resolve by cliCommand using cross-ref maps
  if (args.cliCommand) {
    const cmdLower = args.cliCommand.toLowerCase().trim();

    // Direct lookup in byCliCommand index
    const epId = index.byCliCommand.get(cmdLower);
    if (epId) {
      endpoint = index.endpoints.get(epId);
      resolvedVia = 'byCliCommand';
    }

    // Also find SMF tables mapped to this CLI command
    const tableNames = index.cliToSmfTables.get(cmdLower);
    if (tableNames && tableNames.length > 0) {
      table = index.smfTables.get(tableNames[0]);
      resolvedVia = resolvedVia || 'cliToSmfTables';
    }

    // Fallback: try without verb (e.g., "volume show" -> "volume")
    if (!table && !endpoint) {
      const verbs = [
        'show',
        'create',
        'modify',
        'delete',
        'enable',
        'disable',
        'start',
        'stop',
      ];
      const parts = cmdLower.split(/\s+/);
      const baseCmd = parts.filter((p) => !verbs.includes(p)).join(' ');
      if (baseCmd !== cmdLower) {
        // Try base command in cross-ref maps
        const baseEpId = index.byCliCommand.get(baseCmd);
        if (baseEpId) {
          endpoint = index.endpoints.get(baseEpId);
          resolvedVia = 'byCliCommand (base)';
        }
        const baseTables = index.cliToSmfTables.get(baseCmd);
        if (baseTables && baseTables.length > 0) {
          table = index.smfTables.get(baseTables[0]);
          resolvedVia = resolvedVia || 'cliToSmfTables (base)';
        }
      }
    }
  }

  // 2. Resolve by path
  if (!table && !endpoint && args.path) {
    const pathLower = args.path.toLowerCase();
    endpoint = index.endpoints.get(pathLower);
    if (!endpoint) {
      // Try stripping/adding /api/ prefix
      const stripped = pathLower.replace(/^\/api\//, '/');
      const prefixed = pathLower.startsWith('/api/')
        ? pathLower
        : `/api${pathLower}`;
      for (const ep of index.endpoints.values()) {
        if (
          ep.path === pathLower ||
          ep.path === stripped ||
          ep.path === prefixed ||
          ep.privatePath === pathLower ||
          ep.debugPath === pathLower
        ) {
          endpoint = ep;
          break;
        }
      }
    }
    if (endpoint?.smfTable) {
      table = index.smfTables.get(endpoint.smfTable.tableName);
    }
    resolvedVia = endpoint ? 'path' : undefined;
  }

  // 3. Resolve by tableName
  if (!table && args.tableName) {
    table =
      index.smfTables.get(args.tableName) ||
      index.smfTables.get(args.tableName.toLowerCase()) ||
      index.smfTables.get(args.tableName.toLowerCase().replace(/-/g, '_'));
    resolvedVia = table ? 'tableName' : undefined;
  }

  if (!table && !endpoint) {
    return {
      error:
        'Could not resolve command. Provide cliCommand, tableName, or path.',
      resolvedVia: 'unresolved',
      tip: 'Use action="search" to find the right table or endpoint first.',
      availableCliCommands: args.cliCommand
        ? findSimilarCliCommands(args.cliCommand, index, 5)
        : undefined,
    };
  }

  // Build response: merge endpoint details + SMF table details
  const response: any = {
    resolvedVia,
    ...(endpoint ? formatEndpointDetails(endpoint, args) : {}),
  };

  // If we have a table, add full SMF info via buildSmfTableResponse
  if (table) {
    const tableResponse = await buildSmfTableResponse(table, args, index);
    Object.assign(response, tableResponse);
    response.cliCommand =
      args.cliCommand || table.command || table.cliCommands[0] || undefined;
  }

  // Fetch CLI examples from help XMLs — only if buildSmfTableResponse didn't already find them
  if (
    !response.cliCommands_detail ||
    response.cliCommands_detail.length === 0
  ) {
    try {
      const { searchHelpXmls } = await import('./help-xml-search.js');
      const searchQuery =
        args.cliCommand ||
        table?.command ||
        table?.cliCommands[0] ||
        (table?.tableName ? table.tableName.replace(/_/g, ' ') : undefined);

      if (searchQuery) {
        const helpResult = await searchHelpXmls({
          query: searchQuery,
          includeRest: true,
          maxResults: 10,
        });

        if (helpResult.success && helpResult.commands.length > 0) {
          // Compact: limit to 3 commands, truncate descriptions
          const cmds = helpResult.commands.slice(0, 3);
          response.cliCommands_detail = cmds.map((cmd) => ({
            name: cmd.name,
            description: cmd.description?.slice(0, 200) || '',
            restEndpoint: cmd.restEndpoint,
            httpMethod: cmd.httpMethod,
            curlExample: cmd.curlExample,
            parameters: cmd.parameters.slice(0, 10).map((p: any) => ({
              name: p.name,
              description: p.description?.slice(0, 120) || '',
              ...(p.defaultValue ? { defaultValue: p.defaultValue } : {}),
            })),
            examples: cmd.examples.slice(0, 3).map((ex: any) => ({
              command: ex.command,
              description: ex.description?.slice(0, 120) || '',
            })),
          }));

          response.curlWithExample = helpResult.commands[0]?.curlExample;
          response.matchedCommands = helpResult.commands
            .map((c) => c.name)
            .slice(0, 5);
        }
      }
    } catch (err) {
      response.examplesError = `Failed to fetch help XMLs: ${err}`;
    }
  }

  return response;
}

// ============================================================================
// List Debug SMDB Tables Handler
// ============================================================================

function handleListDebugSmdbTables(
  args: DiscoverDocsArgs,
  index: MegaDocsIndex,
) {
  // Filter tables that are debug smdb queryable (GET) or POST-invokable (action tables)
  const queryableTables: SmfTableInfo[] = [];

  for (const table of index.smfTables.values()) {
    if (canDebugSmdbShow(table) || canDebugSmdbPost(table)) {
      // Apply domain filter if specified
      if (args.domain) {
        const domainLower = args.domain.toLowerCase();
        // Match by table name prefix, CLI command prefix, or swagger domain
        const tableDomain = table.tableName.split('_')[0];
        const cliDomain =
          table.cliCommands.length > 0
            ? table.cliCommands[0].split(/\s+/)[0]
            : '';
        const swaggerPaths = index.smfToSwagger.get(table.tableName) || [];
        const hasSwaggerDomainMatch = swaggerPaths.some((p) => {
          const pathDomain = p.replace(/^\//, '').split('/')[0];
          return pathDomain === domainLower;
        });

        if (
          tableDomain !== domainLower &&
          cliDomain !== domainLower &&
          !hasSwaggerDomainMatch
        ) {
          continue;
        }
      }
      queryableTables.push(table);
    }
  }

  // Sort by table name
  queryableTables.sort((a, b) => a.tableName.localeCompare(b.tableName));

  // Apply limit
  const limited = queryableTables.slice(0, args.limit || 50);

  return {
    tables: limited.map((table) => ({
      tableName: table.tableName,
      description: table.description,
      storage: table.storage,
      tableType: table.tableType,
      method: canDebugSmdbPost(table) ? 'POST' : 'GET',
      path: `/api/private/cli/debug/smdb/table/${table.tableName}`,
      requiresNode: table.storage === 'mdb',
      requiresVserver: table.attributes.vserverEnabled === true,
      keyFields: table.keyFields,
      ...(args.includeCurl !== false
        ? {
            curlExample: generateDebugSmdbCurl(table, args.clusterIp),
          }
        : {}),
    })),
    total: queryableTables.length,
    debugSmdbQueryable: index.stats.debugSmdbQueryable,
    debugSmdbNotQueryable: index.stats.debugSmdbNotQueryable,
  };
}

function generateDebugSmdbCurl(
  table: SmfTableInfo,
  clusterIp?: string,
): string {
  const ip = clusterIp || '<mgmt-ip>';
  const path = `/api/private/cli/debug/smdb/table/${table.tableName}`;

  if (canDebugSmdbPost(table)) {
    // Action table — POST to invoke
    const writeFields = table.fields.filter(
      (f) => f.role === 'write' || f.role === 'create',
    );
    const bodyPart =
      writeFields.length > 0
        ? ` \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(
    Object.fromEntries(writeFields.map((f) => [f.name, `<${f.type}>`])),
  )}'`
        : '';

    return `# Action table — invoke via POST (GET returns "invalid operation")
# CLI: debug smdb table ${table.tableName} create
curl -k -s -u admin:<password> --noproxy '*' \\
  -X POST "https://${ip}${path}"${bodyPart}`;
  }

  // Regular table — GET to query records
  // IMPORTANT: Without fields=<names>, ONTAP only returns key fields.
  // fields=* is rejected by private CLI REST. Must list fields explicitly.
  const params: string[] = [];
  if (table.storage === 'mdb') params.push('node=<node-name>');
  if (table.attributes.vserverEnabled) params.push('vserver=<vserver-name>');

  // Include ALL non-key fields so ONTAP returns complete data
  const nonKeyFields = table.fields
    .filter((f) => f.role !== 'key' && f.name !== 'key') // exclude raw key material
    .map((f) => f.name);
  if (nonKeyFields.length > 0) {
    params.push(`fields=${nonKeyFields.join(',')}`);
  }
  const queryString = params.length > 0 ? '?' + params.join('&') : '';

  return `# CLI: debug smdb table ${table.tableName} show
# NOTE: fields= parameter is REQUIRED for non-key fields. Without it, only key fields are returned.
curl -k -s -u admin:<password> --noproxy '*' \\
  -X GET "https://${ip}${path}${queryString}"`;
}

// ============================================================================
// CLI to REST Handler
// ============================================================================

async function handleCliToRest(args: DiscoverDocsArgs, index: MegaDocsIndex) {
  if (!args.cliCommand) {
    return { error: 'cliCommand required for cli_to_rest' };
  }

  const result = cliCommandToRest(args.cliCommand);
  const cmdLower = args.cliCommand.toLowerCase();

  const response: Record<string, any> = {
    cliCommand: args.cliCommand,
    method: result.method,
    path: result.path,
    verb: result.verb,
    curlExample:
      args.includeCurl !== false
        ? `curl -u admin:<password> -k --noproxy '*' \\\n  -X ${result.method} "https://${args.clusterIp || '<mgmt-ip>'}${result.path}"`
        : undefined,
    privateRestCurl:
      args.includeCurl !== false
        ? `curl -u admin:<password> -k --noproxy '*' \\\n  -X ${result.method} "https://${args.clusterIp || '<mgmt-ip>'}${result.path}"`
        : undefined,
  };

  // Cross-ref: public REST equivalent?
  const swaggerIds = index.cliToSwagger.get(cmdLower);
  if (swaggerIds && swaggerIds.length > 0) {
    const ep = index.endpoints.get(swaggerIds[0]);
    if (ep) {
      const apiPath =
        ep.source === 'swagger' && !ep.path.startsWith('/api/')
          ? `/api${ep.path}`
          : ep.path;
      response.publicRestEquivalent = {
        method: ep.method,
        path: ep.path,
        summary: ep.summary,
        apiPath,
      };
      if (args.includeCurl !== false) {
        const bodyExample = buildRequestBodyExample(ep);
        response.publicRestCurl = generateCurlExample(ep, {
          clusterIp: args.clusterIp,
          ...(bodyExample ? { body: bodyExample } : {}),
        });
      }
      response.publicRestEquivalentNote =
        'Mapped from swagger "Related ONTAP commands"; semantic equivalence may not be 1:1 for all CLI commands.';

      // Surface related sub-resources for better discoverability (e.g., /storage/volumes/{uuid}/snapshots)
      response.relatedPublicRestEndpoints = listRelatedSwaggerEndpoints(
        ep.path,
        index,
        8,
      );
    }

    // Provide additional candidates when multiple swagger endpoints map to the same CLI command
    if (swaggerIds.length > 1) {
      const candidates = swaggerIds
        .map((id) => index.endpoints.get(id))
        .filter(Boolean)
        .slice(0, 5)
        .map((e) => ({
          method: e!.method,
          path: e!.path,
          apiPath:
            e!.source === 'swagger' && !e!.path.startsWith('/api/')
              ? `/api${e!.path}`
              : e!.path,
          summary: e!.summary || deriveEndpointSummary(e!),
        }));
      response.publicRestCandidates = candidates;
    }
  }

  // Cross-ref: SMF table?
  const smfTableNames = index.cliToSmfTables.get(cmdLower);
  if (smfTableNames && smfTableNames.length > 0) {
    const table = index.smfTables.get(smfTableNames[0]);
    if (table) {
      response.smfTable = {
        tableName: table.tableName,
        storage: table.storage,
        queryable: canDebugSmdbShow(table),
        fieldCount: table.fields.length,
      };
    }
  }

  // Help XML: targeted single-command lookup
  try {
    const { getHelpForCliCommand } = await import('./help-xml-search.js');
    const helpCmd = await getHelpForCliCommand(args.cliCommand);
    if (helpCmd) {
      response.commandDetail = {
        name: helpCmd.name,
        description: helpCmd.description?.slice(0, 200) || '',
        restEndpoint: helpCmd.restEndpoint,
        httpMethod: helpCmd.httpMethod,
        curlExample: helpCmd.curlExample,
        parameters: helpCmd.parameters.slice(0, 10).map((p: any) => ({
          name: p.name,
          description: p.description?.slice(0, 120) || '',
          ...(p.defaultValue ? { defaultValue: p.defaultValue } : {}),
        })),
        examples: helpCmd.examples.slice(0, 3).map((ex: any) => ({
          command: ex.command,
          description: ex.description?.slice(0, 120) || '',
        })),
      };

      if (response.commandDetail?.parameters && response.publicRestEquivalent) {
        response.cliToRestParamMapping = {
          note: 'CLI options typically map to REST query parameters on GET or JSON body keys on POST/PATCH.',
          examples: response.commandDetail.parameters
            .slice(0, 5)
            .map((p: any) => ({
              cliOption: `-${p.name}`,
              restQueryParam: p.name.replace(/-/g, '_'),
              restBodyKey: p.name.replace(/-/g, '_'),
            })),
        };
      }

      // Improve actionability: provide a JSON body sketch for private CLI proxy calls
      // (Private CLI endpoints generally take a JSON body where keys map to CLI option names.)
      if (
        args.includeCurl !== false &&
        (result.method === 'POST' || result.method === 'PATCH')
      ) {
        const body: Record<string, any> = {};
        for (const p of helpCmd.parameters.slice(0, 8)) {
          body[p.name] = `<${p.name}>`;
        }
        if (Object.keys(body).length > 0) {
          response.privateRestBodyExample = body;
          response.privateRestCurl = `curl -u admin:<password> -k --noproxy '*' \\\n  -X ${result.method} "https://${args.clusterIp || '<mgmt-ip>'}${result.path}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body)}'`;
        }
      }
    }
  } catch {
    /* offline — degrade gracefully */
  }

  response.notes = [
    'Public REST paths are shown without the /api prefix in swagger; use apiPath/publicRestCurl to call ONTAP.',
    'Private CLI proxy paths are under /api/private/cli and generally accept a JSON body with CLI option names as keys.',
  ];

  return response;
}

// ============================================================================
// Options Handler
// ============================================================================

function handleOptions(args: DiscoverDocsArgs, index: MegaDocsIndex) {
  if (!args.path) {
    return { error: 'path required for options' };
  }

  // Normalize path: try as-is, without /api/, and with /api/
  const pathVariants = [args.path];
  if (args.path.startsWith('/api/')) {
    pathVariants.push(args.path.replace(/^\/api\//, '/'));
  } else {
    pathVariants.push(`/api${args.path}`);
  }

  // Find all endpoints with this path
  const methods: string[] = [];
  const matchedPath: string[] = [];

  for (const ep of index.endpoints.values()) {
    for (const variant of pathVariants) {
      if (
        ep.path === variant ||
        ep.privatePath === variant ||
        ep.debugPath === variant
      ) {
        const m = Array.isArray(ep.method) ? ep.method : [ep.method];
        methods.push(...m);
        matchedPath.push(ep.path);
        break;
      }
    }
  }

  const uniqueMethods = [...new Set(methods)];
  const resolvedPath = matchedPath[0] || args.path;

  return {
    path: resolvedPath,
    inputPath: args.path !== resolvedPath ? args.path : undefined,
    allowedMethods: uniqueMethods,
    ...(uniqueMethods.length === 0
      ? {
          hint: 'No methods found. Swagger paths do NOT include /api/ prefix. Use action="search" to find the correct path.',
        }
      : {}),
    curlExample: `curl -u admin:<password> -k --noproxy '*' \\\n  -X OPTIONS "https://${args.clusterIp || '<mgmt-ip>'}${resolvedPath}" \\\n  --include 2>&1 | grep -i "Allow:"`,
  };
}

// ============================================================================
// Fuzzy Matching Helpers
// ============================================================================

function findSimilarEndpoints(
  path: string,
  index: MegaDocsIndex,
  limit: number,
): string[] {
  const pathLower = path.toLowerCase().replace(/^\/api\//, '/');
  const segments = pathLower.split('/').filter(Boolean);
  const results: Array<{ path: string; score: number }> = [];

  for (const ep of index.endpoints.values()) {
    const epPath = ep.path.toLowerCase();
    let score = 0;

    // Score by shared path segments
    const epSegments = epPath.split('/').filter(Boolean);
    for (const seg of segments) {
      if (epSegments.includes(seg)) score += 2;
      else if (epSegments.some((s) => s.includes(seg) || seg.includes(s)))
        score += 1;
    }

    // Bonus for substring match
    if (epPath.includes(pathLower) || pathLower.includes(epPath)) score += 3;

    if (score > 0) {
      results.push({ path: `${ep.method} ${ep.path}`, score });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.path);
}

function findSimilarTableNames(
  name: string,
  index: MegaDocsIndex,
  limit: number,
): string[] {
  const nameLower = name.toLowerCase().replace(/-/g, '_');
  const parts = nameLower.split('_').filter(Boolean);
  const results: Array<{ name: string; score: number }> = [];

  for (const tableName of index.smfTables.keys()) {
    let score = 0;
    const tableNameLower = tableName.toLowerCase();

    // Score by shared name segments
    const tableParts = tableNameLower.split('_').filter(Boolean);
    for (const part of parts) {
      if (tableParts.includes(part)) score += 2;
      else if (tableParts.some((tp) => tp.includes(part) || part.includes(tp)))
        score += 1;
      // Edit distance per segment
      else {
        for (const tp of tableParts) {
          const dist = simpleEditDistance(part, tp);
          if (dist <= 2 && dist < Math.max(part.length, tp.length) * 0.5) {
            score += 1.5 - dist * 0.3;
            break;
          }
        }
      }
    }

    // Bonus for substring match
    if (
      tableNameLower.includes(nameLower) ||
      nameLower.includes(tableNameLower)
    )
      score += 3;

    // Edit distance on whole name (bonus for close matches)
    if (score > 0) {
      const dist = simpleEditDistance(nameLower, tableNameLower);
      if (dist <= 3) score += 3 - dist;
    }

    // Levenshtein-like: penalize length difference
    const lenDiff = Math.abs(tableNameLower.length - nameLower.length);
    score -= lenDiff * 0.1;

    if (score > 0) {
      results.push({ name: tableName, score });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.name);
}

function findSimilarCliCommands(
  cmd: string,
  index: MegaDocsIndex,
  limit: number,
): string[] {
  const cmdLower = cmd.toLowerCase().trim();
  const parts = cmdLower.split(/\s+/);
  const results: Array<{ cmd: string; score: number }> = [];

  const scoreCmd = (cliCmd: string): number => {
    let score = 0;
    const cliParts = cliCmd.split(/\s+/);

    for (const part of parts) {
      if (cliParts.includes(part)) score += 2;
      else if (cliParts.some((cp) => cp.includes(part) || part.includes(cp)))
        score += 1;
      // Edit distance: if a part is 1-2 edits away from a CLI part, give partial credit
      else {
        for (const cp of cliParts) {
          const dist = simpleEditDistance(part, cp);
          if (dist <= 2 && dist < Math.max(part.length, cp.length) * 0.4) {
            score += 1.5 - dist * 0.3;
            break;
          }
        }
      }
    }

    if (cliCmd.includes(cmdLower) || cmdLower.includes(cliCmd)) score += 3;
    return score;
  };

  for (const cliCmd of index.byCliCommand.keys()) {
    const score = scoreCmd(cliCmd);
    if (score > 0) results.push({ cmd: cliCmd, score });
  }

  // Also check cliToSmfTables keys which have SMF-sourced CLI commands
  for (const cliCmd of index.cliToSmfTables.keys()) {
    if (results.some((r) => r.cmd === cliCmd)) continue;
    const score = scoreCmd(cliCmd);
    if (score > 0) results.push({ cmd: cliCmd, score });
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.cmd);
}

/** Simple Levenshtein edit distance (bounded for performance) */
function simpleEditDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  const m = a.length,
    n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ============================================================================
// SMF↔Swagger Field Role Cross-Validation
// ============================================================================

/**
 * Cross-validate SMF field roles against swagger access modifiers for
 * cross-referenced endpoints. Returns a summary of matching/mismatching fields.
 *
 * Role mapping:
 *   SMF show/read    ↔ swagger readOnly
 *   SMF create       ↔ swagger readCreate
 *   SMF create-noread ↔ swagger createOnly
 *   SMF modify       ↔ swagger readModify
 *   SMF modify-noread ↔ swagger modifyOnly
 *   SMF write/in     ↔ swagger writeOnly
 */
function buildFieldRoleCrossValidation(
  table: SmfTableInfo,
  swaggerEndpointIds: string[],
  index: MegaDocsIndex,
): {
  matched: number;
  total: number;
  mismatches?: Array<{ field: string; smfRole: string; swaggerAccess: string }>;
} | null {
  if (swaggerEndpointIds.length === 0) return null;

  // Collect all swagger fields from related endpoints
  const swaggerFieldMap = new Map<string, string>(); // field name → swaggerAccess
  for (const epId of swaggerEndpointIds) {
    const ep = index.endpoints.get(epId);
    if (!ep?.responseFields) continue;
    for (const f of ep.responseFields) {
      if (f.swaggerAccess && !swaggerFieldMap.has(f.name)) {
        swaggerFieldMap.set(f.name, f.swaggerAccess);
      }
    }
  }

  if (swaggerFieldMap.size === 0) return null;

  // SMF role → compatible swagger access modifiers
  const compatMap: Record<string, string[]> = {
    show: ['readOnly'],
    read: ['readOnly'],
    'show-noread': ['readOnly'],
    create: ['readCreate', 'readWrite'],
    'create-noread': ['createOnly', 'writeOnly'],
    modify: ['readModify', 'readWrite'],
    'modify-noread': ['modifyOnly', 'writeOnly'],
    write: ['writeOnly', 'readWrite'],
    in: ['writeOnly', 'createOnly'],
    'in-noread': ['writeOnly', 'createOnly'],
  };

  let matched = 0;
  let total = 0;
  const mismatches: Array<{
    field: string;
    smfRole: string;
    swaggerAccess: string;
  }> = [];

  for (const smfField of table.fields) {
    // Normalize field name for matching (SMF uses underscores, swagger uses snake_case or camelCase)
    const swaggerAccess =
      swaggerFieldMap.get(smfField.name) ||
      swaggerFieldMap.get(smfField.name.replace(/_/g, '-'));
    if (!swaggerAccess) continue;

    total++;
    const compat = compatMap[smfField.role] || [];
    if (compat.includes(swaggerAccess) || swaggerAccess === 'readWrite') {
      matched++;
    } else {
      mismatches.push({
        field: smfField.name,
        smfRole: smfField.role,
        swaggerAccess,
      });
    }
  }

  if (total === 0) return null;

  return {
    matched,
    total,
    ...(mismatches.length > 0 ? { mismatches: mismatches.slice(0, 20) } : {}),
  };
}

// ============================================================================
// Format Helpers
// ============================================================================

function formatEndpointSummary(ep: UnifiedEndpoint, args: DiscoverDocsArgs) {
  return {
    id: ep.id,
    source: ep.source,
    method: ep.method,
    path: ep.path,
    privatePath: ep.privatePath,
    summary: ep.summary || deriveEndpointSummary(ep),
    domain: ep.domain,
    accessPatterns: ep.accessPatterns,
    queryable: ep.queryable,
    isActionOnly: ep.isActionOnly,
    smfTable: ep.smfTable?.tableName,
    ...(ep.introducedVersion
      ? { introducedVersion: ep.introducedVersion }
      : {}),
    ...(ep.crossClusterProxy ? { crossClusterProxy: true } : {}),
  };
}

function formatEndpointDetails(ep: UnifiedEndpoint, args: DiscoverDocsArgs) {
  const requestBodyPreview = shrinkSchema(ep.requestBody);
  const responseFieldsPreview = ep.responseFields
    ? ep.responseFields.slice(0, 100).map((f) => ({
        ...f,
        ...(f.swaggerAccess ? { swaggerAccess: f.swaggerAccess } : {}),
        ...(f.introducedVersion
          ? { introducedVersion: f.introducedVersion }
          : {}),
      }))
    : undefined;
  const bodyExample = buildRequestBodyExample(ep);

  const result: any = {
    ...formatEndpointSummary(ep, args),
    description: ep.description,
    tags: ep.tags?.slice(0, 25),
    parameters: ep.parameters?.slice(0, 25),
    requestBody: requestBodyPreview,
    requestBodyFields: ep.requestBody?.properties
      ? Object.entries(ep.requestBody.properties)
          .slice(0, 15)
          .map(([name, schema]: [string, any]) => ({
            name,
            type: schema.type || 'object',
            required: ep.requestBody?.required?.includes(name) || false,
            description: (schema.description || '').slice(0, 120),
          }))
      : undefined,
    responseFields: responseFieldsPreview,
    ...(ep.responseFields
      ? { responseFieldCount: ep.responseFields.length }
      : {}),
    requiresNode: ep.requiresNode,
    requiresVserver: ep.requiresVserver,
    debugSmdbInfo: ep.debugSmdbInfo,
    relatedCliCommands: ep.relatedCliCommands,
    smfTable: ep.smfTable
      ? {
          tableName: ep.smfTable.tableName,
          storage: ep.smfTable.storage,
          fields: ep.smfTable.fields.slice(0, 10), // Limit for brevity
          keyFields: ep.smfTable.keyFields,
        }
      : undefined,
    ...(args.includeCurl !== false
      ? {
          curlExample: generateCurlExample(ep, {
            clusterIp: args.clusterIp,
            ...(bodyExample ? { body: bodyExample } : {}),
          }),
        }
      : {}),
  };

  const sparse =
    !ep.relatedCliCommands?.length && !ep.smfTable && !ep.parameters?.length;
  if (sparse) {
    result.nextSteps = [
      {
        action: 'search',
        args: { query: ep.domain, source: 'swagger' },
        reason: `Find related ${ep.domain} endpoints`,
      },
      ...(ep.smfTable
        ? [
            {
              action: 'get_smf_table',
              args: { tableName: ep.smfTable.tableName },
              reason: 'Get backing SMF table details',
            },
          ]
        : []),
      {
        action: 'search',
        args: { query: ep.path.split('/').filter(Boolean).pop() || ep.domain },
        reason: 'Search for related resources by path segment',
      },
    ];
  }

  return result;
}

function formatSearchResult(ep: UnifiedEndpoint, match: string[]) {
  const privateCliPath =
    ep.privatePath ||
    (ep.path.startsWith('/api/private/cli') ? ep.path : undefined);
  const publicApiPath =
    ep.source === 'swagger' && !ep.path.startsWith('/api/')
      ? `/api${ep.path}`
      : ep.source === 'swagger'
        ? ep.path
        : undefined;

  const matchReason = match
    .map((m) => m.split(':')[0])
    .filter(Boolean)
    .slice(0, 3)
    .join(',');

  return {
    source: ep.source,
    method: ep.method,
    path: ep.path,
    summary: ep.summary || deriveEndpointSummary(ep),
    domain: ep.domain,
    smfTable: ep.smfTable?.tableName,
    relatedCliCommand: ep.relatedCliCommands?.[0],
    paths: {
      ...(publicApiPath ? { publicApi: publicApiPath } : {}),
      ...(privateCliPath ? { privateCli: privateCliPath } : {}),
      ...(ep.debugPath ? { debugSmdb: ep.debugPath } : {}),
    },
    match: matchReason || undefined,
  };
}

function deriveEndpointSummary(ep: UnifiedEndpoint): string {
  if (ep.source === 'smf-action')
    return ep.smfTable?.description || 'SMF action';
  if (ep.source === 'smf-debug')
    return ep.smfTable
      ? `Debug query: ${ep.smfTable.tableName}`
      : 'Debug query';
  if (ep.cliCommand) return ep.cliCommand;
  if (ep.smfTable?.description) return ep.smfTable.description;
  return ep.path;
}

function listRelatedSwaggerEndpoints(
  basePath: string,
  index: MegaDocsIndex,
  limit: number,
): Array<{ method: any; path: string; summary: string }> {
  const out: Array<{ method: any; path: string; summary: string }> = [];
  const prefix = basePath.replace(/\/+$/, '') + '/';

  for (const ep of index.endpoints.values()) {
    if (ep.source !== 'swagger') continue;
    if (!ep.path.startsWith(prefix)) continue;
    out.push({
      method: ep.method,
      path: ep.path,
      summary: ep.summary || deriveEndpointSummary(ep),
    });
  }

  // Prefer shorter, higher-level subresources first
  out.sort((a, b) => a.path.length - b.path.length);
  return out.slice(0, limit);
}

function searchSwaggerHighlights(
  queryLower: string,
  index: MegaDocsIndex,
  limit: number,
): Array<{
  method: any;
  path: string;
  apiPath: string;
  summary: string;
  relatedCliCommand?: string;
}> {
  const tokens = queryLower
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  // Stem helper: simplistic plural handling (managers -> manager)
  const stem = (s: string): string =>
    s.endsWith('s') && s.length > 3 ? s.slice(0, -1) : s;
  const stemmedTokens = tokens.map(stem);

  // For compound words like "keymanager", try splitting at common boundaries
  const expandedTokens = new Set<string>(tokens);
  const expandedStemmed = new Set<string>(stemmedTokens);
  for (const t of tokens) {
    // Split "keymanager" → ["key", "manager"] if both parts are meaningful
    for (let i = 3; i <= t.length - 3; i++) {
      const left = t.slice(0, i);
      const right = t.slice(i);
      if (left.length >= 3 && right.length >= 3) {
        expandedTokens.add(left);
        expandedTokens.add(right);
        expandedStemmed.add(stem(left));
        expandedStemmed.add(stem(right));
      }
    }
  }

  const scored: Array<{ ep: UnifiedEndpoint; score: number }> = [];
  for (const ep of index.endpoints.values()) {
    if (ep.source !== 'swagger') continue;
    const pathText = ep.path.toLowerCase();
    const rawSegments = pathText
      .replace(/[{}]/g, '')
      .split(/[^a-z0-9]+/g)
      .filter(Boolean);
    const segments = new Set(rawSegments);
    const stemmedSegments = new Set(rawSegments.map(stem));
    const summary = (ep.summary || '').toLowerCase();
    const dense = `${pathText} ${summary}`.replace(/[^a-z0-9]+/g, '');

    let score = 0;
    // Check original tokens first (strongest weight)
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const st = stemmedTokens[i];
      // Exact segment match (strongest)
      if (segments.has(t)) score += 30;
      // Stemmed segment match (e.g., "manager" matches "managers")
      else if (stemmedSegments.has(st)) score += 28;
      if (summary.includes(t)) score += 20;
      if (t.length >= 4 && dense.includes(t)) score += 10;
    }

    // Check expanded tokens (compound word splitting) - lower weight
    let expandedMatches = 0;
    for (const t of expandedTokens) {
      if (!tokens.includes(t)) {
        // Only check expanded, not original
        if (segments.has(t)) expandedMatches++;
        else if (expandedStemmed.has(stem(t)) && stemmedSegments.has(stem(t)))
          expandedMatches++;
      }
    }
    if (expandedMatches >= 2)
      score += 25; // "keymanager" → key + manager both match
    else if (expandedMatches >= 1) score += 12;

    if (pathText.includes(queryLower)) score += 15;

    // Prefer shorter paths (collection endpoints over deep sub-resources)
    const pathDepth = rawSegments.filter(
      (s) => !s.includes('uuid') && s.length > 0,
    ).length;
    if (pathDepth <= 2)
      score += 25; // Collection endpoint bonus
    else if (pathDepth <= 3) score += 10; // Instance endpoint bonus

    // Prefer GET (list) over other methods for collection endpoints
    if (ep.method === 'GET' && pathDepth <= 2) score += 5;

    if (score > 0) scored.push({ ep, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => ({
    method: s.ep.method,
    path: s.ep.path,
    apiPath: `/api${s.ep.path}`,
    summary: s.ep.summary || deriveEndpointSummary(s.ep),
    relatedCliCommand: s.ep.relatedCliCommands?.[0],
  }));
}

function shrinkSchema(schema?: any): any {
  if (!schema) return schema;
  if (schema.type !== 'object' || !schema.properties) return schema;

  const props = schema.properties as Record<string, any>;
  const keys = Object.keys(props);
  const previewKeys = keys.slice(0, 15);
  const previewProps: Record<string, any> = {};
  for (const k of previewKeys) {
    const p = props[k];
    previewProps[k] = {
      name: p.name,
      type: p.type,
      required: p.required,
      description: p.description,
    };
  }
  return {
    type: 'object',
    ...(schema.required ? { required: schema.required } : {}),
    properties: previewProps,
    ...(keys.length > previewKeys.length
      ? { omittedProperties: keys.length - previewKeys.length }
      : {}),
  };
}

function buildRequestBodyExample(
  ep: UnifiedEndpoint,
): Record<string, any> | undefined {
  const schema = ep.requestBody;
  if (!schema || schema.type !== 'object' || !schema.properties)
    return undefined;
  const props = schema.properties;
  const required =
    schema.required ||
    Object.entries(props)
      .filter(([, v]) => (v as any).required)
      .map(([k]) => k);
  const ordered = [...new Set([...required, ...Object.keys(props)])].slice(
    0,
    8,
  );
  const out: Record<string, any> = {};
  for (const k of ordered) {
    const p: any = (props as any)[k];
    if (!p) continue;
    out[k] = placeholderForType(p.type, k);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function placeholderForType(type: string | undefined, name: string): any {
  const t = (type || '').toLowerCase();
  if (t.includes('bool')) return true;
  if (t.includes('int') || t.includes('number')) return 0;
  if (t.includes('array')) return [];
  if (t.includes('object')) return {};
  return `<${name}>`;
}

// ============================================================================
// Browse CLI Handler
// ============================================================================

async function handleBrowseCli(args: DiscoverDocsArgs) {
  const cliTree = await getCliTree();
  const path = args.cliPath || args.cliCommand || args.query || '';

  if (args.query && !args.cliPath && !args.cliCommand) {
    // If only query provided, try search first
    const node = cliTree.navigate(path);
    if (!node) {
      const results = cliTree.search(path, args.limit || 20);
      return {
        action: 'browse_cli',
        query: path,
        searchResults: results,
        totalMatches: results.length,
      };
    }
  }

  return {
    action: 'browse_cli',
    ...cliTree.browse(path),
  };
}

let cliTreeInstance: CliTree | null = null;

const GOLDEN_SMF_PATH = './golden_global.smf';
const OPENGROK_SMF_PATH = '/smfgen/bin/golden_global.smf';

async function getCliTree(): Promise<CliTree> {
  if (cliTreeInstance) return cliTreeInstance;

  let content: string | null = null;

  // 1) Try OpenGrok first
  try {
    content = await getFileContent(OPENGROK_SMF_PATH, 'dev');
    if (content && content.length > 1_000_000) {
      console.log(
        `[browse_cli] Loaded golden_global.smf from OpenGrok (${(content.length / 1024 / 1024).toFixed(1)} MB)`,
      );
    } else {
      content = null;
    }
  } catch (e) {
    console.warn(`[browse_cli] OpenGrok fetch failed: ${e}`);
  }

  if (!content) {
    throw new Error('golden_global.smf not available from OpenGrok');
  }

  cliTreeInstance = CliTree.fromContent(content);
  return cliTreeInstance;
}
