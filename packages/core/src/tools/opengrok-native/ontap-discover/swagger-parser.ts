/* eslint-disable */
// @ts-nocheck
/**
 * Parse the swagger.yaml OpenAPI spec
 * ~13MB file with full ONTAP REST API definitions
 *
 * Tries OpenGrok first (latest GA release), falls back to local file.
 */

import * as yaml from 'js-yaml';
import {
  searchOpenGrok,
  getFileContent,
  DEFAULT_PROJECT,
} from '../lib/opengrok.js';
import type {
  UnifiedEndpoint,
  ParameterInfo,
  SchemaInfo,
  FieldInfo,
  SwaggerAccessRole,
} from './types.js';

const SWAGGER_PATH = './swagger.yaml';
const OPENGROK_SWAGGER_DIR = 'swagger/src/tools/released_yamls';
const OPENGROK_PROJECT = DEFAULT_PROJECT;

export interface SwaggerParseResult {
  endpoints: UnifiedEndpoint[];
  parseTimeMs: number;
  totalEndpoints: number;
  rawSpec: any; // Keep for schema resolution
  source: string; // 'opengrok' or 'local'
}

/**
 * Discover all released swagger YAMLs from OpenGrok and pick the latest GA version.
 * Files follow the pattern: {version}_GA.yaml (e.g., 918_GA.yaml)
 * Returns the file path on OpenGrok, or null if discovery fails.
 */
async function discoverLatestSwaggerYaml(): Promise<string | null> {
  try {
    const result = await searchOpenGrok({
      path: OPENGROK_SWAGGER_DIR,
      maxResults: 30,
      project: OPENGROK_PROJECT,
    });

    if (result.totalCount === 0) return null;

    // Filter for _GA.yaml files and sort by version number descending
    const gaFiles = result.results
      .map((r) => r.file)
      .filter((f) => f.endsWith('_GA.yaml'));

    if (gaFiles.length === 0) return null;

    // Extract version number and sort descending
    // e.g., /swagger/src/tools/released_yamls/918_GA.yaml → 918
    gaFiles.sort((a, b) => {
      const verA = parseInt(a.match(/(\d+)_GA\.yaml$/)?.[1] || '0', 10);
      const verB = parseInt(b.match(/(\d+)_GA\.yaml$/)?.[1] || '0', 10);
      return verB - verA;
    });

    const latest = gaFiles[0];
    console.log(
      `[swagger] OpenGrok: found ${gaFiles.length} GA versions, latest: ${latest}`,
    );
    return latest;
  } catch (e) {
    console.warn(`[swagger] OpenGrok discovery failed: ${e}`);
    return null;
  }
}

export async function parseSwaggerYaml(): Promise<SwaggerParseResult> {
  const startTime = Date.now();
  let content: string | null = null;
  let source = 'unknown';

  // 1) Try OpenGrok first — discover latest GA version
  try {
    const latestPath = await discoverLatestSwaggerYaml();
    if (latestPath) {
      console.log(`[swagger] Fetching from OpenGrok: ${latestPath}`);
      content = await getFileContent(latestPath, OPENGROK_PROJECT);
      if (content && content.length > 100_000) {
        source = 'opengrok';
        console.log(
          `[swagger] OpenGrok file size: ${(content.length / 1024 / 1024).toFixed(2)} MB`,
        );
      } else {
        console.warn(
          `[swagger] OpenGrok content too small (${content?.length ?? 0} bytes), falling back`,
        );
        content = null;
      }
    }
  } catch (e) {
    console.warn(`[swagger] OpenGrok fetch failed: ${e}`);
  }

  if (!content) {
    throw new Error('No swagger.yaml available from OpenGrok');
  }

  const rawSpec = yaml.load(content) as any;
  const endpoints = extractEndpoints(rawSpec);

  const parseTimeMs = Date.now() - startTime;
  console.log(
    `[swagger] Parsed ${endpoints.length} endpoints from ${source} in ${parseTimeMs}ms`,
  );

  return {
    endpoints,
    parseTimeMs,
    totalEndpoints: endpoints.length,
    rawSpec,
    source,
  };
}

