/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Simplified OpenGrok client used by vendored native tools.
 *
 * This preserves the same exported API surface used by the mature tool logic
 * (search/get_file/analyze_symbol_ast/smf helpers) without pulling in the
 * full mastra-search server runtime graph.
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  AGENT_CONFIG,
  CALL_SKIP_LIST,
  DEPRIORITIZE_PATHS,
  EXCLUDE_PATHS,
  PRIORITIZE_PATHS,
} from '../prompts/index.js';
import { logOpenGrok } from './logger.js';
import { OpenGrokError } from './errors.js';

/**
 * Direct (non-proxy) undici Agent for OpenGrok requests.
 *
 * When config.ts calls setGlobalDispatcher(new ProxyAgent(...)) the built-in
 * global fetch() routes every request through the corp HTTP proxy.  OpenGrok
 * is an internal server reachable without proxy (listed in NO_PROXY) but
 * undici's ProxyAgent ignores that env var.  Using undici.fetch with an
 * explicit Agent dispatcher bypasses the global dispatcher, connects directly,
 * and enables connection pooling (keep-alive) for repeated OpenGrok calls.
 */
const directAgent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 10,
  pipelining: 1,
  connect: {
    timeout: 10_000,
  },
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
});

function directFetch(
  url: string | URL,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
): Promise<Response> {
  return undiciFetch(url, {
    ...init,
    dispatcher: directAgent,
  }) as unknown as Promise<Response>;
}

export function getOpenGrokBaseUrl(): string {
  return (
    process.env.OPENGROK_BASE_URL ||
    'http://opengrok.eng.netapp.com/source/api/v1'
  );
}

export function getOpenGrokRawUrl(): string {
  return (
    process.env.OPENGROK_RAW_URL || 'http://opengrok.eng.netapp.com/source/raw'
  );
}

export const DEFAULT_PROJECT = process.env.OPENGROK_PROJECT || 'dev';

export interface SearchMatch {
  lineNumber: string;
  line: string;
}

export interface OpenGrokSearchResponse {
  results: Record<string, SearchMatch[]>;
  resultCount: number;
}

export interface SearchParams {
  full?: string;
  definition?: string;
  symbol?: string;
  path?: string;
  type?: string;
  project?: string;
  maxResults?: number;
}

export interface SearchResult {
  file: string;
  matches: Array<{ line?: number; text: string }>;
  score?: number;
}

const rawSearchCache = new Map<string, OpenGrokSearchResponse>();
const searchResultsCache = new Map<
  string,
  { results: SearchResult[]; totalCount: number }
>();
const fileContentCache = new Map<string, string | null>();

