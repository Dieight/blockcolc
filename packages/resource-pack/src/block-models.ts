export type BlockFace = "down" | "up" | "north" | "south" | "west" | "east";
export type FaceRotation = 0 | 90 | 180 | 270;
export type FaceUv = readonly [number, number, number, number];
export type BlockElementVector = readonly [number, number, number];

interface BlockElementRotationBase {
  origin: BlockElementVector;
  rescale: boolean;
}

export interface BlockElementAxisRotation extends BlockElementRotationBase {
  axis: "x" | "y" | "z";
  angle: number;
  euler?: never;
}

export interface BlockElementEulerRotation extends BlockElementRotationBase {
  euler: BlockElementVector;
  axis?: never;
  angle?: never;
}

export type BlockElementRotation = BlockElementAxisRotation | BlockElementEulerRotation;

export interface NormalizedModelFace {
  texture: string;
  uv: FaceUv;
  rotation: FaceRotation;
  /** Resource-pack tint slot only; the application supplies its own colour palette. */
  tintIndex?: number;
  cullFace?: BlockFace;
}

export interface ResolvedBlockFace {
  texture: string;
  uv: FaceUv;
  rotation: FaceRotation;
  tintIndex?: number;
  cullFace?: BlockFace;
  forceTranslucent?: boolean;
}

export interface NormalizedBlockElement {
  from: BlockElementVector;
  to: BlockElementVector;
  shade: boolean;
  faces: Partial<Record<BlockFace, NormalizedModelFace>>;
  rotation?: BlockElementRotation;
}

export interface ResolvedBlockElement {
  from: BlockElementVector;
  to: BlockElementVector;
  shade: boolean;
  faces: Partial<Record<BlockFace, ResolvedBlockFace>>;
  /** Element-local rotation is retained for the geometry compiler. */
  rotation?: BlockElementRotation;
  /** Blockstate rotation applied after an element-local rotation. */
  blockRotation?: { x: FaceRotation; y: FaceRotation };
}

export interface ResolvedBlockGeometry {
  status: "resolved_geometry";
  modelId: string;
  elements: ResolvedBlockElement[];
}

export type BlockModelIssueCode =
  | "INVALID_BLOCKSTATE_JSON"
  | "UNSUPPORTED_MULTIPART"
  | "INVALID_MODEL_JSON"
  | "COMPLEX_MODEL_GEOMETRY";

export interface BlockModelIssue {
  path: string;
  code: BlockModelIssueCode;
  message: string;
}

export interface NormalizedModelReference {
  model: string;
  x: 0 | 90 | 180 | 270;
  y: 0 | 90 | 180 | 270;
  uvlock: boolean;
  weight: number;
}

export interface NormalizedBlockStateVariant {
  key: string;
  conditions: Record<string, string>;
  choices: NormalizedModelReference[];
}

export interface NormalizedMultipartCondition {
  /** Canonical DNF: any clause may match; every property within a clause must match. */
  clauses: Array<Record<string, readonly string[]>>;
}

export interface NormalizedMultipartPart {
  when: NormalizedMultipartCondition;
  apply: NormalizedModelReference[];
}

export interface NormalizedBlockState {
  resourceId: string;
  archivePath: string;
  variants: NormalizedBlockStateVariant[];
  multipart?: NormalizedMultipartPart[];
}

export interface NormalizedBlockModel {
  resourceId: string;
  archivePath: string;
  parent?: string;
  textures: Record<string, string>;
  /** Additive current-format metadata; absent on persisted schema-v1 manifests. */
  forceTranslucentTextures?: Record<string, true>;
  /** Kept for schema-v1 manifests and existing atlas consumers. */
  faces?: Partial<Record<BlockFace, string>>;
  /** Additive V3 metadata; absent schema-v1 entries resolve to full UV and rotation 0. */
  faceMetadata?: Partial<Record<BlockFace, NormalizedModelFace>>;
  /** Additive schema-v1 geometry. Child models with elements replace parent elements. */
  elements?: NormalizedBlockElement[];
  unsupportedReason?: "COMPLEX_GEOMETRY";
}

export interface ResolvedBlockTextures {
  status: "resolved";
  modelId: string;
  faces: Record<BlockFace, string>;
  /** Optional at the type boundary so persisted schema-v1 resolutions remain valid. */
  faceMetadata?: Record<BlockFace, ResolvedBlockFace>;
}

export type BlockTextureFallbackReason =
  | "UNKNOWN_BLOCKSTATE"
  | "NO_MATCHING_VARIANT"
  | "MISSING_MODEL"
  | "MODEL_REFERENCE_CYCLE"
  | "COMPLEX_GEOMETRY"
  | "MISSING_FACE"
  | "MISSING_TEXTURE_VARIABLE"
  | "MISSING_TEXTURE"
  | "TEXTURE_REFERENCE_CYCLE"
  | "GEOMETRY_LIMIT_EXCEEDED"
  | "UNSUPPORTED_MULTIPART"
  | "INVALID_MULTIPART";

export interface BlockTextureFallback {
  status: "fallback";
  reason: BlockTextureFallbackReason;
  resourceId?: string;
}

export interface ParsedBlockAssets {
  blockStates: NormalizedBlockState[];
  models: NormalizedBlockModel[];
  issues: BlockModelIssue[];
  recognizedPaths: Set<string>;
}

export interface BlockTextureManifest {
  blockStates: readonly NormalizedBlockState[];
  models: readonly NormalizedBlockModel[];
  textures: ReadonlyArray<{ resourceId: string }>;
}

const blockStatePattern = /^assets\/([^/]+)\/blockstates\/(.+)\.json$/;
const blockModelPattern = /^assets\/([^/]+)\/models\/block\/(.+)\.json$/;
const namespacePattern = /^[a-z0-9_.-]+$/;
const resourcePathPattern = /^[a-z0-9._/-]+$/;
const stateKeyPattern = /^[a-z0-9_.-]+$/;
const unsafeNames = new Set(["__proto__", "prototype", "constructor"]);
const faces: readonly BlockFace[] = ["down", "up", "north", "south", "west", "east"];
const MAX_VARIANTS = 512;
const MAX_CONDITIONS = 32;
const MAX_MODEL_TEXTURES = 128;
const MAX_MODEL_DEPTH = 32;
const MAX_TEXTURE_DEPTH = 32;
const MAX_ELEMENTS_PER_MODEL = 64;
const MAX_RESOLVED_ELEMENTS = 128;
const MAX_RESOLVED_QUADS = 768;
const MAX_MULTIPART_PARTS = 64;
const MAX_MULTIPART_CLAUSES = 16;
const MAX_MULTIPART_PROPERTIES = 16;
const MAX_MULTIPART_VALUES = 16;
const MAX_MULTIPART_APPLY_CHOICES = 8;
const MAX_MULTIPART_MODEL_REFERENCES = 512;
const MAX_MULTIPART_CONDITION_DEPTH = 8;
const MIN_ELEMENT_COORDINATE = -16;
const MAX_ELEMENT_COORDINATE = 32;
const FULL_FACE_UV: FaceUv = Object.freeze([0, 0, 16, 16]);
const FULL_CUBE_FROM: BlockElementVector = Object.freeze([0, 0, 0]);
const FULL_CUBE_TO: BlockElementVector = Object.freeze([16, 16, 16]);

