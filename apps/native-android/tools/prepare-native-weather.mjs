import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2]??'');
const generated=path.join(root,'platform-weather','build','generated');
if(output!==generated&&!output.startsWith(generated+path.sep))throw new Error('Weather output must stay in its generated directory');
const repo=path.resolve(root,'../..');
const sources=[];
function load(relative){const data=fs.readFileSync(path.join(repo,relative));sources.push({path:relative,sha256:crypto.createHash('sha256').update(data).digest('hex')});return data.toString('utf8').replace(/\r\n/g,'\n');}
function between(source,start,end){const at=source.indexOf(start),until=source.indexOf(end,at+start.length);
  if(at<0||until<0||source.indexOf(start,at+1)>=0)throw new Error('Weather extraction anchor changed');
  return source.slice(at,until);
}
function replaceOnce(source,from,to){if(source.split(from).length!==2)throw new Error('Weather adaptation anchor changed');return source.replace(from,to);}
function jsonTypes(source){return source.replace(/^import com\.getcapacitor\.JS(?:Object|Array);\n/gm,'')
  .replace(/\bJSObject\b/g,'JSONObject').replace(/\bJSArray\b/g,'JSONArray').replace(/\.getJSObject\(/g,'.getJSONObject(')
  .replace('package com.blockcolc.app;','package com.blockcolc.weather;');}
function write(relative,source){const file=path.join(output,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);}

const old=load('apps/android/android/app/src/main/java/com/blockcolc/app/WeatherPlugin.java');
const imports=`package com.blockcolc.weather;
import org.json.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
final class QWeatherProtocol {
`;
let protocol=imports+between(old,'    private static final int MAX_COMPRESSED_RESPONSE_BYTES','    private final AtomicLong requestGeneration')
  +between(old,'    static String decodeWeatherResponse(','    private void cacheCoordinates(')
  +between(old,'    static JSObject mapResponse(','    private static boolean isUsableLocation(')
  +between(old,'    private static boolean isUsableCoordinates(','    private String currentSigningCertificateSha1(')
  +between(old,'    static boolean isValidQWeatherHost(','    private static void resolveFailure(')
  +old.slice(old.indexOf('    static final class Coordinates {'));
protocol=jsonTypes(protocol).replace('private static final class ResponseTooLargeException','static final class ResponseTooLargeException')
  .replace('private static final class UnsupportedResponseEncodingException','static final class UnsupportedResponseEncodingException');
if(/com\.getcapacitor|PluginCall|android\.|BuildConfig/.test(protocol))throw new Error('Platform/bridge dependency leaked into weather protocol');
write('source/weather/com/blockcolc/weather/QWeatherProtocol.java',protocol);

let astronomy=jsonTypes(load('apps/android/android/app/src/main/java/com/blockcolc/app/QWeatherAstronomy.java'));
astronomy=replaceOnce(astronomy,'private static JSONObject mapAstro(JSONObject astro) {','private static JSONObject mapAstro(JSONObject astro) throws JSONException {');
astronomy=replaceOnce(astronomy,'private static void putNullable(JSONObject target, String key, Object value) {','private static void putNullable(JSONObject target, String key, Object value) throws JSONException {');
astronomy=replaceOnce(astronomy,'JSONObject toJson() {','JSONObject toJson() throws JSONException {');
write('source/weather/com/blockcolc/weather/QWeatherAstronomy.java',astronomy);
for(const name of ['WeatherPlugin','QWeatherAstronomy']){
  let test=jsonTypes(load(`apps/android/android/app/src/test/java/com/blockcolc/app/${name}Test.java`));
  if(name==='WeatherPlugin')test=test.replace(/\bWeatherPluginTest\b/g,'QWeatherProtocolTest').replace(/\bWeatherPlugin\b/g,'QWeatherProtocol');
  if(!test.includes('import org.json.JSONObject;'))test=test.replace('package com.blockcolc.weather;','package com.blockcolc.weather;\nimport org.json.JSONObject;');
  write(`test/weather/com/blockcolc/weather/${name==='WeatherPlugin'?'QWeatherProtocol':name}Test.java`,test);
}
load('apps/native-android/tools/prepare-native-weather.mjs');
write('weather/assets/native-weather-source.json',JSON.stringify({schema:1,kind:'Native Java protocol and calendar; no Capacitor runtime or credentials',sources},null,2)+'\n');
