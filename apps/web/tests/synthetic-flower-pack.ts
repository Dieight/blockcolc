import { strToU8, zipSync } from 'fflate';
import { deflateSync } from 'node:zlib';

/** Authored synthetic cutout assets, not redistributed Minecraft resources. */
export function syntheticFlowerPack(partial = false): Buffer {
  const files: Record<string, Uint8Array> = {
    'pack.mcmeta': strToU8(JSON.stringify({ pack: { pack_format: 34, description: 'Synthetic flower routing audit' } })),
  };
  const species = ['poppy', 'dandelion', 'azure_bluet', 'oxeye_daisy'];
  for (const [index, id] of species.entries()) {
    files[`assets/minecraft/blockstates/${id}.json`] = strToU8(JSON.stringify({ variants: { '': { model: `minecraft:block/${id}` } } }));
    const broken = partial && id !== 'poppy';
    files[`assets/minecraft/models/block/${id}.json`] = strToU8(JSON.stringify({
      textures: { petal: `minecraft:block/${id}`, missing: 'minecraft:block/absent_audit_texture' },
      elements: [45, -45].map((angle, face) => ({ from: [0, 0, 8], to: [16, 16, 8], shade: false,
        rotation: { axis: 'y', angle, origin: [8, 8, 8], rescale: false },
        faces: Object.fromEntries(['north', 'south'].map(direction => [direction,
          { texture: broken && face === 1 ? '#missing' : '#petal', uv: [0, 0, 16, 16] }])) })),
    }));
    files[`assets/minecraft/textures/block/${id}.png`] = flowerPng(index);
  }
  return Buffer.from(zipSync(files, { level: 6 }));
}

function flowerPng(index: number): Uint8Array {
  const colors = [[240, 45, 160], [255, 230, 30], [35, 210, 255], [255, 255, 255]];
  const color = colors[index]!;
  const raw = new Uint8Array(16 * 65);
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
    const offset = y * 65 + 1 + x * 4;
    const stem = y >= 8 && x >= 7 && x <= 8;
    const petals = y >= 2 && y <= 8 && x >= 3 && x <= 12;
    raw.set(stem ? [35, 110, 45, 255] : [...color, petals ? 255 : 0], offset);
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 16);
  new DataView(ihdr.buffer).setUint32(4, 16);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array()));
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = strToU8(type);
  const result = new Uint8Array(data.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(typeBytes, 4);
  result.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of concat(typeBytes, data)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  view.setUint32(data.length + 8, (crc ^ 0xffffffff) >>> 0);
  return result;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of arrays) { result.set(value, offset); offset += value.length; }
  return result;
}
