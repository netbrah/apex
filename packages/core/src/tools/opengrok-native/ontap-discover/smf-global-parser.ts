/* eslint-disable */
// @ts-nocheck
/**
 * Parse the golden_global.smf mega file
 * This is the ~19MB dump containing ALL SMF table definitions
 *
 * Uses the Peggy tree parser for fast, accurate single-pass parsing.
 * Can fetch live from OpenGrok or fall back to local file.
 */

// Tree parser — compat layer provides identical SmfParseResult types
import './smf-tree-parser/loader.js';
import {
  parseSmfSchemaAll,
  type SmfParseResult,
  type SmfTableAttributes,
  type SmfField,
} from './smf-tree-parser/compat.js';

import { getFileContent } from '../lib/opengrok.js';
import type {
  SmfTableInfo,
  SmfStorageType,
  FieldInfo,
  DebugSmdbInfo,
} from './types.js';

const GOLDEN_SMF_PATH = './golden_global.smf';
const OPENGROK_SMF_PATH = '/smfgen/bin/golden_global.smf';
const OPENGROK_PROJECT = 'dev';

export interface GlobalSmfParseResult {
  tables: Map<string, SmfTableInfo>;
  parseTimeMs: number;
  totalTables: number;
  errors: string[];
}

/**
 * Parse the entire golden_global.smf file using the Peggy tree parser.
 * Single-pass parse — no splitting or regex pre-processing needed.
 * Tries OpenGrok source first, falls back to local file on failure.
 */
export async function parseGoldenGlobalSmf(): Promise<GlobalSmfParseResult> {
  const startTime = Date.now();
  const tables = new Map<string, SmfTableInfo>();
  const errors: string[] = [];

  // Try sources in order: OpenGrok → local file
  let allParsed: SmfParseResult[] = [];
  let source: string = 'unknown';

  // 1) Try OpenGrok first, fall back to local file
  try {
    const content = await getFileContent(OPENGROK_SMF_PATH, OPENGROK_PROJECT);
    if (content && content.length > 1_000_000) {
      console.log(
        `[smf-global] OpenGrok: ${(content.length / 1024 / 1024).toFixed(2)} MB`,
      );
      const parseStart = Date.now();
      allParsed = parseSmfSchemaAll(content);
      const parseMs = Date.now() - parseStart;
      if (allParsed.length > 0) {
        source = 'opengrok';
        console.log(
          `[smf-global] Tree parser (OpenGrok): ${allParsed.length} declarations in ${parseMs}ms`,
        );
      } else {
        console.warn(
          `[smf-global] OpenGrok content failed to parse (0 declarations in ${parseMs}ms)`,
        );
      }
    }
  } catch (e) {
    console.warn(`[smf-global] OpenGrok fetch failed: ${e}`);
  }

  if (allParsed.length === 0) {
    errors.push('No SMF content available or parseable from OpenGrok');
    return {
      tables,
      parseTimeMs: Date.now() - startTime,
      totalTables: 0,
      errors,
    };
  }

  for (const parsed of allParsed) {
    try {
      if (parsed.tableName) {
        const tableInfo = convertToTableInfo(parsed);
        tables.set(parsed.tableName, tableInfo);
      }
    } catch (e) {
      errors.push(`Convert error for ${parsed.tableName}: ${e}`);
    }
  }

  const parseTimeMs = Date.now() - startTime;
  console.log(
    `[smf-global] Indexed ${tables.size} tables in ${parseTimeMs}ms (source: ${source})`,
  );

  return {
    tables,
    parseTimeMs,
    totalTables: tables.size,
    errors,
  };
}

/**
 * Convert SmfParseResult to SmfTableInfo with queryability analysis
 */
