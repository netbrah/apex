/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { ResponsesWebSocket } from './responsesWebSocket.js';
import type { ResponseCreateWsRequest } from './wsTypes.js';

import net from 'net';

function findPort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function makeRequest(model = 'gpt-4.1-mini'): ResponseCreateWsRequest {
  return {
    type: 'response.create',
    model,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Hello' }],
      },
    ],
    stream: true,
  };
}

describe('ResponsesWebSocket', () => {
  let wss: WebSocketServer;
  let port: number;
  let ws: ResponsesWebSocket;

  beforeEach(async () => {
    port = await findPort();
    wss = new WebSocketServer({ port });
    ws = new ResponsesWebSocket({
      connectTimeout: 5000,
      idleTimeout: 2000,
    });
  });

  afterEach(async () => {
    await ws.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it('should connect and parse upgrade headers', async () => {
    wss.on('headers', (headers: string[]) => {
      headers.push('x-reasoning-included: true');
      headers.push('openai-model: gpt-4.1-mini');
      headers.push('x-models-etag: etag-123');
    });

    await ws.connect(`ws://localhost:${port}`, {
      Authorization: 'Bearer test',
    });
    expect(ws.isOpen()).toBe(true);
    expect(ws.upgradeHeaders.serverReasoningIncluded).toBe(true);
    expect(ws.upgradeHeaders.serverModel).toBe('gpt-4.1-mini');
    expect(ws.upgradeHeaders.modelsEtag).toBe('etag-123');
  });

  it('should stream request and receive events', async () => {
    wss.on('connection', (socket) => {
      socket.on('message', () => {
        const send = (msg: string) => socket.send(msg);
        send(
          JSON.stringify({
            type: 'response.created',
            response: { id: 'resp_1' },
          }),
        );
        setTimeout(
          () =>
            send(
              JSON.stringify({
                type: 'response.output_text.delta',
                delta: 'Hello',
              }),
            ),
          10,
        );
        setTimeout(
          () =>
            send(
              JSON.stringify({
                type: 'response.completed',
                response: { id: 'resp_1', status: 'completed' },
              }),
            ),
          20,
        );
      });
    });

    await ws.connect(`ws://localhost:${port}`, {});
    const events: Array<{ type: string }> = [];
    for await (const event of ws.streamRequest(makeRequest())) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]!.type).toBe('response.created');
    expect(events[1]!.type).toBe('response.output_text.delta');
    expect(events[2]!.type).toBe('response.completed');
  });

  it('should handle idle timeout', async () => {
    wss.on('connection', (socket) => {
      socket.on('message', () => {
        socket.send(
          JSON.stringify({
            type: 'response.created',
            response: { id: 'resp_1' },
          }),
        );
        // No more messages — should trigger idle timeout
      });
    });

    await ws.connect(`ws://localhost:${port}`, {});
    const events: Array<{ type: string }> = [];
    await expect(async () => {
      for await (const event of ws.streamRequest(makeRequest())) {
        events.push(event);
      }
    }).rejects.toThrow('Idle timeout');
    expect(events).toHaveLength(1);
  });

  it('should auto-respond to ping with pong', async () => {
    let pongReceived = false;

    wss.on('connection', (socket) => {
      socket.on('pong', () => {
        pongReceived = true;
      });
      socket.ping('test');
      setTimeout(() => {
        socket.send(
          JSON.stringify({
            type: 'response.completed',
            response: { id: 'r1' },
          }),
        );
      }, 100);
    });

    await ws.connect(`ws://localhost:${port}`, {});
    // ws library handles ping/pong automatically
    for await (const _event of ws.streamRequest(makeRequest())) {
      // consume
    }
    // Allow time for pong to propagate
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pongReceived).toBe(true);
  });

  it('should reject binary frames', async () => {
    wss.on('connection', (socket) => {
      socket.on('message', () => {
        socket.send(Buffer.from([0x00, 0x01, 0x02]));
      });
    });

    await ws.connect(`ws://localhost:${port}`, {});
    await expect(async () => {
      for await (const _event of ws.streamRequest(makeRequest())) {
        // consume
      }
    }).rejects.toThrow('Unexpected binary');
  });

  it('should handle server close before completed', async () => {
    wss.on('connection', (socket) => {
      socket.on('message', () => {
        socket.send(
          JSON.stringify({
            type: 'response.created',
            response: { id: 'resp_1' },
          }),
        );
        socket.close(1000, 'Server closing early');
      });
    });

    await ws.connect(`ws://localhost:${port}`, {});
    await expect(async () => {
      for await (const _event of ws.streamRequest(makeRequest())) {
        // consume
      }
    }).rejects.toThrow('closed by server');
  });

  it('should parse wrapped error with status 429', async () => {
    wss.on('connection', (socket) => {
      socket.on('message', () => {
        socket.send(
          JSON.stringify({
            type: 'error',
            status: 429,
            error: {
              type: 'rate_limit_error',
              code: 'rate_limit_exceeded',
              message: 'Rate limit exceeded',
            },
          }),
        );
      });
    });

    await ws.connect(`ws://localhost:${port}`, {});
    await expect(async () => {
      for await (const _event of ws.streamRequest(makeRequest())) {
        // consume
      }
    }).rejects.toThrow('Rate limit exceeded');
  });

  it('should parse wrapped error with status 400', async () => {
    wss.on('connection', (socket) => {
      socket.on('message', () => {
        socket.send(
          JSON.stringify({
            type: 'error',
            status: 400,
            error: {
              type: 'invalid_request_error',
              code: 'invalid_request',
              message: 'Invalid request parameters',
            },
          }),
        );
      });
    });

    await ws.connect(`ws://localhost:${port}`, {});
    await expect(async () => {
      for await (const _event of ws.streamRequest(makeRequest())) {
        // consume
      }
    }).rejects.toThrow('Invalid request parameters');
  });

  it('should parse connection_limit_reached as retryable', async () => {
    wss.on('connection', (socket) => {
      socket.on('message', () => {
        socket.send(
          JSON.stringify({
            type: 'error',
            status: 400,
            error: {
              type: 'invalid_request_error',
              code: 'websocket_connection_limit_reached',
              message: 'Connection limit reached (60 minutes)',
            },
          }),
        );
      });
    });

    await ws.connect(`ws://localhost:${port}`, {});
    try {
      for await (const _event of ws.streamRequest(makeRequest())) {
        // consume
      }
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('Connection limit');
      expect((err as Error & { code?: string }).code).toBe(
        'websocket_connection_limit_reached',
      );
    }
  });

  it('should ignore non-error payloads in error parser', async () => {
    wss.on('connection', (socket) => {
      socket.on('message', () => {
        socket.send(
          JSON.stringify({
            type: 'response.created',
            response: { id: 'resp_1' },
          }),
        );
        setTimeout(
          () =>
            socket.send(
              JSON.stringify({
                type: 'response.completed',
                response: { id: 'resp_1' },
              }),
            ),
          10,
        );
      });
    });

    await ws.connect(`ws://localhost:${port}`, {});
    const events: Array<{ type: string }> = [];
    for await (const event of ws.streamRequest(makeRequest())) {
      events.push(event);
    }
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('response.created');
  });

  it('should enable permessage-deflate', async () => {
    const deflateWs = new ResponsesWebSocket({ perMessageDeflate: true });
    await deflateWs.connect(`ws://localhost:${port}`, {});
    expect(deflateWs.isOpen()).toBe(true);
    await deflateWs.close();
  });

  it('should detect connection expiry at 60 minutes', () => {
    const testWs = new ResponsesWebSocket();
    expect(testWs.isConnectionExpired()).toBe(false);
    // Monkey-patch the start time to simulate 60 min ago
    (testWs as unknown as { connectionStartTime: number }).connectionStartTime =
      Date.now() - 60 * 60 * 1000 - 1;
    expect(testWs.isConnectionExpired()).toBe(true);
  });
});
