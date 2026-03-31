/* eslint-disable */
// @ts-nocheck
/**
 * SMF Source Parser
 *
 * Parses SMF source files fetched from OpenGrok to extract:
 * - Custom enum definitions
 * - Type definitions
 * - Table relationships
 *
 * Example enum:
 * ```
 * enum KeyUsageType "Key Usage Type" {
 *     NSE-AK=0    "Authentication Key for NSE drive"
 *     AEK=1       "Aggregate Encryption Key"
 *     VEK=2       "Volume Encryption Key"
 * }
 * ```
 */

import {
  searchOpenGrok,
  getFileContent,
  DEFAULT_PROJECT,
} from '../lib/opengrok.js';

// ============================================================================
// Types
// ============================================================================

export interface SmfEnumValue {
  name: string;
  value: number;
  description: string;
}

export interface SmfEnumDefinition {
  name: string;
  displayName: string;
  values: SmfEnumValue[];
  sourceFile: string;
}

export interface SmfTypeDefinition {
  name: string;
  baseType: string;
  constraints?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
  description?: string;
  sourceFile: string;
}

export interface SmfSourceInfo {
  enums: SmfEnumDefinition[];
  types: SmfTypeDefinition[];
  includes: string[];
  tableNames: string[];
}

// ============================================================================
// Schemas
// ============================================================================

export interface SmfSourceSearchInput {
  tableName: string;
  includeEnums?: boolean;
  includeTypes?: boolean;
}

// ============================================================================
// Parsers
// ============================================================================

/**
 * Parse enum definitions from SMF source content
 *
 * Format:
 * enum EnumName "Display Name" {
 *     VALUE_NAME=0  "Description"
 *     VALUE_NAME2=1 "Description 2"
 * }
 */
export function parseSmfEnums(
  content: string,
  sourceFile: string,
): SmfEnumDefinition[] {
  const enums: SmfEnumDefinition[] = [];

  // Match enum blocks: enum Name "Display" { ... }
  const enumRegex = /enum\s+(\w+)\s+"([^"]+)"\s*\{([^}]+)\}/gs;

  let match;
  while ((match = enumRegex.exec(content)) !== null) {
    const [, name, displayName, body] = match;
    const values: SmfEnumValue[] = [];

    // Match enum values: NAME=value "description" or NAME=value
    const valueRegex = /(\w[\w-]*)\s*=\s*(-?\d+)\s*(?:"([^"]*)")?/g;

    let valueMatch;
    while ((valueMatch = valueRegex.exec(body)) !== null) {
      values.push({
        name: valueMatch[1],
        value: parseInt(valueMatch[2], 10),
        description: valueMatch[3] || '',
      });
    }

    if (values.length > 0) {
      enums.push({
        name,
        displayName,
        values,
        sourceFile,
      });
    }
  }

  return enums;
}

/**
 * Parse type definitions from SMF source
 *
 * Formats:
 * 1. Assignment style: type TypeName = integer<min..max>
 * 2. Block style (golden_global.smf): type typename {
 */
export function parseSmfTypes(
  content: string,
  sourceFile: string,
): SmfTypeDefinition[] {
  const types: SmfTypeDefinition[] = [];

  // Format 1: Assignment style - type TypeName = baseType<constraints>
  const assignRegex =
    /type\s+(\w+)\s*=\s*(\w+)(?:<([^>]+)>)?(?:\s*"([^"]*)")?/g;

  let match;
  while ((match = assignRegex.exec(content)) !== null) {
    const [, name, baseType, constraints, description] = match;

    const typeDef: SmfTypeDefinition = {
      name,
      baseType,
      sourceFile,
    };

    if (description) {
      typeDef.description = description;
    }

    // Parse constraints like "0..255" or "1..64"
    if (constraints) {
      const rangeMatch = constraints.match(/(-?\d+)\.\.(-?\d+)/);
      if (rangeMatch) {
        typeDef.constraints = {
          min: parseInt(rangeMatch[1], 10),
          max: parseInt(rangeMatch[2], 10),
        };
      }
    }

    types.push(typeDef);
  }

  // Format 2: Block style - type typename { (from golden_global.smf)
  // Matches "type name {" at start of line
  const blockRegex = /^type\s+(\w+)\s*\{/gm;

  while ((match = blockRegex.exec(content)) !== null) {
    const name = match[1];

    // Skip if already found (avoid duplicates)
    if (types.some((t) => t.name === name)) {
      continue;
    }

    types.push({
      name,
      baseType: 'custom', // Block style types don't have explicit base type
      sourceFile,
    });
  }

  return types;
}

