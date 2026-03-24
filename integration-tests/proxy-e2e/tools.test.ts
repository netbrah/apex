/**
 * Tool execution tests: verify that tool calls work through the proxy
 * for both GPT and Claude models via the Responses API.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  runProxy,
  DEFAULT_GPT_MODEL,
  DEFAULT_CLAUDE_MODEL,
} from './helpers/proxy-rig.js';

let testDir: string;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-tools-'));
});

describe('Proxy Tool Execution', () => {
  it('GPT reads a file via tool call', async () => {
    const filePath = path.join(testDir, 'test.txt');
    fs.writeFileSync(filePath, 'The secret number is 42.');

    const result = await runProxy(
      `Read the file at ${filePath} and tell me what the secret number is. Just say the number.`,
      DEFAULT_GPT_MODEL,
    );
    expect(result.isError).toBe(false);
    expect(result.response).toContain('42');
  }, 90_000);

  it('GPT runs a shell command', async () => {
    const result = await runProxy(
      'Run the command "echo PROXY_TEST_OK" in the shell and tell me what it printed. Just repeat the output.',
      DEFAULT_GPT_MODEL,
    );
    expect(result.isError).toBe(false);
    expect(result.response).toContain('PROXY_TEST_OK');
  }, 90_000);

  it('GPT writes a file via tool call', async () => {
    const filePath = path.join(testDir, 'output.txt');

    const result = await runProxy(
      `Create a file at ${filePath} containing exactly the text "hello from proxy test". Do not include anything else in the file.`,
      DEFAULT_GPT_MODEL,
    );
    expect(result.isError).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('hello from proxy test');
  }, 90_000);

  it('Claude reads a file via tool call (Vertex AI)', async () => {
    const filePath = path.join(testDir, 'claude-test.txt');
    fs.writeFileSync(filePath, 'The password is banana.');

    const result = await runProxy(
      `Read the file at ${filePath} and tell me what the password is. Just say the word.`,
      DEFAULT_CLAUDE_MODEL,
    );
    expect(result.isError).toBe(false);
    expect(result.response.toLowerCase()).toContain('banana');
  }, 90_000);

  it('GPT performs grep search', async () => {
    const result = await runProxy(
      'First, create three files in the current directory: a.txt containing "apples are red", b.txt containing "bananas are yellow", c.txt containing "cherries are red". Then search for files containing the word "red" and list only the filenames.',
      DEFAULT_GPT_MODEL,
    );
    expect(result.isError).toBe(false);
    expect(result.response).toContain('a.txt');
    expect(result.response).toContain('c.txt');
  }, 120_000);
});
