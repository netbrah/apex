/* eslint-disable */
// @ts-nocheck
/**
 * Private CLI REST API Mapper for vendored OpenGrok-native tools.
 *
 * Adapted from opengrokmcp/src/lib/cli-rest-mapper.ts
 */

export interface PrivateCliEndpoint {
  cliCommand: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  queryParams?: string[];
  isDebugTable?: boolean;
  tableName?: string;
}

const CLI_VERB_MAP: Record<string, { method: string; removeVerb: boolean }> = {
  show: { method: 'GET', removeVerb: true },
  create: { method: 'POST', removeVerb: true },
  modify: { method: 'PATCH', removeVerb: true },
  delete: { method: 'DELETE', removeVerb: true },
};

export function cliToPrivateRest(cliCommand: string): PrivateCliEndpoint {
  const parts = cliCommand.trim().split(/\s+/);
  const lastPart = parts[parts.length - 1];
  let method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'POST';
  let pathParts = [...parts];
  if (CLI_VERB_MAP[lastPart]) {
    method = CLI_VERB_MAP[lastPart].method as typeof method;
    if (CLI_VERB_MAP[lastPart].removeVerb) pathParts = pathParts.slice(0, -1);
  } else if (lastPart.startsWith('show-')) {
    method = 'GET';
    pathParts[pathParts.length - 1] = lastPart.replace('show-', '');
  } else if (lastPart === 'delete-all') {
    method = 'DELETE';
    pathParts[pathParts.length - 1] = 'all';
  }
  const path = '/api/private/cli/' + pathParts.join('/');
  return {
    cliCommand,
    method,
    path,
    description: `Private CLI: ${cliCommand}`,
  };
}

export function debugTableToPrivateRest(
  tableName: string,
  fields?: string[],
): PrivateCliEndpoint {
  return {
    cliCommand: `debug smdb table ${tableName} show`,
    method: 'GET',
    path: `/api/private/cli/debug/smdb/table/${tableName}`,
    description: `Debug table access: ${tableName}`,
    queryParams: fields ? ['fields', 'node', 'vserver'] : undefined,
    isDebugTable: true,
    tableName,
  };
}

export function generateCurlExample(
  endpoint: PrivateCliEndpoint,
  clusterIp: string = '<mgmt-ip>',
  fields?: string[],
): string {
  const auth = "-u admin:<password> -k --noproxy '*'";
  let url = `https://${clusterIp}${endpoint.path}`;
  if (fields?.length) url += `?fields=${fields.join(',')}`;
  return `curl ${auth} \\\n  -X ${endpoint.method} "${url}"`;
}
