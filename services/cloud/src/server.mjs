import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { ApiError,fail,hashPattern } from './wire.mjs';

export function createCloudServer(store,{tls,onError=()=>{}}={}){
  const rate=new Map();let largeReads=0;
  const limit=(key,maximum,window)=>{const now=Date.now();let entry=rate.get(key);if(!entry||entry.until<now){entry={count:0,until:now+window};rate.set(key,entry);}fail(++entry.count<=maximum,'RATE_LIMIT',429);
    if(rate.size>10000)for(const [id,value]of rate)if(value.until<now)rate.delete(id);};
  const read=async(req,max=256*1024)=>{
    fail(!req.headers['content-encoding'],'UNSUPPORTED_ENCODING',415);
    const length=Number(req.headers['content-length']);if(Number.isFinite(length))fail(length>=0&&length<=max,'REQUEST_TOO_LARGE',413);
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw new ApiError(413,'REQUEST_TOO_LARGE');chunks.push(chunk);}return Buffer.concat(chunks,size);
  };
  const json=async(req,max)=>{const bytes=await read(req,max);try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ApiError(400,'INVALID_JSON');}};
  const handler=async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    let large=false;
    try{
      const url=new URL(req.url,'http://localhost'),path=url.pathname;fail(!url.search,'INVALID_QUERY');
      if(req.method==='GET'&&path==='/healthz'){send({ok:true,protocol:1});return;}
      const peer=req.socket.remoteAddress??'unknown';limit('all:'+peer,360,60000);
      if(req.method==='POST'&&['/v1/register','/v1/login'].includes(path)){
        limit('auth:'+peer,12,600000);const input=await json(req);const value=path==='/v1/register'?await store.register(input):await store.login(input);send(value);return;
      }
      const header=req.headers.authorization;fail(typeof header==='string'&&header.startsWith('Bearer '),'UNAUTHORIZED',401);
      const session=store.authenticate(header.slice(7));limit('user:'+session.user,240,60000);
      const authorizedJson=async(max)=>{const input=await json(req,max);store.assertSession(session);return input;};
      const authorizedRead=async(max)=>{const input=await read(req,max);store.assertSession(session);return input;};
      let result;
      if(req.method==='GET'&&path==='/v1/account')result=store.account(session.user);
      else if(req.method==='PATCH'&&path==='/v1/account')result=store.updateAccount(session,await authorizedJson());
      else if(req.method==='POST'&&path==='/v1/password'){await store.changePassword(session,await authorizedJson());result={ok:true};}
      else if(req.method==='POST'&&path==='/v1/logout'){store.logout(session);result={ok:true};}
      else if(req.method==='GET'&&path==='/v1/devices')result={devices:store.devices(session)};
      else if(req.method==='POST'&&path==='/v1/devices/revoke'){store.revokeDevice(session,(await authorizedJson()).id);result={ok:true};}
      else if(req.method==='GET'&&path==='/v1/workspace')result=store.workspace(session);
      else if(req.method==='POST'&&['/v1/workspace/commit','/v1/workspace/replace'].includes(path)){
        fail(largeReads<2,'SERVER_BUSY',503);largeReads++;large=true;const input=await authorizedJson(100*1024*1024);
        result=path.endsWith('/commit')?store.commit(session,input):store.replace(session,input);
      }else if(req.method==='POST'&&path==='/v1/execution/claim')result=store.claim(session,await authorizedJson());
      else if(req.method==='POST'&&path==='/v1/execution/release')result=store.release(session,await authorizedJson());
      else if(req.method==='POST'&&path==='/v1/assets/status')result=store.assetStatus(session,(await authorizedJson()).keys);
      else if(path.startsWith('/v1/assets/')){
        const key=path.slice('/v1/assets/'.length);fail(hashPattern.test(key));
        if(req.method==='PUT'){fail(largeReads<2,'SERVER_BUSY',503);largeReads++;large=true;result=store.putAsset(session,key,await authorizedRead(100*1024*1024));}
        else if(req.method==='GET'){const wire=store.asset(session.user,key);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(wire);return;}
        else throw new ApiError(405,'METHOD_NOT_ALLOWED');
      }else if(req.method==='POST'&&path==='/v1/backup/capture')result=store.capture(session.user);
      else if(req.method==='POST'&&path==='/v1/backup/restore')result=store.restore(session,await authorizedJson());
      else if(req.method==='GET'&&path==='/v1/friends')result={friends:store.friends(session)};
      else if(req.method==='GET'&&path==='/v1/friends/summary')result={friends:store.friends(session,{summary:true})};
      else if(req.method==='GET'&&/^\/v1\/friends\/history\/[a-f0-9-]{36}$/.test(path))result=store.friendHistory(session,path.slice('/v1/friends/history/'.length));
      else if(req.method==='POST'&&path==='/v1/friends/invite')result=store.invite(session,(await authorizedJson()).code);
      else if(req.method==='POST'&&path==='/v1/friends/respond'){const v=await authorizedJson();result=store.relation(session,v.id,v.action);}
      else if(req.method==='POST'&&path==='/v1/friends/sharing'){const v=await authorizedJson();result=store.friendPolicy(session,v.id,v.sharing);}
      else if(req.method==='POST'&&path==='/v1/presence'){const v=await authorizedJson();result=store.presence(session,v.snapshot,v.execution);}
      else throw new ApiError(404,'NOT_FOUND');
      send(result??{ok:true});
    }catch(error){
      const known=error instanceof ApiError;if(!known)onError(error?.constructor?.name??'Error');
      if(!res.headersSent){if(error?.status===429||error?.status===503)res.setHeader('Retry-After','5');send({error:known?error.code:'REQUEST_FAILED',...(known&&error.details?{details:error.details}:{})},known?error.status:400);}else res.destroy();
    }finally{if(large)largeReads--;}
  };
  const server=tls?httpsServer({key:readFileSync(tls.key),cert:readFileSync(tls.cert),minVersion:'TLSv1.2',requestTimeout:120000,headersTimeout:15000},handler):httpServer({requestTimeout:120000,headersTimeout:15000},handler);
  server.maxHeadersCount=40;server.maxRequestsPerSocket=100;server.keepAliveTimeout=5000;return server;
}
