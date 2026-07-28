import { unzlibSync } from "fflate";

export interface DecodedPngRgba {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface DecodePngRgbaOptions {
  expectedWidth?: number;
  expectedHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
  maxDecodedBytes?: number;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const DEFAULT_MAX_DIMENSION = 4096;
const DEFAULT_MAX_PIXELS = 1_048_576;
const DEFAULT_MAX_DECODED_BYTES = DEFAULT_MAX_PIXELS * 4;

export function inspectPngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.byteLength < 57 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width: number | undefined;
  let height: number | undefined;
  let sawIdat = false;
  let sawIend = false;
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset, false);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > bytes.byteLength) return undefined;
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    if (crc32(concat(typeBytes, bytes.subarray(offset + 8, offset + 8 + length))) !== view.getUint32(offset + 8 + length, false)) return undefined;
    if (offset === 8 && (type !== "IHDR" || length !== 13)) return undefined;
    if (type === "IHDR") {
      if (width !== undefined || length !== 13) return undefined;
      width = view.getUint32(offset + 8, false);
      height = view.getUint32(offset + 12, false);
      const bitDepth = bytes[offset + 16];
      const colorType = bytes[offset + 17];
      const validBitDepth = bitDepth !== undefined && [1, 2, 4, 8, 16].includes(bitDepth);
      const validColorType = colorType !== undefined && [0, 2, 3, 4, 6].includes(colorType);
      if (!width || !height || !validBitDepth || !validColorType) return undefined;
    } else if (type === "IDAT") sawIdat = true;
    else if (type === "IEND") {
      if (length !== 0 || end !== bytes.byteLength) return undefined;
      sawIend = true;
      break;
    }
    offset = end;
  }
  return width !== undefined && height !== undefined && sawIdat && sawIend ? { width, height } : undefined;
}

/** Strict, bounded, browser-safe PNG decoder used by texture sheets and 256x256 colormaps. */
export function decodePngRgba(bytes: Uint8Array, options: DecodePngRgbaOptions = {}): DecodedPngRgba {
  const maxWidth = boundedOption(options.maxWidth, DEFAULT_MAX_DIMENSION, "maxWidth");
  const maxHeight = boundedOption(options.maxHeight, DEFAULT_MAX_DIMENSION, "maxHeight");
  const maxPixels = boundedOption(options.maxPixels, DEFAULT_MAX_PIXELS, "maxPixels");
  const maxDecodedBytes = boundedOption(options.maxDecodedBytes, DEFAULT_MAX_DECODED_BYTES, "maxDecodedBytes");
  const expectedWidth = optionalDimension(options.expectedWidth, "expectedWidth");
  const expectedHeight = optionalDimension(options.expectedHeight, "expectedHeight");
  if (bytes.byteLength < 57 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) throw new Error("Invalid PNG signature.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = -1;
  let height = -1;
  let colorType = -1;
  let bitDepth = -1;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  let sawIend = false;
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset, false);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > bytes.byteLength) throw new Error("Truncated PNG chunk.");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(concat(typeBytes, data)) !== view.getUint32(offset + 8 + length, false)) throw new Error(`Invalid ${type} CRC.`);
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) throw new Error("PNG must begin with one IHDR chunk.");
      width = view.getUint32(offset + 8, false);
      height = view.getUint32(offset + 12, false);
      if (width < 1 || height < 1 || width > maxWidth || height > maxHeight) throw new Error(`PNG dimensions ${width}x${height} exceed configured bounds.`);
      if (expectedWidth !== undefined && width !== expectedWidth) throw new Error(`PNG width ${width} does not match expected width ${expectedWidth}.`);
      if (expectedHeight !== undefined && height !== expectedHeight) throw new Error(`PNG height ${height} does not match expected height ${expectedHeight}.`);
      const pixels = width * height;
      if (!Number.isSafeInteger(pixels) || pixels > maxPixels || pixels * 4 > maxDecodedBytes) throw new Error("PNG decoded pixel data exceeds configured bounds.");
      bitDepth = data[8] ?? -1;
      colorType = data[9] ?? -1;
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error("Only standard non-interlaced PNG is supported.");
    } else if (type === "IHDR") throw new Error("PNG contains more than one IHDR chunk.");
    else if (type === "PLTE") palette = new Uint8Array(data);
    else if (type === "tRNS") transparency = new Uint8Array(data);
    else if (type === "IDAT") idat.push(new Uint8Array(data));
    else if (type === "IEND") {
      if (length !== 0 || end !== bytes.byteLength) throw new Error("Invalid PNG ending.");
      sawIend = true;
      break;
    }
    offset = end;
  }
  if (!sawIend || idat.length === 0 || width < 1 || height < 1) throw new Error("PNG is missing image data or IEND.");
  const format = pngFormat(colorType, bitDepth, palette);
  const compressed = concat(...idat);
  const rowBytes = Math.ceil((width * format.bitsPerPixel) / 8);
  const expectedBytes = (rowBytes + 1) * height;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes > maxDecodedBytes + height) throw new Error("PNG scanline data exceeds configured bounds.");
  if (compressed.byteLength < 6) throw new Error("PNG zlib stream is too short.");
  const inflated = unzlibSync(compressed, { out: new Uint8Array(expectedBytes) });
  const checksumOffset = compressed.byteLength - 4;
  const declaredChecksum = new DataView(compressed.buffer, compressed.byteOffset + checksumOffset, 4).getUint32(0, false);
  if (inflated.byteLength !== expectedBytes || adler32(inflated) !== declaredChecksum) throw new Error("PNG scanline size or zlib checksum is invalid.");
  const rows = unfilter(inflated, rowBytes, Math.max(1, Math.ceil(format.bitsPerPixel / 8)), height);
  return { width, height, rgba: expandRgba(rows, rowBytes, width, height, colorType, bitDepth, palette, transparency) };
}

