/* eslint-disable */
// @ts-nocheck
/**
 * Mega Docs Discovery Types
 * Unified types for SMF + Swagger + Private CLI discovery
 */

// ============================================================================
// Source Types - Where the endpoint/table comes from
// ============================================================================

export type EndpointSource =
  | 'swagger' // Public REST API from swagger.yaml
  | 'smf-rest' // SMF table with { rest } attribute
  | 'smf-debug' // SMF table queryable via debug smdb table
  | 'private-cli' // Mapped from CLI command to /api/private/cli
  | 'smf-action'; // Action table (POST only, no query)

export type QueryMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'OPTIONS';

// ============================================================================
// Parameter Hints - How to obtain required path parameters
// ============================================================================

/**
 * Hint for obtaining a required path parameter value.
 * Example: For /security/key-managers/{uuid}, tells user to GET /security/key-managers first.
 */
export interface ParameterHint {
  /** Parameter name from path, e.g., "uuid" or "svm.uuid" */
  param: string;
  /** Parameter type from swagger schema */
  type: string;
  /** Index of another param this depends on (for chained params) */
  dependsOn?: number;
  /** How to obtain this parameter's value */
  obtainFrom: {
    /** REST endpoint to call to get this value */
    restEndpoint?: {
      method: 'GET';
      path: string;
      description?: string;
    };
    /** CLI command alternative */
    cliCommand?: string;
    /** Which field in the response contains this value */
    responseField?: string;
  } | null;
  /** Human-readable hint message */
  hint: string;
}

// ============================================================================
// Access Pattern Types - THE KEY DISTINCTION
// ============================================================================

/**
 * Access Patterns - How an SMF table/endpoint can be accessed
 * Every table has up to THREE ways to query it
 */
export interface AccessPatterns {
  /** Has public REST endpoint in swagger.yaml (/api/...) */
  publicRest: boolean;

  /** Has private CLI REST mapping (/api/private/cli/...) */
  privateCli: boolean;

  /** Can be queried via: debug smdb table {name} show
   *  TRUE for: replicated, mdb, ksmf-server
   *  FALSE for: ksmf-client, action, automatic, create-only
   */
  debugSmdb: boolean;
}

/**
 * Debug SMDB query information
 * Only present if accessPatterns.debugSmdb === true
 */
export interface DebugSmdbInfo {
  tableName: string;
  /** Full path: /api/private/cli/debug/smdb/table/{tableName} */
  path: string;
  /** HTTP method: GET for regular tables, POST for action tables */
  method?: 'GET' | 'POST';
  /** MDB tables require -node parameter */
  requiresNode: boolean;
  /** Tables with vserver-enabled require -vserver */
  requiresVserver: boolean;
  /** Pre-built curl example */
  curlExample: string;
}

// ============================================================================
// Unified Endpoint - Merged view of all sources
// ============================================================================

export interface UnifiedEndpoint {
  // Identity
  id: string; // Unique ID: "method:path" or "smf:tableName"
  source: EndpointSource;

  // Endpoint info
  method: QueryMethod | QueryMethod[]; // Allowed methods
  path: string; // REST path or private CLI path
  privatePath?: string; // /api/private/cli/... equivalent
  debugPath?: string; // /api/private/cli/debug/smdb/table/...

  // Descriptions
  summary: string;
  description: string;
  cliCommand?: string; // Original CLI command if mapped

  /** CLI commands extracted from swagger "## Related ONTAP commands" section */
  relatedCliCommands?: string[];

  /** ONTAP version when this endpoint was introduced (from x-ntap-introduced) */
  introducedVersion?: string;

  /** True if this endpoint is a cross-cluster proxy path (via /cluster/peers/{uuid}/... or /svm/peers/{uuid}/...) */
  crossClusterProxy?: boolean;

  // Categorization
  tags: string[];
  domain: string; // e.g., 'security', 'storage', 'network'

  // Schema info
  parameters?: ParameterInfo[];
  requestBody?: SchemaInfo;
  responseFields?: FieldInfo[]; // From SMF or Swagger schema

  // SMF-specific (if from SMF)
  smfTable?: SmfTableInfo;

  // === KEY: Access pattern classification ===
  accessPatterns: AccessPatterns;

  // Debug SMDB info (only if accessPatterns.debugSmdb === true)
  debugSmdbInfo?: DebugSmdbInfo;

  // Convenience flags (derived from accessPatterns)
  queryable: boolean; // = publicRest || debugSmdb
  isActionOnly: boolean; // = !queryable && is action/ksmf-client
  requiresNode?: boolean; // MDB tables
  requiresVserver?: boolean; // vserver-enabled tables
}