/**
 * Parse #include directives to find related SMF files
 */
export function parseSmfIncludes(content: string): string[] {
  const includes: string[] = [];
  const includeRegex = /#include\s*[<"]([^>"]+)[>"]/g;

  let match;
  while ((match = includeRegex.exec(content)) !== null) {
    includes.push(match[1]);
  }

  return includes;
}

/**
 * Extract table names defined in SMF source
 *
 * Formats:
 * 1. Simple: table tablename { or action tablename {
 * 2. Golden global: table name "description" {flags} {
 */
export function parseSmfTableNames(content: string): string[] {
  const tables = new Set<string>();

  // Format 1: Simple - table/action/view name { (at start of line)
  const simpleRegex = /^\s*(table|action|view)\s+(\w+)\s*\{/gm;

  let match;
  while ((match = simpleRegex.exec(content)) !== null) {
    tables.add(match[2]);
  }

  // Format 2: Golden global format at start of line
  // table name "description" {flags} {
  // action name "description" {flags} {
  // view name "description" {flags} {
  const goldenRegex =
    /^(table|action|view)\s+(\w+)\s+"[^"]*"\s*\{[^}]*\}\s*\{/gm;

  while ((match = goldenRegex.exec(content)) !== null) {
    tables.add(match[2]);
  }

  return Array.from(tables);
}

/**
 * Parse full SMF source file
 */
export function parseSmfSource(
  content: string,
  sourceFile: string,
): SmfSourceInfo {
  return {
    enums: parseSmfEnums(content, sourceFile),
    types: parseSmfTypes(content, sourceFile),
    includes: parseSmfIncludes(content),
    tableNames: parseSmfTableNames(content),
  };
}

// ============================================================================
// OpenGrok Integration
// ============================================================================

/**
 * Search OpenGrok for SMF source file containing a table
 * Uses multiple search strategies to find the actual table definition
 */
