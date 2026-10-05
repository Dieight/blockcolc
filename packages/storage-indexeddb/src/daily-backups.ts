import { addLocalDays, assertISODate, assertValidTimeZone, type DomainState } from '@blockcolc/domain';
import type { DailyBackupSummary } from '@blockcolc/application';
import { cloneAndParseState, stateSummary } from './codec.js';

export const DAILY_BACKUP_RETENTION_DAYS = 1;
export const DAILY_BACKUP_MAX_BYTES = 200 * 1024 * 1024;
export const DAILY_BACKUP_STORE = 'dailyBackups';
export const DAILY_BACKUP_BLOCK_STORE = 'dailyBackupBlocks';

export interface DailyBackupBlock {
  id: string;
  data: Uint8Array;
}
export interface DailyBackupManifest extends DailyBackupSummary {
  summary: ReturnType<typeof stateSummary>;
  stateBlock: string;
  blocks: Array<{ id: string; bytes: number }>;
}
export interface PreparedDailyBackup {
  manifest: DailyBackupManifest;
  blocks: DailyBackupBlock[];
}

export class DailyBackupValidationError extends Error {
  readonly code = 'INVALID_DAILY_BACKUP';
  constructor(message: string) { super(message); this.name = 'DailyBackupValidationError'; }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const HASH = /^[a-f0-9]{64}$/;

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** All hashing finishes before an IndexedDB write transaction is opened. */
export async function prepareDailyBackup(state: DomainState, date: string, createdAt: string, revision: number): Promise<PreparedDailyBackup> {
  assertISODate(date);
  const blueprints = [
    ...state.projects.map(project => project.importedBlueprint),
    ...state.habitBuildings.map(building => building.importedBlueprint),
    ...state.buildingBlueprintResources.map(resource => resource.blueprint),
    ...state.decorationBlueprintResources.map(resource => resource.blueprint),
  ].filter(value => value !== null);
  const encoded = new Map<string, Promise<DailyBackupBlock>>();
  const references = new WeakMap<object, string>();
  await Promise.all(blueprints.map(async blueprint => {
    const json = JSON.stringify(blueprint);
    let block = encoded.get(json);
    if (!block) {
      const data = encoder.encode(json);
      block = hashBytes(data).then(id => ({ id, data }));
      encoded.set(json, block);
    }
    references.set(blueprint, (await block).id);
  }));
  const replaceBlueprint = (_key:string, value: unknown) => {
    const reference = value !== null && typeof value === 'object' ? references.get(value) : undefined;
    return reference ? { $blueprint: reference } : value;
  };
  // Merge immutable chunks across checkpoints instead of storing another full
  // history every day. Changes affect at most one small record chunk plus the
  // index. Each index references all of its chunks, so pruning never breaks a
  // patch chain and old snapshots remain independently restorable.
  const chunks=new Map<string,DailyBackupBlock>();
  const properties=await Promise.all(Object.entries(state).map(async([key,value])=>{
    if(!Array.isArray(value))return[key,{kind:'value',value}] as const;
    const parts=await Promise.all(Array.from({length:Math.ceil(value.length/16)},async(_,index)=>{
      const data=encoder.encode(JSON.stringify(value.slice(index*16,index*16+16),replaceBlueprint));
      const id=await hashBytes(data);chunks.set(id,{id,data});return id;
    }));
    return[key,{kind:'array',parts,length:value.length}] as const;
  }));
  const body = encoder.encode(JSON.stringify({format:'blockcolc-daily-merged-v2',properties:Object.fromEntries(properties)},replaceBlueprint));
  const stateBlock = await hashBytes(body);
  const blocks = [{ id: stateBlock, data: body }, ...chunks.values(), ...await Promise.all(encoded.values())];
  const unique = [...new Map(blocks.map(block => [block.id, block])).values()].sort((a, b) => a.id.localeCompare(b.id));
  return { manifest: {
    id: date, date, createdAt, timeZone: state.calendar.timeZone, sourceRevision: revision,
    snapshotBytes: unique.reduce((sum, block) => sum + block.data.byteLength, 0),
    summary: stateSummary(state), stateBlock,
    blocks: unique.map(block => ({ id: block.id, bytes: block.data.byteLength })),
  }, blocks: unique };
}

export function parseDailyManifest(raw: unknown): DailyBackupManifest {
  if (!raw || typeof raw !== 'object') throw new DailyBackupValidationError('每日备份索引无效。');
  const item = raw as DailyBackupManifest;
  try { assertISODate(item.date); assertValidTimeZone(item.timeZone); } catch { throw new DailyBackupValidationError('每日备份日期或时区无效。'); }
  const instant = typeof item.createdAt === 'string' ? new Date(item.createdAt) : null;
  const summary = item.summary;
  if (item.id !== item.date || !instant || !Number.isFinite(instant.getTime()) || instant.toISOString() !== item.createdAt
    || !Number.isSafeInteger(item.sourceRevision) || item.sourceRevision < 0
    || !HASH.test(item.stateBlock) || !Array.isArray(item.blocks) || !item.blocks.length
    || item.blocks.some(block => !block || !HASH.test(block.id) || !Number.isSafeInteger(block.bytes) || block.bytes < 1)
    || new Set(item.blocks.map(block => block.id)).size !== item.blocks.length
    || !item.blocks.some(block => block.id === item.stateBlock)
    || item.snapshotBytes !== item.blocks.reduce((sum, block) => sum + block.bytes, 0)
    || !summary || typeof summary.isEmpty !== 'boolean'
    || ['projectCount', 'subtaskCount', 'monumentCount', 'completedFocusCount', 'interruptedFocusCount', 'progressReportCount']
      .some(key => !Number.isSafeInteger(summary[key as keyof typeof summary]) || Number(summary[key as keyof typeof summary]) < 0)
    || !Array.isArray(summary.blueprintIds) || summary.blueprintIds.some(id => typeof id !== 'string')
    || [summary.activeProjectId, summary.activeProjectTitle, summary.activeBlueprintId].some(value => value !== null && typeof value !== 'string')) {
    throw new DailyBackupValidationError('每日备份索引不完整。');
  }
  return item;
}

/** Count UTF-8 content once; manifest metadata is included in the payload budget. */
export function dailyBackupStoredBytes(manifests: readonly DailyBackupManifest[]): number {
  const sizes = new Map<string, number>();
  for (const manifest of manifests) for (const block of manifest.blocks) {
    if (sizes.has(block.id) && sizes.get(block.id) !== block.bytes) throw new DailyBackupValidationError('每日备份内容大小不一致。');
    sizes.set(block.id, block.bytes);
  }
  return [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0)
    + manifests.reduce((sum, manifest) => sum + encoder.encode(JSON.stringify(manifest)).byteLength, 0);
}

export function retainedDailyBackups(manifests: readonly DailyBackupManifest[], newestDate: string,
  limits = { days: DAILY_BACKUP_RETENTION_DAYS, bytes: DAILY_BACKUP_MAX_BYTES }): DailyBackupManifest[] {
  assertISODate(newestDate);
  // A clock correction must not delete valid checkpoints from the "future".
  const anchor = manifests.reduce((latest, item) => item.date > latest ? item.date : latest, newestDate);
  const earliest = addLocalDays(anchor, 1 - limits.days);
  const retained = manifests.filter(item => item.date >= earliest)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, limits.days);
  while (retained.length && dailyBackupStoredBytes(retained) > limits.bytes) retained.pop();
  return retained;
}