export function isP2BlockGeometry(sourceBlockId: string): boolean {
  if (!sourceBlockId.startsWith("minecraft:")) return false;
  const path = sourceBlockId.slice("minecraft:".length);
  return path.endsWith("_wall")
    || path.endsWith("_fence")
    || path.endsWith("_pane")
    || path === "iron_bars";
}

export function isP1BlockGeometry(
  sourceBlockId: string,
  sourceBlockState: Readonly<Record<string, string>> = {},
): boolean {
  if (!sourceBlockId.startsWith("minecraft:")) return false;
  const path = sourceBlockId.slice("minecraft:".length);
  if (path.endsWith("_slab")) return true;
  if (path.endsWith("_stairs")) return sourceBlockState.shape === "straight";
  if (path.endsWith("_trapdoor")) return true;
  return path.endsWith("_door");
}

export function isSupportedBlockGeometry(
  sourceBlockId: string,
  sourceBlockState: Readonly<Record<string, string>> = {},
): boolean {
  return isP1BlockGeometry(sourceBlockId, sourceBlockState) || isP2BlockGeometry(sourceBlockId);
}

export function parseBlockAssets(
  files: Readonly<Record<string, Uint8Array>>,
  paths: readonly string[],
  decodeJson: (bytes: Uint8Array, path: string) => Record<string, unknown>,
): ParsedBlockAssets {
  const blockStates: NormalizedBlockState[] = [];
  const models: NormalizedBlockModel[] = [];
  const issues: BlockModelIssue[] = [];
  const recognizedPaths = new Set<string>();

  for (const archivePath of [...paths].sort(compareText)) {
    const blockStateMatch = blockStatePattern.exec(archivePath);
    const modelMatch = blockModelPattern.exec(archivePath);
    if (!blockStateMatch && !modelMatch) continue;
    recognizedPaths.add(archivePath);
    const namespace = blockStateMatch?.[1] ?? modelMatch?.[1] ?? "";
    const path = blockStateMatch?.[2] ?? modelMatch?.[2] ?? "";
    if (!validResourceIdParts(namespace, path)) {
      issues.push({ path: archivePath, code: blockStateMatch ? "INVALID_BLOCKSTATE_JSON" : "INVALID_MODEL_JSON", message: "Invalid namespace or resource path." });
      continue;
    }
    const bytes = files[archivePath];
    if (!bytes) continue;
    try {
      const json = decodeJson(bytes, archivePath);
      if (blockStateMatch) {
        const parsed = parseBlockState(json, `${namespace}:${path}`, archivePath);
        if (parsed.issue) issues.push(parsed.issue);
        else if (parsed.value) blockStates.push(parsed.value);
      } else {
        const parsed = parseModel(json, `${namespace}:block/${path}`, archivePath);
        models.push(parsed.value);
        if (parsed.issue) issues.push(parsed.issue);
      }
    } catch (cause) {
      issues.push({
        path: archivePath,
        code: blockStateMatch ? "INVALID_BLOCKSTATE_JSON" : "INVALID_MODEL_JSON",
        message: errorMessage(cause),
      });
    }
  }
  blockStates.sort((left, right) => compareText(left.resourceId, right.resourceId));
  models.sort((left, right) => compareText(left.resourceId, right.resourceId));
  issues.sort((left, right) => compareText(left.path, right.path) || compareText(left.code, right.code));
  return { blockStates, models, issues, recognizedPaths };
}

export function resolveBlockTextures(
  manifest: BlockTextureManifest,
  sourceBlockId: string,
  sourceBlockState: Readonly<Record<string, string>> = {},
): ResolvedBlockTextures | BlockTextureFallback {
  const blockState = manifest.blockStates.find((entry) => entry.resourceId === sourceBlockId);
  if (!blockState) return { status: "fallback", reason: "UNKNOWN_BLOCKSTATE", resourceId: sourceBlockId };
  const variant = chooseVariant(blockState.variants, sourceBlockState);
  if (!variant) return { status: "fallback", reason: "NO_MATCHING_VARIANT", resourceId: sourceBlockId };
  const choice = chooseModelReference(sourceBlockId, sourceBlockState, variant.choices);
  if (!choice) return { status: "fallback", reason: "NO_MATCHING_VARIANT", resourceId: sourceBlockId };

  const modelMap = new Map(manifest.models.map((model) => [model.resourceId, model]));
  const textureIds = new Set(manifest.textures.map((texture) => texture.resourceId));
  const resolved = resolveModel(choice.model, modelMap, [], 0);
  if ("reason" in resolved) return resolved;
  if (resolved.elements !== undefined && faces.some((face) => resolved.faces[face] === undefined)) {
    return { status: "fallback", reason: "COMPLEX_GEOMETRY", resourceId: choice.model };
  }
  const output = {} as Record<BlockFace, string>;
  const outputMetadata = {} as Record<BlockFace, ResolvedBlockFace>;
  for (const face of faces) {
    const texture = resolved.faces[face];
    if (!texture) return { status: "fallback", reason: "MISSING_FACE", resourceId: choice.model };
    const textureId = resolveTextureReference(texture, resolved.textures, resolved.forceTranslucentTextures, [], 0);
    if ("reason" in textureId) return { ...textureId, resourceId: choice.model };
    if (!textureIds.has(textureId.value)) return { status: "fallback", reason: "MISSING_TEXTURE", resourceId: textureId.value };
    const targetFace = rotateFace(face, choice.x, choice.y);
    const metadata = resolved.faceMetadata[face] ?? defaultFaceMetadata(texture);
    const resolvedFace = {
      texture: textureId.value,
      uv: metadata.uv,
      rotation: resolveFaceTextureRotation(face, choice.x, choice.y, choice.uvlock, metadata.rotation),
      ...(metadata.tintIndex === undefined ? {} : { tintIndex: metadata.tintIndex }),
      ...(textureId.forceTranslucent ? { forceTranslucent: true } : {}),
    };
    output[targetFace] = textureId.value;
    outputMetadata[targetFace] = resolvedFace;
  }
  return { status: "resolved", modelId: choice.model, faces: output, faceMetadata: outputMetadata };
}

