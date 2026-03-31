/* eslint-disable */
// @ts-nocheck
/**
 * CLI Tree — deterministic ONTAP CLI command tree navigator
 *
 * Builds a tree from golden_global.smf containing all CLI commands with:
 *   - Full parameter details with SMF type resolution (custom types, enums)
 *   - CRUD method synthesis (show/create/modify/delete) for tables
 *   - CLI → REST mapping
 *   - Tree browsing, search, and leaf drill-down
 */

import './smf-tree-parser/loader.js';
import { parse } from './smf-tree-parser/index.js';
import type {
  TypeDeclaration,
  EnumDeclaration,
  TableDeclaration,
  ActionDeclaration,
  ViewDeclaration,
} from './smf-tree-parser/ast.js';

// ============================================================================
// Types
// ============================================================================

export interface CliTreeNode {
  segment: string;
  fullPath: string;
  children: Map<string, CliTreeNode>;
  tables: CliTableEntry[];
  isLeaf: boolean;
}

export interface CliTableEntry {
  tableName: string;
  tableType: 'table' | 'action' | 'view';
  description: string;
  command: string;
  fields: CliFieldEntry[];
  storage: string;
  restPath: string;
  httpMethod: string;
}

export interface CliFieldEntry {
  name: string;
  description: string;
  type: string;
  role: string;
  hidden: boolean;
  optional: boolean;
  typeInfo?: ResolvedType;
}

export interface ResolvedType {
  kind: 'builtin' | 'custom' | 'enum' | 'list';
  help?: string;
  uiName?: string;
  zephyrType?: string;
  enumValues?: { name: string; value: number; description: string }[];
  innerType?: string;
}

export interface BrowseResult {
  path: string;
  children: string[];
  childCount: number;
  totalLeafCommands: number;
  commands?: CliCommandDetail[];
}

export interface CliCommandDetail {
  command: string;
  tableName: string;
  tableType: string;
  description: string;
  storage: string;
  rest: { method: string; path: string };
  parameters: CliParamDetail[];
}

export interface CliParamDetail {
  name: string;
  cliFlag: string;
  description: string;
  type: string;
  role: string;
  hidden: boolean;
  optional: boolean;
  typeHelp?: string;
  typeUiName?: string;
  zephyrType?: string;
  innerType?: string;
  enumValues?: { name: string; value: number; description: string }[];
  innerEnumValues?: { name: string; value: number; description: string }[];
}

// ============================================================================
// Singleton CLI Tree
// ============================================================================

let cachedTree: CliTree | null = null;

export class CliTree {
  readonly root: CliTreeNode;
  readonly types: Map<string, TypeDeclaration>;
  readonly enums: Map<string, EnumDeclaration>;
  readonly commandCount: number;

  private constructor(
    root: CliTreeNode,
    types: Map<string, TypeDeclaration>,
    enums: Map<string, EnumDeclaration>,
    commandCount: number,
  ) {
    this.root = root;
    this.types = types;
    this.enums = enums;
    this.commandCount = commandCount;
  }

  /**
   * Build CLI tree from raw SMF content (golden_global.smf).
   * Caches the result for subsequent calls.
   */
  static fromContent(content: string): CliTree {
    if (cachedTree) return cachedTree;

    const result = parse(content);
    if (!result.success) {
      throw new Error(
        `SMF parse failed: ${result.errors.slice(0, 3).join('; ')}`,
      );
    }

    const types = new Map<string, TypeDeclaration>();
    const enums = new Map<string, EnumDeclaration>();
    const tables: (TableDeclaration | ActionDeclaration | ViewDeclaration)[] =
      [];

    for (const node of result.ast.body) {
      switch (node.type) {
        case 'TypeDeclaration':
          types.set(node.name.name, node);
          break;
        case 'EnumDeclaration':
          enums.set(node.name.name, node);
          break;
        case 'TableDeclaration':
        case 'ActionDeclaration':
        case 'ViewDeclaration':
          tables.push(node);
          break;
      }
    }

    const { root, commandCount } = buildTree(tables);
    cachedTree = new CliTree(root, types, enums, commandCount);
    return cachedTree;
  }

