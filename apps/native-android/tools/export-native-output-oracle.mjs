import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const out=path.resolve(process.argv[2]??'');
const allowed=path.join(root,'artifacts/experiments/v3.0.0')+path.sep;
if(!out.toLowerCase().startsWith(allowed.toLowerCase()))throw Error('Use a new native evidence directory');
try{await stat(out);throw Error('Oracle output already exists; retain prior evidence');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(out,{recursive:true});
const input='apps/native-android/tools/native-output-oracle.ts';
const bundle=await build({absWorkingDir:root,entryPoints:[input],bundle:true,format:'iife',platform:'browser',write:false,metafile:true});
const bytes=bundle.outputFiles[0].contents;
await writeFile(path.join(out,'source-oracle.js'),bytes);
const sources=[];
for(const file of Object.keys(bundle.metafile.inputs).sort())sources.push({file,sha256:createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')});
sources.push({file:'apps/native-android/tools/export-native-output-oracle.mjs',sha256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')});
const server=createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url==='/source.js'){res.setHeader('Content-Type','text/javascript');res.end(bytes);}
  else if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><style>body{margin:0;background:#222}canvas{display:block}</style></head><body><script src="/source.js"></script></body></html>');}
  else if(req.url==='/favicon.ico'){res.statusCode=204;res.end();}else {res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const errors=[];
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const page=await browser.newPage({viewport:{width:540,height:720},deviceScaleFactor:1});
  page.on('pageerror',error=>errors.push(String(error)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>Boolean(window.oracleSpec));
  const spec=await page.evaluate(()=>window.oracleSpec);const cases=[];
  for(let index=0;index<spec.configurations.length;index++){
    const result=await page.evaluate(index=>window.renderOracle(index),index);cases.push(result);
    await page.screenshot({path:path.join(out,result.name+'.png')});
  }
  if(errors.length)throw Error(errors.join('\n'));
  const gpu=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info');
    return {version:gl.getParameter(gl.VERSION),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,antialias:gl.getContextAttributes().antialias,samples:gl.getParameter(gl.SAMPLES)};});
  const result={...spec,cases,browser:await browser.version(),gpu,sources};
  const wire=JSON.stringify(result,null,2)+'\n';await writeFile(path.join(out,'native-output-oracle.json'),wire);
  console.log(JSON.stringify({cases:cases.length,pixels:cases.reduce((n,c)=>n+c.pixels.length,0),sha256:createHash('sha256').update(wire).digest('hex'),gpu,errors}));
}catch(error){await writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error),errors},null,2));throw error;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
