/* eslint-disable */
// @ts-nocheck
/**
 * Help XML Types and Parser
 *
 * Parses ONTAP CLI help XML files to extract command documentation.
 * Uses fast-xml-parser (pure JavaScript) for cross-platform compatibility.
 *
 * Example XML structure:
 * <command>
 *   <name>lun online</name>
 *   <description>This command enables block protocol access...</description>
 *   <parameters>
 *     <parameter>
 *       <name>path</name>
 *       <description>Specifies the path of the LUN...</description>
 *     </parameter>
 *   </parameters>
 *   <example>
 *     <screen>cluster1::> lun online -vserver vs1 -path /vol/vol1/lun1</screen>
 *     <p>Brings LUN /vol/vol1/lun1 online on Vserver vs1.</p>
 *   </example>
 * </command>
 */

import { XMLParser } from 'fast-xml-parser';

// ============================================================================
// Types
// ============================================================================

export interface HelpXmlParameter {
  name: string;
  description: string;
  defaultValue?: string;
  extraInfo?: string;
}

export interface HelpXmlExample {
  command: string; // The CLI command from <screen>
  description: string; // Explanation from <p>
  personality?: string; // e.g., "unified", "asar2" from ontap_personality attr
}

export interface HelpXmlCommand {
  name: string;
  description: string;
  parameters: HelpXmlParameter[];
  examples: HelpXmlExample[];
  smfFile?: string; // Source SMF file from comment
  sourceFile: string; // Path to the help XML file
}

export interface HelpXmlSearchResult {
  success: boolean;
  commands: HelpXmlCommand[];
  smfTableName: string;
  xmlFiles: string[];
  error?: string;
}

// ============================================================================
// Pure JavaScript XML Parser (cross-platform)
// ============================================================================

// Create parser instance with options for mixed content handling
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '_text',
  preserveOrder: true, // Critical for mixed content (text + nested tags)
  trimValues: true,
});

type ParsedNode = {
  [key: string]:
    | ParsedNode[]
    | string
    | boolean
    | number
    | Record<string, string>
    | undefined;
  _text?: string | boolean | number;
  ':@'?: Record<string, string>;
};

/**
 * Get all text content from a parsed node recursively
 * Handles mixed content like: "The <b>bold</b> text"
 */
