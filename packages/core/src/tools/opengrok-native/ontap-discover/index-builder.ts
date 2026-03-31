/* eslint-disable */
// @ts-nocheck
/**
 * Build the unified Mega Docs index from all sources
 */

import {
  parseGoldenGlobalSmf,
  isQueryable,
  canDebugSmdbShow,
  generateDebugSmdbInfo,
} from './smf-global-parser.js';
import { parseSwaggerYaml } from './swagger-parser.js';
import {
  generatePrivateEndpoints,
  buildAccessPatterns,
} from './private-cli-mapper.js';
import type {
  MegaDocsIndex,
  UnifiedEndpoint,
  SearchEntry,
  IndexStats,
  SmfTableInfo,
  ParameterHint,
  SerializedMegaDocsIndex,
} from './types.js';

// Singleton state
let index: MegaDocsIndex | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the unified index from all sources.
 * If MEGA_DOCS_INDEX_PATH is set and the file exists, loads the pre-built index instead.
 */
export async function initializeMegaDocsIndex(): Promise<void> {
  if (index) return;
  if (initPromise) return initPromise;

  initPromise = doBuildIndex();
  await initPromise;
}

async function doBuildIndex(): Promise<void> {
  const startTime = Date.now();
  console.log('[mega-docs] Building unified index...');

  // Parse all sources in parallel
  const [smfResult, swaggerResult] = await Promise.all([
    parseGoldenGlobalSmf(),
    parseSwaggerYaml(),
  ]);

  // Initialize index structure
  const endpoints = new Map<string, UnifiedEndpoint>();
  const smfTables = smfResult.tables;
  const byTag = new Map<string, string[]>();
  const byDomain = new Map<string, string[]>();
  const byCliCommand = new Map<string, string>();
  const byPath = new Map<string, string[]>();
  const bySmfTable = new Map<string, string>();
  const searchIndex: SearchEntry[] = [];

  // === Cross-reference maps ===
  const cliToSwagger = new Map<string, string[]>();
  const cliToSmfTables = new Map<string, string[]>();
  const swaggerToSmf = new Map<string, string[]>();
  const smfToSwagger = new Map<string, string[]>();

  // 1. Add Swagger endpoints + build cliToSwagger map
  let swaggerWithCli = 0;
  for (const ep of swaggerResult.endpoints) {
    addEndpoint(ep, endpoints, byTag, byDomain, byPath, searchIndex);

    // Index CLI commands from swagger "Related ONTAP commands"
    if (ep.relatedCliCommands && ep.relatedCliCommands.length > 0) {
      swaggerWithCli++;
      for (const cmd of ep.relatedCliCommands) {
        const cmdLower = cmd.toLowerCase();
        byCliCommand.set(cmdLower, ep.id);
        if (!cliToSwagger.has(cmdLower)) cliToSwagger.set(cmdLower, []);
        cliToSwagger.get(cmdLower)!.push(ep.id);
      }
    }
  }
  console.log(
    `[mega-docs] Added ${swaggerResult.endpoints.length} Swagger endpoints (${swaggerWithCli} with CLI commands)`,
  );

  // 2. Build cliToSmfTables map from SMF command directives
  let smfWithCommand = 0;
  for (const table of smfTables.values()) {
    if (table.cliCommands.length > 0) {
      smfWithCommand++;
      for (const cmd of table.cliCommands) {
        const cmdLower = cmd.toLowerCase();
        if (!cliToSmfTables.has(cmdLower)) cliToSmfTables.set(cmdLower, []);
        cliToSmfTables.get(cmdLower)!.push(table.tableName);
      }
    }
  }
  console.log(
    `[mega-docs] ${smfWithCommand} SMF tables have command directives`,
  );

  // 3. Build bidirectional swagger<->SMF cross-reference via shared CLI commands
  let crossRefMatches = 0;
  const allCliCommands = new Set([
    ...cliToSwagger.keys(),
    ...cliToSmfTables.keys(),
  ]);
  for (const cmd of allCliCommands) {
    const swaggerIds = cliToSwagger.get(cmd) || [];
    const smfTableNames = cliToSmfTables.get(cmd) || [];

    if (swaggerIds.length > 0 && smfTableNames.length > 0) {
      crossRefMatches++;
      // Link each swagger endpoint to related SMF tables
      for (const swId of swaggerIds) {
        if (!swaggerToSmf.has(swId)) swaggerToSmf.set(swId, []);
        for (const tbl of smfTableNames) {
          if (!swaggerToSmf.get(swId)!.includes(tbl)) {
            swaggerToSmf.get(swId)!.push(tbl);
          }
        }
      }
      // Link each SMF table to related swagger endpoints
      for (const tbl of smfTableNames) {
        if (!smfToSwagger.has(tbl)) smfToSwagger.set(tbl, []);
        for (const swId of swaggerIds) {
          if (!smfToSwagger.get(tbl)!.includes(swId)) {
            smfToSwagger.get(tbl)!.push(swId);
          }
        }
      }
    }
  }
  console.log(
    `[mega-docs] Cross-reference: ${crossRefMatches} CLI commands match both swagger and SMF`,
  );

  // 4. Generate private endpoints from SMF tables
  let smfEndpointCount = 0;
  const swaggerPaths = new Set(swaggerResult.endpoints.map((ep) => ep.path));

  for (const table of smfTables.values()) {
    const privateEndpoints = generatePrivateEndpoints(table);

    for (const ep of privateEndpoints) {
      // Check if this SMF table has a matching swagger endpoint (via cross-ref)
      const hasSwaggerEndpoint =
        swaggerPaths.has(ep.path) ||
        smfToSwagger.has(table.tableName) ||
        (ep.smfTable?.attributes.rest &&
          swaggerResult.endpoints.some((se) =>
            se.summary?.toLowerCase().includes(table.tableName.toLowerCase()),
          ));

      // Build access patterns
      ep.accessPatterns = buildAccessPatterns(table, !!hasSwaggerEndpoint);

      // Generate debug SMDB info if queryable
      if (ep.accessPatterns.debugSmdb) {
        ep.debugSmdbInfo = generateDebugSmdbInfo(table);
      }

      // Propagate CLI commands to the endpoint
      if (table.cliCommands.length > 0) {
        ep.cliCommand = table.cliCommands[0];
        ep.relatedCliCommands = table.cliCommands;
      }

      addEndpoint(ep, endpoints, byTag, byDomain, byPath, searchIndex);
      bySmfTable.set(table.tableName, ep.id);

      // Also index SMF CLI commands in byCliCommand
      for (const cmd of table.cliCommands) {
        const cmdLower = cmd.toLowerCase();
        if (!byCliCommand.has(cmdLower)) {
          byCliCommand.set(cmdLower, ep.id);
        }
      }

      smfEndpointCount++;
    }
  }
  console.log(`[mega-docs] Added ${smfEndpointCount} SMF-derived endpoints`);

  // 5. Build parameter hints for endpoints with path parameters
  const parameterHints = buildParameterHints(endpoints, byCliCommand);
  console.log(
    `[mega-docs] Built parameter hints for ${parameterHints.size} endpoints`,
  );

  // 6. Build stats
  const allTables = [...smfTables.values()];
  const debugSmdbQueryable = allTables.filter(canDebugSmdbShow).length;
  const debugSmdbNotQueryable = allTables.length - debugSmdbQueryable;

  // Count cross-cluster proxy endpoints and swagger field access modifiers
  let crossClusterProxyEndpoints = 0;
  const swaggerFieldAccessCounts: Record<string, number> = {};
  for (const ep of swaggerResult.endpoints) {
    if (ep.crossClusterProxy) crossClusterProxyEndpoints++;
    if (ep.responseFields) {
      for (const f of ep.responseFields) {
        if (f.swaggerAccess) {
          swaggerFieldAccessCounts[f.swaggerAccess] =
            (swaggerFieldAccessCounts[f.swaggerAccess] || 0) + 1;
        }
      }
    }
  }

  const stats: IndexStats = {
    totalEndpoints: endpoints.size,
    swaggerEndpoints: swaggerResult.totalEndpoints,
    smfTables: smfResult.totalTables,
    debugSmdbQueryable,
    debugSmdbNotQueryable,
    queryableSmfTables: allTables.filter(isQueryable).length,
    actionOnlyTables: allTables.filter((t) => t.storage === 'action').length,
    privateCli: smfEndpointCount,
    byDomain: Object.fromEntries(
      [...byDomain.entries()].map(([k, v]) => [k, v.length]),
    ),
    loadTimeMs: Date.now() - startTime,
    cliCommandsMapped: allCliCommands.size,
    swaggerWithCli,
    smfWithCommand,
    crossRefMatches,
    crossClusterProxyEndpoints,
    swaggerFieldAccessCounts,
  };

  index = {
    endpoints,
    smfTables,
    byTag,
    byDomain,
    byCliCommand,
    byPath,
    bySmfTable,
    cliToSwagger,
    cliToSmfTables,
    swaggerToSmf,
    smfToSwagger,
    parameterHints,
    searchIndex,
    stats,
  };

  // Log summary
  console.log(
    `[mega-docs] Index built: ${stats.totalEndpoints} endpoints, ${stats.smfTables} SMF tables, ${stats.swaggerEndpoints} swagger, ${crossRefMatches} cross-refs, ${stats.loadTimeMs}ms`,
  );
}

