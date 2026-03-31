/**
 * SMF Abstract Syntax Tree Type Definitions
 *
 * This defines the complete AST structure for SMF (Storage Management Framework) files.
 * Every node includes source location information for precise error reporting and tooling.
 *
 * @module smf-tree-parser/ast
 */

// ============================================================================
// Source Location Types
// ============================================================================

/**
 * Position in source file (1-indexed line, 0-indexed column)
 */
export interface Position {
  line: number;
  column: number;
  offset: number; // Character offset from start of file
}

/**
 * Source location span
 */
export interface SourceLocation {
  start: Position;
  end: Position;
  source?: string; // Optional source file name
}

// ============================================================================
// Base Node Types
// ============================================================================

/**
 * Base interface for all AST nodes
 */
export interface BaseNode {
  type: string;
  loc: SourceLocation;
  leadingComments?: Comment[];
  trailingComments?: Comment[];
}

/**
 * Comment node (both line and block comments)
 */
export interface Comment extends BaseNode {
  type: 'LineComment' | 'BlockComment';
  value: string;
}

// ============================================================================
// Program (Root Node)
// ============================================================================

/**
 * Root node of the AST - represents an entire SMF file
 */
export interface Program extends BaseNode {
  type: 'Program';
  sourceFile?: string;
  body: TopLevelDeclaration[];
  comments: Comment[];
}

/**
 * Union of all top-level declarations
 */
export type TopLevelDeclaration =
  | IncludeDirective
  | TypeDeclaration
  | EnumDeclaration
  | DirectoryDeclaration
  | TableDeclaration
  | ActionDeclaration
  | ViewDeclaration;

// ============================================================================
// Include Directive
// ============================================================================

/**
 * Include directive: include { path/to/file.smf }
 */
export interface IncludeDirective extends BaseNode {
  type: 'IncludeDirective';
  paths: StringLiteral[];
}

// ============================================================================
// Type Declaration
// ============================================================================

/**
 * Type definition: type NAME { ... }
 */
export interface TypeDeclaration extends BaseNode {
  type: 'TypeDeclaration';
  name: Identifier;
  uiName?: StringLiteral;
  help?: StringLiteral;
  zephyr?: ZephyrBlock;
}

// ============================================================================
// Enum Declaration
// ============================================================================

/**
 * Enum definition: enum NAME "Description" { value=n "desc", ... }
 */
export interface EnumDeclaration extends BaseNode {
  type: 'EnumDeclaration';
  name: Identifier;
  description: StringLiteral;
  members: EnumMember[];
  zephyr?: ZephyrBlock;
}

/**
 * Enum member: name=value "description"
 */
export interface EnumMember extends BaseNode {
  type: 'EnumMember';
  name: Identifier;
  value: NumericLiteral;
  description?: StringLiteral;
}

// ============================================================================
// Directory Declaration
// ============================================================================

/**
 * Directory block: directory "path" { help "..." }
 */
export interface DirectoryDeclaration extends BaseNode {
  type: 'DirectoryDeclaration';
  path: StringLiteral;
  help?: StringLiteral;
}

// ============================================================================
// Table/Action/View Declarations
// ============================================================================

/**
 * Table declaration: table NAME "desc" { attrs } { body }
 */
export interface TableDeclaration extends BaseNode {
  type: 'TableDeclaration';
  name: Identifier;
  description: StringLiteral;
  attributes: TableAttributes;
  body: TableBody;
}

/**
 * Action declaration: action NAME "desc" { attrs } { body }
 */
export interface ActionDeclaration extends BaseNode {
  type: 'ActionDeclaration';
  name: Identifier;
  description: StringLiteral;
  attributes: TableAttributes;
  body: TableBody;
}

/**
 * View declaration: view NAME "desc" { attrs } { body }
 */
export interface ViewDeclaration extends BaseNode {
  type: 'ViewDeclaration';
  name: Identifier;
  description: StringLiteral;
  attributes: TableAttributes;
  body: ViewBody;
}

