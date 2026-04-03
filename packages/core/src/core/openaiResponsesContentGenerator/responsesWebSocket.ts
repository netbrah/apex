/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import WebSocket from 'ws';
import type {
  ResponseCreateWsRequest,
  ResponsesWsEvent,
  WebSocketOptions,
  WrappedWebsocketError,
} from './wsTypes.js';
import {
  WS_DEFAULT_CONNECT_TIMEOUT,
  WS_DEFAULT_IDLE_TIMEOUT,
  WS_CONNECTION_TTL,
  isWrappedWebsocketError,
  isConnectionLimitError,
} from './wsTypes.js';
import { debugLogger } from '../../utils/debugLogger.js';

export interface WebSocketUpgradeHeaders {
  serverReasoningIncluded: boolean;
  serverModel: string | null;
  modelsEtag: string | null;
  turnState: string | null;
}

export class ResponsesWebSocket {
  private ws: WebSocket | null = null;
  private connectTimeout: number;
  private idleTimeout: number;
  private perMessageDeflate: boolean;
  private connectionStartTime: number = 0;
  upgradeHeaders: WebSocketUpgradeHeaders = {
    serverReasoningIncluded: false,
    serverModel: null,
    modelsEtag: null,
    turnState: null,
  };

  constructor(options?: WebSocketOptions) {
    this.connectTimeout = options?.connectTimeout ?? WS_DEFAULT_CONNECT_TIMEOUT;
    this.idleTimeout = options?.idleTimeout ?? WS_DEFAULT_IDLE_TIMEOUT;
    this.perMessageDeflate = options?.perMessageDeflate ?? true;
  }

  async connect(url: string, headers: Record<string, string>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.ws) {
          this.ws.terminate();
          this.ws = null;
        }
        reject(
          new Error(`WebSocket connect timeout after ${this.connectTimeout}ms`),
        );
      }, this.connectTimeout);

      const ws = new WebSocket(url, {
        headers,
        perMessageDeflate: this.perMessageDeflate,
      });

      ws.on('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        this.connectionStartTime = Date.now();
        debugLogger.debug('WebSocket connected to %s', url);
        resolve();
      });

      ws.on('upgrade', (response) => {
        const h = response.headers;
        const str = (v: string | string[] | undefined): string | null => {
          if (Array.isArray(v)) return v[0] ?? null;
          return v ?? null;
        };
        this.upgradeHeaders = {
          serverReasoningIncluded: str(h['x-reasoning-included']) === 'true',
          serverModel: str(h['openai-model']),
          modelsEtag: str(h['x-models-etag']),
          turnState: str(h['x-codex-turn-state']),
        };
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        this.ws = null;
        reject(err);
      });
    });
  }

  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  isConnectionExpired(): boolean {
    if (this.connectionStartTime === 0) return false;
    return Date.now() - this.connectionStartTime >= WS_CONNECTION_TTL;
  }

  async *streamRequest(
    request: ResponseCreateWsRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ResponsesWsEvent> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const ws = this.ws;
    const requestText = JSON.stringify(request);
    debugLogger.debug('Sending request: %s bytes', requestText.length);
    ws.send(requestText);

    const idleTimeout = this.idleTimeout;

    try {
      while (true) {
        if (signal?.aborted) {
          throw new Error('Request aborted');
        }

        const message = await this.receiveMessage(ws, idleTimeout, signal);

        if (message.type === 'close') {
          throw new Error(
            'WebSocket closed by server before response.completed',
          );
        }

        if (message.type === 'binary') {
          throw new Error('Unexpected binary WebSocket event');
        }

        if (message.type === 'text') {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const parsed = JSON.parse(message.data) as Record<string, unknown>;

          if (isWrappedWebsocketError(parsed)) {
            if (isConnectionLimitError(parsed)) {
              const error = new Error(
                (parsed as WrappedWebsocketError).error.message,
              );
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              (error as Error & { code: string }).code =
                'websocket_connection_limit_reached';
              throw error;
            }
            const wsError = parsed as WrappedWebsocketError;
            const error = new Error(wsError.error.message);
            (error as Error & { status?: number }).status = wsError.status;
            throw error;
          }

          const event: ResponsesWsEvent = {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            type: parsed['type'] as ResponsesWsEvent['type'],
            ...parsed,
          };
          yield event;

          if (
            event.type === 'response.completed' ||
            event.type === 'response.failed' ||
            event.type === 'response.incomplete'
          ) {
            break;
          }
        }
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      debugLogger.debug('Stream error: %s', (err as Error).message);
      throw err;
    }
  }

  private receiveMessage(
    ws: WebSocket,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<
    { type: 'text'; data: string } | { type: 'binary' } | { type: 'close' }
  > {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Idle timeout waiting for WebSocket message (${timeoutMs}ms)`,
          ),
        );
      }, timeoutMs);

      const onAbort = () => {
        cleanup();
        reject(new Error('Request aborted'));
      };

      const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
        cleanup();
        if (isBinary) {
          resolve({ type: 'binary' });
        } else {
          resolve({ type: 'text', data: data.toString() });
        }
      };

      const onClose = () => {
        cleanup();
        resolve({ type: 'close' });
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        clearTimeout(timer);
        ws.removeListener('message', onMessage);
        ws.removeListener('close', onClose);
        ws.removeListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };

      ws.on('message', onMessage);
      ws.on('close', onClose);
      ws.on('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async close(): Promise<void> {
    if (this.ws) {
      debugLogger.debug('Closing WebSocket connection');
      const ws = this.ws;
      this.ws = null;
      return new Promise<void>((resolve) => {
        let resolved = false;
        const done = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };
        ws.on('close', done);
        ws.close(1000, 'Client closing');
        setTimeout(() => {
          ws.terminate();
          done();
        }, 3000);
      });
    }
  }
}