export function resolveBlockGeometry(
  manifest: BlockTextureManifest,
  sourceBlockId: string,
  sourceBlockState: Readonly<Record<string, string>> = {},
): ResolvedBlockGeometry | BlockTextureFallback {
  const blockState = manifest.blockStates.find((entry) => entry.resourceId === sourceBlockId);
  if (!blockState) return { status: "fallback", reason: "UNKNOWN_BLOCKSTATE", resourceId: sourceBlockId };
  if (blockState.multipart !== undefined) {
    if (!validNormalizedMultipart(blockState.multipart)) {
      return { status: "fallback", reason: "INVALID_MULTIPART", resourceId: sourceBlockId };
    }
    const requiredProperties = multipartRequiredProperties(blockState.multipart);
    if ([...requiredProperties].some((property) => sourceBlockState[property] === undefined)) {
      return { status: "fallback", reason: "NO_MATCHING_VARIANT", resourceId: sourceBlockId };
    }
    const choices: NormalizedModelReference[] = [];
    for (let partIndex = 0; partIndex < blockState.multipart.length; partIndex += 1) {
      const part = blockState.multipart[partIndex]!;
      if (!multipartConditionMatches(part.when, sourceBlockState)) continue;
      const choice = chooseModelReference(`${sourceBlockId}#multipart-${partIndex}`, sourceBlockState, part.apply);
      if (!choice) return { status: "fallback", reason: "INVALID_MULTIPART", resourceId: sourceBlockId };
      choices.push(choice);
    }
    if (choices.length === 0) return { status: "fallback", reason: "NO_MATCHING_VARIANT", resourceId: sourceBlockId };
    return resolveGeometryChoices(manifest, choices, sourceBlockId);
  }
  const variant = chooseVariant(blockState.variants, sourceBlockState);
  if (!variant) return { status: "fallback", reason: "NO_MATCHING_VARIANT", resourceId: sourceBlockId };
  const choice = chooseModelReference(sourceBlockId, sourceBlockState, variant.choices);
  if (!choice) return { status: "fallback", reason: "NO_MATCHING_VARIANT", resourceId: sourceBlockId };

  return resolveGeometryChoices(manifest, [choice], choice.model);
}

function resolveGeometryChoices(
  manifest: BlockTextureManifest,
  choices: readonly NormalizedModelReference[],
  outputModelId: string,
): ResolvedBlockGeometry | BlockTextureFallback {
  const modelMap = new Map(manifest.models.map((model) => [model.resourceId, model]));
  const textureIds = new Set(manifest.textures.map((texture) => texture.resourceId));
  const output: ResolvedBlockElement[] = [];
  let quadCount = 0;
  for (const choice of choices) {
    const resolved = resolveModel(choice.model, modelMap, [], 0);
    if ("reason" in resolved) return resolved;
    const elements = resolved.elements ?? legacyFullCubeElements(resolved);
    if (!elements || output.length + elements.length > MAX_RESOLVED_ELEMENTS) {
      return { status: "fallback", reason: "GEOMETRY_LIMIT_EXCEEDED", resourceId: outputModelId };
    }
    for (const element of elements) {
      quadCount += Object.keys(element.faces).length;
      if (quadCount > MAX_RESOLVED_QUADS) {
        return { status: "fallback", reason: "GEOMETRY_LIMIT_EXCEEDED", resourceId: outputModelId };
      }
      const transformed = element.rotation === undefined ? rotateElementBounds(element.from, element.to, choice.x, choice.y) : undefined;
      const resolvedFaces: Partial<Record<BlockFace, ResolvedBlockFace>> = {};
      for (const [face, metadata] of Object.entries(element.faces) as Array<[BlockFace, NormalizedModelFace]>) {
        const textureId = resolveTextureReference(metadata.texture, resolved.textures, resolved.forceTranslucentTextures, [], 0);
        if ("reason" in textureId) return { ...textureId, resourceId: choice.model };
        if (!textureIds.has(textureId.value)) return { status: "fallback", reason: "MISSING_TEXTURE", resourceId: textureId.value };
        const targetFace = element.rotation === undefined ? rotateFace(face, choice.x, choice.y) : face;
        resolvedFaces[targetFace] = {
          texture: textureId.value,
          uv: metadata.uv,
          rotation: resolveFaceTextureRotation(face, choice.x, choice.y, choice.uvlock, metadata.rotation),
          ...(metadata.tintIndex === undefined ? {} : { tintIndex: metadata.tintIndex }),
          ...(textureId.forceTranslucent ? { forceTranslucent: true } : {}),
          ...(metadata.cullFace === undefined || element.rotation !== undefined ? {} : { cullFace: rotateFace(metadata.cullFace, choice.x, choice.y) }),
        };
      }
      output.push({
        from: transformed?.from ?? element.from,
        to: transformed?.to ?? element.to,
        shade: element.shade,
        faces: resolvedFaces,
        ...(element.rotation === undefined ? {} : {
          rotation: element.rotation,
          blockRotation: { x: choice.x, y: choice.y },
        }),
      });
    }
  }
  return { status: "resolved_geometry", modelId: outputModelId, elements: output };
}

function parseBlockState(raw: Record<string, unknown>, resourceId: string, archivePath: string): { value?: NormalizedBlockState; issue?: BlockModelIssue } {
  if ("multipart" in raw) {
    if ("variants" in raw) {
      return { issue: { path: archivePath, code: "UNSUPPORTED_MULTIPART", message: "A blockstate cannot mix variants and multipart." } };
    }
    const multipart = parseMultipart(raw.multipart);
    return { value: { resourceId, archivePath, variants: [], multipart } };
  }
  const variants = plainRecord(raw.variants, "variants");
  const entries = Object.entries(variants);
  if (entries.length === 0 || entries.length > MAX_VARIANTS) throw new Error(`variants must contain 1-${MAX_VARIANTS} entries.`);
  const normalized = entries.map(([key, value]) => ({ key: canonicalVariantKey(key), conditions: parseConditions(key), choices: parseModelChoices(value) }));
  normalized.sort((left, right) => compareText(left.key, right.key));
  return { value: { resourceId, archivePath, variants: normalized } };
}

function parseMultipart(raw: unknown): NormalizedMultipartPart[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MULTIPART_PARTS) {
    throw new Error(`multipart must contain 1-${MAX_MULTIPART_PARTS} parts.`);
  }
  let referenceCount = 0;
  return raw.map((part, index) => {
    const value = plainRecord(part, `multipart[${index}]`);
    const apply = parseModelChoices(value.apply, MAX_MULTIPART_APPLY_CHOICES, `multipart[${index}].apply`);
    referenceCount += apply.length;
    if (referenceCount > MAX_MULTIPART_MODEL_REFERENCES) throw new Error(`multipart exceeds ${MAX_MULTIPART_MODEL_REFERENCES} model references.`);
    return { when: parseMultipartCondition(value.when, index), apply };
  });
}

function parseMultipartCondition(raw: unknown, partIndex: number): NormalizedMultipartCondition {
  if (raw === undefined) return { clauses: [{}] };
  const clauses = parseMultipartExpression(raw, `multipart[${partIndex}].when`, 0);
  clauses.sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
  return { clauses };
}

