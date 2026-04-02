/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Status } from '../scheduler/types.js';
import { type ThoughtSummary } from '../utils/thoughtUtils.js';
import { getProjectHash } from '../utils/paths.js';
import path from 'node:path';
import fs from 'node:fs';
import { sanitizeFilenamePart } from '../utils/fileUtils.js';
import {
  deleteSessionArtifactsAsync,
  deleteSubagentSessionDirAndArtifactsAsync,
} from '../utils/sessionOperations.js';
import { randomUUID } from 'node:crypto';
import type {
  Content,
  Part,
  PartListUnion,
  GenerateContentResponseUsageMetadata,
} from '@google/genai';
import { debugLogger } from '../utils/debugLogger.js';
import type { ToolResultDisplay } from '../tools/tools.js';
import type { AgentLoopContext } from '../config/agent-loop-context.js';

export const SESSION_FILE_PREFIX = 'session-';

/**
 * Warning message shown when recording is disabled due to disk full.
 */
const ENOSPC_WARNING_MESSAGE =
  'Chat recording disabled: No space left on device. ' +
  'The conversation will continue but will not be saved to disk. ' +
  'Free up disk space and restart to enable recording.';

/**
 * A single record stored in the JSONL file.
 * Forms a tree structure via uuid/parentUuid for future checkpointing support.
 *
 * Each record is self-contained with full metadata, enabling:
 * - Append-only writes (crash-safe)
 * - Tree reconstruction by following parentUuid chain
 * - Future checkpointing by branching from any historical record
 */
export interface TokensSummary {
  input: number; // promptTokenCount
  output: number; // candidatesTokenCount
  cached: number; // cachedContentTokenCount
  thoughts?: number; // thoughtsTokenCount
  tool?: number; // toolUsePromptTokenCount
  total: number; // totalTokenCount
}

/**
 * Base fields common to all messages.
 */
export interface BaseMessageRecord {
  id: string;
  timestamp: string;
  content: PartListUnion;
  displayContent?: PartListUnion;
}

/**
 * Record of a tool call execution within a conversation.
 */
export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: PartListUnion | null;
  status: Status;
  timestamp: string;
  // UI-specific fields for display purposes
  displayName?: string;
  description?: string;
  resultDisplay?: ToolResultDisplay;
  renderOutputAsMarkdown?: boolean;
}

/**
 * Message type and message type-specific fields.
 */
export type ConversationRecordExtra =
  | {
      type: 'user' | 'info' | 'error' | 'warning';
    }
  | {
      type: 'gemini';
      toolCalls?: ToolCallRecord[];
      thoughts?: Array<ThoughtSummary & { timestamp: string }>;
      tokens?: TokensSummary | null;
      model?: string;
    };

/**
 * A single message record in a conversation.
 */
export type MessageRecord = BaseMessageRecord & ConversationRecordExtra;

/**
 * Complete conversation record stored in session files.
 */
export interface ConversationRecord {
  sessionId: string;
  projectHash: string;
  startTime: string;
  lastUpdated: string;
  messages: MessageRecord[];
  summary?: string;
  /** Workspace directories added during the session via /dir add */
  directories?: string[];
  /** The kind of conversation (main agent or subagent) */
  kind?: 'main' | 'subagent';
}

/**
 * Stored payload for chat compression checkpoints. This allows us to rebuild the
 * effective chat history on resume while keeping the original UI-visible history.
 */
export interface ChatCompressionRecordPayload {
  /** Compression metrics/status returned by the compression service */
  info: ChatCompressionInfo;
  /**
   * Snapshot of the new history contents that the model should see after
   * compression (summary turns + retained tail). Stored as Content[] for
   * resume reconstruction.
   */
  compressedHistory: Content[];
}

export interface SlashCommandRecordPayload {
  /** Whether this record represents the invocation or the resulting output. */
  phase: 'invocation' | 'result';
  /** Raw user-entered slash command (e.g., "/about"). */
  rawCommand: string;
  /**
   * History items the UI displayed for this command, in the same shape used by
   * the CLI (without IDs). Stored as plain objects for replay on resume.
   */
  outputHistoryItems?: Array<Record<string, unknown>>;
}