function convertToTableInfo(parsed: SmfParseResult): SmfTableInfo {
  const storage = classifyStorageType(parsed.tableAttributes, parsed.tableType);

  // Collect ALL CLI commands: table-level + method-level
  const cliCommands: string[] = [];
  if (parsed.command) {
    cliCommands.push(parsed.command);
  }
  for (const m of parsed.methods) {
    if (m.command && !cliCommands.includes(m.command)) {
      cliCommands.push(m.command);
    }
  }

  const attrs = parsed.tableAttributes;

  const tableInfo: SmfTableInfo = {
    tableName: parsed.tableName,
    tableType: parsed.tableType,
    description: parsed.tableDescription,
    command: parsed.command,
    cliCommands,
    storage,
    attributes: {
      // Storage type flags
      replicated: attrs.replicated,
      mdb: attrs.mdb,
      ksmfServer: attrs.ksmfServer,
      ksmfClient: attrs.ksmfClient,
      create: attrs.create,
      modify: attrs.modify,
      automatic: attrs.automatic,
      persistent: attrs.persistent,

      // Behavior flags
      rest: attrs.rest,
      noimp: attrs.noimp,
      sqlview: attrs.sqlview,
      dcn: attrs.dcn,
      vserverEnabled: attrs.vserverEnabled,
      deprecated: attrs.deprecated,
      task: attrs.task,
      lazywrite: attrs.lazywrite,
      honorWants: attrs.honorWants,
      replicateUpdates: attrs.replicateUpdates,
      cacheGets: attrs.cacheGets,
      nonResetable: attrs.nonResetable,
      nonInitable: attrs.nonInitable,
      clientdist: attrs.clientdist,
      protectedIterator: attrs.protectedIterator,
      dsmfRowUpdatedOnError: attrs.dsmfRowUpdatedOnError,
      bypassCompatibilityChecks: attrs.bypassCompatibilityChecks,

      // Access control
      privilege: attrs.privilege,
      bootModes: attrs.bootModes,
      privateFields: attrs.privateFields,

      // Tuning parameters
      dsmfMaxHighPrio: attrs.dsmfMaxHighPrio,
      dsmfMaxIntPrio: attrs.dsmfMaxIntPrio,
      maxQueued: attrs.maxQueued,
      rpcTimeout: attrs.rpcTimeout,
    },

    // Structural metadata
    baseTable: parsed.baseTable,
    distKeys: parsed.distKeys,
    alternateKeys: parsed.alternateKeys,
    cloneFields: parsed.cloneFields,
    sqlView: parsed.sqlView,

    fields: parsed.fields,
    keyFields: parsed.fields
      .filter((f) => f.role === 'key' || f.role.startsWith('key-'))
      .map((f) => f.name),
    generatedMethods: generateMethodsFromFields(
      parsed.fields,
      parsed.tableType,
    ),
    extrinsicMethods: parsed.methods.length > 0 ? parsed.methods : undefined,
  };

  return tableInfo;
}

/**
 * Classify storage type based on attributes
 * This determines if table is queryable via debug smdb table
 */
function classifyStorageType(
  attrs: SmfTableAttributes,
  tableType: string,
): SmfStorageType {
  // Priority order for classification
  if (attrs.ksmfServer) return 'ksmf-server'; // Kernel server - queryable
  if (attrs.ksmfClient) return 'ksmf-client'; // Kernel client - NOT queryable
  if (attrs.replicated) return 'replicated'; // RDB - queryable
  if (attrs.mdb) return 'mdb'; // MDB - queryable (needs node)
  if (attrs.persistent) return 'persistent'; // Persistent local - queryable
  if (attrs.automatic) return 'automatic'; // RAM - NOT queryable

  // Actions without storage are action-only
  if (tableType === 'action') return 'action';

  // Tables with only 'create' and no storage type are action tables
  if (
    attrs.create &&
    !attrs.replicated &&
    !attrs.mdb &&
    !attrs.automatic &&
    !attrs.persistent
  ) {
    return 'action';
  }

  return 'unknown';
}

/**
 * Check if a table is queryable via debug smdb table
 */
export function isQueryable(tableInfo: SmfTableInfo): boolean {
  switch (tableInfo.storage) {
    case 'replicated':
    case 'mdb':
    case 'ksmf-server':
    case 'persistent':
      return true;
    case 'ksmf-client':
    case 'automatic':
    case 'action':
      return false;
    default:
      return false;
  }
}

/**
 * Check if table requires -node parameter (MDB tables)
 */
export function requiresNodeParam(tableInfo: SmfTableInfo): boolean {
  return tableInfo.storage === 'mdb';
}

/**
 * Generate method list from fields and table type
 */
function generateMethodsFromFields(
  fields: SmfField[],
  tableType: string,
): string[] {
  const methods: string[] = [];
  for (const field of fields) {
    const name = field.name.replace(/-/g, '_');
    methods.push(`set_${name}`, `get_${name}`);

    // want_* and query_* for show/read fields
    if (
      field.role === 'show' ||
      field.role === 'show-required' ||
      field.role === 'read'
    ) {
      methods.push(`want_${name}`, `query_${name}`);
    }
  }

  // Core iteration/lifecycle methods
  methods.push(
    'create',
    'create_imp',
    'get_imp',
    'next',
    'next_imp',
    'getError',
    'get_error',
  );

  // Tables and views support remove/modify
  if (tableType === 'table' || tableType === 'view') {
    methods.push('remove', 'remove_imp', 'modify', 'modify_imp');
  }

  return methods;
}

/**
 * Convert SMF fields to FieldInfo for unified schema.
 * Preserves role nuance: show-noread fields are secret/password fields,
 * write-noread fields can be set but not retrieved.
 */
export function smfFieldsToFieldInfo(fields: SmfField[]): FieldInfo[] {
  return fields.map((f) => {
    // Map compound roles to base role for FieldInfo
    const baseRole = mapFieldRole(f.role);
    const isKey = f.role === 'key' || f.role.startsWith('key-');
    const isNoread =
      f.role === 'show-noread' ||
      f.role === 'write-noread' ||
      f.role === 'create-noread' ||
      f.role === 'modify-noread' ||
      f.roleModifier === 'noread';
    const isShow =
      f.role === 'show' ||
      f.role === 'show-required' ||
      f.role === 'show-noread';

    return {
      name: f.name,
      description: f.description,
      type: f.type,
      role: baseRole,
      required:
        !f.prefixes.optional &&
        (isKey ||
          f.role === 'write' ||
          f.role === 'key-required' ||
          f.role === 'show-required'),
      queryable: !isNoread && f.role !== 'key-nocreate',
      filterable: isKey,
      expensive: isShow && !isKey,
    };
  });
}

