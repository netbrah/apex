/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SMF Tree Parser - Main Entry Point
 *
 * Provides a clean API for parsing SMF files into an AST.
 * Parser internals use `any` for PEG.js interop.
 *
 * @module smf-tree-parser
 */

import type {
  Program,
  Node,
  TableDeclaration,
  ActionDeclaration,
  ViewDeclaration,
  FieldDeclaration,
  SourceLocation,
} from './ast.js';

// Re-export all AST types
export * from './ast.js';

// ============================================================================
// Parser Types
// ============================================================================

/**
 * Parse error with location information
 */
export interface SmfParseError {
  message: string;
  location: SourceLocation;
  expected?: string[];
  found?: string;
}

/**
 * Parse result - either success with AST or failure with errors
 */
export type ParseResult =
  | { success: true; ast: Program; errors: SmfParseError[] }
  | { success: false; ast: null; errors: SmfParseError[] };

/**
 * Parser options
 */
export interface ParseOptions {
  /** Source file name for error messages */
  sourceFile?: string;
  /** Starting rule (default: 'Program') */
  startRule?: string;
  /** Enable recovery mode to continue parsing after errors */
  recovery?: boolean;
  /** Collect comments in the AST */
  collectComments?: boolean;
}

// ============================================================================
// Parser Implementation
// ============================================================================

// The actual parser will be generated from the .pegjs file
// This is a placeholder that will be replaced when we generate the parser
let generatedParser: any = null;

/**
 * Set the generated parser (called by build script)
 */
export function setParser(parser: any): void {
  generatedParser = parser;
}

/**
 * Parse SMF source code into an AST
 *
 * @param source - SMF source code
 * @param options - Parse options
 * @returns Parse result with AST or errors
 */
export function parse(source: string, options: ParseOptions = {}): ParseResult {
  if (!generatedParser) {
    return {
      success: false,
      ast: null,
      errors: [
        {
          message: 'Parser not initialized. Run the build script first.',
          location: {
            start: { line: 1, column: 0, offset: 0 },
            end: { line: 1, column: 0, offset: 0 },
          },
        },
      ],
    };
  }

  try {
    const ast = generatedParser.parse(source, {
      grammarSource: options.sourceFile,
      startRule: options.startRule || 'Program',
    });

    // Add source file to the program node
    if (options.sourceFile) {
      ast.sourceFile = options.sourceFile;
    }

    return {
      success: true,
      ast,
      errors: [],
    };
  } catch (e: any) {
    // Convert PEG.js error to our format
    const error: SmfParseError = {
      message: e.message || String(e),
      location: e.location
        ? {
            start: {
              line: e.location.start.line,
              column: e.location.start.column - 1,
              offset: e.location.start.offset,
            },
            end: {
              line: e.location.end.line,
              column: e.location.end.column - 1,
              offset: e.location.end.offset,
            },
          }
        : {
            start: { line: 1, column: 0, offset: 0 },
            end: { line: 1, column: 0, offset: 0 },
          },
      expected: e.expected?.map((exp: any) => exp.description || exp.text),
      found: e.found,
    };

    return {
      success: false,
      ast: null,
      errors: [error],
    };
  }
}

/**
 * Parse SMF source and throw on error
 *
 * @param source - SMF source code
 * @param options - Parse options
 * @returns Parsed AST
 * @throws Error if parsing fails
 */
export function parseOrThrow(
  source: string,
  options: ParseOptions = {},
): Program {
  const result = parse(source, options);
  if (!result.success) {
    const error = result.errors[0];
    const loc = error.location.start;
    throw new Error(
      `Parse error at line ${loc.line}, column ${loc.column}: ${error.message}`,
    );
  }
  return result.ast;
}

// ============================================================================
// AST Utilities
// ============================================================================

/**
 * Get all table-like declarations from a program
 */
export function getTables(
  program: Program,
): Array<TableDeclaration | ActionDeclaration | ViewDeclaration> {
  return program.body.filter(
    (node): node is TableDeclaration | ActionDeclaration | ViewDeclaration =>
      node.type === 'TableDeclaration' ||
      node.type === 'ActionDeclaration' ||
      node.type === 'ViewDeclaration',
  );
}

/**
 * Get all table declarations (not actions or views)
 */
export function getTableDeclarations(program: Program): TableDeclaration[] {
  return program.body.filter(
    (node): node is TableDeclaration => node.type === 'TableDeclaration',
  );
}

/**
 * Get all action declarations
 */
export function getActionDeclarations(program: Program): ActionDeclaration[] {
  return program.body.filter(
    (node): node is ActionDeclaration => node.type === 'ActionDeclaration',
  );
}

/**
 * Get all view declarations
 */
export function getViewDeclarations(program: Program): ViewDeclaration[] {
  return program.body.filter(
    (node): node is ViewDeclaration => node.type === 'ViewDeclaration',
  );
}

/**
 * Find a table/action/view by name
 */
export function findTableByName(
  program: Program,
  name: string,
): TableDeclaration | ActionDeclaration | ViewDeclaration | undefined {
  return getTables(program).find((t) => t.name.name === name);
}

/**
 * Get all fields from a table/action/view
 */
export function getFields(
  table: TableDeclaration | ActionDeclaration | ViewDeclaration,
): FieldDeclaration[] {
  return table.body.fields?.fields || [];
}

