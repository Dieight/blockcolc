import {
  inspectPngDimensions,
  type ResourcePackColormap,
  type ResourcePackManifest,
} from "@tomato-clock/resource-pack";

const DB_VERSION = 1;
const PACK_STORE = "resourcePacks";
const METADATA_STORE = "metadata";
const ACTIVE_KEY = "active-pack";

export interface StoredResourcePack {
  schemaVersion: 1;
  id: string;
  name: string;
  importedAt: string;
  archive: Uint8Array;
  manifest: StoredResourcePackManifest;
}

export type StoredResourcePackColormap = ResourcePackColormap;

/** Storage-facing structural contract. Optional additions remain schema-v1 compatible
 * while the parser and renderer adopt them independently. */
export type StoredResourcePackManifest = ResourcePackManifest;

export interface SaveResourcePackInput {
  id: string;
  name: string;
  importedAt: string;
  archive: Uint8Array;
  manifest: StoredResourcePackManifest;
}

export interface ResourcePackListItem {
  id: string;
  name: string;
  importedAt: string;
  archiveBytes: number;
  packFormat: number;
  textureCount: number;
  namespaces: string[];
  active: boolean;
}

export interface ResourcePackRepository {
  save(input: SaveResourcePackInput): Promise<ResourcePackListItem>;
  list(): Promise<ResourcePackListItem[]>;
  get(id: string): Promise<StoredResourcePack | undefined>;
  select(id: string | null): Promise<StoredResourcePack | undefined>;
  getActive(): Promise<StoredResourcePack | undefined>;
  delete(id: string): Promise<string | null>;
  clear(): Promise<void>;
  close(): void;
}

export interface IndexedDbResourcePackRepositoryOptions {
  databaseName?: string;
  indexedDb?: IDBFactory;
}

interface ActivePackRecord {
  key: typeof ACTIVE_KEY;
  packId: string | null;
}