function parseMultipartExpression(
  raw: unknown,
  location: string,
  depth: number,
): Array<Record<string, readonly string[]>> {
  if (depth >= MAX_MULTIPART_CONDITION_DEPTH) throw new Error(`${location} exceeds the condition nesting limit.`);
  const input = plainRecord(raw, location);
  const keys = Object.keys(input);
  if (keys.length === 1 && (keys[0] === "OR" || keys[0] === "AND")) {
    const operator = keys[0] as "OR" | "AND";
    const operands = input[operator];
    if (!Array.isArray(operands) || operands.length === 0 || operands.length > MAX_MULTIPART_CLAUSES) {
      throw new Error(`${location}.${operator} must contain 1-${MAX_MULTIPART_CLAUSES} conditions.`);
    }
    const parsed = operands.map((operand, index) => parseMultipartExpression(operand, `${location}.${operator}[${index}]`, depth + 1));
    if (operator === "OR") {
      const clauses = parsed.flat();
      if (clauses.length > MAX_MULTIPART_CLAUSES) throw new Error(`${location}.OR expands beyond ${MAX_MULTIPART_CLAUSES} clauses.`);
      return canonicalMultipartClauses(clauses);
    }
    let clauses: Array<Record<string, readonly string[]>> = [{}];
    for (const operandClauses of parsed) {
      const combined: Array<Record<string, readonly string[]>> = [];
      for (const left of clauses) {
        for (const right of operandClauses) {
          const merged = intersectMultipartClauses(left, right);
          if (merged) combined.push(merged);
          if (combined.length > MAX_MULTIPART_CLAUSES) throw new Error(`${location}.AND expands beyond ${MAX_MULTIPART_CLAUSES} clauses.`);
        }
      }
      clauses = combined;
    }
    if (clauses.length === 0) throw new Error(`${location}.AND is contradictory.`);
    return canonicalMultipartClauses(clauses);
  }
  if (keys.includes("OR") || keys.includes("AND")) throw new Error(`${location} cannot mix boolean operators with properties.`);
  return [parseMultipartClause(input, location)];
}

function intersectMultipartClauses(
  left: Record<string, readonly string[]>,
  right: Record<string, readonly string[]>,
): Record<string, readonly string[]> | undefined {
  const output: Record<string, readonly string[]> = { ...left };
  for (const [property, rightValues] of Object.entries(right)) {
    const leftValues = output[property];
    const values = leftValues === undefined ? [...rightValues] : leftValues.filter((value) => rightValues.includes(value));
    if (values.length === 0) return undefined;
    output[property] = [...new Set(values)].sort(compareText);
  }
  const sorted = Object.entries(output).sort(([leftKey], [rightKey]) => compareText(leftKey, rightKey));
  if (sorted.length > MAX_MULTIPART_PROPERTIES) return undefined;
  return Object.fromEntries(sorted);
}

function canonicalMultipartClauses(
  clauses: Array<Record<string, readonly string[]>>,
): Array<Record<string, readonly string[]>> {
  const unique = new Map(clauses.map((clause) => [JSON.stringify(clause), clause]));
  return [...unique.values()].sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
}

function parseMultipartClause(raw: unknown, location: string): Record<string, readonly string[]> {
  const input = plainRecord(raw, location);
  const entries = Object.entries(input);
  if (entries.length === 0 || entries.length > MAX_MULTIPART_PROPERTIES) {
    throw new Error(`${location} must contain 1-${MAX_MULTIPART_PROPERTIES} properties.`);
  }
  const output: Array<[string, readonly string[]]> = [];
  for (const [key, rawValue] of entries) {
    if (!safeName(key) || typeof rawValue !== "string" || rawValue.length === 0 || rawValue.length > 512) {
      throw new Error(`${location}.${key} must be a safe property string.`);
    }
    const values = rawValue.split("|");
    if (values.length === 0 || values.length > MAX_MULTIPART_VALUES || values.some((value) => value.length === 0 || value.length > 128)) {
      throw new Error(`${location}.${key} contains invalid alternatives.`);
    }
    const normalized = [...new Set(values)].sort(compareText);
    output.push([key, normalized]);
  }
  output.sort(([left], [right]) => compareText(left, right));
  return Object.fromEntries(output);
}

function parseConditions(raw: string): Record<string, string> {
  if (raw === "") return {};
  const conditions: Array<[string, string]> = [];
  for (const condition of raw.split(",")) {
    const separator = condition.indexOf("=");
    if (separator <= 0 || separator === condition.length - 1) throw new Error(`Invalid variant condition: ${condition}`);
    const key = condition.slice(0, separator);
    const value = condition.slice(separator + 1);
    if (!safeName(key) || value.length > 128) throw new Error(`Invalid variant condition: ${condition}`);
    conditions.push([key, value]);
  }
  if (conditions.length > MAX_CONDITIONS || new Set(conditions.map(([key]) => key)).size !== conditions.length) throw new Error("Invalid or excessive variant conditions.");
  conditions.sort(([left], [right]) => compareText(left, right));
  return Object.fromEntries(conditions);
}

function canonicalVariantKey(raw: string): string {
  return Object.entries(parseConditions(raw)).map(([key, value]) => `${key}=${value}`).join(",");
}

function parseModelChoices(raw: unknown, maximum = 64, name = "variant"): NormalizedModelReference[] {
  const choices = Array.isArray(raw) ? raw : [raw];
  if (choices.length === 0 || choices.length > maximum) throw new Error(`${name} must contain 1-${maximum} model choices.`);
  const normalized = choices.map((choice) => {
    const value = plainRecord(choice, `${name} model`);
    const model = resourceLocation(value.model, "minecraft", true);
    return {
      model,
      x: rotation(value.x),
      y: rotation(value.y),
      uvlock: value.uvlock === undefined ? false : booleanValue(value.uvlock, "uvlock"),
      weight: value.weight === undefined ? 1 : positiveInteger(value.weight, "weight"),
    };
  });
  normalized.sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
  return normalized;
}

