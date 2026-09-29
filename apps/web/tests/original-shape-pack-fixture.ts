import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { parseJava16xResourcePack } from '@blockcolc/resource-pack';
import { strToU8, zipSync } from 'fflate';

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const name = strToU8(type);
  const output = new Uint8Array(data.length + 12);
  new DataView(output.buffer).setUint32(0, data.length);
  output.set(name, 4); output.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of [...name, ...data]) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  new DataView(output.buffer).setUint32(data.length + 8, (crc ^ 0xffffffff) >>> 0);
  return output;
}

function tinyPng(): Uint8Array {
  const raw = new Uint8Array(16 * 65);
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1)
    raw.set([220, 45 + x * 3, 70 + y * 2, 255], y * 65 + 1 + x * 4);
  const header = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 16);
  new DataView(ihdr.buffer).setUint32(4, 16);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const pieces = [header, pngChunk('IHDR', ihdr), pngChunk('IDAT', new Uint8Array(deflateSync(raw))), pngChunk('IEND', new Uint8Array())];
  const output = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) { output.set(piece, offset); offset += piece.length; }
  return output;
}

export function syntheticOriginalShapePack(blockPath: string, variant: string, missingModel: boolean) {
  const model = missingModel ? 'minecraft:block/original_shape_probe_missing' : 'minecraft:block/original_shape_probe';
  const files = {
    'pack.mcmeta': strToU8(JSON.stringify({ pack: { pack_format: 97, description: 'Original shape route probe' } })),
    [`assets/minecraft/blockstates/${blockPath}.json`]: strToU8(JSON.stringify({ variants: { [variant]: { model } } })),
    'assets/minecraft/models/block/original_shape_probe.json': strToU8(JSON.stringify({ parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/original_shape_probe' } })),
    'assets/minecraft/textures/block/original_shape_probe.png': tinyPng(),
  };
  const zip = Buffer.from(zipSync(files, { level: 6 }));
  return { id: `sha256:${createHash('sha256').update(zip).digest('hex')}`, manifest: parseJava16xResourcePack(zip) };
}
