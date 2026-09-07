#!/usr/bin/env node
/**
 * Buzz MCP server — stdio transport for Claude Desktop / Claude Code.
 * Default when no PORT / MCP_TRANSPORT=stdio.
 */
import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  createBuzzMcpServer,
  getSecretKey,
  RELAY_URL,
  normalizeRelayUrl,
  parsePrivateKey,
  getAgentPubkey,
} from './server.js';

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
  // Fail fast if key missing when actually running as MCP server
  getSecretKey();
  const server = createBuzzMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export {
  createBuzzMcpServer,
  RELAY_URL,
  normalizeRelayUrl,
  parsePrivateKey,
  getAgentPubkey,
  getSecretKey,
};
