import * as vscode from 'vscode';
import {
  parseSessionMessages,
  type ChatMessage,
  type ChatSession,
} from './chatParser.js';

export class ChatViewerPanel {
  static readonly viewType = 'apex.chatViewer';
  private static panels = new Map<string, ChatViewerPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly session: ChatSession;
  private disposed = false;

  static show(session: ChatSession, extensionUri: vscode.Uri): ChatViewerPanel {
    const existing = ChatViewerPanel.panels.get(session.id);
    if (existing && !existing.disposed) {
      existing.panel.reveal();
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      ChatViewerPanel.viewType,
      truncate(session.firstMessage, 40),
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );

    const viewer = new ChatViewerPanel(panel, session);
    ChatViewerPanel.panels.set(session.id, viewer);
    return viewer;
  }

  private constructor(panel: vscode.WebviewPanel, session: ChatSession) {
    this.panel = panel;
    this.session = session;

    this.panel.onDidDispose(() => {
      this.disposed = true;
      ChatViewerPanel.panels.delete(session.id);
    });

    this.render();
  }

  private render(): void {
    const messages = parseSessionMessages(this.session.filePath);
    this.panel.webview.html = this.buildHtml(messages);
  }

  private buildHtml(messages: ChatMessage[]): string {
    const messagesHtml = messages.map((m) => renderMessage(m)).join('\n');
    const sessionMeta = [
      `Session: ${this.session.id}`,
      this.session.model ? `Model: ${this.session.model}` : '',
      `Messages: ${this.session.messageCount}`,
    ]
      .filter(Boolean)
      .join(' | ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: #0a0a0f;
    --surface: #111118;
    --surface2: #1a1a24;
    --border: #2a2a3a;
    --text: #e0e0e8;
    --text-dim: #888898;
    --user-bg: #1a1528;
    --user-border: #c4b5fd44;
    --assistant-bg: #0f1520;
    --assistant-border: #7dd3fc44;
    --tool-bg: #0f1818;
    --tool-border: #d4a27a44;
    --thought-bg: #18141e;
    --thought-border: #c4b5fd22;
    --accent: #c4b5fd;
    --peach: #d4a27a;
    --blue: #7dd3fc;
    --search-bg: #1a1a24;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family, 'SF Mono', 'Fira Code', monospace);
    font-size: 13px;
    background: var(--bg);
    color: var(--text);
    line-height: 1.55;
  }

  .search-bar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .search-bar input {
    flex: 1;
    background: var(--search-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    padding: 6px 10px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }

  .search-bar input:focus {
    border-color: var(--accent);
  }

  .search-bar .count {
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
  }

  .session-meta {
    padding: 6px 16px;
    color: var(--text-dim);
    font-size: 11px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .messages {
    padding: 8px 0;
  }

  .msg {
    margin: 4px 12px;
    padding: 10px 14px;
    border-radius: 6px;
    border-left: 3px solid transparent;
  }

  .msg.hidden { display: none; }

  .msg-user {
    background: var(--user-bg);
    border-left-color: var(--accent);
  }

  .msg-assistant {
    background: var(--assistant-bg);
    border-left-color: var(--blue);
  }

  .msg-tool-call {
    background: var(--tool-bg);
    border-left-color: var(--peach);
    font-size: 12px;
  }

  .msg-tool-result {
    background: var(--tool-bg);
    border-left-color: var(--peach);
    font-size: 12px;
  }

  .msg-thought {
    background: var(--thought-bg);
    border-left-color: var(--thought-border);
    font-size: 12px;
    opacity: 0.7;
  }

  .msg-system {
    background: var(--surface2);
    border-left-color: var(--border);
    font-size: 11px;
    color: var(--text-dim);
  }

  .msg-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    cursor: pointer;
    user-select: none;
  }

  .msg-header .role {
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .msg-header .role-user { color: var(--accent); }
  .msg-header .role-assistant { color: var(--blue); }
  .msg-header .role-tool { color: var(--peach); }
  .msg-header .role-thought { color: #9070c0; }
  .msg-header .role-system { color: var(--text-dim); }

  .msg-header .ts {
    color: var(--text-dim);
    font-size: 10px;
    margin-left: auto;
  }

  .msg-header .chevron {
    color: var(--text-dim);
    font-size: 10px;
    transition: transform 0.15s;
  }

  .msg-header .chevron.collapsed {
    transform: rotate(-90deg);
  }

  .msg-body {
    white-space: pre-wrap;
    word-break: break-word;
    overflow: hidden;
  }

  .msg-body.collapsed {
    max-height: 0;
    padding: 0;
    opacity: 0;
    transition: max-height 0.15s, opacity 0.15s;
  }

  .msg-body.expanded {
    max-height: none;
    opacity: 1;
  }

  .tool-name {
    color: var(--peach);
    font-weight: 600;
    font-size: 12px;
  }

  .tool-args, .tool-response {
    margin-top: 4px;
    padding: 6px 8px;
    background: #00000033;
    border-radius: 3px;
    font-size: 11px;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .tool-status {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 600;
  }

  .tool-status.success { background: #16a34a33; color: #4ade80; }
  .tool-status.error { background: #dc262633; color: #f87171; }

  mark {
    background: #c4b5fd55;
    color: var(--text);
    border-radius: 2px;
    padding: 0 1px;
  }

  .no-results {
    text-align: center;
    padding: 40px;
    color: var(--text-dim);
    font-size: 14px;
  }
</style>
</head>
<body>
  <div class="search-bar">
    <input type="text" id="search" placeholder="Search messages..." autofocus />
    <span class="count" id="count"></span>
  </div>
  <div class="session-meta">${escapeHtml(sessionMeta)}</div>
  <div class="messages" id="messages">
    ${messagesHtml}
  </div>
  <script>
    const searchInput = document.getElementById('search');
    const countEl = document.getElementById('count');
    const msgEls = document.querySelectorAll('.msg');

    // Toggle collapse on header click
    document.addEventListener('click', (e) => {
      const header = e.target.closest('.msg-header');
      if (!header) return;
      const body = header.nextElementSibling;
      const chevron = header.querySelector('.chevron');
      if (!body || !chevron) return;
      const isCollapsed = body.classList.contains('collapsed');
      body.classList.toggle('collapsed', !isCollapsed);
      body.classList.toggle('expanded', isCollapsed);
      chevron.classList.toggle('collapsed', !isCollapsed);
    });

    // Search
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      let visible = 0;
      let total = msgEls.length;

      msgEls.forEach(el => {
        if (!query) {
          el.classList.remove('hidden');
          // remove highlights
          el.querySelectorAll('mark').forEach(m => {
            m.replaceWith(m.textContent);
          });
          visible = total;
          return;
        }

        const text = el.textContent.toLowerCase();
        if (text.includes(query)) {
          el.classList.remove('hidden');
          visible++;
          // Expand matching messages
          const body = el.querySelector('.msg-body');
          const chevron = el.querySelector('.chevron');
          if (body) {
            body.classList.remove('collapsed');
            body.classList.add('expanded');
          }
          if (chevron) chevron.classList.remove('collapsed');
        } else {
          el.classList.add('hidden');
        }
      });

      countEl.textContent = query ? visible + '/' + total : '';
    });

    // Keyboard shortcut: Ctrl/Cmd+F focuses search
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
      // Escape clears search
      if (e.key === 'Escape') {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
      }
    });
  </script>
</body>
</html>`;
  }
}

function renderMessage(msg: ChatMessage): string {
  if (msg.type === 'user') {
    return msgBlock('user', 'User', msg, escapeHtml(msg.text ?? ''));
  }

  if (msg.type === 'assistant' && msg.toolName) {
    const argsStr = msg.toolArgs ? JSON.stringify(msg.toolArgs, null, 2) : '';
    return msgBlock(
      'tool-call',
      'Tool Call',
      msg,
      `<span class="tool-name">${escapeHtml(msg.toolName)}</span>` +
        (argsStr
          ? `<div class="tool-args">${escapeHtml(truncate(argsStr, 2000))}</div>`
          : ''),
      true,
    );
  }

  if (msg.type === 'assistant' && msg.thought) {
    return msgBlock(
      'thought',
      'Thinking',
      msg,
      escapeHtml(msg.text ?? ''),
      true,
    );
  }

  if (msg.type === 'assistant') {
    return msgBlock('assistant', 'Assistant', msg, escapeHtml(msg.text ?? ''));
  }

  if (msg.type === 'tool_result') {
    const statusClass = msg.toolStatus === 'success' ? 'success' : 'error';
    const response = msg.toolResponse ?? '';
    return msgBlock(
      'tool-result',
      'Tool Result',
      msg,
      `<span class="tool-name">${escapeHtml(msg.toolName ?? '')}</span>` +
        ` <span class="tool-status ${statusClass}">${escapeHtml(msg.toolStatus ?? '')}</span>` +
        `<div class="tool-response">${escapeHtml(truncate(response, 3000))}</div>`,
      true,
    );
  }

  if (msg.type === 'system') {
    return msgBlock(
      'system',
      'System',
      msg,
      escapeHtml(msg.text ?? msg.subtype ?? ''),
    );
  }

  return '';
}

function msgBlock(
  cssClass: string,
  role: string,
  msg: ChatMessage,
  bodyHtml: string,
  startCollapsed = false,
): string {
  const roleClass =
    cssClass === 'tool-call' || cssClass === 'tool-result'
      ? 'role-tool'
      : cssClass === 'thought'
        ? 'role-thought'
        : `role-${cssClass}`;
  const ts = formatTime(msg.timestamp);
  const chevronClass = startCollapsed ? 'chevron collapsed' : 'chevron';
  const bodyClass = startCollapsed ? 'msg-body collapsed' : 'msg-body expanded';

  return `<div class="msg msg-${cssClass}">
  <div class="msg-header">
    <span class="${chevronClass}">&#9662;</span>
    <span class="role ${roleClass}">${escapeHtml(role)}</span>
    <span class="ts">${escapeHtml(ts)}</span>
  </div>
  <div class="${bodyClass}">${bodyHtml}</div>
</div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function formatTime(ts: string): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}
