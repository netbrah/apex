/* eslint-disable */
// @ts-nocheck
/**
 * Private CLI REST API Mapper
 * Maps SMF tables and CLI commands to private REST endpoints
 * Based on private-cli-rest-api.instructions.md
 */

import type {
  UnifiedEndpoint,
  SmfTableInfo,
  QueryMethod,
  AccessPatterns,
} from './types.js';
import {
  isQueryable,
  requiresNodeParam,
  smfFieldsToFieldInfo,
  canDebugSmdbShow,
  canDebugSmdbPost,
} from './smf-global-parser.js';

// CLI verb to HTTP method mapping
const CLI_VERB_MAP: Record<
  string,
  { method: QueryMethod; removeVerb: boolean }
> = {
  show: { method: 'GET', removeVerb: true },
  create: { method: 'POST', removeVerb: true },
  modify: { method: 'PATCH', removeVerb: true },
  delete: { method: 'DELETE', removeVerb: true },
};

/**
 * Generate private CLI endpoints for an SMF table
 */
export function generatePrivateEndpoints(
  table: SmfTableInfo,
): UnifiedEndpoint[] {
  const endpoints: UnifiedEndpoint[] = [];

  // 1. If table is queryable via debug smdb GET, create debug GET endpoint
  if (isQueryable(table)) {
    endpoints.push(createDebugTableEndpoint(table));
  }

  // 2. If table is POST-invokable via debug smdb (action tables with server storage),
  //    create debug POST endpoint
  if (canDebugSmdbPost(table)) {
    endpoints.push(createDebugPostEndpoint(table));
  }

  // 3. If table has a command, create CLI-mapped endpoint
  // (command comes from the SMF 'command' directive)

  // 4. If table has { rest } attribute, it may have public REST too
  if (table.attributes.rest) {
    // Note: This should be cross-referenced with swagger.yaml
  }

  // 5. Action tables get POST endpoint at their CLI path
  if (table.tableType === 'action' || table.storage === 'action') {
    endpoints.push(createActionEndpoint(table));
  }

  return endpoints;
}

/**
 * Create debug smdb table endpoint
 * GET /api/private/cli/debug/smdb/table/{tableName}
 */
function createDebugTableEndpoint(table: SmfTableInfo): UnifiedEndpoint {
  const path = `/api/private/cli/debug/smdb/table/${table.tableName}`;

  return {
    id: `smf-debug:${table.tableName}`,
    source: 'smf-debug',
    method: 'GET',
    path,
    debugPath: path,
    summary: `Debug query: ${table.tableName}`,
    description: `${table.description}\n\nQueryable via: debug smdb table ${table.tableName} show`,
    tags: ['debug', 'smf', extractDomain(table.tableName)],
    domain: extractDomain(table.tableName),
    responseFields: smfFieldsToFieldInfo(table.fields),
    smfTable: table,
    accessPatterns: {
      publicRest: false,
      privateCli: true,
      debugSmdb: true,
    },
    queryable: true,
    isActionOnly: false,
    requiresNode: requiresNodeParam(table),
    requiresVserver: table.attributes.vserverEnabled,
  };
}

/**
 * Create debug POST endpoint for action tables with server storage.
 * POST /api/private/cli/debug/smdb/table/{tableName}
 * Action tables can't be GET'd (returns "invalid operation") but can be POST'd.
 */