// ============================================================================
// Table Attributes
// ============================================================================

/**
 * Table attributes block: { create replicated admin vserver-enabled ... }
 */
export interface TableAttributes extends BaseNode {
  type: 'TableAttributes';

  // Storage attributes
  create?: boolean;
  automatic?: boolean;
  persistent?: boolean;
  replicated?: boolean;
  mdb?: boolean;
  deprecated?: boolean;
  cacheGets?: boolean;
  nonResetable?: boolean;
  nonInitable?: boolean;

  // Behavior attributes
  task?: boolean;
  rest?: boolean;
  noimp?: boolean;
  lazywrite?: boolean;
  honorWants?: boolean;
  dcn?: boolean;
  replicateUpdates?: boolean;
  dsmfRowUpdatedOnError?: boolean;
  sqlview?: boolean;

  // Access control
  privilege?: 'admin' | 'advanced' | 'diagnostic' | 'test';
  bootModes?: string[];
  vserverEnabled?: boolean;
  bypassCompatibilityChecks?: boolean | string[];
  protectedIterator?: boolean;
  privateFields?: string[];

  // KSMF
  ksmfClient?: boolean;
  ksmfServer?: boolean;
  clientdist?: boolean;

  // Priority/timeout
  dsmfMaxHighPrio?: number;
  dsmfMaxIntPrio?: number;
  maxQueued?: number;
  rpcTimeout?: number;

  // Raw tokens for any we don't recognize
  rawTokens?: string[];
}

// ============================================================================
// Table Body
// ============================================================================

/**
 * Table body containing all inner blocks
 */
export interface TableBody extends BaseNode {
  type: 'TableBody';
  fields?: FieldsBlock;
  methods?: MethodsBlock;
  command?: CommandBlock;
  zephyr?: ZephyrBlock;
  descriptions?: DescriptionsBlock;
  distKeys?: DistKeysDirective;
  alternateKeys?: AlternateKeysDirective[];
  cloneFields?: CloneFieldsDirective;
  keysFrom?: KeysFromBlock;
  inheritFrom?: InheritFromBlock;
  objectReplication?: ObjectReplicationBlock;
  values?: ValuesBlock;
  writePrivilege?: WritePrivilegeDirective;
}

/**
 * View-specific body (extends TableBody with SQL view constructs)
 */
export interface ViewBody extends Omit<TableBody, 'type'> {
  type: 'ViewBody';
  attach?: AttachDirective;
  viewQuery?: ViewQueryDirective;
  sqlFields?: SqlFieldsBlock;
  sqlDerivedFields?: SqlDerivedFieldsBlock;
}

// ============================================================================
// Fields Block
// ============================================================================

/**
 * Fields block: fields { ... }
 */
export interface FieldsBlock extends BaseNode {
  type: 'FieldsBlock';
  fields: FieldDeclaration[];
}

/**
 * Field declaration with all its attributes
 *
 * Full syntax:
 * [prefixes]name[=uiName][,alias] "description" type role[priority]
 */
export interface FieldDeclaration extends BaseNode {
  type: 'FieldDeclaration';

  // Prefixes
  prefixes: FieldPrefixes;

  // Name and aliases
  name: Identifier;
  uiName?: Identifier;
  useUiNameInCode?: boolean; // ^ prefix on uiName
  alias?: string; // Single char alias (name,c)

  // Description and type
  description: StringLiteral;
  fieldType: FieldType;

  // Role and priority
  role: FieldRole;
  roleModifier?: string; // -noread
  priority?: number; // [N] non-persistent or (N) persistent
  pidPersistent?: boolean;

  // Mutual exclusive group
  mutualExclusiveGroup?: MutualExclusiveGroup;
}

/**
 * Field prefixes: ! ~ -
 */