function extractEndpoints(spec: any): UnifiedEndpoint[] {
  const endpoints: UnifiedEndpoint[] = [];
  const paths = spec.paths || {};

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = (pathItem as any)[method];
      if (!operation) continue;

      const methodUpper = method.toUpperCase() as any;
      const domain = extractDomainFromPath(path);
      const description = operation.description || '';
      const relatedCliCommands = extractRelatedCliCommands(description);
      const summary =
        operation.summary ||
        operation.operationId ||
        (typeof description === 'string' && description.trim()
          ? description.trim().split(/\n+/)[0].slice(0, 120)
          : '') ||
        `${methodUpper} ${path}`;

      const expensiveFields = extractExpensiveFields(description);
      const responseFields = extractResponseFields(
        operation,
        spec,
        expensiveFields,
      );

      // Extract x-ntap-introduced version (prefer non-dark variant)
      const introducedVersion = extractIntroducedVersion(operation);

      // Detect cross-cluster proxy endpoints
      const crossClusterProxy = isCrossClusterProxyPath(path);

      endpoints.push({
        id: `swagger:${methodUpper}:${path}`,
        source: 'swagger',
        method: methodUpper,
        path,
        privatePath: convertToPrivatePath(path, method),
        summary,
        description,
        cliCommand: relatedCliCommands[0], // Primary CLI command
        relatedCliCommands:
          relatedCliCommands.length > 0 ? relatedCliCommands : undefined,
        ...(introducedVersion ? { introducedVersion } : {}),
        ...(crossClusterProxy ? { crossClusterProxy } : {}),
        tags: operation.tags || [],
        domain,
        parameters: extractParameters(operation, pathItem),
        requestBody: extractRequestBody(operation, spec),
        responseFields,
        accessPatterns: {
          publicRest: true, // All swagger endpoints are public REST
          privateCli: true, // Most have CLI equivalents
          debugSmdb: false, // Swagger endpoints don't use debug smdb
        },
        queryable: method === 'get',
        isActionOnly: method === 'post' && !path.includes('{'),
      });
    }
  }

  return endpoints;
}

function extractDomainFromPath(path: string): string {
  // Swagger 2.0 paths are stored without basePath prefix
  // /security/key-managers → security
  // /storage/volumes → storage
  // /cloud/targets → cloud
  const match = path.match(/^\/([^\/]+)/);
  return match ? match[1] : 'general';
}

function convertToPrivatePath(path: string, method: string): string {
  // Convert public REST path to private CLI path (approximation)
  // /security/key-managers → /api/private/cli/security/key-manager
  return (
    '/api/private/cli' +
    path
      .replace(/\{[^}]+\}/g, '') // Remove path params
      .replace(/\/{2,}/g, '/') // Collapse double slashes from removed params
      .replace(/\/+$/, '')
  ); // Remove trailing slashes
}

/**
 * Extract the x-ntap-introduced version from an operation or its parent.
 * Prefers the public version over -dark. Filters out "DO_NOT_DISPLAY".
 */
export function extractIntroducedVersion(operation: any): string | undefined {
  const raw = operation?.['x-ntap-introduced'];
  if (raw && typeof raw === 'string' && raw !== 'DO_NOT_DISPLAY') {
    return raw;
  }
  return undefined;
}

/**
 * Detect if a path is a cross-cluster REST proxy path.
 * Pattern: /cluster/peers/{peer.uuid}/... or /svm/peers/{peer.uuid}/...
 */
export function isCrossClusterProxyPath(path: string): boolean {
  return /^\/(cluster|svm)\/peers\/\{[^}]+\}\/.+/.test(path);
}

/**
 * Determine the SwaggerAccessRole from a property's x-ntap-* extensions.
 * Order matters — most specific wins (per ONTAP Swagger Validator rules):
 *   x-ntap-createOnly > x-ntap-readCreate > x-ntap-modifyOnly > x-ntap-readModify
 *   > x-ntap-writeOnly > readOnly/x-ntap-readOnly > default (readWrite)
 */
export function extractSwaggerAccessRole(prop: any): SwaggerAccessRole {
  if (!prop || typeof prop !== 'object') return 'readWrite';

  if (prop['x-ntap-createOnly'] === true) return 'createOnly';
  if (prop['x-ntap-readCreate'] === true) return 'readCreate';
  if (prop['x-ntap-modifyOnly'] === true) return 'modifyOnly';
  if (prop['x-ntap-readModify'] === true) return 'readModify';
  if (prop['x-ntap-writeOnly'] === true) return 'writeOnly';
  if (prop['readOnly'] === true || prop['x-ntap-readOnly'] === true)
    return 'readOnly';

  return 'readWrite';
}

/**
 * Map a SwaggerAccessRole to the unified FieldInfo role.
 */
