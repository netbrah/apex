/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { GenerateContentResponse } from '@google/genai';
import type { GenerateContentParameters } from '@google/genai';
import type { ContentGeneratorConfig } from '../contentGenerator.js';
import type { Config } from '../../config/config.js';
import type {
  ResponsesApiRequest,
  ResponsesApiReasoning,
  ResponsesApiTextControls,
  ResponsesSSEEvent,
  ResponsesSSEEventType,
  ResponsesApiInputItem,
} from './types.js';
import {
  ResponsesStreamState,
  convertResponsesEventToGemini,
  convertGeminiContentsToResponsesInput,
  convertGeminiToolsToResponsesTools,
} from './responsesConverter.js';
import { buildRuntimeFetchOptions } from '../../utils/runtimeFetchOptions.js';
import { debugLogger } from '../../utils/debugLogger.js';

export interface ResponsesPipelineState {
  lastResponseId: string | null;
  lastInputItemCount: number;
  pendingEncryptedItems: Array<{
    type: string;
    id?: string;
    encrypted_content: string;
    summary?: Array<{ type: string; text: string }>;
  }>;
}

export class ResponsesPipeline {
  private readonly config: ContentGeneratorConfig;
  private readonly cliConfig: Config;
  private readonly state: ResponsesPipelineState = {
    lastResponseId: null,
    lastInputItemCount: 0,
    pendingEncryptedItems: [],
  };
  // TODO(phase3-websocket): Uncomment when proxy WS PR #1530 lands
  // private readonly wsManager: ResponsesWebSocketManager | null;
  // private httpFallback: boolean = false;

  constructor(config: ContentGeneratorConfig, cliConfig: Config) {
    this.config = config;
    this.cliConfig = cliConfig;
    // TODO(phase3-websocket): Init WS manager when responsesTransport !== 'http'
    // this.wsManager = wsManager ?? null;
  }