export async function findSmfSourceFile(
  tableName: string,
): Promise<string | null> {
  try {
    // Strategy 1: Search by filename first (most reliable)
    // Try table name directly and common patterns
    const filePatterns = [
      tableName, // keymanager_key
      `${tableName}_table`, // keymanager_key_table
      tableName.replace(/_/g, '-'), // keymanager-key
      `${tableName.replace(/_/g, '-')}-table`, // keymanager-key-table
    ];

    for (const pattern of filePatterns) {
      const pathResult = await searchOpenGrok({
        full: pattern,
        path: 'smf',
        maxResults: 10,
        project: DEFAULT_PROJECT,
      });

      const smfFiles = pathResult.results
        .filter((r) => r.file.endsWith('.smf'))
        .filter((r) => !r.file.includes('golden_global.smf'))
        .filter((r) => !r.file.includes('/types/')) // Prefer actual table files over type definitions
        .filter((r) => {
          // Must have the pattern in the filename
          const fileName = r.file.toLowerCase();
          return fileName.includes(pattern.toLowerCase());
        });

      if (smfFiles.length > 0) {
        return smfFiles[0].file;
      }
    }

    // Strategy 2: Try tables/ directory search
    const tablesDirResult = await searchOpenGrok({
      full: tableName,
      path: 'tables',
      maxResults: 10,
      project: DEFAULT_PROJECT,
    });

    const tablesDirFiles = tablesDirResult.results
      .filter((r) => r.file.endsWith('.smf'))
      .filter((r) => !r.file.includes('golden_global.smf'))
      .filter(
        (r) =>
          r.file
            .toLowerCase()
            .includes(tableName.toLowerCase().replace(/_/g, '-')) ||
          r.file.toLowerCase().includes(tableName.toLowerCase()),
      );

    if (tablesDirFiles.length > 0) {
      return tablesDirFiles[0].file;
    }

    // Strategy 3: Search for table definition in text
    const tableDefResult = await searchOpenGrok({
      full: `table ${tableName}`,
      path: 'smf',
      maxResults: 20,
      project: DEFAULT_PROJECT,
    });

    // Filter and score results
    const smfFiles = tableDefResult.results
      .filter((r) => r.file.endsWith('.smf'))
      .filter((r) => !r.file.includes('golden_global.smf'))
      .filter((r) => !r.file.includes('/types/'))
      .map((r) => {
        let score = 0;
        const fileName = r.file.toLowerCase();
        const tableNameLower = tableName.toLowerCase();
        const tableNameDashed = tableName.replace(/_/g, '-').toLowerCase();

        // Strong preference for filename containing the table name
        if (
          fileName.includes(tableNameLower) ||
          fileName.includes(tableNameDashed)
        ) {
          score += 100;
        }

        // Check if any match line contains "table <tablename>"
        const hasTableDef = r.matches.some(
          (m) =>
            m.text.toLowerCase().includes(`table ${tableNameLower}`) ||
            m.text.match(new RegExp(`\\btable\\s+${tableName}\\b`, 'i')),
        );
        if (hasTableDef) {
          score += 50;
        }

        // Prefer files in tables/ directories
        if (fileName.includes('/tables/')) {
          score += 20;
        }

        // Prefer shorter paths (more specific)
        score -= r.file.split('/').length;

        return { ...r, score };
      })
      .sort((a, b) => b.score - a.score);

    if (smfFiles.length > 0 && smfFiles[0].score > 0) {
      return smfFiles[0].file;
    }

    // Strategy 4: Search for action definition if it's an action table
    const actionDefResult = await searchOpenGrok({
      full: `action ${tableName}`,
      path: 'smf',
      maxResults: 10,
      project: DEFAULT_PROJECT,
    });

    const actionFiles = actionDefResult.results
      .filter((r) => r.file.endsWith('.smf'))
      .filter((r) => !r.file.includes('golden_global.smf'));
    if (actionFiles.length > 0) {
      return actionFiles[0].file;
    }

    return null;
  } catch (error) {
    console.error(
      `[SmfSourceParser] Error finding SMF source for ${tableName}:`,
      error,
    );
    return null;
  }
}

/**
 * Search for SMF files containing enum definitions
 */
export async function findSmfEnumFile(
  enumName: string,
): Promise<string | null> {
  try {
    const result = await searchOpenGrok({
      full: `enum ${enumName}`,
      path: 'smf',
      maxResults: 10,
      project: DEFAULT_PROJECT,
    });

    const smfFiles = result.results.filter((r) => r.file.endsWith('.smf'));
    if (smfFiles.length > 0) {
      return smfFiles[0].file;
    }

    return null;
  } catch (error) {
    console.error(`[SmfSourceParser] Error finding enum ${enumName}:`, error);
    return null;
  }
}

/**
 * Search for SMF type definition files
 */
export async function findSmfTypesFile(
  tableName: string,
): Promise<string | null> {
  try {
    // Look for *_types.smf or *-types.smf files related to the table
    const baseNames = [
      tableName.split('_')[0], // keymanager_key -> keymanager
      tableName.replace(/_[^_]+$/, ''), // keymanager_key -> keymanager
    ];

    for (const base of baseNames) {
      const patterns = [
        `${base}*types*.smf`,
        `${base}*enum*.smf`,
        `${base.replace(/_/g, '-')}*types*.smf`,
      ];

      for (const pattern of patterns) {
        const result = await searchOpenGrok({
          path: pattern,
          maxResults: 5,
          project: DEFAULT_PROJECT,
        });

        const smfFiles = result.results.filter((r) => r.file.endsWith('.smf'));
        if (smfFiles.length > 0) {
          return smfFiles[0].file;
        }
      }
    }

    return null;
  } catch (error) {
    console.error(
      `[SmfSourceParser] Error finding types file for ${tableName}:`,
      error,
    );
    return null;
  }
}

/**
 * Fetch and parse SMF source file from OpenGrok
 */
