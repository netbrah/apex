/* eslint-disable */
// @ts-nocheck
/**
 * Jira REST API Client for vendored OpenGrok-native tools.
 *
 * Adapted from opengrokmcp/src/lib/jira-client.ts
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

const JIRA_DEFAULTS = { baseUrl: 'https://jira.ngage.netapp.com' } as const;

function getJiraBaseUrl(): string {
  return (process.env.JIRA_BASE_URL || JIRA_DEFAULTS.baseUrl).replace(
    /\/+$/,
    '',
  );
}

function getJiraToken(): string | undefined {
  return process.env.JIRA_TOKEN;
}

export function isJiraConfigured(): boolean {
  return !!getJiraToken();
}

export interface JiraErrorResult {
  _jiraError: true;
  statusCode: number;
  message: string;
}

export function isJiraError(val: unknown): val is JiraErrorResult {
  return (
    val != null && typeof val === 'object' && (val as any)._jiraError === true
  );
}

export function jiraFetchJSON(
  apiPath: string,
  timeoutMs = 30000,
): Promise<any> {
  const jiraToken = getJiraToken();
  if (!jiraToken) {
    return Promise.resolve({
      _jiraError: true,
      statusCode: 0,
      message: 'JIRA_TOKEN not set. Set it to your Jira personal access token.',
    } as JiraErrorResult);
  }

  const baseUrl = getJiraBaseUrl();
  const fullPath = apiPath.startsWith('/rest/')
    ? apiPath
    : `/rest/api/2${apiPath}`;
  const url = new URL(`${baseUrl}${fullPath}`);
  const isHttps = url.protocol === 'https:';
  const ca = isHttps ? getCorporateCa() : undefined;

  return new Promise((resolve) => {
    const proxyAgent = isHttps ? getProxyAgent(url.hostname) : undefined;
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jiraToken}`,
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
              _jiraError: true,
              statusCode: 200,
              message: 'Invalid JSON response from Jira',
            } as JiraErrorResult);
          }
        } else {
          const statusCode = res.statusCode || 0;
          let message = `Jira API returned HTTP ${statusCode}`;
          if (statusCode === 401)
            message = 'Jira authentication failed (HTTP 401).';
          else if (statusCode === 403)
            message = 'Jira access denied (HTTP 403).';
          else if (statusCode === 404)
            message = 'Issue not found in Jira (HTTP 404).';
          else if (statusCode >= 500)
            message = `Jira server error (HTTP ${statusCode}).`;
          resolve({ _jiraError: true, statusCode, message } as JiraErrorResult);
        }
      });
    });
    req.on('error', (err) =>
      resolve({
        _jiraError: true,
        statusCode: 0,
        message: `Network error: ${err.message}`,
      } as JiraErrorResult),
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({
        _jiraError: true,
        statusCode: 0,
        message: `Request timed out after ${timeoutMs}ms`,
      } as JiraErrorResult);
    });
    req.end();
  });
}
