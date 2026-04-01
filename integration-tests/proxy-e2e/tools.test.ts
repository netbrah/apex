/**
 * Tool execution tests: verify that tool calls work through the proxy
 * for both GPT and Claude models via the Responses API.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  runProxy,
  DEFAULT_GPT_MODEL,
  DEFAULT_CLAUDE_MODEL,
  isProxyConfigured,
} from './helpers/proxy-rig.js';

const skip = !isProxyConfigured();

describe('Proxy Tool Execution', () => {
  // ───── GPT Tool Tests ─────

  it.skipIf(skip)(
    'GPT reads a file via tool call',
    async () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-tools-'));
      const filePath = path.join(testDir, 'test.txt');
      fs.writeFileSync(filePath, 'The secret number is 42.');

      const result = await runProxy(
        `Read the file at ${filePath} and tell me what the secret number is. Just say the number.`,
        DEFAULT_GPT_MODEL,
      );
      expect(result.isError).toBe(false);
      expect(result.response).toContain('42');
      fs.rmSync(testDir, { recursive: true, force: true });
    },
    90_000,
  );

  it.skipIf(skip)(
    'GPT runs a shell command',
    async () => {
      const result = await runProxy(
        'Run the command "echo PROXY_TEST_OK" in the shell and tell me what it printed. Just repeat the output.',
        DEFAULT_GPT_MODEL,
      );
      expect(result.isError).toBe(false);
      expect(result.response).toContain('PROXY_TEST_OK');
    },
    90_000,
  );

  it.skipIf(skip)(
    'GPT writes a file via tool call',
    async () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-tools-'));
      const filePath = path.join(testDir, 'output.txt');

      const result = await runProxy(
        `Create a file at ${filePath} containing exactly the text "hello from proxy test". Do not include anything else in the file.`,
        DEFAULT_GPT_MODEL,
      );
      expect(result.isError).toBe(false);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('hello from proxy test');
      fs.rmSync(testDir, { recursive: true, force: true });
    },
    90_000,
  );

  it.skipIf(skip)(
    'GPT performs grep search',
    async () => {
      const result = await runProxy(
        'First, create three files in the current directory: a.txt containing "apples are red", b.txt containing "bananas are yellow", c.txt containing "cherries are red". Then search for files containing the word "red" and list only the filenames.',
        DEFAULT_GPT_MODEL,
      );
      expect(result.isError).toBe(false);
      expect(result.response).toContain('a.txt');
      expect(result.response).toContain('c.txt');
    },
    120_000,
  );

  it.skipIf(skip)(
    'GPT reads multiple files in sequence',
    async () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-tools-'));
      fs.writeFileSync(path.join(testDir, 'first.txt'), 'alpha');
      fs.writeFileSync(path.join(testDir, 'second.txt'), 'bravo');

      const result = await runProxy({
        prompt: `Read both files first.txt and second.txt in ${testDir} and tell me the contents of each. Format: "first: <content>, second: <content>"`,
        model: DEFAULT_GPT_MODEL,
      });
      expect(result.isError).toBe(false);
      expect(result.response.toLowerCase()).toContain('alpha');
      expect(result.response.toLowerCase()).toContain('bravo');
      fs.rmSync(testDir, { recursive: true, force: true });
    },
    90_000,
  );

  it.skipIf(skip)(
    'GPT edits an existing file',
    async () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-tools-'));
      const fp = path.join(testDir, 'data.txt');
      fs.writeFileSync(fp, 'line1\nline2\nline3\n');

      const result = await runProxy({
        prompt: `Replace "line2" with "REPLACED" in the file ${fp}. Then read the file and tell me all lines.`,
        model: DEFAULT_GPT_MODEL,
      });
      expect(result.isError).toBe(false);
      const updated = fs.readFileSync(fp, 'utf-8');
      expect(updated).toContain('REPLACED');
      expect(updated).not.toContain('line2');
      fs.rmSync(testDir, { recursive: true, force: true });
    },
    90_000,
  );

  // ───── Claude Tool Tests ─────

  it.skipIf(skip)(
    'Claude reads a file via tool call (Vertex AI)',
    async () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-tools-'));
      const filePath = path.join(testDir, 'claude-test.txt');
      fs.writeFileSync(filePath, 'The password is banana.');

      const result = await runProxy(
        `Read the file at ${filePath} and tell me what the password is. Just say the word.`,
        DEFAULT_CLAUDE_MODEL,
      );
      expect(result.isError).toBe(false);
      expect(result.response.toLowerCase()).toContain('banana');
      fs.rmSync(testDir, { recursive: true, force: true });
    },
    90_000,
  );

  it.skipIf(skip)(
    'Claude runs a shell command',
    async () => {
      const result = await runProxy(
        'Run the shell command "echo CLAUDE_E2E_OK" and tell me the exact output. Only repeat what was printed.',
        DEFAULT_CLAUDE_MODEL,
      );
      expect(result.isError).toBe(false);
      expect(result.response).toContain('CLAUDE_E2E_OK');
    },
    90_000,
  );
});