function createDebugPostEndpoint(table: SmfTableInfo): UnifiedEndpoint {
  const path = `/api/private/cli/debug/smdb/table/${table.tableName}`;

  const writeFields = table.fields.filter(
    (f) => f.role === 'write' || f.role === 'create',
  );

  return {
    id: `smf-debug-post:${table.tableName}`,
    source: 'smf-debug',
    method: 'POST',
    path,
    debugPath: path,
    summary: `Debug invoke (POST): ${table.tableName}`,
    description: `${table.description}\n\nAction table — invoke via POST (GET returns "invalid operation").\nCLI: debug smdb table ${table.tableName} create`,
    tags: ['debug', 'smf', 'action', extractDomain(table.tableName)],
    domain: extractDomain(table.tableName),
    requestBody:
      writeFields.length > 0
        ? {
            type: 'object',
            properties: Object.fromEntries(
              writeFields.map((f) => [
                f.name,
                {
                  name: f.name,
                  description: f.description,
                  type: f.type,
                  role: f.role as any,
                  required: false,
                  queryable: false,
                  filterable: false,
                },
              ]),
            ),
          }
        : undefined,
    responseFields: smfFieldsToFieldInfo(
      table.fields.filter((f) => f.role === 'read' || f.role === 'show'),
    ),
    smfTable: table,
    accessPatterns: {
      publicRest: false,
      privateCli: true,
      debugSmdb: true,
    },
    queryable: false,
    isActionOnly: true,
    requiresNode: requiresNodeParam(table),
    requiresVserver: table.attributes.vserverEnabled,
  };
}

/**
 * Create action endpoint for action tables
 * POST /api/private/cli/{cli-path}
 */
function createActionEndpoint(table: SmfTableInfo): UnifiedEndpoint {
  // Convert table name to CLI path: keymanager_onboard_enable → security/key-manager/onboard/enable
  const cliPath = tableNameToCliPath(table.tableName);
  const path = `/api/private/cli/${cliPath}`;

  const actionFields = table.fields.filter((f) => {
    const isKey = f.role.startsWith('key');
    const isWrite =
      f.role === 'write' || f.role === 'create' || f.role === 'modify';
    return isKey || isWrite;
  });

  const requiredFields = actionFields
    .filter((f) => {
      const isKey = f.role.startsWith('key');
      // Optional prefix always wins; treat optional keys as optional input.
      if (f.prefixes.optional) return false;
      // Key-required is always required; otherwise keys are required by default for actions.
      return (
        isKey &&
        (f.role === 'key-required' ||
          f.role === 'key' ||
          f.role === 'key-nocreate' ||
          f.role === 'key-forsort')
      );
    })
    .map((f) => f.name);

  return {
    id: `smf-action:${table.tableName}`,
    source: 'smf-action',
    method: 'POST',
    path,
    privatePath: path,
    summary: `Action: ${table.description}`,
    description: table.description,
    tags: ['action', 'smf', extractDomain(table.tableName)],
    domain: extractDomain(table.tableName),
    requestBody: {
      type: 'object',
      properties: Object.fromEntries(
        actionFields.map((f) => [
          f.name,
          {
            name: f.name,
            description: f.description,
            type: f.type,
            role: f.role as any,
            required: requiredFields.includes(f.name),
            queryable: false,
            filterable: false,
          },
        ]),
      ),
      ...(requiredFields.length > 0 ? { required: requiredFields } : {}),
    },
    smfTable: table,
    accessPatterns: {
      publicRest: table.attributes.rest === true,
      privateCli: true,
      debugSmdb: false,
    },
    queryable: false,
    isActionOnly: true,
  };
}

/**
 * Convert SMF table name to CLI path
 * keymanager_external_enable → security/key-manager/external/enable
 * volume_show → volume
 */
function tableNameToCliPath(tableName: string): string {
  // Known domain prefixes and their CLI paths
  const domainMappings: Record<string, string> = {
    keymanager: 'security/key-manager',
    volume: 'volume',
    vserver: 'vserver',
    aggregate: 'storage/aggregate',
    disk: 'storage/disk',
    network: 'network',
    cluster: 'cluster',
    security: 'security',
    system: 'system',
  };

  // Find matching domain prefix
  for (const [prefix, cliPrefix] of Object.entries(domainMappings)) {
    if (tableName.startsWith(prefix + '_')) {
      const remainder = tableName.substring(prefix.length + 1);
      // Convert underscores to slashes, but keep hyphens in compound words
      const pathParts = remainder.split('_').map((p) => p.replace(/-/g, '-'));
      return `${cliPrefix}/${pathParts.join('/')}`;
    }
  }

  // Fallback: just convert underscores to slashes
  return tableName.replace(/_/g, '/');
}

