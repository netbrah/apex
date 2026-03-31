/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable */
/**
 * SMF Iterator Fields Tool
 *
 * Parses SMF schema files to extract field definitions and generated methods
 * for ONTAP iterator classes. This is useful for:
 *
 * 1. Understanding what fields an iterator has
 * 2. Knowing which set/get methods are auto-generated vs custom
 * 3. Understanding the data model (key fields vs read-only)
 *
 * Usage:
 *   smf_iterator_fields({ iterator: "keymanager_external_show_status_iterator" })
 *
 * Returns:
 *   - tableName: The SMF table name
 *   - smfFile: Path to the .smf file
 *   - fields: Array of field definitions with name, description, type, role
 *   - generatedMethods: List of auto-generated set/get methods
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { z } from '../lib/zod-shim.js';
import {
  makeOpenGrokRequest,
  getFileContent,
  DEFAULT_PROJECT,
} from '../lib/opengrok.js';
import { logTool } from '../lib/logger.js';
import { classifyError } from '../lib/errors.js';
import { getSmfTable } from '../lib/smf-golden-index.js';

// ============================================================================
// Types - EXPORTED for reuse
// ============================================================================

/**
 * SMF Field attributes/roles:
 * - key: Index field (determines sort order)
 * - key-forsort: Sort order field, not required for get/modify/delete
 * - key-required: Key that must be set even for next()
 * - key-nocreate: Key that cannot be set from CLI/REST during creation
 * - read: Read-only field
 * - show: Display field (alias for read in some contexts)
 * - show-required: Input-only, queries not allowed
 * - write: Can be set on create and modify
 * - create: Can only be set during row creation
 * - modify: Can only be set during modify
 */
export type SmfFieldRole =
  | 'key'
  | 'key-forsort'
  | 'key-required'
  | 'key-nocreate'
  | 'read'
  | 'show'
  | 'show-required'
  | 'write'
  | 'create'
  | 'modify'
  | 'unknown';

export interface SmfFieldPrefixes {
  optional: boolean; // ! - optional during row creation
  hidden: boolean; // ~ - hidden in CLI/WEB
  noPositional: boolean; // - - cannot be specified positionally in CLI
  mutualExclusiveGroup?: string; // Group ID if part of (a|b) mutual exclusive
}

export interface SmfField {
  name: string; // Internal field name
  uiName?: string; // UI name if different (name=ui_name)
  useUiNameInCode?: boolean; // ^ prefix - use ui_name in generated code
  alias?: string; // Single-char alias (name,c)
  description: string;
  type: string;
  typeRange?: { min: number; max: number }; // For integer<MIN..MAX> or text<MIN..MAX>
  listModifiers?: string[]; // For list<type,newline,once,BYTES>
  role: SmfFieldRole;
  roleModifier?: string; // -noread suffix
  priority?: number; // Priority in brackets [N]
  pid?: number; // Permanent field identifier
  pidPersistent?: boolean; // (N) = persistent, [N] = non-persistent
  prefixes: SmfFieldPrefixes;
}

export interface SmfEnumValue {
  name: string;
  value: number;
  description: string;
}

export interface SmfEnumType {
  name: string;
  description: string;
  values: SmfEnumValue[];
}

/**
 * SMF method argument (for extrinsic methods)
 */
export interface SmfMethodArg {
  name: string;
  description: string;
  type: string;
  role: 'in' | 'out' | 'write' | 'read'; // in=write, out=read
}

/**
 * SMF extrinsic method definition
 * Parsed from: methods { method name "desc" { attrs } { args { ... } } }
 */
export interface SmfMethod {
  name: string;
  description: string;
  privilege?: 'admin' | 'advanced' | 'diagnostic' | 'test';
  attributes: string[]; // noquery, static, readonly, extend_interface, etc.
  args: SmfMethodArg[];
  command?: string; // If method has a command directive
}

/**
 * SMF table attributes - storage, behavior, and access control
 */
export interface SmfTableAttributes {
  // Storage attributes
  create?: boolean; // Supports create/remove operations
  automatic?: boolean; // SMF provides RAM storage
  persistent?: boolean; // Table is persistent
  replicated?: boolean; // Managed by RDB
  mdb?: boolean; // Local persistent storage (MDB)
  deprecated?: boolean; // Table is deprecated
  cacheGets?: boolean; // Performance optimization for gets
  nonResetable?: boolean; // Cannot be reset (persistent only)
  nonInitable?: boolean; // Cannot be initialized (persistent only)

  // Behavior attributes
  task?: boolean; // Async thread execution
  rest?: boolean; // Exposes REST API
  noimp?: boolean; // Autogenerate iterator class
  lazywrite?: boolean; // Delayed flash writes
  honorWants?: boolean; // honor-wants attribute
  dcn?: boolean; // Distributed change notification (implies rest, noimp)
  replicateUpdates?: boolean; // Non-replicated userspace tables
  dsmfRowUpdatedOnError?: boolean; // DSMF error handling
  sqlview?: boolean; // SQL view support (paired with noimp)

  // Access control
  privilege?: 'admin' | 'advanced' | 'diagnostic' | 'test';
  bootModes?: string[]; // prekmod, precluster, maintenance, normal, etc.
  vserverEnabled?: boolean; // vserver-enabled attribute
  bypassCompatibilityChecks?: boolean | string[]; // Table-level or field-specific
  protectedIterator?: boolean; // Protected iterator access
  privateFields?: string[]; // Fields with restricted access

  // Other
  ksmfClient?: boolean; // Kernel accessible
  ksmfServer?: boolean; // Kernel table
  clientdist?: boolean; // Generate client_smdb.cc

  // Priority overrides (DSMF)
  dsmfMaxHighPrio?: number; // Max high priority
  dsmfMaxIntPrio?: number; // Max intermediate priority
  maxQueued?: number; // Max queued operations

  // Timeouts
  rpcTimeout?: number; // RPC timeout in seconds
}

export type SmfTableType = 'table' | 'action' | 'view';

export interface SmfParseResult {
  tableType: SmfTableType; // table, action, or view
  tableName: string;
  tableDescription: string;
  tableAttributes: SmfTableAttributes;
  fields: SmfField[];
  methods: SmfMethod[]; // Extrinsic methods from methods { } block
  includes: string[]; // All includes
  customTypeIncludes: string[]; // Non-standard type includes (domain-specific)
  customTypes: SmfEnumType[]; // Enum types defined or referenced
  command?: string;
  baseTable?: string; // For views: base table that has ALL fields
  keyTables?: string[]; // For views: tables referenced in keys from
  baseTableSmfFile?: string; // For views: resolved base table SMF file path
  resolvedFromBase?: boolean; // For views: fields were resolved from base table
  distKeys?: string[]; // Distribution keys for DCN/DSMF
  alternateKeys?: string[][]; // Alternate key sets for queries
  cloneFields?: { table: string; spec: string }[]; // Clone-fields directives

  // SQL View specific
  sqlView?: {
    attachDatabase?: string; // ATTACH "vldb" database name
    viewQuery?: string; // The SQL VIEW query
    sqlFields?: string[]; // sql-fields { table.field } references
    fieldsTable?: string; // Derived: the _fields table name
  };
}

// Standard SMF type paths - these are infrastructure types, not domain-specific
const STANDARD_SMF_TYPE_PATHS = ['smf/schemas/', 'smf/types/'];

