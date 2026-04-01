/**
 * Test helper for running Apex CLI headless against any OpenAI-compatible proxy.
 *
 * All configuration is env-var driven — no corp URLs hardcoded:
 *   OPENAI_API_KEY, OPENAI_BASE_URL, PROXY_GPT_MODEL, PROXY_CLAUDE_MODEL
 */
import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ───── Public types ─────

export interface ProxyRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  events: ProxyEvent[];
  response: string;
  toolCalls: ToolCallEvent[];
  durationMs: number;
  isError: boolean;
  usage: { input_tokens: number; output_tokens: number };
}

export interface ProxyEvent {
  type: string;
  [key: string]: unknown;
}

export interface ToolCallEvent {
  name: string;
  args: Record<string, unknown>;
  result?: string;
}

// ───── Configuration ─────

const PROXY_URL = process.env['OPENAI_BASE_URL'] ?? '';
const PROXY_KEY = process.env['OPENAI_API_KEY'] ?? '';

export function isProxyConfigured(): boolean {
  return PROXY_URL.length > 0 && PROXY_KEY.length > 0;
}

export const DEFAULT_GPT_MODEL =
  process.env['PROXY_GPT_MODEL'] ?? 'gpt-4.1-mini';
export const DEFAULT_CLAUDE_MODEL =
  process.env['PROXY_CLAUDE_MODEL'] ?? 'claude-sonnet-4.6';

// ───── Auth type helpers ─────

export type AuthWire = 'openai-responses' | 'anthropic' | 'openai';

/** Get the default auth wire for a model name. */
export function authWireForModel(model: string): AuthWire {
  if (model.startsWith('claude')) return 'openai-responses'; // Claude via proxy
  return 'openai-responses';
}

// ───── Internal helpers ─────

interface CliInvocation {
  command: string;
  argsPrefix: string[];
}

function resolveCaBundlePath(): string | undefined {
  const envPath = process.env['NODE_EXTRA_CA_CERTS'];
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    path.join(os.homedir(), '.apex', 'ca-bundle.pem'),
    '/etc/pki/tls/certs/ca-bundle.crt',
    '/etc/ssl/certs/ca-certificates.crt',
  ];
  return candidates.find((c) => fs.existsSync(c));
}

function getCliInvocation(): CliInvocation {
  // 1. Explicit override via env var
  const explicit = process.env['APEX_BINARY'];
  if (explicit?.trim()) return { command: explicit, argsPrefix: [] };

  // 2. Integration test global setup provides this
  const testCliPath = process.env['TEST_CLI_PATH'];
  if (testCliPath && fs.existsSync(testCliPath)) {
    return { command: process.execPath, argsPrefix: [testCliPath] };
  }

  // 3. Auto-resolve: bundled release binary at repo_root/dist/cli.js
  const repoRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../..',
  );
  const bundledCli = path.join(repoRoot, 'dist', 'cli.js');
  if (fs.existsSync(bundledCli)) {
    return { command: process.execPath, argsPrefix: [bundledCli] };
  }

  // 4. Fallback: globally installed apex binary
  return { command: 'apex', argsPrefix: [] };
}

// ───── Event parsing ─────

function parseEvents(stdout: string): {
  events: ProxyEvent[];
  response: string;
  toolCalls: ToolCallEvent[];
  durationMs: number;
  isError: boolean;
  usage: { input_tokens: number; output_tokens: number };
} {
  let events: ProxyEvent[] = [];
  let response = '';
  let durationMs = 0;
  let isError = false;
  let usage = { input_tokens: 0, output_tokens: 0 };
  const toolCalls: ToolCallEvent[] = [];

  try {
    events = JSON.parse(stdout) as ProxyEvent[];
    for (const evt of events) {
      if (evt.type === 'assistant') {
        const msg = (evt as Record<string, unknown>).message as Record<
          string,
          unknown
        >;
        const content = msg?.content as Array<{ type: string; text: string }>;
        if (content) {
          for (const c of content) {
            if (c.type === 'text') response += c.text;
          }
        }
      }
      if (evt.type === 'tool_use' || evt.type === 'tool_call') {
        const tc = evt as Record<string, unknown>;
        toolCalls.push({
          name: (tc.name as string) ?? (tc.tool_name as string) ?? '',
          args: (tc.arguments as Record<string, unknown>) ??
            (tc.args as Record<string, unknown>) ?? {},
          result: tc.result as string | undefined,
        });
      }
      if (evt.type === 'result') {
        durationMs =
          ((evt as Record<string, unknown>).duration_ms as number) ?? 0;
        isError =
          ((evt as Record<string, unknown>).is_error as boolean) ?? false;
        usage =
          ((evt as Record<string, unknown>).usage as typeof usage) ?? usage;
      }
    }
  } catch {
    response = stdout;
  }

  return { events, response, toolCalls, durationMs, isError, usage };
}

// ───── Main runner ─────

export interface RunProxyOptions {
  prompt: string;
  model?: string;
  authType?: AuthWire;
  extraFlags?: string[];
  timeoutMs?: number;
  /** Pre-create files in the working directory. key=filename, value=content */
  files?: Record<string, string>;
  /** Custom working directory (default: fresh tmpdir) */
  cwd?: string;
}

export async function runProxy(
  promptOrOpts: string | RunProxyOptions,
  model?: string,
  extraFlags: string[] = [],
  timeoutMs: number = 120_000,
): Promise<ProxyRunResult> {
  // Support both legacy positional and options-object calling conventions
  const opts: RunProxyOptions =
    typeof promptOrOpts === 'string'
      ? { prompt: promptOrOpts, model, extraFlags, timeoutMs }
      : promptOrOpts;

  const resolvedModel = opts.model ?? DEFAULT_GPT_MODEL;
  const resolvedAuth = opts.authType ?? authWireForModel(resolvedModel);
  const resolvedTimeout = opts.timeoutMs ?? 120_000;
  const resolvedFlags = opts.extraFlags ?? [];

  const tmpDir =
    opts.cwd ?? fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-e2e-'));
  const shouldCleanup = !opts.cwd;

  // Seed files
  if (opts.files) {
    for (const [name, content] of Object.entries(opts.files)) {
      const fp = path.join(tmpDir, name);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, content);
    }
  }

  const caBundlePath = resolveCaBundlePath();
  const { command, argsPrefix } = getCliInvocation();

  return new Promise<ProxyRunResult>((resolve) => {
    const args = [
      ...argsPrefix,
      '--auth-type',
      resolvedAuth,
      '--model',
      resolvedModel,
      '-p',
      opts.prompt,
      '--yolo',
      '--output-format',
      'json',
      '--no-chat-recording',
      ...resolvedFlags,
    ];

    execFile(
      command,
      args,
      {
        cwd: tmpDir,
        timeout: resolvedTimeout,
        env: {
          ...process.env,
          OPENAI_API_KEY: PROXY_KEY,
          OPENAI_BASE_URL: PROXY_URL,
          HOME: os.homedir(),
          PATH: process.env['PATH'],
          ...(caBundlePath ? { NODE_EXTRA_CA_CERTS: caBundlePath } : {}),
        },
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const parsed = parseEvents(stdout);

        resolve({
          stdout,
          stderr,
          exitCode: error?.code ? Number(error.code) : 0,
          ...parsed,
        });

        if (shouldCleanup) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    );
  });
}
