export interface TestNbtTag {
  type: number;
  value: unknown;
}

interface TestNbtList {
  itemType: number;
  items: readonly TestNbtTag[];
}

export const testNbt = {
  int: (value: number): TestNbtTag => ({ type: 3, value }),
  longArray: (value: readonly bigint[]): TestNbtTag => ({ type: 12, value }),
  string: (value: string): TestNbtTag => ({ type: 8, value }),
  list: (itemType: number, items: readonly TestNbtTag[]): TestNbtTag => ({ type: 9, value: { itemType, items } satisfies TestNbtList }),
  compound: (value: Readonly<Record<string, TestNbtTag>>): TestNbtTag => ({ type: 10, value }),
} as const;

export function writeJavaNbt(root: TestNbtTag, name = ""): Uint8Array {
  if (root.type !== 10) throw new Error("Test NBT root must be a compound");
  const writer = new TestNbtWriter();
  writer.uint8(root.type);
  writer.string(name);
  writer.payload(root);
  return writer.finish();
}

class TestNbtWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;
  private readonly encoder = new TextEncoder();

  payload(tag: TestNbtTag): void {
    switch (tag.type) {
      case 3:
        this.int32(number(tag.value));
        return;
      case 8:
        this.string(string(tag.value));
        return;
      case 9:
        this.list(tag.value);
        return;
      case 10:
        this.compound(tag.value);
        return;
      case 12:
        this.longArray(tag.value);
        return;
      default:
        throw new Error(`Unsupported test NBT tag ${tag.type}`);
    }
  }

  uint8(value: number): void {
    this.append(Uint8Array.of(value));
  }

  string(value: string): void {
    const encoded = this.encoder.encode(value);
    if (encoded.byteLength > 65_535) throw new Error("Test NBT string is too long");
    const header = new Uint8Array(2);
    new DataView(header.buffer).setUint16(0, encoded.byteLength, false);
    this.append(header);
    this.append(encoded);
  }

  private int32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, false);
    this.append(bytes);
  }

  private bigint64(value: bigint): void {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigInt64(0, BigInt.asIntN(64, value), false);
    this.append(bytes);
  }

  private compound(raw: unknown): void {
    if (!isRecord(raw)) throw new Error("Test compound payload is invalid");
    for (const [name, value] of Object.entries(raw)) {
      if (!isTag(value)) throw new Error(`Test compound tag ${name} is invalid`);
      this.uint8(value.type);
      this.string(name);
      this.payload(value);
    }
    this.uint8(0);
  }

  private list(raw: unknown): void {
    if (!isRecord(raw) || typeof raw.itemType !== "number" || !Array.isArray(raw.items)) throw new Error("Test list payload is invalid");
    this.uint8(raw.itemType);
    this.int32(raw.items.length);
    for (const item of raw.items) {
      if (!isTag(item) || item.type !== raw.itemType) throw new Error("Test list item type mismatch");
      this.payload(item);
    }
  }

  private longArray(raw: unknown): void {
    if (!Array.isArray(raw) || raw.some((value) => typeof value !== "bigint")) throw new Error("Test long array payload is invalid");
    this.int32(raw.length);
    for (const value of raw) this.bigint64(value as bigint);
  }

  private append(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
  }

  finish(): Uint8Array {
    const output = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error("Test NBT int is invalid");
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Test NBT string is invalid");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTag(value: unknown): value is TestNbtTag {
  return isRecord(value) && typeof value.type === "number" && "value" in value;
}