function parseModel(raw: Record<string, unknown>, resourceId: string, archivePath: string): { value: NormalizedBlockModel; issue?: BlockModelIssue } {
  const parent = raw.parent === undefined ? undefined : resourceLocation(raw.parent, "minecraft", true);
  const texturesRaw = raw.textures === undefined ? {} : plainRecord(raw.textures, "textures");
  const textureEntries = Object.entries(texturesRaw);
  if (textureEntries.length > MAX_MODEL_TEXTURES) throw new Error(`textures exceeds ${MAX_MODEL_TEXTURES} entries.`);
  const textures: Record<string, string> = {};
  const forceTranslucentTextures: Record<string, true> = {};
  for (const [key, value] of textureEntries.sort(([left], [right]) => compareText(left, right))) {
    if (!safeName(key)) throw new Error("Model texture variable names must be safe.");
    const normalized = parseModelTextureReference(value, `textures.${key}`);
    textures[key] = normalized.reference;
    if (normalized.forceTranslucent) forceTranslucentTextures[key] = true;
  }

  let modelFaces: Partial<Record<BlockFace, string>> | undefined;
  let faceMetadata: Partial<Record<BlockFace, NormalizedModelFace>> | undefined;
  let elements: NormalizedBlockElement[] | undefined;
  let unsupportedReason: "COMPLEX_GEOMETRY" | undefined;
  if (raw.elements !== undefined) {
    if (!Array.isArray(raw.elements) || raw.elements.length === 0 || raw.elements.length > MAX_ELEMENTS_PER_MODEL) {
      throw new Error(`elements must contain 1-${MAX_ELEMENTS_PER_MODEL} entries.`);
    }
    elements = raw.elements.map((element, index) => parseElement(element, index));
    if (elements.length === 1 && isFullCubeElement(elements[0]!) && elements[0]!.rotation === undefined) {
      faceMetadata = elements[0]!.faces;
      modelFaces = Object.fromEntries(
        Object.entries(faceMetadata).map(([face, metadata]) => [face, metadata.texture]),
      ) as Partial<Record<BlockFace, string>>;
    }
  }
  const value: NormalizedBlockModel = {
    resourceId, archivePath, ...(parent ? { parent } : {}), textures,
    ...(Object.keys(forceTranslucentTextures).length > 0 ? { forceTranslucentTextures } : {}),
    ...(modelFaces ? { faces: modelFaces } : {}), ...(faceMetadata ? { faceMetadata } : {}),
    ...(elements ? { elements } : {}), ...(unsupportedReason ? { unsupportedReason } : {}),
  };
  return unsupportedReason
    ? { value, issue: { path: archivePath, code: "COMPLEX_MODEL_GEOMETRY", message: "Unsupported model geometry." } }
    : { value };
}

function parseModelTextureReference(raw: unknown, name: string): { reference: string; forceTranslucent: boolean } {
  if (typeof raw === "string") {
    return { reference: raw.startsWith("#") ? textureVariable(raw) : resourceLocation(raw, "minecraft", false), forceTranslucent: false };
  }
  const descriptor = plainRecord(raw, name);
  const keys = Object.keys(descriptor);
  if (!keys.every((key) => key === "sprite" || key === "force_translucent") || typeof descriptor.sprite !== "string") {
    throw new Error(`${name} must be a sprite string or a supported texture descriptor.`);
  }
  const forceTranslucent = descriptor.force_translucent === undefined
    ? false
    : booleanValue(descriptor.force_translucent, `${name}.force_translucent`);
  return {
    reference: descriptor.sprite.startsWith("#") ? textureVariable(descriptor.sprite) : resourceLocation(descriptor.sprite, "minecraft", false),
    forceTranslucent,
  };
}

function isFullCubeElement(element: NormalizedBlockElement): boolean {
  return coordinatesEqual(element.from, [0, 0, 0]) && coordinatesEqual(element.to, [16, 16, 16]);
}

function coordinatesEqual(raw: readonly unknown[], expected: readonly number[]): boolean {
  return raw.length === 3 && raw.every((value, index) => value === expected[index]);
}

function parseElement(raw: unknown, index: number): NormalizedBlockElement {
  const input = plainRecord(raw, `elements[${index}]`);
  const from = blockElementVector(input.from, `elements[${index}].from`);
  const to = blockElementVector(input.to, `elements[${index}].to`);
  const zeroAxes: number[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    if (from[axis]! > to[axis]!) throw new Error(`elements[${index}] must have from <= to on every axis.`);
    if (from[axis] === to[axis]) zeroAxes.push(axis);
  }
  if (zeroAxes.length > 1) throw new Error(`elements[${index}] may be zero-thickness on at most one axis.`);
  const shade = input.shade === undefined ? true : booleanValue(input.shade, `elements[${index}].shade`);
  const rotation = input.rotation === undefined ? undefined : parseElementRotation(input.rotation, `elements[${index}].rotation`);
  const elementFaces = parseElementFaces(input.faces, from, to);
  if (zeroAxes.length === 1 && rotation === undefined) {
    const allowed = zeroAxes[0] === 0 ? new Set<BlockFace>(["west", "east"])
      : zeroAxes[0] === 1 ? new Set<BlockFace>(["down", "up"])
        : new Set<BlockFace>(["north", "south"]);
    if (Object.keys(elementFaces).some((face) => !allowed.has(face as BlockFace))) {
      throw new Error(`elements[${index}] plane faces must be perpendicular to its zero-thickness axis.`);
    }
  }
  return { from, to, shade, faces: elementFaces, ...(rotation ? { rotation } : {}) };
}

function parseElementRotation(raw: unknown, name: string): BlockElementRotation {
  const input = plainRecord(raw, name);
  const keys = Object.keys(input);
  const axisFormat = "axis" in input || "angle" in input;
  const eulerFormat = "x" in input || "y" in input || "z" in input;
  if (axisFormat === eulerFormat) throw new Error(`${name} must use exactly one supported rotation format.`);
  const allowed = axisFormat
    ? new Set(["origin", "axis", "angle", "rescale"])
    : new Set(["origin", "x", "y", "z", "rescale"]);
  if (keys.some((key) => !allowed.has(key))) {
    throw new Error(`${name} contains unsupported properties.`);
  }
  const origin = blockElementVector(input.origin, `${name}.origin`);
  if (eulerFormat) {
    const euler = [input.x, input.y, input.z];
    if (euler.some((angle) => typeof angle !== "number" || !Number.isFinite(angle) || angle < -180 || angle > 180)) {
      throw new Error(`${name} Euler angles must be finite and within -180..180 degrees.`);
    }
    const rescale = input.rescale === undefined ? false : booleanValue(input.rescale, `${name}.rescale`);
    if (rescale) throw new Error(`${name} Euler rotations cannot use rescale.`);
    return { origin, euler: euler as unknown as BlockElementVector, rescale: false };
  }
  if (input.axis !== "x" && input.axis !== "y" && input.axis !== "z") throw new Error(`${name}.axis must be x, y, or z.`);
  if (typeof input.angle !== "number" || !Number.isFinite(input.angle) || input.angle < -90 || input.angle > 90) {
    throw new Error(`${name}.angle must be finite and within -90..90 degrees.`);
  }
  const rescale = input.rescale === undefined ? false : booleanValue(input.rescale, `${name}.rescale`);
  if (rescale && Math.abs(input.angle) > 45) throw new Error(`${name}.rescale is limited to rotations within 45 degrees.`);
  return { origin, axis: input.axis, angle: input.angle, rescale };
}

function parseElementFaces(
  raw: unknown,
  from: BlockElementVector,
  to: BlockElementVector,
): Partial<Record<BlockFace, NormalizedModelFace>> {
  const input = plainRecord(raw, "element.faces");
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.length > faces.length || keys.some((key) => !isBlockFace(key))) {
    throw new Error("element.faces must contain 1-6 known block faces.");
  }
  const output: Partial<Record<BlockFace, NormalizedModelFace>> = {};
  for (const face of faces) {
    if (!(face in input)) continue;
    const definition = plainRecord(input[face], `element.faces.${face}`);
    output[face] = {
      texture: parseFaceTextureReference(definition.texture, `element.faces.${face}.texture`),
      uv: definition.uv === undefined ? defaultFaceUv(face, from, to) : faceUv(definition.uv),
      rotation: faceRotation(definition.rotation),
      ...(definition.tintindex === undefined ? {} : { tintIndex: tintIndex(definition.tintindex) }),
      ...(definition.cullface === undefined ? {} : { cullFace: blockFace(definition.cullface, `element.faces.${face}.cullface`) }),
    };
  }
  return output;
}