export class IndexedDbResourcePackRepository implements ResourcePackRepository {
  private readonly databaseName: string;
  private readonly indexedDb: IDBFactory;
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbResourcePackRepositoryOptions = {}) {
    this.databaseName = options.databaseName ?? "tomato-clock-resource-packs";
    this.indexedDb = options.indexedDb ?? globalThis.indexedDB;
    if (!this.indexedDb) throw new Error("IndexedDB is unavailable.");
  }

  async save(input: SaveResourcePackInput): Promise<ResourcePackListItem> {
    const record = parseStoredResourcePack({ ...input, schemaVersion: 1 });
    const db = await this.database();
    const transaction = db.transaction([PACK_STORE, METADATA_STORE], "readwrite");
    const done = transactionDone(transaction);
    try {
      const packStore = transaction.objectStore(PACK_STORE);
      const metadataStore = transaction.objectStore(METADATA_STORE);
      packStore.put(record);
      const current = await requestResult<unknown>(metadataStore.get(ACTIVE_KEY));
      const activeId = parseActiveId(current);
      const activeRecord = activeId === null
        ? undefined
        : parseStoredResourcePackOrUndefined(await requestResult<unknown>(packStore.get(activeId)));
      const selectedId = !isActiveRecord(current)
        ? record.id
        : current.packId === null
          ? null
          : (activeRecord?.id ?? null);
      if (selectedId !== activeId || !isActiveRecord(current)) {
        metadataStore.put({ key: ACTIVE_KEY, packId: selectedId } satisfies ActivePackRecord);
      }
      await done;
      return toListItem(record, selectedId);
    } catch (error) {
      abort(transaction, done);
      throw error;
    }
  }

  async list(): Promise<ResourcePackListItem[]> {
    const { records, activeId } = await this.readAndRepairActive();
    return records.map((record) => toListItem(record, activeId));
  }

  async get(id: string): Promise<StoredResourcePack | undefined> {
    assertId(id);
    const db = await this.database();
    const transaction = db.transaction(PACK_STORE, "readonly");
    const done = transactionDone(transaction);
    const raw = await requestResult<unknown>(transaction.objectStore(PACK_STORE).get(id));
    await done;
    return parseStoredResourcePackOrUndefined(raw);
  }

  async select(id: string | null): Promise<StoredResourcePack | undefined> {
    if (id !== null) assertId(id);
    const db = await this.database();
    const transaction = db.transaction([PACK_STORE, METADATA_STORE], "readwrite");
    const done = transactionDone(transaction);
    try {
      let selected: StoredResourcePack | undefined;
      if (id !== null) {
        selected = parseStoredResourcePackOrUndefined(
          await requestResult<unknown>(transaction.objectStore(PACK_STORE).get(id)),
        );
        if (!selected) throw new Error(`Resource pack ${id} was not found or is invalid.`);
      }
      transaction.objectStore(METADATA_STORE).put({ key: ACTIVE_KEY, packId: id } satisfies ActivePackRecord);
      await done;
      return selected;
    } catch (error) {
      abort(transaction, done);
      throw error;
    }
  }

  async getActive(): Promise<StoredResourcePack | undefined> {
    const { records, activeId } = await this.readAndRepairActive();
    return activeId === null ? undefined : records.find((record) => record.id === activeId);
  }

  async delete(id: string): Promise<string | null> {
    assertId(id);
    const db = await this.database();
    const transaction = db.transaction([PACK_STORE, METADATA_STORE], "readwrite");
    const done = transactionDone(transaction);
    try {
      const packStore = transaction.objectStore(PACK_STORE);
      packStore.delete(id);
      const rawRecords = await requestResult<unknown[]>(packStore.getAll());
      const records = validRecords(rawRecords);
      const current = await requestResult<unknown>(transaction.objectStore(METADATA_STORE).get(ACTIVE_KEY));
      const currentId = parseActiveId(current);
      const nextId = currentId !== id && records.some((record) => record.id === currentId)
        ? currentId
        : null;
      transaction.objectStore(METADATA_STORE).put({ key: ACTIVE_KEY, packId: nextId } satisfies ActivePackRecord);
      await done;
      return nextId;
    } catch (error) {
      abort(transaction, done);
      throw error;
    }
  }

  async clear(): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction([PACK_STORE, METADATA_STORE], "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(PACK_STORE).clear();
    transaction.objectStore(METADATA_STORE).clear();
    await done;
  }

  close(): void {
    if (this.databasePromise) void this.databasePromise.then((database) => database.close());
    this.databasePromise = undefined;
  }

  private async readAndRepairActive(): Promise<{ records: StoredResourcePack[]; activeId: string | null }> {
    const db = await this.database();
    const transaction = db.transaction([PACK_STORE, METADATA_STORE], "readwrite");
    const done = transactionDone(transaction);
    try {
      const rawRecords = await requestResult<unknown[]>(transaction.objectStore(PACK_STORE).getAll());
      const records = validRecords(rawRecords);
      const rawActive = await requestResult<unknown>(transaction.objectStore(METADATA_STORE).get(ACTIVE_KEY));
      const requestedId = parseActiveId(rawActive);
      const activeId = records.some((record) => record.id === requestedId) ? requestedId : null;
      if (requestedId !== activeId || !isActiveRecord(rawActive)) {
        transaction.objectStore(METADATA_STORE).put({ key: ACTIVE_KEY, packId: activeId } satisfies ActivePackRecord);
      }
      await done;
      return { records, activeId };
    } catch (error) {
      abort(transaction, done);
      throw error;
    }
  }

  private database(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      let pending!: Promise<IDBDatabase>;
      pending = openDatabase(this.indexedDb, this.databaseName, () => {
        if (this.databasePromise === pending) this.databasePromise = undefined;
      });
      this.databasePromise = pending;
    }
    return this.databasePromise;
  }
}

function validRecords(values: unknown[]): StoredResourcePack[] {
  return values
    .map(parseStoredResourcePackOrUndefined)
    .filter((record): record is StoredResourcePack => record !== undefined)
    .sort((left, right) => right.importedAt.localeCompare(left.importedAt) || left.id.localeCompare(right.id));
}

function parseStoredResourcePackOrUndefined(value: unknown): StoredResourcePack | undefined {
  try {
    return parseStoredResourcePack(value);
  } catch {
    return undefined;
  }
}

