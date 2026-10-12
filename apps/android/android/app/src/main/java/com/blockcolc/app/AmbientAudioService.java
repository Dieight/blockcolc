package com.blockcolc.app;

import android.app.*;
import android.annotation.SuppressLint;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.os.*;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public final class AmbientAudioService extends Service {
    private final ArrayList<MediaPlayer> players=new ArrayList<>();
    private final HashSet<MediaPlayer> prepared=new HashSet<>();
    private final ArrayList<AudioTrack> loops=new ArrayList<>();
    private final ExecutorService loader=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private volatile int generation=0;
    private String sourceKey="";
    private boolean canPlay=false,ducked=false;
    private AudioManager audio;private AudioFocusRequest focus;private float gain=.3f;
    private static final String CHANNEL="blockcolc_ambient_v1";
    private final AudioManager.OnAudioFocusChangeListener listener=change->{
        if(change==AudioManager.AUDIOFOCUS_GAIN){canPlay=true;ducked=false;updateVolume();for(MediaPlayer p:prepared)if(!p.isPlaying())p.start();for(AudioTrack t:loops)t.play();}
        else if(change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK){ducked=true;updateVolume();}
        else if(change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT){canPlay=false;for(MediaPlayer p:prepared)if(p.isPlaying())p.pause();for(AudioTrack t:loops)t.pause();}
        else if(change==AudioManager.AUDIOFOCUS_LOSS)stopSelf();
    };
    @Override public IBinder onBind(Intent intent){return null;}
    // AGP's detector reads the private overlay rather than the merged manifest;
    // the packaged manifest check verifies this exact mediaPlayback declaration.
    @SuppressLint("ForegroundServiceType")
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent==null||"stop".equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
        try{
            JSONArray sources=new JSONArray(intent.getStringExtra("sources"));
            String[] selected=new String[sources.length()];for(int i=0;i<sources.length();i++)selected[i]=sources.getString(i);
            if(sources.length()==0||!AmbientSources.valid(selected))throw new IllegalArgumentException();
            gain=Math.max(0,Math.min(100,intent.getIntExtra("volume",30)))/100f/(float)Math.sqrt(sources.length());
            NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
            if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel(CHANNEL,"Ambient audio",NotificationManager.IMPORTANCE_LOW));
            PendingIntent open=PendingIntent.getActivity(this,43010,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            PendingIntent stop=PendingIntent.getService(this,43011,new Intent(this,AmbientAudioService.class).setAction("stop"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            Notification notification=new NotificationCompat.Builder(this,CHANNEL).setSmallIcon(R.drawable.ic_stat_tomato_outline)
                .setContentTitle("blockcolc").setContentText(PresentationLanguage.text(this,"环境白噪音","Ambient audio")).setContentIntent(open).addAction(0,PresentationLanguage.text(this,"停止","Stop"),stop)
                .setOngoing(true).setSilent(true).setCategory(NotificationCompat.CATEGORY_SERVICE).build();
            ServiceCompat.startForeground(this,43010,notification,Build.VERSION.SDK_INT>=29?ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK:0);
            // A volume gesture must not tear down or re-seek a running ocean.
            if(sourceKey.equals(sources.toString())){updateVolume();return START_NOT_STICKY;}
            releasePlayers();abandonFocus();sourceKey=sources.toString();
            audio=(AudioManager)getSystemService(AUDIO_SERVICE);int result;
            AudioAttributes attributes=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
            if(Build.VERSION.SDK_INT>=26){focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes).setOnAudioFocusChangeListener(listener).build();result=audio.requestAudioFocus(focus);}
            else result=audio.requestAudioFocus(listener,AudioManager.STREAM_MUSIC,AudioManager.AUDIOFOCUS_GAIN);
            if(result!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED){stopSelf();return START_NOT_STICKY;}
            canPlay=true;
            final int owner=generation;
            for(int i=0;i<sources.length();i++){
                String source=sources.getString(i);
                if(builtin(source)){
                    loader.execute(()->loadLoop(source,attributes,owner));
                }else{
                    MediaPlayer player=new MediaPlayer();players.add(player);
                    player.setAudioAttributes(attributes);player.setWakeMode(this,PowerManager.PARTIAL_WAKE_LOCK);
                    player.setDataSource(new File(new File(getFilesDir(),"ambient-imports"),source).getAbsolutePath());
                    player.setLooping(true);player.setOnPreparedListener(p->{if(!players.contains(p))return;prepared.add(p);p.setVolume(currentGain(),currentGain());if(canPlay)p.start();});
                    player.setOnErrorListener((p,what,extra)->{stopSelf();return true;});player.prepareAsync();
                }
            }
        }catch(Exception error){stopSelf();}
        return START_NOT_STICKY;
    }
    private static boolean builtin(String source){return AmbientSources.builtin(source);}
    private void loadLoop(String source,AudioAttributes attributes,int owner){
        AudioTrack track=null;
        try(InputStream stream=getAssets().open("public/audio/"+source+".wav");ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
            byte[] chunk=new byte[16384];int size;
            while((size=stream.read(chunk))!=-1){if(owner!=generation)return;bytes.write(chunk,0,size);if(bytes.size()>8*1024*1024)throw new IOException("PCM too large");}
            AmbientPcm pcm=AmbientPcm.parse(bytes.toByteArray());
            track=new AudioTrack.Builder().setAudioAttributes(attributes)
                .setAudioFormat(new AudioFormat.Builder().setSampleRate(pcm.sampleRate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(pcm.channels==1?AudioFormat.CHANNEL_OUT_MONO:AudioFormat.CHANNEL_OUT_STEREO).build())
                .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(pcm.samples.length).build();
            if(track.write(pcm.samples,0,pcm.samples.length)!=pcm.samples.length||track.setLoopPoints(0,pcm.frames,-1)!=AudioTrack.SUCCESS)throw new IOException("PCM loop unavailable");
            final AudioTrack ready=track;track=null;
            main.post(()->{if(owner!=generation){ready.release();return;}loops.add(ready);ready.setVolume(currentGain());if(canPlay)ready.play();});
        }catch(Exception error){if(track!=null)track.release();main.post(()->{if(owner==generation)stopSelf();});}
    }
    private float currentGain(){return ducked?gain*.2f:gain;}
    private void updateVolume(){float value=currentGain();for(MediaPlayer p:prepared)p.setVolume(value,value);for(AudioTrack t:loops)t.setVolume(value);}
    private void releasePlayers(){generation++;sourceKey="";canPlay=false;ducked=false;prepared.clear();for(MediaPlayer player:players){try{player.release();}catch(RuntimeException ignored){}}players.clear();for(AudioTrack t:loops){try{t.release();}catch(RuntimeException ignored){}}loops.clear();}
    private void abandonFocus(){if(audio!=null){if(Build.VERSION.SDK_INT>=26&&focus!=null)audio.abandonAudioFocusRequest(focus);else audio.abandonAudioFocus(listener);}focus=null;}
    @Override public void onTaskRemoved(Intent root){stopSelf();}
    @Override public void onDestroy(){releasePlayers();abandonFocus();loader.shutdownNow();super.onDestroy();}
}
