// Normalized resource assets only. The client JAR and unrelated game files are
// never packaged in the preview. Both backends get the exact same admitted pack.
function toBase64(bytes){let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(raw);}
export function encodeResourceWire(manifest,identity){
  return JSON.stringify({schema:1,identity,manifest},(key,value)=>key==='png'&&value instanceof Uint8Array?{base64:toBase64(value)}:value);
}
export function decodeResourceWire(text){
  if(typeof text!=='string'||text.length>64*1024*1024)throw Error('Normalized resource asset budget');
  let total=0;
  const result=JSON.parse(text,(key,value)=>{
    if(key!=='png')return value;
    if(!value||Object.keys(value).length!==1||typeof value.base64!=='string'||value.base64.length>6*1024*1024)throw Error('Invalid normalized PNG');
    const raw=atob(value.base64);total+=raw.length;if(total>64*1024*1024)throw Error('Normalized image budget');
    return Uint8Array.from(raw,c=>c.charCodeAt(0));
  });
  if(result.schema!==1||result.identity?.kind!=='mc263'||!/^[a-f0-9]{64}$/.test(result.identity.sha256)||result.manifest?.schemaVersion!==1)throw Error('Invalid normalized resource identity');
  return result;
}