export interface SmfTableInfo {
  tableName: string;
  tableType: 'table' | 'action' | 'view';
  description: string;
  smfFile?: string;

  // CLI command mapping (from SMF command directive)
  /** Top-level command directive, e.g. "volume", "security anti-ransomware volume" */
  command?: string;
  /** All CLI commands from table-level + method-level command directives */
  cliCommands: string[];

  // Storage classification (determines queryability)
  storage: SmfStorageType;

  // Attributes (comprehensive — mirrors SmfTableAttributes from tree parser)
  attributes: {
    // Storage type flags
    replicated?: boolean;
    mdb?: boolean;
    ksmfServer?: boolean;
    ksmfClient?: boolean;
    create?: boolean;
    modify?: boolean;
    automatic?: boolean;
    persistent?: boolean;

    // Behavior flags
    rest?: boolean;
    noimp?: boolean;
    sqlview?: boolean;
    dcn?: boolean;
    vserverEnabled?: boolean;
    deprecated?: boolean;
    task?: boolean;
    lazywrite?: boolean;
    honorWants?: boolean;
    replicateUpdates?: boolean;
    cacheGets?: boolean;
    nonResetable?: boolean;
    nonInitable?: boolean;
    clientdist?: boolean;
    protectedIterator?: boolean;
    dsmfRowUpdatedOnError?: boolean;
    bypassCompatibilityChecks?: boolean | string[];

    // Access control
    privilege?: 'admin' | 'advanced' | 'diagnostic' | 'test';
    bootModes?: string[];
    privateFields?: string[];

    // Tuning parameters
    dsmfMaxHighPrio?: number;
    dsmfMaxIntPrio?: number;
    maxQueued?: number;
    rpcTimeout?: number;
  };

  // Structural metadata
  baseTable?: string;
  distKeys?: string[];
  alternateKeys?: string[][];
  cloneFields?: { table: string; spec: string }[];
  sqlView?: {
    attachDatabase?: string;
    viewQuery?: string;
    sqlFields?: string[];
    fieldsTable?: string;
  };

  // Fields
  fields: SmfField[];
  keyFields: string[];

  // Methods
  generatedMethods: string[];
  extrinsicMethods?: SmfMethod[];
}

export type SmfStorageType =
  | 'replicated' // RDB cluster-wide - queryable via debug smdb
  | 'mdb' // MDB node-local - queryable via debug smdb (needs -node)
  | 'ksmf-server' // Kernel SMF server - queryable via debug smdb
  | 'ksmf-client' // Kernel SMF client - NOT queryable (action only)
  | 'automatic' // RAM storage - NOT queryable via debug
  | 'persistent' // Persistent local storage - queryable via debug smdb
  | 'action' // Action table (no storage) - NOT queryable
  | 'unknown';

// ============================================================================
// Parameter/Field Types
// ============================================================================

export interface ParameterInfo {
  name: string;
  in: 'path' | 'query' | 'body';
  required: boolean;
  type: string;
  description: string;
  enum?: string[];
  default?: any;
  smfRole?: 'key' | 'read' | 'write' | 'create' | 'modify';
}

/**
 * Swagger x-ntap access modifier, derived from the property's OpenAPI extensions.
 * Maps 1:1 to SMF field roles for cross-validation.
 */
export type SwaggerAccessRole =
  | 'readOnly' // readOnly: true OR x-ntap-readOnly: true → SMF: show/read
  | 'readCreate' // x-ntap-readCreate: true → SMF: create
  | 'createOnly' // x-ntap-createOnly: true → SMF: create-noread
  | 'readModify' // x-ntap-readModify: true → SMF: modify
  | 'modifyOnly' // x-ntap-modifyOnly: true → SMF: modify-noread
  | 'writeOnly' // x-ntap-writeOnly: true → SMF: write-noread
  | 'readWrite'; // no modifier → default read/write

export interface FieldInfo {
  name: string;
  description: string;
  type: string;
  role: 'key' | 'read' | 'write' | 'create' | 'modify' | 'unknown';
  required: boolean;
  queryable: boolean; // Can be used in ?fields=
  filterable: boolean; // Can be used as filter parameter
  expensive?: boolean; // Excluded from default GET, must request via ?fields=
  /** Swagger x-ntap access modifier (only present for swagger-sourced fields) */
  swaggerAccess?: SwaggerAccessRole;
  /** ONTAP version when this field was introduced (from x-ntap-introduced) */
  introducedVersion?: string;
}

export interface SchemaInfo {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  properties?: Record<string, FieldInfo>;
  required?: string[];
  example?: any;
}