export function swaggerAccessToFieldRole(
  access: SwaggerAccessRole,
): FieldInfo['role'] {
  switch (access) {
    case 'readOnly':
      return 'read';
    case 'readCreate':
      return 'create';
    case 'createOnly':
      return 'create';
    case 'readModify':
      return 'modify';
    case 'modifyOnly':
      return 'modify';
    case 'writeOnly':
      return 'write';
    case 'readWrite':
      return 'read';
  }
}

/**
 * Extract expensive field names from "### Expensive properties" section.
 * These fields are excluded from default GET and must be explicitly requested via ?fields=
 */
function extractExpensiveFields(description: string): Set<string> {
  const expensive = new Set<string>();
  if (!description) return expensive;

  const normalized = description.replace(/\\n/g, '\n');
  const match = normalized.match(
    /##?#?\s*Expensive [Pp]roperties\s*\n([\s\S]*?)(?:\n##|\n\n[^*]|$)/,
  );
  if (!match) return expensive;

  const section = match[1];
  const fieldRegex = /\*\s*`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = fieldRegex.exec(section)) !== null) {
    const field = m[1].trim();
    if (field && !field.includes(' ')) {
      expensive.add(field);
    }
  }

  return expensive;
}

/**
 * Extract CLI commands from the "## Related ONTAP commands" section in descriptions.
 * Pattern: markdown heading followed by bullet list of backtick-quoted commands.
 * Both ## and ### headings are used, and "commands" vs "Commands" both appear.
 */
function extractRelatedCliCommands(description: string): string[] {
  if (!description) return [];

  const commands: string[] = [];
  // Match: ## or ### Related ONTAP commands/Commands, followed by * `cmd` lines
  // The description may be a YAML multi-line string with literal \n or actual newlines
  const normalized = description.replace(/\\n/g, '\n');
  const match = normalized.match(
    /##?#?\s*Related ONTAP [Cc]ommands?\s*\n([\s\S]*?)(?:\n##|\n\n[^*]|$)/,
  );
  if (!match) return commands;

  const bulletSection = match[1];
  const bulletRegex = /\*\s*`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = bulletRegex.exec(bulletSection)) !== null) {
    const cmd = m[1].trim();
    if (cmd && !commands.includes(cmd)) {
      commands.push(cmd);
    }
  }

  return commands;
}

function extractParameters(operation: any, pathItem: any): ParameterInfo[] {
  const params: ParameterInfo[] = [];
  const allParams = [
    ...(pathItem.parameters || []),
    ...(operation.parameters || []),
  ];

  for (const p of allParams) {
    params.push({
      name: p.name,
      in: p.in,
      required: p.required || p.in === 'path',
      type: p.schema?.type || p.type || 'string',
      description: p.description || '',
      enum: p.schema?.enum || p.enum,
      default: p.schema?.default ?? p.default,
    });
  }

  return params;
}

function extractRequestBody(operation: any, spec: any): SchemaInfo | undefined {
  // OpenAPI 3.0: requestBody.content['application/json'].schema
  if (operation.requestBody?.content?.['application/json']?.schema) {
    return resolveAndSimplifySchema(
      operation.requestBody.content['application/json'].schema,
      spec,
    );
  }

  // Swagger 2.0: parameters with in=body have a schema directly
  const bodyParam = operation.parameters?.find((p: any) => p.in === 'body');
  if (bodyParam?.schema) {
    return resolveAndSimplifySchema(bodyParam.schema, spec);
  }

  return undefined;
}

function extractResponseFields(
  operation: any,
  spec: any,
  expensiveFields?: Set<string>,
): FieldInfo[] | undefined {
  const response = operation.responses?.['200'] || operation.responses?.['201'];
  if (!response) return undefined;

  // OpenAPI 3.0: response.content['application/json'].schema
  // Swagger 2.0: response.schema
  const schema =
    response.content?.['application/json']?.schema || response.schema;
  if (!schema) return undefined;

  const resolved = resolveSchema(schema, spec);
  if (!resolved?.properties) return undefined;

  // For collection endpoints, the response is a wrapper with _links, num_records, records.
  // The actual model fields are in records.items.$ref. Unwrap to show the real model.
  const recordsProp = resolved.properties.records;
  if (recordsProp?.items) {
    const itemSchema = resolveSchema(recordsProp.items, spec);
    if (itemSchema?.properties) {
      return extractFieldsFromProperties(
        itemSchema.properties,
        itemSchema.required,
        expensiveFields,
        spec,
        0,
      );
    }
  }

  return extractFieldsFromProperties(
    resolved.properties,
    resolved.required,
    expensiveFields,
    spec,
    0,
  );
}