/**
 * Stored payload for @-command replay.
 */
export interface AtCommandRecordPayload {
  /** Files that were read for this @-command. */
  filesRead: string[];
  /** Status for UI reconstruction. */
  status: 'success' | 'error';
  /** Optional result message for UI reconstruction. */
  message?: string;
  /** Raw user-entered @-command query (optional for legacy records). */
  userText?: string;
}

/**
 * Stored payload for UI telemetry replay.
 */
export interface UiTelemetryRecordPayload {
  uiEvent: UiEvent;
}

/**
 * Service for recording the current chat session to disk.
 *
 * This service provides comprehensive conversation recording that captures:
 * - All user and assistant messages
 * - Tool calls and their execution results
 * - Token usage statistics
 * - Assistant thoughts and reasoning
 *
 * **API Design:**
 * - `recordUserMessage()` - Records a user message (immediate write)
 * - `recordAssistantTurn()` - Records an assistant turn with all data (immediate write)
 * - `recordToolResult()` - Records tool results (immediate write)
 *
 * **Storage Format:** JSONL files with tree-structured records.
 * Each record has uuid/parentUuid fields enabling:
 * - Append-only writes (never rewrite the file)
 * - Linear history reconstruction
 * - Future checkpointing (branch from any historical point)
 *
 * File location: ~/.apex/tmp/<project_id>/chats/
 *
 * For session management (list, load, remove), use SessionService.
 */
export class ChatRecordingService {
  private conversationFile: string | null = null;
  private cachedLastConvData: string | null = null;
  private cachedConversation: ConversationRecord | null = null;
  private sessionId: string;
  private projectHash: string;
  private kind?: 'main' | 'subagent';
  private queuedThoughts: Array<ThoughtSummary & { timestamp: string }> = [];
  private queuedTokens: TokensSummary | null = null;
  private context: AgentLoopContext;

  constructor(context: AgentLoopContext) {
    this.context = context;
    this.sessionId = context.promptId;
    this.projectHash = getProjectHash(context.config.getProjectRoot());
  }

  /**
   * Initializes the chat recording service: creates a new conversation file and associates it with
   * this service instance, or resumes from an existing session if resumedSessionData is provided.
   *
   * @param resumedSessionData Data from a previous session to resume from.
   * @param kind The kind of conversation (main or subagent).
   */
  initialize(
    resumedSessionData?: ResumedSessionData,
    kind?: 'main' | 'subagent',
  ): void {
    try {
      this.kind = kind;
      if (resumedSessionData) {
        // Resume from existing session
        this.conversationFile = resumedSessionData.filePath;
        this.sessionId = resumedSessionData.conversation.sessionId;
        this.kind = resumedSessionData.conversation.kind;

        // Update the session ID in the existing file
        this.updateConversation((conversation) => {
          conversation.sessionId = this.sessionId;
        });

        // Clear any cached data to force fresh reads
        this.cachedLastConvData = null;
        this.cachedConversation = null;
      } else {
        // Create new session
        this.sessionId = this.context.promptId;
        let chatsDir = path.join(
          this.context.config.storage.getProjectTempDir(),
          'chats',
        );

        // subagents are nested under the complete parent session id
        if (this.kind === 'subagent' && this.context.parentSessionId) {
          const safeParentId = sanitizeFilenamePart(
            this.context.parentSessionId,
          );
          if (!safeParentId) {
            throw new Error(
              `Invalid parentSessionId after sanitization: ${this.context.parentSessionId}`,
            );
          }
          chatsDir = path.join(chatsDir, safeParentId);
        }

        fs.mkdirSync(chatsDir, { recursive: true });

        const timestamp = new Date()
          .toISOString()
          .slice(0, 16)
          .replace(/:/g, '-');
        const safeSessionId = sanitizeFilenamePart(this.sessionId);
        if (!safeSessionId) {
          throw new Error(
            `Invalid sessionId after sanitization: ${this.sessionId}`,
          );
        }

        let filename: string;
        if (this.kind === 'subagent') {
          filename = `${safeSessionId}.json`;
        } else {
          filename = `${SESSION_FILE_PREFIX}${timestamp}-${safeSessionId.slice(
            0,
            8,
          )}.json`;
        }
        this.conversationFile = path.join(chatsDir, filename);

        const directories =
          this.kind === 'subagent'
            ? [
                ...(this.context.config
                  .getWorkspaceContext()
                  ?.getDirectories() ?? []),
              ]
            : undefined;

        this.writeConversation({
          sessionId: this.sessionId,
          projectHash: this.projectHash,
          startTime: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          messages: [],
          directories,
          kind: this.kind,
        });
      }

      // Clear any queued data since this is a fresh start
      this.queuedThoughts = [];
      this.queuedTokens = null;
    } catch (error) {
      // Handle disk full (ENOSPC) gracefully - disable recording but allow CLI to continue
      if (
        error instanceof Error &&
        'code' in error &&
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (error as NodeJS.ErrnoException).code === 'ENOSPC'
      ) {
        this.conversationFile = null;
        debugLogger.warn(ENOSPC_WARNING_MESSAGE);
        return; // Don't throw - allow the CLI to continue
      }
      debugLogger.error('Error initializing chat recording service:', error);
      throw error;
    }

    return chatsDir;
  }