function parseFaceTextureReference(raw: unknown, name: string): string {
  if (typeof raw !== "string") throw new Error(`${name} must be a texture variable or resource location.`);
  if (raw.startsWith("#")) return textureVariable(raw);
  if (!raw.includes(":") && !raw.includes("/")) return textureVariable(`#${raw}`);
  return resourceLocation(raw, "minecraft", false);
}

function chooseVariant(variants: readonly NormalizedBlockStateVariant[], state: Readonly<Record<string, string>>): NormalizedBlockStateVariant | undefined {
  return variants
    .filter((variant) => Object.entries(variant.conditions).every(([key, value]) => state[key] === value))
    .sort((left, right) => Object.keys(right.conditions).length - Object.keys(left.conditions).length || compareText(left.key, right.key))[0];
}

function multipartRequiredProperties(parts: readonly NormalizedMultipartPart[]): ReadonlySet<string> {
  const output = new Set<string>();
  for (const part of parts) {
    for (const clause of part.when.clauses) {
      for (const property of Object.keys(clause)) output.add(property);
    }
  }
  return output;
}

function multipartConditionMatches(
  condition: NormalizedMultipartCondition,
  state: Readonly<Record<string, string>>,
): boolean {
  return condition.clauses.some((clause) => Object.entries(clause).every(([property, values]) => {
    const actual = state[property];
    return actual !== undefined && values.includes(actual);
  }));
}

function validNormalizedMultipart(parts: readonly NormalizedMultipartPart[]): boolean {
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > MAX_MULTIPART_PARTS) return false;
  let references = 0;
  for (const part of parts) {
    if (!part || typeof part !== "object" || !Array.isArray(part.apply)
      || part.apply.length === 0 || part.apply.length > MAX_MULTIPART_APPLY_CHOICES) return false;
    references += part.apply.length;
    if (references > MAX_MULTIPART_MODEL_REFERENCES
      || part.apply.some((reference: NormalizedModelReference | undefined) => !validMultipartModelReference(reference))) return false;
    const clauses = part.when?.clauses;
    if (!Array.isArray(clauses) || clauses.length === 0 || clauses.length > MAX_MULTIPART_CLAUSES) return false;
    for (const clause of clauses) {
      if (!isPlainRecord(clause)) return false;
      const entries = Object.entries(clause);
      if (entries.length > MAX_MULTIPART_PROPERTIES || (entries.length === 0 && clauses.length !== 1)) return false;
      for (const [property, values] of entries) {
        if (!safeName(property) || !Array.isArray(values) || values.length === 0 || values.length > MAX_MULTIPART_VALUES) return false;
        if (values.some((value) => typeof value !== "string" || value.length === 0 || value.length > 128)) return false;
      }
    }
  }
  return true;
}

function validMultipartModelReference(reference: NormalizedModelReference | undefined): boolean {
  if (!reference || !Number.isSafeInteger(reference.weight) || reference.weight <= 0 || reference.weight > 10_000
    || typeof reference.uvlock !== "boolean") return false;
  if (![0, 90, 180, 270].includes(reference.x) || ![0, 90, 180, 270].includes(reference.y)) return false;
  try {
    return resourceLocation(reference.model, "minecraft", true) === reference.model;
  } catch {
    return false;
  }
}

interface ResolvedModelData {
  faces: Partial<Record<BlockFace, string>>;
  faceMetadata: Partial<Record<BlockFace, NormalizedModelFace>>;
  elements?: NormalizedBlockElement[];
  textures: Record<string, string>;
  forceTranslucentTextures: Record<string, true>;
}

function resolveModel(modelId: string, models: ReadonlyMap<string, NormalizedBlockModel>, chain: readonly string[], depth: number): ResolvedModelData | BlockTextureFallback {
  if (depth >= MAX_MODEL_DEPTH || chain.includes(modelId)) return { status: "fallback", reason: "MODEL_REFERENCE_CYCLE", resourceId: modelId };
  const model = models.get(modelId);
  if (!model) {
    const builtin = builtinModel(modelId);
    return builtin ?? { status: "fallback", reason: "MISSING_MODEL", resourceId: modelId };
  }
  if (model.unsupportedReason) return { status: "fallback", reason: model.unsupportedReason, resourceId: modelId };
  const parent = model.parent
    ? resolveModel(model.parent, models, [...chain, modelId], depth + 1)
    : { faces: {}, faceMetadata: {}, textures: {}, forceTranslucentTextures: {} };
  if ("status" in parent) return parent;
  if (model.elements !== undefined) {
    return {
      faces: { ...model.faces },
      faceMetadata: { ...model.faceMetadata },
      elements: model.elements,
      textures: { ...parent.textures, ...model.textures },
      forceTranslucentTextures: { ...parent.forceTranslucentTextures, ...model.forceTranslucentTextures },
    };
  }
  const faceMetadata = { ...parent.faceMetadata };
  for (const [face, texture] of Object.entries(model.faces ?? {}) as Array<[BlockFace, string]>) {
    faceMetadata[face] = model.faceMetadata?.[face] ?? defaultFaceMetadata(texture);
  }
  return {
    faces: { ...parent.faces, ...model.faces }, faceMetadata,
    ...(parent.elements ? { elements: parent.elements } : {}),
    textures: { ...parent.textures, ...model.textures },
    forceTranslucentTextures: { ...parent.forceTranslucentTextures, ...model.forceTranslucentTextures },
  };
}

function builtinModel(modelId: string): ResolvedModelData | undefined {
  if (modelId === "minecraft:block/block") return { faces: {}, faceMetadata: {}, textures: {}, forceTranslucentTextures: {} };
  if (modelId === "minecraft:block/cube") return builtinFaces({ down: "#down", up: "#up", north: "#north", south: "#south", west: "#west", east: "#east" });
  if (modelId === "minecraft:block/cube_all") return builtinFaces(allFaces("#all"));
  if (modelId === "minecraft:block/cube_column") return builtinFaces({ down: "#end", up: "#end", north: "#side", south: "#side", west: "#side", east: "#side" });
  if (modelId === "minecraft:block/cube_bottom_top") return builtinFaces({ down: "#bottom", up: "#top", north: "#side", south: "#side", west: "#side", east: "#side" });
  if (modelId === "minecraft:block/cube_top") return builtinFaces({ down: "#side", up: "#top", north: "#side", south: "#side", west: "#side", east: "#side" });
  if (modelId === "minecraft:block/orientable") return builtinFaces({ down: "#top", up: "#top", north: "#front", south: "#side", west: "#side", east: "#side" });
  if (modelId === "minecraft:block/orientable_with_bottom") return builtinFaces({ down: "#bottom", up: "#top", north: "#front", south: "#side", west: "#side", east: "#side" });
  if (modelId === "minecraft:block/cube_directional") return builtinFacesWithMetadata(
    { down: "#down", up: "#up", north: "#north", south: "#south", west: "#west", east: "#east" },
    { down: 180, west: 270, east: 90 },
  );
  if (modelId === "minecraft:block/cube_mirrored") return builtinFacesWithMetadata(
    { down: "#down", up: "#up", north: "#north", south: "#south", west: "#west", east: "#east" },
    {},
    new Set(faces),
  );
  if (modelId === "minecraft:block/cube_north_west_mirrored") return builtinFacesWithMetadata(
    { down: "#down", up: "#up", north: "#north", south: "#south", west: "#west", east: "#east" },
    {},
    new Set<BlockFace>(["north", "west"]),
  );
  return undefined;
}