function boundedOption(raw: number | undefined, fallback: number, name: string): number {
  const value = raw ?? fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer.`);
  return value;
}

function optionalDimension(value: number | undefined, name: string): number | undefined {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new TypeError(`${name} must be a positive safe integer.`);
  return value;
}

function pngFormat(colorType: number, bitDepth: number, palette: Uint8Array | undefined): { bitsPerPixel: number } {
  if (colorType === 6 && bitDepth === 8) return { bitsPerPixel: 32 };
  if (colorType === 4 && bitDepth === 8) return { bitsPerPixel: 16 };
  if (colorType === 2 && bitDepth === 8) return { bitsPerPixel: 24 };
  if (colorType === 0 && bitDepth === 8) return { bitsPerPixel: 8 };
  if (colorType === 3 && [1, 2, 4, 8].includes(bitDepth) && palette && palette.length > 0 && palette.length % 3 === 0 && palette.length <= 768) return { bitsPerPixel: bitDepth };
  throw new Error(`Unsupported PNG color type ${colorType} / bit depth ${bitDepth}.`);
}

function unfilter(input: Uint8Array, rowBytes: number, bytesPerPixel: number, height: number): Uint8Array {
  const output = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const inputOffset = y * (rowBytes + 1);
    const outputOffset = y * rowBytes;
    const filter = input[inputOffset];
    if (filter === undefined || filter > 4) throw new Error("Invalid PNG filter.");
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = input[inputOffset + 1 + x] ?? 0;
      const left = x >= bytesPerPixel ? output[outputOffset + x - bytesPerPixel] ?? 0 : 0;
      const up = y > 0 ? output[outputOffset - rowBytes + x] ?? 0 : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? output[outputOffset - rowBytes + x - bytesPerPixel] ?? 0 : 0;
      const value = filter === 0 ? raw : filter === 1 ? raw + left : filter === 2 ? raw + up : filter === 3 ? raw + Math.floor((left + up) / 2) : raw + paeth(left, up, upperLeft);
      output[outputOffset + x] = value & 0xff;
    }
  }
  return output;
}

function expandRgba(rows: Uint8Array, rowBytes: number, width: number, height: number, colorType: number, bitDepth: number, palette?: Uint8Array, transparency?: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const source = y * rowBytes;
    const target = (y * width + x) * 4;
    if (colorType === 6) rgba.set(rows.subarray(source + x * 4, source + x * 4 + 4), target);
    else if (colorType === 4) { const gray = rows[source + x * 2] ?? 0; rgba.set([gray, gray, gray, rows[source + x * 2 + 1] ?? 255], target); }
    else if (colorType === 2) {
      const pixel = source + x * 3; const red = rows[pixel] ?? 0; const green = rows[pixel + 1] ?? 0; const blue = rows[pixel + 2] ?? 0;
      const transparent = transparency?.length === 6 && red === transparency[1] && green === transparency[3] && blue === transparency[5];
      rgba.set([red, green, blue, transparent ? 0 : 255], target);
    } else if (colorType === 0) { const gray = rows[source + x] ?? 0; rgba.set([gray, gray, gray, transparency?.length === 2 && gray === transparency[1] ? 0 : 255], target); }
    else {
      const bitOffset = x * bitDepth; const packed = rows[source + Math.floor(bitOffset / 8)] ?? 0; const shift = 8 - bitDepth - (bitOffset % 8); const index = (packed >>> shift) & ((1 << bitDepth) - 1); const paletteOffset = index * 3;
      if (!palette || paletteOffset + 2 >= palette.length) throw new Error("PNG palette index is out of range.");
      rgba.set([palette[paletteOffset]!, palette[paletteOffset + 1]!, palette[paletteOffset + 2]!, transparency?.[index] ?? 255], target);
    }
  }
  return rgba;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft; const leftDistance = Math.abs(prediction - left); const upDistance = Math.abs(prediction - up); const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance ? left : upDistance <= upperLeftDistance ? up : upperLeft;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1; let b = 0;
  for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0)); let offset = 0;
  for (const array of arrays) { output.set(array, offset); offset += array.length; }
  return output;
}
