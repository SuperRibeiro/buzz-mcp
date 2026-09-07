#!/usr/bin/env node
/**
 * Buzz MCP server — Streamable HTTP transport for Claude.ai custom connectors
 * (phone + web) and any remote MCP client.
 *
 * Endpoints:
 *   GET  /health          → 200 "ok"
 *   POST/GET/DELETE /mcp  → MCP Streamable HTTP
 *   POST/GET/DELETE /     → same (Claude may omit /mcp)
 */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  createBuzzMcpServer,
  getSecretKey,
  RELAY_URL,
} from './server.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

/** @type {Record<string, StreamableHTTPServerTransport>} */
const transports = {};

function sendJsonRpcError(res, status, message) {
  if (res.headersSent) return;
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code: -32000, message },
    id: null,
  });
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Mcp-Session-Id, Last-Event-ID, Authorization'
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

async function handleMcpPost(req, res) {
  const sessionId = req.headers['mcp-session-id'];
  try {
    let transport;
    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) delete transports[sid];
      };
      const server = createBuzzMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      sendJsonRpcError(res, 400, 'Bad Request: No valid session ID provided');
      return;
    }
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP POST error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}

async function handleMcpGet(req, res) {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transports[sessionId].handleRequest(req, res);
}

async function handleMcpDelete(req, res) {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  try {
    await transports[sessionId].handleRequest(req, res);
  } catch (error) {
    console.error('MCP DELETE error:', error);
    if (!res.headersSent) res.status(500).send('Error processing session termination');
  }
}

function mountMcpRoutes(app, path) {
  app.options(path, (_req, res) => {
    corsHeaders(res);
    res.status(204).end();
  });
  app.post(path, (req, res) => {
    corsHeaders(res);
    return handleMcpPost(req, res);
  });
  app.get(path, (req, res) => {
    corsHeaders(res);
    return handleMcpGet(req, res);
  });
  app.delete(path, (req, res) => {
    corsHeaders(res);
    return handleMcpDelete(req, res);
  });
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

async function main() {
  // Fail fast if key missing
  getSecretKey();

  const app = createMcpExpressApp({ host: HOST });

  app.get('/health', (_req, res) => {
    res.status(200).type('text/plain').send('ok');
  });

  mountMcpRoutes(app, '/mcp');
  // Also accept root — some clients omit /mcp
  mountMcpRoutes(app, '/');

  app.listen(PORT, HOST, (error) => {
    if (error) {
      console.error('Failed to start HTTP server:', error);
      process.exit(1);
    }
    console.error(
      `Buzz MCP Streamable HTTP listening on http://${HOST}:${PORT}/mcp (relay=${RELAY_URL})`
    );
  });

  const shutdown = async () => {
    console.error('Shutting down…');
    for (const sid of Object.keys(transports)) {
      try {
        await transports[sid].close();
      } catch {
        /* ignore */
      }
      delete transports[sid];
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main };