  async *executeStream(
    request: GenerateContentParameters,
    userPromptId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<GenerateContentResponse> {
    const savedEncrypted = [...this.state.pendingEncryptedItems];
    const fullInputLength = this.computeFullInputLength(request);
    let activeRequest = this.buildRequest(request, userPromptId);
    const streamState = new ResponsesStreamState();
    let yieldedAny = false;

    // TODO(phase3-websocket): Uncomment to enable WS transport with HTTP fallback.
    // When proxy WS PR #1530 lands, this tries WebSocket first. If upgrade fails
    // (426) or retries exhaust, permanently falls back to HTTP SSE for the session.
    // The wsManager is built in responsesWebSocketManager.ts (already tested, dormant).
    //
    // if (this.wsManager?.isWebSocketEnabled() && !this.httpFallback) {
    //   try {
    //     yield* this.streamViaWebSocket(activeRequest, streamState, signal);
    //     this.postStreamUpdate(streamState, fullInputLength);
    //     return;
    //   } catch (e) {
    //     if (isUpgradeRequiredError(e)) {
    //       this.httpFallback = true;
    //       // Fall through to HTTP SSE below
    //     } else if (isRetryableWsError(e)) {
    //       this.httpFallback = true;
    //       // Fall through to HTTP SSE below
    //     } else {
    //       throw e;
    //     }
    //   }
    // }

    try {
      for await (const chunk of this.streamRequest(
        activeRequest,
        streamState,
        signal,
      )) {
        yieldedAny = true;
        yield chunk;
      }
    } catch (error) {
      if (
        !yieldedAny &&
        this.state.lastResponseId &&
        isResponseExpiredError(error)
      ) {
        debugLogger.debug(
          'previous_response_id expired, retrying with full input',
        );
        this.state.lastResponseId = null;
        this.state.lastInputItemCount = 0;
        this.state.pendingEncryptedItems = [...savedEncrypted];
        activeRequest = this.buildRequest(request, userPromptId);
        streamState.reset();
        yield* this.streamRequest(activeRequest, streamState, signal);
      } else {
        throw error;
      }
    }

    if (streamState.responseId) {
      this.state.lastResponseId = streamState.responseId;
      this.state.lastInputItemCount = fullInputLength;
    }
    if (streamState.encryptedContentItems.length > 0) {
      this.state.pendingEncryptedItems.push(
        ...streamState.encryptedContentItems,
      );
    }
  }

  private computeFullInputLength(request: GenerateContentParameters): number {
    const { input } = convertGeminiContentsToResponsesInput(request);
    return input.length + this.state.pendingEncryptedItems.length;
  }

  async execute(
    request: GenerateContentParameters,
    userPromptId: string,
    signal?: AbortSignal,
  ): Promise<GenerateContentResponse> {
    const chunks: GenerateContentResponse[] = [];
    for await (const chunk of this.executeStream(
      request,
      userPromptId,
      signal,
    )) {
      chunks.push(chunk);
    }
    return mergeStreamResponses(chunks);
  }

  private buildRequest(
    request: GenerateContentParameters,
    userPromptId: string,
  ): ResponsesApiRequest {
    const { instructions, input } =
      convertGeminiContentsToResponsesInput(request);
    const tools = convertGeminiToolsToResponsesTools(request);

    let effectiveInput: ResponsesApiInputItem[] = [...input];

    // Drain pending encrypted items into input first
    if (this.state.pendingEncryptedItems.length > 0) {
      effectiveInput = [
        ...this.state.pendingEncryptedItems.map(
          (item) => item as unknown as ResponsesApiInputItem,
        ),
        ...effectiveInput,
      ];
      this.state.pendingEncryptedItems = [];
    }

    // Encrypted content replay and previous_response_id require sticky routing
    // (single deployment) or store=true support on the proxy. When infra doesn't
    // support it, we drain items but don't persist them.
    // TODO: NetApp LLM Proxy may add store=true support soon — when it does,
    // set enableEncryptedContentReplay=true in model config and remove this drain.
    if (!this.config.enableEncryptedContentReplay) {
      this.state.pendingEncryptedItems = [];
    }

    // Use previous_response_id only when there are new items beyond what was already sent
    let previousResponseId: string | undefined;
    if (
      this.state.lastResponseId &&
      effectiveInput.length > this.state.lastInputItemCount
    ) {
      previousResponseId = this.state.lastResponseId;
      effectiveInput = effectiveInput.slice(this.state.lastInputItemCount);
    }

    const reasoning = this.buildReasoning();
    const text = this.buildTextControls();

    const apiRequest: ResponsesApiRequest = {
      model: this.config.model as string,
      input: effectiveInput,
      ...(previousResponseId
        ? { previous_response_id: previousResponseId }
        : {}),
      instructions,
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: true,
      truncation: 'auto',
      stream: true,
      ...(this.config.enableEncryptedContentReplay ? { store: true } : {}),
      prompt_cache_key: userPromptId,
    };

    if (reasoning) {
      apiRequest.reasoning = reasoning;
      apiRequest.include = ['reasoning.encrypted_content'];
    }

    if (text) {
      apiRequest.text = text;
    }

    const serviceTier = this.config.serviceTier;
    if (serviceTier) {
      apiRequest.service_tier = serviceTier as 'auto' | 'priority';
    }

    if (this.config.samplingParams) {
      if (this.config.samplingParams.temperature != null) {
        apiRequest.temperature = this.config.samplingParams.temperature;
      }
      if (this.config.samplingParams.top_p != null) {
        apiRequest.top_p = this.config.samplingParams.top_p;
      }
      if (this.config.samplingParams.max_tokens != null) {
        apiRequest.max_output_tokens = this.config.samplingParams.max_tokens;
      }
    }

    if (this.config.extra_body) {
      for (const [key, value] of Object.entries(this.config.extra_body)) {
        if (!(key in apiRequest)) {
          (apiRequest as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }

    return apiRequest;
  }

  private buildReasoning(): ResponsesApiReasoning | undefined {
    const r = this.config.reasoning;
    if (r === false || r === undefined) return undefined;

    const reasoning: ResponsesApiReasoning = {};
    if (r.effort) reasoning.effort = r.effort;

    if (r.summary) {
      reasoning.summary = r.summary;
    } else if (r.effort) {
      reasoning.summary = 'auto';
    }

    return Object.keys(reasoning).length > 0 ? reasoning : undefined;
  }

  private buildTextControls(): ResponsesApiTextControls | undefined {
    const verbosity = this.config.verbosity;
    if (!verbosity) return undefined;
    return { verbosity: verbosity as 'low' | 'medium' | 'high' };
  }

  private async *streamRequest(
    apiRequest: ResponsesApiRequest,
    streamState: ResponsesStreamState,
    signal?: AbortSignal,
  ): AsyncGenerator<GenerateContentResponse> {
    const baseUrl = (this.config.baseUrl ?? 'https://api.openai.com')
      .replace(/\/v1\/?$/, '')
      .replace(/\/$/, '');
    const url = `${baseUrl}/v1/responses`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };

    const apiKey =
      this.config.apiKey ??
      (this.config.apiKeyEnvKey
        ? process.env[this.config.apiKeyEnvKey]
        : undefined);
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    if (this.config.customHeaders) {
      Object.assign(headers, this.config.customHeaders);
    }

    const body = JSON.stringify(apiRequest);
    debugLogger.debug(`POST ${url}`, body.substring(0, 500));

    const fetchOpts: RequestInit & { dispatcher?: unknown } = {
      method: 'POST',
      headers,
      body,
      signal,
    };

    const runtimeOptions = buildRuntimeFetchOptions(
      'openai',
      this.cliConfig.getProxy(),
    );
    if (runtimeOptions?.fetchOptions?.dispatcher) {
      fetchOpts.dispatcher = runtimeOptions.fetchOptions.dispatcher;
    }

    const response = await fetch(url, fetchOpts as RequestInit);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      const err = new Error(
        `Responses API error ${response.status}: ${errBody.substring(0, 500)}`,
      );
      (err as ResponsesApiError).status = response.status;
      (err as ResponsesApiError).responseBody = errBody;
      throw err;
    }

    if (!response.body) {
      throw new Error('Responses API returned no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType: ResponsesSSEEventType | null = null;
    let dataAccumulator = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim() as ResponsesSSEEventType;
            dataAccumulator = '';
            continue;
          }

          if (line.startsWith('data: ')) {
            const dataContent = line.slice(6);
            if (dataContent === '[DONE]') continue;

            if (currentEventType) {
              dataAccumulator += (dataAccumulator ? '\n' : '') + dataContent;
            } else {
              try {
                const data = JSON.parse(dataContent) as Record<string, unknown>;
                const eventType = data['type'] as
                  | ResponsesSSEEventType
                  | undefined;
                if (eventType) {
                  const sseEvent: ResponsesSSEEvent = {
                    event: eventType,
                    data,
                  };
                  const geminiResp = convertResponsesEventToGemini(
                    sseEvent,
                    this.config.model ?? '',
                    streamState,
                  );
                  if (geminiResp) {
                    yield geminiResp;
                  }
                }
              } catch (err) {
                if (err instanceof SyntaxError) {
                  debugLogger.debug(
                    `Failed to parse SSE data: ${dataContent.substring(0, 200)}`,
                  );
                } else {
                  throw err;
                }
              }
            }
            continue;
          }

          if (line.trim() === '' && currentEventType && dataAccumulator) {
            try {
              const data = JSON.parse(dataAccumulator) as Record<
                string,
                unknown
              >;
              const sseEvent: ResponsesSSEEvent = {
                event: currentEventType,
                data,
              };
              const geminiResp = convertResponsesEventToGemini(
                sseEvent,
                this.config.model ?? '',
                streamState,
              );
              if (geminiResp) {
                yield geminiResp;
              }
            } catch (err) {
              if (err instanceof SyntaxError) {
                debugLogger.debug(
                  `Failed to parse SSE data: ${dataAccumulator.substring(0, 200)}`,
                );
              } else {
                throw err;
              }
            }
            currentEventType = null;
            dataAccumulator = '';
          } else if (line.trim() === '') {
            currentEventType = null;
            dataAccumulator = '';
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  getState(): Readonly<ResponsesPipelineState> {
    return this.state;
  }

  resetState(): void {
    this.state.lastResponseId = null;
    this.state.lastInputItemCount = 0;
    this.state.pendingEncryptedItems = [];
    // TODO(phase3-websocket): Reset WS prefix chain after compaction
    // this.wsManager?.resetAfterCompaction();
  }

  // TODO(phase3-websocket): Uncomment — streams via WebSocket, converts WS JSON
  // frames through the same convertResponsesEventToGemini() converter as HTTP SSE.
  // The WS events use identical types, just different framing (raw JSON vs data: lines).
  //
  // private async *streamViaWebSocket(
  //   apiRequest: ResponsesApiRequest,
  //   streamState: ResponsesStreamState,
  //   signal?: AbortSignal,
  // ): AsyncGenerator<GenerateContentResponse> {
  //   const model = this.config.model;
  //   for await (const wsEvent of this.wsManager!.streamViaWebSocket(
  //     apiRequest,
  //     this.state.lastResponseId,
  //     signal,
  //   )) {
  //     const sseEvent: ResponsesSSEEvent = {
  //       event: wsEvent.type as ResponsesSSEEventType,
  //       data: wsEvent as Record<string, unknown>,
  //     };
  //     const converted = convertResponsesEventToGemini(sseEvent, model, streamState);
  //     if (converted) yield converted;
  //   }
  // }
  //
  // private postStreamUpdate(
  //   streamState: ResponsesStreamState,
  //   fullInputLength: number,
  // ): void {
  //   if (streamState.responseId) {
  //     this.state.lastResponseId = streamState.responseId;
  //     this.state.lastInputItemCount = fullInputLength;
  //   }
  //   if (streamState.encryptedContentItems.length > 0) {
  //     this.state.pendingEncryptedItems.push(...streamState.encryptedContentItems);
  //   }
  // }
}

interface ResponsesApiError extends Error {
  status: number;
  responseBody: string;
}

function isResponseExpiredError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const apiError = error as Partial<ResponsesApiError>;
  if (apiError.status === 404 || apiError.status === 400) {
    const body = apiError.responseBody ?? error.message;
    return (
      body.includes('previous_response_id') ||
      body.includes('response_not_found') ||
      body.includes('expired')
    );
  }
  return false;
}

export function mergeStreamResponses(
  chunks: GenerateContentResponse[],
): GenerateContentResponse {
  if (chunks.length === 0) {
    const empty = new GenerateContentResponse();
    empty.candidates = [];
    return empty;
  }
  if (chunks.length === 1) return chunks[0]!;

  const allParts = chunks.flatMap(
    (c) => c.candidates?.[0]?.content?.parts ?? [],
  );

  const usageChunk = [...chunks].reverse().find((c) => c.usageMetadata);
  const finishChunk = [...chunks]
    .reverse()
    .find((c) => c.candidates?.[0]?.finishReason);
  const finishReason = finishChunk?.candidates?.[0]?.finishReason;

  const merged = new GenerateContentResponse();
  merged.responseId = chunks.find((c) => c.responseId)?.responseId;
  merged.modelVersion = chunks[0]?.modelVersion;
  merged.createTime = chunks[0]?.createTime;
  if (usageChunk?.usageMetadata) {
    merged.usageMetadata = usageChunk.usageMetadata;
  }

  merged.candidates = [
    {
      content: { parts: allParts, role: 'model' as const },
      index: 0,
      safetyRatings: [],
      ...(finishReason ? { finishReason } : {}),
    },
  ];
  return merged;
}
