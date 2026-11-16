import {afterEach,expect,it,vi} from 'vitest';
import {AmbientRecordingLoop,ambientFadeGain,ambientGapMs} from './ambient-recording-loop';
class FakeAudio extends EventTarget {
  currentTime=0;duration=180;volume=1;loop=true;preload='';paused=true;plays=0;src='test';
  async play(){this.paused=false;this.plays++;}pause(){this.paused=true;}load(){}removeAttribute(){this.src='';}
}
afterEach(()=>vi.useRealTimers());
it('fades symmetrically and bounds the random breathing gap',()=>{
  expect([0,.5,1,-10,100,NaN].map(ambientGapMs)).toEqual([12000,21000,30000,12000,30000,21000]);
  expect([0,.75,1.5,100,179.25,180].map(t=>ambientFadeGain(t,180))).toEqual([0,.5,1,1,.5,0]);
  expect(ambientFadeGain(.5,1)).toBe(1);expect(ambientFadeGain(0,NaN)).toBe(0);
});
it('plays the entire recording, cannot skip silence by tapping, and never restarts after disposal',async()=>{
  vi.useFakeTimers();const media=new FakeAudio(),fail=vi.fn(),loop=new AmbientRecordingLoop(media as unknown as HTMLAudioElement,.4,fail,()=>0);
  await loop.resume();expect(media.loop).toBe(false);expect(media.plays).toBe(1);
  media.currentTime=.75;media.dispatchEvent(new Event('timeupdate'));expect(media.volume).toBeCloseTo(.2);
  media.currentTime=180;media.paused=true;media.dispatchEvent(new Event('ended'));media.dispatchEvent(new Event('ended'));await loop.resume();expect(media.plays).toBe(1);
  await vi.advanceTimersByTimeAsync(11999);expect(media.currentTime).toBe(180);expect(media.plays).toBe(1);
  await vi.advanceTimersByTimeAsync(1);expect(media.currentTime).toBe(0);expect(media.plays).toBe(2);
  media.currentTime=10;loop.setVolume(.2);expect(media.volume).toBe(.2);expect(media.plays).toBe(2);
  media.dispatchEvent(new Event('ended'));loop.dispose();await vi.advanceTimersByTimeAsync(20000);expect(media.plays).toBe(2);expect(media.paused).toBe(true);expect(vi.getTimerCount()).toBe(0);expect(fail).not.toHaveBeenCalled();
});
