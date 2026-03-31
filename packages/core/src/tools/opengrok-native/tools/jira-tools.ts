/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * Jira Tools — native wrappers for search_jira and get_jira_issue.
 *
 * Delegates directly to the vendored jira-client lib for REST API calls.
 */

import { createTool } from '../lib/mastra-tool-shim.js';
import { z } from '../lib/zod-shim.js';
import {
  jiraFetchJSON,
  isJiraConfigured,
  isJiraError,
} from '../lib/jira-client.js';
import { TOOL_DESCRIPTIONS } from '../prompts/index.js';
import { logTool } from '../lib/logger.js';

// ============================================================================
// Helpers
// ============================================================================

function buildJql(params: Record<string, unknown>): string {
  if (params.jql && typeof params.jql === 'string') {
    return params.jql;
  }

  const clauses: string[] = [];

  if (params.project) clauses.push(`project = "${params.project}"`);
  if (params.text) clauses.push(`text ~ "${params.text}"`);

  const arrayOrString = (v: unknown): string[] => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return [v];
    return [];
  };

  const statusValues = arrayOrString(params.status);
  if (statusValues.length === 1) {
    clauses.push(`status = "${statusValues[0]}"`);
  } else if (statusValues.length > 1) {
    clauses.push(`status IN (${statusValues.map((s) => `"${s}"`).join(', ')})`);
  }

  if (params.assignee) clauses.push(`assignee = "${params.assignee}"`);
  if (params.reporter) clauses.push(`reporter = "${params.reporter}"`);

  const componentValues = arrayOrString(params.component);
  if (componentValues.length === 1) {
    clauses.push(`component = "${componentValues[0]}"`);
  } else if (componentValues.length > 1) {
    clauses.push(
      `component IN (${componentValues.map((c) => `"${c}"`).join(', ')})`,
    );
  }

  const priorityValues = arrayOrString(params.priority);
  if (priorityValues.length === 1) {
    clauses.push(`priority = "${priorityValues[0]}"`);
  } else if (priorityValues.length > 1) {
    clauses.push(
      `priority IN (${priorityValues.map((p) => `"${p}"`).join(', ')})`,
    );
  }

  if (params.issueType) clauses.push(`issuetype = "${params.issueType}"`);

  if (params.resolution) {
    if (params.resolution === 'EMPTY') {
      clauses.push('resolution = EMPTY');
    } else {
      clauses.push(`resolution = "${params.resolution}"`);
    }
  }

  const labelValues = arrayOrString(params.labels);
  if (labelValues.length === 1) {
    clauses.push(`labels = "${labelValues[0]}"`);
  } else if (labelValues.length > 1) {
    clauses.push(`labels IN (${labelValues.map((l) => `"${l}"`).join(', ')})`);
  }

  if (params.fixVersion) clauses.push(`fixVersion = "${params.fixVersion}"`);
  if (params.createdAfter) clauses.push(`created >= "${params.createdAfter}"`);
  if (params.updatedAfter) clauses.push(`updated >= "${params.updatedAfter}"`);

  const jql = clauses.join(' AND ');
  const orderBy =
    typeof params.orderBy === 'string'
      ? ` ORDER BY ${params.orderBy}`
      : ' ORDER BY updated DESC';

  return jql + orderBy;
}

function formatIssue(issue: any): Record<string, unknown> {
  const fields = issue.fields || {};
  return {
    key: issue.key,
    summary: fields.summary || '',
    status: fields.status?.name || '',
    priority: fields.priority?.name || '',
    assignee: fields.assignee?.displayName || fields.assignee?.name || '',
    reporter: fields.reporter?.displayName || fields.reporter?.name || '',
    created: fields.created || '',
    updated: fields.updated || '',
    components: (fields.components || []).map((c: any) => c.name),
    fixVersions: (fields.fixVersions || []).map((v: any) => v.name),
    labels: fields.labels || [],
    url: `https://jira.ngage.netapp.com/browse/${issue.key}`,
  };
}

function formatIssueDetailed(issue: any): Record<string, unknown> {
  const fields = issue.fields || {};
  const comments = (fields.comment?.comments || []).map((c: any) => ({
    author: c.author?.displayName || c.author?.name || '',
    body: c.body || '',
    created: c.created || '',
    updated: c.updated || '',
  }));

  return {
    key: issue.key,
    summary: fields.summary || '',
    description: fields.description || '',
    status: fields.status?.name || '',
    priority: fields.priority?.name || '',
    issueType: fields.issuetype?.name || '',
    assignee: fields.assignee?.displayName || fields.assignee?.name || '',
    reporter: fields.reporter?.displayName || fields.reporter?.name || '',
    created: fields.created || '',
    updated: fields.updated || '',
    resolution: fields.resolution?.name || '',
    resolutionDate: fields.resolutiondate || '',
    components: (fields.components || []).map((c: any) => c.name),
    fixVersions: (fields.fixVersions || []).map((v: any) => v.name),
    labels: fields.labels || [],
    comments,
    url: `https://jira.ngage.netapp.com/browse/${issue.key}`,
  };
}