function parseStoredResourcePack(value: unknown): StoredResourcePack {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error("Unsupported resource-pack record version.");
  assertId(value.id);
  if (typeof value.name !== "string" || value.name.trim() === "" || value.name.length > 160) {
    throw new Error("Resource-pack name must contain 1-160 characters.");
  }
  if (!validInstant(value.importedAt)) throw new Error("Resource-pack importedAt must be an ISO instant.");
  if (!(value.archive instanceof Uint8Array) || value.archive.byteLength === 0) {
    throw new Error("Resource-pack archive must be a non-empty Uint8Array.");
  }
  const manifest = parseManifest(value.manifest);
  return structuredClone({
    schemaVersion: 1,
    id: value.id,
    name: value.name.trim(),
    importedAt: value.importedAt,
    archive: value.archive,
    manifest,
  });
}

function parseManifest(value: unknown): StoredResourcePackManifest {
  if (
    !isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.pack) ||
    !Array.isArray(value.textures) || !Array.isArray(value.blockStates) || !Array.isArray(value.models)
  ) {
    throw new Error("Invalid normalized resource-pack manifest.");
  }
  if (!Number.isSafeInteger(value.pack.packFormat) || (value.pack.packFormat as number) <= 0) {
    throw new Error("Invalid manifest pack format.");
  }
  if (
    !isRecord(value.summary) || !Array.isArray(value.summary.namespaces) ||
    value.summary.namespaces.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("Invalid manifest compatibility summary.");
  }
  for (const texture of value.textures) {
    if (
      !isRecord(texture) ||
      typeof texture.resourceId !== "string" ||
      typeof texture.namespace !== "string" ||
      typeof texture.texturePath !== "string" ||
      typeof texture.archivePath !== "string" ||
      !Number.isSafeInteger(texture.width) ||
      (texture.width as number) < 16 ||
      (texture.width as number) > 8192 ||
      !Number.isSafeInteger(texture.height) ||
      (texture.height as number) < 16 ||
      (texture.height as number) > 8192 ||
      !(texture.png instanceof Uint8Array)
    ) {
      throw new Error("Invalid texture in normalized resource-pack manifest.");
    }
    validateTextureAnimation(texture.animation, texture.width as number, texture.height as number);
  }
  validateColormaps(value.colormaps);
  for (const blockState of value.blockStates) validateBlockState(blockState);
  for (const model of value.models) validateBlockModel(model);
  return structuredClone(value) as unknown as StoredResourcePackManifest;
}

const colormapContracts = Object.freeze({
  grass: Object.freeze({
    resourceId: "minecraft:colormap/grass",
    archivePath: "assets/minecraft/textures/colormap/grass.png",
  }),
  foliage: Object.freeze({
    resourceId: "minecraft:colormap/foliage",
    archivePath: "assets/minecraft/textures/colormap/foliage.png",
  }),
} as const);
const MAX_COLORMAP_PNG_BYTES = 4 * 1024 * 1024;

function validateColormaps(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw new Error("Invalid normalized resource-pack colormaps.");
  }
  const kinds = new Set<string>();
  for (const colormap of value) {
    if (!isRecord(colormap) || (colormap.kind !== "grass" && colormap.kind !== "foliage")) {
      throw new Error("Invalid normalized resource-pack colormap.");
    }
    if (kinds.has(colormap.kind)) throw new Error("Duplicate normalized resource-pack colormap.");
    kinds.add(colormap.kind);
    const contract = colormapContracts[colormap.kind];
    const png = colormap.png;
    if (
      colormap.resourceId !== contract.resourceId || colormap.archivePath !== contract.archivePath ||
      colormap.width !== 256 || colormap.height !== 256 || !(png instanceof Uint8Array) ||
      png.byteLength > MAX_COLORMAP_PNG_BYTES
    ) {
      throw new Error("Invalid normalized resource-pack colormap payload.");
    }
    const dimensions = inspectPngDimensions(png);
    if (dimensions?.width !== 256 || dimensions.height !== 256) {
      throw new Error("Invalid normalized resource-pack colormap PNG.");
    }
  }
}

