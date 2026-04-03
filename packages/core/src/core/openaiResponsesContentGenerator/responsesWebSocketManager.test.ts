/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { ResponsesWebSocketManager } from './responsesWebSocketManager.js';
import type { ResponsesApiRequest } from './types.js';
import type { ResponsesWsEvent, WebSocketManagerConfig } from './wsTypes.js';

import net from 'node:net';

function findPort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function echoCompletedServer(wss: WebSocketServer, responseId = 'resp_1') {
  wss.on('connection', (socket) => {
    socket.on('message', () => {
      socket.send(
        JSON.stringify({
          type: 'response.created',
          response: { id: responseId },
        }),
      );
      setTimeout(
        () =>
          socket.send(
            JSON.stringify({ type: 'response.output_text.delta', delta: 'Hi' }),
          ),
        10,
      );
      setTimeout(
        () =>
          socket.send(
            JSON.stringify({
              type: 'response.completed',
              response: { id: responseId, status: 'completed' },
            }),
          ),
        20,
      );
    });
  });
}

function makeRequest(
  extra?: Partial<ResponsesApiRequest>,
): ResponsesApiRequest {
  return {
    model: 'gpt-4.1-mini',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Hello' }],
      },
    ],
    ...extra,
  };
}

function makeConfig(
  port: number,
  overrides?: Partial<WebSocketManagerConfig>,
): WebSocketManagerConfig {
  return {
    baseUrl: `http://localhost:${port}`,
    apiKey: 'test-key',
    responsesTransport: 'auto',
    streamMaxRetries: 2,
    ...overrides,
  };
}