// ============================================================================
// Tool: search_jira
// ============================================================================

const searchJiraTool = createTool({
  id: 'search_jira',
  description: TOOL_DESCRIPTIONS.search_jira,

  inputSchema: z.object({
    jql: z.string().optional().describe('Raw JQL query string.'),
    project: z
      .string()
      .optional()
      .describe("Project key (e.g., 'CONTAP', 'BURT')"),
    text: z
      .string()
      .optional()
      .describe('Full-text search across summary + description + comments'),
    status: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Status filter'),
    assignee: z.string().optional().describe('Assignee username'),
    reporter: z.string().optional().describe('Reporter username'),
    component: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Component name(s)'),
    priority: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Priority level(s)'),
    issueType: z.string().optional().describe('Issue type'),
    resolution: z.string().optional().describe('Resolution'),
    labels: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Label(s)'),
    fixVersion: z.string().optional().describe('Fix version name'),
    createdAfter: z
      .string()
      .optional()
      .describe('Created after date (YYYY-MM-DD)'),
    updatedAfter: z
      .string()
      .optional()
      .describe('Updated after date (YYYY-MM-DD)'),
    orderBy: z.string().optional().describe('ORDER BY clause'),
    limit: z.number().optional().describe('Max results (default 20)'),
  }),

  execute: async (input) => {
    const invocationId = logTool.start('search_jira', input);

    if (!isJiraConfigured()) {
      const msg =
        'JIRA_TOKEN not set. Set it to your Jira personal access token.';
      logTool.end(invocationId, { success: false, error: msg });
      return { success: false, error: msg };
    }

    try {
      const jql = buildJql(input);
      const limit = input.limit || 20;
      const params = new URLSearchParams({
        jql,
        maxResults: String(limit),
        fields:
          'summary,status,priority,assignee,reporter,created,updated,components,fixVersions,labels',
      });

      logTool.step('search_jira', 'executing JQL', { jql, limit });

      const result = await jiraFetchJSON(`/search?${params.toString()}`);

      if (isJiraError(result)) {
        logTool.end(invocationId, {
          success: false,
          error: result.message,
        });
        return { success: false, error: result.message };
      }

      const issues = (result.issues || []).map(formatIssue);

      logTool.end(invocationId, {
        success: true,
        count: issues.length,
        total: result.total,
      });

      return {
        success: true,
        issues,
        total: result.total || issues.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logTool.end(invocationId, { success: false, error: message });
      return { success: false, error: message };
    }
  },
});

// ============================================================================
// Tool: get_jira_issue
// ============================================================================

const getJiraIssueTool = createTool({
  id: 'get_jira_issue',
  description: TOOL_DESCRIPTIONS.get_jira_issue,

  inputSchema: z.object({
    issue_key: z
      .string()
      .describe("Jira issue key (e.g., 'BURT-123456', 'CONTAP-600293')"),
  }),

  execute: async (input) => {
    const invocationId = logTool.start('get_jira_issue', input);

    if (!isJiraConfigured()) {
      const msg =
        'JIRA_TOKEN not set. Set it to your Jira personal access token.';
      logTool.end(invocationId, { success: false, error: msg });
      return { success: false, error: msg };
    }

    try {
      const issueKey = input.issue_key;
      logTool.step('get_jira_issue', 'fetching issue', { issueKey });

      const result = await jiraFetchJSON(
        `/issue/${encodeURIComponent(issueKey)}?expand=renderedFields&fields=summary,description,status,priority,issuetype,assignee,reporter,created,updated,resolution,resolutiondate,components,fixVersions,labels,comment`,
      );

      if (isJiraError(result)) {
        logTool.end(invocationId, {
          success: false,
          error: result.message,
        });
        return { success: false, error: result.message };
      }

      const issue = formatIssueDetailed(result);

      logTool.end(invocationId, { success: true, key: issueKey });

      return { success: true, ...issue };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logTool.end(invocationId, { success: false, error: message });
      return { success: false, error: message };
    }
  },
});

// ============================================================================
// Factory
// ============================================================================

export function createJiraTools() {
  return {
    search_jira: searchJiraTool,
    get_jira_issue: getJiraIssueTool,
  };
}