export interface FieldPrefixes {
  optional: boolean; // ! - optional during row creation
  hidden: boolean; // ~ - hidden in CLI/WEB
  noPositional: boolean; // - - cannot be specified positionally
}

/**
 * Field role enumeration
 */
export type FieldRole =
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
  | 'modify';

/**
 * Mutual exclusive group markers
 */
export interface MutualExclusiveGroup extends BaseNode {
  type: 'MutualExclusiveGroup';
  position: 'start' | 'middle' | 'end'; // ( | )
  groupId?: string;
}

// ============================================================================
// Field Types
// ============================================================================

/**
 * Base field type
 */
export interface FieldType extends BaseNode {
  type: 'FieldType';
  baseType: string;
  range?: TypeRange;
  listModifiers?: string[];
}

/**
 * Type range constraint: integer<MIN..MAX>
 */
export interface TypeRange extends BaseNode {
  type: 'TypeRange';
  min: number;
  max: number;
}

// ============================================================================
// Methods Block
// ============================================================================

/**
 * Methods block: methods { method ... }
 */
export interface MethodsBlock extends BaseNode {
  type: 'MethodsBlock';
  methods: MethodDeclaration[];
}

/**
 * Method declaration: method name "desc" { attrs } { body }
 */
export interface MethodDeclaration extends BaseNode {
  type: 'MethodDeclaration';
  name: Identifier;
  description: StringLiteral;
  attributes: MethodAttributes;
  args?: ArgsBlock;
  command?: StringLiteral;
}

/**
 * Method attributes: { admin noquery static }
 */
export interface MethodAttributes extends BaseNode {
  type: 'MethodAttributes';
  privilege?: 'admin' | 'advanced' | 'diagnostic' | 'test';
  noquery?: boolean;
  static?: boolean;
  readonly?: boolean;
  extendInterface?: boolean;
  rawTokens?: string[];
}

/**
 * Args block: args { ... }
 */
export interface ArgsBlock extends BaseNode {
  type: 'ArgsBlock';
  args: ArgDeclaration[];
}

/**
 * Argument declaration: name "desc" type role
 */
export interface ArgDeclaration extends BaseNode {
  type: 'ArgDeclaration';
  optional: boolean; // ! prefix
  name: Identifier;
  description: StringLiteral;
  argType: FieldType;
  role: 'in' | 'out' | 'write' | 'read';
  priority?: number;
}

// ============================================================================
// Command Block
// ============================================================================

/**
 * Command block: command "cli path" { ... }
 */
export interface CommandBlock extends BaseNode {
  type: 'CommandBlock';
  command: StringLiteral;
  help?: StringLiteral;
  helpShow?: StringLiteral;
  helpModify?: StringLiteral;
  emptyMsg?: StringLiteral;
  show?: ShowBlock[];
  showInstance?: ShowBlock[];
}

/**
 * Show block for CLI output formatting
 */
export interface ShowBlock extends BaseNode {
  type: 'ShowBlock';
  showType: 'show' | 'show-instance';
  privilege?: string;
  fields: Identifier[];
  format?: UiFormatBlock;
}

/**
 * UI format block (the formatted output template)
 */
export interface UiFormatBlock extends BaseNode {
  type: 'UiFormatBlock';
  raw: string; // Keep raw format string for now
}

// ============================================================================
// Zephyr Block (REST API definitions)
// ============================================================================

/**
 * Zephyr block: zephyr { category ... typedef ... apis ... }
 */
export interface ZephyrBlock extends BaseNode {
  type: 'ZephyrBlock';
  category?: ZephyrCategory;
  typedefs?: ZephyrTypedef[];
  apis?: ZephyrApis;
  raw?: string; // For complex nested content
}

/**
 * Zephyr category reference
 */
export interface ZephyrCategory extends BaseNode {
  type: 'ZephyrCategory';
  name: Identifier;
  external?: boolean;
}

/**
 * Zephyr typedef: typedef name "desc" { } { fields }
 */