function addEndpoint(
  ep: UnifiedEndpoint,
  endpoints: Map<string, UnifiedEndpoint>,
  byTag: Map<string, string[]>,
  byDomain: Map<string, string[]>,
  byPath: Map<string, string[]>,
  searchIndex: SearchEntry[],
): void {
  endpoints.set(ep.id, ep);

  // Index by tags
  for (const tag of ep.tags) {
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag)!.push(ep.id);
  }

  // Index by domain
  if (!byDomain.has(ep.domain)) byDomain.set(ep.domain, []);
  byDomain.get(ep.domain)!.push(ep.id);

  // Index by path prefix
  const prefix = getPathPrefix(ep.path);
  if (!byPath.has(prefix)) byPath.set(prefix, []);
  byPath.get(prefix)!.push(ep.id);

  // Build search entry
  const text = buildSearchText(ep);
  searchIndex.push({
    id: ep.id,
    text,
    tokens: new Set(text.split(/\s+/).filter((t) => t.length > 1)),
    source: ep.source,
    domain: ep.domain,
  });
}

function getPathPrefix(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return '/' + segments.slice(0, 3).join('/');
}

function buildSearchText(ep: UnifiedEndpoint): string {
  const parts = [
    ep.path.toLowerCase().replace(/[\/\{\}\-_]/g, ' '),
    ep.summary.toLowerCase(),
    ep.description.toLowerCase(),
    ...ep.tags.map((t) => t.toLowerCase()),
    ep.cliCommand?.toLowerCase() || '',
    ep.smfTable?.tableName.toLowerCase().replace(/_/g, ' ') || '',
  ];

  // Include all related CLI commands in searchable text
  if (ep.relatedCliCommands) {
    parts.push(...ep.relatedCliCommands.map((c) => c.toLowerCase()));
  }

  // Include SMF CLI commands
  if (ep.smfTable?.cliCommands) {
    parts.push(...ep.smfTable.cliCommands.map((c) => c.toLowerCase()));
  }

  if (ep.responseFields) {
    parts.push(...ep.responseFields.map((f) => f.name.toLowerCase()));
  }

  return parts.join(' ');
}

