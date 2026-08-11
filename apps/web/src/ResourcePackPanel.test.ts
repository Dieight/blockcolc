import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import type { ResourcePackRepository } from '@tomato-clock/resource-pack-indexeddb';
import { DEFAULT_RESOURCE_PACK_LIMITS } from '@tomato-clock/resource-pack';
import { importResourcePackFromPicker } from './ResourcePackPanel';

describe('resource-pack picker import',()=>{
  it('treats native cancellation as a no-op',async()=>{
    const repository=mockRepository();
    const pick=vi.fn(async()=>null);
    await expect(importResourcePackFromPicker(repository,pick)).resolves.toBeNull();
    expect(pick).toHaveBeenCalledWith(DEFAULT_RESOURCE_PACK_LIMITS.maxInputBytes);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.select).not.toHaveBeenCalled();
  });

  it('parses, saves and selects bytes returned by a native-style picker',async()=>{
    const repository=mockRepository();
    const archive=makePack();
    const manifest=await importResourcePackFromPicker(repository,async()=>({name:'Native Pack.zip',bytes:archive}),()=>new Date('2026-07-26T09:00:00.000Z'));
    expect(manifest?.textures).toHaveLength(1);
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
      name:'Native Pack',importedAt:'2026-07-26T09:00:00.000Z',archive,
    }));
    const saved=vi.mocked(repository.save).mock.calls[0]?.[0];
    expect(saved?.id).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(repository.select).toHaveBeenCalledWith(saved?.id);
  });
});

function mockRepository():ResourcePackRepository{return{
  save:vi.fn(async input=>({id:input.id,name:input.name,importedAt:input.importedAt,archiveBytes:input.archive.byteLength,packFormat:input.manifest.pack.packFormat,textureCount:input.manifest.textures.length,namespaces:input.manifest.summary.namespaces,active:true})),
  list:vi.fn(async()=>[]),get:vi.fn(async()=>undefined),select:vi.fn(async()=>undefined),getActive:vi.fn(async()=>undefined),delete:vi.fn(async()=>null),clear:vi.fn(async()=>undefined),close:vi.fn(),
};}

function makePack():Uint8Array{return zipSync({
  'pack.mcmeta':strToU8(JSON.stringify({pack:{pack_format:34,description:'Native test'}})),
  'assets/minecraft/textures/block/stone.png':makePng(),
  'assets/minecraft/blockstates/stone.json':strToU8(JSON.stringify({variants:{'':{model:'minecraft:block/stone'}}})),
  'assets/minecraft/models/block/stone.json':strToU8(JSON.stringify({parent:'block/cube_all',textures:{all:'block/stone'}})),
});}
function makePng():Uint8Array{const signature=new Uint8Array([137,80,78,71,13,10,26,10]);const ihdr=new Uint8Array(13);const view=new DataView(ihdr.buffer);view.setUint32(0,16,false);view.setUint32(4,16,false);ihdr.set([8,6,0,0,0],8);return concat(signature,pngChunk('IHDR',ihdr),pngChunk('IDAT',new Uint8Array([0])),pngChunk('IEND',new Uint8Array()));}
function pngChunk(type:string,data:Uint8Array):Uint8Array{const typeBytes=strToU8(type);const output=new Uint8Array(12+data.length);const view=new DataView(output.buffer);view.setUint32(0,data.length,false);output.set(typeBytes,4);output.set(data,8);view.setUint32(8+data.length,crc32(concat(typeBytes,data)),false);return output;}
function crc32(bytes:Uint8Array):number{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit+=1)crc=(crc>>>1)^(0xedb88320&-(crc&1));}return(crc^0xffffffff)>>>0;}
function concat(...arrays:Uint8Array[]):Uint8Array{const output=new Uint8Array(arrays.reduce((sum,array)=>sum+array.length,0));let offset=0;for(const array of arrays){output.set(array,offset);offset+=array.length;}return output;}