/**
 * Map detailed SmfFieldRole to base FieldInfo role
 */
function mapFieldRole(
  role: string,
): 'key' | 'read' | 'write' | 'create' | 'modify' | 'unknown' {
  if (role.startsWith('key')) return 'key';
  if (
    role === 'show' ||
    role === 'show-required' ||
    role === 'show-noread' ||
    role === 'read'
  )
    return 'read';
  if (role === 'write' || role === 'write-noread') return 'write';
  if (role === 'create' || role === 'create-noread') return 'create';
  if (role === 'modify' || role === 'modify-noread') return 'modify';
  return 'unknown';
}

// ============================================================================
// Debug SMDB Queryability - THE CRITICAL FUNCTIONS
// ============================================================================

/**
 * Check if an SMF table is an action table.
 * Action tables execute an operation (via POST/create) rather than storing queryable data.
 * They cannot be iterated with GET — only invoked with POST.
 */
export function isActionTable(table: SmfTableInfo): boolean {
  return table.tableType === 'action';
}

/**
 * Determine if table can be queried via: GET debug smdb table {name} show
 *
 * Rules:
 * - replicated (RDB) + non-action → ✅ GET returns records
 * - mdb (MDB) + non-action → ✅ GET returns records (needs -node)
 * - ksmf-server + non-action → ✅ GET returns records
 * - ksmf-server + action → ❌ GET returns "invalid operation"; use POST instead
 * - ksmf-client → ❌ No
 * - action (no storage) → ❌ No
 * - automatic → ❌ No (RAM only)
 * - persistent + non-action → ✅ GET returns records
 */
export function canDebugSmdbShow(table: SmfTableInfo): boolean {
  // Action tables can't be GET'd even if they have queryable storage
  if (isActionTable(table)) return false;

  switch (table.storage) {
    case 'replicated':
    case 'mdb':
    case 'ksmf-server':
    case 'persistent':
      return true;
    case 'ksmf-client':
    case 'automatic':
    case 'action':
      return false;
    default:
      return false;
  }
}

/**
 * Determine if table can be invoked via: POST debug smdb table {name}
 *
 * Action tables with queryable storage (ksmf-server, replicated, mdb)
 * support POST on the debug SMDB path to trigger their create operation.
 * The POST returns the action's output fields (all read-role fields).
 */
export function canDebugSmdbPost(table: SmfTableInfo): boolean {
  if (!isActionTable(table)) return false;

  // ksmf-server action tables with dist_keys cannot be invoked via debug SMDB REST —
  // they reject all field arguments with "Unexpected argument" errors.
  if (
    table.storage === 'ksmf-server' &&
    table.distKeys &&
    table.distKeys.length > 0
  ) {
    return false;
  }

  switch (table.storage) {
    case 'ksmf-server':
    case 'replicated':
    case 'mdb':
    case 'persistent':
      return true;
    default:
      return false;
  }
}

/**
 * Generate debug smdb query info with curl example.
 * Handles both GET-queryable tables and POST-invokable action tables.
 */
export function generateDebugSmdbInfo(
  table: SmfTableInfo,
): DebugSmdbInfo | undefined {
  const canGet = canDebugSmdbShow(table);
  const canPost = canDebugSmdbPost(table);
  if (!canGet && !canPost) return undefined;

  const path = `/api/private/cli/debug/smdb/table/${table.tableName}`;
  const requiresNode = table.storage === 'mdb';
  const requiresVserver = table.attributes.vserverEnabled === true;

  let curlExample: string;

  if (canPost) {
    // Action table — POST to invoke, optionally with write-role fields as body
    const writeFields = table.fields.filter(
      (f) => f.role === 'write' || f.role === 'create',
    );
    const bodyExample =
      writeFields.length > 0
        ? ` \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(
    Object.fromEntries(writeFields.map((f) => [f.name, `<${f.type}>`])),
  )}'`
        : '';

    curlExample = `# Action table — invoke via POST (GET returns "invalid operation")
# CLI: debug smdb table ${table.tableName} create
curl -k -s -u admin:<password> --noproxy '*' \\
  -X POST "https://<mgmt-ip>${path}"${bodyExample}`;
  } else {
    // Regular table — GET to query records
    const params: string[] = [];
    if (requiresNode) params.push('node=<node-name>');
    if (requiresVserver) params.push('vserver=<vserver-name>');
    if (table.keyFields.length > 0) {
      params.push(`fields=${table.keyFields.slice(0, 5).join(',')}`);
    }
    const queryString = params.length > 0 ? '?' + params.join('&') : '';

    curlExample = `# CLI: debug smdb table ${table.tableName} show
curl -k -s -u admin:<password> --noproxy '*' \\
  -X GET "https://<mgmt-ip>${path}${queryString}"`;
  }

  return {
    tableName: table.tableName,
    path,
    requiresNode,
    requiresVserver,
    curlExample,
  };
}