/**
 * Get key fields from a table
 */
export function getKeyFields(
  table: TableDeclaration | ActionDeclaration | ViewDeclaration,
): FieldDeclaration[] {
  return getFields(table).filter(
    (f) => f.role === 'key' || f.role.startsWith('key-'),
  );
}

/**
 * Check if table is replicated (RDB)
 */
export function isReplicated(
  table: TableDeclaration | ActionDeclaration | ViewDeclaration,
): boolean {
  return table.attributes.replicated === true;
}

/**
 * Check if table is MDB (node-local)
 */
export function isMdb(
  table: TableDeclaration | ActionDeclaration | ViewDeclaration,
): boolean {
  return table.attributes.mdb === true;
}

/**
 * Check if table is queryable via debug smdb
 */
export function isDebugQueryable(
  table: TableDeclaration | ActionDeclaration | ViewDeclaration,
): boolean {
  const attrs = table.attributes;

  // KSMF server tables are queryable
  if (attrs.ksmfServer) return true;

  // KSMF client tables are NOT queryable (action-only)
  if (attrs.ksmfClient) return false;

  // Automatic (RAM-only) tables are NOT queryable
  if (attrs.automatic) return false;

  // Replicated and MDB tables are queryable
  if (attrs.replicated || attrs.mdb) return true;

  // Actions without storage are not queryable
  if (table.type === 'ActionDeclaration') return false;

  return false;
}

/**
 * Get the CLI command from a table
 */
export function getCommand(
  table: TableDeclaration | ActionDeclaration | ViewDeclaration,
): string | undefined {
  return table.body.command?.command?.value;
}

/**
 * Format a location for error messages
 */
export function formatLocation(
  loc: SourceLocation,
  sourceFile?: string,
): string {
  const file = sourceFile || loc.source || '<unknown>';
  return `${file}:${loc.start.line}:${loc.start.column + 1}`;
}

/**
 * Get source text at a location
 */
export function getSourceText(source: string, loc: SourceLocation): string {
  return source.substring(loc.start.offset, loc.end.offset);
}

// ============================================================================
// Visitor Pattern
// ============================================================================

/**
 * Visitor interface for traversing the AST
 */
export interface Visitor {
  enter?: (node: Node, parent: Node | null) => void | false;
  exit?: (node: Node, parent: Node | null) => void;

  // Specific node type visitors
  Program?: (node: Program, parent: null) => void | false;
  TableDeclaration?: (
    node: TableDeclaration,
    parent: Node | null,
  ) => void | false;
  ActionDeclaration?: (
    node: ActionDeclaration,
    parent: Node | null,
  ) => void | false;
  ViewDeclaration?: (
    node: ViewDeclaration,
    parent: Node | null,
  ) => void | false;
  FieldDeclaration?: (
    node: FieldDeclaration,
    parent: Node | null,
  ) => void | false;
  // ... add more as needed
}

/**
 * Walk the AST with a visitor
 */
export function walk(
  node: Node,
  visitor: Visitor,
  parent: Node | null = null,
): void {
  // Call generic enter
  if (visitor.enter) {
    const result = visitor.enter(node, parent);
    if (result === false) return; // Skip this subtree
  }

  // Call specific type visitor
  const typeVisitor = (visitor as any)[node.type];
  if (typeVisitor) {
    const result = typeVisitor(node, parent);
    if (result === false) return;
  }

  // Walk children based on node type
  walkChildren(node, visitor);

  // Call generic exit
  if (visitor.exit) {
    visitor.exit(node, parent);
  }
}

/**
 * Walk child nodes
 */
function walkChildren(node: Node, visitor: Visitor): void {
  switch (node.type) {
    case 'Program':
      for (const child of node.body) {
        walk(child, visitor, node);
      }
      break;

    case 'TableDeclaration':
    case 'ActionDeclaration':
    case 'ViewDeclaration':
      if (node.body.fields) {
        for (const field of node.body.fields.fields) {
          walk(field, visitor, node);
        }
      }
      if (node.body.methods) {
        for (const method of node.body.methods.methods) {
          walk(method, visitor, node);
        }
      }
      break;

    case 'EnumDeclaration':
      for (const member of node.members) {
        walk(member, visitor, node);
      }
      break;

    // Add more cases as needed
    default:
      break;
  }
}

/**
 * Find all nodes matching a predicate
 */
export function findAll<T extends Node>(
  node: Node,
  predicate: (n: Node) => n is T,
): T[];
export function findAll(node: Node, predicate: (n: Node) => boolean): Node[];
export function findAll(node: Node, predicate: (n: Node) => boolean): Node[] {
  const results: Node[] = [];

  walk(node, {
    enter(n) {
      if (predicate(n)) {
        results.push(n);
      }
    },
  });

  return results;
}

/**
 * Find first node matching a predicate
 */
export function findFirst<T extends Node>(
  node: Node,
  predicate: (n: Node) => n is T,
): T | undefined;
export function findFirst(
  node: Node,
  predicate: (n: Node) => boolean,
): Node | undefined;
export function findFirst(
  node: Node,
  predicate: (n: Node) => boolean,
): Node | undefined {
  let result: Node | undefined;

  walk(node, {
    enter(n) {
      if (predicate(n)) {
        result = n;
        return false; // Stop traversal
      }
    },
  });

  return result;
}