/**
 * Get the initialized index
 */
export function getIndex(): MegaDocsIndex {
  if (!index) {
    throw new Error(
      'Index not initialized. Call initializeMegaDocsIndex() first.',
    );
  }
  return index;
}

/**
 * Get index stats
 */
export function getStats(): IndexStats | null {
  return index?.stats || null;
}

/**
 * Inject a pre-hydrated index into the singleton.
 * After calling this, initializeMegaDocsIndex() becomes a no-op.
 */
export function setIndex(idx: MegaDocsIndex): void {
  index = idx;
}

// ============================================================================
// Index Serialization / Deserialization
// ============================================================================

function mapToRecord<V>(map: Map<string, V>): Record<string, V> {
  return Object.fromEntries(map);
}

function recordToMap<V>(rec: Record<string, V>): Map<string, V> {
  return new Map(Object.entries(rec));
}

/**
 * Convert the live MegaDocsIndex (with Maps/Sets) into a JSON-serializable object.
 */
export function serializeIndex(idx?: MegaDocsIndex): SerializedMegaDocsIndex {
  const source = idx || getIndex();
  return {
    endpoints: mapToRecord(source.endpoints),
    smfTables: mapToRecord(source.smfTables),
    byTag: mapToRecord(source.byTag),
    byDomain: mapToRecord(source.byDomain),
    byCliCommand: mapToRecord(source.byCliCommand),
    byPath: mapToRecord(source.byPath),
    bySmfTable: mapToRecord(source.bySmfTable),
    cliToSwagger: mapToRecord(source.cliToSwagger),
    cliToSmfTables: mapToRecord(source.cliToSmfTables),
    swaggerToSmf: mapToRecord(source.swaggerToSmf),
    smfToSwagger: mapToRecord(source.smfToSwagger),
    parameterHints: mapToRecord(source.parameterHints),
    searchIndex: source.searchIndex.map((e) => ({
      id: e.id,
      text: e.text,
      tokens: [...e.tokens],
      source: e.source,
      domain: e.domain,
    })),
    stats: source.stats,
  };
}

