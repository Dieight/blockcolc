import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve, sep } from 'node:path';

const base = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.BLOCKCOLC_DEMO_PORT || 41990);
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8' };
const server = createServer(async (request,response) => {
  try {
    if(request.method !== 'GET' && request.method !== 'HEAD'){response.writeHead(405).end();return;}
    const pathname = decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
    const target = resolve(base, `.${pathname === '/' ? '/index.html' : pathname}`);
    if(!target.startsWith(base + sep)){response.writeHead(403).end();return;}
    const data = await readFile(target);
    response.writeHead(200, {'Content-Type':mime[extname(target)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch {response.writeHead(404).end('Not found');}
});
server.listen(port,'127.0.0.1',() => console.log(`Local: http://127.0.0.1:${port}/`));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)));
