/* eslint-disable */
// @ts-nocheck
/**
 * Confluence REST API Client for vendored OpenGrok-native tools.
 *
 * Adapted from opengrokmcp/src/lib/confluence-client.ts
 */

import https from 'https';
import http from 'http';
import tls from 'tls';
import { getCorporateCa } from './corporate-ca.js';

function getProxyAgent(hostname: string): any {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (!proxyUrl) return undefined;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || '';
  if (noProxy) {
    const exclusions = noProxy.split(',').map((s) => s.trim().toLowerCase());
    const host = hostname.toLowerCase();
    for (const entry of exclusions) {
      if (!entry) continue;
      if (
        host === entry ||
        host.endsWith(entry.startsWith('.') ? entry : `.${entry}`)
      )
        return undefined;
    }
  }
  try {
    new URL(proxyUrl);
  } catch {
    return undefined;
  }
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return new HttpsProxyAgent(proxyUrl);
  } catch {
    return undefined;
  }
}

const CONFLUENCE_DEFAULTS = {
  baseUrl: 'https://netapp.atlassian.net/wiki',
  email: 'dinesh.palanisamy@netapp.com',
} as const;

function getConfluenceBaseUrl(): string {
  return (
    process.env.CONFLUENCE_BASE_URL || CONFLUENCE_DEFAULTS.baseUrl
  ).replace(/\/+$/, '');
}

function getConfluenceEmail(): string {
  return process.env.CONFLUENCE_EMAIL || CONFLUENCE_DEFAULTS.email;
}

function getConfluenceApiToken(): string | undefined {
  return process.env.CONFLUENCE_TOKEN;
}

export function isConfluenceConfigured(): boolean {
  return !!getConfluenceApiToken();
}

export interface ConfluenceErrorResult {
  _confluenceError: true;
  statusCode: number;
  message: string;
}

export function isConfluenceError(val: unknown): val is ConfluenceErrorResult {
  return (
    val != null &&
    typeof val === 'object' &&
    (val as any)._confluenceError === true
  );
}

export function confluenceFetchJSON(
  apiPath: string,
  timeoutMs = 30000,
): Promise<any> {
  const apiToken = getConfluenceApiToken();
  if (!apiToken) {
    return Promise.resolve({
      _confluenceError: true,
      statusCode: 0,
      message: 'CONFLUENCE_TOKEN not set.',
    } as ConfluenceErrorResult);
  }

  const baseUrl = getConfluenceBaseUrl();
  const fullPath = apiPath.startsWith('/rest/')
    ? apiPath
    : `/rest/api${apiPath}`;
  const url = new URL(`${baseUrl}${fullPath}`);
  const isHttps = url.protocol === 'https:';
  const ca = isHttps ? getCorporateCa() : undefined;

  const email = getConfluenceEmail();
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');

  return new Promise((resolve) => {
    const proxyAgent = isHttps ? getProxyAgent(url.hostname) : undefined;
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(proxyAgent ? { agent: proxyAgent } : {}),
    };
    if (ca) (options as any).ca = [...tls.rootCertificates, ca.toString()];

    const transport = isHttps ? https : http;
    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({
              _confluenceError: true,
              statusCode: 200,
              message: 'Invalid JSON response',
            } as ConfluenceErrorResult);
          }
        } else {
          const statusCode = res.statusCode || 0;
          let message = `Confluence API returned HTTP ${statusCode}`;
          if (statusCode === 401)
            message = 'Confluence authentication failed (HTTP 401).';
          else if (statusCode === 403)
            message = 'Confluence access denied (HTTP 403).';
          else if (statusCode === 404)
            message = 'Page not found in Confluence (HTTP 404).';
          else if (statusCode >= 500)
            message = `Confluence server error (HTTP ${statusCode}).`;
          resolve({
            _confluenceError: true,
            statusCode,
            message,
          } as ConfluenceErrorResult);
        }
      });
    });
    req.on('error', (err) =>
      resolve({
        _confluenceError: true,
        statusCode: 0,
        message: `Network error: ${err.message}`,
      } as ConfluenceErrorResult),
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({
        _confluenceError: true,
        statusCode: 0,
        message: `Request timed out after ${timeoutMs}ms`,
      } as ConfluenceErrorResult);
    });
    req.end();
  });
}

export interface ConfluencePageData {
  id: string;
  title: string;
  spaceKey: string;
  url: string;
  html: string;
  version: number;
  lastModified?: string;
  lastModifiedBy?: string;
}

export async function getConfluencePage(
  pageId: string,
  options?: { expand?: string[] },
): Promise<ConfluencePageData | ConfluenceErrorResult> {
  const expand =
    options?.expand?.join(',') ||
    'body.storage,version,space,history.lastUpdated';
  const result = await confluenceFetchJSON(
    `/content/${encodeURIComponent(pageId)}?expand=${encodeURIComponent(expand)}`,
  );
  if (isConfluenceError(result)) return result;
  const baseUrl = getConfluenceBaseUrl();
  return {
    id: result.id ?? pageId,
    title: result.title ?? 'Untitled',
    spaceKey: result.space?.key ?? '',
    url: `${baseUrl}${result._links?.webui || ''}`,
    html: result.body?.storage?.value ?? '',
    version: result.version?.number ?? 0,
    lastModified: result.history?.lastUpdated?.when ?? undefined,
    lastModifiedBy: result.history?.lastUpdated?.by?.displayName ?? undefined,
  };
}

export interface ConfluenceSearchItem {
  id: string;
  title: string;
  url: string;
  spaceKey: string;
  bodyHtml?: string;
  lastModified?: string;
}

export async function searchConfluence(
  cql: string,
  options?: { limit?: number; expand?: string[] },
): Promise<ConfluenceSearchItem[] | ConfluenceErrorResult> {
  const limit = options?.limit || 10;
  const expand = options?.expand?.join(',') || 'body.storage,version,space';
  const params = new URLSearchParams({ cql, limit: String(limit), expand });
  const result = await confluenceFetchJSON(
    `/content/search?${params.toString()}`,
  );
  if (isConfluenceError(result)) return result;
  const results: any[] = result.results ?? [];
  const baseUrl = getConfluenceBaseUrl();
  return results.map((r: any) => ({
    id: String(r.id ?? ''),
    title: r.title ?? 'Untitled',
    url: r._links?.webui
      ? `${baseUrl}${r._links.webui}`
      : `${baseUrl}/pages/viewpage.action?pageId=${r.id}`,
    spaceKey: r.space?.key ?? '',
    bodyHtml: r.body?.storage?.value ?? undefined,
    lastModified: r.version?.when ?? undefined,
  }));
}