/**
 * Rebuild a live MegaDocsIndex from a deserialized JSON object.
 */
export function deserializeIndex(data: SerializedMegaDocsIndex): MegaDocsIndex {
  return {
    endpoints: recordToMap(data.endpoints),
    smfTables: recordToMap(data.smfTables),
    byTag: recordToMap(data.byTag),
    byDomain: recordToMap(data.byDomain),
    byCliCommand: recordToMap(data.byCliCommand),
    byPath: recordToMap(data.byPath),
    bySmfTable: recordToMap(data.bySmfTable),
    cliToSwagger: recordToMap(data.cliToSwagger),
    cliToSmfTables: recordToMap(data.cliToSmfTables),
    swaggerToSmf: recordToMap(data.swaggerToSmf),
    smfToSwagger: recordToMap(data.smfToSwagger),
    parameterHints: recordToMap(data.parameterHints),
    searchIndex: data.searchIndex.map((e) => ({
      id: e.id,
      text: e.text,
      tokens: new Set(e.tokens),
      source: e.source,
      domain: e.domain,
    })),
    stats: data.stats,
  };
}

/**
 * Load a pre-built JSON index from a serialized object and inject it into the singleton.
 */
export async function loadPrebuiltIndex(
  data: SerializedMegaDocsIndex,
): Promise<void> {
  const startTime = Date.now();
  console.log(`[mega-docs] Loading pre-built index...`);

  index = deserializeIndex(data);

  const loadMs = Date.now() - startTime;
  console.log(
    `[mega-docs] Pre-built index loaded: ${index.stats.totalEndpoints} endpoints, ${index.stats.smfTables} SMF tables, ${loadMs}ms`,
  );
}

// ============================================================================
// Parameter Hints Builder
// ============================================================================

/**
 * Map of qualified parameter names to their source collection endpoints.
 * {svm.uuid} → GET /svm/svms
 * {volume.uuid} → GET /storage/volumes
 */
const QUALIFIED_PARAM_SOURCES: Record<
  string,
  { path: string; field: string; cli?: string }