/** A date restores independently, without replaying a chain of earlier patches. */
export async function expandDailyBackup(manifest: DailyBackupManifest, blocks: readonly (DailyBackupBlock | undefined)[]): Promise<DomainState> {
  parseDailyManifest(manifest);
  const content = new Map<string, unknown>();
  const byId=new Map(blocks.filter((block):block is DailyBackupBlock=>block!==undefined).map(block=>[block.id,block]));
  await Promise.all(manifest.blocks.map(async reference => {
    const block = byId.get(reference.id);
    if (!block || !(block.data instanceof Uint8Array) || block.data.byteLength !== reference.bytes
      || await hashBytes(block.data) !== reference.id) throw new DailyBackupValidationError('每日备份内容缺失或校验失败；当前记录未更改。');
    try { content.set(block.id, JSON.parse(decoder.decode(block.data))); }
    catch { throw new DailyBackupValidationError('每日备份内容无法读取；当前记录未更改。'); }
  }));
  const root=content.get(manifest.stateBlock);
  let payload:unknown=root;
  if(root&&typeof root==='object'&&'format' in root&&root.format==='blockcolc-daily-merged-v2'){
    const properties='properties' in root?root.properties:null;
    if(!properties||typeof properties!=='object'||Array.isArray(properties))throw new DailyBackupValidationError('差异备份索引无效。');
    payload=Object.fromEntries(Object.entries(properties).map(([key,descriptor])=>{
      if(!descriptor||typeof descriptor!=='object')throw new DailyBackupValidationError('差异备份记录无效。');
      if(descriptor.kind==='value')return[key,descriptor.value];
      if(descriptor.kind!=='array'||!Array.isArray(descriptor.parts)||!Number.isSafeInteger(descriptor.length)||descriptor.length<0)
        throw new DailyBackupValidationError('差异备份分段无效。');
      const records=descriptor.parts.flatMap((id:unknown)=>{
        const part=typeof id==='string'?content.get(id):undefined;
        if(id===manifest.stateBlock||!Array.isArray(part)||part.length<1||part.length>16)throw new DailyBackupValidationError('差异备份内容缺失。');
        return part;
      });
      if(records.length!==descriptor.length)throw new DailyBackupValidationError('差异备份记录数量不符。');
      return[key,records];
    }));
  }
  const state = JSON.parse(JSON.stringify(payload), (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && '$blueprint' in value) {
      const id = value.$blueprint;
      if (typeof id !== 'string' || id === manifest.stateBlock || !content.has(id)) throw new DailyBackupValidationError('每日备份蓝图引用缺失。');
      return content.get(id);
    }
    return value;
  });
  return cloneAndParseState(state);
}

export function dailyBackupSummary(manifest: DailyBackupManifest): DailyBackupSummary {
  const { stateBlock: _stateBlock, blocks: _blocks, ...summary } = manifest;
  return structuredClone(summary);
}
