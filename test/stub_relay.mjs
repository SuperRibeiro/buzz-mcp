import http from 'node:http';
import { verifyEvent } from 'nostr-tools';
const log = [];
const server = http.createServer((req, res) => {
  let b=''; req.on('data', c=>b+=c); req.on('end', () => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Nostr ')) { res.writeHead(401); return res.end('{"error":"no nip98"}'); }
    const ev = JSON.parse(Buffer.from(auth.slice(6),'base64').toString());
    if (ev.kind !== 27235 || !verifyEvent(ev)) { res.writeHead(401); return res.end('{"error":"bad nip98"}'); }
    log.push({path:req.url, method:req.method, body:b});
    if (req.url === '/' ) { res.writeHead(200,{'content-type':'application/nostr+json'}); return res.end('{"name":"stub"}'); }
    if (req.url === '/query') {
      let parsed; try { parsed = JSON.parse(b); } catch(e){ res.writeHead(400); return res.end(JSON.stringify({error:'invalid filters: '+e.message})); }
      if (!Array.isArray(parsed)) { res.writeHead(400); return res.end(JSON.stringify({error:'invalid filters: invalid type: map, expected a sequence at line 1 column 0'})); }
      const f = parsed[0];
      if (f.kinds?.includes(39000)) return (res.writeHead(200), res.end(JSON.stringify([
        {id:'e1',kind:39000,pubkey:'relay',created_at:1,content:'',tags:[['d','11111111-1111-1111-1111-111111111111'],['name','receipt-capture'],['closed']]},
        {id:'e2',kind:39000,pubkey:'relay',created_at:2,content:'',tags:[['d','22222222-2222-2222-2222-222222222222'],['name','lingua'],['closed'],['about','Frente da Língua']]}])));
      if (f['#h']) return (res.writeHead(200), res.end(JSON.stringify([{id:'m1',kind:9,pubkey:'p',created_at:3,content:'olá',tags:[['h',f['#h'][0]]]}])));
      if (f.search) return (res.writeHead(200), res.end(JSON.stringify([{id:'m2',kind:9,pubkey:'p',created_at:4,content:'hit '+f.search,tags:[['h','x']]}])));
      return (res.writeHead(200), res.end('[]'));
    }
    if (req.url === '/events') {
      const ev = JSON.parse(b);
      if (!verifyEvent(ev)) { res.writeHead(400); return res.end('{"error":"bad sig"}'); }
      const tag = n => ev.tags.find(t=>t[0]===n)?.[1];
      if (ev.kind === 9007) {
        if (!tag('name') || !tag('name').replace(/^[#\s]+/,'').trim()) { res.writeHead(400); return res.end('{"error":"invalid: channel name is required"}'); }
        if (!['open','private'].includes(tag('visibility')??'open')) { res.writeHead(400); return res.end('{"error":"invalid visibility"}'); }
        if (!['stream','forum','dm','workflow'].includes(tag('channel_type')??'stream')) { res.writeHead(400); return res.end('{"error":"invalid channel_type"}'); }
        if (!/^[0-9a-f-]{36}$/.test(tag('h')||'')) { res.writeHead(400); return res.end('{"error":"h must be uuid"}'); }
      }
      if (ev.kind === 9 && !tag('h')) { res.writeHead(400); return res.end('{"error":"h required"}'); }
      return (res.writeHead(200), res.end(JSON.stringify({accepted:true, id:ev.id, kind:ev.kind})));
    }
    res.writeHead(404); res.end();
  });
});
server.listen(4444, () => console.log('stub relay on 4444'));
process.on('SIGTERM', ()=>{ console.log('LOG', JSON.stringify(log,null,1)); process.exit(0); });