function validateBlockState(value: unknown): void {
  if (!isRecord(value) || !safeText(value.resourceId) || !safeText(value.archivePath) || !Array.isArray(value.variants)) {
    throw new Error("Invalid blockstate in normalized resource-pack manifest.");
  }
  const hasMultipart = value.multipart !== undefined;
  if ((hasMultipart && value.variants.length !== 0) || (!hasMultipart && (value.variants.length < 1 || value.variants.length > 512))) {
    throw new Error("Invalid blockstate variants/multipart contract.");
  }
  for (const variant of value.variants) {
    if (
      !isRecord(variant) || typeof variant.key !== "string" || !stringRecord(variant.conditions) ||
      Object.keys(variant.conditions).length > 32 || !Array.isArray(variant.choices) ||
      variant.choices.length < 1 || variant.choices.length > 64
    ) {
      throw new Error("Invalid blockstate variant in normalized resource-pack manifest.");
    }
    for (const choice of variant.choices) validateModelChoice(choice);
  }
  if (hasMultipart) validateMultipart(value.multipart);
}

function validateMultipart(value: unknown): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new Error("Invalid multipart blockstate definition.");
  }
  let modelReferenceCount = 0;
  for (const part of value) {
    if (!isRecord(part) || !isRecord(part.when) || !Array.isArray(part.when.clauses) || !Array.isArray(part.apply)) {
      throw new Error("Invalid multipart blockstate part.");
    }
    const clauses = part.when.clauses;
    if (clauses.length < 1 || clauses.length > 16) throw new Error("Invalid multipart condition clauses.");
    for (const clause of clauses) validateMultipartClause(clause, clauses.length === 1);
    if (part.apply.length < 1 || part.apply.length > 8) throw new Error("Multipart apply must contain 1-8 models.");
    for (const choice of part.apply) validateModelChoice(choice);
    modelReferenceCount += part.apply.length;
    if (modelReferenceCount > 512) throw new Error("Multipart has too many model references.");
  }
}

function validateMultipartClause(value: unknown, allowUnconditional: boolean): void {
  if (!isRecord(value)) throw new Error("Invalid multipart condition clause.");
  const entries = Object.entries(value);
  if (entries.length === 0) {
    if (allowUnconditional) return;
    throw new Error("Invalid empty multipart condition clause.");
  }
  if (entries.length > 16) throw new Error("Multipart condition has too many properties.");
  for (const [property, alternatives] of entries) {
    if (!safeStateName(property) || !Array.isArray(alternatives) || alternatives.length < 1 || alternatives.length > 16) {
      throw new Error("Invalid multipart condition property.");
    }
    if (alternatives.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > 128)) {
      throw new Error("Invalid multipart condition alternatives.");
    }
  }
}

function validateModelChoice(value: unknown): void {
  if (
    !isRecord(value) || !normalizedResourceLocation(value.model) || ![0, 90, 180, 270].includes(value.x as number) ||
    ![0, 90, 180, 270].includes(value.y as number) || typeof value.uvlock !== "boolean" ||
    !Number.isSafeInteger(value.weight) || (value.weight as number) <= 0
  ) {
    throw new Error("Invalid model choice in normalized resource-pack manifest.");
  }
}

