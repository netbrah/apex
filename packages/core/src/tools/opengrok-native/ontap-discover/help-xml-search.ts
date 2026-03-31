/* eslint-disable */
// @ts-nocheck
/**
 * Help XML Search Tool
 *
 * Searches OpenGrok for help XML files related to an SMF table or topic,
 * then parses them to extract rich CLI documentation.
 *
 * Usage:
 *   // Table-specific search
 *   const result = await searchHelpXmls({ tableName: "lun" });
 *
 *   // Topic-based search (new!)
 *   const result = await searchHelpXmls({ query: "encryption" });
 *   // Returns tiered results based on relevance
 *
 * Search strategy:
 *   Table mode: Full text search for "tablename.smf" in path:help_xml
 *   Topic mode: Full text search in path:help_xml, scored by match context
 */

import { searchOpenGrok, getFileContent, DEFAULT_PROJECT } from './opengrok.js';
import {
  parseHelpXml,
  extractTableName,
  buildHelpXmlSearchQuery,
  generateCurlExample,
  type HelpXmlCommand,
  type HelpXmlSearchResult,
} from './help-xml-parser.js';

// ============================================================================
// Input/Output Schemas
// ============================================================================

export interface HelpXmlSearchInput {
  tableName?: string;
  query?: string;
  includeRest?: boolean;
  maxResults?: number;
}

export interface HelpXmlSearchOutput {
  success: boolean;
  smfTableName?: string;
  query?: string;
  searchMode: 'table' | 'topic';
  commands: Array<{
    name: string;
    description: string;
    parameters: Array<{
      name: string;
      description: string;
      defaultValue?: string;
      extraInfo?: string;
    }>;
    examples: Array<{
      command: string;
      description: string;
      personality?: string;
    }>;
    restEndpoint?: string;
    httpMethod?: string;
    curlExample?: string;
    smfFile?: string;
    sourceFile: string;
    confidence?: 'high' | 'medium' | 'low';
    relevanceScore?: number;
  }>;
  highConfidence?: string[];
  mediumConfidence?: string[];
  lowConfidence?: string[];
  xmlFiles: string[];
  totalFound: number;
  error?: string;
}

// ============================================================================
// Confidence Scoring for Topic Search
// ============================================================================

type ConfidenceLevel = 'high' | 'medium' | 'low';

interface ScoredCommand {
  command: HelpXmlSearchOutput['commands'][0];
  score: number;
  confidence: ConfidenceLevel;
  matchLocations: string[];
}

/**
 * Score a parsed command based on where the query appears
 * Higher scores = more relevant
 */
function scoreCommandRelevance(
  command: HelpXmlSearchOutput['commands'][0],
  query: string,
): ScoredCommand {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

  let score = 0;
  const matchLocations: string[] = [];

  // Check command name (highest value)
  const nameLower = command.name.toLowerCase();
  if (queryWords.some((w) => nameLower.includes(w))) {
    score += 100;
    matchLocations.push('command_name');
  }

  // Check parameter names (high value)
  for (const param of command.parameters) {
    if (queryWords.some((w) => param.name.toLowerCase().includes(w))) {
      score += 80;
      matchLocations.push(`param_name:${param.name}`);
      break; // Only count once
    }
  }

  // Check parameter descriptions (medium-high value)
  for (const param of command.parameters) {
    if (queryWords.some((w) => param.description.toLowerCase().includes(w))) {
      score += 60;
      matchLocations.push(`param_desc:${param.name}`);
      break;
    }
  }

  // Check command description (medium value)
  if (queryWords.some((w) => command.description.toLowerCase().includes(w))) {
    score += 50;
    matchLocations.push('description');
  }

  // Check examples (lower value - may just mention topic in passing)
  for (const ex of command.examples) {
    if (
      queryWords.some(
        (w) =>
          ex.command.toLowerCase().includes(w) ||
          ex.description.toLowerCase().includes(w),
      )
    ) {
      score += 20;
      matchLocations.push('example');
      break;
    }
  }

  // File path bonus (e.g., encryption/enable.xml)
  const pathLower = command.sourceFile.toLowerCase();
  if (queryWords.some((w) => pathLower.includes(w))) {
    score += 30;
    matchLocations.push('file_path');
  }

  // Determine confidence level
  let confidence: ConfidenceLevel;
  if (
    matchLocations.includes('command_name') ||
    matchLocations.some((l) => l.startsWith('param_name'))
  ) {
    confidence = 'high';
  } else if (
    matchLocations.includes('description') ||
    matchLocations.some((l) => l.startsWith('param_desc')) ||
    matchLocations.includes('file_path')
  ) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    command: { ...command, confidence, relevanceScore: score },
    score,
    confidence,
    matchLocations,
  };
}