function builtinFaces(modelFaces: Record<BlockFace, string>): ResolvedModelData {
  const faceMetadata = Object.fromEntries(faces.map((face) => [face, defaultFaceMetadata(modelFaces[face])])) as Record<BlockFace, NormalizedModelFace>;
  return {
    faces: modelFaces,
    faceMetadata,
    elements: [{ from: FULL_CUBE_FROM, to: FULL_CUBE_TO, shade: true, faces: faceMetadata }],
    textures: {},
    forceTranslucentTextures: {},
  };
}

function builtinFacesWithMetadata(
  modelFaces: Record<BlockFace, string>,
  rotations: Partial<Record<BlockFace, FaceRotation>>,
  mirroredFaces: ReadonlySet<BlockFace> = new Set(),
): ResolvedModelData {
  const faceMetadata = Object.fromEntries(faces.map((face) => [face, {
    texture: modelFaces[face],
    uv: mirroredFaces.has(face) ? [16, 0, 0, 16] as const : FULL_FACE_UV,
    rotation: rotations[face] ?? 0,
  }])) as Record<BlockFace, NormalizedModelFace>;
  return {
    faces: modelFaces,
    faceMetadata,
    elements: [{ from: FULL_CUBE_FROM, to: FULL_CUBE_TO, shade: true, faces: faceMetadata }],
    textures: {},
    forceTranslucentTextures: {},
  };
}

function legacyFullCubeElements(resolved: ResolvedModelData): NormalizedBlockElement[] | undefined {
  if (faces.some((face) => resolved.faces[face] === undefined)) return undefined;
  const metadata = Object.fromEntries(faces.map((face) => [
    face,
    resolved.faceMetadata[face] ?? defaultFaceMetadata(resolved.faces[face]!),
  ])) as Record<BlockFace, NormalizedModelFace>;
  return [{ from: FULL_CUBE_FROM, to: FULL_CUBE_TO, shade: true, faces: metadata }];
}

function rotateElementBounds(
  from: BlockElementVector,
  to: BlockElementVector,
  x: FaceRotation,
  y: FaceRotation,
): { from: BlockElementVector; to: BlockElementVector } {
  const points: BlockElementVector[] = [];
  for (const px of [from[0], to[0]]) {
    for (const py of [from[1], to[1]]) {
      for (const pz of [from[2], to[2]]) points.push(rotateElementPoint([px, py, pz], x, y));
    }
  }
  return {
    from: [Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1])), Math.min(...points.map((point) => point[2]))],
    to: [Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1])), Math.max(...points.map((point) => point[2]))],
  };
}

function rotateElementPoint(point: BlockElementVector, x: FaceRotation, y: FaceRotation): BlockElementVector {
  let output = { x: point[0] - 8, y: point[1] - 8, z: point[2] - 8 };
  for (let turns = 0; turns < x / 90; turns += 1) output = { x: output.x, y: -output.z, z: output.y };
  for (let turns = 0; turns < y / 90; turns += 1) output = { x: output.z, y: output.y, z: -output.x };
  return [output.x + 8, output.y + 8, output.z + 8];
}

function resolveTextureReference(
  raw: string,
  textures: Readonly<Record<string, string>>,
  forceTranslucentTextures: Readonly<Record<string, true>>,
  chain: readonly string[],
  depth: number,
): { value: string; forceTranslucent: boolean } | BlockTextureFallback {
  if (!raw.startsWith("#")) return { value: raw, forceTranslucent: false };
  const variable = raw.slice(1);
  if (depth >= MAX_TEXTURE_DEPTH || chain.includes(variable)) return { status: "fallback", reason: "TEXTURE_REFERENCE_CYCLE" };
  const next = textures[variable];
  if (!next) return { status: "fallback", reason: "MISSING_TEXTURE_VARIABLE" };
  const resolved = resolveTextureReference(next, textures, forceTranslucentTextures, [...chain, variable], depth + 1);
  if ("reason" in resolved) return resolved;
  return { value: resolved.value, forceTranslucent: resolved.forceTranslucent || forceTranslucentTextures[variable] === true };
}

function rotateFace(face: BlockFace, x: number, y: number): BlockFace {
  let vector = faceVector(face);
  for (let turns = 0; turns < x / 90; turns += 1) vector = { x: vector.x, y: -vector.z, z: vector.y };
  for (let turns = 0; turns < y / 90; turns += 1) vector = { x: vector.z, y: vector.y, z: -vector.x };
  return vectorFace(vector);
}

/**
 * Resolves the final clockwise quarter-turn of a face texture after the model
 * reference rotates the cube. UV-locked variants retain the element face's
 * orientation; unlocked variants rotate with the geometry.
 */
export function resolveFaceTextureRotation(
  face: BlockFace,
  x: FaceRotation,
  y: FaceRotation,
  uvlock: boolean,
  faceRotationValue: FaceRotation = 0,
): FaceRotation {
  if (uvlock) return faceRotationValue;
  const targetFace = rotateFace(face, x, y);
  const rotatedU = rotateVector(faceBasis(face).u, x, y);
  const targetBasis = faceBasis(targetFace);
  const induced = vectorEquals(rotatedU, targetBasis.u)
    ? 0
    : vectorEquals(rotatedU, targetBasis.v)
      ? 90
      : vectorEquals(rotatedU, negateVector(targetBasis.u))
        ? 180
        : 270;
  return ((faceRotationValue + induced) % 360) as FaceRotation;
}

function faceVector(face: BlockFace): { x: number; y: number; z: number } {
  switch (face) {
    case "down": return { x: 0, y: -1, z: 0 };
    case "up": return { x: 0, y: 1, z: 0 };
    case "north": return { x: 0, y: 0, z: -1 };
    case "south": return { x: 0, y: 0, z: 1 };
    case "west": return { x: -1, y: 0, z: 0 };
    case "east": return { x: 1, y: 0, z: 0 };
  }
}

function vectorFace(vector: { x: number; y: number; z: number }): BlockFace {
  if (vector.y === -1) return "down";
  if (vector.y === 1) return "up";
  if (vector.z === -1) return "north";
  if (vector.z === 1) return "south";
  return vector.x === -1 ? "west" : "east";
}