// ============================================================================
// Index Types
// ============================================================================

export interface MegaDocsIndex {
  // Endpoints by ID
  endpoints: Map<string, UnifiedEndpoint>;

  // SMF tables by name
  smfTables: Map<string, SmfTableInfo>;

  // Search indices
  byTag: Map<string, string[]>; // tag → endpoint IDs
  byDomain: Map<string, string[]>; // domain → endpoint IDs
  byCliCommand: Map<string, string>; // CLI command → endpoint ID
  byPath: Map<string, string[]>; // path prefix → endpoint IDs
  bySmfTable: Map<string, string>; // SMF table name → endpoint ID

  // === Cross-reference maps (CLI command is the join key) ===
  /** CLI command → swagger endpoint IDs that reference it */
  cliToSwagger: Map<string, string[]>;
  /** CLI command → SMF table names that declare it */
  cliToSmfTables: Map<string, string[]>;
  /** Swagger endpoint ID → related SMF table names (via shared CLI commands) */
  swaggerToSmf: Map<string, string[]>;
  /** SMF table name → related swagger endpoint IDs (via shared CLI commands) */
  smfToSwagger: Map<string, string[]>;

  // === Parameter hints for endpoints with path params ===
  /** Endpoint ID → hints for obtaining required path parameters */
  parameterHints: Map<string, ParameterHint[]>;

  // Searchable text index
  searchIndex: SearchEntry[];

  // Stats
  stats: IndexStats;
}

export interface SearchEntry {
  id: string;
  text: string; // Concatenated searchable text
  tokens: Set<string>; // Pre-tokenized for fast matching
  source: EndpointSource;
  domain: string;
}

export interface IndexStats {
  totalEndpoints: number;
  swaggerEndpoints: number;
  smfTables: number;
  debugSmdbQueryable: number; // Tables that CAN use debug smdb
  debugSmdbNotQueryable: number; // Tables that CANNOT
  queryableSmfTables: number;
  actionOnlyTables: number;
  privateCli: number;
  byDomain: Record<string, number>;
  loadTimeMs: number;
  // Cross-reference stats
  cliCommandsMapped: number; // Unique CLI commands found in both sources
  swaggerWithCli: number; // Swagger endpoints that have Related ONTAP commands
  smfWithCommand: number; // SMF tables with command directive
  crossRefMatches: number; // CLI commands found in BOTH swagger and SMF
  // Swagger field access stats
  crossClusterProxyEndpoints?: number; // Endpoints supporting cross-cluster proxy (peer paths)
  swaggerFieldAccessCounts?: Record<string, number>; // Count of fields per SwaggerAccessRole
}

// ============================================================================
// SMF Field and Method Types (Re-exported from smf-iterator-fields)
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

export interface SmfField {
  name: string;
  description: string;
  type: string;
  role: SmfFieldRole;

  // Extended field metadata (from tree parser)
  uiName?: string;
  useUiNameInCode?: boolean;
  alias?: string;
  typeRange?: { min: number; max: number };
  listModifiers?: string[];
  roleModifier?: string;
  priority?: number;
  pid?: number;
  pidPersistent?: boolean;

  prefixes: {
    optional: boolean;
    hidden: boolean;
    noPositional: boolean;
    mutualExclusiveGroup?: string;
  };
}

export interface SmfMethod {
  name: string;
  description: string;
  privilege?: 'admin' | 'advanced' | 'diagnostic' | 'test';
  attributes: string[];
  args: Array<{
    name: string;
    description: string;
    type: string;
    role: 'in' | 'in-noread' | 'out' | 'out-noread' | 'write' | 'read';
  }>;
  command?: string;
}

// ============================================================================
// Serialized Index Types (JSON-safe — Maps→Records, Sets→Arrays)
// ============================================================================

export interface SerializedSearchEntry {
  id: string;
  text: string;
  tokens: string[]; // Set<string> → string[]
  source: EndpointSource;
  domain: string;
}

export interface SerializedMegaDocsIndex {
  endpoints: Record<string, UnifiedEndpoint>;
  smfTables: Record<string, SmfTableInfo>;
  byTag: Record<string, string[]>;
  byDomain: Record<string, string[]>;
  byCliCommand: Record<string, string>;
  byPath: Record<string, string[]>;
  bySmfTable: Record<string, string>;
  cliToSwagger: Record<string, string[]>;
  cliToSmfTables: Record<string, string[]>;
  swaggerToSmf: Record<string, string[]>;
  smfToSwagger: Record<string, string[]>;
  parameterHints: Record<string, ParameterHint[]>;
  searchIndex: SerializedSearchEntry[];
  stats: IndexStats;
}