// ============================================================================
// Main Search Function
// ============================================================================

/**
 * Search for help XML files related to an SMF table or topic
 *
 * @param input - Search parameters (tableName OR query)
 * @returns Structured CLI documentation from help XMLs
 */
export async function searchHelpXmls(
  input: HelpXmlSearchInput,
): Promise<HelpXmlSearchOutput> {
  const isTopicSearch = !!input.query && !input.tableName;
  const searchMode = isTopicSearch ? 'topic' : 'table';

  // Determine search parameters
  let searchFull: string;
  let searchPath: string;
  let tableName: string | undefined;

  if (isTopicSearch) {
    // Topic search: search for query term in help_xml path
    searchFull = input.query!;
    searchPath = 'help_xml';
    tableName = undefined;
  } else {
    // Table search: search for tablename.smf
    tableName = extractTableName(input.tableName!);
    const query = buildHelpXmlSearchQuery(tableName);
    searchFull = query.full;
    searchPath = query.path;
  }

  try {
    // Step 1: Search OpenGrok for help XMLs
    const searchResult = await searchOpenGrok({
      full: searchFull,
      path: searchPath,
      maxResults: input.maxResults || 20,
      project: DEFAULT_PROJECT,
    });

    if (searchResult.totalCount === 0) {
      return {
        success: true,
        searchMode,
        smfTableName: tableName,
        query: input.query,
        commands: [],
        xmlFiles: [],
        totalFound: 0,
        error: isTopicSearch
          ? `No help XMLs found for topic: ${input.query}`
          : `No help XMLs found for table: ${tableName}`,
      };
    }

    // Step 2: Filter for .xml files only
    const xmlFiles = searchResult.results
      .map((r) => r.file)
      .filter((f) => f.endsWith('.xml'))
      .slice(0, input.maxResults || 20);

    // Step 3: Fetch and parse each XML file
    const commands: HelpXmlSearchOutput['commands'] = [];
    const fetchErrors: string[] = [];

    for (const xmlFile of xmlFiles) {
      try {
        const content = await getFileContent(xmlFile, DEFAULT_PROJECT);
        if (!content) {
          fetchErrors.push(`Failed to fetch: ${xmlFile}`);
          continue;
        }

        const parsed = parseHelpXml(content, xmlFile);
        if (!parsed) {
          fetchErrors.push(`Failed to parse: ${xmlFile}`);
          continue;
        }

        // Build command entry with optional REST mapping
        const commandEntry: HelpXmlSearchOutput['commands'][0] = {
          ...parsed,
          sourceFile: xmlFile,
        };

        if (input.includeRest !== false) {
          const { cliToRestPath, cliVerbToHttpMethod } = await import(
            './help-xml-parser.js'
          );
          commandEntry.restEndpoint = cliToRestPath(parsed.name);
          commandEntry.httpMethod = cliVerbToHttpMethod(parsed.name);
          commandEntry.curlExample = generateCurlExample(
            parsed.name,
            parsed.parameters,
          );
        }

        commands.push(commandEntry);
      } catch (err) {
        fetchErrors.push(`Error processing ${xmlFile}: ${err}`);
      }
    }

    // Step 4: For topic search, score and tier the results
    let highConfidence: string[] | undefined;
    let mediumConfidence: string[] | undefined;
    let lowConfidence: string[] | undefined;

    if (isTopicSearch && commands.length > 0 && input.query) {
      const scored = commands.map((cmd) =>
        scoreCommandRelevance(cmd, input.query!),
      );

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // Filter out zero-score (completely irrelevant)
      const relevant = scored.filter((s) => s.score > 0);

      // Update commands with scores and sort
      commands.length = 0;
      commands.push(...relevant.map((s) => s.command));

      // Build tier lists
      highConfidence = relevant
        .filter((s) => s.confidence === 'high')
        .map((s) => s.command.name);
      mediumConfidence = relevant
        .filter((s) => s.confidence === 'medium')
        .map((s) => s.command.name);
      lowConfidence = relevant
        .filter((s) => s.confidence === 'low')
        .map((s) => s.command.name);
    }

    return {
      success: true,
      searchMode,
      smfTableName: tableName,
      query: input.query,
      commands,
      ...(isTopicSearch
        ? { highConfidence, mediumConfidence, lowConfidence }
        : {}),
      xmlFiles,
      totalFound: searchResult.totalCount,
      error: fetchErrors.length > 0 ? fetchErrors.join('; ') : undefined,
    };
  } catch (error) {
    return {
      success: false,
      searchMode,
      smfTableName: tableName,
      query: input.query,
      commands: [],
      xmlFiles: [],
      totalFound: 0,
      error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get help XML for a specific CLI command
 *
 * @param cliCommand - CLI command name (e.g., "lun online", "volume show")
 * @returns Structured CLI documentation
 */
export async function getHelpForCliCommand(
  cliCommand: string,
): Promise<HelpXmlSearchOutput['commands'][0] | null> {
  // Convert CLI command to potential file path
  // "lun online" -> search for online.xml in help_xml/lun/
  const parts = cliCommand.split(/\s+/);
  const command = parts.pop() || '';
  const prefix = parts.join('/');
  const expectedRelPath =
    `help_xml/${prefix ? `${prefix}/` : ''}${command}.xml`.replace(
      /\/{2,}/g,
      '/',
    );
  const expectedSuffix = `/${expectedRelPath}`;

  try {
    // Search for the specific XML file
    const searchResult = await searchOpenGrok({
      path: expectedRelPath,
      maxResults: 5,
      project: DEFAULT_PROJECT,
    });

    if (searchResult.totalCount === 0) {
      return null;
    }

    // Prefer an exact path match when OpenGrok returns multiple candidates
    const exact = searchResult.results.find(
      (r) => r.file === expectedSuffix || r.file.endsWith(expectedSuffix),
    );

    // Fallback: choose the closest match by minimizing extra path segments
    const best =
      exact ??
      [...searchResult.results].sort((a, b) => {
        const aSegs = a.file.split('/').filter(Boolean).length;
        const bSegs = b.file.split('/').filter(Boolean).length;
        return aSegs - bSegs;
      })[0];

    const xmlFile = best?.file;
    if (!xmlFile) return null;

    const content = await getFileContent(xmlFile, DEFAULT_PROJECT);
    if (!content) return null;

    const parsed = parseHelpXml(content, xmlFile);
    if (!parsed) return null;

    const { cliToRestPath, cliVerbToHttpMethod } = await import(
      './help-xml-parser.js'
    );

    return {
      ...parsed,
      restEndpoint: cliToRestPath(parsed.name),
      httpMethod: cliVerbToHttpMethod(parsed.name),
      curlExample: generateCurlExample(parsed.name, parsed.parameters),
      sourceFile: xmlFile,
    };
  } catch (error) {
    console.error(
      `Error fetching help for CLI command "${cliCommand}":`,
      error,
    );
    return null;
  }
}

// ============================================================================
// Tool Definition (for MCP)
// ============================================================================

export const helpXmlSearchTool = {
  name: 'help_xml_search',
  description: `Search for CLI help XML documentation by table name OR topic.

Two search modes:
1. Table mode: { "tableName": "lun" } → All help XMLs for that SMF table
2. Topic mode: { "query": "encryption" } → All help XMLs mentioning the topic

Topic search returns TIERED results by confidence:
- highConfidence: Query appears in command name or parameter name
- mediumConfidence: Query appears in descriptions or file path
- lowConfidence: Query only appears in examples

Returns:
- Command name and description
- Parameter definitions with descriptions
- CLI examples with explanations
- REST endpoint mapping and curl examples
- Confidence level (for topic search)

Examples:
  { "tableName": "lun" }
  → Returns: lun online, lun offline, lun modify, etc.

  { "query": "encryption" }
  → Returns: volume encryption start, security key-manager enable, etc.
  → With tiers: highConfidence=["volume encryption..."], mediumConfidence=[...]`,
  inputSchema: HelpXmlSearchInputSchema,
  outputSchema: HelpXmlSearchOutputSchema,
  execute: searchHelpXmls,
};

// ============================================================================
// Convenience Exports
// ============================================================================

export {
  parseHelpXml,
  extractTableName,
  buildHelpXmlSearchQuery,
} from './help-xml-parser.js';
