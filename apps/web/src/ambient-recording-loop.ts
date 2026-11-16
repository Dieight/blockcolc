/** Full recordings play once, breathe for 12–30 seconds, then start at zero. */
export const AMBIENT_GAP_MIN_MS=12000,AMBIENT_GAP_MAX_MS=30000;
export function ambientGapMs(random:number):number{return Math.round(AMBIENT_GAP_MIN_MS+(AMBIENT_GAP_MAX_MS-AMBIENT_GAP_MIN_MS)*Math.max(0,Math.min(1,Number.isFinite(random)?random:.5)));}
export function ambientFadeGain(position:number,duration:number):number{
  if(!Number.isFinite(duration)||duration<=0)return 0;
  const fade=Math.min(1.5,duration/4);
  return Math.max(0,Math.min(1,position/fade,(duration-position)/fade));
}
export class AmbientRecordingLoop {
  private disposed=false;private waiting=false;private volume:number;
  private gap:ReturnType<typeof setTimeout>|undefined;
  private readonly pulse:ReturnType<typeof setInterval>;
  constructor(readonly media:HTMLAudioElement,volume:number,private readonly fail:()=>void,private readonly random= Math.random){
    this.volume=volume;media.loop=false;media.preload='auto';media.volume=0;
    media.addEventListener('ended',this.ended);media.addEventListener('error',this.fail);media.addEventListener('timeupdate',this.fade);
    this.pulse=setInterval(this.fade,100);
  }
  private fade=()=>{if(!this.disposed)this.media.volume=this.volume*ambientFadeGain(this.media.currentTime,this.media.duration);};
  private ended=()=>{
    if(this.disposed||this.waiting)return;this.waiting=true;this.media.volume=0;
    this.gap=setTimeout(()=>{this.gap=undefined;if(this.disposed)return;this.media.currentTime=0;this.waiting=false;void this.resume().catch(this.fail);},ambientGapMs(this.random()));
  };
  setVolume(value:number){this.volume=value;this.fade();}
  async resume():Promise<void>{
    if(this.disposed||this.waiting||!this.media.paused)return;
    this.fade();try{await this.media.play();}catch(error){if((error as DOMException)?.name!=='NotAllowedError'&&(error as DOMException)?.name!=='AbortError')throw error;}
  }
  dispose(){
    this.disposed=true;clearInterval(this.pulse);clearTimeout(this.gap);
    this.media.removeEventListener('ended',this.ended);this.media.removeEventListener('error',this.fail);this.media.removeEventListener('timeupdate',this.fade);
    this.media.pause();this.media.removeAttribute('src');this.media.load();
  }
}