> = {
  'svm.uuid': { path: '/svm/svms', field: 'uuid', cli: 'vserver show' },
  'svm.name': { path: '/svm/svms', field: 'name', cli: 'vserver show' },
  'volume.uuid': {
    path: '/storage/volumes',
    field: 'uuid',
    cli: 'volume show',
  },
  'volume.name': {
    path: '/storage/volumes',
    field: 'name',
    cli: 'volume show',
  },
  'node.uuid': {
    path: '/cluster/nodes',
    field: 'uuid',
    cli: 'cluster node show',
  },
  'node.name': {
    path: '/cluster/nodes',
    field: 'name',
    cli: 'cluster node show',
  },
  'aggregate.uuid': {
    path: '/storage/aggregates',
    field: 'uuid',
    cli: 'storage aggregate show',
  },
  'aggregate.name': {
    path: '/storage/aggregates',
    field: 'name',
    cli: 'storage aggregate show',
  },
  'qtree.id': {
    path: '/storage/qtrees',
    field: 'id',
    cli: 'volume qtree show',
  },
  'policy.id': {
    path: '/protocols/nfs/export-policies',
    field: 'id',
    cli: 'vserver export-policy show',
  },
  'policy.name': {
    path: '/protocols/nfs/export-policies',
    field: 'name',
    cli: 'vserver export-policy show',
  },
  'lun.uuid': { path: '/storage/luns', field: 'uuid', cli: 'lun show' },
  'igroup.uuid': {
    path: '/protocols/san/igroups',
    field: 'uuid',
    cli: 'lun igroup show',
  },
  'portset.uuid': {
    path: '/protocols/san/portsets',
    field: 'uuid',
    cli: 'lun portset show',
  },
  'share.name': {
    path: '/protocols/cifs/shares',
    field: 'name',
    cli: 'vserver cifs share show',
  },
  'bucket.uuid': {
    path: '/protocols/s3/buckets',
    field: 'uuid',
    cli: 's3 bucket show',
  },
  'cluster.uuid': {
    path: '/cluster',
    field: 'uuid',
    cli: 'cluster identity show',
  },
  'ipspace.uuid': {
    path: '/network/ipspaces',
    field: 'uuid',
    cli: 'network ipspace show',
  },
  'ipspace.name': {
    path: '/network/ipspaces',
    field: 'name',
    cli: 'network ipspace show',
  },
  'broadcast_domain.uuid': {
    path: '/network/ethernet/broadcast-domains',
    field: 'uuid',
  },
  'port.uuid': {
    path: '/network/ethernet/ports',
    field: 'uuid',
    cli: 'network port show',
  },
  'interface.uuid': {
    path: '/network/ip/interfaces',
    field: 'uuid',
    cli: 'network interface show',
  },
  'route.uuid': {
    path: '/network/ip/routes',
    field: 'uuid',
    cli: 'network route show',
  },
  'snapshot.uuid': {
    path: '/storage/volumes/{volume.uuid}/snapshots',
    field: 'uuid',
    cli: 'volume snapshot show',
  },
  'file.path': { path: '/storage/volumes/{volume.uuid}/files', field: 'path' },
  'job.uuid': { path: '/cluster/jobs', field: 'uuid', cli: 'job show' },
  'schedule.uuid': {
    path: '/cluster/schedules',
    field: 'uuid',
    cli: 'job schedule show',
  },
};

/**
 * Build parameter hints for all endpoints with path parameters.
 * Determines how to obtain each required {param} value.
 */
function buildParameterHints(
  endpoints: Map<string, UnifiedEndpoint>,
  byCliCommand: Map<string, string>,
): Map<string, ParameterHint[]> {
  const hints = new Map<string, ParameterHint[]>();

  for (const [epId, ep] of endpoints) {
    // Only process swagger endpoints (they have documented path params)
    if (ep.source !== 'swagger') continue;

    // Extract path parameters from the path string
    const pathParams = extractPathParams(ep.path);
    if (pathParams.length === 0) continue;

    const epHints: ParameterHint[] = [];

    for (let i = 0; i < pathParams.length; i++) {
      const param = pathParams[i];
      const hint = buildHintForParam(param, i, pathParams, ep, endpoints);
      epHints.push(hint);
    }

    if (epHints.length > 0) {
      hints.set(epId, epHints);
    }
  }

  return hints;
}

/**
 * Extract path parameters from a URL path.
 * "/security/key-managers/{uuid}" → ["uuid"]
 * "/protocols/fpolicy/{svm.uuid}/policies/{name}" → ["svm.uuid", "name"]
 */
function extractPathParams(path: string): string[] {
  const params: string[] = [];
  const regex = /\{([^}]+)\}/g;
  let match;
  while ((match = regex.exec(path)) !== null) {
    params.push(match[1]);
  }
  return params;
}