  /** Clear cached tree (for testing) */
  static clearCache(): void {
    cachedTree = null;
  }

  /**
   * Navigate to a path in the tree.
   * Returns null if path not found.
   */
  navigate(path: string): CliTreeNode | null {
    if (!path?.trim()) return this.root;

    const segments = path.trim().split(/\s+/);
    let node = this.root;

    for (const seg of segments) {
      const child = node.children.get(seg);
      if (child) {
        node = child;
        continue;
      }
      // Try normalized match
      const normalized = seg.toLowerCase().replace(/_/g, '-');
      const match = Array.from(node.children.entries()).find(
        ([k]) => k.toLowerCase().replace(/_/g, '-') === normalized,
      );
      if (!match) return null;
      node = match[1];
    }

    return node;
  }

  /**
   * Fuzzy search across all paths.
   */
  search(
    query: string,
    maxResults = 20,
  ): { path: string; hasCommand: boolean; childCount: number }[] {
    const results: { path: string; hasCommand: boolean; childCount: number }[] =
      [];
    const queryLower = query.toLowerCase();

    const walk = (node: CliTreeNode) => {
      if (results.length >= maxResults) return;
      if (node.fullPath && node.fullPath.toLowerCase().includes(queryLower)) {
        results.push({
          path: node.fullPath,
          hasCommand: node.isLeaf,
          childCount: node.children.size,
        });
      }
      for (const child of node.children.values()) {
        walk(child);
      }
    };

    walk(this.root);
    return results;
  }

  /**
   * Browse a CLI path — returns structured result for MCP.
   */
  browse(path: string): BrowseResult {
    const node = this.navigate(path);

    if (!node) {
      // Try fuzzy search as fallback
      const matches = this.search(path, 10);
      return {
        path: path || '(root)',
        children: [],
        childCount: 0,
        totalLeafCommands: 0,
        commands: undefined,
        ...({
          error: `Path not found: "${path}"`,
          suggestions: matches.map((m) => m.path),
        } as any),
      };
    }

    const result: BrowseResult = {
      path: node.fullPath || '(root)',
      children: Array.from(node.children.keys()).sort(),
      childCount: node.children.size,
      totalLeafCommands: countLeaves(node),
    };

    if (node.tables.length > 0) {
      result.commands = node.tables.map((t) => this.formatCommand(t));
    }

    return result;
  }

  /**
   * Format a table entry into a command detail with resolved types.
   */
  private formatCommand(t: CliTableEntry): CliCommandDetail {
    return {
      command: t.command,
      tableName: t.tableName,
      tableType: t.tableType,
      description: t.description,
      storage: t.storage,
      rest: { method: t.httpMethod, path: t.restPath },
      parameters: t.fields.map((f) => this.formatParam(f)),
    };
  }

  private formatParam(f: CliFieldEntry): CliParamDetail {
    const resolved = resolveType(f.type, this.types, this.enums);
    const param: CliParamDetail = {
      name: f.name,
      cliFlag: `-${f.name.replace(/_/g, '-')}`,
      description: f.description,
      type: f.type,
      role: f.role,
      hidden: f.hidden,
      optional: f.optional,
    };

    if (resolved.kind === 'enum' && resolved.enumValues) {
      param.enumValues = resolved.enumValues;
    } else if (resolved.kind === 'list' && resolved.innerType) {
      param.innerType = resolved.innerType;
      const inner = resolveType(resolved.innerType, this.types, this.enums);
      if (inner.kind === 'enum' && inner.enumValues) {
        param.innerEnumValues = inner.enumValues;
      } else if (inner.kind === 'custom' && inner.help) {
        param.typeHelp = inner.help;
        param.typeUiName = inner.uiName;
      }
    } else if (resolved.kind === 'custom' && resolved.help) {
      param.typeHelp = resolved.help;
      param.typeUiName = resolved.uiName;
    }

    if (resolved.zephyrType) param.zephyrType = resolved.zephyrType;

    return param;
  }
}