/**
 * Extract domain from table name
 */
function extractDomain(tableName: string): string {
  const firstUnderscore = tableName.indexOf('_');
  if (firstUnderscore > 0) {
    return tableName.substring(0, firstUnderscore);
  }
  return 'general';
}

/**
 * Convert CLI command to private REST endpoint
 */
export function cliCommandToRest(cliCommand: string): {
  method: QueryMethod;
  path: string;
  verb?: string;
} {
  const parts = cliCommand.trim().split(/\s+/);
  const lastPart = parts[parts.length - 1];

  let method: QueryMethod = 'POST';
  let pathParts = [...parts];
  let verb: string | undefined;

  // Check for standard verbs
  if (CLI_VERB_MAP[lastPart]) {
    method = CLI_VERB_MAP[lastPart].method;
    verb = lastPart;
    if (CLI_VERB_MAP[lastPart].removeVerb) {
      pathParts = pathParts.slice(0, -1);
    }
  }
  // Check for show-* pattern
  else if (lastPart.startsWith('show-')) {
    method = 'GET';
    verb = lastPart;
    pathParts[pathParts.length - 1] = lastPart.replace('show-', '');
  }
  // Check for delete-all
  else if (lastPart === 'delete-all') {
    method = 'DELETE';
    verb = lastPart;
    pathParts[pathParts.length - 1] = 'all';
  }

  const path = '/api/private/cli/' + pathParts.join('/');
  return { method, path, verb };
}

/**
 * Generate curl example for an endpoint
 */
export function generateCurlExample(
  endpoint: UnifiedEndpoint,
  options?: {
    clusterIp?: string;
    fields?: string[];
    node?: string;
    vserver?: string;
    body?: Record<string, any>;
  },
): string {
  const ip = options?.clusterIp || '<mgmt-ip>';
  const auth = "-u admin:<password> -k --noproxy '*'";

  const rawPath =
    endpoint.source === 'swagger' && !endpoint.path.startsWith('/api/')
      ? `/api${endpoint.path}`
      : endpoint.path;
  let url = `https://${ip}${rawPath}`;
  const params: string[] = [];

  if (options?.fields?.length) {
    params.push(`fields=${options.fields.join(',')}`);
  }
  if (options?.node && endpoint.requiresNode) {
    params.push(`node=${options.node}`);
  }
  if (options?.vserver && endpoint.requiresVserver) {
    params.push(`vserver=${options.vserver}`);
  }

  if (params.length) {
    url += '?' + params.join('&');
  }

  const method = Array.isArray(endpoint.method)
    ? endpoint.method[0]
    : endpoint.method;
  let curl = `curl ${auth} \\\n  -X ${method} "${url}"`;

  if (options?.body && ['POST', 'PATCH'].includes(method)) {
    curl += ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(options.body)}'`;
  }

  return curl;
}

// ============================================================================
// Access Patterns Classification - THE KEY FUNCTION
// ============================================================================

/**
 * Build access patterns for an SMF table
 * Determines which of the three access methods are available:
 * 1. Public REST (/api/...) - from swagger.yaml or { rest } attribute
 * 2. Private CLI (/api/private/cli/...) - always available for tables with CLI mapping
 * 3. Debug SMDB (/api/private/cli/debug/smdb/table/...) - based on storage type
 */
export function buildAccessPatterns(
  table: SmfTableInfo,
  hasSwaggerEndpoint: boolean,
): AccessPatterns {
  return {
    publicRest: hasSwaggerEndpoint || table.attributes.rest === true,
    privateCli: !!(
      table.command ||
      (table.cliCommands && table.cliCommands.length > 0)
    ),
    debugSmdb: canDebugSmdbShow(table) || canDebugSmdbPost(table),
  };
}