/**
 * Build a hint for a single path parameter.
 */
function buildHintForParam(
  param: string,
  paramIndex: number,
  allParams: string[],
  endpoint: UnifiedEndpoint,
  endpoints: Map<string, UnifiedEndpoint>,
): ParameterHint {
  // 1. Check if this is a qualified param like {svm.uuid}
  const qualifiedSource = QUALIFIED_PARAM_SOURCES[param];
  if (qualifiedSource) {
    return {
      param,
      type: 'string',
      obtainFrom: {
        restEndpoint: {
          method: 'GET',
          path: qualifiedSource.path,
          description: `List all ${param.split('.')[0]}s to find their ${param.split('.')[1] || 'identifiers'}`,
        },
        cliCommand: qualifiedSource.cli,
        responseField: qualifiedSource.field,
      },
      hint: `Run GET ${qualifiedSource.path} to list available ${param.split('.')[0]}s and get their ${qualifiedSource.field}s${qualifiedSource.cli ? `, or use CLI: ${qualifiedSource.cli}` : ''}.`,
    };
  }

  // 2. Try to find collection endpoint by stripping the last path segment
  const collectionPath = getCollectionPath(endpoint.path, param);
  const collectionEndpoint = findEndpointByPath(
    endpoints,
    collectionPath,
    'GET',
  );

  if (collectionEndpoint) {
    // Check if this param depends on a previous param
    const dependsOn = paramIndex > 0 ? paramIndex - 1 : undefined;
    const cliCmd = collectionEndpoint.relatedCliCommands?.[0];

    return {
      param,
      type: 'string',
      dependsOn,
      obtainFrom: {
        restEndpoint: {
          method: 'GET',
          path: collectionPath,
          description: `List to find available ${param} values`,
        },
        cliCommand: cliCmd,
        responseField: param.includes('.') ? param.split('.')[1] : param,
      },
      hint:
        dependsOn !== undefined
          ? `After obtaining ${allParams[dependsOn]}, run GET ${collectionPath} to list available ${param} values${cliCmd ? `, or use CLI: ${cliCmd}` : ''}.`
          : `Run GET ${collectionPath} to list available ${param} values${cliCmd ? `, or use CLI: ${cliCmd}` : ''}.`,
    };
  }

  // 3. Generic hint for unknown params
  const resourceGuess = extractResourceFromPath(endpoint.path);
  return {
    param,
    type: 'string',
    obtainFrom: null,
    hint: `The ${param} parameter identifies a specific ${resourceGuess}. Check the parent collection or related CLI command to list available values.`,
  };
}

/**
 * Get the collection path by removing the parameter segment.
 * "/security/key-managers/{uuid}" → "/security/key-managers"
 * "/protocols/fpolicy/{svm.uuid}/policies/{name}" → "/protocols/fpolicy/{svm.uuid}/policies"
 */
function getCollectionPath(path: string, param: string): string {
  // Remove the {param} and any trailing segments
  const paramPattern = `/{${param}}`;
  const idx = path.indexOf(paramPattern);
  if (idx !== -1) {
    return path.substring(0, idx);
  }
  // Fallback: just remove the last segment if it's a param
  const segments = path.split('/');
  if (segments[segments.length - 1] === `{${param}}`) {
    return segments.slice(0, -1).join('/');
  }
  return path;
}

/**
 * Find an endpoint by path and method.
 */
function findEndpointByPath(
  endpoints: Map<string, UnifiedEndpoint>,
  path: string,
  method: string,
): UnifiedEndpoint | undefined {
  const id = `swagger:${method}:${path}`;
  return endpoints.get(id);
}

/**
 * Extract a human-readable resource name from a path.
 * "/security/key-managers/{uuid}" → "key-manager"
 */
function extractResourceFromPath(path: string): string {
  const segments = path.split('/').filter((s) => s && !s.startsWith('{'));
  const lastResource = segments[segments.length - 1];
  if (lastResource) {
    // Singularize: key-managers → key-manager
    return lastResource.replace(/s$/, '').replace(/-/g, ' ');
  }
  return 'resource';
}
