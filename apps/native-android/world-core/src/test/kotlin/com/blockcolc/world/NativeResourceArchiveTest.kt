package com.blockcolc.world

import com.blockcolc.world.resource.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.CancellationException
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class NativeResourceArchiveTest{
    private val reference by lazy{JSONObject(javaClass.getResource("/native-resource-archive-oracle.json")!!.readText())}
    private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt()and 255)}
    private fun bytes(row:JSONObject)=Base64.getDecoder().decode(row.getString("zip"))
    private fun row()=reference.getJSONArray("cases").getJSONObject(0)
    private fun limits(v:JSONObject)=ResourceArchiveLimits(v.optInt("maxInputBytes",32*1024*1024),v.optInt("maxFileCount",16384),
        v.optInt("maxSingleFileBytes",4*1024*1024),v.optInt("maxTotalUncompressedBytes",64*1024*1024),v.optInt("maxPackMetadataBytes",64*1024))
    @Test fun sourceOracleIsBoundToTheCurrentResourceParser(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/resource-pack/src/index.ts").isFile}
        val hashes=reference.getJSONObject("sourceHashes");assertTrue(hashes.has("packages/resource-pack/src/index.ts"));assertTrue(hashes.length()>5)
        hashes.keys().forEach{f->assertEquals(f,hashes.getString(f),sha(File(root,f).readBytes()))}
    }
    @Test fun everySourceArchiveHasTheSameMetadataFilesPrioritiesAndRejectionCode(){
        val rows=reference.getJSONArray("cases");assertTrue(rows.length()>=35)
        repeat(rows.length()){i->val row=rows.getJSONObject(i);val expected=row.getJSONObject("expected");val input=bytes(row);val name=row.getString("name")
            if(expected.has("error")){
                val error=assertThrows(name,ResourcePackException::class.java){NativeResourceArchive.from(input,limits(row.getJSONObject("limits"))).close()}
                assertEquals(name,expected.getString("error"),error.code)
            }else NativeResourceArchive.from(input,limits(row.getJSONObject("limits"))).use{archive->
                assertTrue(name,expected.getJSONObject("pack").similar(archive.pack.json()));assertEquals(name,expected.getInt("archiveFileCount"),archive.archiveFileCount)
                val files=expected.getJSONArray("files");assertEquals(name,List(files.length()){files.getJSONObject(it).getString("path")},archive.paths)
                repeat(files.length()){n->val file=files.getJSONObject(n);val p=file.getString("path");val got=archive.read(p)
                    assertEquals(name,file.getInt("size"),got.size);assertEquals("$name/$p",file.getString("sha256"),sha(got))}
                assertEquals(sha(input),archive.inputSha256)
            }
        }
    }
    @Test fun fileAndByteInputsAreIndependentAndCloseDoesNotDeleteCallerFiles(){
        val original=bytes(row());val file=Files.createTempFile("blockcolc-pack-",".zip").toFile();file.writeBytes(original)
        try{
            NativeResourceArchive.from(original).use{memory->NativeResourceArchive.open(file).use{disk->
                assertEquals(memory.paths,disk.paths);assertEquals(memory.inputSha256,disk.inputSha256)
                for(p in memory.paths)assertArrayEquals(memory.read(p),disk.read(p))
                original.fill(0);assertTrue(memory.read("pack.mcmeta").isNotEmpty())
                val json=memory.pack.json();json.put("description","changed");assertNotEquals("changed",memory.pack.json().get("description"))
                val one=memory.read("pack.mcmeta");one.fill(0);assertTrue(memory.read("pack.mcmeta")[0].toInt()!=0)
            }}
            assertTrue(file.isFile);NativeResourceArchive.open(file).also{it.close();it.close();assertThrows(IllegalStateException::class.java){it.read("pack.mcmeta")}}
        }finally{assertTrue(file.delete())}
    }
    private fun u32(b:ByteArray,at:Int)=java.nio.ByteBuffer.wrap(b).order(java.nio.ByteOrder.LITTLE_ENDIAN).getInt(at)
    private fun put32(b:ByteArray,at:Int,v:Int){java.nio.ByteBuffer.wrap(b).order(java.nio.ByteOrder.LITTLE_ENDIAN).putInt(at,v)}
    private fun central(b:ByteArray)=u32(b,b.size-22+16)
    @Test fun localHeadersCannotRedirectToDifferentFilesOrOverlapTheIndex(){
        val original=bytes(row());val c=central(original)
        val mismatched=original.copyOf();mismatched[30]='x'.code.toByte()
        assertEquals("INVALID_ZIP",assertThrows(ResourcePackException::class.java){NativeResourceArchive.from(mismatched)}.code)
        val outside=original.copyOf();put32(outside,c+42,c)
        assertEquals("INVALID_ZIP",assertThrows(ResourcePackException::class.java){NativeResourceArchive.from(outside)}.code)
        val mismatchSize=original.copyOf();put32(mismatchSize,22,1)
        assertEquals("INVALID_ZIP",assertThrows(ResourcePackException::class.java){NativeResourceArchive.from(mismatchSize)}.code)
    }
    @Test fun dishonestExpandedSizesAndDamagedCompressedPayloadsAreRejectedOnBoundedRead(){
        val original=bytes(row());val c=central(original)
        // Keep both headers internally consistent: only actual bounded inflate/CRC can reject this claim.
        val tooShort=original.copyOf();put32(tooShort,c+24,1);put32(tooShort,22,1)
        assertEquals("INVALID_ZIP",assertThrows(ResourcePackException::class.java){NativeResourceArchive.from(tooShort)}.code)
        val tooLong=original.copyOf();val old=u32(tooLong,c+24);put32(tooLong,c+24,old+1);put32(tooLong,22,old+1)
        assertEquals("INVALID_ZIP",assertThrows(ResourcePackException::class.java){NativeResourceArchive.from(tooLong)}.code)
        val corrupted=original.copyOf();val name=java.nio.ByteBuffer.wrap(corrupted).order(java.nio.ByteOrder.LITTLE_ENDIAN).getShort(26).toInt()and 65535
        corrupted[30+name]=(corrupted[30+name].toInt()xor 0x3f).toByte()
        assertEquals("INVALID_ZIP",assertThrows(ResourcePackException::class.java){NativeResourceArchive.from(corrupted)}.code)
    }
    private fun descriptorZip(metadata:String="{\"pack\":{\"pack_format\":97,\"description\":\"中文\"}}"):ByteArray{
        val buffer=ByteArrayOutputStream();ZipOutputStream(buffer).use{zip->
            for((p,b)in listOf("pack.mcmeta" to metadata.toByteArray(),"中文/empty.txt" to byteArrayOf())){zip.putNextEntry(ZipEntry(p));zip.write(b);zip.closeEntry()}
        };return buffer.toByteArray()
    }
    @Test fun streamedZipDescriptorsUtf8NamesAndEmptyDeflatedFilesWork(){
        NativeResourceArchive.from(descriptorZip()).use{archive->assertEquals(2,archive.archiveFileCount);assertArrayEquals(byteArrayOf(),archive.read("中文/empty.txt"));assertEquals("中文",archive.pack.json().getString("description"))}
    }
    @Test fun metadataUsesStrictJsonRatherThanThePermissiveAndroidSyntax(){
        for(raw in listOf("{pack:{pack_format:97,description:'x'}}","{\"pack\":{\"pack_format\":97,\"description\":\"x\",}}","{\"pack\":{\"pack_format\":97,\"description\":NaN}}","{\"pack\":{\"pack_format\":97,\"description\":\"x\"}} trailing")){
            assertEquals("INVALID_PACK_MCMETA",assertThrows(ResourcePackException::class.java){NativeResourceArchive.from(descriptorZip(raw))}.code)
        }
        val deep="[".repeat(70)+"0"+"]".repeat(70)
        assertEquals("INVALID_PACK_MCMETA",assertThrows(ResourcePackException::class.java){NativeResourceArchive.from(descriptorZip("{\"pack\":{\"pack_format\":97,\"description\":$deep}}"))}.code)
    }
    @Test fun cancellationNeverPublishesAndTheCallerFileCanBeReopened(){
        val file=Files.createTempFile("blockcolc-pack-cancel-",".zip").toFile();file.writeBytes(bytes(row()))
        try{
            assertThrows(CancellationException::class.java){NativeResourceArchive.open(file){true}}
            NativeResourceArchive.open(file).use{archive->assertThrows(CancellationException::class.java){archive.read("pack.mcmeta"){true}};assertTrue(archive.read("pack.mcmeta").isNotEmpty())}
            assertThrows(IllegalArgumentException::class.java){ResourceArchiveLimits(maxFileCount=0)}
        }finally{assertTrue(file.delete())}
    }
}
