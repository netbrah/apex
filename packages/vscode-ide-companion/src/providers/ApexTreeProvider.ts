import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  scanProjects,
  type ChatSession,
  type ProjectInfo,
} from './chatParser.js';

export type ApexTreeItem = CategoryItem | FileItem | SessionItem | ProjectItem;

const APEX_DIR = path.join(os.homedir(), '.apex');

// Top-level categories and which files/dirs they surface
const CATEGORIES: Array<{ label: string; icon: string; entries: string[] }> = [
  {
    label: 'Settings',
    icon: 'gear',
    entries: ['settings.json', 'APEX.md', 'trustedFolders.json'],
  },
  { label: 'Projects', icon: 'folder-library', entries: ['projects'] },
  { label: 'Debug', icon: 'bug', entries: ['debug'] },
  { label: 'Bin', icon: 'package', entries: ['bin'] },
  { label: 'Todos', icon: 'checklist', entries: ['todos'] },
  { label: 'Arena', icon: 'beaker', entries: ['arena'] },
];

export class ApexTreeProvider implements vscode.TreeDataProvider<ApexTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ApexTreeItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private watcher: vscode.FileSystemWatcher | undefined;

  constructor() {
    // Watch ~/.apex/ for changes
    if (fs.existsSync(APEX_DIR)) {
      this.watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(APEX_DIR), '**/*'),
      );
      this.watcher.onDidChange(() => this.refresh());
      this.watcher.onDidCreate(() => this.refresh());
      this.watcher.onDidDelete(() => this.refresh());
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  dispose(): void {
    this.watcher?.dispose();
  }

  getTreeItem(element: ApexTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ApexTreeItem): Promise<ApexTreeItem[]> {
    if (!fs.existsSync(APEX_DIR)) {
      return [
        new CategoryItem(
          '~/.apex/ not found',
          'warning',
          vscode.TreeItemCollapsibleState.None,
        ),
      ];
    }

    // Root level: show categories
    if (!element) {
      return CATEGORIES.filter((cat) => 
        // Only show categories that have at least one existing entry
         cat.entries.some((e) => fs.existsSync(path.join(APEX_DIR, e)))
      ).map(
        (cat) =>
          new CategoryItem(
            cat.label,
            cat.icon,
            vscode.TreeItemCollapsibleState.Collapsed,
          ),
      );
    }

    // Category children
    if (element instanceof CategoryItem) {
      return this.getCategoryChildren(element.label as string);
    }

    // Project children: show chat sessions + other files
    if (element instanceof ProjectItem) {
      return this.getProjectChildren(element.project);
    }

    // Directory children
    if (element instanceof FileItem && element.isDir) {
      return this.getDirChildren(element.filePath);
    }

    return [];
  }

  private getCategoryChildren(category: string): ApexTreeItem[] {
    const cat = CATEGORIES.find((c) => c.label === category);
    if (!cat) return [];

    if (category === 'Projects') {
      return this.getProjectsChildren();
    }

    const items: ApexTreeItem[] = [];
    for (const entry of cat.entries) {
      const fullPath = path.join(APEX_DIR, entry);
      if (!fs.existsSync(fullPath)) continue;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        items.push(...this.getDirChildren(fullPath));
      } else {
        items.push(FileItem.fromPath(fullPath));
      }
    }
    return items;
  }

  private getProjectsChildren(): ApexTreeItem[] {
    const projects = scanProjects(APEX_DIR);
    return projects.map((p) => new ProjectItem(p));
  }

  private getProjectChildren(project: ProjectInfo): ApexTreeItem[] {
    const items: ApexTreeItem[] = [];

    // Chat sessions
    for (const session of project.sessions) {
      items.push(new SessionItem(session));
    }

    // Memory files
    const memoryDir = path.join(project.dirPath, 'memory');
    if (fs.existsSync(memoryDir)) {
      const files = fs.readdirSync(memoryDir);
      for (const file of files) {
        const fp = path.join(memoryDir, file);
        const stat = fs.statSync(fp);
        if (stat.isFile()) {
          items.push(FileItem.fromPath(fp, `[memory] ${file}`));
        }
      }
    }

    return items;
  }

  private getDirChildren(dirPath: string): ApexTreeItem[] {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries
        .filter((e) => !e.name.startsWith('.'))
        .sort((a, b) => {
          // dirs first, then files
          if (a.isDirectory() !== b.isDirectory())
            return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .map((e) => {
          const fp = path.join(dirPath, e.name);
          return FileItem.fromPath(fp);
        });
    } catch {
      return [];
    }
  }
}

export class CategoryItem extends vscode.TreeItem {
  constructor(
    label: string,
    iconId: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);
    this.iconPath = new vscode.ThemeIcon(iconId);
    this.contextValue = 'category';
  }
}

export class ProjectItem extends vscode.TreeItem {
  constructor(readonly project: ProjectInfo) {
    super(project.displayName, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('server');
    this.description = `${project.sessions.length} session${project.sessions.length !== 1 ? 's' : ''}`;
    this.contextValue = 'project';
    this.tooltip = project.dirPath;
  }
}

export class SessionItem extends vscode.TreeItem {
  constructor(readonly session: ChatSession) {
    const truncated =
      session.firstMessage.length > 60
        ? session.firstMessage.slice(0, 60) + '...'
        : session.firstMessage;
    super(truncated, vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon('comment-discussion');
    this.description = formatTimestamp(session.timestamp);
    this.tooltip = [
      session.firstMessage,
      `Model: ${session.model ?? 'unknown'}`,
      `Messages: ${session.messageCount}`,
      `Session: ${session.id}`,
    ].join('\n');
    this.contextValue = 'session';
    this.command = {
      command: 'apex.openSession',
      title: 'Open Session',
      arguments: [session],
    };
  }
}

export class FileItem extends vscode.TreeItem {
  constructor(
    readonly filePath: string,
    label: string,
    readonly isDir: boolean,
  ) {
    super(
      label,
      isDir
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    if (isDir) {
      this.iconPath = vscode.ThemeIcon.Folder;
      this.contextValue = 'folder';
    } else {
      this.iconPath = vscode.ThemeIcon.File;
      this.contextValue = 'file';
      this.command = {
        command: 'apex.openFile',
        title: 'Open File',
        arguments: [vscode.Uri.file(filePath)],
      };
      this.resourceUri = vscode.Uri.file(filePath);
    }
  }

  static fromPath(filePath: string, labelOverride?: string): FileItem {
    const stat = fs.statSync(filePath);
    const label = labelOverride ?? path.basename(filePath);
    return new FileItem(filePath, label, stat.isDirectory());
  }
}

function formatTimestamp(ts: string): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
      return `today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      return 'yesterday';
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
