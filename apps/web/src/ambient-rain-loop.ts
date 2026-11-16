import {AmbientRainMix, RAIN_ASSETS} from './ambient-rain-mix';

/** Stream both complete recordings. No AudioBuffer or whole-file PCM allocation. */
export class AmbientRainLoop {
  private readonly mix = new AmbientRainMix();
  private media: HTMLAudioElement[] = [];
  private enabled = false;
  private disposed = false;
  private volume = 0;
  private last = 0;
  private pulse: ReturnType<typeof setInterval> | undefined;
  constructor(private readonly fail: () => void, private readonly create = (url: string) => new Audio(url)) {}
  update(enabled: boolean, intensity: number | undefined, volume: number) {
    if (this.disposed) return;
    this.enabled = enabled; this.volume = volume; this.mix.set(enabled, intensity);
    if (enabled && !this.media.length) {
      this.media = RAIN_ASSETS.map(url => {
        const media = this.create(url); media.loop = true; media.preload = 'auto'; media.volume = 0;
        media.addEventListener('error', this.failed); return media;
      });
    }
    if (this.media.length && !this.pulse) { this.last = performance.now(); this.pulse = setInterval(this.tick, 60); }
    if (enabled) void this.resume().catch(this.failed);
  }
  private failed = () => { if (!this.disposed) { this.dispose(); this.fail(); } };
  private tick = () => {
    if (this.disposed) return;
    const now = performance.now(), gains = this.mix.step(now - this.last); this.last = now;
    this.media.forEach((media, i) => { media.volume = this.volume * gains[i]; });
    if (!this.enabled && Math.max(...gains) < .0001) this.release();
  };
  async resume() {
    if (this.disposed || !this.enabled) return;
    await Promise.all(this.media.filter(media => media.paused).map(async media => {
      try { await media.play(); }
      catch (error) { if (!['NotAllowedError', 'AbortError'].includes((error as DOMException)?.name)) throw error; }
    }));
  }
  private release() {
    clearInterval(this.pulse); this.pulse = undefined;
    this.media.forEach(media => { media.removeEventListener('error', this.failed); media.pause(); media.removeAttribute('src'); media.load(); });
    this.media = [];
  }
  dispose() { this.disposed = true; this.release(); }
}
