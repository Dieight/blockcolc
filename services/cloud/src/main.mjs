import { CloudStore } from './store.mjs';
import { createCloudHandler, createCloudServer } from './server.mjs';
import { ExternalFocusBridge } from './external-focus.mjs';
import { createFocusViewer } from './focus-viewer.mjs';
const directory=process.env.BLOCKCOLC_CLOUD_DATA;
if(!directory||!process.env.BLOCKCOLC_TLS_KEY||!process.env.BLOCKCOLC_TLS_CERT)throw new Error('Explicit private data and TLS paths are required');
const port=Number(process.env.BLOCKCOLC_CLOUD_PORT??8443);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid service port');
const store=new CloudStore(directory);
const external=new ExternalFocusBridge(store,{configuration:process.env.BLOCKCOLC_EXTERNAL_CONFIG});
const cloudHandler=createCloudHandler(store,{onError:type=>console.error('Cloud request failed:',type)});
const server=createCloudServer(store,{tls:{key:process.env.BLOCKCOLC_TLS_KEY,cert:process.env.BLOCKCOLC_TLS_CERT},handler:cloudHandler});
const viewerPort=process.env.BLOCKCOLC_VIEWER_PORT;
let viewer;
if(viewerPort){
  const localPort=Number(viewerPort);
  if(!Number.isInteger(localPort)||localPort<1024||localPort>65535||localPort===port)throw new Error('Invalid viewer port');
  viewer=createFocusViewer(store,{
    owner:process.env.BLOCKCOLC_VIEWER_OWNER,
    from:process.env.BLOCKCOLC_VIEWER_FROM,
    origin:process.env.BLOCKCOLC_VIEWER_ORIGIN,
    webRoot:process.env.BLOCKCOLC_VIEWER_WEB,
    integrationHandler:cloudHandler,
    onError:type=>console.error('Focus viewer request failed:',type),
  });
  viewer.listen(localPort,'127.0.0.1',()=>console.log('blockcolc focus viewer ready'));
}
server.listen(port,process.env.BLOCKCOLC_CLOUD_BIND??'0.0.0.0',()=>console.log('blockcolc cloud ready'));
const daily=setInterval(()=>{try{store.daily();}catch(error){console.error('Daily capture failed:',error.constructor.name);}},60000);
const settling=setInterval(()=>{try{store.integrations.sweep();}catch(error){console.error('Integration settlement failed:',error.constructor.name);}},5000);
const importing=setInterval(()=>{void external.poll();},5000);void external.poll();
let stopping=false;
const stop=async()=>{
  if(stopping)return;stopping=true;
  clearInterval(daily);clearInterval(settling);clearInterval(importing);
  setTimeout(()=>process.exit(1),10000).unref();
  const stopped=[new Promise(resolve=>server.close(resolve)),external.stop()];
  if(viewer){
    stopped.push(new Promise(resolve=>viewer.close(resolve)));
    viewer.closeAllConnections();
  }
  await Promise.all(stopped);
  store.close();process.exit(0);
};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
