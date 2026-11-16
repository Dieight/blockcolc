package com.blockcolc.app;

import android.media.MediaPlayer;
import android.os.Handler;

/** Main-thread owner of fade / completion / random rest; never decodes whole files. */
final class AmbientRecordingLoop {
    private final MediaPlayer player;private final Handler handler;private final Runnable failed;
    private boolean prepared,allowed,waiting,seeking,disposed;private float volume;
    private final Runnable pulse=new Runnable(){public void run(){guarded(()->{if(!prepared)return;applyVolume();if(allowed&&!waiting&&!seeking)handler.postDelayed(this,50);});}};
    private final Runnable restart=this::restartFromBeginning;
    private void restartFromBeginning(){guarded(()->{waiting=false;seeking=true;player.seekTo(0);});}
    AmbientRecordingLoop(MediaPlayer player,Handler handler,Runnable failed){
        this.player=player;this.handler=handler;this.failed=failed;player.setLooping(false);
        player.setOnCompletionListener(p->guarded(()->{if(waiting||seeking)return;waiting=true;handler.removeCallbacks(pulse);p.setVolume(0,0);handler.postDelayed(restart,AmbientPlaybackTiming.gapMs(Math.random()));}));
        player.setOnSeekCompleteListener(p->guarded(()->{seeking=false;resume();}));
    }
    void prepared(boolean canPlay,float gain){prepared=true;allowed=canPlay;volume=gain;guarded(this::resume);}
    void allow(boolean value){allowed=value;guarded(()->{if(!prepared)return;if(value)resume();else{handler.removeCallbacks(pulse);if(player.isPlaying())player.pause();}});}
    void volume(float value){volume=value;guarded(()->{if(prepared)applyVolume();});}
    private void applyVolume(){float gain=waiting||seeking?0:volume*AmbientPlaybackTiming.fadeGain(player.getCurrentPosition(),player.getDuration());player.setVolume(gain,gain);}
    private void resume(){if(disposed||!prepared||!allowed||waiting||seeking)return;applyVolume();if(!player.isPlaying())player.start();handler.removeCallbacks(pulse);handler.post(pulse);}
    private void guarded(Runnable action){if(disposed)return;try{action.run();}catch(RuntimeException error){dispose();failed.run();}}
    void dispose(){if(disposed)return;disposed=true;handler.removeCallbacks(pulse);handler.removeCallbacks(restart);player.setOnCompletionListener(null);player.setOnSeekCompleteListener(null);}
}
