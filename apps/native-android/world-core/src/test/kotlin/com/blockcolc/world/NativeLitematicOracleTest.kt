package com.blockcolc.world

import com.blockcolc.world.generation.BlueprintSnapshot
import com.blockcolc.world.importing.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.*
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.CancellationException
import java.util.zip.GZIPOutputStream

class NativeLitematicOracleTest {
    private fun oracle()=javaClass.getResourceAsStream("/native-litematic-oracle.json")!!.use{JSONObject(it.bufferedReader().readText())}
    private fun sha(text:String)=MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString(""){"%02x".format(it.toInt()and 255)}
    private fun limits(raw:JSONObject)=NativeLitematicLimits().let{d->d.copy(
        compressedBytes=raw.optLong("maxCompressedBytes",d.compressedBytes),uncompressedBytes=raw.optLong("maxUncompressedBytes",d.uncompressedBytes),
        regions=raw.optInt("maxRegions",d.regions),horizontal=raw.optInt("maxHorizontalAxisLength",d.horizontal),vertical=raw.optInt("maxVerticalAxisLength",d.vertical),
        regionVolume=raw.optLong("maxRegionVolume",d.regionVolume),totalVolume=raw.optLong("maxTotalVolume",d.totalVolume),palette=raw.optInt("maxPaletteEntries",d.palette),voxels=raw.optInt("maxOutputVoxels",d.voxels))}
    @Test fun allSourceCasesPreserveGeometryOrderStatesEntityMetadataIdentityAndPreview(){
        val document=oracle();assertTrue(document.getJSONObject("sourceHashes").has("packages/litematic/src/index.ts"))
        val cases=document.getJSONArray("cases");assertTrue(cases.length()>=45)
        for(i in 0 until cases.length()){
            val case=cases.getJSONObject(i);val name=case.getString("name");val bytes=Base64.getDecoder().decode(case.getString("input"))
            if(!case.isNull("error")){
                val failure=assertThrows(name,NativeLitematicError::class.java){NativeLitematic.parse(bytes.inputStream(),limits(case.getJSONObject("limits")))}
                assertEquals(name,case.getString("error"),failure.code)
            }else {
                val parsed=NativeLitematic.parse(bytes.inputStream(),limits(case.getJSONObject("limits")))
                assertEquals(name,case.getString("sha"),sha(BlueprintSnapshot.canonicalJson(parsed.json())))
                assertEquals(name,BlueprintSnapshot.canonicalJson(case.getJSONObject("preview")),BlueprintSnapshot.canonicalJson(parsed.preview.json()))
                if(name=="dense-60-cubed"){
                    val b=parsed.json();assertEquals(216000,b.getJSONArray("voxels").length());assertEquals(59,b.getJSONObject("bounds").getInt("maxY"));assertFalse(parsed.decorationEligible)
                }
            }
        }
    }
    @Test fun cancellationBoundsAllLongStagesAndDoesNotReturnPartialBlueprint(){
        val cases=oracle().getJSONArray("cases");val dense=(0 until cases.length()).map{cases.getJSONObject(it)}.first{it.getString("name")=="dense-60-cubed"}
        val input=Base64.getDecoder().decode(dense.getString("input"))
        var allChecks=0;NativeLitematic.parse(input.inputStream(),cancelled={allChecks++;false})
        for(stop in listOf(1,200,5000,allChecks-100,allChecks)){
            var checks=0;assertThrows(CancellationException::class.java){NativeLitematic.parse(input.inputStream(),cancelled={++checks>=stop})}
            assertEquals(stop,checks)
        }
    }
    @Test fun hostileNbtDepthTagsCollectionsAllocationUtf8DuplicatesAndTrailingBytesAreRejected(){
        fun gzip(bytes:ByteArray)=ByteArrayOutputStream().also{out->GZIPOutputStream(out).use{it.write(bytes)}}.toByteArray()
        fun parse(bytes:ByteArray,nbt:NativeNbtLimits=NativeNbtLimits())=NativeLitematic.parse(gzip(bytes).inputStream(),NativeLitematicLimits(nbt=nbt))
        fun bytes(vararg n:Int)=n.map{it.toByte()}.toByteArray()
        val duplicate=bytes(10,0,0,3,0,1,120,0,0,0,1,3,0,1,120,0,0,0,2,0)
        val trailing=bytes(10,0,0,0,1)
        val hugeArray=bytes(10,0,0,12,0,1,120,0x7f,0xff,0xff,0xff,0)
        val utf8=bytes(10,0,0,8,0,1,120,0,2,0xc0,0xaf,0)
        for(input in listOf(duplicate,trailing,hugeArray,utf8))assertEquals("INVALID_NBT",assertThrows(NativeLitematicError::class.java){parse(input)}.code)
        assertThrows(NativeLitematicError::class.java){parse(bytes(10,0,0,10,0,1,120,10,0,1,121,0,0,0),NativeNbtLimits(depth=1))}
        assertThrows(NativeLitematicError::class.java){parse(bytes(10,0,0,9,0,1,120,3,0,0,0,2,0,0,0,1,0,0,0,2,0),NativeNbtLimits(tags=2))}
        assertThrows(NativeLitematicError::class.java){parse(bytes(10,0,0,8,0,1,120,0,1,121,0),NativeNbtLimits(retainedBytes=1))}
    }
    @Test fun byteArraysShareCollectionLimitAndNestedAllocationsShareRetainedBudget(){
        fun document(write:DataOutputStream.()->Unit)=ByteArrayOutputStream().also{out->DataOutputStream(out).use{it.writeByte(10);it.writeUTF("");it.write();it.writeByte(0)}}.toByteArray()
        fun parse(bytes:ByteArray,limits:NativeNbtLimits)=NativeJavaNbt(bytes.inputStream(),limits){false}.root()
        // No payload follows this hostile declaration. Reject its length before
        // allocating or trying to consume it, even when retainedBytes is huge.
        val declaration=document{writeByte(7);writeUTF("bytes");writeInt(256*1024*1024-1024)}
        val rejected=assertThrows(IllegalArgumentException::class.java){parse(declaration,NativeNbtLimits())}
        assertEquals("NBT collection length exceeded",rejected.message)
        val exact=document{writeByte(7);writeUTF("bytes");writeInt(16);write(ByteArray(16))}
        assertEquals(16,(parse(exact,NativeNbtLimits(collectionLength=16))["bytes"] as ByteArray).size)
        assertThrows(IllegalArgumentException::class.java){parse(exact,NativeNbtLimits(collectionLength=15))}
        val nested=document{
            for(name in listOf("a","b")){writeByte(10);writeUTF(name);writeByte(7);writeUTF("x");writeInt(32);write(ByteArray(32));writeByte(0)}
        }
        // Each compound alone fits 600 bytes; the pair must share one meter.
        val cumulative=assertThrows(IllegalArgumentException::class.java){parse(nested,NativeNbtLimits(retainedBytes=600))}
        assertEquals("NBT retained collection budget exceeded",cumulative.message)
        assertEquals(2,parse(nested,NativeNbtLimits(retainedBytes=1200)).size)
    }
    @Test fun gzipMetersCountActualAggregateBytesAndIgnoreForgedTrailerLength(){
        val nbt=ByteArrayOutputStream().also{out->DataOutputStream(out).use{d->
            d.writeByte(10);d.writeUTF("");d.writeByte(7);d.writeUTF("data");d.writeInt(8192);d.write(ByteArray(8192));d.writeByte(0)
        }}.toByteArray()
        val gzip=ByteArrayOutputStream().also{out->GZIPOutputStream(out).use{it.write(nbt)}}.toByteArray()
        val inflated=assertThrows(NativeLitematicError::class.java){NativeLitematic.parse(gzip.inputStream(),NativeLitematicLimits(uncompressedBytes=100))}
        assertEquals("NBT_TOO_LARGE",inflated.code)
        val compressed=assertThrows(NativeLitematicError::class.java){NativeLitematic.parse(gzip.inputStream(),NativeLitematicLimits(compressedBytes=16))}
        assertEquals("INPUT_TOO_LARGE",compressed.code)
        val forged=gzip.copyOf().also{for(i in it.size-4 until it.size)it[i]=0}
        val trailer=assertThrows(NativeLitematicError::class.java){NativeLitematic.parse(forged.inputStream(),NativeLitematicLimits(uncompressedBytes=100))}
        assertEquals("NBT_TOO_LARGE",trailer.code)
    }
    @Test fun providerReadFailuresAreNotAdoptedAndPackedLongBoundaryIsUnsigned(){
        val failing=object:InputStream(){var n=0;override fun read():Int=if(++n==1)0x1f else if(n==2)0x8b else throw IOException("Provider failed")}
        assertThrows(Exception::class.java){NativeLitematic.parse(failing)}
        val longs=longArrayOf(-1L,7L);assertEquals(7,NativeLitematic.packedIndex(longs,21,3))
        assertThrows(IllegalArgumentException::class.java){NativeLitematic.packedIndex(longs,-1,3)}
    }
}
