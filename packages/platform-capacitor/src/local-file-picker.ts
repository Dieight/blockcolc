import { registerPlugin } from '@capacitor/core';
import { isCapacitorNative } from './notification-port';

export interface PickedBinaryFile {
  name: string;
  mimeType: string | null;
  bytes: Uint8Array;
}

export interface NativeBinaryFilePickerOptions {
  maxBytes: number;
  fallbackName: string;
  method?: 'pickFile' | 'pickResourcePack';
}

export type NativeFilePickerErrorCode =
  | 'INVALID_LIMIT'
  | 'INVALID_RESPONSE'
  | 'MISSING_DATA'
  | 'INVALID_BASE64'
  | 'FILE_TOO_LARGE';

export class NativeFilePickerError extends Error {
  constructor(readonly code: NativeFilePickerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NativeFilePickerError';
  }
}

interface NativePickResult {
  cancelled: boolean;
  name?: string;
  mimeType?: string | null;
  base64Data?: string;
}

export interface NativeFilePickerPlugin {
  pickFile(options: { maxBytes: number }): Promise<NativePickResult>;
  pickResourcePack?(options: { maxBytes: number }): Promise<NativePickResult>;
}

const NativeFilePicker = registerPlugin<NativeFilePickerPlugin>('LitematicFilePicker');

export const DEFAULT_NATIVE_LITEMATIC_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_NATIVE_RESOURCE_PACK_MAX_BYTES = 32 * 1024 * 1024;
/** @deprecated Use the kind-specific limit. Retained for Litematic callers. */
export const DEFAULT_NATIVE_FILE_MAX_BYTES = DEFAULT_NATIVE_LITEMATIC_MAX_BYTES;

export async function pickNativeLitematicFile(maxBytes = DEFAULT_NATIVE_LITEMATIC_MAX_BYTES): Promise<PickedBinaryFile | null> {
  return pickNativeBinaryFile({ maxBytes, fallbackName: 'import.litematic', method: 'pickFile' });
}

export async function pickNativeResourcePackFile(maxBytes = DEFAULT_NATIVE_RESOURCE_PACK_MAX_BYTES): Promise<PickedBinaryFile | null> {
  return pickNativeBinaryFile({ maxBytes, fallbackName: 'resource-pack.zip', method: 'pickResourcePack' });
}

export async function pickNativeBinaryFile(options: NativeBinaryFilePickerOptions): Promise<PickedBinaryFile | null> {
  const safeOptions = validateOptions(options);
  if (!isCapacitorNative()) return null;
  return pickBinaryWithPlugin(NativeFilePicker, safeOptions);
}

export async function pickWithPlugin(plugin: NativeFilePickerPlugin, maxBytes: number): Promise<PickedBinaryFile | null> {
  return pickBinaryWithPlugin(plugin, { maxBytes, fallbackName: 'import.litematic', method: 'pickFile' });
}

export async function pickResourcePackWithPlugin(plugin: NativeFilePickerPlugin, maxBytes: number): Promise<PickedBinaryFile | null> {
  return pickBinaryWithPlugin(plugin, { maxBytes, fallbackName: 'resource-pack.zip', method: 'pickResourcePack' });
}

export async function pickBinaryWithPlugin(
  plugin: NativeFilePickerPlugin,
  options: NativeBinaryFilePickerOptions,
): Promise<PickedBinaryFile | null> {
  const safeOptions = validateOptions(options);
  const nativeMethod = safeOptions.method === 'pickResourcePack' ? plugin.pickResourcePack : plugin.pickFile;
  if (typeof nativeMethod !== 'function') {
    throw new NativeFilePickerError('INVALID_RESPONSE', `Native picker does not implement ${safeOptions.method}`);
  }
  const result: unknown = await nativeMethod.call(plugin, { maxBytes: safeOptions.maxBytes });
  if (!isRecord(result) || typeof result.cancelled !== 'boolean') {
    throw new NativeFilePickerError('INVALID_RESPONSE', 'Native picker returned an invalid response');
  }
  if (result.cancelled) return null;
  if (typeof result.base64Data !== 'string' || result.base64Data.length === 0) {
    throw new NativeFilePickerError('MISSING_DATA', 'Native picker returned no file data');
  }
  const maximumBase64Length = 4 * Math.ceil(safeOptions.maxBytes / 3);
  if (result.base64Data.length > maximumBase64Length) {
    throw new NativeFilePickerError('FILE_TOO_LARGE', 'Native picker returned a file larger than requested');
  }
  const bytes = decodeBase64(result.base64Data);
  if (bytes.byteLength > safeOptions.maxBytes) {
    throw new NativeFilePickerError('FILE_TOO_LARGE', 'Native picker returned a file larger than requested');
  }
  const name = optionalString(result.name, 'name')?.trim() || safeOptions.fallbackName;
  const mimeType = optionalString(result.mimeType, 'mimeType')?.trim() || null;
  return { name, mimeType, bytes };
}

export function decodeBase64(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new NativeFilePickerError('INVALID_BASE64', 'Native picker returned invalid base64 data');
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch (cause) {
    throw new NativeFilePickerError('INVALID_BASE64', 'Native picker returned invalid base64 data', { cause });
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function validateOptions(options: NativeBinaryFilePickerOptions): NativeBinaryFilePickerOptions {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new NativeFilePickerError('INVALID_LIMIT', 'maxBytes must be a positive safe integer');
  }
  if (typeof options.fallbackName !== 'string' || options.fallbackName.trim() === '' || options.fallbackName.length > 255) {
    throw new NativeFilePickerError('INVALID_LIMIT', 'fallbackName must contain 1-255 characters');
  }
  const method = options.method ?? 'pickFile';
  if (method !== 'pickFile' && method !== 'pickResourcePack') {
    throw new NativeFilePickerError('INVALID_LIMIT', 'Native picker method is invalid');
  }
  return { maxBytes: options.maxBytes, fallbackName: options.fallbackName.trim(), method };
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > 1024) {
    throw new NativeFilePickerError('INVALID_RESPONSE', `Native picker returned invalid ${field} metadata`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