/**
 * Check if an include path is a standard SMF type (infrastructure, not domain-specific)
 */
function isStandardSmfType(includePath: string): boolean {
  return STANDARD_SMF_TYPE_PATHS.some((prefix) => includePath.includes(prefix));
}

// ============================================================================
// Field Parser - Comprehensive SMF field definition parsing
// ============================================================================

/**
 * Parse a single SMF field definition line.
 *
 * Full syntax:
 * [ [ ( | | ] [ ~ | [-]! ] ]field_name[=[^]ui_name][,char][)] field_description field_type field_attribute[( pid ) | [ pid ]]
 *
 * Examples:
 *   vserver           "Vserver"                   vserver-name      key[1]
 *   -key-id           "Key ID"                    uint64            key(2)
 *   !-volume          "Volume"                    vol-name          write[3]
 *   ~debug-mode       "Debug Mode"                bool              read[4]
 *   name=visible-name "Display Name"              string            write[5]
 *   short,s           "Short Option"              string            write[6]
 *   (onboard          "Onboard Mode"              bool              write[7]
 *   |external)        "External Mode"             bool              write[8]
 */
function parseSmfFieldLine(line: string): SmfField | null {
  const trimmed = line.trim();
  if (
    !trimmed ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*')
  ) {
    return null;
  }

  // Track parsing state for mutual exclusive groups
  let mutualExclusiveGroup: string | undefined;
  let workingLine = trimmed;

  // Handle mutual exclusive group markers: ( at start, | at start, ) at end
  if (workingLine.startsWith('(')) {
    mutualExclusiveGroup = 'group_' + Math.random().toString(36).substr(2, 6);
    workingLine = workingLine.substring(1);
  } else if (workingLine.startsWith('|')) {
    workingLine = workingLine.substring(1);
    // Note: We can't track the group ID across lines in this parser
  }

  if (workingLine.endsWith(')') && !workingLine.match(/\[\d+\]$/)) {
    workingLine = workingLine.slice(0, -1);
  }

  // Parse prefixes: ~ (hidden), - (no positional), ! (optional)
  // Can appear in combinations: !-, -!, ~, etc.
  const prefixes: SmfFieldPrefixes = {
    optional: false,
    hidden: false,
    noPositional: false,
    mutualExclusiveGroup,
  };

  // Extract prefix characters
  const prefixMatch = workingLine.match(/^([~!-]+)/);
  if (prefixMatch) {
    const prefixStr = prefixMatch[1];
    prefixes.hidden = prefixStr.includes('~');
    prefixes.optional = prefixStr.includes('!');
    prefixes.noPositional = prefixStr.includes('-');
    workingLine = workingLine.substring(prefixStr.length);
  }

  // Main field regex:
  // field_name[=ui_name|=^ui_name][,char] "description" type role[priority] or role(pid) or role[pid]
  const fieldRegex =
    /^(\w[\w-]*)(?:=([\^]?)(\w[\w-]*))?(?:,(\w))?\s+"([^"]+)"\s+(\S+)\s+(key(?:-forsort|-required|-nocreate)?|read|show(?:-required)?|write|create|modify)(-noread)?(?:\[(\d+)\]|\((\d+)\))?/;

  const match = workingLine.match(fieldRegex);
  if (!match) {
    // Try simpler pattern without priority/pid
    const simpleRegex =
      /^(\w[\w-]*)(?:=([\^]?)(\w[\w-]*))?(?:,(\w))?\s+"([^"]+)"\s+(\S+)\s+(key(?:-forsort|-required|-nocreate)?|read|show(?:-required)?|write|create|modify)(-noread)?/;
    const simpleMatch = workingLine.match(simpleRegex);

    if (!simpleMatch) {
      return null;
    }

    const [
      ,
      name,
      useUiInCode,
      uiName,
      alias,
      description,
      type,
      role,
      roleModifier,
    ] = simpleMatch;
    const typeInfo = parseTypeInfo(type);

    return {
      name: name.replace(/-/g, '_'),
      uiName: uiName ? uiName.replace(/-/g, '_') : undefined,
      useUiNameInCode: useUiInCode === '^',
      alias: alias || undefined,
      description,
      type: typeInfo.type,
      typeRange: typeInfo.typeRange,
      listModifiers: typeInfo.listModifiers,
      role: parseRole(role),
      roleModifier: roleModifier || undefined,
      prefixes,
    };
  }

  const [
    ,
    name,
    useUiInCode,
    uiName,
    alias,
    description,
    type,
    role,
    roleModifier,
    bracketPid,
    parenPid,
  ] = match;
  const typeInfo = parseTypeInfo(type);

  // Parse PID - (N) is persistent, [N] is non-persistent
  let pid: number | undefined;
  let pidPersistent: boolean | undefined;

  if (parenPid) {
    pid = parseInt(parenPid, 10);
    pidPersistent = true; // Parentheses = persistent
  } else if (bracketPid) {
    pid = parseInt(bracketPid, 10);
    pidPersistent = false; // Brackets = non-persistent
  }

  return {
    name: name.replace(/-/g, '_'),
    uiName: uiName ? uiName.replace(/-/g, '_') : undefined,
    useUiNameInCode: useUiInCode === '^',
    alias: alias || undefined,
    description,
    type: typeInfo.type,
    typeRange: typeInfo.typeRange,
    listModifiers: typeInfo.listModifiers,
    role: parseRole(role),
    roleModifier: roleModifier || undefined,
    priority: bracketPid ? parseInt(bracketPid, 10) : undefined,
    pid,
    pidPersistent,
    prefixes,
  };
}

/**
 * Parse role string into SmfFieldRole type
 */
function parseRole(roleStr: string): SmfFieldRole {
  switch (roleStr) {
    case 'key':
    case 'key-forsort':
    case 'key-required':
    case 'key-nocreate':
    case 'read':
    case 'show':
    case 'show-required':
    case 'write':
    case 'create':
    case 'modify':
      return roleStr;
    default:
      return 'unknown';
  }
}

/**
 * Parse type string to extract range constraints and list modifiers.
 * Examples:
 *   integer<3..10> → { base: "integer", range: { min: 3, max: 10 } }
 *   text<0..64> → { base: "text", range: { min: 0, max: 64 } }
 *   list<KeyStoreType,once> → { base: "list<KeyStoreType>", listModifiers: ["once"] }
 *   list<text,newline,BYTES> → { base: "list<text>", listModifiers: ["newline", "BYTES"] }
 */
function parseTypeInfo(typeStr: string): {
  type: string;
  typeRange?: { min: number; max: number };
  listModifiers?: string[];
} {
  // Check for range syntax: type<MIN..MAX>
  const rangeMatch = typeStr.match(/^(\w+)<(-?\d+)\.\.(-?\d+)>$/);
  if (rangeMatch) {
    return {
      type: rangeMatch[1],
      typeRange: {
        min: parseInt(rangeMatch[2], 10),
        max: parseInt(rangeMatch[3], 10),
      },
    };
  }

  // Check for list syntax: list<type,modifier1,modifier2>
  const listMatch = typeStr.match(/^list<([^,>]+)(?:,(.+))?>$/);
  if (listMatch) {
    const baseType = listMatch[1];
    const modifiersStr = listMatch[2];

    if (modifiersStr) {
      const modifiers = modifiersStr.split(',').map((m) => m.trim());
      return {
        type: `list<${baseType}>`,
        listModifiers: modifiers,
      };
    }
    return { type: typeStr };
  }

  return { type: typeStr };
}