// ============================================================================
// Tree Builder
// ============================================================================

function buildTree(
  tables: (TableDeclaration | ActionDeclaration | ViewDeclaration)[],
): {
  root: CliTreeNode;
  commandCount: number;
} {
  const root: CliTreeNode = {
    segment: '',
    fullPath: '',
    children: new Map(),
    tables: [],
    isLeaf: false,
  };

  let commandCount = 0;

  for (const table of tables) {
    const commands: string[] = [];
    const cmdBlock = table.body.command as any;
    if (cmdBlock?.command?.value) {
      const baseCmd = cmdBlock.command.value;
      commands.push(baseCmd);

      // Synthesize CRUD subcommands for tables
      if (table.type === 'TableDeclaration') {
        commands.push(`${baseCmd} show`);
        if (
          table.attributes.create ||
          cmdBlock.helpNew ||
          cmdBlock.helpCreate
        ) {
          commands.push(`${baseCmd} create`);
        }
        commands.push(`${baseCmd} modify`);
        commands.push(`${baseCmd} delete`);
      } else if (table.type === 'ViewDeclaration') {
        commands.push(`${baseCmd} show`);
      }
    }
    if (table.body.methods?.methods) {
      for (const m of table.body.methods.methods) {
        const cmd =
          typeof m.command === 'string' ? m.command : m.command?.value;
        if (cmd && !commands.includes(cmd)) {
          commands.push(cmd);
        }
      }
    }

    for (const cmd of commands) {
      commandCount++;
      const segments = cmd.split(/\s+/);
      let node = root;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!node.children.has(seg)) {
          node.children.set(seg, {
            segment: seg,
            fullPath: segments.slice(0, i + 1).join(' '),
            children: new Map(),
            tables: [],
            isLeaf: false,
          });
        }
        node = node.children.get(seg)!;
      }

      // Determine description — use CRUD-specific help if available
      const baseCmd = cmdBlock?.command?.value || '';
      const lastSeg = segments[segments.length - 1]?.toLowerCase() || '';
      const isSynthesized =
        cmd !== baseCmd &&
        ['show', 'create', 'modify', 'delete'].includes(lastSeg) &&
        cmd === `${baseCmd} ${lastSeg}`;

      let description =
        typeof table.description === 'string'
          ? table.description
          : table.description?.value || '';
      if (isSynthesized && cmdBlock) {
        if (lastSeg === 'show' && cmdBlock.helpShow?.value)
          description = cmdBlock.helpShow.value;
        else if (
          lastSeg === 'create' &&
          (cmdBlock.helpNew?.value || cmdBlock.helpCreate?.value)
        )
          description = cmdBlock.helpNew?.value || cmdBlock.helpCreate?.value;
        else if (lastSeg === 'modify' && cmdBlock.helpModify?.value)
          description = cmdBlock.helpModify.value;
        else if (lastSeg === 'delete' && cmdBlock.helpDelete?.value)
          description = cmdBlock.helpDelete.value;
      }

      const tableType: 'table' | 'action' | 'view' =
        table.type === 'TableDeclaration'
          ? 'table'
          : table.type === 'ActionDeclaration'
            ? 'action'
            : 'view';

      const storageAttrs: string[] = [];
      const attrs = table.attributes;
      if (attrs.replicated) storageAttrs.push('replicated');
      if (attrs.mdb) storageAttrs.push('mdb');
      if (attrs.ksmfServer) storageAttrs.push('ksmf-server');
      if (attrs.ksmfClient) storageAttrs.push('ksmf-client');
      if (attrs.automatic) storageAttrs.push('automatic');
      if (attrs.rest) storageAttrs.push('rest');
      if (attrs.vserverEnabled) storageAttrs.push('vserver-enabled');

      const fields: CliFieldEntry[] = (table.body.fields?.fields || [])
        .filter((f) => f.name?.name)
        .map((f) => {
          const ft = f.fieldType;
          let fullType: string;
          if (typeof ft === 'string') {
            fullType = ft;
          } else {
            const base = ft?.baseType || 'unknown';
            if (ft?.listModifiers?.length) {
              fullType = `${base}<${ft.listModifiers[0]}>`;
            } else if (ft?.range) {
              fullType = `${base}<${ft.range.min}..${ft.range.max}>`;
            } else {
              fullType = base;
            }
          }
          return {
            name: f.name.name,
            description:
              typeof f.description === 'string'
                ? f.description
                : f.description?.value || '',
            type: fullType,
            role: f.role || 'unknown',
            hidden: f.prefixes?.hidden || false,
            optional: f.prefixes?.optional || false,
          };
        });

      node.tables.push({
        tableName: table.name.name,
        tableType,
        description,
        command: cmd,
        fields,
        storage:
          storageAttrs.join(', ') ||
          (tableType === 'action' ? 'action' : 'unknown'),
        restPath: cliToRest(cmd),
        httpMethod: cliToMethod(cmd),
      });

      node.isLeaf = true;
    }
  }

  return { root, commandCount };
}

