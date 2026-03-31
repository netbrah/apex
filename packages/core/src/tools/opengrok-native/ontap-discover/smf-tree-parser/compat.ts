/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SMF Tree Parser - Compatibility Layer
 *
 * Provides the same interface as smf-ast-parser/smf-iterator-fields.ts
 * for easy migration. Use the tree parser internally but export the
 * same types and functions.
 *
 * Usage:
 *   // Old code:
 *   import { parseSmfSchema } from '../smf-ast-parser/smf-iterator-fields.js';
 *
 *   // New code (drop-in replacement):
 *   import { parseSmfSchema } from '../smf-tree-parser/src/compat.js';
 */

import {
  parse,
  getTables,
  type TableDeclaration,
  type ActionDeclaration,
  type ViewDeclaration,
  type FieldDeclaration,
} from './index.js';

// ============================================================================
// Legacy Types (matching smf-iterator-fields.ts)
// ============================================================================

export type SmfFieldRole =
  | 'key'
  | 'key-forsort'
  | 'key-required'
  | 'key-nocreate'
  | 'read'
  | 'show'
  | 'show-required'
  | 'show-noread'
  | 'write'
  | 'write-noread'
  | 'create'
  | 'create-noread'
  | 'modify'
  | 'modify-noread'
  | 'unknown';

export interface SmfFieldPrefixes {
  optional: boolean;
  hidden: boolean;
  noPositional: boolean;
  mutualExclusiveGroup?: string;
}

export interface SmfField {
  name: string;
  uiName?: string;
  useUiNameInCode?: boolean;
  alias?: string;
  description: string;
  type: string;
  typeRange?: { min: number; max: number };
  listModifiers?: string[];
  role: SmfFieldRole;
  roleModifier?: string;
  priority?: number;
  pid?: number;
  pidPersistent?: boolean;
  prefixes: SmfFieldPrefixes;
}

export interface SmfMethodArg {
  name: string;
  description: string;
  type: string;
  role: 'in' | 'in-noread' | 'out' | 'out-noread' | 'write' | 'read';
}

export interface SmfMethod {
  name: string;
  description: string;
  privilege?: 'admin' | 'advanced' | 'diagnostic' | 'test';
  attributes: string[];
  args: SmfMethodArg[];
  command?: string;
}

export interface SmfTableAttributes {
  create?: boolean;
  modify?: boolean;
  automatic?: boolean;
  persistent?: boolean;
  replicated?: boolean;
  mdb?: boolean;
  deprecated?: boolean;
  cacheGets?: boolean;
  nonResetable?: boolean;
  nonInitable?: boolean;
  task?: boolean;
  rest?: boolean;
  noimp?: boolean;
  lazywrite?: boolean;
  honorWants?: boolean;
  dcn?: boolean;
  replicateUpdates?: boolean;
  dsmfRowUpdatedOnError?: boolean;
  sqlview?: boolean;
  privilege?: 'admin' | 'advanced' | 'diagnostic' | 'test';
  bootModes?: string[];
  vserverEnabled?: boolean;
  bypassCompatibilityChecks?: boolean | string[];
  protectedIterator?: boolean;
  privateFields?: string[];
  ksmfClient?: boolean;
  ksmfServer?: boolean;
  clientdist?: boolean;
  dsmfMaxHighPrio?: number;
  dsmfMaxIntPrio?: number;
  maxQueued?: number;
  rpcTimeout?: number;
}

export type SmfTableType = 'table' | 'action' | 'view';

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

export interface SmfParseResult {
  tableType: SmfTableType;
  tableName: string;
  tableDescription: string;
  tableAttributes: SmfTableAttributes;
  fields: SmfField[];
  methods: SmfMethod[];
  includes: string[];
  customTypeIncludes: string[];
  customTypes: SmfEnumType[];
  command?: string;
  baseTable?: string;
  keyTables?: string[];
  distKeys?: string[];
  alternateKeys?: string[][];
  cloneFields?: Array<{ table: string; spec: string }>;
  sqlView?: {
    attachDatabase?: string;
    viewQuery?: string;
    sqlFields?: string[];
    fieldsTable?: string;
  };
}

// ============================================================================
// AST to Legacy Format Converters
// ============================================================================