function getTextContent(nodes: ParsedNode[]): string {
  if (!Array.isArray(nodes)) return '';

  const parts: string[] = [];

  for (const node of nodes) {
    if ('_text' in node) {
      // Handle both string and non-string values (e.g., boolean false)
      const textValue = node._text;
      if (typeof textValue === 'string') {
        parts.push(textValue);
      } else if (textValue !== null && textValue !== undefined) {
        parts.push(String(textValue));
      }
    } else if (':@' in node) {
      // Skip attribute nodes
      continue;
    } else {
      // Recurse into child elements
      for (const key of Object.keys(node)) {
        if (key !== ':@' && Array.isArray(node[key])) {
          parts.push(getTextContent(node[key] as ParsedNode[]));
        }
      }
    }
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Find first element with given tag name in a nodes array
 */
function findElement(
  nodes: ParsedNode[],
  tagName: string,
): ParsedNode[] | null {
  if (!Array.isArray(nodes)) return null;

  for (const node of nodes) {
    if (tagName in node && Array.isArray(node[tagName])) {
      return node[tagName] as ParsedNode[];
    }
  }
  return null;
}

/**
 * Find all elements with given tag name
 */
function findAllElements(nodes: ParsedNode[], tagName: string): ParsedNode[][] {
  if (!Array.isArray(nodes)) return [];

  const results: ParsedNode[][] = [];
  for (const node of nodes) {
    if (tagName in node && Array.isArray(node[tagName])) {
      results.push(node[tagName] as ParsedNode[]);
    }
  }
  return results;
}

/**
 * Get attribute value from a node's :@ object
 */
function getAttribute(nodes: ParsedNode[], attrName: string): string | null {
  if (!Array.isArray(nodes)) return null;

  // Find the parent node that contains :@ with the attribute
  // In preserveOrder mode, attributes are on the same node as content
  for (const node of nodes) {
    if (':@' in node) {
      const attrs = node[':@'] as Record<string, string>;
      const fullAttrName = `@_${attrName}`;
      if (fullAttrName in attrs) {
        return attrs[fullAttrName];
      }
    }
  }
  return null;
}

/**
 * Sanitize XML content to handle common malformed patterns in help XMLs
 *
 * Some help XMLs contain pseudo-tags like <volume name> or <qtree name>
 * that look like XML tags but are actually placeholders. These break
 * XML parsers, so we escape them.
 */
function sanitizeXmlContent(content: string): string {
  // Strip DOCTYPE declarations — some help XMLs have % entities that crash fast-xml-parser
  let sanitized = content.replace(/<!DOCTYPE[^>]*(\[[^\]]*\])?\s*>/gi, '');

  // Pattern: <word space word> that isn't a known XML tag with attributes
  // Examples to escape: <volume name>, <qtree name>, <cluster name>
  // Examples to keep:   <span privilege="test">, <li>

  // Match < followed by word, space, word(s), then >
  // where the first word isn't a known tag name
  const knownTags = new Set([
    'command',
    'name',
    'description',
    'parameters',
    'parameter',
    'example',
    'examples',
    'screen',
    'p',
    'ul',
    'li',
    'span',
    'varname',
    'cmdname',
    'b',
    'i',
    'default',
    'extra-info',
    // Also allow tags with attributes
  ]);

  return sanitized.replace(
    /<([a-zA-Z][a-zA-Z0-9-]*)\s+([^>\/="]+)>/g,
    (match, tag, rest) => {
      // If it's a known tag with attributes (rest contains =), keep it
      if (rest.includes('=')) {
        return match;
      }
      // If it's a known tag name, this might be a tag with text content - don't escape
      if (knownTags.has(tag.toLowerCase())) {
        return match;
      }
      // This looks like <something placeholder> - escape it
      return `&lt;${tag} ${rest}&gt;`;
    },
  );
}

/**
 * Parse a help XML file content into structured command documentation
 * Uses fast-xml-parser for cross-platform compatibility (pure JavaScript)
 */
export function parseHelpXml(
  content: string,
  sourceFile: string,
): HelpXmlCommand | null {
  try {
    // Extract SMF file reference from comment (before parsing)
    const smfMatch = content.match(/smf file:\s*([^\s<>\-]+)/);
    const smfFile = smfMatch ? smfMatch[1].trim() : undefined;

    // Sanitize XML to handle malformed patterns like <volume name>
    const sanitizedContent = sanitizeXmlContent(content);

    // Parse XML
    const parsed = xmlParser.parse(sanitizedContent) as ParsedNode[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    // Find <command> element
    const commandNodes = findElement(parsed, 'command');
    if (!commandNodes) return null;

    // Extract <name>
    const nameNodes = findElement(commandNodes, 'name');
    if (!nameNodes) return null;
    const name = getTextContent(nameNodes);

    // Extract <description>
    const descNodes = findElement(commandNodes, 'description');
    const description = descNodes ? getTextContent(descNodes) : '';

    // Extract <parameters>
    const parameters: HelpXmlParameter[] = [];
    const parametersNodes = findElement(commandNodes, 'parameters');
    if (parametersNodes) {
      const paramNodesList = findAllElements(parametersNodes, 'parameter');
      for (const paramNodes of paramNodesList) {
        const paramName = findElement(paramNodes, 'name');
        const paramDesc = findElement(paramNodes, 'description');
        const paramDefault = findElement(paramNodes, 'default');
        const paramExtra = findElement(paramNodes, 'extra-info');

        if (paramName) {
          parameters.push({
            name: getTextContent(paramName),
            description: paramDesc ? getTextContent(paramDesc) : '',
            defaultValue: paramDefault
              ? getTextContent(paramDefault)
              : undefined,
            extraInfo: paramExtra ? getTextContent(paramExtra) : undefined,
          });
        }
      }
    }

    // Extract <example> elements
    // Handles multiple structures:
    // 1. <example><span ontap_personality="..."><screen>...</screen><p>...</p></span></example>
    // 2. <example>description text<screen>...</screen><p>more text</p><screen>...</screen></example>
    // 3. <example><screen>...</screen><p>...</p></example>
    const examples: HelpXmlExample[] = [];
    const exampleNodesList = findAllElements(commandNodes, 'example');

    for (const exampleNodes of exampleNodesList) {
      // Collect all screen commands and descriptions in this example
      const screenCommands: { command: string; personality?: string }[] = [];
      let accumulatedDescription = '';

      for (const node of exampleNodes) {
        // Handle personality spans: <span ontap_personality="...">...</span>
        if ('span' in node && Array.isArray(node['span'])) {
          const spanContent = node['span'] as ParsedNode[];

          // Get personality from :@ sibling on same node
          let personality: string | undefined;
          if (':@' in node) {
            const attrs = node[':@'] as Record<string, string>;
            personality = attrs['@_ontap_personality'];
          }

          // Find ALL screens in this span
          const screenNodesList = findAllElements(spanContent, 'screen');
          for (const screenNodes of screenNodesList) {
            const cmd = getTextContent(screenNodes);
            if (cmd) {
              screenCommands.push({ command: cmd, personality });
            }
          }

          // Get description from <p> inside span
          const pNodes = findElement(spanContent, 'p');
          if (pNodes) {
            accumulatedDescription += ' ' + getTextContent(pNodes);
          }
        }
        // Handle direct <screen> elements
        else if ('screen' in node && Array.isArray(node['screen'])) {
          const cmd = getTextContent(node['screen'] as ParsedNode[]);
          if (cmd) {
            screenCommands.push({ command: cmd });
          }
        }
        // Handle <p> elements (descriptions between screens)
        else if ('p' in node && Array.isArray(node['p'])) {
          accumulatedDescription +=
            ' ' + getTextContent(node['p'] as ParsedNode[]);
        }
        // Handle direct text nodes (descriptions not wrapped in <p>)
        else if ('_text' in node) {
          const textValue = node._text;
          if (typeof textValue === 'string' && textValue.trim()) {
            accumulatedDescription += ' ' + textValue.trim();
          }
        }
      }

      // Create examples from collected screens
      const trimmedDesc = accumulatedDescription.trim();
      for (const sc of screenCommands) {
        examples.push({
          command: sc.command,
          description: trimmedDesc,
          personality: sc.personality,
        });
      }
    }

    return {
      name,
      description,
      parameters,
      examples,
      smfFile,
      sourceFile,
    };
  } catch (error) {
    console.error(`Error parsing help XML ${sourceFile}:`, error);
    return null;
  }
}

/**
 * Extract the SMF table name from various formats
 * - "lun.smf" -> "lun"
 * - "src/tables/lun.smf" -> "lun"
 * - "lun" -> "lun"
 */
export function extractTableName(input: string): string {
  // Remove path prefix and .smf extension
  const filename = input.split('/').pop() || input;
  return filename.replace(/\.smf$/, '');
}

/**
 * Build the OpenGrok search query for help XMLs
 * Search for: full:"tablename.smf" path:help_xml
 */
export function buildHelpXmlSearchQuery(tableName: string): {
  full: string;
  path: string;
} {
  // Ensure .smf extension
  const smfName = tableName.endsWith('.smf') ? tableName : `${tableName}.smf`;

  return {
    full: smfName,
    path: 'help_xml',
  };
}

// ============================================================================
// REST Endpoint Mapping
// ============================================================================

/**
 * Convert CLI command to REST endpoint path.
 * Strips standard verbs (show, create, modify, delete) to match
 * the canonical private CLI REST path format.
 *
 * "volume show"        -> "/api/private/cli/volume"          (GET)
 * "lun offline"        -> "/api/private/cli/lun/offline"     (POST)
 * "volume create"      -> "/api/private/cli/volume"          (POST)
 * "aggregate show-space" -> "/api/private/cli/aggregate/space" (GET)
 */
export function cliToRestPath(cliCommand: string): string {
  const parts = cliCommand.trim().split(/\s+/);
  const lastPart = parts[parts.length - 1]?.toLowerCase() || '';

  // Standard verbs: strip entirely (path = everything before the verb)
  if (['show', 'create', 'modify', 'delete'].includes(lastPart)) {
    return '/api/private/cli/' + parts.slice(0, -1).join('/');
  }
  // show-* pattern: replace with suffix (show-space → space)
  if (lastPart.startsWith('show-')) {
    parts[parts.length - 1] = lastPart.replace('show-', '');
    return '/api/private/cli/' + parts.join('/');
  }
  // delete-all pattern
  if (lastPart === 'delete-all') {
    parts[parts.length - 1] = 'all';
    return '/api/private/cli/' + parts.join('/');
  }

  return '/api/private/cli/' + parts.join('/');
}

/**
 * Determine HTTP method from CLI verb
 */
export function cliVerbToHttpMethod(cliCommand: string): string {
  const lastWord = cliCommand.split(/\s+/).pop()?.toLowerCase() || '';

  // Standard verbs
  if (lastWord === 'show') return 'GET';
  if (lastWord === 'create') return 'POST';
  if (lastWord === 'modify') return 'PATCH';
  if (lastWord === 'delete') return 'DELETE';

  // show-* variants
  if (lastWord.startsWith('show-')) return 'GET';

  // Default to POST for actions (enable, disable, sync, etc.)
  return 'POST';
}

/**
 * Generate curl example from CLI command
 */
export function generateCurlExample(
  cliCommand: string,
  params?: HelpXmlParameter[],
): string {
  const method = cliVerbToHttpMethod(cliCommand);
  const path = cliToRestPath(cliCommand);

  const lines = [
    `# CLI: ${cliCommand}`,
    `curl -k -s -u admin:<password> --noproxy '*' \\`,
    `  -X ${method} "https://<mgmt-ip>${path}"`,
  ];

  // Add fields query param hint if there are many params
  if (params && params.length > 0 && method === 'GET') {
    const fieldNames = params.map((p) => p.name.replace(/-/g, '_')).join(',');
    lines[2] = `  -X ${method} "https://<mgmt-ip>${path}?fields=${fieldNames}"`;
  }

  return lines.join('\n');
}
