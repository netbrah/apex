/**
 * Test helper for running qwen-code headless against the NetApp LLM proxy.
 */
import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface ProxyRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  events: ProxyEvent[];
  response: string;
  durationMs: number;
  isError: boolean;
  usage: { input_tokens: number; output_tokens: number };
}

export interface ProxyEvent {
  type: string;
  [key: string]: unknown;
}

const PROXY_URL = process.env['OPENAI_BASE_URL'] ?? '';
const PROXY_KEY = process.env['OPENAI_API_KEY'] ?? '';

export const DEFAULT_GPT_MODEL =
  process.env['PROXY_GPT_MODEL'] ?? 'gpt-4.1-mini';
export const DEFAULT_CLAUDE_MODEL =
  process.env['PROXY_CLAUDE_MODEL'] ?? 'claude-sonnet-4.6';

interface CliInvocation {
  command: string;
  argsPrefix: string[];
}

function resolveCaBundlePath(): string | undefined {
  const envPath = process.env['NODE_EXTRA_CA_CERTS'];
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const candidates = [
    path.join(os.homedir(), '.apex', 'ca-bundle.pem'),
    '/etc/pki/tls/certs/ca-bundle.crt',
    '/etc/ssl/certs/ca-certificates.crt',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function getCliInvocation(): CliInvocation {
  const explicitBinary = process.env['QWEN_BINARY'];
  if (explicitBinary && explicitBinary.trim().length > 0) {
    return { command: explicitBinary, argsPrefix: [] };
  }

  // Integration test global setup provides this path to the locally built CLI.
  const testCliPath = process.env['TEST_CLI_PATH'];
  if (testCliPath && fs.existsSync(testCliPath)) {
    return {
      command: process.execPath,
      argsPrefix: [testCliPath],
    };
  }

  // Fallback for environments running the globally installed binary.
  return { command: 'qwen', argsPrefix: [] };
}

export async function runProxy(
  prompt: string,
  model: string = DEFAULT_GPT_MODEL,
  extraFlags: string[] = [],
  timeoutMs: number = 120_000,
): Promise<ProxyRunResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-e2e-'));
  const caBundlePath = resolveCaBundlePath();
  const { command, argsPrefix } = getCliInvocation();

  return new Promise<ProxyRunResult>((resolve) => {
    const args = [
      ...argsPrefix,
      '--auth-type',
      'openai-responses',
      '--model',
      model,
      '-p',
      prompt,
      '--yolo',
      '--output-format',
      'json',
      '--no-chat-recording',
      ...extraFlags,
    ];

    const _child = execFile(
      command,
      args,
      {
        cwd: tmpDir,
        timeout: timeoutMs,
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
        let events: ProxyEvent[] = [];
        let response = '';
        let durationMs = 0;
        let isError = false;
        let usage = { input_tokens: 0, output_tokens: 0 };

        try {
          events = JSON.parse(stdout) as ProxyEvent[];
          for (const evt of events) {
            if (evt.type === 'assistant') {
              const content = (
                (evt as Record<string, unknown>).message as Record<
                  string,
                  unknown
                >
              )?.content as Array<{ type: string; text: string }>;
              if (content) {
                for (const c of content) {
                  if (c.type === 'text') response += c.text;
                }
              }
            }
            if (evt.type === 'result') {
              durationMs =
                ((evt as Record<string, unknown>).duration_ms as number) ?? 0;
              isError =
                ((evt as Record<string, unknown>).is_error as boolean) ?? false;
              usage =
                ((evt as Record<string, unknown>).usage as typeof usage) ??
                usage;
            }
          }
        } catch {
          response = stdout;
        }

        resolve({
          stdout,
          stderr,
          exitCode: error?.code ? Number(error.code) : 0,
          events,
          response,
          durationMs,
          isError,
          usage,
        });

        fs.rmSync(tmpDir, { recursive: true, force: true });
      },
    );
  });
}
