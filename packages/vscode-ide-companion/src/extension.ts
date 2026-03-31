import * as vscode from 'vscode';
import { ApexTreeProvider } from './providers/ApexTreeProvider.js';
import { ChatViewerPanel } from './providers/ChatViewerPanel.js';
import { createLogger } from './utils/logger.js';
import type { ChatSession } from './providers/chatParser.js';

let logger: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
  logger = vscode.window.createOutputChannel('Apex Companion');
  const log = createLogger(context, logger);
  log('Extension activated');

  // Tree view
  const treeProvider = new ApexTreeProvider();
  const treeView = vscode.window.createTreeView('apex.explorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    treeView,
    { dispose: () => treeProvider.dispose() },

    // Open a file in the editor
    vscode.commands.registerCommand('apex.openFile', (uri: vscode.Uri) => {
      vscode.window.showTextDocument(uri, { preview: true });
    }),

    // Open a chat session in the viewer
    vscode.commands.registerCommand(
      'apex.openSession',
      (session: ChatSession) => {
        ChatViewerPanel.show(session, context.extensionUri);
      },
    ),

    // Refresh the tree
    vscode.commands.registerCommand('apex.refresh', () => {
      treeProvider.refresh();
    }),

    // Reveal in Finder/Explorer
    vscode.commands.registerCommand(
      'apex.revealInFinder',
      (item: { filePath?: string }) => {
        if (item?.filePath) {
          vscode.commands.executeCommand(
            'revealFileInOS',
            vscode.Uri.file(item.filePath),
          );
        }
      },
    ),
  );
}

export async function deactivate(): Promise<void> {
  if (logger) {
    logger.dispose();
  }
}