const LUCENE_SPECIAL_CHARS = /([+\-&|!(){}[\]^"~*?:\\/])/g;

export function escapeLuceneChars(term: string): string {
  return term.replace(LUCENE_SPECIAL_CHARS, '\\$1');
}

export function sanitizeFullTextQuery(query: string): string {
  const unescapedQuotes = query.replace(/\\"/g, '').split('"').length - 1;
  const hasUnbalancedQuotes = unescapedQuotes % 2 !== 0;
  const openParens = (query.match(/(?<!\\)\(/g) || []).length;
  const closeParens = (query.match(/(?<!\\)\)/g) || []).length;
  const hasUnbalancedParens = openParens !== closeParens;
  const openBrackets = (query.match(/(?<!\\)\[/g) || []).length;
  const closeBrackets = (query.match(/(?<!\\)\]/g) || []).length;
  const hasUnbalancedBrackets = openBrackets !== closeBrackets;

  if (hasUnbalancedQuotes || hasUnbalancedParens || hasUnbalancedBrackets) {
    return escapeLuceneChars(query);
  }

  return query;
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/<\/?b>/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function detectAuthRedirect(content: string): string | null {
  if (!content.includes('<!DOCTYPE html>') && !content.includes('<html')) {
    return null;
  }

  const authSignatures = [
    /Sign in to your account/i,
    /login\.microsoftonline\.com/i,
    /aadcdn\.msauth\.net/i,
    /ConvergedSignIn/i,
    /Sign in with Google/i,
    /accounts\.google\.com/i,
    /Log in.*SSO/i,
    /SAML/i,
  ];

  if (authSignatures.some((pattern) => pattern.test(content))) {
    return 'Authentication required: OpenGrok returned a login page instead of source content. Check VPN/SSO session or certificate configuration.';
  }

  return null;
}

function getLocalSourceRoot(): string | undefined {
  const env = process.env.LOCAL_SOURCE_ROOT;
  if (env === 'none' || env === 'false' || env === '0') {
    return undefined;
  }
  return env || '/x/eng/rlse/DOT/devN';
}

export async function makeOpenGrokRequest(
  endpoint: string,
  params: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<OpenGrokSearchResponse> {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    searchParams.append(key, String(value));
  }

  const cacheKey = `${endpoint}:${searchParams.toString()}`;
  if (endpoint === 'search') {
    const cached = rawSearchCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const url = `${getOpenGrokBaseUrl()}/${endpoint}?${searchParams.toString()}`;
  const start = Date.now();
  logOpenGrok.request(endpoint, params);

  let response: Response;
  try {
    response = await directFetch(url, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    throw new OpenGrokError(
      `OpenGrok API request failed: ${(error as Error).message}`,
    );
  }

  const responseText = await response.text();

  if (!response.ok) {
    const authError = detectAuthRedirect(responseText);
    if (authError) {
      throw new OpenGrokError(authError, response.status);
    }

    const trimmed = responseText.trim();
    const details =
      trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed;
    throw new OpenGrokError(
      `HTTP ${response.status}: ${details || response.statusText || 'No details'}`,
      response.status,
    );
  }

  const authError = detectAuthRedirect(responseText);
  if (authError) {
    throw new OpenGrokError(authError, response.status);
  }

  let data: OpenGrokSearchResponse;
  try {
    data = JSON.parse(responseText) as OpenGrokSearchResponse;
  } catch {
    throw new OpenGrokError(
      'OpenGrok returned invalid JSON. Response may be an authentication or HTML error page.',
    );
  }

  logOpenGrok.response(endpoint, Date.now() - start, data.resultCount);

  if (endpoint === 'search') {
    rawSearchCache.set(cacheKey, data);
  }

  return data;
}

function searchCacheKey(params: SearchParams): string {
  const project = params.project || DEFAULT_PROJECT;
  const searchType = params.definition
    ? 'def'
    : params.symbol
      ? 'symbol'
      : params.full
        ? 'full'
        : 'other';
  const query = params.definition || params.symbol || params.full || '';
  return `${project}:${searchType}:${query}:${params.path || ''}:${params.type || ''}:${params.maxResults || 30}`;
}

export async function searchOpenGrok(
  params: SearchParams,
  signal?: AbortSignal,
): Promise<{ results: SearchResult[]; totalCount: number }> {
  const project = params.project || DEFAULT_PROJECT;
  const cacheKey = searchCacheKey(params);
  const cached = searchResultsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const apiParams: Record<string, string | number> = {
    projects: project,
    maxresults: params.maxResults || 30,
  };

  if (params.full) {
    apiParams.full = sanitizeFullTextQuery(params.full);
  }
  if (params.definition) {
    apiParams.def = params.definition;
  }
  if (params.symbol) {
    apiParams.symbol = params.symbol;
  }
  if (params.path) {
    apiParams.path = params.path;
  }
  if (params.type) {
    apiParams.type = params.type;
  }

  const data = await makeOpenGrokRequest('search', apiParams, signal);
  const symbol = params.definition || params.symbol || '';

  const results = Object.entries(data.results || {}).map(
    ([filePath, matches]) => ({
      file: filePath.replace(`/${project}/`, '/').replace(/^\//, ''),
      matches: (matches || []).map((m) => ({
        line: parseInt(m.lineNumber, 10) || undefined,
        text: decodeHtmlEntities(m.line || ''),
      })),
      score: scoreResult(filePath, symbol),
    }),
  );

  results.sort((a, b) => (b.score || 0) - (a.score || 0));
  const filtered = results.filter((r) => !isExcludedPath(r.file));
  const result = {
    results: filtered,
    totalCount: data.resultCount || 0,
  };

  searchResultsCache.set(cacheKey, result);
  return result;
}

export async function getFileContent(
  filePath: string,
  project: string = DEFAULT_PROJECT,
  signal?: AbortSignal,
): Promise<string | null> {
  const cleanPath = filePath
    .replace(/#L\d+(-L?\d+)?$/, '')
    .replace(/^\/+/, '')
    .replace(new RegExp(`^${project}/`), '');

  const cacheKey = `${project}:${cleanPath}`;
  if (fileContentCache.has(cacheKey)) {
    return fileContentCache.get(cacheKey) ?? null;
  }

  const localRoot = getLocalSourceRoot();
  if (localRoot && project === DEFAULT_PROJECT) {
    try {
      const localPath = path.join(localRoot, cleanPath);
      const localContent = await fsReadFile(localPath, 'utf-8');
      fileContentCache.set(cacheKey, localContent);
      return localContent;
    } catch {
      // Fall through to HTTP fetch.
    }
  }

  const rawUrl = `${getOpenGrokRawUrl()}/${project}/${cleanPath}`;

  try {
    const response = await directFetch(rawUrl, {
      headers: { Accept: 'text/plain' },
      signal,
    });

    if (response.status === 404) {
      fileContentCache.set(cacheKey, null);
      return null;
    }

    const body = await response.text();

    if (!response.ok) {
      const authError = detectAuthRedirect(body);
      if (authError) {
        throw new OpenGrokError(authError, response.status);
      }
      throw new OpenGrokError(
        `HTTP ${response.status}: ${body.slice(0, 300)}`,
        response.status,
      );
    }

    const authError = detectAuthRedirect(body);
    if (authError) {
      throw new OpenGrokError(authError, response.status);
    }

    fileContentCache.set(cacheKey, body);
    return body;
  } catch (error) {
    if (error instanceof OpenGrokError) {
      throw error;
    }
    return null;
  }
}

export function isExcludedPath(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return EXCLUDE_PATHS.some((pattern) =>
    lowerPath.includes(pattern.toLowerCase()),
  );
}

export function scoreResult(filePath: string, symbolName: string): number {
  let score = 0;
  const lowerPath = filePath.toLowerCase();
  const symbol = symbolName.toLowerCase();

  for (const pattern of EXCLUDE_PATHS) {
    if (lowerPath.includes(pattern.toLowerCase())) {
      return -10000;
    }
  }

  for (const pattern of DEPRIORITIZE_PATHS) {
    if (lowerPath.includes(pattern.toLowerCase())) {
      score -= 50;
    }
  }

  for (const pattern of PRIORITIZE_PATHS) {
    if (lowerPath.includes(pattern.toLowerCase())) {
      score += 30;
    }
  }

  const symbolParts = symbol.split(/[:_]/).filter((part) => part.length > 3);
  for (const part of symbolParts) {
    if (lowerPath.includes(part)) {
      score += 20;
    }
  }

  if (
    lowerPath.endsWith('.cc') ||
    lowerPath.endsWith('.cpp') ||
    lowerPath.endsWith('.c')
  ) {
    score += 10;
  }

  return score;
}

export function extractCalls(code: string, excludeFn: string): string[] {
  const calls = new Set<string>();
  const excludeName = excludeFn.split('::').pop() || excludeFn;

  const directPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = directPattern.exec(code)) !== null) {
    const name = match[1];
    if (isValidCall(name, excludeName)) {
      calls.add(name);
    }
  }

  const methodPattern = /\w+\s*(?:->|\.)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  while ((match = methodPattern.exec(code)) !== null) {
    const name = match[1];
    if (isValidCall(name, excludeName)) {
      calls.add(name);
    }
  }

  const qualifiedPattern =
    /([a-zA-Z_][\w]*)::\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  while ((match = qualifiedPattern.exec(code)) !== null) {
    const ns = match[1];
    const name = match[2];
    if (
      ns === 'std' ||
      ns === 'boost' ||
      ns === 'smdb_enum' ||
      ns === 'smdb_type'
    ) {
      continue;
    }
    if (isValidCall(name, excludeName)) {
      calls.add(name);
      calls.add(`${ns}::${name}`);
    }
  }

  return Array.from(calls).slice(0, AGENT_CONFIG.maxCallees);
}

function isValidCall(name: string, excludeName: string): boolean {
  return (
    !CALL_SKIP_LIST.has(name) &&
    !name.startsWith('_') &&
    name.length > 2 &&
    name !== excludeName
  );
}

export function inferKind(lineText: string): string {
  const lower = lineText.toLowerCase();
  if (lower.includes('class ')) {
    return 'class';
  }
  if (lower.includes('struct ')) {
    return 'struct';
  }
  if (lower.includes('#define ')) {
    return 'macro';
  }
  if (lower.includes('enum ')) {
    return 'enum';
  }
  if (lower.includes('typedef ')) {
    return 'typedef';
  }
  if (lower.includes('(') && lower.includes(')')) {
    return 'function';
  }
  return 'unknown';
}