export interface ZephyrTypedef extends BaseNode {
  type: 'ZephyrTypedef';
  name: Identifier;
  description: StringLiteral;
  fields: ZephyrField[];
}

/**
 * Zephyr field mapping
 */
export interface ZephyrField extends BaseNode {
  type: 'ZephyrField';
  name: Identifier;
  mapping: string; // native, etc.
}

/**
 * Zephyr APIs block
 */
export interface ZephyrApis extends BaseNode {
  type: 'ZephyrApis';
  apis: ZephyrApiDef[];
}

/**
 * Zephyr API definition: get=api-name "desc" { }
 */
export interface ZephyrApiDef extends BaseNode {
  type: 'ZephyrApiDef';
  operation: string; // get, modify, create, delete, get-iter
  apiName: Identifier;
  description: StringLiteral;
}

// ============================================================================
// Descriptions Block
// ============================================================================

/**
 * Descriptions block: descriptions { field { zapi "..." } }
 */
export interface DescriptionsBlock extends BaseNode {
  type: 'DescriptionsBlock';
  descriptions: FieldDescription[];
}

/**
 * Individual field description
 */
export interface FieldDescription extends BaseNode {
  type: 'FieldDescription';
  fieldName: Identifier;
  zapi?: StringLiteral;
  raw?: string;
}

// ============================================================================
// Key/Value Directives
// ============================================================================

/**
 * dist_keys directive: dist_keys { field1 field2 } or dist_keys from table
 */
export interface DistKeysDirective extends BaseNode {
  type: 'DistKeysDirective';
  fields?: Identifier[];
  fromTable?: Identifier;
}

/**
 * alternateKeys directive: alternateKeys name { field1 field2 }
 */
export interface AlternateKeysDirective extends BaseNode {
  type: 'AlternateKeysDirective';
  name: Identifier;
  fields: Identifier[];
}

/**
 * clone-fields directive: clone-fields { table_name spec }
 */
export interface CloneFieldsDirective extends BaseNode {
  type: 'CloneFieldsDirective';
  tableName: Identifier;
  spec: string; // ALL, key, read, etc.
}

/**
 * keys from block: keys from { table field[n] ... }
 */
export interface KeysFromBlock extends BaseNode {
  type: 'KeysFromBlock';
  references: KeyReference[];
}

/**
 * Key reference: table field[priority]
 */
export interface KeyReference extends BaseNode {
  type: 'KeyReference';
  tableName: Identifier;
  fieldName: Identifier;
  priority: number;
}

/**
 * inherit_from block: inherit_from { table1 table2 }
 */
export interface InheritFromBlock extends BaseNode {
  type: 'InheritFromBlock';
  tables: Identifier[];
}

/**
 * object-replication block
 */
export interface ObjectReplicationBlock extends BaseNode {
  type: 'ObjectReplicationBlock';
  domain?: Identifier[];
  requiredFields?: Identifier[];
  excludedFields?: Identifier[];
  requiredMethods?: Identifier[];
  none?: boolean;
}

/**
 * values block: values { table field[n] }
 */
export interface ValuesBlock extends BaseNode {
  type: 'ValuesBlock';
  references: ValueReference[];
}

/**
 * Value reference: table field or table ALL
 */
export interface ValueReference extends BaseNode {
  type: 'ValueReference';
  tableName: Identifier;
  fieldSpec: string; // field name, ALL, etc.
  priority?: number;
}

/**
 * write-privilege directive: write-privilege level { fields }
 */
export interface WritePrivilegeDirective extends BaseNode {
  type: 'WritePrivilegeDirective';
  privilege: 'admin' | 'advanced' | 'diagnostic' | 'test';
  fields: Identifier[];
}

// ============================================================================
// SQL View Directives
// ============================================================================

/**
 * ATTACH directive: ATTACH "database"
 */
export interface AttachDirective extends BaseNode {
  type: 'AttachDirective';
  database: StringLiteral;
}