function validateBlockModel(value: unknown): void {
  if (!isRecord(value) || !safeText(value.resourceId) || !safeText(value.archivePath) || !stringRecord(value.textures)) {
    throw new Error("Invalid block model in normalized resource-pack manifest.");
  }
  if (value.parent !== undefined && !safeText(value.parent)) throw new Error("Invalid block model parent.");
  if (value.forceTranslucentTextures !== undefined) {
    if (!isRecord(value.forceTranslucentTextures)
      || Object.keys(value.forceTranslucentTextures).length > 128
      || Object.entries(value.forceTranslucentTextures).some(([key, forced]) => !safeStateName(key) || forced !== true)) {
      throw new Error("Invalid block model translucent texture metadata.");
    }
  }
  if (value.unsupportedReason !== undefined && value.unsupportedReason !== "COMPLEX_GEOMETRY") {
    throw new Error("Invalid block model compatibility reason.");
  }
  if (value.faces !== undefined) {
    if (!isRecord(value.faces)) throw new Error("Invalid block model faces.");
    const allowedFaces = new Set(["down", "up", "north", "south", "west", "east"]);
    for (const [face, texture] of Object.entries(value.faces)) {
      if (!allowedFaces.has(face) || !safeText(texture)) throw new Error("Invalid block model face texture.");
    }
  }
  if (value.faceMetadata !== undefined) {
    if (!isRecord(value.faceMetadata)) throw new Error("Invalid block model face metadata.");
    for (const [face, metadata] of Object.entries(value.faceMetadata)) {
      validateModelFace(face, metadata);
    }
  }
  if (value.elements !== undefined) {
    if (value.unsupportedReason !== undefined) throw new Error("Unsupported block models cannot contain normalized elements.");
    if (!Array.isArray(value.elements) || value.elements.length < 1 || value.elements.length > 64) {
      throw new Error("Invalid block model elements.");
    }
    for (const element of value.elements) {
      if (!isRecord(element) || typeof element.shade !== "boolean") {
        throw new Error("Invalid block model element.");
      }
      const from = validateElementVector(element.from);
      const to = validateElementVector(element.to);
      if (from.some((coordinate, axis) => coordinate > to[axis]!)) {
        throw new Error("Invalid block model element bounds.");
      }
      const zeroAxes = from.flatMap((coordinate, axis) => coordinate === to[axis] ? [axis] : []);
      if (zeroAxes.length > 1) throw new Error("Invalid block model element bounds.");
      if (element.rotation !== undefined) validateElementRotation(element.rotation);
      if (!isRecord(element.faces)) throw new Error("Invalid block model element faces.");
      const entries = Object.entries(element.faces);
      if (entries.length < 1 || entries.length > 6) throw new Error("Invalid block model element faces.");
      for (const [face, metadata] of entries) {
        validateModelFace(face, metadata);
        if (zeroAxes.length === 1 && element.rotation === undefined && !facesPerpendicularToAxis[zeroAxes[0]!]!.has(face)) {
          throw new Error("Invalid block model plane face.");
        }
      }
    }
  }
}

const allowedModelFaces = new Set(["down", "up", "north", "south", "west", "east"]);
const facesPerpendicularToAxis: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["west", "east"]),
  new Set(["down", "up"]),
  new Set(["north", "south"]),
];
const safeStateNamePattern = /^[a-z0-9_.-]+$/;
const resourceLocationPattern = /^[a-z0-9_.-]+:[a-z0-9._/-]+$/;
const unsafeStateNames = new Set(["__proto__", "prototype", "constructor"]);

function validateElementVector(value: unknown): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((coordinate) => (
    typeof coordinate !== "number" || !Number.isFinite(coordinate) || coordinate < -16 || coordinate > 32
  ))) {
    throw new Error("Invalid block model element vector.");
  }
  return value as [number, number, number];
}

function validateElementRotation(value: unknown): void {
  if (!isRecord(value) || !Array.isArray(value.origin) || value.origin.length !== 3
    || value.origin.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate)
      || coordinate < -16 || coordinate > 32)
    || typeof value.rescale !== "boolean") {
    throw new Error("Invalid block model element rotation.");
  }
  if (value.euler !== undefined) {
    if (value.rescale || value.axis !== undefined || value.angle !== undefined
      || !Array.isArray(value.euler) || value.euler.length !== 3
      || value.euler.some((angle) => typeof angle !== "number" || !Number.isFinite(angle) || angle < -180 || angle > 180)) {
      throw new Error("Invalid block model Euler rotation.");
    }
    return;
  }
  if ((value.axis !== "x" && value.axis !== "y" && value.axis !== "z")
    || typeof value.angle !== "number" || !Number.isFinite(value.angle) || value.angle < -90 || value.angle > 90
    || (value.rescale && Math.abs(value.angle) > 45)) {
    throw new Error("Invalid block model axis rotation.");
  }
}

function validateModelFace(face: string, value: unknown): void {
  if (!allowedModelFaces.has(face) || !isRecord(value) || !safeText(value.texture)) {
    throw new Error("Invalid block model face metadata.");
  }
  if (!Array.isArray(value.uv) || value.uv.length !== 4 || value.uv.some((coordinate) => (
    typeof coordinate !== "number" || !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 16
  ))) {
    throw new Error("Invalid block model face UV.");
  }
  if (![0, 90, 180, 270].includes(value.rotation as number)) {
    throw new Error("Invalid block model face rotation.");
  }
  if (value.tintIndex !== undefined && (
    !Number.isSafeInteger(value.tintIndex) || (value.tintIndex as number) < 0 || (value.tintIndex as number) > 255
  )) {
    throw new Error("Invalid block model face tint index.");
  }
  if (value.cullFace !== undefined && !allowedModelFaces.has(value.cullFace as string)) {
    throw new Error("Invalid block model face cull direction.");
  }
}