function extractFieldsFromProperties(
  properties: Record<string, any>,
  required?: string[],
  expensiveFields?: Set<string>,
  spec?: any,
  depth: number = 0,
): FieldInfo[] {
  const fields: FieldInfo[] = [];

  for (const [name, rawProp] of Object.entries(properties)) {
    if (name === '_links') continue; // Skip HAL links noise

    // Resolve $ref if present
    const prop = spec && rawProp?.$ref ? resolveSchema(rawProp, spec) : rawProp;

    const isExpensive = expensiveFields
      ? expensiveFields.has(name) ||
        expensiveFields.has(`${name}.*`) ||
        [...expensiveFields].some((ef) => ef.startsWith(`${name}.`))
      : false;

    const fieldType =
      prop?.type ||
      (prop?.properties ? 'object' : prop?.items ? 'array' : 'string');

    // Extract x-ntap access modifier — use rawProp first (preserves extensions before $ref resolution),
    // then fall back to resolved prop
    const swaggerAccess = extractSwaggerAccessRole(
      rawProp?.$ref ? { ...prop, ...rawProp } : prop,
    );
    const role = swaggerAccessToFieldRole(swaggerAccess);

    // Extract x-ntap-introduced version for this field
    const introduced =
      rawProp?.['x-ntap-introduced'] || prop?.['x-ntap-introduced'];
    const introducedVersion =
      typeof introduced === 'string' && introduced !== 'DO_NOT_DISPLAY'
        ? introduced
        : undefined;

    fields.push({
      name,
      description: (prop?.description || '').slice(0, 200),
      type: fieldType,
      role,
      required: (required || []).includes(name),
      queryable: true,
      filterable: false,
      ...(isExpensive ? { expensive: true } : {}),
      ...(swaggerAccess !== 'readWrite' ? { swaggerAccess } : {}),
      ...(introducedVersion ? { introducedVersion } : {}),
    });

    // For object fields, expand one level of sub-fields so the agent knows
    // valid nested paths (e.g., space.block_storage, space.cloud_storage)
    if (depth < 1 && spec && fieldType === 'object' && prop?.properties) {
      for (const [subName, rawSubProp] of Object.entries(
        prop.properties as Record<string, any>,
      )) {
        if (subName === '_links') continue;
        const subProp = rawSubProp?.$ref
          ? resolveSchema(rawSubProp, spec)
          : rawSubProp;
        const subType =
          subProp?.type ||
          (subProp?.properties
            ? 'object'
            : subProp?.items
              ? 'array'
              : 'string');

        const subAccess = extractSwaggerAccessRole(
          rawSubProp?.$ref ? { ...subProp, ...rawSubProp } : subProp,
        );
        const subRole = swaggerAccessToFieldRole(subAccess);

        const subIntroduced =
          rawSubProp?.['x-ntap-introduced'] || subProp?.['x-ntap-introduced'];
        const subIntroducedVersion =
          typeof subIntroduced === 'string' &&
          subIntroduced !== 'DO_NOT_DISPLAY'
            ? subIntroduced
            : undefined;

        fields.push({
          name: `${name}.${subName}`,
          description: (subProp?.description || '').slice(0, 200),
          type: subType,
          role: subRole,
          required: false,
          queryable: true,
          filterable: false,
          ...(isExpensive ? { expensive: true } : {}),
          ...(subAccess !== 'readWrite' ? { swaggerAccess: subAccess } : {}),
          ...(subIntroducedVersion
            ? { introducedVersion: subIntroducedVersion }
            : {}),
        });
      }
    }
  }

  return fields;
}

function resolveSchema(schema: any, spec: any, depth = 0): any {
  if (depth > 10) return schema;

  if (schema.$ref) {
    const refPath = schema.$ref.replace('#/', '').split('/');
    let resolved = spec;
    for (const part of refPath) {
      resolved = resolved?.[part];
    }
    return resolved ? resolveSchema(resolved, spec, depth + 1) : schema;
  }

  return schema;
}

function resolveAndSimplifySchema(schema: any, spec: any): SchemaInfo {
  const resolved = resolveSchema(schema, spec);

  return {
    type: resolved.type || 'object',
    properties: resolved.properties
      ? Object.fromEntries(
          Object.entries(resolved.properties).map(
            ([name, prop]: [string, any]) => [
              name,
              {
                name,
                description: prop.description || '',
                type: prop.type || 'string',
                role: 'write' as const,
                required: (resolved.required || []).includes(name),
                queryable: false,
                filterable: false,
              },
            ],
          ),
        )
      : undefined,
    required: resolved.required,
    example: resolved.example,
  };
}
