/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { logs, type LogRecord } from '@opentelemetry/api-logs';
import type { Config } from '../config/config.js';
import { SERVICE_NAME } from './constants.js';
import {
  EVENT_API_ERROR,
  EVENT_API_RESPONSE,
  EVENT_TOOL_CALL,
  EVENT_REWIND,
  type ApiErrorEvent,
  type ApiRequestEvent,
  type ApiResponseEvent,
  type FileOperationEvent,
  type IdeConnectionEvent,
  type StartSessionEvent,
  type ToolCallEvent,
  type UserPromptEvent,
  type FlashFallbackEvent,
  type NextSpeakerCheckEvent,
  type LoopDetectedEvent,
  type LoopDetectionDisabledEvent,
  type SlashCommandEvent,
  type RewindEvent,
  type ConversationFinishedEvent,
  type ChatCompressionEvent,
  type MalformedJsonResponseEvent,
  type InvalidChunkEvent,
  type ContentRetryEvent,
  type ContentRetryFailureEvent,
  type NetworkRetryAttemptEvent,
  type RipgrepFallbackEvent,
  type ToolOutputTruncatedEvent,
  type ModelRoutingEvent,
  type ExtensionDisableEvent,
  type ExtensionEnableEvent,
  type ExtensionUninstallEvent,
  type ExtensionInstallEvent,
  type ModelSlashCommandEvent,
  type EditStrategyEvent,
  type EditCorrectionEvent,
  type AgentStartEvent,
  type AgentFinishEvent,
  type RecoveryAttemptEvent,
  type WebFetchFallbackAttemptEvent,
  type ExtensionUpdateEvent,
  type ApprovalModeSwitchEvent,
  type ApprovalModeDurationEvent,
  type HookCallEvent,
  type StartupStatsEvent,
  type LlmLoopCheckEvent,
  type PlanExecutionEvent,
  type ToolOutputMaskingEvent,
  type KeychainAvailabilityEvent,
  type TokenStorageInitializationEvent,
  type OnboardingStartEvent,
  type OnboardingSuccessEvent,
} from './types.js';
import {
  recordApiErrorMetrics,
  recordToolCallMetrics,
  recordChatCompressionMetrics,
  recordFileOperationMetric,
  recordRetryAttemptMetrics,
  recordContentRetry,
  recordContentRetryFailure,
  recordModelRoutingMetrics,
  recordModelSlashCommand,
  getConventionAttributes,
  recordTokenUsageMetrics,
  recordApiResponseMetrics,
  recordAgentRunMetrics,
  recordRecoveryAttemptMetrics,
  recordLinesChanged,
  recordHookCallMetrics,
  recordPlanExecution,
  recordKeychainAvailability,
  recordTokenStorageInitialization,
  recordInvalidChunk,
  recordOnboardingStart,
  recordOnboardingSuccess,
} from './metrics.js';
import { bufferTelemetryEvent } from './sdk.js';
import { uiTelemetryService, type UiEvent } from './uiTelemetry.js';
import { ClearcutLogger } from './clearcut-logger/clearcut-logger.js';
import { debugLogger } from '../utils/debugLogger.js';
import type { BillingTelemetryEvent } from './billingEvents.js';
import {
  CreditsUsedEvent,
  OverageOptionSelectedEvent,
  EmptyWalletMenuShownEvent,
  CreditPurchaseClickEvent,
} from './billingEvents.js';

export { getCommonAttributes };

export function logStartSession(
  config: Config,
  event: StartSessionEvent,
): void {
  void ClearcutLogger.getInstance(config)?.logStartSessionEvent(event);
  bufferTelemetryEvent(() => {
    // Wait for experiments to load before emitting so we capture experimentIds
    void config
      .getExperimentsAsync()
      .then(() => {
        const logger = logs.getLogger(SERVICE_NAME);
        const logRecord: LogRecord = {
          body: event.toLogBody(),
          attributes: event.toOpenTelemetryAttributes(config),
        };
        logger.emit(logRecord);
      })
      .catch((e: unknown) => {
        debugLogger.error('Failed to log telemetry event', e);
      });
  });
}

