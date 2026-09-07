# buzz-mcp

MCP (Model Context Protocol) server that connects **Claude Desktop**, **Claude Code**, and **Claude.ai** (web + phone custom connectors) to Miguel's Buzz relay.

It authenticates with **NIP-98** (``Authorization: Nostr …``) and exposes tools to list channels, read/search messages, and post kind-9 chat events.

Transports:

- **stdio** — local Claude Desktop / Claude Code (`npm run start:stdio`)
- **Streamable HTTP** — remote MCP for Claude.ai custom connectors (`npm start` → `src/http.js`)

## Requirements

- Node.js 18+
- A Nostr keypair for the agent (`BUZZ_PRIVATE_KEY`)
- That agent pubkey must be a **Buzz community member** (see below)

## Quick start

```bash
cd /workspace/buzz-mcp
npm install

# Generate an agent keypair
node src/gen-key.js
```

Copy the printed secret (hex) or nsec into env as `BUZZ_PRIVATE_KEY`. Keep pubkey/npub to add the agent as a member.

## Environment

| Variable | Required | Description |
|---------|--------|-----------|
| BUZZ_PRIVATE_KEY | yes | 64-char hex secret or nsec1 |
| BUZZ_RELAY_URL | no | Default `https://trego.communities.buzz.xyz`. `wss` normalized to `https`, `ws` to `http`. |
| PORT | no | HTTP listen port (default `3000`). Used by `src/http.js` / Railway. |

## Add the agent as a Buzz community member

The agent pubkey must already be a member of the Buzz community, or relay writes (and possibly reads) will fail.

1. Run `node src/gen-key.js` and note the npub / hex pubkey.
2. In Buzz Desktop, invite that pubkey into the community, or
3. Have a community owner add the agent pubkey as a member.

Until the agent is a member, `send_message` (and possibly other tools) will be rejected by the relay.

## Claude.ai custom connector (web + phone)

Deploy this repo so `npm start` (`node src/http.js`) is reachable over **public HTTPS** (e.g. Railway). Then:

1. Open Claude.ai → **Customize** → **Connectors**
2. Choose **Add custom connector**
3. Paste your MCP URL:

   ```text
   https://YOUR_HOST/mcp
   ```

   Exact path Claude should use: **`/mcp`**

4. Save / Connect. No OAuth is required for this server (authless Streamable HTTP).

Health check (optional): `GET https://YOUR_HOST/health` → `200` with body `ok`.

The same connector works on Claude **phone** once added to your account.

### Railway

- Start command: `npm start` (or `node src/http.js`) — see `Procfile` / `Dockerfile`
- Set `BUZZ_PRIVATE_KEY` (and optionally `BUZZ_RELAY_URL`) in Railway variables
- `PORT` is provided by Railway; the server binds `0.0.0.0`

## Claude Desktop / Claude Code (stdio)

Edit Claude Desktop config (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`) and merge:

```json
{
  "mcpServers": {
    "trego-buzz": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/to/buzz-mcp/src/index.js"],
      "env": {
        "BUZZ_RELAY_URL": "https://trego.communities.buzz.xyz",
        "BUZZ_PRIVATE_KEY": "YOUR_AGENT_HEX_OR_NSEC"
      }
    }
  }
}
```

Or run: `npm run start:stdio`

See also `claude_desktop_config.example.json`. Restart Claude Desktop after saving.

Absolute path example on this box: `/workspace/buzz-mcp/src/index.js`

## Tools

| Tool | What it does |
|------|-------------|
| relay_info | GET / with Accept: application/nostr+json (NIP-11) |
| list_channels | POST /query kinds [39000] — channel d-tag + name |
| get_messages | Messages in a channel (#h), kinds 9, 40002, 40008, 45001, 45003 |
| search_messages | Same kinds + NIP-50 search |
| send_message | Sign kind 9 with [h, channel_id] (+ optional e reply), POST /events |
| create_channel | Sign kind 9007 with [h, uuid], [name], [visibility], [channel_type], optional [about]; POST /events. Returns the channel_id |

> `POST /query` takes a **bare JSON array of filters** (`[{...}]`), not `{"filters": [...]}` — the relay deserialises `Vec<Filter>` and rejects a map with `invalid filters: invalid type: map, expected a sequence`.

## Auth (NIP-98)

Each HTTP call to the Buzz relay signs a kind **27235** event with tags:

- `["u", request url]`
- `["method", METHOD]`
- `["payload", sha256hex(body)]` when there is a body
- `["nonce", uuid]`

Header: `Authorization: Nostr base64(JSON.stringify(event))` via nostr-tools `finalizeEvent`.

## Dev checks

```bash
npm install
node src/gen-key.js
node -e "import('./src/server.js').then(m => console.log('ok', m.RELAY_URL))"
node -e "import('./src/http.js').then(() => console.log('http module ok'))"
PORT=3000 BUZZ_PRIVATE_KEY=… npm start
curl -s localhost:3000/health
```

## Layout

```
buzz-mcp/
  package.json
  Procfile
  Dockerfile
  README.md
  claude_desktop_config.example.json
  src/
    server.js     # shared createBuzzMcpServer() + tools
    index.js      # MCP stdio entry
    http.js       # Streamable HTTP entry (Railway / Claude.ai)
    gen-key.js    # keypair helper
```
