package com.blockcolc.app;

import android.app.*;
import android.annotation.SuppressLint;
import android.content.*;
import android.content.res.AssetFileDescriptor;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.*;
import androidx.core.app.ServiceCompat;
import java.io.*;
import java.util.*;
import org.json.*;

/** One media session; changing the weather mix never re-seeks the main recording. */
public final class AmbientAudioService extends Service {
    private final Handler main=new Handler(Looper.getMainLooper());
    private final AmbientPlaybackControl playback=new AmbientPlaybackControl();
    private final AmbientRainMix mix=new AmbientRainMix();
    private final ArrayList<RainPlayer> rain=new ArrayList<>();
    private static volatile boolean running;
    static boolean active(){return running;}
    private static final String CHANNEL="blockcolc_ambient_v1",PREFS="blockcolc_ambient_playback",PAUSED="paused";
    private static final int ID=43010;
    private static final String PLAY="com.blockcolc.app.AMBIENT_PLAY",PAUSE="com.blockcolc.app.AMBIENT_PAUSE";
    private String primary="";
    private MediaPlayer mainPlayer;
    private AmbientRecordingLoop recording;
    private boolean canPlay,ducked,rainRequested;
    private boolean foreground;
    private int publishedState=-1;
    private String publishedTitle="";
    private float gain=.3f;
    private long lastRain;
    private double[] rainGains={0,0};
    private AudioManager audio;private AudioFocusRequest focus;private MediaSession session;
    private static final class RainPlayer {
        final MediaPlayer media;final int layer;boolean prepared;
        RainPlayer(MediaPlayer media,int layer){this.media=media;this.layer=layer;}
    }
    private final AudioManager.OnAudioFocusChangeListener listener=change->{
        if(change==AudioManager.AUDIOFOCUS_GAIN){playback.focus(true);ducked=false;}
        else if(change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK)ducked=true;
        else playback.focus(false);
        canPlay=playback.allowed();updateVolume();applyPlayback();publishNotification();
    };
    private final Runnable rainPulse=new Runnable(){public void run(){
        if(rain.isEmpty())return;
        long now=SystemClock.elapsedRealtime();rainGains=mix.step(now-lastRain);lastRain=now;updateVolume();
        if(!rainRequested&&Math.max(rainGains[0],rainGains[1])<.0001){
            releaseRain();if(primary.isEmpty())stopSelf();return;
        }
        if(canPlay)main.postDelayed(this,60);
    }};
    @Override public void onCreate(){
        super.onCreate();running=true;
        if(getSharedPreferences(PREFS,0).getBoolean(PAUSED,false))playback.pause();
        session=new MediaSession(this,"blockcolc-ambient");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS|MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback(){
            @Override public void onPlay(){resumeAudio();}
            @Override public void onPause(){pauseAudio();}
            @Override public void onStop(){pauseAudio();stopSelf();}
        },main);session.setActive(true);
    }
    @Override public IBinder onBind(Intent intent){return null;}
    // The packaged manifest check verifies the mediaPlayback declaration.
    @SuppressLint("ForegroundServiceType")
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        if("stop".equals(intent.getAction())){pauseAudio();stopSelf();return START_NOT_STICKY;}
        if(PAUSE.equals(intent.getAction())){pauseAudio();return START_NOT_STICKY;}
        if(PLAY.equals(intent.getAction())){resumeAudio();return START_NOT_STICKY;}
        try{
            JSONArray sources=new JSONArray(intent.getStringExtra("sources"));
            String[] selected=new String[sources.length()];for(int i=0;i<sources.length();i++)selected[i]=sources.getString(i);
            if(!AmbientSources.valid(selected))throw new IllegalArgumentException();
            String wanted="";boolean wantedRain=false;
            for(String source:selected){if("rain".equals(source))wantedRain=true;else wanted=source;}
            boolean wasActive=mainPlayer!=null||!rain.isEmpty();
            gain=Math.max(0,Math.min(100,intent.getIntExtra("volume",30)))/100f;
            rainRequested=wantedRain;mix.set(wantedRain,intent.getDoubleExtra("rainIntensity",.3));
            if(wanted.isEmpty()&&!wantedRain&&(!wasActive||playback.paused())){stopSelf();return START_NOT_STICKY;}
            if(!foreground){ServiceCompat.startForeground(this,ID,notification(),Build.VERSION.SDK_INT>=29?ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK:0);foreground=true;}
            AudioAttributes attributes=attributes();
            if(!wasActive&&!playback.paused()&&!requestPlaybackFocus(attributes)){stopSelf();return START_NOT_STICKY;}
            canPlay=playback.allowed();
            if(!primary.equals(wanted)){
                releaseMain();primary=wanted;
                if(!wanted.isEmpty())prepareMain(wanted,attributes);
            }
            if(wantedRain&&rain.isEmpty())prepareRain(attributes);
            updateVolume();applyPlayback();publishNotification();
        }catch(Exception error){stopSelf();}
        return START_NOT_STICKY;
    }
    private static AudioAttributes attributes(){return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();}
    private void prepareMain(String source,AudioAttributes attributes)throws IOException{
        MediaPlayer player=new MediaPlayer();mainPlayer=player;
        AmbientRecordingLoop loop=new AmbientRecordingLoop(player,main,()->{if(mainPlayer==player)stopSelf();});recording=loop;
        player.setAudioAttributes(attributes);player.setWakeMode(this,PowerManager.PARTIAL_WAKE_LOCK);
        if(AmbientSources.builtin(source))try(AssetFileDescriptor asset=getAssets().openFd(AmbientSources.asset(source))){
            player.setDataSource(asset.getFileDescriptor(),asset.getStartOffset(),asset.getLength());
        }else player.setDataSource(new File(new File(getFilesDir(),"ambient-imports"),source).getAbsolutePath());
        player.setOnPreparedListener(p->{if(mainPlayer==p)loop.prepared(canPlay,currentGain()*AmbientRainMix.MAIN_GAIN);});
        player.setOnErrorListener((p,what,extra)->{if(mainPlayer==p)stopSelf();return true;});player.prepareAsync();
    }
    private void prepareRain(AudioAttributes attributes)throws IOException{
        lastRain=SystemClock.elapsedRealtime();
        for(int layer=0;layer<2;layer++){
            MediaPlayer media=new MediaPlayer();RainPlayer holder=new RainPlayer(media,layer);rain.add(holder);
            media.setAudioAttributes(attributes);media.setWakeMode(this,PowerManager.PARTIAL_WAKE_LOCK);media.setLooping(true);media.setVolume(0,0);
            try(AssetFileDescriptor asset=getAssets().openFd(AmbientSources.rainAsset(layer))){
                media.setDataSource(asset.getFileDescriptor(),asset.getStartOffset(),asset.getLength());
            }
            media.setOnPreparedListener(p->{if(!rain.contains(holder))return;holder.prepared=true;updateVolume();applyPlayback();});
            media.setOnErrorListener((p,what,extra)->{if(rain.contains(holder))stopSelf();return true;});media.prepareAsync();
        }
    }
    private boolean requestPlaybackFocus(AudioAttributes attributes){
        audio=(AudioManager)getSystemService(AUDIO_SERVICE);int result;
        if(Build.VERSION.SDK_INT>=26){focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes).setOnAudioFocusChangeListener(listener,main).build();result=audio.requestAudioFocus(focus);}
        else result=audio.requestAudioFocus(listener,AudioManager.STREAM_MUSIC,AudioManager.AUDIOFOCUS_GAIN);
        playback.focus(result==AudioManager.AUDIOFOCUS_REQUEST_GRANTED);if(playback.allowed())ducked=false;return playback.allowed();
    }
    private void pauseAudio(){
        playback.pause();getSharedPreferences(PREFS,0).edit().putBoolean(PAUSED,true).apply();
        canPlay=false;applyPlayback();abandonFocus();publishNotification();
        if(primary.isEmpty()&&!rainRequested)stopSelf();
    }
    private void resumeAudio(){
        if(primary.isEmpty()&&!rainRequested){stopSelf();return;}
        playback.play();getSharedPreferences(PREFS,0).edit().putBoolean(PAUSED,false).apply();abandonFocus();
        requestPlaybackFocus(attributes());canPlay=playback.allowed();updateVolume();applyPlayback();publishNotification();
    }
    private void applyPlayback(){
        if(recording!=null)recording.allow(canPlay);
        main.removeCallbacks(rainPulse);
        try{
            for(RainPlayer layer:rain)if(layer.prepared){if(canPlay&&!layer.media.isPlaying())layer.media.start();else if(!canPlay&&layer.media.isPlaying())layer.media.pause();}
            if(!rain.isEmpty()&&canPlay)main.post(rainPulse);
        }catch(RuntimeException error){stopSelf();}
    }
    private PendingIntent action(String value,int request){return PendingIntent.getService(this,request,new Intent(this,AmbientAudioService.class).setAction(value),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private Notification notification(){
        NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel(CHANNEL,PresentationLanguage.text(this,"白噪音","Ambient audio"),NotificationManager.IMPORTANCE_LOW));
        String title=PresentationLanguage.text(this,"环境白噪音","Ambient audio");
        session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE,title).putString(MediaMetadata.METADATA_KEY_ARTIST,"blockcolc").build());
        session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY|PlaybackState.ACTION_PAUSE|PlaybackState.ACTION_PLAY_PAUSE|PlaybackState.ACTION_STOP)
            .setState(canPlay?PlaybackState.STATE_PLAYING:PlaybackState.STATE_PAUSED,PlaybackState.PLAYBACK_POSITION_UNKNOWN,canPlay?1f:0f).build());
        PendingIntent open=PendingIntent.getActivity(this,ID,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        @SuppressWarnings("deprecation") Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);
        return builder.setSmallIcon(R.drawable.ic_stat_tomato_outline).setContentTitle(title).setSubText("blockcolc")
            .setContentText(canPlay?PresentationLanguage.text(this,"正在播放","Playing"):PresentationLanguage.text(this,"已暂停","Paused"))
            .setContentIntent(open).setOnlyAlertOnce(true).setOngoing(true).setShowWhen(false).setVisibility(Notification.VISIBILITY_PUBLIC)
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0))
            .addAction(new Notification.Action.Builder(canPlay?R.drawable.ic_ambient_pause:R.drawable.ic_ambient_play,
                canPlay?PresentationLanguage.text(this,"暂停","Pause"):PresentationLanguage.text(this,"播放","Play"),action(canPlay?PAUSE:PLAY,ID+1)).build())
            .addAction(new Notification.Action.Builder(R.drawable.ic_ambient_stop,PresentationLanguage.text(this,"停止","Stop"),action("stop",ID+2)).build()).build();
    }
    private void publishNotification(){
        if(session==null||!foreground)return;
        int state=canPlay?1:0;String title=PresentationLanguage.text(this,"环境白噪音","Ambient audio");
        if(publishedState==state&&publishedTitle.equals(title))return;
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(ID,notification());publishedState=state;publishedTitle=title;
    }

    private float currentGain(){return ducked?gain*.2f:gain;}
    private void updateVolume(){
        float value=currentGain();if(recording!=null)recording.volume(value*AmbientRainMix.MAIN_GAIN);
        try{for(RainPlayer layer:rain)if(layer.prepared){float level=(float)(value*rainGains[layer.layer]);layer.media.setVolume(level,level);}}
        catch(RuntimeException error){stopSelf();}
    }
    private void releaseMain(){
        primary="";if(recording!=null){recording.dispose();recording=null;}
        if(mainPlayer!=null){mainPlayer.release();mainPlayer=null;}
    }
    private void releaseRain(){
        main.removeCallbacks(rainPulse);for(RainPlayer layer:rain)layer.media.release();rain.clear();
    }
    private void abandonFocus(){if(audio!=null){if(Build.VERSION.SDK_INT>=26&&focus!=null)audio.abandonAudioFocusRequest(focus);else audio.abandonAudioFocus(listener);}focus=null;}
    @Override public void onTaskRemoved(Intent root){stopSelf();}
    @Override public void onDestroy(){
        running=false;releaseMain();releaseRain();abandonFocus();
        if(session!=null){session.setActive(false);session.release();session=null;}
        ServiceCompat.stopForeground(this,ServiceCompat.STOP_FOREGROUND_REMOVE);super.onDestroy();
    }
}