export interface SmfLookupResult {
  success: boolean;
  iterator: string;
  tableName?: string;
  smfFile?: string;
  fields?: SmfField[];
  generatedMethods?: string[];
  customTypeIncludes?: string[]; // Domain-specific type includes (not standard SMF)
  customTypes?: SmfEnumType[]; // Enum type definitions
  error?: string;
  errorType?: string;
  searchedQueries?: Array<{ type: string; query: string; path?: string }>;
  suggestion?: string;
  retryable?: boolean;
}

// ============================================================================
// Table Attributes Parser
// ============================================================================

/**
 * Parse table attributes from the attribute block.
 * Example: { create automatic persistent rest }
 * Also handles blocks like: bypass-compatibility-checks { field1 field2 }
 */
function parseTableAttributes(attrBlock: string): SmfTableAttributes {
  const attrs: SmfTableAttributes = {};

  // Handle nested blocks like: bypass-compatibility-checks { field1 field2 }
  const nestedBlockRegex =
    /(bypass-compatibility-checks|private-fields|dsmf-max-high-prio|dsmf-max-int-prio|max-queued|rpc_timeout)\s*\{([^}]*)\}/gi;
  let nestedMatch;
  while ((nestedMatch = nestedBlockRegex.exec(attrBlock)) !== null) {
    const [fullMatch, attrName, blockContent] = nestedMatch;
    const normalizedName = attrName.toLowerCase();
    const values = blockContent
      .trim()
      .split(/\s+/)
      .filter((v) => v.length > 0);

    switch (normalizedName) {
      case 'bypass-compatibility-checks':
        attrs.bypassCompatibilityChecks = values.length > 0 ? values : true;
        break;
      case 'private-fields':
        attrs.privateFields = values;
        break;
      case 'dsmf-max-high-prio':
        attrs.dsmfMaxHighPrio = parseInt(values[0], 10) || undefined;
        break;
      case 'dsmf-max-int-prio':
        attrs.dsmfMaxIntPrio = parseInt(values[0], 10) || undefined;
        break;
      case 'max-queued':
        attrs.maxQueued = parseInt(values[0], 10) || undefined;
        break;
      case 'rpc_timeout':
        // Handle formats: "300s" or "300"
        const timeoutStr = values[0]?.replace(/s$/i, '');
        attrs.rpcTimeout = parseInt(timeoutStr, 10) || undefined;
        break;
    }
  }

  // Remove nested blocks from the string for simple token parsing
  const simpleAttrBlock = attrBlock.replace(nestedBlockRegex, '');
  const tokens = simpleAttrBlock.split(/\s+/).filter((t) => t.length > 0);

  for (const token of tokens) {
    switch (token.toLowerCase()) {
      // Storage attributes
      case 'create':
        attrs.create = true;
        break;
      case 'automatic':
        attrs.automatic = true;
        break;
      case 'persistent':
        attrs.persistent = true;
        break;
      case 'replicated':
        attrs.replicated = true;
        break;
      case 'mdb':
        attrs.mdb = true;
        break;
      case 'deprecated':
        attrs.deprecated = true;
        break;
      case 'cache-gets':
        attrs.cacheGets = true;
        break;
      case 'nonresetable':
        attrs.nonResetable = true;
        break;
      case 'noninitable':
        attrs.nonInitable = true;
        break;

      // Behavior attributes
      case 'task':
        attrs.task = true;
        break;
      case 'rest':
        attrs.rest = true;
        break;
      case 'noimp':
        attrs.noimp = true;
        break;
      case 'lazywrite':
        attrs.lazywrite = true;
        break;
      case 'honor-wants':
        attrs.honorWants = true;
        break;
      case 'dcn':
        attrs.dcn = true;
        // DCN implies rest and noimp
        attrs.rest = true;
        attrs.noimp = true;
        break;
      case 'replicate-updates':
        attrs.replicateUpdates = true;
        break;
      case 'dsmfrowupdatedonerror':
        attrs.dsmfRowUpdatedOnError = true;
        break;
      case 'sqlview':
        attrs.sqlview = true;
        break;

      // Access control - privilege levels
      case 'admin':
        attrs.privilege = 'admin';
        break;
      case 'advanced':
        attrs.privilege = 'advanced';
        break;
      case 'diagnostic':
        attrs.privilege = 'diagnostic';
        break;
      case 'test':
        attrs.privilege = 'test';
        break;
      case 'bypass-compatibility-checks':
        // Table-level (no specific fields)
        if (!attrs.bypassCompatibilityChecks) {
          attrs.bypassCompatibilityChecks = true;
        }
        break;
      case 'protected-iterator':
        attrs.protectedIterator = true;
        break;

      // Boot modes
      case 'prekmod':
      case 'precluster':
      case 'sfo-waiting':
      case 'maintenance':
      case 'normal':
      case 'no-mroot':
      case 'postkmod':
      case 'all-modes':
        attrs.bootModes = attrs.bootModes || [];
        attrs.bootModes.push(token);
        break;

      // Vserver
      case 'vserver-enabled':
        attrs.vserverEnabled = true;
        break;
      case 'vserver-disabled':
        attrs.vserverEnabled = false;
        break;

      // KSMF
      case 'ksmf-client':
        attrs.ksmfClient = true;
        break;
      case 'ksmf-server':
        attrs.ksmfServer = true;
        break;

      // Other
      case 'clientdist':
        attrs.clientdist = true;
        break;
    }
  }

  return attrs;
}

// ============================================================================
// Methods Block Parser
// ============================================================================

/**
 * Parse the methods block to extract extrinsic method definitions.
 *
 * Format:
 * methods {
 *     method methodName "Description" { privilege attrs } {
 *         args {
 *             argName "desc" type role
 *         }
 *         [command "cmd" {}]
 *     }
 * }
 */