export function logUserPrompt(config: Config, event: UserPromptEvent): void {
  ClearcutLogger.getInstance(config)?.logNewPromptEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);

    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logUserRetry(config: Config, event: UserRetryEvent): void {
  ApexLogger.getInstance(config)?.logRetryEvent(event);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    'event.name': EVENT_USER_RETRY,
    'event.timestamp': new Date().toISOString(),
    prompt_id: event.prompt_id,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `User retry.`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logToolCall(config: Config, event: ToolCallEvent): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const uiEvent = {
    // eslint-disable-next-line @typescript-eslint/no-misused-spread
    ...event,
    'event.name': EVENT_TOOL_CALL,
    'event.timestamp': new Date().toISOString(),
  } as UiEvent;
  uiTelemetryService.addEvent(uiEvent);
  ClearcutLogger.getInstance(config)?.logToolCallEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
    recordToolCallMetrics(config, event.duration_ms, {
      function_name: event.function_name,
      success: event.success,
      decision: event.decision,
      tool_type: event.tool_type,
    });

    if (event.metadata) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const added = event.metadata['model_added_lines'];
      if (typeof added === 'number' && added > 0) {
        recordLinesChanged(config, added, 'added', {
          function_name: event.function_name,
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const removed = event.metadata['model_removed_lines'];
      if (typeof removed === 'number' && removed > 0) {
        recordLinesChanged(config, removed, 'removed', {
          function_name: event.function_name,
        });
      }
    }
  });
}

export function logToolOutputTruncated(
  config: Config,
  event: ToolOutputTruncatedEvent,
): void {
  ClearcutLogger.getInstance(config)?.logToolOutputTruncatedEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logToolOutputMasking(
  config: Config,
  event: ToolOutputMaskingEvent,
): void {
  ClearcutLogger.getInstance(config)?.logToolOutputMaskingEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logFileOperation(
  config: Config,
  event: FileOperationEvent,
): void {
  ClearcutLogger.getInstance(config)?.logFileOperationEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);

    recordFileOperationMetric(config, {
      operation: event.operation,
      lines: event.lines,
      mimetype: event.mimetype,
      extension: event.extension,
      programming_language: event.programming_language,
    });
  });
}

export function logApiRequest(config: Config, event: ApiRequestEvent): void {
  ClearcutLogger.getInstance(config)?.logApiRequestEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    logger.emit(event.toLogRecord(config));
    logger.emit(event.toSemanticLogRecord(config));
  });
}

