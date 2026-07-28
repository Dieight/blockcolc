const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_SHORT = 2;
const TAG_INT = 3;
const TAG_LONG = 4;
const TAG_FLOAT = 5;
const TAG_DOUBLE = 6;
const TAG_BYTE_ARRAY = 7;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const TAG_INT_ARRAY = 11;
const TAG_LONG_ARRAY = 12;

export interface JavaNbtLimits {
  maxDepth: number;
  maxTags: number;
  maxCollectionLength: number;
  maxStringBytes: number;
}

export const DEFAULT_JAVA_NBT_LIMITS: Readonly<JavaNbtLimits> = Object.freeze({
  maxDepth: 64,
  maxTags: 1_000_000,
  maxCollectionLength: 2_097_152,
  maxStringBytes: 65_535,
});

export class JavaNbtParseError extends Error {
  override readonly name = "JavaNbtParseError";
}

/**
 * Parses one uncompressed Java-edition, big-endian NBT root compound into the
 * primitive object shape consumed by the Litematic importer. This deliberately
 * contains no generated code, Node polyfills or dynamic evaluation.
 */
export function parseJavaNbt(
  input: Uint8Array,
  limits: Partial<JavaNbtLimits> = {},
): Record<string, unknown> {
  const resolved = resolveLimits(limits);
  return new JavaNbtReader(input, resolved).parseRootCompound();
}

class JavaNbtReader {
  private readonly view: DataView;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private offset = 0;
  private tagCount = 0;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly limits: JavaNbtLimits,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  parseRootCompound(): Record<string, unknown> {
    const type = this.readUint8("root tag type");
    if (type !== TAG_COMPOUND) this.fail("Root NBT tag must be a compound");
    this.countTag();
    this.readString("root tag name");
    const root = this.readPayload(TAG_COMPOUND, 0);
    if (this.offset !== this.bytes.byteLength) this.fail("Trailing bytes after the root compound");
    return root as Record<string, unknown>;
  }

  private readPayload(type: number, depth: number): unknown {
    if (depth > this.limits.maxDepth) this.fail(`NBT depth exceeds ${this.limits.maxDepth}`);
    switch (type) {
      case TAG_BYTE: return this.readInt8("byte payload");
      case TAG_SHORT: return this.readInt16("short payload");
      case TAG_INT: return this.readInt32("int payload");
      case TAG_LONG: return this.readBigInt64("long payload");
      case TAG_FLOAT: return this.readFloat32("float payload");
      case TAG_DOUBLE: return this.readFloat64("double payload");
      case TAG_BYTE_ARRAY: return this.readByteArray();
      case TAG_STRING: return this.readString("string payload");
      case TAG_LIST: return this.readList(depth);
      case TAG_COMPOUND: return this.readCompound(depth);
      case TAG_INT_ARRAY: return this.readIntArray();
      case TAG_LONG_ARRAY: return this.readLongArray();
      default: this.fail(`Unsupported NBT tag type ${type}`);
    }
  }

  private readCompound(depth: number): Record<string, unknown> {
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    while (true) {
      const type = this.readUint8("compound tag type");
      if (type === TAG_END) return output;
      this.assertPayloadType(type);
      this.countTag();
      const name = this.readString("compound tag name");
      if (Object.prototype.hasOwnProperty.call(output, name)) this.fail(`Duplicate compound tag ${JSON.stringify(name)}`);
      output[name] = this.readPayload(type, depth + 1);
    }
  }

  private readList(depth: number): unknown[] {
    const itemType = this.readUint8("list item type");
    const length = this.readCollectionLength("list");
    if (itemType === TAG_END && length !== 0) this.fail("TAG_End list type is only valid for an empty list");
    if (itemType !== TAG_END) this.assertPayloadType(itemType);
    if (length > this.limits.maxTags - this.tagCount) this.fail(`NBT tag count exceeds ${this.limits.maxTags}`);
    const output = new Array<unknown>(length);
    for (let index = 0; index < length; index += 1) {
      this.countTag();
      output[index] = this.readPayload(itemType, depth + 1);
    }
    return output;
  }

  private readByteArray(): Uint8Array {
    const length = this.readArrayLength("byte array", this.bytes.byteLength);
    this.requireBytes(length, "byte array payload");
    const output = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return output;
  }

  private readIntArray(): number[] {
    const length = this.readArrayLength("int array", this.limits.maxCollectionLength);
    this.requireBytes(length * 4, "int array payload");
    const output = new Array<number>(length);
    for (let index = 0; index < length; index += 1) output[index] = this.readInt32("int array value");
    return output;
  }

  private readLongArray(): bigint[] {
    const length = this.readArrayLength("long array", this.limits.maxCollectionLength);
    this.requireBytes(length * 8, "long array payload");
    const output = new Array<bigint>(length);
    for (let index = 0; index < length; index += 1) output[index] = this.readBigInt64("long array value");
    return output;
  }

  private readString(location: string): string {
    const length = this.readUint16(`${location} length`);
    if (length > this.limits.maxStringBytes) this.fail(`${location} exceeds ${this.limits.maxStringBytes} bytes`);
    this.requireBytes(length, location);
    const raw = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    try {
      return this.decoder.decode(raw);
    } catch (cause) {
      throw new JavaNbtParseError(`${location} is not valid UTF-8`, { cause });
    }
  }

  private readCollectionLength(location: string): number {
    return this.readArrayLength(location, this.limits.maxCollectionLength);
  }

  private readArrayLength(location: string, maximum: number): number {
    const length = this.readInt32(`${location} length`);
    if (length < 0) this.fail(`${location} length cannot be negative`);
    if (length > maximum) this.fail(`${location} length exceeds ${maximum}`);
    return length;
  }

  private assertPayloadType(type: number): void {
    if (type < TAG_BYTE || type > TAG_LONG_ARRAY) this.fail(`Invalid NBT tag type ${type}`);
  }

  private countTag(): void {
    this.tagCount += 1;
    if (this.tagCount > this.limits.maxTags) this.fail(`NBT tag count exceeds ${this.limits.maxTags}`);
  }

  private readUint8(location: string): number {
    this.requireBytes(1, location);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  private readInt8(location: string): number {
    this.requireBytes(1, location);
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  private readUint16(location: string): number {
    this.requireBytes(2, location);
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  private readInt16(location: string): number {
    this.requireBytes(2, location);
    const value = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return value;
  }

  private readInt32(location: string): number {
    this.requireBytes(4, location);
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  private readBigInt64(location: string): bigint {
    this.requireBytes(8, location);
    const value = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    return value;
  }

  private readFloat32(location: string): number {
    this.requireBytes(4, location);
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  private readFloat64(location: string): number {
    this.requireBytes(8, location);
    const value = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return value;
  }

  private requireBytes(length: number, location: string): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.byteLength) {
      this.fail(`Unexpected end of NBT while reading ${location}`);
    }
  }

  private fail(message: string): never {
    throw new JavaNbtParseError(`${message} at byte ${this.offset}`);
  }
}

function resolveLimits(overrides: Partial<JavaNbtLimits>): JavaNbtLimits {
  const limits = { ...DEFAULT_JAVA_NBT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new JavaNbtParseError(`${name} must be a positive safe integer`);
  }
  return limits;
}