function parseMethodsBlock(content: string): SmfMethod[] {
  const methods: SmfMethod[] = [];

  // Find the methods block - need to handle nested braces
  const methodsStartMatch = content.match(/methods\s*\{/);
  if (!methodsStartMatch) return methods;

  const methodsStart = methodsStartMatch.index! + methodsStartMatch[0].length;

  // Find matching closing brace by counting braces
  let braceCount = 1;
  let methodsEnd = methodsStart;
  for (let i = methodsStart; i < content.length && braceCount > 0; i++) {
    if (content[i] === '{') braceCount++;
    else if (content[i] === '}') braceCount--;
    methodsEnd = i;
  }

  const methodsBlock = content.substring(methodsStart, methodsEnd);

  // Parse individual method definitions
  // method NAME "desc" { attrs } { body }
  const methodRegex =
    /method\s+(\w+)\s+"([^"]+)"\s*\{([^}]*)\}\s*\{([\s\S]*?)\}(?=\s*(?:method|$))/g;
  let methodMatch;

  while ((methodMatch = methodRegex.exec(methodsBlock)) !== null) {
    const [, name, description, attrsBlock, bodyBlock] = methodMatch;

    const method: SmfMethod = {
      name,
      description,
      attributes: [],
      args: [],
    };

    // Parse attributes
    const attrTokens = attrsBlock
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    for (const attr of attrTokens) {
      switch (attr.toLowerCase()) {
        case 'admin':
          method.privilege = 'admin';
          break;
        case 'advanced':
          method.privilege = 'advanced';
          break;
        case 'diagnostic':
          method.privilege = 'diagnostic';
          break;
        case 'test':
          method.privilege = 'test';
          break;
        default:
          // noquery, static, readonly, extend_interface, etc.
          method.attributes.push(attr);
      }
    }

    // Parse args block
    const argsMatch = bodyBlock.match(/args\s*\{([^}]+)\}/);
    if (argsMatch) {
      const argsBlock = argsMatch[1];
      const argLines = argsBlock
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('//'));

      for (const argLine of argLines) {
        // argName "description" type role
        const argMatch = argLine.match(
          /(\w[\w-]*)\s+"([^"]+)"\s+(\S+)\s+(in|out|write|read)/,
        );
        if (argMatch) {
          const [, argName, argDesc, argType, argRole] = argMatch;
          method.args.push({
            name: argName.replace(/-/g, '_'),
            description: argDesc,
            type: argType,
            role: argRole as 'in' | 'out' | 'write' | 'read',
          });
        }
      }
    }

    // Parse command if present
    const commandMatch = bodyBlock.match(/command\s+"([^"]+)"/);
    if (commandMatch) {
      method.command = commandMatch[1];
    }

    methods.push(method);
  }

  return methods;
}

// ============================================================================
// SMF Parser
// ============================================================================

/**
 * Parse an SMF schema file and extract field definitions.
 *
 * SMF format:
 * ```
 * table TABLE_NAME "description" { options } {
 *     fields {
 *         field-name    "Description"    type    role[priority]
 *         -optional     "Optional Field" type    read[5]
 *     }
 * }
 * ```
 */
/**
 * Extract the section for a specific table from a compound SMF file.
 * Preserves the file preamble (includes, enums) and extracts only the
 * target table/action/view definition with its fields, methods, etc.
 * Returns the original content unchanged if targetTable is not provided.
 */
export function extractTableSection(
  content: string,
  targetTable?: string,
): string {
  if (!targetTable) return content;

  // Find the table/action/view definition for the target
  const escapedName = targetTable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tableStartRegex = new RegExp(
    `(?:^|\n)\\s*(?:table|action|view)\\s+${escapedName}\\s+"`,
  );
  const startMatch = tableStartRegex.exec(content);
  if (!startMatch) return content; // Target not found, return original for normal fallback

  const startIdx = startMatch.index;

  // Find the next table/action/view definition (start of next section)
  const afterStart = startIdx + startMatch[0].length;
  const nextTableRegex = /\n\s*(?:table|action|view)\s+\w+\s+"/g;
  nextTableRegex.lastIndex = afterStart;
  const nextMatch = nextTableRegex.exec(content);
  const endIdx = nextMatch ? nextMatch.index : content.length;

  // Preamble = everything before the first table/action/view (includes, enums)
  const firstTableRegex = /(?:^|\n)\s*(?:table|action|view)\s+\w+\s+"/;
  const firstTableMatch = firstTableRegex.exec(content);
  const preambleEnd = firstTableMatch ? firstTableMatch.index : 0;
  const preamble = content.substring(0, preambleEnd);

  // Table section
  const tableSection = content.substring(startIdx, endIdx);

  return preamble + tableSection;
}