/**
 * VIEW query directive: VIEW "SELECT ..."
 */
export interface ViewQueryDirective extends BaseNode {
  type: 'ViewQueryDirective';
  query: StringLiteral;
}

/**
 * sql-fields block: sql-fields { table.field ... }
 */
export interface SqlFieldsBlock extends BaseNode {
  type: 'SqlFieldsBlock';
  fields: SqlFieldReference[];
}

/**
 * sql-derived-fields block
 */
export interface SqlDerivedFieldsBlock extends BaseNode {
  type: 'SqlDerivedFieldsBlock';
  fields: SqlFieldReference[];
}

/**
 * SQL field reference: table.field
 */
export interface SqlFieldReference extends BaseNode {
  type: 'SqlFieldReference';
  tableName: Identifier;
  fieldName: Identifier;
}

// ============================================================================
// Literals and Identifiers
// ============================================================================

/**
 * Identifier (names)
 */
export interface Identifier extends BaseNode {
  type: 'Identifier';
  name: string;
}

/**
 * String literal
 */
export interface StringLiteral extends BaseNode {
  type: 'StringLiteral';
  value: string;
  raw: string;
}

/**
 * Numeric literal
 */
export interface NumericLiteral extends BaseNode {
  type: 'NumericLiteral';
  value: number;
  raw: string;
}

// ============================================================================
// Node Type Union
// ============================================================================

/**
 * Union of all AST node types
 */
export type Node =
  | Program
  | IncludeDirective
  | TypeDeclaration
  | EnumDeclaration
  | EnumMember
  | DirectoryDeclaration
  | TableDeclaration
  | ActionDeclaration
  | ViewDeclaration
  | TableAttributes
  | TableBody
  | ViewBody
  | FieldsBlock
  | FieldDeclaration
  | FieldType
  | TypeRange
  | MutualExclusiveGroup
  | MethodsBlock
  | MethodDeclaration
  | MethodAttributes
  | ArgsBlock
  | ArgDeclaration
  | CommandBlock
  | ShowBlock
  | UiFormatBlock
  | ZephyrBlock
  | ZephyrCategory
  | ZephyrTypedef
  | ZephyrField
  | ZephyrApis
  | ZephyrApiDef
  | DescriptionsBlock
  | FieldDescription
  | DistKeysDirective
  | AlternateKeysDirective
  | CloneFieldsDirective
  | KeysFromBlock
  | KeyReference
  | InheritFromBlock
  | ObjectReplicationBlock
  | ValuesBlock
  | ValueReference
  | WritePrivilegeDirective
  | AttachDirective
  | ViewQueryDirective
  | SqlFieldsBlock
  | SqlDerivedFieldsBlock
  | SqlFieldReference
  | Identifier
  | StringLiteral
  | NumericLiteral
  | Comment;

/**
 * Type guard helpers
 */
export function isTableDeclaration(node: Node): node is TableDeclaration {
  return node.type === 'TableDeclaration';
}

export function isActionDeclaration(node: Node): node is ActionDeclaration {
  return node.type === 'ActionDeclaration';
}

export function isViewDeclaration(node: Node): node is ViewDeclaration {
  return node.type === 'ViewDeclaration';
}

export function isFieldDeclaration(node: Node): node is FieldDeclaration {
  return node.type === 'FieldDeclaration';
}

export function isMethodDeclaration(node: Node): node is MethodDeclaration {
  return node.type === 'MethodDeclaration';
}

/**
 * Get all table-like declarations (table, action, view)
 */
export function getTableLikeDeclarations(
  program: Program,
): Array<TableDeclaration | ActionDeclaration | ViewDeclaration> {
  return program.body.filter(
    (node): node is TableDeclaration | ActionDeclaration | ViewDeclaration =>
      node.type === 'TableDeclaration' ||
      node.type === 'ActionDeclaration' ||
      node.type === 'ViewDeclaration',
  );
}