export function logFlashFallback(
  config: Config,
  event: FlashFallbackEvent,
): void {
  ClearcutLogger.getInstance(config)?.logFlashFallbackEvent();
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logRipgrepFallback(
  config: Config,
  event: RipgrepFallbackEvent,
): void {
  ClearcutLogger.getInstance(config)?.logRipgrepFallbackEvent();
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logRipgrepFallback(
  config: Config,
  event: RipgrepFallbackEvent,
): void {
  ApexLogger.getInstance(config)?.logRipgrepFallbackEvent(event);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_RIPGREP_FALLBACK,
    'event.timestamp': new Date().toISOString(),
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Switching to grep as fallback.`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logApiError(config: Config, event: ApiErrorEvent): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const uiEvent = {
    // eslint-disable-next-line @typescript-eslint/no-misused-spread
    ...event,
    'event.name': EVENT_API_ERROR,
    'event.timestamp': new Date().toISOString(),
  } as UiEvent;
  uiTelemetryService.addEvent(uiEvent);
  ClearcutLogger.getInstance(config)?.logApiErrorEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    logger.emit(event.toLogRecord(config));
    logger.emit(event.toSemanticLogRecord(config));

    recordApiErrorMetrics(config, event.duration_ms, {
      model: event.model,
      status_code: event.status_code,
      error_type: event.error_type,
    });

    // Record GenAI operation duration for errors
    recordApiResponseMetrics(config, event.duration_ms, {
      model: event.model,
      status_code: event.status_code,
      genAiAttributes: {
        ...getConventionAttributes(event),
        'error.type': event.error_type || 'unknown',
      },
    });
  });
}

export function logApiResponse(config: Config, event: ApiResponseEvent): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const uiEvent = {
    // eslint-disable-next-line @typescript-eslint/no-misused-spread
    ...event,
    'event.name': EVENT_API_RESPONSE,
    'event.timestamp': new Date().toISOString(),
  } as UiEvent;
  uiTelemetryService.addEvent(uiEvent);
  ClearcutLogger.getInstance(config)?.logApiResponseEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    logger.emit(event.toLogRecord(config));
    logger.emit(event.toSemanticLogRecord(config));

    const conventionAttributes = getConventionAttributes(event);

    recordApiResponseMetrics(config, event.duration_ms, {
      model: event.model,
      status_code: event.status_code,
      genAiAttributes: conventionAttributes,
    });

    const tokenUsageData = [
      { count: event.usage.input_token_count, type: 'input' as const },
      { count: event.usage.output_token_count, type: 'output' as const },
      { count: event.usage.cached_content_token_count, type: 'cache' as const },
      { count: event.usage.thoughts_token_count, type: 'thought' as const },
      { count: event.usage.tool_token_count, type: 'tool' as const },
    ];

    for (const { count, type } of tokenUsageData) {
      recordTokenUsageMetrics(config, count, {
        model: event.model,
        type,
        genAiAttributes: conventionAttributes,
      });
    }
  });
}

export function logLoopDetected(
  config: Config,
  event: LoopDetectedEvent,
): void {
  ClearcutLogger.getInstance(config)?.logLoopDetectedEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logLoopDetectionDisabled(
  config: Config,
  event: LoopDetectionDisabledEvent,
): void {
  ClearcutLogger.getInstance(config)?.logLoopDetectionDisabledEvent();
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logLoopDetectionDisabled(
  config: Config,
  _event: LoopDetectionDisabledEvent,
): void {
  ApexLogger.getInstance(config)?.logLoopDetectionDisabledEvent();
}

export function logNextSpeakerCheck(
  config: Config,
  event: NextSpeakerCheckEvent,
): void {
  ClearcutLogger.getInstance(config)?.logNextSpeakerCheck(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logSlashCommand(
  config: Config,
  event: SlashCommandEvent,
): void {
  ClearcutLogger.getInstance(config)?.logSlashCommandEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logRewind(config: Config, event: RewindEvent): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const uiEvent = {
    // eslint-disable-next-line @typescript-eslint/no-misused-spread
    ...event,
    'event.name': EVENT_REWIND,
    'event.timestamp': new Date().toISOString(),
  } as UiEvent;
  uiTelemetryService.addEvent(uiEvent);
  ClearcutLogger.getInstance(config)?.logRewindEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logIdeConnection(
  config: Config,
  event: IdeConnectionEvent,
): void {
  ClearcutLogger.getInstance(config)?.logIdeConnectionEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logConversationFinishedEvent(
  config: Config,
  event: ConversationFinishedEvent,
): void {
  ClearcutLogger.getInstance(config)?.logConversationFinishedEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logChatCompression(
  config: Config,
  event: ChatCompressionEvent,
): void {
  ApexLogger.getInstance(config)?.logChatCompressionEvent(event);

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: event.toLogBody(),
    attributes: event.toOpenTelemetryAttributes(config),
  };
  logger.emit(logRecord);

  recordChatCompressionMetrics(config, {
    tokens_before: event.tokens_before,
    tokens_after: event.tokens_after,
  });
}

export function logMalformedJsonResponse(
  config: Config,
  event: MalformedJsonResponseEvent,
): void {
  ClearcutLogger.getInstance(config)?.logMalformedJsonResponseEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logInvalidChunk(
  config: Config,
  event: InvalidChunkEvent,
): void {
  ClearcutLogger.getInstance(config)?.logInvalidChunkEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
    recordInvalidChunk(config);
  });
}

export function logNetworkRetryAttempt(
  config: Config,
  event: NetworkRetryAttemptEvent,
): void {
  ClearcutLogger.getInstance(config)?.logNetworkRetryAttemptEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
    recordRetryAttemptMetrics(config, {
      model: event.model,
      attempt: event.attempt,
    });
  });
}

export function logContentRetry(
  config: Config,
  event: ContentRetryEvent,
): void {
  ClearcutLogger.getInstance(config)?.logContentRetryEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
    recordContentRetry(config);
  });
}

export function logContentRetryFailure(
  config: Config,
  event: ContentRetryFailureEvent,
): void {
  ClearcutLogger.getInstance(config)?.logContentRetryFailureEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
    recordContentRetryFailure(config);
  });
}

export function logModelRouting(
  config: Config,
  event: ModelRoutingEvent,
): void {
  ClearcutLogger.getInstance(config)?.logModelRoutingEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
    recordModelRoutingMetrics(config, event);
  });
}

export function logModelSlashCommand(
  config: Config,
  event: ModelSlashCommandEvent,
): void {
  ClearcutLogger.getInstance(config)?.logModelSlashCommandEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
    recordModelSlashCommand(config, event);
  });
}

export async function logExtensionInstallEvent(
  config: Config,
  event: ExtensionInstallEvent,
): Promise<void> {
  await ClearcutLogger.getInstance(config)?.logExtensionInstallEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export async function logExtensionUninstall(
  config: Config,
  event: ExtensionUninstallEvent,
): Promise<void> {
  await ClearcutLogger.getInstance(config)?.logExtensionUninstallEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export async function logExtensionUpdateEvent(
  config: Config,
  event: ExtensionUpdateEvent,
): Promise<void> {
  await ClearcutLogger.getInstance(config)?.logExtensionUpdateEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export async function logExtensionEnable(
  config: Config,
  event: ExtensionEnableEvent,
): Promise<void> {
  await ClearcutLogger.getInstance(config)?.logExtensionEnableEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export async function logExtensionDisable(
  config: Config,
  event: ExtensionDisableEvent,
): Promise<void> {
  await ClearcutLogger.getInstance(config)?.logExtensionDisableEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logEditStrategy(
  config: Config,
  event: EditStrategyEvent,
): void {
  ClearcutLogger.getInstance(config)?.logEditStrategyEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logEditCorrectionEvent(
  config: Config,
  event: EditCorrectionEvent,
): void {
  ClearcutLogger.getInstance(config)?.logEditCorrectionEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logAgentStart(config: Config, event: AgentStartEvent): void {
  ClearcutLogger.getInstance(config)?.logAgentStartEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logAgentFinish(config: Config, event: AgentFinishEvent): void {
  ClearcutLogger.getInstance(config)?.logAgentFinishEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);

    recordAgentRunMetrics(config, event);
  });
}

export function logRecoveryAttempt(
  config: Config,
  event: RecoveryAttemptEvent,
): void {
  ClearcutLogger.getInstance(config)?.logRecoveryAttemptEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);

    recordRecoveryAttemptMetrics(config, event);
  });
}

export function logWebFetchFallbackAttempt(
  config: Config,
  event: WebFetchFallbackAttemptEvent,
): void {
  ClearcutLogger.getInstance(config)?.logWebFetchFallbackAttemptEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logLlmLoopCheck(
  config: Config,
  event: LlmLoopCheckEvent,
): void {
  ClearcutLogger.getInstance(config)?.logLlmLoopCheckEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });
}

export function logApprovalModeSwitch(
  config: Config,
  event: ApprovalModeSwitchEvent,
) {
  ClearcutLogger.getInstance(config)?.logApprovalModeSwitchEvent(event);
  bufferTelemetryEvent(() => {
    logs.getLogger(SERVICE_NAME).emit({
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    });
  });
}

export function logApprovalModeDuration(
  config: Config,
  event: ApprovalModeDurationEvent,
) {
  ClearcutLogger.getInstance(config)?.logApprovalModeDurationEvent(event);
  bufferTelemetryEvent(() => {
    logs.getLogger(SERVICE_NAME).emit({
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    });
  });
}

export function logPlanExecution(config: Config, event: PlanExecutionEvent) {
  ClearcutLogger.getInstance(config)?.logPlanExecutionEvent(event);
  bufferTelemetryEvent(() => {
    logs.getLogger(SERVICE_NAME).emit({
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    });

    recordPlanExecution(config, {
      approval_mode: event.approval_mode,
    });
  });
}

export function logHookCall(config: Config, event: HookCallEvent): void {
  ClearcutLogger.getInstance(config)?.logHookCallEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);

    recordHookCallMetrics(
      config,
      event.hook_event_name,
      event.hook_name,
      event.duration_ms,
      event.success,
    );
  });
}

export function logStartupStats(
  config: Config,
  event: StartupStatsEvent,
): void {
  ClearcutLogger.getInstance(config)?.logStartupStatsEvent(event);
  bufferTelemetryEvent(() => {
    // Wait for experiments to load before emitting so we capture experimentIds
    void config
      .getExperimentsAsync()
      .then(() => {
        const logger = logs.getLogger(SERVICE_NAME);
        const logRecord: LogRecord = {
          body: event.toLogBody(),
          attributes: event.toOpenTelemetryAttributes(config),
        };
        logger.emit(logRecord);
      })
      .catch((e: unknown) => {
        debugLogger.error('Failed to log telemetry event', e);
      });
  });
}

export function logKeychainAvailability(
  config: Config,
  event: KeychainAvailabilityEvent,
): void {
  ClearcutLogger.getInstance(config)?.logKeychainAvailabilityEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);

    recordKeychainAvailability(config, event);
  });
}

export function logTokenStorageInitialization(
  config: Config,
  event: TokenStorageInitializationEvent,
): void {
  ClearcutLogger.getInstance(config)?.logTokenStorageInitializationEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);

    recordTokenStorageInitialization(config, event);
  });
}

export function logOnboardingStart(
  config: Config,
  event: OnboardingStartEvent,
): void {
  ClearcutLogger.getInstance(config)?.logOnboardingStartEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);

    recordOnboardingStart(config);
  });
}

export function logOnboardingSuccess(
  config: Config,
  event: OnboardingSuccessEvent,
): void {
  ClearcutLogger.getInstance(config)?.logOnboardingSuccessEvent(event);
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);

    recordOnboardingSuccess(config, event.userTier, event.duration_ms);
  });
}

export function logBillingEvent(
  config: Config,
  event: BillingTelemetryEvent,
): void {
  bufferTelemetryEvent(() => {
    const logger = logs.getLogger(SERVICE_NAME);
    const logRecord: LogRecord = {
      body: event.toLogBody(),
      attributes: event.toOpenTelemetryAttributes(config),
    };
    logger.emit(logRecord);
  });

  const cc = ClearcutLogger.getInstance(config);
  if (cc) {
    if (event instanceof CreditsUsedEvent) {
      cc.logCreditsUsedEvent(event);
    } else if (event instanceof OverageOptionSelectedEvent) {
      cc.logOverageOptionSelectedEvent(event);
    } else if (event instanceof EmptyWalletMenuShownEvent) {
      cc.logEmptyWalletMenuShownEvent(event);
    } else if (event instanceof CreditPurchaseClickEvent) {
      cc.logCreditPurchaseClickEvent(event);
    }
  }
}

export function logSubagentExecution(
  config: Config,
  event: SubagentExecutionEvent,
): void {
  ApexLogger.getInstance(config)?.logSubagentExecutionEvent(event);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_SUBAGENT_EXECUTION,
    'event.timestamp': new Date().toISOString(),
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Subagent execution: ${event.subagent_name}.`,
    attributes,
  };
  logger.emit(logRecord);
  recordSubagentExecutionMetrics(
    config,
    event.subagent_name,
    event.status,
    event.terminate_reason,
  );
}

export function logModelSlashCommand(
  config: Config,
  event: ModelSlashCommandEvent,
): void {
  ApexLogger.getInstance(config)?.logModelSlashCommandEvent(event);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_MODEL_SLASH_COMMAND,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Model slash command. Model: ${event.model_name}`,
    attributes,
  };
  logger.emit(logRecord);
  recordModelSlashCommand(config, event);
}

export function logHookCall(config: Config, event: HookCallEvent): void {
  // Log to ApexLogger for RUM telemetry only
  ApexLogger.getInstance(config)?.logHookCallEvent(event);
}

export function logExtensionInstallEvent(
  config: Config,
  event: ExtensionInstallEvent,
): void {
  ApexLogger.getInstance(config)?.logExtensionInstallEvent(event);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_EXTENSION_INSTALL,
    'event.timestamp': new Date().toISOString(),
    extension_name: event.extension_name,
    extension_version: event.extension_version,
    extension_source: event.extension_source,
    status: event.status,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Installed extension ${event.extension_name}`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logExtensionUninstall(
  config: Config,
  event: ExtensionUninstallEvent,
): void {
  ApexLogger.getInstance(config)?.logExtensionUninstallEvent(event);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_EXTENSION_UNINSTALL,
    'event.timestamp': new Date().toISOString(),
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Uninstalled extension ${event.extension_name}`,
    attributes,
  };
  logger.emit(logRecord);
}

export async function logExtensionUpdateEvent(
  config: Config,
  event: ExtensionUpdateEvent,
): Promise<void> {
  ApexLogger.getInstance(config)?.logExtensionUpdateEvent(event);

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_EXTENSION_UPDATE,
    'event.timestamp': new Date().toISOString(),
    extension_name: event.extension_name,
    extension_id: event.extension_id,
    extension_previous_version: event.extension_previous_version,
    extension_version: event.extension_version,
    extension_source: event.extension_source,
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Updated extension ${event.extension_name} from ${event.extension_previous_version} to ${event.extension_version}`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logExtensionEnable(
  config: Config,
  event: ExtensionEnableEvent,
): void {
  ApexLogger.getInstance(config)?.logExtensionEnableEvent(event);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_EXTENSION_ENABLE,
    'event.timestamp': new Date().toISOString(),
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Enabled extension ${event.extension_name}`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logExtensionDisable(
  config: Config,
  event: ExtensionDisableEvent,
): void {
  ApexLogger.getInstance(config)?.logExtensionDisableEvent(event);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_EXTENSION_DISABLE,
    'event.timestamp': new Date().toISOString(),
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Disabled extension ${event.extension_name}`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logAuth(config: Config, event: AuthEvent): void {
  ApexLogger.getInstance(config)?.logAuthEvent(event);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_AUTH,
    'event.timestamp': new Date().toISOString(),
    auth_type: event.auth_type,
    action_type: event.action_type,
    status: event.status,
  };

  if (event.error_message) {
    attributes['error.message'] = event.error_message;
  }

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Auth event: ${event.action_type} ${event.status} for ${event.auth_type}`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logSkillLaunch(config: Config, event: SkillLaunchEvent): void {
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_SKILL_LAUNCH,
    'event.timestamp': new Date().toISOString(),
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Skill launch: ${event.skill_name}. Success: ${event.success}.`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logUserFeedback(
  config: Config,
  event: UserFeedbackEvent,
): void {
  const uiEvent = {
    ...event,
    'event.name': EVENT_USER_FEEDBACK,
    'event.timestamp': new Date().toISOString(),
  } as UiEvent;
  uiTelemetryService.addEvent(uiEvent);
  config.getChatRecordingService()?.recordUiTelemetryEvent(uiEvent);
  ApexLogger.getInstance(config)?.logUserFeedbackEvent(event);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_USER_FEEDBACK,
    'event.timestamp': new Date().toISOString(),
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `User feedback: Rating ${event.rating} for session ${event.session_id}.`,
    attributes,
  };
  logger.emit(logRecord);
}

export function logArenaSessionStarted(
  config: Config,
  event: ArenaSessionStartedEvent,
): void {
  ApexLogger.getInstance(config)?.logArenaSessionStartedEvent(event);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    model_ids: JSON.stringify(event.model_ids),
    'event.name': EVENT_ARENA_SESSION_STARTED,
    'event.timestamp': new Date().toISOString(),
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Arena session started. Agents: ${event.model_ids.length}.`,
    attributes,
  };
  logger.emit(logRecord);
  recordArenaSessionStartedMetrics(config);
}

export function logArenaAgentCompleted(
  config: Config,
  event: ArenaAgentCompletedEvent,
): void {
  ApexLogger.getInstance(config)?.logArenaAgentCompletedEvent(event);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_ARENA_AGENT_COMPLETED,
    'event.timestamp': new Date().toISOString(),
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Arena agent ${event.agent_model_id} ${event.status}. Duration: ${event.duration_ms}ms. Tokens: ${event.total_tokens}.`,
    attributes,
  };
  logger.emit(logRecord);
  recordArenaAgentCompletedMetrics(
    config,
    event.agent_model_id,
    event.status,
    event.duration_ms,
    event.input_tokens,
    event.output_tokens,
  );
}

export function logArenaSessionEnded(
  config: Config,
  event: ArenaSessionEndedEvent,
): void {
  ApexLogger.getInstance(config)?.logArenaSessionEndedEvent(event);
  if (!isTelemetrySdkInitialized()) return;

  const attributes: LogAttributes = {
    ...getCommonAttributes(config),
    ...event,
    'event.name': EVENT_ARENA_SESSION_ENDED,
    'event.timestamp': new Date().toISOString(),
  };

  const logger = logs.getLogger(SERVICE_NAME);
  const logRecord: LogRecord = {
    body: `Arena session ended: ${event.status}.${event.winner_model_id ? ` Winner: ${event.winner_model_id}.` : ''}`,
    attributes,
  };
  logger.emit(logRecord);
  recordArenaSessionEndedMetrics(
    config,
    event.status,
    event.display_backend,
    event.duration_ms,
    event.winner_model_id,
  );
}
