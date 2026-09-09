import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const c = new Client({name:'t',version:'0'});
await c.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_URL || 'http://127.0.0.1:3111/mcp')));
const tools = (await c.listTools()).tools.map(t=>t.name); console.log('TOOLS', tools);
const call = async (n,a={}) => { const r = await c.callTool({name:n, arguments:a}); const t=r.content[0].text; console.log(`\n== ${n}`, r.isError?'ERROR':'ok'); console.log(t.slice(0,700)); return JSON.parse(t.startsWith('Error')?'{}':t); };
await call('relay_info');
const lc = await call('list_channels');
if (lc.count!==2 || lc.channels[0].name!=='receipt-capture') throw new Error('list_channels wrong');
const gm = await call('get_messages',{channel_id:'11111111-1111-1111-1111-111111111111', limit:5});
if (gm.messages[0].content!=='olá') throw new Error('get_messages wrong');
const sm = await call('search_messages',{query:'fatura'});
if (sm.messages[0].content!=='hit fatura') throw new Error('search wrong');
const cc = await call('create_channel',{name:'#engineering', about:'Lingua — engineering channel', visibility:'open'});
if (!cc.ok || !/^[0-9a-f-]{36}$/.test(cc.channel_id) || cc.channel_type!=='stream') throw new Error('create wrong');
const bad = await c.callTool({name:'create_channel', arguments:{name:'x', visibility:'secret'}});
console.log('\n== create_channel invalid visibility →', bad.isError ? 'rejected by zod ✔' : 'NOT REJECTED ✘');
const sendr = await call('send_message',{channel_id:cc.channel_id, content:'primeira mensagem'});
if (!sendr.ok) throw new Error('send wrong');
// delete_message — own message: marker lands, target gone from the relay
const del = await call('delete_message',{channel_id:cc.channel_id, event_id:sendr.event_id, reason:'posted in error'});
if (!del.ok || del.target_event_id!==sendr.event_id) throw new Error('delete wrong');
if (del.verification.deletion_marker_on_relay!==true) throw new Error('marker not on relay');
if (del.verification.target_still_returned_by_relay!==false) throw new Error('target still returned after delete');
// delete_message — relay keeps the target but the marker exists: verification must say so honestly
const prot = await call('delete_message',{channel_id:'11111111-1111-1111-1111-111111111111', event_id:'a'.repeat(64)});
if (!prot.ok || prot.verification.deletion_marker_on_relay!==true) throw new Error('protected: marker missing');
if (prot.verification.target_still_returned_by_relay!==true) throw new Error('protected: verification hid a still-visible target');
// delete_message — not owner/admin on someone else's event: relay 403 surfaces as a tool error, not a silent ok
const forb = await c.callTool({name:'delete_message', arguments:{channel_id:cc.channel_id, event_id:'f'.repeat(64)}});
console.log('\n== delete_message forbidden →', forb.isError && /owner\/admin/.test(forb.content[0].text) ? 'relay refusal surfaced ✔' : 'NOT SURFACED ✘');
if (!forb.isError || !/owner\/admin/.test(forb.content[0].text)) throw new Error('forbidden delete not surfaced');
// delete_message — malformed id rejected before anything is signed
const badId = await c.callTool({name:'delete_message', arguments:{channel_id:cc.channel_id, event_id:'not-an-id'}});
console.log('== delete_message bad id →', badId.isError ? 'rejected by zod ✔' : 'NOT REJECTED ✘');
if (!badId.isError) throw new Error('bad id not rejected');
await c.close(); console.log('\nALL ASSERTIONS PASSED');
