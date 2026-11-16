package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class OriginalStructureCodecTest {
    private fun source()=BuiltinBlueprintCatalog.load().let{catalog->BlueprintSnapshot.read(catalog.content("builtin-small-workshop").json())}
    private fun mesh(source:BlueprintSnapshot=source(),progress:Int=10000,origin:BlockPoint=BlockPoint(0.0,0.0,0.0))=
        OriginalStructureCompiler().compile(BuildingPreparation.prepare(source,"cache-owner",progress,10000),origin)
    @Test fun allBundledOriginalGeometryRoundTripsWithoutChangingAnyDrawOrMaterialBytes(){
        val catalog=BuiltinBlueprintCatalog.load();val compiler=OriginalStructureCompiler();var accepted=0
        for(entry in catalog.entries){
            val source=BlueprintSnapshot.read(catalog.content(entry.id).json(),entry.category in setOf("daily","holiday","birthday"))
            val recipe=BuildingPreparation.prepare(source,entry.id,10000,10000)
            val mesh=compiler.compile(recipe,BlockPoint(source.bounds.minX.toDouble(),source.bounds.minY.toDouble(),source.bounds.minZ.toDouble()))
            val key=OriginalStructureCodec.key(mesh.inputKey,mesh.origin)
            val bytes=OriginalStructureCodec.encode(key,mesh)?:continue
            val decoded=checkNotNull(OriginalStructureCodec.decode(key,bytes)){entry.id}
            assertEquals(mesh.inputKey,decoded.inputKey);assertEquals(mesh.sourceCount,decoded.sourceCount);assertEquals(mesh.origin,decoded.origin)
            assertEquals(mesh.estimatedBytes,decoded.estimatedBytes)
            assertArrayEquals(entry.id,bytes,OriginalStructureCodec.encode(key,decoded));accepted++
            for(batch in decoded.batches){assertTrue(batch.geometry.positions().isReadOnly);assertTrue(batch.matrices().isReadOnly)}
        }
        assertEquals("Every current bundled building must fit the bounded cache format",catalog.entries.size,accepted)
    }
    @Test fun corruptTruncatedWrongKeyAndOldFormatsRegenerateInsteadOfAdoptingGeometry(){
        val mesh=mesh();val key=OriginalStructureCodec.key(mesh.inputKey,mesh.origin);val bytes=OriginalStructureCodec.encode(key,mesh)!!
        assertNull(OriginalStructureCodec.decode("f".repeat(64),bytes));assertNull(OriginalStructureCodec.decode(key,bytes.copyOf(bytes.size-1)))
        assertNull(OriginalStructureCodec.decode(key,bytes.copyOf().also{it[it.lastIndex]=(it.last().toInt()xor 1).toByte()}))
        assertNull(OriginalStructureCodec.decode(key,bytes.copyOf().also{ByteBuffer.wrap(it).order(ByteOrder.LITTLE_ENDIAN).putInt(8,999)}))
        // A valid body hash cannot make a hostile count allocate unbounded memory.
        val malformed=bytes.copyOf();val b=ByteBuffer.wrap(malformed).order(ByteOrder.LITTLE_ENDIAN);val inputSize=b.getInt(80)
        b.putInt(80+4+inputSize+4+24,Int.MAX_VALUE)
        val hash=MessageDigest.getInstance("SHA-256").digest(malformed.copyOfRange(80,malformed.size));System.arraycopy(hash,0,malformed,48,32)
        assertNull(OriginalStructureCodec.decode(key,malformed))
        assertThrows(CancellationException::class.java){OriginalStructureCodec.decode(key,bytes,cancelled={true})}
    }
    @Test fun independentOwnersAndFreshProcessesReuseOnlyTheMatchingSourceProgressAndOrigin(){
        val input=source();val recipe=BuildingPreparation.prepare(input,"cache-owner",10000,10000);val origin=BlockPoint(0.0,0.0,0.0)
        val disk=hashMapOf<String,ByteArray>();var hits=0;var offers=0
        val storage=object:OriginalStructureStorage{
            override fun read(key:String,cancelled:()->Boolean)=disk[key]?.let{OriginalStructureCodec.decode(key,it,cancelled)?.also{hits++}}
            override fun offer(key:String,value:OriginalStructure){disk[key]=checkNotNull(OriginalStructureCodec.encode(key,value));offers++}
        }
        val first=OriginalStructureCache(storage=storage).prepare("one",recipe,origin);assertEquals(1,offers)
        val reopened=OriginalStructureCache(storage=storage).prepare("one",recipe,origin);assertEquals(1,hits);assertEquals(1,offers)
        assertArrayEquals(OriginalStructureCodec.encode(OriginalStructureCodec.key(first.inputKey,origin),first),OriginalStructureCodec.encode(OriginalStructureCodec.key(reopened.inputKey,origin),reopened))
        OriginalStructureCache(storage=storage).prepare("one",BuildingPreparation.prepare(input,"cache-owner",5000,10000),origin)
        OriginalStructureCache(storage=storage).prepare("one",recipe,BlockPoint(1.0,0.0,0.0));assertEquals(3,offers);assertEquals(1,hits)
        val key=OriginalStructureCodec.key(recipe.key,origin);disk[key]=byteArrayOf(1,2,3)
        OriginalStructureCache(storage=storage).prepare("one",recipe,origin);assertEquals(4,offers);assertNotNull(OriginalStructureCodec.decode(key,disk.getValue(key)))
    }
}
