import {afterEach,expect,it,vi} from 'vitest';
import {AmbientRainMix,AMBIENT_MAIN_GAIN,RAIN_ASSETS,rainIntensity,rainLayerGains} from './ambient-rain-mix';
import {AmbientRainLoop} from './ambient-rain-loop';

it('bounds invalid measurements, preserves light rain and limits the combined peak budget',()=>{
  expect([undefined,NaN,-1,2].map(rainIntensity)).toEqual([.3,.3,0,1]);
  expect(RAIN_ASSETS).toEqual(['audio/rain-light.ogg','audio/rain-heavy.ogg']);
  for(let i=0;i<=100;i++){
    const [light,heavy]=rainLayerGains(i/100);
    expect(light).toBeGreaterThanOrEqual(0);expect(heavy).toBeGreaterThanOrEqual(0);
    expect(light+heavy+AMBIENT_MAIN_GAIN).toBeLessThanOrEqual(1);
  }
  expect(rainLayerGains(0)[0]).toBeGreaterThan(0);
  expect(rainLayerGains(.12)[1]).toBe(0);
  expect(rainLayerGains(1)[1]).toBeGreaterThan(rainLayerGains(.5)[1]);
  expect(rainLayerGains(1)[0]).toBeCloseTo(0);
});
it('ignores tiny fluctuations, glides across strengths and fades out without a new recording',()=>{
  const mix=new AmbientRainMix();mix.set(true,.3);
  const start=mix.step(60);expect(start[0]).toBeGreaterThan(0);expect(start[0]).toBeLessThan(rainLayerGains(.3)[0]);
  mix.step(30000);mix.set(true,.32);mix.step(30000).forEach((gain,i)=>expect(gain).toBeCloseTo(rainLayerGains(.3)[i],12));
  mix.set(true,1);const moving=mix.step(60);expect(moving[0]).toBeGreaterThan(0);expect(moving[1]).toBeLessThan(rainLayerGains(1)[1]);
  expect(mix.step(30000)[1]).toBeCloseTo(rainLayerGains(1)[1]);
  mix.set(false,1);expect(Math.max(...mix.step(10000))).toBeLessThan(.0001);
});
class FakeAudio extends EventTarget {
  loop=false;preload='';volume=1;paused=true;plays=0;currentTime=0;
  constructor(readonly url:string){super();}
  async play(){this.paused=false;this.plays++;}pause(){this.paused=true;}load(){}removeAttribute(){}
}
afterEach(()=>vi.useRealTimers());
it('streams both complete files once, changes only gains and tears down a dry weather tail',async()=>{
  vi.useFakeTimers({toFake:['setInterval','clearInterval','performance']});
  const media:FakeAudio[]=[],fail=vi.fn(),loop=new AmbientRainLoop(fail,url=>{
    const audio=new FakeAudio(url);media.push(audio);return audio as unknown as HTMLAudioElement;
  });
  loop.update(true,.12,.5);await Promise.resolve();await vi.advanceTimersByTimeAsync(3000);
  expect(media).toHaveLength(2);expect(media.every(item=>item.loop&&item.plays===1)).toBe(true);
  const light=media[0].volume;media.forEach(item=>item.currentTime=20);
  loop.update(true,1,.5);await vi.advanceTimersByTimeAsync(3000);
  expect(media[0].volume).toBeLessThan(light);expect(media[1].volume).toBeGreaterThan(media[0].volume);
  expect(media.map(item=>item.currentTime)).toEqual([20,20]);expect(media.map(item=>item.plays)).toEqual([1,1]);
  loop.update(false,0,.5);expect(media.every(item=>!item.paused)).toBe(true);
  await vi.advanceTimersByTimeAsync(12000);expect(media.every(item=>item.paused)).toBe(true);expect(vi.getTimerCount()).toBe(0);
  loop.dispose();expect(fail).not.toHaveBeenCalled();
});