/** Safely extract the name string from an Identifier or raw string */
 
function getName(val: any): string {
  if (typeof val === 'string') return val;
  if (val && typeof val.name === 'string') return val.name;
  return '';
}

/** Safely extract the value string from a StringLiteral or raw string */
 
function getStr(val: any): string {
  if (typeof val === 'string') return val;
  if (val && typeof val.value === 'string') return val.value;
  return '';
}

/**
 * Convert AST FieldDeclaration to legacy SmfField
 */
function convertField(field: FieldDeclaration): SmfField {
  const ft = field.fieldType;
  const baseType = typeof ft === 'string' ? ft : ft?.baseType || 'unknown';
  return {
    name: getName(field.name).replace(/-/g, '_'),
    uiName: field.uiName ? getName(field.uiName).replace(/-/g, '_') : undefined,
    useUiNameInCode: field.useUiNameInCode,
    alias: field.alias,
    description: getStr(field.description),
    type: baseType,
    typeRange: ft?.range
      ? {
          min: ft.range.min,
          max: ft.range.max,
        }
      : undefined,
    listModifiers: ft?.listModifiers,
    role: (field.role || 'unknown') as SmfFieldRole,
    roleModifier: field.roleModifier,
    priority: field.priority,
    pid: field.pidPersistent !== undefined ? field.priority : undefined,
    pidPersistent: field.pidPersistent,
    prefixes: field.prefixes
      ? {
          optional: field.prefixes.optional,
          hidden: field.prefixes.hidden,
          noPositional: field.prefixes.noPositional,
        }
      : { optional: false, hidden: false, noPositional: false },
  };
}

/**
 * Convert AST table attributes to legacy format
 */
 
function convertAttributes(attrs: any): SmfTableAttributes {
  return {
    create: attrs.create,
    modify: attrs.modify,
    automatic: attrs.automatic,
    persistent: attrs.persistent,
    replicated: attrs.replicated,
    mdb: attrs.mdb,
    deprecated: attrs.deprecated,
    cacheGets: attrs.cacheGets,
    nonResetable: attrs.nonResetable,
    nonInitable: attrs.nonInitable,
    task: attrs.task,
    rest: attrs.rest,
    noimp: attrs.noimp,
    lazywrite: attrs.lazywrite,
    honorWants: attrs.honorWants,
    dcn: attrs.dcn,
    replicateUpdates: attrs.replicateUpdates,
    dsmfRowUpdatedOnError: attrs.dsmfRowUpdatedOnError,
    sqlview: attrs.sqlview,
    privilege: attrs.privilege,
    bootModes: attrs.bootModes,
    vserverEnabled: attrs.vserverEnabled,
    bypassCompatibilityChecks: attrs.bypassCompatibilityChecks,
    protectedIterator: attrs.protectedIterator,
    privateFields: attrs.privateFields,
    ksmfClient: attrs.ksmfClient,
    ksmfServer: attrs.ksmfServer,
    clientdist: attrs.clientdist,
    dsmfMaxHighPrio: attrs.dsmfMaxHighPrio,
    dsmfMaxIntPrio: attrs.dsmfMaxIntPrio,
    maxQueued: attrs.maxQueued,
    rpcTimeout: attrs.rpcTimeout,
  };
}

/**
 * Convert AST table/action/view to legacy SmfParseResult
 */
