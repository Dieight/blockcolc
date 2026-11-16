import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Reuse the audited Android player without compiling the Capacitor plugin or
// changing the formal app. Adapt host identity, observable status and empty-
// service retirement; keep the decoder, mixing and recording-loop policies.
const root=fileURLToPath(new URL('../../../',import.meta.url)),out=path.resolve(process.argv[2]??'');
const allowed=path.join(root,'apps/native-android/platform-audio/build')+path.sep;
assert(out.toLowerCase().startsWith(allowed.toLowerCase()),'Only the module build directory may be generated');
const java=path.join(out,'source/audio/com/blockcolc/audio'),res=path.join(out,'audio/res/drawable'),assets=path.join(out,'audio/assets');
for(const dir of [java,res,path.join(assets,'public/audio'),path.join(assets,'licenses')])await mkdir(dir,{recursive:true});
const sources=[];
async function read(name){const data=await readFile(path.join(root,name));sources.push({file:name,sha256:createHash('sha256').update(data).digest('hex')});return data;}
function replace(source,from,to,count=1){assert.equal(source.split(from).length-1,count,'Audited audio anchor changed: '+from);return source.split(from).join(to);}
for(const name of ['AmbientAudioService','AmbientPlaybackControl','AmbientPlaybackTiming','AmbientRainMix','AmbientRecordingLoop','AmbientSources']){
  let source=(await read(`apps/android/android/app/src/main/java/com/blockcolc/app/${name}.java`)).toString('utf8');
  source=replace(source,'package com.blockcolc.app;','package com.blockcolc.audio;');
  if(name==='AmbientAudioService'){
    source=replace(source,'PresentationLanguage.text','AmbientAudioHost.text',8);
    source=replace(source,'new Intent(this,MainActivity.class)','AmbientAudioHost.openIntent(this)');
    source=replace(source,'.setStyle(new Notification.MediaStyle()', '.setGroup("blockcolc-focus-audio").setStyle(new Notification.MediaStyle()');
    source=replace(source,'super.onCreate();running=true;','super.onCreate();running=true;AmbientAudioHost.created(this);');
    source=replace(source,'running=false;releaseMain();','running=false;AmbientAudioHost.closed(this);releaseMain();');
    source=replace(source,'rainRequested=wantedRain;mix.set(wantedRain,intent.getDoubleExtra("rainIntensity",.3));',
      'rainRequested=wantedRain;mix.set(wantedRain,intent.getDoubleExtra("rainIntensity",.3));AmbientAudioHost.selection(this,wanted,wantedRain,gain);');
    source=replace(source,'canPlay=playback.allowed();','canPlay=playback.allowed();AmbientAudioHost.playback(this,canPlay,playback.paused());',3);
    source=replace(source,'canPlay=false;applyPlayback();abandonFocus();publishNotification();',
      'canPlay=false;AmbientAudioHost.playback(this,false,true);applyPlayback();abandonFocus();publishNotification();');
    source=replace(source,'if(mainPlayer==p)loop.prepared(canPlay,currentGain()*AmbientRainMix.MAIN_GAIN);',
      'if(mainPlayer==p){loop.prepared(canPlay,currentGain()*AmbientRainMix.MAIN_GAIN);AmbientAudioHost.mainPrepared(this,p.getDuration());}');
    source=replace(source,'holder.prepared=true;updateVolume();','holder.prepared=true;AmbientAudioHost.rainPrepared(this,holder.layer);updateVolume();');
    source=replace(source,'main.removeCallbacks(rainPulse);for(RainPlayer layer:rain)layer.media.release();rain.clear();',
      'main.removeCallbacks(rainPulse);for(RainPlayer layer:rain)layer.media.release();rain.clear();AmbientAudioHost.rainCleared(this);');
    source=replace(source,'if(mainPlayer==p)stopSelf();','if(mainPlayer==p){AmbientAudioHost.failed(this,"AUDIO_DECODE_FAILED");stopSelf();}');
    source=replace(source,'if(rain.contains(holder))stopSelf();','if(rain.contains(holder)){AmbientAudioHost.failed(this,"AUDIO_DECODE_FAILED");stopSelf();}');
    source=replace(source,'if(mainPlayer==player)stopSelf();','if(mainPlayer==player){AmbientAudioHost.failed(this,"AUDIO_PLAYBACK_FAILED");stopSelf();}');
    source=replace(source,'catch(Exception error){stopSelf();}','catch(Exception error){AmbientAudioHost.failed(this,"AUDIO_START_FAILED");stopSelf();}');
    source=replace(source,'catch(RuntimeException error){stopSelf();}','catch(RuntimeException error){AmbientAudioHost.failed(this,"AUDIO_PLAYBACK_FAILED");stopSelf();}',2);
    source=replace(source,'if(!wasActive&&!playback.paused()&&!requestPlaybackFocus(attributes)){stopSelf();return START_NOT_STICKY;}',
      'if(!wasActive&&!playback.paused()&&!requestPlaybackFocus(attributes)){AmbientAudioHost.failed(this,"AUDIO_FOCUS_DENIED");stopSelf();return START_NOT_STICKY;}');
    source=replace(source,'            updateVolume();applyPlayback();publishNotification();',
      '            updateVolume();applyPlayback();publishNotification();\n            if(primary.isEmpty()&&rain.isEmpty())stopSelf();');
    source=replace(source,'    @Override public void onTaskRemoved(Intent root){stopSelf();}',`
    public JSONObject inspectPlayback(){
        JSONObject result=new JSONObject();
        try {result.put("active",running).put("canPlay",canPlay).put("paused",playback.paused()).put("primary",primary)
            .put("rainPlayers",rain.size()).put("rainRequested",rainRequested).put("gain",(double)gain)
            .put("lightRainGain",rainGains[0]).put("heavyRainGain",rainGains[1]);
            if(mainPlayer!=null&&AmbientAudioHost.isMainPrepared(this))try {result.put("positionMs",mainPlayer.getCurrentPosition()).put("durationMs",mainPlayer.getDuration()).put("mainPlaying",mainPlayer.isPlaying());}catch(RuntimeException unavailable){}
        } catch(JSONException invalid){throw new IllegalStateException(invalid);}
        return result;
    }
    @Override public void onTaskRemoved(Intent root){stopSelf();}`);
  }
  await writeFile(path.join(java,name+'.java'),source);
}
for(const name of ['ic_stat_tomato_outline','ic_ambient_pause','ic_ambient_play','ic_ambient_stop']){
  const relative=`apps/android/android/app/src/main/res/drawable/${name}.xml`;await read(relative);await copyFile(path.join(root,relative),path.join(res,name+'.xml'));
}
for(const name of ['forest-birds','shore-waves','rain-light','rain-heavy']){
  const relative=`apps/web/public/audio/${name}.ogg`;await read(relative);await copyFile(path.join(root,relative),path.join(assets,'public/audio',name+'.ogg'));
}
const license='apps/web/public/licenses/ambient-audio.txt';await read(license);await copyFile(path.join(root,license),path.join(assets,'licenses/ambient-audio.txt'));
await read('apps/native-android/tools/prepare-native-audio.mjs');
await writeFile(path.join(assets,'native-audio-source.json'),JSON.stringify({schema:1,source:'Existing Android media player; no Capacitor dependency',sources},null,2));
console.log(JSON.stringify({javaSources:6,recordings:4,sourceFiles:sources.length}));