export function parseSmfSchema(content: string): SmfParseResult | null {
  const result: SmfParseResult = {
    tableType: 'table',
    tableName: '',
    tableDescription: '',
    tableAttributes: {},
    fields: [],
    methods: [],
    includes: [],
    customTypeIncludes: [],
    customTypes: [],
  };

  // Extract includes - separate standard SMF types from domain-specific custom types
  const includeRegex = /include\s*\{\s*([^}]+)\s*\}/g;
  let match;
  while ((match = includeRegex.exec(content)) !== null) {
    const includePath = match[1].trim();
    result.includes.push(includePath);

    // Track custom type includes (domain-specific, not standard SMF infrastructure)
    if (!isStandardSmfType(includePath)) {
      result.customTypeIncludes.push(includePath);
    }
  }

  // Extract enum definitions: enum NAME "Description" { value=n "desc", ... }
  // Format: enum KeyStore "Key Store" { onboard=0 "Onboard", external=1 "External" }
  const enumRegex = /enum\s+(\w+)\s+"([^"]+)"\s*\{([^}]+)\}/g;
  while ((match = enumRegex.exec(content)) !== null) {
    const [, enumName, enumDesc, enumBody] = match;
    const enumType: SmfEnumType = {
      name: enumName,
      description: enumDesc,
      values: [],
    };

    // Parse enum values: name=value "description" or name=value
    const valueRegex = /(\w+)\s*=\s*(\d+)(?:\s+"([^"]+)")?/g;
    let valueMatch;
    while ((valueMatch = valueRegex.exec(enumBody)) !== null) {
      enumType.values.push({
        name: valueMatch[1],
        value: parseInt(valueMatch[2], 10),
        description: valueMatch[3] || valueMatch[1], // Use name if no description
      });
    }

    if (enumType.values.length > 0) {
      result.customTypes.push(enumType);
    }
  }

  // Extract table type, name, description, and attributes
  // Format: table|action|view NAME "Description" { attributes } { ... }
  const tableMatch = content.match(
    /(table|action|view)\s+(\w+)\s+"([^"]+)"\s*\{([^}]*)\}/,
  );
  if (tableMatch) {
    result.tableType = tableMatch[1] as SmfTableType;
    result.tableName = tableMatch[2];
    result.tableDescription = tableMatch[3];

    // Parse table attributes from the first {} block
    const attrBlock = tableMatch[4].trim();
    if (attrBlock) {
      result.tableAttributes = parseTableAttributes(attrBlock);
    }
  } else {
    // Fallback: try simpler pattern without attributes block
    const simpleMatch = content.match(
      /(table|action|view)\s+(\w+)\s+"([^"]+)"/,
    );
    if (simpleMatch) {
      result.tableType = simpleMatch[1] as SmfTableType;
      result.tableName = simpleMatch[2];
      result.tableDescription = simpleMatch[3];
    }
  }

  // Extract command (table-level, not inside methods block)
  // Match command that's NOT inside a methods block
  const commandMatch = content.match(/(?<!methods[\s\S]*?)command\s+"([^"]+)"/);
  if (commandMatch) {
    result.command = commandMatch[1];
  }

  // Parse methods block (extrinsic methods)
  result.methods = parseMethodsBlock(content);

  // Find the fields block (but not sql-fields)
  // Use negative lookbehind (?<!sql-) to avoid matching "sql-fields"
  const fieldsBlockMatch = content.match(
    /(?<!sql-)fields\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/,
  );
  if (!fieldsBlockMatch) {
    // For views, try to extract field references from "keys from" and "values" blocks
    // These reference fields from included tables
    if (result.tableType === 'view') {
      // Parse "values { table_name ALL[n] }" pattern to find base table
      const valuesMatch = content.match(/values\s*\{([^}]+)\}/);
      if (valuesMatch) {
        const valuesBlock = valuesMatch[1];
        // Look for "table_name ALL" pattern
        const allFieldsMatch = valuesBlock.match(/(\w+)\s+ALL/);
        if (allFieldsMatch) {
          result.baseTable = allFieldsMatch[1];
        }
      }

      // Parse "keys from { table_name field[n] }" pattern to get key fields
      const keysFromMatch = content.match(/keys\s+from\s*\{([^}]+)\}/);
      if (keysFromMatch) {
        const keysBlock = keysFromMatch[1];
        // Extract table references from keys from block
        const keyRefMatches = keysBlock.matchAll(/(\w+)\s+[\-\w]+\[(\d+)\]/g);
        for (const match of keyRefMatches) {
          if (!result.keyTables) result.keyTables = [];
          result.keyTables.push(match[1]);
        }
      }
    }

    // For SQL views: parse ATTACH, VIEW, and sql-fields
    if (result.tableAttributes.sqlview) {
      result.sqlView = {};

      // Parse ATTACH "database_name"
      const attachMatch = content.match(/ATTACH\s+"(\w+)"/);
      if (attachMatch) {
        result.sqlView.attachDatabase = attachMatch[1];
      }

      // Parse VIEW "SQL query" - handle multiline with nested brackets
      const viewStartMatch = content.match(/VIEW\s+"/);
      if (viewStartMatch) {
        const viewStart = viewStartMatch.index! + viewStartMatch[0].length;
        // Find the closing quote - handle escaped quotes
        let viewEnd = viewStart;
        for (let i = viewStart; i < content.length; i++) {
          if (content[i] === '"' && content[i - 1] !== '\\') {
            viewEnd = i;
            break;
          }
        }
        result.sqlView.viewQuery = content.substring(viewStart, viewEnd).trim();
      }

      // Parse sql-fields { table.field1 table.field2 ... }
      const sqlFieldsMatch = content.match(/sql-fields\s*\{([^}]+)\}/);
      if (sqlFieldsMatch) {
        const sqlFieldsBlock = sqlFieldsMatch[1];
        const fieldRefs = sqlFieldsBlock
          .trim()
          .split(/\s+/)
          .filter((f) => f.length > 0);
        result.sqlView.sqlFields = fieldRefs;

        // Derive the _fields table name from first reference
        if (fieldRefs.length > 0) {
          const firstRef = fieldRefs[0];
          const tablePart = firstRef.split('.')[0];
          if (tablePart) {
            result.sqlView.fieldsTable = tablePart;
            // Also set baseTable for auto-resolution
            result.baseTable = tablePart;
          }
        }
      }
    }

    return result;
  }

  const fieldsBlock = fieldsBlockMatch[1];
  const lines = fieldsBlock.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      continue;
    }

    // Use the comprehensive field parser
    const field = parseSmfFieldLine(trimmed);
    if (field) {
      result.fields.push(field);
    }
  }

  // Parse dist_keys directive: dist_keys { field1 field2 } or dist_keys from table_name
  const distKeysMatch = content.match(/dist_keys\s*\{([^}]+)\}/);
  if (distKeysMatch) {
    result.distKeys = distKeysMatch[1]
      .trim()
      .split(/\s+/)
      .filter((k) => k.length > 0);
  } else {
    const distKeysFromMatch = content.match(/dist_keys\s+from\s+(\w+)/);
    if (distKeysFromMatch) {
      result.distKeys = [`from:${distKeysFromMatch[1]}`];
    }
  }

  // Parse alternateKeys directive: alternateKeys name { field1 field2 }
  // Can have multiple named alternateKeys blocks
  const altKeysRegex = /alternateKeys\s+(\w+)\s*\{([^}]+)\}/g;
  let altMatch;
  while ((altMatch = altKeysRegex.exec(content)) !== null) {
    const [, keyName, fieldsBlock] = altMatch;
    const fields = fieldsBlock
      .trim()
      .split(/\s+/)
      .filter((f) => f.length > 0);
    if (fields.length > 0) {
      if (!result.alternateKeys) result.alternateKeys = [];
      result.alternateKeys.push(fields);
    }
  }

  // Parse clone-fields directive: clone-fields { table_name spec }
  const cloneFieldsMatch = content.match(/clone-fields\s*\{([^}]+)\}/);
  if (cloneFieldsMatch) {
    const cloneBlock = cloneFieldsMatch[1].trim();
    // Format: table_name ALL or table_name field[N] or table_name key read etc
    const cloneMatch = cloneBlock.match(/(\w+)\s+(.+)/);
    if (cloneMatch) {
      result.cloneFields = [
        { table: cloneMatch[1], spec: cloneMatch[2].trim() },
      ];
    }
  }

  return result;
}

/**
 * Generate the list of auto-generated methods from field names.
 * SMF generates set_* and get_* for each field.
 */
export function generateMethodList(fields: SmfField[]): string[] {
  const methods: string[] = [];

  for (const field of fields) {
    // Convert field name from kebab-case to snake_case
    const methodName = field.name.replace(/-/g, '_');
    methods.push(`set_${methodName}`);
    methods.push(`get_${methodName}`);
  }

  // Common iterator methods (always present)
  methods.push(
    'create',
    'create_imp',
    'get_imp',
    'next',
    'getError',
    'get_error',
  );

  return methods.sort();
}

// ============================================================================
// SMF Lookup Cache - for performance when enriching callees
// ============================================================================

const smfCache = new Map<string, SmfLookupResult>();

/**
 * Fetch SMF schema for an iterator class (with caching).
 * This is a lightweight version for use by analyze_symbol_ast.
 *
 * @param iterator - Iterator class name (e.g., "keymanager_external_show_status_iterator")
 * @param project - OpenGrok project
 * @returns SMF lookup result with fields and generated methods
 */
