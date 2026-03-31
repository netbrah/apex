import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ChatMessage {
  uuid: string;
  type: 'user' | 'assistant' | 'tool_result' | 'system';
  subtype?: string;
  timestamp: string;
  model?: string;
  cwd?: string;
  text?: string;
  thought?: boolean;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResponse?: string;
  toolStatus?: string;
}

export interface ChatSession {
  id: string;
  filePath: string;
  firstMessage: string;
  timestamp: string;
  messageCount: number;
  model?: string;
}

export interface ProjectInfo {
  id: string;
  dirPath: string;
  displayName: string;
  sessions: ChatSession[];
}

/** Extract a human-readable project name from the dir slug */
function projectDisplayName(dirName: string): string {
  // e.g. "-x-eng-bbrtp20-users-palanisd-564163awf0-8032597-2603220634"
  // Extract the machine name (bbrtp20) and the date suffix
  const parts = dirName.replace(/^-/, '').split('-');
  const machine = parts.find((p) => /^bbrtp\d+$/.test(p)) ?? '';
  const dateSuffix = parts[parts.length - 1] ?? '';
  // Format date: 2603220634 -> 26-03-22 06:34
  let dateStr = dateSuffix;
  if (/^\d{10}$/.test(dateSuffix)) {
    const yy = dateSuffix.slice(0, 2);
    const mm = dateSuffix.slice(2, 4);
    const dd = dateSuffix.slice(4, 6);
    const hh = dateSuffix.slice(6, 8);
    const min = dateSuffix.slice(8, 10);
    dateStr = `20${yy}-${mm}-${dd} ${hh}:${min}`;
  }
  if (machine) {
    return `${machine} (${dateStr})`;
  }
  // Local project dirs like "-Users-palanisd-Projects-qwen-code"
  const pathParts = dirName.replace(/^-/, '').split('-');
  const last = pathParts[pathParts.length - 1] ?? dirName;
  return last;
}

/** Scan ~/.apex/projects/ and return project metadata */
export function scanProjects(apexDir: string): ProjectInfo[] {
  const projectsDir = path.join(apexDir, 'projects');
  if (!fs.existsSync(projectsDir)) {
    return [];
  }
  const dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
  const projects: ProjectInfo[] = [];

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(projectsDir, dir.name);
    const chatsDir = path.join(dirPath, 'chats');
    const sessions: ChatSession[] = [];

    if (fs.existsSync(chatsDir)) {
      const files = fs
        .readdirSync(chatsDir)
        .filter((f) => f.endsWith('.jsonl'));
      for (const file of files) {
        const filePath = path.join(chatsDir, file);
        const session = scanSession(filePath);
        if (session) {
          sessions.push(session);
        }
      }
    }

    // Also check for memory/ dir
    const memoryDir = path.join(dirPath, 'memory');
    if (fs.existsSync(memoryDir)) {
      // Memory files are shown as regular files under the project node
    }

    sessions.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    projects.push({
      id: dir.name,
      dirPath,
      displayName: projectDisplayName(dir.name),
      sessions,
    });
  }

  return projects.sort((a, b) => {
    const aTime = a.sessions[0]?.timestamp ?? '';
    const bTime = b.sessions[0]?.timestamp ?? '';
    return bTime.localeCompare(aTime);
  });
}

/** Read just the first user message + metadata from a JSONL file */
function scanSession(filePath: string): ChatSession | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return null;

    let firstUserText = '(empty session)';
    let firstTimestamp = '';
    let model: string | undefined;
    let messageCount = 0;

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (!firstTimestamp && obj.timestamp) {
          firstTimestamp = obj.timestamp;
        }
        if (obj.type === 'user') {
          messageCount++;
          if (firstUserText === '(empty session)') {
            const parts = obj.message?.parts ?? [];
            for (const part of parts) {
              if (part.text) {
                firstUserText = part.text.slice(0, 120);
                break;
              }
            }
          }
        } else if (obj.type === 'assistant') {
          messageCount++;
          if (!model && obj.model) {
            model = obj.model;
          }
        }
      } catch {
        // skip malformed lines
      }
    }

    return {
      id: path.basename(filePath, '.jsonl'),
      filePath,
      firstMessage: firstUserText,
      timestamp: firstTimestamp,
      messageCount,
      model,
    };
  } catch {
    return null;
  }
}

/** Parse a full JSONL file into displayable messages (filtering telemetry) */
export function parseSessionMessages(filePath: string): ChatMessage[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const messages: ChatMessage[] = [];

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        // Skip telemetry
        if (obj.type === 'system' && obj.subtype === 'ui_telemetry') continue;

        const msg: ChatMessage = {
          uuid: obj.uuid,
          type: obj.type,
          subtype: obj.subtype,
          timestamp: obj.timestamp,
          model: obj.model,
          cwd: obj.cwd,
        };

        if (obj.type === 'user') {
          const parts = obj.message?.parts ?? [];
          const texts: string[] = [];
          for (const part of parts) {
            if (part.text) texts.push(part.text);
          }
          msg.text = texts.join('\n');
        } else if (obj.type === 'assistant') {
          const parts = obj.message?.parts ?? [];
          const texts: string[] = [];
          for (const part of parts) {
            if (part.thought && part.text) {
              // include thinking as collapsed
              msg.thought = true;
              texts.push(part.text);
            } else if (part.text && !part.thought) {
              texts.push(part.text);
            } else if (part.functionCall) {
              msg.toolName = part.functionCall.name;
              msg.toolArgs = part.functionCall.args;
              // Show tool call as its own message
              messages.push({
                ...msg,
                text: undefined,
                toolName: part.functionCall.name,
                toolArgs: part.functionCall.args,
              });
              continue;
            }
          }
          if (texts.length > 0) {
            msg.text = texts.join('\n');
            msg.thought = parts.some(
              (p: { thought?: boolean }) => p.thought === true,
            );
          } else {
            continue; // skip assistant messages with no text content
          }
        } else if (obj.type === 'tool_result') {
          const parts = obj.message?.parts ?? [];
          for (const part of parts) {
            if (part.functionResponse) {
              msg.toolName = part.functionResponse.name;
              msg.toolResponse = part.functionResponse.response?.output;
              msg.toolStatus = obj.toolCallResult?.status ?? 'unknown';
            }
          }
          if (!msg.toolName) continue;
        } else if (obj.type === 'system') {
          // Non-telemetry system messages (slash commands etc)
          msg.text = obj.subtype ?? 'system';
        } else {
          continue;
        }

        messages.push(msg);
      } catch {
        // skip malformed
      }
    }

    return messages;
  } catch {
    return [];
  }
}