  /**
   * Ensures the conversation file exists, creating it if it doesn't exist.
   * Uses atomic file creation to avoid race conditions.
   * @returns The path to the conversation file.
   * @throws Error if the file cannot be created or accessed.
   */
  private ensureConversationFile(): string {
    const chatsDir = this.ensureChatsDir();
    const sessionId = this.getSessionId();
    const safeFilename = `${sessionId}.jsonl`;
    const conversationFile = path.join(chatsDir, safeFilename);

    if (fs.existsSync(conversationFile)) {
      return conversationFile;
    }

    try {
      // Use 'wx' flag for exclusive creation - atomic operation that fails if file exists
      // This avoids the TOCTOU race condition of existsSync + writeFileSync
      fs.writeFileSync(conversationFile, '', { flag: 'wx', encoding: 'utf8' });
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      // EEXIST means file already exists, which is expected and fine
      if (nodeError.code !== 'EEXIST') {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to create conversation file at ${conversationFile}: ${message}`,
        );
      }
    }

    return conversationFile;
  }

  private newMessage(
    type: ConversationRecordExtra['type'],
    content: PartListUnion,
    displayContent?: PartListUnion,
  ): MessageRecord {
    return {
      uuid: randomUUID(),
      parentUuid: this.lastRecordUuid,
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      type,
      content,
      displayContent,
    };
  }

  /**
   * Appends a record to the session file and updates lastRecordUuid.
   */
  recordMessage(message: {
    model: string | undefined;
    type: ConversationRecordExtra['type'];
    content: PartListUnion;
    displayContent?: PartListUnion;
  }): void {
    if (!this.conversationFile) return;

    try {
      this.updateConversation((conversation) => {
        const msg = this.newMessage(
          message.type,
          message.content,
          message.displayContent,
        );
        if (msg.type === 'gemini') {
          // If it's a new Gemini message then incorporate any queued thoughts.
          conversation.messages.push({
            ...msg,
            thoughts: this.queuedThoughts,
            tokens: this.queuedTokens,
            model: message.model,
          });
          this.queuedThoughts = [];
          this.queuedTokens = null;
        } else {
          // Or else just add it.
          conversation.messages.push(msg);
        }
      });
    } catch (error) {
      debugLogger.error('Error saving message to chat history.', error);
      throw error;
    }
  }

  /**
   * Records a user message.
   * Writes immediately to disk.
   *
   * @param message The raw PartListUnion object as used with the API
   */
  recordUserMessage(message: PartListUnion): void {
    try {
      this.queuedThoughts.push({
        ...thought,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      debugLogger.error('Error saving thought to chat history.', error);
      throw error;
    }
  }

  /**
   * Updates the tokens for the last message in the conversation (which should be by Gemini).
   */
  recordMessageTokens(
    respUsageMetadata: GenerateContentResponseUsageMetadata,
  ): void {
    if (!this.conversationFile) return;

    try {
      const tokens = {
        input: respUsageMetadata.promptTokenCount ?? 0,
        output: respUsageMetadata.candidatesTokenCount ?? 0,
        cached: respUsageMetadata.cachedContentTokenCount ?? 0,
        thoughts: respUsageMetadata.thoughtsTokenCount ?? 0,
        tool: respUsageMetadata.toolUsePromptTokenCount ?? 0,
        total: respUsageMetadata.totalTokenCount ?? 0,
      };
      const conversation = this.readConversation();
      const lastMsg = this.getLastMessage(conversation);
      // If the last message already has token info, it's because this new token info is for a
      // new message that hasn't been recorded yet.
      if (lastMsg && lastMsg.type === 'gemini' && !lastMsg.tokens) {
        lastMsg.tokens = tokens;
        this.queuedTokens = null;
        this.writeConversation(conversation);
      } else {
        // Only queue tokens in memory; no disk I/O needed since the
        // conversation record itself hasn't changed.
        this.queuedTokens = tokens;
      }
    } catch (error) {
      debugLogger.error(
        'Error updating message tokens in chat history.',
        error,
      );
      throw error;
    }
  }

  /**
   * Adds tool calls to the last message in the conversation (which should be by Gemini).
   * This method enriches tool calls with metadata from the ToolRegistry.
   */
  recordToolCalls(model: string, toolCalls: ToolCallRecord[]): void {
    if (!this.conversationFile) return;

    // Enrich tool calls with metadata from the ToolRegistry
    const toolRegistry = this.context.toolRegistry;
    const enrichedToolCalls = toolCalls.map((toolCall) => {
      const toolInstance = toolRegistry.getTool(toolCall.name);
      return {
        ...toolCall,
        displayName: toolInstance?.displayName || toolCall.name,
        description:
          toolCall.description?.trim() || toolInstance?.description || '',
        renderOutputAsMarkdown: toolInstance?.isOutputMarkdown || false,
      };
    });

    try {
      this.updateConversation((conversation) => {
        const lastMsg = this.getLastMessage(conversation);
        // If a tool call was made, but the last message isn't from Gemini, it's because Gemini is
        // calling tools without starting the message with text.  So the user submits a prompt, and
        // Gemini immediately calls a tool (maybe with some thinking first).  In that case, create
        // a new empty Gemini message.
        // Also if there are any queued thoughts, it means this tool call(s) is from a new Gemini
        // message--because it's thought some more since we last, if ever, created a new Gemini
        // message from tool calls, when we dequeued the thoughts.
        if (
          !lastMsg ||
          lastMsg.type !== 'gemini' ||
          this.queuedThoughts.length > 0
        ) {
          const newMsg: MessageRecord = {
            ...this.newMessage('gemini' as const, ''),
            // This isn't strictly necessary, but TypeScript apparently can't
            // tell that the first parameter to newMessage() becomes the
            // resulting message's type, and so it thinks that toolCalls may
            // not be present.  Confirming the type here satisfies it.
            type: 'gemini' as const,
            toolCalls: enrichedToolCalls,
            thoughts: this.queuedThoughts,
            model,
          };
          // If there are any queued thoughts join them to this message.
          if (this.queuedThoughts.length > 0) {
            newMsg.thoughts = this.queuedThoughts;
            this.queuedThoughts = [];
          }
          // If there's any queued tokens info join it to this message.
          if (this.queuedTokens) {
            newMsg.tokens = this.queuedTokens;
            this.queuedTokens = null;
          }
          conversation.messages.push(newMsg);
        } else {
          // The last message is an existing Gemini message that we need to update.

          // Update any existing tool call entries.
          if (!lastMsg.toolCalls) {
            lastMsg.toolCalls = [];
          }
          lastMsg.toolCalls = lastMsg.toolCalls.map((toolCall) => {
            // If there are multiple tool calls with the same ID, this will take the first one.
            const incomingToolCall = toolCalls.find(
              (tc) => tc.id === toolCall.id,
            );
            if (incomingToolCall) {
              // Merge in the new data to keep preserve thoughts, etc., that were assigned to older
              // versions of the tool call.
              return { ...toolCall, ...incomingToolCall };
            } else {
              return toolCall;
            }
          });

          // Add any new tools calls that aren't in the message yet.
          for (const toolCall of enrichedToolCalls) {
            const existingToolCall = lastMsg.toolCalls.find(
              (tc) => tc.id === toolCall.id,
            );
            if (!existingToolCall) {
              lastMsg.toolCalls.push(toolCall);
            }
          }
        }
      });
    } catch (error) {
      debugLogger.error(
        'Error adding tool call to message in chat history.',
        error,
      );
      throw error;
    }
  }

  /**
   * Loads up the conversation record from disk.
   *
   * NOTE: The returned object is the live in-memory cache reference.
   * Any mutations to it will be visible to all subsequent reads.
   * Callers that mutate the result MUST call writeConversation() to
   * persist the changes to disk.
   */
  private readConversation(): ConversationRecord {
    if (this.cachedConversation) {
      return this.cachedConversation;
    }
    try {
      this.cachedLastConvData = fs.readFileSync(this.conversationFile!, 'utf8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.cachedConversation = JSON.parse(this.cachedLastConvData);
      if (!this.cachedConversation) {
        // File is corrupt or contains "null". Fallback to an empty conversation.
        this.cachedConversation = {
          sessionId: this.sessionId,
          projectHash: this.projectHash,
          startTime: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          messages: [],
          kind: this.kind,
        };
      }
      return this.cachedConversation;
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        debugLogger.error('Error reading conversation file.', error);
        throw error;
      }

      // Placeholder empty conversation if file doesn't exist.
      this.cachedConversation = {
        sessionId: this.sessionId,
        projectHash: this.projectHash,
        startTime: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        messages: [],
        kind: this.kind,
      };
      return this.cachedConversation;
    }
  }

  /**
   * Records an assistant turn with all available data.
   * Writes immediately to disk.
   *
   * @param data.message The raw PartListUnion object from the model response
   * @param data.model The model name
   * @param data.tokens Token usage statistics
   * @param data.contextWindowSize Context window size of the model
   * @param data.toolCallsMetadata Enriched tool call info for UI recovery
   */
  private writeConversation(
    conversation: ConversationRecord,
    { allowEmpty = false }: { allowEmpty?: boolean } = {},
  ): void {
    try {
      if (!this.conversationFile) return;

      // Cache the conversation state even if we don't write to disk yet.
      // This ensures that subsequent reads (e.g. during recordMessage)
      // see the initial state (like directories) instead of trying to
      // read a non-existent file from disk.
      this.cachedConversation = conversation;

      // Don't write the file yet until there's at least one message.
      if (conversation.messages.length === 0 && !allowEmpty) return;

      const newContent = JSON.stringify(conversation, null, 2);
      // Skip the disk write if nothing actually changed (e.g.
      // updateMessagesFromHistory found no matching tool calls to update).
      // Compare before updating lastUpdated so the timestamp doesn't
      // cause a false diff.
      if (this.cachedLastConvData === newContent) return;
      conversation.lastUpdated = new Date().toISOString();
      const contentToWrite = JSON.stringify(conversation, null, 2);
      this.cachedLastConvData = contentToWrite;
      // Ensure directory exists before writing (handles cases where temp dir was cleaned)
      fs.mkdirSync(path.dirname(this.conversationFile), { recursive: true });
      fs.writeFileSync(this.conversationFile, contentToWrite);
    } catch (error) {
      // Handle disk full (ENOSPC) gracefully - disable recording but allow conversation to continue
      if (
        error instanceof Error &&
        'code' in error &&
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (error as NodeJS.ErrnoException).code === 'ENOSPC'
      ) {
        this.conversationFile = null;
        this.cachedConversation = null;
        debugLogger.warn(ENOSPC_WARNING_MESSAGE);
        return; // Don't throw - allow the conversation to continue
      }
      debugLogger.error('Error writing conversation file.', error);
      throw error;
    }
  }

  /**
   * Records tool results (function responses) sent back to the model.
   * Writes immediately to disk.
   *
   * @param message The raw PartListUnion object with functionResponse parts
   * @param toolCallResult Optional tool call result info for UI recovery
   */
  recordToolResult(
    message: PartListUnion,
    toolCallResult?: Partial<ToolCallResponseInfo> & { status: Status },
  ): void {
    try {
      const record: ChatRecord = {
        ...this.createBaseRecord('tool_result'),
        message: createUserContent(message),
      };

      if (toolCallResult) {
        // special case for task executions - we don't want to record the tool calls
        if (
          typeof toolCallResult.resultDisplay === 'object' &&
          toolCallResult.resultDisplay !== null &&
          'type' in toolCallResult.resultDisplay &&
          toolCallResult.resultDisplay.type === 'task_execution'
        ) {
          const taskResult = toolCallResult.resultDisplay as AgentResultDisplay;
          record.toolCallResult = {
            ...toolCallResult,
            resultDisplay: {
              ...taskResult,
              toolCalls: [],
            },
          };
        } else {
          record.toolCallResult = toolCallResult;
        }
      }

      this.appendRecord(record);
    } catch (error) {
      debugLogger.error('Error saving tool result:', error);
    }
  }

  /**
   * Saves a summary for the current session.
   */
  saveSummary(summary: string): void {
    if (!this.conversationFile) return;

    try {
      this.updateConversation((conversation) => {
        conversation.summary = summary;
      });
    } catch (error) {
      debugLogger.error('Error saving summary to chat history.', error);
      // Don't throw - we want graceful degradation
    }
  }

  /**
   * Records workspace directories to the session file.
   * Called when directories are added via /dir add.
   */
  recordDirectories(directories: readonly string[]): void {
    if (!this.conversationFile) return;

    try {
      this.updateConversation((conversation) => {
        conversation.directories = [...directories];
      });
    } catch (error) {
      debugLogger.error('Error saving directories to chat history.', error);
      // Don't throw - we want graceful degradation
    }
  }

  /**
   * Gets the current conversation data (for summary generation).
   */
  getConversation(): ConversationRecord | null {
    if (!this.conversationFile) return null;

    try {
      return this.readConversation();
    } catch (error) {
      debugLogger.error('Error reading conversation for summary.', error);
      return null;
    }
  }

  /**
   * Gets the path to the current conversation file.
   * Returns null if the service hasn't been initialized yet or recording is disabled.
   */
  getConversationFilePath(): string | null {
    return this.conversationFile;
  }

  /**
   * Deletes a session file by sessionId, filename, or basename.
   * Derives an 8-character shortId to find and delete all associated files
   * (parent and subagents).
   *
   * @throws {Error} If shortId validation fails.
   */
  async deleteSession(sessionIdOrBasename: string): Promise<void> {
    try {
      const tempDir = this.context.config.storage.getProjectTempDir();
      const chatsDir = path.join(tempDir, 'chats');

      const shortId = this.deriveShortId(sessionIdOrBasename);

      // Using stat instead of existsSync for async sanity
      if (!(await fs.promises.stat(chatsDir).catch(() => null))) {
        return; // Nothing to delete
      }

      const matchingFiles = this.getMatchingSessionFiles(chatsDir, shortId);

      for (const file of matchingFiles) {
        await this.deleteSessionAndArtifacts(chatsDir, file, tempDir);
      }
    } catch (error) {
      debugLogger.error('Error deleting session file.', error);
      throw error;
    }
  }

  /**
   * Derives an 8-character shortId from a sessionId, filename, or basename.
   */
  private deriveShortId(sessionIdOrBasename: string): string {
    let shortId = sessionIdOrBasename;
    if (sessionIdOrBasename.startsWith(SESSION_FILE_PREFIX)) {
      const withoutExt = sessionIdOrBasename.replace('.json', '');
      const parts = withoutExt.split('-');
      shortId = parts[parts.length - 1];
    } else if (sessionIdOrBasename.length >= 8) {
      shortId = sessionIdOrBasename.slice(0, 8);
    } else {
      throw new Error('Invalid sessionId or basename provided for deletion');
    }

    if (shortId.length !== 8) {
      throw new Error('Derived shortId must be exactly 8 characters');
    }

    return shortId;
  }

  /**
   * Finds all session files matching the pattern session-*-<shortId>.json
   */
  private getMatchingSessionFiles(chatsDir: string, shortId: string): string[] {
    const files = fs.readdirSync(chatsDir);
    return files.filter(
      (f) =>
        f.startsWith(SESSION_FILE_PREFIX) && f.endsWith(`-${shortId}.json`),
    );
  }

  /**
   * Deletes a single session file and its associated logs, tool-outputs, and directory.
   */
  private async deleteSessionAndArtifacts(
    chatsDir: string,
    file: string,
    tempDir: string,
  ): Promise<void> {
    const filePath = path.join(chatsDir, file);
    try {
      const fileContent = await fs.promises.readFile(filePath, 'utf8');
      const content = JSON.parse(fileContent) as unknown;

      let fullSessionId: string | undefined;
      if (content && typeof content === 'object' && 'sessionId' in content) {
        const id = (content as Record<string, unknown>)['sessionId'];
        if (typeof id === 'string') {
          fullSessionId = id;
        }
      }

      // Delete the session file
      await fs.promises.unlink(filePath);

      if (fullSessionId) {
        // Delegate to shared utility!
        await deleteSessionArtifactsAsync(fullSessionId, tempDir);
        await deleteSubagentSessionDirAndArtifactsAsync(
          fullSessionId,
          chatsDir,
          tempDir,
        );
      }
    } catch (error) {
      debugLogger.error(`Error deleting associated file ${file}:`, error);
    }
  }

  /**
   * Rewinds the conversation to the state just before the specified message ID.
   * All messages from (and including) the specified ID onwards are removed.
   */
  rewindTo(messageId: string): ConversationRecord | null {
    if (!this.conversationFile) {
      return null;
    }
    const conversation = this.readConversation();
    const messageIndex = conversation.messages.findIndex(
      (m) => m.id === messageId,
    );

    if (messageIndex === -1) {
      debugLogger.error(
        'Message to rewind to not found in conversation history',
      );
      return conversation;
    }

    conversation.messages = conversation.messages.slice(0, messageIndex);
    this.writeConversation(conversation, { allowEmpty: true });
    return conversation;
  }

  /**
   * Updates the conversation history based on the provided API Content array.
   * This is used to persist changes made to the history (like masking) back to disk.
   */
  updateMessagesFromHistory(history: readonly Content[]): void {
    if (!this.conversationFile) return;

    try {
      this.updateConversation((conversation) => {
        // Create a map of tool results from the API history for quick lookup by call ID.
        // We store the full list of parts associated with each tool call ID to preserve
        // multi-modal data and proper trajectory structure.
        const partsMap = new Map<string, Part[]>();
        for (const content of history) {
          if (content.role === 'user' && content.parts) {
            // Find all unique call IDs in this message
            const callIds = content.parts
              .map((p) => p.functionResponse?.id)
              .filter((id): id is string => !!id);

            if (callIds.length === 0) continue;

            // Use the first ID as a seed to capture any "leading" non-ID parts
            // in this specific content block.
            let currentCallId = callIds[0];
            for (const part of content.parts) {
              if (part.functionResponse?.id) {
                currentCallId = part.functionResponse.id;
              }

              if (!partsMap.has(currentCallId)) {
                partsMap.set(currentCallId, []);
              }
              partsMap.get(currentCallId)!.push(part);
            }
          }
        }

        // Update the conversation records tool results if they've changed.
        for (const message of conversation.messages) {
          if (message.type === 'gemini' && message.toolCalls) {
            for (const toolCall of message.toolCalls) {
              const newParts = partsMap.get(toolCall.id);
              if (newParts !== undefined) {
                // Store the results as proper Parts (including functionResponse)
                // instead of stringifying them as text parts. This ensures the
                // tool trajectory is correctly reconstructed upon session resumption.
                toolCall.result = newParts;
              }
            }
          }
        }
      });
    } catch (error) {
      debugLogger.error(
        'Error updating conversation history from memory.',
        error,
      );
      throw error;
    }
  }
}