function convertToLegacy(
  decl: TableDeclaration | ActionDeclaration | ViewDeclaration,
): SmfParseResult {
  const tableType =
    decl.type === 'TableDeclaration'
      ? 'table'
      : decl.type === 'ActionDeclaration'
        ? 'action'
        : 'view';

  const fields = decl.body.fields?.fields.map(convertField) || [];

  const methods: SmfMethod[] =
    decl.body.methods?.methods.map((m) => ({
      name: getName(m.name),
      description: getStr(m.description),
      privilege: m.attributes?.privilege,
      attributes: m.attributes?.rawTokens || [],
      args:
        m.args?.args.map((a) => ({
          name: getName(a.name).replace(/-/g, '_'),
          description: getStr(a.description),
          type:
            typeof a.argType === 'string'
              ? a.argType
              : a.argType?.baseType || '',
          role: a.role,
        })) || [],
      command: typeof m.command === 'string' ? m.command : m.command?.value,
    })) || [];

  const result: SmfParseResult = {
    tableType,
    tableName: getName(decl.name),
    tableDescription: getStr(decl.description),
    tableAttributes: convertAttributes(decl.attributes),
    fields,
    methods,
    includes: [],
    customTypeIncludes: [],
    customTypes: [],
    command: decl.body.command?.command?.value,
  };

  // Handle dist_keys
  if (decl.body.distKeys) {
    if (decl.body.distKeys.fromTable) {
      result.distKeys = [`from:${getName(decl.body.distKeys.fromTable)}`];
    } else if (decl.body.distKeys.fields) {
      result.distKeys = decl.body.distKeys.fields.map((f) => getName(f));
    }
  }

  // Handle alternateKeys
  if (decl.body.alternateKeys) {
    result.alternateKeys = decl.body.alternateKeys.map((ak) =>
      ak.fields.map((f) => getName(f)),
    );
  }

  // Handle clone-fields
  if (decl.body.cloneFields) {
    result.cloneFields = [
      {
        table: getName(decl.body.cloneFields.tableName),
        spec: decl.body.cloneFields.spec,
      },
    ];
  }

  // Handle view-specific fields
  if (decl.type === 'ViewDeclaration') {
    const body = decl.body as any; // ViewBody
    if (body.attach || body.viewQuery || body.sqlFields) {
      result.sqlView = {
        attachDatabase: getStr(body.attach?.database),
        viewQuery: getStr(body.viewQuery?.query),
         
        sqlFields: body.sqlFields?.fields?.map(
          (f: any) => `${getName(f.tableName)}.${getName(f.fieldName)}`,
        ),
      };
    }

    // Try to extract base table from values block
    if (body.values?.references) {
       
      const allRef = body.values.references.find(
        (r: any) => r.fieldSpec === 'ALL',
      );
      if (allRef) {
        result.baseTable = getName(allRef.tableName);
      }
    }
  }

  return result;
}

// ============================================================================
// Public API (matching smf-iterator-fields.ts)
// ============================================================================

/**
 * Parse an SMF schema file and extract field definitions.
 *
 * This is the main compatibility function - same signature as the
 * regex-based parser in smf-iterator-fields.ts
 */
export function parseSmfSchema(content: string): SmfParseResult | null {
  const result = parse(content);

  if (!result.success) {
    // eslint-disable-next-line no-console
    console.error('Parse error:', result.errors[0]?.message);
    return null;
  }

  const tables = getTables(result.ast);
  if (tables.length === 0) {
    return null;
  }

  // Return the first table/action/view (matching legacy behavior)
  return convertToLegacy(tables[0]);
}

/**
 * Parse multiple tables from a single SMF content string
 * (golden_global.smf style)
 */
export function parseSmfSchemaAll(content: string): SmfParseResult[] {
  const result = parse(content);

  if (!result.success) {
    // eslint-disable-next-line no-console
    console.error('Parse error:', result.errors[0]?.message);
    return [];
  }

  return getTables(result.ast).map(convertToLegacy);
}

/**
 * Generate the list of auto-generated methods from field names.
 */
export function generateMethodList(fields: SmfField[]): string[] {
  const methods: string[] = [];

  for (const field of fields) {
    const methodName = field.name.replace(/-/g, '_');
    methods.push(`set_${methodName}`);
    methods.push(`get_${methodName}`);
  }

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

/**
 * Match a callee method name to an SMF field.
 */
export function matchCalleeToSmfField(
  callee: string,
  fields: SmfField[],
): SmfField | undefined {
  const match = callee.match(/^(set|get|query)_(.+)$/);
  if (!match) return undefined;

  const fieldName = match[2];

  const exactMatch = fields.find((f) => f.name === fieldName);
  if (exactMatch) return exactMatch;

  const dashedName = fieldName.replace(/_/g, '-');
  return fields.find((f) => f.name === dashedName);
}

// ============================================================================
// Additional exports for full compatibility
// ============================================================================

export {
  SmfFieldRole as FieldRole,
  SmfField as Field,
  SmfMethod as Method,
  SmfTableAttributes as TableAttributes,
  SmfParseResult as ParseResult,
};
