export const PORTAL_FLAME_WIDTH = 60;
export const PORTAL_FLAME_HEIGHT = 104;

const PALETTE = [
  [91, 40, 130, 135], [111, 48, 151, 185], [139, 59, 177, 220],
  [163, 75, 199, 240], [187, 100, 218, 250], [211, 135, 235, 255],
  [232, 174, 247, 255], [246, 209, 253, 255], [255, 239, 255, 255],
] as const;
const smooth = (value: number) => value * value * (3 - 2 * value);
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function latticeHash(x: number, y: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const u = smooth(x - ix), v = smooth(y - iy);
  return (latticeHash(ix, iy) * (1 - u) + latticeHash(ix + 1, iy) * u) * (1 - v)
    + (latticeHash(ix, iy + 1) * (1 - u) + latticeHash(ix + 1, iy + 1) * u) * v;
}

/** One turbulent column, rather than a silhouette with a predetermined fork.
 * Heat is advected up through the entire body. The same field forms curling
 * edges, changing wisps and the bright root, so there is no crown/body seam. */
export function portalFlameFrame(time: number): Uint8ClampedArray<ArrayBuffer> {
  const width = PORTAL_FLAME_WIDTH, height = PORTAL_FLAME_HEIGHT;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const heat = new Float32Array(width * height);
  const occupied = new Uint8Array(width * height);

  for (let y = 3; y <= 96; y++) {
    const rise = (96 - y) / 93;
    const anchored = smooth(clamp((96 - y) / 10));
    const curl = Math.sin(y * .115 + time * 3.1) * 1.6
      + Math.sin(y * .237 + time * 4.7) * .8;
    const axis = 30 + curl * anchored;
    const span = 20 + Math.sin(rise * Math.PI) * 4.5 - rise * 4;
    for (let x = 3; x < width - 3; x++) {
      const distance = (x + .5 - axis) / span;
      const warp = (noise(x * .105, y * .105 + time * 1.6) - .5) * 5.5;
      // Positive time moves features toward smaller screen y, not downwards.
      const flow = noise((x + warp) * .21, y * .07 + time * 3.8);
      const detail = noise((x + warp) * .39, y * .16 + time * 5.2);
      const density = 1 - Math.pow(Math.abs(distance), 1.65) - rise * .18
        + (flow - .5) * .72 + (detail - .5) * .17;
      const crownHeight = 7 + noise((x + warp) * .24, time * 1.4) * 12
        + Math.pow(Math.abs(distance), 1.8) * 24;
      const tipFade = clamp((y - crownHeight) / 4);
      const value = density * tipFade;
      const at = y * width + x;
      if (value > .13) {
        occupied[at] = 1;
        // Narrow, curling inner ribbons cross a wider luminous lower core.
        const filament = Math.sin((distance + (flow - .5) * .5) * 13 + warp * .7);
        const ribbon = Math.pow(Math.max(0, filament), 4) * .18
          + Math.exp(-Math.pow(distance / .38, 2)) * .14;
        heat[at] = clamp(value * .66 + ribbon + (1 - rise) * .16 + detail * .1);
      }
    }
  }

  // Keep only fuel-connected fire. Thresholded noise must not create floating
  // blobs or two persistent horns above a static lower shape.
  const connected = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let read = 0, end = 0;
  const visit = (at: number) => {
    if (at < 0 || at >= occupied.length || !occupied[at] || connected[at]) return;
    connected[at] = 1; queue[end++] = at;
  };
  for (let x = 18; x <= 42; x++) visit(96 * width + x);
  while (read < end) {
    const at = queue[read++]!, x = at % width;
    if (x > 0) visit(at - 1);
    if (x < width - 1) visit(at + 1);
    visit(at - width); visit(at + width);
  }
  for (let at = 0; at < connected.length; at++) {
    if (connected[at]) pixels.set(PALETTE[Math.min(8, Math.floor(heat[at]! * 9))]!, at * 4);
  }

  // A small pixel glow at the foot, like the reference's pool of light. It is
  // local to this overlay; the world exposure and last-frame backdrop stay put.
  for (let y = 95; y <= 101; y++) for (let x = 8; x < 52; x++) {
    const reach = Math.pow((x + .5 - 30) / 22, 2) + Math.pow((y - 97) / 4.5, 2);
    const at = (y * width + x) * 4;
    if (reach < 1 && !pixels[at + 3]) {
      pixels.set([176, 91, 217, Math.round((1 - reach) * 72)], at);
    }
  }
  return pixels;
}

export function attachPortalFlame(host: HTMLElement): () => void {
  const canvas = document.createElement('canvas');
  canvas.width = PORTAL_FLAME_WIDTH; canvas.height = PORTAL_FLAME_HEIGHT;
  canvas.className = 'mode-portal__flame-canvas'; host.append(canvas);
  const context = canvas.getContext('2d');
  if (!context) return () => canvas.remove();
  context.imageSmoothingEnabled = false;
  let frame = 0, last = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const paint = (now: number) => {
    if (now - last >= 33 || !last) {
      last = now;
      context.putImageData(new ImageData(portalFlameFrame(reduced ? 0 : now / 1000),
        PORTAL_FLAME_WIDTH, PORTAL_FLAME_HEIGHT), 0, 0);
      host.dataset.flameFrame = String(Math.floor(now / 33));
    }
    if (!reduced) frame = requestAnimationFrame(paint);
  };
  frame = requestAnimationFrame(paint);
  return () => { cancelAnimationFrame(frame); canvas.remove(); };
}