interface AxisVector { x: -1 | 0 | 1; y: -1 | 0 | 1; z: -1 | 0 | 1 }

function faceBasis(face: BlockFace): { u: AxisVector; v: AxisVector } {
  switch (face) {
    case "down": return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: -1 } };
    case "up": return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 } };
    case "north": return { u: { x: -1, y: 0, z: 0 }, v: { x: 0, y: -1, z: 0 } };
    case "south": return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: -1, z: 0 } };
    case "west": return { u: { x: 0, y: 0, z: 1 }, v: { x: 0, y: -1, z: 0 } };
    case "east": return { u: { x: 0, y: 0, z: -1 }, v: { x: 0, y: -1, z: 0 } };
  }
}

function rotateVector(vector: AxisVector, x: FaceRotation, y: FaceRotation): AxisVector {
  let output = vector;
  for (let turns = 0; turns < x / 90; turns += 1) output = { x: output.x, y: -output.z as AxisVector["y"], z: output.y };
  for (let turns = 0; turns < y / 90; turns += 1) output = { x: output.z, y: output.y, z: -output.x as AxisVector["z"] };
  return output;
}

function vectorEquals(left: AxisVector, right: AxisVector): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function negateVector(vector: AxisVector): AxisVector {
  return { x: -vector.x as AxisVector["x"], y: -vector.y as AxisVector["y"], z: -vector.z as AxisVector["z"] };
}

function allFaces(texture: string): Record<BlockFace, string> {
  return { down: texture, up: texture, north: texture, south: texture, west: texture, east: texture };
}

function defaultFaceMetadata(texture: string): NormalizedModelFace {
  return { texture, uv: FULL_FACE_UV, rotation: 0 };
}

function chooseModelReference(
  blockId: string,
  state: Readonly<Record<string, string>>,
  choices: readonly NormalizedModelReference[],
): NormalizedModelReference | undefined {
  const totalWeight = choices.reduce((sum, choice) => sum + choice.weight, 0);
  if (totalWeight <= 0) return undefined;
  const input = `${blockId}[${Object.entries(state).sort(([left], [right]) => compareText(left, right)).map(([key, value]) => `${key}=${value}`).join(",")}]`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 0x01000193) >>> 0;
  let selected = hash % totalWeight;
  for (const choice of choices) {
    if (selected < choice.weight) return choice;
    selected -= choice.weight;
  }
  return choices.at(-1);
}

function resourceLocation(raw: unknown, defaultNamespace: string, model: boolean): string {
  if (typeof raw !== "string" || raw.length === 0) throw new Error("Resource location must be a non-empty string.");
  const separator = raw.indexOf(":");
  const namespace = separator < 0 ? defaultNamespace : raw.slice(0, separator);
  const path = separator < 0 ? raw : raw.slice(separator + 1);
  if (!validResourceIdParts(namespace, path)) throw new Error(`Invalid resource location: ${raw}`);
  if (model && !path.startsWith("block/")) throw new Error(`Only block models are supported: ${raw}`);
  return `${namespace}:${path}`;
}

function validResourceIdParts(namespace: string, path: string): boolean {
  return namespacePattern.test(namespace) && resourcePathPattern.test(path) && !path.startsWith("/") && !path.endsWith("/") && !path.includes("//") && !path.split("/").some((part) => part === "." || part === "..");
}

function textureVariable(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("#") || !safeName(raw.slice(1))) throw new Error("Invalid texture variable reference.");
  return raw;
}

function rotation(raw: unknown): 0 | 90 | 180 | 270 {
  if (raw === undefined) return 0;
  if (raw === 0 || raw === 90 || raw === 180 || raw === 270) return raw;
  throw new Error("Model rotation must be 0, 90, 180, or 270.");
}

function faceRotation(raw: unknown): FaceRotation {
  if (raw === undefined) return 0;
  if (raw === 0 || raw === 90 || raw === 180 || raw === 270) return raw;
  throw new Error("Face rotation must be 0, 90, 180, or 270.");
}

function faceUv(raw: unknown): FaceUv {
  if (!Array.isArray(raw) || raw.length !== 4) throw new Error("Face uv must contain exactly four numbers.");
  const values = raw.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 16) {
      throw new Error("Face uv coordinates must be finite numbers from 0 to 16.");
    }
    return value;
  });
  return Object.freeze(values) as unknown as FaceUv;
}

function blockElementVector(raw: unknown, name: string): BlockElementVector {
  if (!Array.isArray(raw) || raw.length !== 3) throw new Error(`${name} must contain exactly three numbers.`);
  const values = raw.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)
      || value < MIN_ELEMENT_COORDINATE || value > MAX_ELEMENT_COORDINATE) {
      throw new Error(`${name} coordinates must be finite numbers from ${MIN_ELEMENT_COORDINATE} to ${MAX_ELEMENT_COORDINATE}.`);
    }
    return value;
  });
  return Object.freeze(values) as unknown as BlockElementVector;
}

function defaultFaceUv(face: BlockFace, from: BlockElementVector, to: BlockElementVector): FaceUv {
  switch (face) {
    case "down": return [from[0], 16 - to[2], to[0], 16 - from[2]];
    case "up": return [from[0], from[2], to[0], to[2]];
    case "north": return [16 - to[0], 16 - to[1], 16 - from[0], 16 - from[1]];
    case "south": return [from[0], 16 - to[1], to[0], 16 - from[1]];
    case "west": return [from[2], 16 - to[1], to[2], 16 - from[1]];
    case "east": return [16 - to[2], 16 - to[1], 16 - from[2], 16 - from[1]];
  }
}

function blockFace(raw: unknown, name: string): BlockFace {
  if (!isBlockFace(raw)) throw new Error(`${name} must be a block face.`);
  return raw;
}

function isBlockFace(raw: unknown): raw is BlockFace {
  return raw === "down" || raw === "up" || raw === "north" || raw === "south" || raw === "west" || raw === "east";
}

function positiveInteger(raw: unknown, name: string): number {
  if (!Number.isSafeInteger(raw) || (raw as number) <= 0 || (raw as number) > 10_000) throw new Error(`${name} must be a positive integer.`);
  return raw as number;
}

function tintIndex(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || (raw as number) < 0 || (raw as number) > 255) {
    throw new Error("Face tintindex must be an integer from 0 to 255.");
  }
  return raw as number;
}

function booleanValue(raw: unknown, name: string): boolean {
  if (typeof raw !== "boolean") throw new Error(`${name} must be boolean.`);
  return raw;
}

function plainRecord(raw: unknown, name: string): Record<string, unknown> {
  if (!isPlainRecord(raw)) throw new Error(`${name} must be a plain object.`);
  return raw;
}

function isPlainRecord(raw: unknown): raw is Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const prototype = Object.getPrototypeOf(raw);
  return prototype === Object.prototype || prototype === null;
}

function safeName(value: string): boolean {
  return stateKeyPattern.test(value) && value.length <= 64 && !unsafeNames.has(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