// ============================================================================
// Type Resolution
// ============================================================================

const BUILTIN_TYPES = new Set([
  'text',
  'boolean',
  'unsigned',
  'unsigned32',
  'unsigned64',
  'signed',
  'signed32',
  'signed64',
  'integer',
  'Uuid',
  'size',
  'percent',
  'IpAddress',
  'ip_address',
  'ip4_address',
  'ip6_address',
  'ShortDateAndTime',
  'DateAndTime',
  'Date',
  'Time',
  'filername',
  'nodename',
  'Duration',
]);

function resolveType(
  typeName: string,
  types: Map<string, TypeDeclaration>,
  enums: Map<string, EnumDeclaration>,
): ResolvedType {
  const listMatch = typeName.match(/^list<(.+)>$/);
  if (listMatch) {
    const inner = resolveType(listMatch[1], types, enums);
    return {
      kind: 'list',
      innerType: listMatch[1],
      ...(inner.enumValues ? { enumValues: inner.enumValues } : {}),
    };
  }

  const enumDef = enums.get(typeName);
  if (enumDef) {
    return {
      kind: 'enum',
      help: enumDef.description?.value,
      enumValues: enumDef.members.map((m) => ({
        name: m.name.name,
        value: m.value?.value ?? m.name.name,
        description: m.description?.value || '',
      })),
    };
  }

  const typeDef = types.get(typeName);
  if (typeDef) {
    return {
      kind: 'custom',
      help: typeDef.help?.value,
      uiName: typeDef.uiName?.value,
      zephyrType: typeDef.zephyr?.raw?.trim(),
    };
  }

  if (BUILTIN_TYPES.has(typeName)) {
    return { kind: 'builtin' };
  }

  return {
    kind: 'custom',
    help: `(type ${typeName} — not in golden_global.smf)`,
  };
}

// ============================================================================
// CLI → REST Mapping
// ============================================================================

function cliToRest(cmd: string): string {
  const parts = cmd.trim().split(/\s+/);
  const last = parts[parts.length - 1]?.toLowerCase() || '';
  if (['show', 'create', 'modify', 'delete'].includes(last)) {
    return '/api/private/cli/' + parts.slice(0, -1).join('/');
  }
  if (last.startsWith('show-')) {
    parts[parts.length - 1] = last.replace('show-', '');
    return '/api/private/cli/' + parts.join('/');
  }
  return '/api/private/cli/' + parts.join('/');
}

function cliToMethod(cmd: string): string {
  const last = cmd.split(/\s+/).pop()?.toLowerCase() || '';
  if (last === 'show') return 'GET';
  if (last === 'create') return 'POST';
  if (last === 'modify') return 'PATCH';
  if (last === 'delete') return 'DELETE';
  if (last.startsWith('show-')) return 'GET';
  return 'POST';
}

function countLeaves(node: CliTreeNode): number {
  let count = node.tables.length;
  for (const child of node.children.values()) {
    count += countLeaves(child);
  }
  return count;
}
