/**
 * Shared Buzz MCP server factory — tools + NIP-98 relay client.
 * Used by both stdio (index.js) and Streamable HTTP (http.js).
 */
import { createHash, randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { decode as nip19Decode } from 'nostr-tools/nip19';
import { hexToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function normalizeRelayUrl(raw) {
  if (!raw) return 'https://trego.communities.buzz.xyz';
  let url = String(raw).trim().replace(/\/+$/, '');
  if (url.startsWith('wss://')) url = 'https://' + url.slice(6);
  else if (url.startsWith('ws://')) url = 'http://' + url.slice(5);
  return url;
}

function parsePrivateKey(raw) {
  if (!raw || !String(raw).trim()) {
    throw new Error(
      'BUZZ_PRIVATE_KEY is required (64-hex secret or nsec1…). Run: node src/gen-key.js'
    );
  }
  const v = String(raw).trim();
  if (v.startsWith('nsec1')) {
    const decoded = nip19Decode(v);
    if (decoded.type !== 'nsec') {
      throw new Error(`Expected nsec1…, got ${decoded.type}`);
    }
    return decoded.data; // Uint8Array
  }
  if (!/^[0-9a-fA-F]{64}$/.test(v)) {
    throw new Error('BUZZ_PRIVATE_KEY must be 64-hex or nsec1…');
  }
  return hexToBytes(v.toLowerCase());
}

const RELAY_URL = normalizeRelayUrl(process.env.BUZZ_RELAY_URL);

let _secretKey;
let _pubkey;

function getSecretKey() {
  if (!_secretKey) {
    _secretKey = parsePrivateKey(process.env.BUZZ_PRIVATE_KEY);
    _pubkey = getPublicKey(_secretKey);
  }
  return _secretKey;
}

function getAgentPubkey() {
  getSecretKey();
  return _pubkey;
}

// ---------------------------------------------------------------------------
// NIP-98 auth + HTTP helpers
// ---------------------------------------------------------------------------

function sha256Hex(data) {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Build Authorization: Nostr <base64(event)> for NIP-98.
 * Kind 27235 with tags u, method, optional payload, nonce.
 */
function buildNip98Auth(method, url, body) {
  const tags = [
    ['u', url],
    ['method', method.toUpperCase()],
  ];
  if (body != null && body !== '') {
    tags.push(['payload', sha256Hex(body)]);
  }
  tags.push(['nonce', randomUUID()]);

  const unsigned = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };
  const event = finalizeEvent(unsigned, getSecretKey());
  const token = Buffer.from(JSON.stringify(event), 'utf8').toString('base64');
  return `Nostr ${token}`;
}

async function relayFetch(method, path, { body, accept, query } = {}) {
  const url = new URL(path.startsWith('http') ? path : `${RELAY_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const href = url.toString();
  const bodyStr =
    body == null
      ? undefined
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);

  const headers = {
    Authorization: buildNip98Auth(method, href, bodyStr),
    Accept: accept || 'application/json',
  };
  if (bodyStr != null) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(href, {
    method: method.toUpperCase(),
    headers,
    body: bodyStr,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const detail = json ? JSON.stringify(json) : text;
    throw new Error(`Relay ${method} ${href} → ${res.status}: ${detail.slice(0, 500)}`);
  }
  return json ?? text;
}

function textResult(obj) {
  const payload = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: 'text', text: payload }] };
}

function errorResult(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}

// ---------------------------------------------------------------------------
// Channel / message parsing helpers
// ---------------------------------------------------------------------------

function tagValue(tags, name) {
  if (!Array.isArray(tags)) return undefined;
  const t = tags.find((x) => Array.isArray(x) && x[0] === name);
  return t?.[1];
}

function parseChannel(ev) {
  const channelId = tagValue(ev.tags, 'd') || ev.id;
  let name;
  let meta = {};
  if (ev.content) {
    try {
      meta = JSON.parse(ev.content);
      name = meta.name || meta.title;
    } catch {
      /* plain content */
    }
  }
  if (!name) name = tagValue(ev.tags, 'name') || tagValue(ev.tags, 'title');
  return {
    channel_id: channelId,
    name: name || channelId,
    pubkey: ev.pubkey,
    created_at: ev.created_at,
    ...meta,
  };
}

function summarizeEvent(ev) {
  return {
    id: ev.id,
    kind: ev.kind,
    pubkey: ev.pubkey,
    created_at: ev.created_at,
    content: ev.content,
    channel_id: tagValue(ev.tags, 'h') || tagValue(ev.tags, 'd'),
    reply_to: tagValue(ev.tags, 'e'),
    tags: ev.tags,
  };
}

function extractEvents(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.result)) return payload.result;
  if (payload.id && payload.kind != null) return [payload];
  return [];
}

// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------

/**
 * Create a fresh McpServer with Buzz tools registered.
 * Call once per stdio process, or once per HTTP session.
 */
export function createBuzzMcpServer() {
  const server = new McpServer({
    name: 'trego-buzz',
    version: '1.0.0',
  });

  server.registerTool(
    'relay_info',
    {
      description:
        'Fetch NIP-11 relay information document (GET relay root with Accept: application/nostr+json).',
      inputSchema: {},
    },
    async () => {
      try {
        const info = await relayFetch('GET', '/', {
          accept: 'application/nostr+json',
        });
        return textResult({
          relay_url: RELAY_URL,
          agent_pubkey: getAgentPubkey(),
          info,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'list_channels',
    {
      description:
        'List Buzz channels (kind 39000 replaceable channel defs). Returns channel_id (d-tag) and name.',
      inputSchema: {},
    },
    async () => {
      try {
        const payload = await relayFetch('POST', '/query', {
          body: {
            filters: [{ kinds: [39000], limit: 200 }],
          },
        });
        const events = extractEvents(payload);
        const channels = events.map(parseChannel);
        return textResult({ count: channels.length, channels });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'get_messages',
    {
      description:
        'Fetch recent messages in a Buzz channel. Filters kinds 9, 40002, 40008, 45001, 45003 with #h = channel_id.',
      inputSchema: {
        channel_id: z.string().describe('Channel id (d-tag from list_channels)'),
        limit: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe('Max events to return (default 50)'),
      },
    },
    async ({ channel_id, limit }) => {
      try {
        const payload = await relayFetch('POST', '/query', {
          body: {
            filters: [
              {
                kinds: [9, 40002, 40008, 45001, 45003],
                '#h': [channel_id],
                limit: limit ?? 50,
              },
            ],
          },
        });
        const events = extractEvents(payload).map(summarizeEvent);
        return textResult({ channel_id, count: events.length, messages: events });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'search_messages',
    {
      description: 'Full-text search messages on the Buzz relay (NIP-50 search filter).',
      inputSchema: {
        query: z.string().describe('Search query string'),
        limit: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe('Max events to return (default 50)'),
      },
    },
    async ({ query, limit }) => {
      try {
        const payload = await relayFetch('POST', '/query', {
          body: {
            filters: [
              {
                kinds: [9, 40002, 40008, 45001, 45003],
                search: query,
                limit: limit ?? 50,
              },
            ],
          },
        });
        const events = extractEvents(payload).map(summarizeEvent);
        return textResult({ query, count: events.length, messages: events });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.registerTool(
    'send_message',
    {
      description:
        'Post a chat message (kind 9) to a Buzz channel. Optionally reply to an event id. Agent pubkey must be a community member.',
      inputSchema: {
        channel_id: z.string().describe('Target channel id (h-tag)'),
        content: z.string().describe('Message text'),
        reply_to: z
          .string()
          .optional()
          .describe('Optional event id to reply to (e-tag)'),
      },
    },
    async ({ channel_id, content, reply_to }) => {
      try {
        const tags = [['h', channel_id]];
        if (reply_to) tags.push(['e', reply_to]);

        const event = finalizeEvent(
          {
            kind: 9,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content,
          },
          getSecretKey()
        );

        const payload = await relayFetch('POST', '/events', {
          body: event,
        });

        return textResult({
          ok: true,
          event_id: event.id,
          channel_id,
          pubkey: event.pubkey,
          relay_response: payload,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  return server;
}

export {
  RELAY_URL,
  normalizeRelayUrl,
  parsePrivateKey,
  getAgentPubkey,
  getSecretKey,
};