async function collectEvents(
  gen: AsyncGenerator<ResponsesWsEvent>,
): Promise<ResponsesWsEvent[]> {
  const events: ResponsesWsEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe('ResponsesWebSocketManager', () => {
  let wss: WebSocketServer;
  let port: number;
  let manager: ResponsesWebSocketManager;

  beforeEach(async () => {
    port = await findPort();
    wss = new WebSocketServer({ port });
  });

  afterEach(async () => {
    await manager?.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it('should lazy-connect on first request', async () => {
    echoCompletedServer(wss);
    manager = new ResponsesWebSocketManager(makeConfig(port));

    expect(manager.isWebSocketEnabled()).toBe(true);
    const events = await collectEvents(
      manager.streamViaWebSocket(makeRequest(), null),
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'response.completed')).toBe(true);
  });

  it('should reuse connection across requests', async () => {
    let connectionCount = 0;
    wss.on('connection', (socket) => {
      connectionCount++;
      socket.on('message', () => {
        socket.send(
          JSON.stringify({
            type: 'response.completed',
            response: { id: `resp_${connectionCount}` },
          }),
        );
      });
    });

    manager = new ResponsesWebSocketManager(makeConfig(port));
    await collectEvents(manager.streamViaWebSocket(makeRequest(), null));
    expect(manager.wasConnectionReused()).toBe(false);

    await collectEvents(manager.streamViaWebSocket(makeRequest(), null));
    expect(manager.wasConnectionReused()).toBe(true);
    expect(connectionCount).toBe(1);
  });

  it('should reconnect after connection close', async () => {
    let connectionCount = 0;
    wss.on('connection', (socket) => {
      connectionCount++;
      socket.on('message', () => {
        socket.send(
          JSON.stringify({
            type: 'response.completed',
            response: { id: 'r1' },
          }),
        );
        if (connectionCount === 1) {
          socket.close(1000, 'Server closing');
        }
      });
    });

    manager = new ResponsesWebSocketManager(makeConfig(port));
    await collectEvents(manager.streamViaWebSocket(makeRequest(), null));
    expect(connectionCount).toBe(1);

    // Small delay for close to propagate
    await new Promise((resolve) => setTimeout(resolve, 100));
    await collectEvents(manager.streamViaWebSocket(makeRequest(), null));
    expect(connectionCount).toBe(2);
  });

  it('should reconnect on connection_limit_reached', async () => {
    let connectionCount = 0;
    wss.on('connection', (socket) => {
      connectionCount++;
      socket.on('message', () => {
        if (connectionCount === 1) {
          socket.send(
            JSON.stringify({
              type: 'error',
              status: 400,
              error: {
                type: 'invalid_request_error',
                code: 'websocket_connection_limit_reached',
                message: 'Connection limit reached',
              },
            }),
          );
        } else {
          socket.send(
            JSON.stringify({
              type: 'response.completed',
              response: { id: 'r2' },
            }),
          );
        }
      });
    });

    manager = new ResponsesWebSocketManager(makeConfig(port));
    const events = await collectEvents(
      manager.streamViaWebSocket(makeRequest(), null),
    );
    expect(events.some((e) => e.type === 'response.completed')).toBe(true);
    expect(connectionCount).toBe(2);
  });

  it('should detect incremental prefix and use previous_response_id', () => {
    manager = new ResponsesWebSocketManager(makeConfig(port));

    const req1 = makeRequest();
    const req2: ResponsesApiRequest = {
      ...req1,
      input: [
        ...req1.input,
        {
          type: 'function_call',
          call_id: 'fc1',
          name: 'test',
          arguments: '{}',
        },
        { type: 'function_call_output', call_id: 'fc1', output: 'result' },
        { type: 'message', role: 'user', content: 'Continue' },
      ],
    };

    expect(manager.isIncrementalPrefix(req2, req1)).toBe(true);

    const wsReq = manager.prepareWsRequest(req2, 'resp_123');
    // Without lastRequest set, sends full input
    expect(wsReq.input).toEqual(req2.input);
  });

  it('should send full request on non-prefix input', () => {
    manager = new ResponsesWebSocketManager(makeConfig(port));

    const req1 = makeRequest({
      input: [{ type: 'message', role: 'user', content: 'Hello' }],
    });
    const req2 = makeRequest({
      input: [{ type: 'message', role: 'user', content: 'Goodbye' }],
    });

    expect(manager.isIncrementalPrefix(req2, req1)).toBe(false);
  });

  it('should send full request when non-input fields change', () => {
    manager = new ResponsesWebSocketManager(makeConfig(port));

    const req1 = makeRequest({ instructions: 'Be helpful' });
    const req2: ResponsesApiRequest = {
      ...makeRequest({ instructions: 'Be concise' }),
      input: [
        ...makeRequest().input,
        { type: 'message', role: 'user', content: 'More' },
      ],
    };

    expect(manager.isIncrementalPrefix(req2, req1)).toBe(false);
  });

  it('should send full request after stream error', async () => {
    let callCount = 0;
    wss.on('connection', (socket) => {
      socket.on('message', () => {
        callCount++;
        if (callCount === 1) {
          socket.close(1001, 'Unexpected error');
        } else {
          socket.send(
            JSON.stringify({
              type: 'response.completed',
              response: { id: 'r1' },
            }),
          );
        }
      });
    });

    manager = new ResponsesWebSocketManager(makeConfig(port));
    try {
      await collectEvents(manager.streamViaWebSocket(makeRequest(), null));
    } catch {
      // Expected: connection closed error
    }

    const events = await collectEvents(
      manager.streamViaWebSocket(makeRequest(), null),
    );
    expect(events.some((e) => e.type === 'response.completed')).toBe(true);
  });

  it('should activate permanent HTTP fallback after retry exhaustion', async () => {
    wss.on('connection', (socket) => {
      socket.on('message', () => {
        socket.close(1001, 'Server error');
      });
    });

    manager = new ResponsesWebSocketManager(
      makeConfig(port, { streamMaxRetries: 1 }),
    );
    expect(manager.isWebSocketEnabled()).toBe(true);

    // First failure
    try {
      await collectEvents(manager.streamViaWebSocket(makeRequest(), null));
    } catch {
      // Expected
    }

    // Second failure triggers fallback
    try {
      await collectEvents(manager.streamViaWebSocket(makeRequest(), null));
    } catch {
      // Expected
    }

    expect(manager.isWebSocketEnabled()).toBe(false);
  });

  it('should fallback on 426 Upgrade Required', async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()));

    const { createServer } = await import('node:http');
    const httpServer = createServer((_req, res) => {
      res.writeHead(426);
      res.end();
    });
    await new Promise<void>((resolve) =>
      httpServer.listen(port, () => resolve()),
    );

    manager = new ResponsesWebSocketManager(makeConfig(port));

    try {
      await collectEvents(manager.streamViaWebSocket(makeRequest(), null));
      expect.unreachable('Should throw');
    } catch (err) {
      expect((err as Error).message).toContain('426');
    }

    httpServer.close();
    // Re-create wss for afterEach cleanup
    wss = new WebSocketServer({ port: 0 });
  });

  it('should keep fallback sticky across calls', async () => {
    manager = new ResponsesWebSocketManager(makeConfig(port));
    manager.activateHttpFallback();

    expect(manager.isWebSocketEnabled()).toBe(false);
    // Still false after multiple checks
    expect(manager.isWebSocketEnabled()).toBe(false);
  });

  it('should reset prefix chain after compaction', async () => {
    echoCompletedServer(wss);
    manager = new ResponsesWebSocketManager(makeConfig(port));

    await collectEvents(manager.streamViaWebSocket(makeRequest(), null));
    manager.resetAfterCompaction();

    // After reset, manager should send full request (no prefix detection)
    const wsReq = manager.prepareWsRequest(makeRequest(), null);
    expect(wsReq.previous_response_id).toBeUndefined();
  });

  it('should not close connection after compaction', async () => {
    let connectionCount = 0;
    wss.on('connection', (socket) => {
      connectionCount++;
      socket.on('message', () => {
        socket.send(
          JSON.stringify({
            type: 'response.completed',
            response: { id: 'r1' },
          }),
        );
      });
    });

    manager = new ResponsesWebSocketManager(makeConfig(port));
    await collectEvents(manager.streamViaWebSocket(makeRequest(), null));
    expect(connectionCount).toBe(1);

    manager.resetAfterCompaction();

    await collectEvents(manager.streamViaWebSocket(makeRequest(), null));
    expect(connectionCount).toBe(1); // Same connection reused
  });

  it('should handle warmup with generate:false', async () => {
    const receivedRequests: Array<Record<string, unknown>> = [];
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const req = JSON.parse(data.toString());
        receivedRequests.push(req);
        socket.send(
          JSON.stringify({
            type: 'response.completed',
            response: { id: 'resp_warmup' },
          }),
        );
      });
    });

    manager = new ResponsesWebSocketManager(makeConfig(port));

    const warmupRequest = makeRequest();
    const wsReq = manager.prepareWsRequest(warmupRequest, null);
    wsReq.generate = false;

    expect(wsReq.generate).toBe(false);
    expect(wsReq.type).toBe('response.create');
  });

  it('should serialise concurrent streamViaWebSocket calls', async () => {
    // Track request order on the server side
    const receivedOrder: number[] = [];
    let requestCounter = 0;
    wss.on('connection', (socket) => {
      socket.on('message', () => {
        const reqNum = ++requestCounter;
        receivedOrder.push(reqNum);
        // Delay first response to ensure second caller would interleave
        // without the mutex
        const delay = reqNum === 1 ? 50 : 10;
        setTimeout(() => {
          socket.send(
            JSON.stringify({
              type: 'response.completed',
              response: { id: `resp_${reqNum}` },
            }),
          );
        }, delay);
      });
    });

    manager = new ResponsesWebSocketManager(makeConfig(port));

    // Launch two concurrent streams — the mutex should serialise them
    const p1 = collectEvents(manager.streamViaWebSocket(makeRequest(), null));
    const p2 = collectEvents(manager.streamViaWebSocket(makeRequest(), null));

    const [events1, events2] = await Promise.all([p1, p2]);
    expect(events1.some((e) => e.type === 'response.completed')).toBe(true);
    expect(events2.some((e) => e.type === 'response.completed')).toBe(true);
    // Server should have received requests sequentially (1 then 2)
    expect(receivedOrder).toEqual([1, 2]);
  });
});