export async function fetchAndParseSmfSource(
  filePath: string,
): Promise<SmfSourceInfo | null> {
  try {
    const content = await getFileContent(filePath, DEFAULT_PROJECT);
    if (!content) {
      return null;
    }

    return parseSmfSource(content, filePath);
  } catch (error) {
    console.error(`[SmfSourceParser] Error parsing ${filePath}:`, error);
    return null;
  }
}

/**
 * Get SMF source info for a table, including enum definitions
 * Will also search for related types files if main file has no enums
 */
export async function getSmfSourceForTable(
  input: SmfSourceSearchInput,
): Promise<{
  success: boolean;
  tableName: string;
  sourceFile?: string;
  sourceFiles?: string[];
  sourceInfo?: SmfSourceInfo;
  error?: string;
}> {
  const { tableName, includeEnums = true, includeTypes = true } = input;

  // Find the SMF source file
  const sourceFile = await findSmfSourceFile(tableName);

  if (!sourceFile) {
    return {
      success: false,
      tableName,
      error: `No SMF source file found for table: ${tableName}`,
    };
  }

  // Fetch and parse the source
  const sourceInfo = await fetchAndParseSmfSource(sourceFile);

  if (!sourceInfo) {
    return {
      success: false,
      tableName,
      sourceFile,
      error: `Failed to parse SMF source file: ${sourceFile}`,
    };
  }

  const allSourceFiles = [sourceFile];

  // Aggregate results - start with main file
  let allEnums = [...sourceInfo.enums];
  let allTypes = [...sourceInfo.types];

  // If main file has few/no enums, also search for types files
  if (includeEnums && sourceInfo.enums.length < 2) {
    const typesFile = await findSmfTypesFile(tableName);

    if (typesFile && typesFile !== sourceFile) {
      const typesInfo = await fetchAndParseSmfSource(typesFile);
      if (typesInfo) {
        allSourceFiles.push(typesFile);
        allEnums = [...allEnums, ...typesInfo.enums];
        allTypes = [...allTypes, ...typesInfo.types];
      }
    }
  }

  // Also try to parse included files for enums
  if (includeEnums && allEnums.length < 2 && sourceInfo.includes.length > 0) {
    // Try to fetch first few includes that look like type definitions
    const typeIncludes = sourceInfo.includes
      .filter(
        (inc) =>
          inc.includes('type') ||
          inc.includes('enum') ||
          inc.includes('common'),
      )
      .slice(0, 3);

    for (const inc of typeIncludes) {
      // Try to resolve the include path
      const incPath = inc.startsWith('/') ? inc : `/${inc}`;
      try {
        const incInfo = await fetchAndParseSmfSource(incPath);
        if (incInfo && incInfo.enums.length > 0) {
          allSourceFiles.push(incPath);
          allEnums = [...allEnums, ...incInfo.enums];
          allTypes = [...allTypes, ...incInfo.types];
        }
      } catch {
        // Ignore include fetch errors
      }
    }
  }

  // Filter results based on options
  const filteredInfo: SmfSourceInfo = {
    enums: includeEnums ? allEnums : [],
    types: includeTypes ? allTypes : [],
    includes: sourceInfo.includes,
    tableNames: sourceInfo.tableNames,
  };

  return {
    success: true,
    tableName,
    sourceFile,
    sourceFiles: allSourceFiles.length > 1 ? allSourceFiles : undefined,
    sourceInfo: filteredInfo,
  };
}

// ============================================================================
// Tool Definition (Internal - for Mastra agent)
// ============================================================================

export const smfSourceSearchTool = {
  name: 'smf_source_search',
  description: `Search OpenGrok for SMF source files and parse custom type definitions.

Returns:
- Enum definitions with values and descriptions
- Type definitions with constraints
- Included files
- Table names defined in the file

Use this when:
- You need to know valid values for an enum field
- You need to understand field constraints
- You want to see related SMF files

Example:
  { "tableName": "keymanager_key" }
  → Returns KeyUsageType enum: NSE-AK=0, AEK=1, VEK=2, ...`,
  inputSchema: SmfSourceSearchInputSchema,
  execute: getSmfSourceForTable,
};