function validateTextureAnimation(value: unknown, textureWidth: number, textureHeight: number): void {
  if (value === undefined) {
    if (textureWidth !== 16 || textureHeight !== 16) throw new Error("Non-16x16 texture is missing normalized animation metadata.");
    return;
  }
  const frameWidth = isRecord(value) ? value.frameWidth : undefined;
  const frameHeight = isRecord(value) ? value.frameHeight : undefined;
  const sourceColumns = isRecord(value) ? (value.sourceColumns ?? textureWidth / (frameWidth as number)) : undefined;
  const sourceRows = isRecord(value) ? (value.sourceRows ?? textureHeight / (frameHeight as number)) : undefined;
  if (
    !isRecord(value) || (frameWidth !== 16 && frameWidth !== 32) || frameHeight !== frameWidth ||
    !Number.isSafeInteger(sourceColumns) || (sourceColumns as number) < 1 ||
    !Number.isSafeInteger(sourceRows) || (sourceRows as number) < 1 ||
    (sourceColumns as number) * (frameWidth as number) !== textureWidth ||
    (sourceRows as number) * (frameHeight as number) !== textureHeight ||
    !Number.isSafeInteger(value.sourceFrameCount) || value.sourceFrameCount !== (sourceColumns as number) * (sourceRows as number) ||
    (value.sourceFrameCount as number) > 256 ||
    !Number.isSafeInteger(value.frametime) || (value.frametime as number) < 1 || (value.frametime as number) > 1_000_000 ||
    typeof value.interpolate !== "boolean" || !Array.isArray(value.frames) ||
    value.frames.length < 1 || value.frames.length > 4096
  ) {
    throw new Error("Invalid normalized texture animation.");
  }
  for (const frame of value.frames) {
    if (
      !isRecord(frame) || !Number.isSafeInteger(frame.index) || (frame.index as number) < 0 ||
      (frame.index as number) >= (value.sourceFrameCount as number) ||
      !Number.isSafeInteger(frame.time) || (frame.time as number) < 1 || (frame.time as number) > 1_000_000
    ) {
      throw new Error("Invalid normalized texture animation frame.");
    }
  }
}

function stringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.entries(value).every(([key, entry]) => safeText(key) && typeof entry === "string");
}

function safeText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function safeStateName(value: string): boolean {
  return value.length <= 64 && safeStateNamePattern.test(value) && !unsafeStateNames.has(value);
}

function normalizedResourceLocation(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512 && resourceLocationPattern.test(value);
}

function toListItem(record: StoredResourcePack, activeId: string | null): ResourcePackListItem {
  return {
    id: record.id,
    name: record.name,
    importedAt: record.importedAt,
    archiveBytes: record.archive.byteLength,
    packFormat: record.manifest.pack.packFormat,
    textureCount: record.manifest.textures.length,
    namespaces: [...record.manifest.summary.namespaces],
    active: record.id === activeId,
  };
}

function assertId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new Error("Resource-pack ID must contain 1-128 safe identifier characters.");
  }
}

function validInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function parseActiveId(value: unknown): string | null {
  return isActiveRecord(value) ? value.packId : null;
}

function isActiveRecord(value: unknown): value is ActivePackRecord {
  return (
    isRecord(value) &&
    value.key === ACTIVE_KEY &&
    (value.packId === null || (typeof value.packId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value.packId)))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openDatabase(indexedDb: IDBFactory, name: string, onVersionChange: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDb.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PACK_STORE)) database.createObjectStore(PACK_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(METADATA_STORE)) database.createObjectStore(METADATA_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      database.onversionchange = () => {
        database.close();
        onVersionChange();
      };
      resolve(database);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("Unable to open resource-pack IndexedDB."));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Resource-pack IndexedDB upgrade was blocked."));
    };
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function abort(transaction: IDBTransaction, done: Promise<void>): void {
  try {
    transaction.abort();
  } catch {
    // The transaction may already be inactive after a request failure.
  }
  void done.catch(() => undefined);
}
