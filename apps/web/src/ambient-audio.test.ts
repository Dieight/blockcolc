import {afterEach,expect,it,vi} from 'vitest';
const bridge=vi.hoisted(()=>({native:false,configure:vi.fn().mockResolvedValue(undefined)}));
vi.mock('@blockcolc/platform-capacitor',()=>({isNativeAmbient:()=>bridge.native,nativeAmbientAudio:{configure:bridge.configure}}));
import {configureAmbience} from './ambient-audio';
class FakeAudio extends EventTarget {
  loop=false;preload='';volume=1;paused=true;plays=0;currentTime=10;duration=180;
  constructor(readonly src:string){super();}
  async play(){this.paused=false;this.plays++;}pause(){this.paused=true;}load(){}removeAttribute(){}
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();bridge.native=false;});
it('weather changes and volume updates do not re-seek or attenuate the main recording',async()=>{
  vi.useFakeTimers({toFake:['setInterval','clearInterval','setTimeout','clearTimeout','performance']});
  const all:FakeAudio[]=[];
  vi.stubGlobal('Audio',class extends FakeAudio {constructor(src:string){super(src);all.push(this);}});
  await configureAmbience(['forest-birds','rain'],100,.12);await vi.advanceTimersByTimeAsync(3000);
  expect(all).toHaveLength(3);const main=all.find(item=>item.src==='audio/forest-birds.ogg')!;
  expect(main.volume).toBe(.7);expect(main.plays).toBe(1);
  await configureAmbience(['forest-birds','rain'],100,1);await vi.advanceTimersByTimeAsync(3000);
  expect(all).toHaveLength(3);expect(main.volume).toBe(.7);expect(main.currentTime).toBe(10);expect(main.plays).toBe(1);
  await configureAmbience(['forest-birds'],100,0);await vi.advanceTimersByTimeAsync(12000);
  expect(main.volume).toBe(.7);expect(main.paused).toBe(false);expect(all.filter(item=>item!==main).every(item=>item.paused)).toBe(true);
  await configureAmbience([],100);await vi.advanceTimersByTimeAsync(12000);expect(vi.getTimerCount()).toBe(0);
});
it('passes the same measured intensity to Android without changing source identities',async()=>{
  bridge.native=true;await configureAmbience(['shore-waves','rain'],35,.8);
  expect(bridge.configure).toHaveBeenLastCalledWith({sources:['shore-waves','rain'],volume:35,rainIntensity:.8});
});