export async function fetchSmfForIterator(
  iterator: string,
  project: string = DEFAULT_PROJECT,
): Promise<SmfLookupResult> {
  // Check cache first
  const cacheKey = `${project}:${iterator}`;
  if (smfCache.has(cacheKey)) {
    return smfCache.get(cacheKey)!;
  }

  // Fast-path: try golden index first (O(1) HashMap lookup, no OpenGrok call)
  try {
    const goldenHit = await getSmfTable(iterator);
    if (goldenHit && goldenHit.fields.length > 0) {
      const result: SmfLookupResult = {
        success: true,
        iterator,
        tableName: goldenHit.tableName,
        smfFile: 'golden_global.smf',
        fields: goldenHit.fields as SmfField[],
        generatedMethods: generateMethodList(goldenHit.fields as SmfField[]),
      };
      smfCache.set(cacheKey, result);
      return result;
    }
  } catch {
    // Golden index not available — fall through to OpenGrok path
  }

  try {
    // Derive table name from iterator
    const tableName = iterator.replace(/_iterator$/, '');

    // Search for the .smf file
    const searchResult = await makeOpenGrokRequest('search', {
      projects: project,
      path: `${tableName}.smf`,
      maxresults: 5,
    });

    // Find the .smf file in results
    const smfFiles = Object.keys(searchResult.results || {}).filter((f) =>
      f.endsWith(`${tableName}.smf`),
    );

    // Compound-file fallback: table may be defined inside another .smf file
    let isCompoundFile = false;
    if (smfFiles.length === 0) {
      const broadSearch = await makeOpenGrokRequest('search', {
        projects: project,
        full: tableName,
        maxresults: 10,
      });

      const broadSmfFiles = Object.keys(broadSearch.results || {}).filter((f) =>
        f.endsWith('.smf'),
      );

      if (broadSmfFiles.length === 0) {
        const result: SmfLookupResult = {
          success: false,
          iterator,
          tableName,
          errorType: 'smf_not_found',
          error: `No SMF file found for ${tableName}.smf`,
          searchedQueries: [
            { type: 'path', query: `${tableName}.smf` },
            { type: 'full', query: tableName },
          ],
          suggestion:
            'This iterator may use a different table name convention, or may be a programmatic iterator without an SMF schema file.',
          retryable: false,
        };
        smfCache.set(cacheKey, result);
        return result;
      }

      smfFiles.push(...broadSmfFiles);
      isCompoundFile = true;
    }

    // Fetch and parse the SMF file
    const smfFile = smfFiles[0].replace(`/${project}/`, '/');
    const content = await getFileContent(smfFile, project);

    if (!content) {
      const result: SmfLookupResult = {
        success: false,
        iterator,
        tableName,
        smfFile,
        errorType: 'smf_fetch_failed',
        error: `Failed to fetch SMF file content`,
        retryable: true,
      };
      smfCache.set(cacheKey, result);
      return result;
    }

    // For compound files, extract just the target table section
    const parseContent = isCompoundFile
      ? extractTableSection(content, tableName)
      : content;

    // Parse the SMF schema
    const parsed = parseSmfSchema(parseContent);

    if (!parsed || parsed.fields.length === 0) {
      const result: SmfLookupResult = {
        success: false,
        iterator,
        tableName,
        smfFile,
        errorType: 'smf_parse_failed',
        error: `No fields found in SMF schema`,
        retryable: false,
      };
      smfCache.set(cacheKey, result);
      return result;
    }

    const result: SmfLookupResult = {
      success: true,
      iterator,
      tableName: parsed.tableName,
      smfFile,
      fields: parsed.fields,
      generatedMethods: generateMethodList(parsed.fields),
      customTypeIncludes:
        parsed.customTypeIncludes.length > 0
          ? parsed.customTypeIncludes
          : undefined,
      customTypes:
        parsed.customTypes.length > 0 ? parsed.customTypes : undefined,
    };
    smfCache.set(cacheKey, result);
    return result;
  } catch (error) {
    const classified = classifyError(error);
    const result: SmfLookupResult = {
      success: false,
      iterator,
      error: classified.message,
    };
    smfCache.set(cacheKey, result);
    return result;
  }
}

/**
 * Match a callee method name to an SMF field.
 * e.g., "set_vserver_id" → field "vserver-id" or "vserver_id"
 */
export function matchCalleeToSmfField(
  callee: string,
  fields: SmfField[],
): SmfField | undefined {
  // Extract field name from method (set_X or get_X → X)
  const match = callee.match(/^(set|get|query)_(.+)$/);
  if (!match) return undefined;

  const fieldName = match[2];

  // Try exact match first
  const exactMatch = fields.find((f) => f.name === fieldName);
  if (exactMatch) return exactMatch;

  // Try with underscores converted to dashes
  const dashedName = fieldName.replace(/_/g, '-');
  return fields.find((f) => f.name === dashedName);
}

// ============================================================================
// Tool Definition
// ============================================================================

export const smfIteratorFieldsTool = createTool({
  id: 'smf_iterator_fields',
  description: `Parse SMF schema to get iterator field definitions and auto-generated methods.

Given an iterator class name (e.g., keymanager_external_show_status_iterator),
finds the corresponding .smf file and extracts:
- Field definitions (name, type, description, role)
- Auto-generated set_*/get_* methods
- CLI command mapped to this iterator

Use this to understand:
- What data an iterator manages
- Which methods are SMF-generated vs custom code
- The CLI command that uses this iterator`,

  inputSchema: z.object({
    iterator: z
      .string()
      .describe(
        'Iterator class name (e.g., keymanager_external_show_status_iterator)',
      ),
    verbose: z
      .boolean()
      .default(false)
      .describe(
        'Include timing, includes, and other debug info (default: false)',
      ),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    error: z.string().optional(),

    // Iterator info
    iterator: z.string(),
    tableType: z
      .enum(['table', 'action', 'view'])
      .optional()
      .describe('SMF definition type'),
    tableName: z.string().optional(),
    tableDescription: z.string().optional(),
    smfFile: z.string().optional(),

    // Table attributes (only non-empty when present)
    tableAttributes: z
      .object({
        // Storage attributes
        create: z.boolean().optional(),
        automatic: z.boolean().optional(),
        persistent: z.boolean().optional(),
        replicated: z.boolean().optional(),
        mdb: z.boolean().optional(),
        deprecated: z.boolean().optional(),
        cacheGets: z
          .boolean()
          .optional()
          .describe('Performance optimization for gets'),
        nonResetable: z
          .boolean()
          .optional()
          .describe('Cannot be reset (persistent only)'),
        nonInitable: z
          .boolean()
          .optional()
          .describe('Cannot be initialized (persistent only)'),
        // Behavior attributes
        task: z.boolean().optional(),
        rest: z.boolean().optional(),
        noimp: z.boolean().optional(),
        lazywrite: z.boolean().optional(),
        honorWants: z.boolean().optional(),
        dcn: z
          .boolean()
          .optional()
          .describe('Distributed change notification (implies rest, noimp)'),
        replicateUpdates: z
          .boolean()
          .optional()
          .describe('Non-replicated userspace tables'),
        dsmfRowUpdatedOnError: z
          .boolean()
          .optional()
          .describe('DSMF error handling'),
        sqlview: z
          .boolean()
          .optional()
          .describe('SQL view support (paired with noimp)'),
        // Access control
        privilege: z
          .enum(['admin', 'advanced', 'diagnostic', 'test'])
          .optional(),
        bootModes: z.array(z.string()).optional(),
        vserverEnabled: z.boolean().optional(),
        bypassCompatibilityChecks: z
          .union([z.boolean(), z.array(z.string())])
          .optional()
          .describe('Table-level or field-specific bypass'),
        protectedIterator: z
          .boolean()
          .optional()
          .describe('Protected iterator access'),
        privateFields: z
          .array(z.string())
          .optional()
          .describe('Fields with restricted access'),
        // KSMF
        ksmfClient: z.boolean().optional(),
        ksmfServer: z.boolean().optional(),
        clientdist: z.boolean().optional(),
        // Priority overrides (DSMF)
        dsmfMaxHighPrio: z.number().optional().describe('Max high priority'),
        dsmfMaxIntPrio: z
          .number()
          .optional()
          .describe('Max intermediate priority'),
        maxQueued: z.number().optional().describe('Max queued operations'),
        // Timeouts
        rpcTimeout: z.number().optional().describe('RPC timeout in seconds'),
      })
      .optional()
      .describe(
        'Table-level attributes like create, automatic, persistent, etc.',
      ),

    // Field definitions with metadata
    fieldCount: z
      .number()
      .optional()
      .describe('Total number of fields (before truncation)'),
    fieldsTruncated: z
      .boolean()
      .optional()
      .describe('True if fields were auto-truncated (max 50)'),
    fields: z
      .array(
        z.object({
          name: z.string().describe('Internal field name (snake_case)'),
          uiName: z
            .string()
            .optional()
            .describe('UI name if different from internal name'),
          useUiNameInCode: z
            .boolean()
            .optional()
            .describe('If true, generated code uses UI name'),
          alias: z
            .string()
            .optional()
            .describe('Single-character alias for CLI'),
          description: z.string(),
          type: z.string(),
          typeRange: z
            .object({
              min: z.number().describe('Minimum value'),
              max: z.number().describe('Maximum value'),
            })
            .optional()
            .describe('For integer<MIN..MAX> or text<MIN..MAX> constraints'),
          listModifiers: z
            .array(z.string())
            .optional()
            .describe('For list<type,newline,once,BYTES> modifiers'),
          role: z.enum([
            'key',
            'key-forsort',
            'key-required',
            'key-nocreate',
            'read',
            'show',
            'show-required',
            'write',
            'create',
            'modify',
            'unknown',
          ]),
          roleModifier: z
            .string()
            .optional()
            .describe('Role modifier like -noread'),
          priority: z.number().optional().describe('Priority in brackets [N]'),
          pid: z.number().optional().describe('Permanent field identifier'),
          pidPersistent: z
            .boolean()
            .optional()
            .describe('True if (N) persistent, false if [N] non-persistent'),
          prefixes: z.object({
            optional: z.boolean().describe('! - optional during row creation'),
            hidden: z.boolean().describe('~ - hidden in CLI/WEB'),
            noPositional: z
              .boolean()
              .describe('- - cannot be specified positionally'),
            mutualExclusiveGroup: z
              .string()
              .optional()
              .describe('Group ID if part of (a|b) mutual exclusive'),
          }),
        }),
      )
      .optional(),

    // Generated methods
    // Generated methods with metadata
    methodCount: z
      .number()
      .optional()
      .describe('Total number of generated methods (before truncation)'),
    methodsTruncated: z
      .boolean()
      .optional()
      .describe('True if methods were auto-truncated (max 100)'),
    generatedMethods: z.array(z.string()).optional(),

    // CLI command
    command: z.string().optional(),

    // Extrinsic methods (from methods { } block)
    methods: z
      .array(
        z.object({
          name: z.string().describe('Method name'),
          description: z.string().describe('Method description'),
          privilege: z
            .enum(['admin', 'advanced', 'diagnostic', 'test'])
            .optional()
            .describe('Required privilege level'),
          attributes: z
            .array(z.string())
            .describe(
              'Method attributes: noquery, static, readonly, extend_interface, etc.',
            ),
          args: z
            .array(
              z.object({
                name: z.string().describe('Argument name'),
                description: z.string().describe('Argument description'),
                type: z.string().describe('Argument type'),
                role: z
                  .enum(['in', 'out', 'write', 'read'])
                  .describe(
                    'Argument direction: in/write = input, out/read = output',
                  ),
              }),
            )
            .describe('Method arguments'),
          command: z
            .string()
            .optional()
            .describe('CLI command if method has one'),
        }),
      )
      .optional()
      .describe('Extrinsic methods defined in methods { } block'),

    // Custom types (domain-specific, not standard SMF infrastructure types)
    customTypeIncludes: z
      .array(z.string())
      .optional()
      .describe(
        'Domain-specific type includes (e.g., keymanager_smdb_types/schemas/KeyStoreType.smf)',
      ),
    customTypes: z
      .array(
        z.object({
          name: z.string().describe('Enum type name'),
          description: z.string().describe('Enum description'),
          values: z.array(
            z.object({
              name: z.string().describe("Enum value name (e.g., 'onboard')"),
              value: z.number().describe('Numeric value'),
              description: z.string().describe('Human-readable description'),
            }),
          ),
        }),
      )
      .optional()
      .describe('Custom enum type definitions from referenced SMF files'),

    // Verbose-only fields
    includes: z
      .array(z.string())
      .optional()
      .describe('All included SMF schemas (verbose only)'),
    timing: z
      .object({
        totalMs: z.number(),
        searchMs: z.number(),
        fetchMs: z.number(),
      })
      .optional()
      .describe('Performance timing (verbose only)'),

    // Additional directives
    distKeys: z
      .array(z.string())
      .optional()
      .describe(
        "Distribution keys for DCN/DSMF (e.g., ['vserver', 'volume'] or ['from:other_table'])",
      ),
    alternateKeys: z
      .array(z.array(z.string()))
      .optional()
      .describe(
        "Alternate key sets for queries (e.g., [['vserver', 'uuid'], ['node', 'disk']])",
      ),
    cloneFields: z
      .array(
        z.object({
          table: z.string().describe('Source table name'),
          spec: z
            .string()
            .describe(
              "Clone specification (e.g., 'ALL', 'key read', 'field[N]')",
            ),
        }),
      )
      .optional()
      .describe('Clone-fields directives for field inheritance'),

    // SQL View specific
    sqlView: z
      .object({
        attachDatabase: z
          .string()
          .optional()
          .describe("Database to attach (e.g., 'vldb')"),
        viewQuery: z
          .string()
          .optional()
          .describe('The SQL VIEW query with SELECT/JOIN/UNION'),
        sqlFields: z
          .array(z.string())
          .optional()
          .describe(
            "sql-fields references (e.g., ['table_fields.vserver', 'table_fields.key_id'])",
          ),
        fieldsTable: z
          .string()
          .optional()
          .describe('The _fields table name derived from sql-fields'),
      })
      .optional()
      .describe(
        'SQL view details: ATTACH database, VIEW query, and sql-fields references',
      ),

    // Base table resolution (for views)
    baseTable: z
      .string()
      .optional()
      .describe('Base table name that has ALL fields (for view resolution)'),
    baseTableSmfFile: z
      .string()
      .optional()
      .describe('Resolved base table SMF file path'),
  }),

  execute: async ({ iterator, verbose = false }) => {
    const project = DEFAULT_PROJECT;
    const startTime = performance.now();
    let searchMs = 0;
    let fetchMs = 0;

    // Auto-truncation limits to prevent huge responses
    const MAX_FIELDS = 50;
    const MAX_METHODS = 100;

    const invocationId = logTool.start('smf_iterator_fields', {
      iterator,
      project,
      verbose,
    });

    try {
      // Step 1: Derive table name from iterator
      // keymanager_external_show_status_iterator → keymanager_external_show_status
      const tableName = iterator.replace(/_iterator$/, '');

      // Step 2: Search for the .smf file
      const searchStart = performance.now();
      const searchResult = await makeOpenGrokRequest('search', {
        projects: project,
        path: `${tableName}.smf`,
        maxresults: 5,
      });
      searchMs = performance.now() - searchStart;

      // Find the .smf file in results
      const smfFiles = Object.keys(searchResult.results || {}).filter((f) =>
        f.endsWith(`${tableName}.smf`),
      );

      // Compound-file fallback: table may be defined inside another .smf file
      let isCompoundFile = false;
      if (smfFiles.length === 0) {
        // Search for the table name in full text (no path filter — OpenGrok
        // does not support ".smf" as an extension filter). Filter client-side.
        const broadSearch = await makeOpenGrokRequest('search', {
          projects: project,
          full: tableName,
          maxresults: 10,
        });

        const broadSmfFiles = Object.keys(broadSearch.results || {}).filter(
          (f) => f.endsWith('.smf'),
        );

        if (broadSmfFiles.length === 0) {
          const result: Record<string, unknown> = {
            success: false,
            iterator,
            tableName,
            errorType: 'smf_not_found',
            error: `No SMF file found for iterator: ${iterator}. Searched for ${tableName}.smf`,
            searchedQueries: [
              { type: 'path', query: `${tableName}.smf` },
              { type: 'full', query: tableName },
            ],
            suggestion:
              'This iterator may use a different table name convention, or may be a programmatic iterator without an SMF schema file.',
            retryable: false,
          };
          if (verbose) {
            result.timing = {
              totalMs: Math.round(performance.now() - startTime),
              searchMs: Math.round(searchMs),
              fetchMs: 0,
            };
          }
          logTool.end(invocationId, {
            success: false,
            error: 'No SMF file found',
          });
          return result;
        }

        smfFiles.push(...broadSmfFiles);
        isCompoundFile = true;
      }
      const smfFile = smfFiles[0].replace(`/${project}/`, '/');
      const fetchStart = performance.now();
      const content = await getFileContent(smfFile, project);
      fetchMs = performance.now() - fetchStart;

      if (!content) {
        const result: Record<string, unknown> = {
          success: false,
          iterator,
          tableName,
          smfFile,
          errorType: 'smf_fetch_failed',
          error: `Failed to fetch SMF file content: ${smfFile}`,
          retryable: true,
        };
        if (verbose) {
          result.timing = {
            totalMs: Math.round(performance.now() - startTime),
            searchMs: Math.round(searchMs),
            fetchMs: Math.round(fetchMs),
          };
        }
        logTool.end(invocationId, {
          success: false,
          error: 'Failed to fetch SMF file',
        });
        return result;
      }

      // Step 4: Parse the SMF schema
      // For compound files, extract just the target table section
      const parseContent = isCompoundFile
        ? extractTableSection(content, tableName)
        : content;
      const parsed = parseSmfSchema(parseContent);

      // For views with no inline fields, try to resolve base table
      // This handles both:
      // - "view" tableType (traditional views)
      // - "table" with sqlview attribute (SQL view tables)
      const isViewLike =
        parsed?.tableType === 'view' || parsed?.tableAttributes?.sqlview;
      if (
        parsed &&
        parsed.fields.length === 0 &&
        isViewLike &&
        parsed.baseTable
      ) {
        // Search for the base table's SMF file
        const baseTableName = parsed.baseTable;
        const baseSearchResult = await makeOpenGrokRequest('search', {
          projects: project,
          path: `${baseTableName}.smf`,
          maxresults: 5,
        });

        const baseSmfFiles = Object.keys(
          baseSearchResult?.results || {},
        ).filter((f) => f.endsWith('.smf') && f.includes(baseTableName));

        if (baseSmfFiles.length > 0) {
          const baseSmfFile = baseSmfFiles[0].replace(`/${project}/`, '/');
          const baseContent = await getFileContent(baseSmfFile, project);

          if (baseContent) {
            const baseParsed = parseSmfSchema(baseContent);
            if (baseParsed && baseParsed.fields.length > 0) {
              // Merge base table fields into view
              parsed.fields = baseParsed.fields;
              parsed.baseTableSmfFile = baseSmfFile;
              // Keep view's attributes but note the base table
              if (verbose) {
                parsed.resolvedFromBase = true;
              }
            }
          }
        }
      }

      if (!parsed || parsed.fields.length === 0) {
        const result: Record<string, unknown> = {
          success: false,
          iterator,
          tableName,
          smfFile,
          errorType: 'smf_parse_failed',
          error: `Failed to parse SMF schema or no fields found in: ${smfFile}`,
          retryable: false,
        };
        if (verbose) {
          result.timing = {
            totalMs: Math.round(performance.now() - startTime),
            searchMs: Math.round(searchMs),
            fetchMs: Math.round(fetchMs),
          };
        }
        logTool.end(invocationId, {
          success: false,
          error: 'Failed to parse SMF schema',
        });
        return result;
      }

      // Step 5: Auto-truncate fields and methods to prevent huge responses
      const totalFieldCount = parsed.fields.length;
      const outputFields = parsed.fields.slice(0, MAX_FIELDS);
      const fieldsTruncated = parsed.fields.length > MAX_FIELDS;

      // Generate method list and truncate
      const allGeneratedMethods = generateMethodList(parsed.fields);
      const outputMethods = allGeneratedMethods.slice(0, MAX_METHODS);
      const methodsTruncated = allGeneratedMethods.length > MAX_METHODS;

      const totalMs = performance.now() - startTime;
      logTool.end(invocationId, {
        success: true,
        iterator,
        fieldCount: outputFields.length,
        totalFieldCount,
        methodCount: outputMethods.length,
        totalMethodCount: allGeneratedMethods.length,
      });

      // Build result - only include verbose fields when requested
      const result: Record<string, unknown> = {
        success: true,
        iterator,
        tableType: parsed.tableType,
        tableName: parsed.tableName,
        tableDescription: parsed.tableDescription,
        smfFile,
        // Only include tableAttributes if non-empty
        ...(Object.keys(parsed.tableAttributes).length > 0 && {
          tableAttributes: parsed.tableAttributes,
        }),
        // Fields with truncation metadata
        fieldCount: totalFieldCount,
        ...(fieldsTruncated && { fieldsTruncated: true }),
        fields: outputFields,
        // Methods with truncation metadata
        methodCount: allGeneratedMethods.length,
        ...(methodsTruncated && { methodsTruncated: true }),
        generatedMethods: outputMethods,
        command: parsed.command,
        // Extrinsic methods
        ...(parsed.methods.length > 0 && { methods: parsed.methods }),
        // Custom types are always useful
        ...(parsed.customTypeIncludes.length > 0 && {
          customTypeIncludes: parsed.customTypeIncludes,
        }),
        ...(parsed.customTypes.length > 0 && {
          customTypes: parsed.customTypes,
        }),
        // For views: include base table info if resolved
        ...(parsed.baseTable && { baseTable: parsed.baseTable }),
        ...(parsed.baseTableSmfFile && {
          baseTableSmfFile: parsed.baseTableSmfFile,
        }),
        // Additional directives
        ...(parsed.distKeys &&
          parsed.distKeys.length > 0 && { distKeys: parsed.distKeys }),
        ...(parsed.alternateKeys &&
          parsed.alternateKeys.length > 0 && {
            alternateKeys: parsed.alternateKeys,
          }),
        ...(parsed.cloneFields &&
          parsed.cloneFields.length > 0 && { cloneFields: parsed.cloneFields }),
        // SQL View details
        ...(parsed.sqlView &&
          Object.keys(parsed.sqlView).length > 0 && {
            sqlView: parsed.sqlView,
          }),
      };

      // Add verbose-only fields
      if (verbose) {
        result.includes = parsed.includes;
        result.timing = {
          totalMs: Math.round(totalMs),
          searchMs: Math.round(searchMs),
          fetchMs: Math.round(fetchMs),
        };
      }

      return result;
    } catch (error) {
      const classified = classifyError(error);
      logTool.end(invocationId, {
        success: false,
        error: classified.message,
        errorType: classified.errorType,
      });
      const result: Record<string, unknown> = {
        success: false,
        iterator,
        error: classified.message,
        errorType: classified.errorType,
        retryable: classified.retryable,
      };
      if (verbose) {
        result.timing = {
          totalMs: Math.round(performance.now() - startTime),
          searchMs: Math.round(searchMs),
          fetchMs: Math.round(fetchMs),
        };
      }
      return result;
    }
  },
});
