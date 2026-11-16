package com.blockcolc.world

import com.blockcolc.world.resource.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.InputStream
import java.util.Base64
import java.util.concurrent.CancellationException

class ResourcePackLibraryTest{
    @get:Rule val temporary=TemporaryFolder()
    private class MemoryIndex:ResourceLibraryIndex{
        var value:String?=null;var before=false;var after=false;var unavailable=false
        override fun read():String?{if(unavailable)error("unavailable");return value}
        override fun write(canonical:String){if(before)error("before commit");value=canonical;if(after)error("after commit")}
    }
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-resource-geometry-oracle.json")!!.readText()).getJSONArray("cases")}
    private fun bytes(name:String="simple"):ByteArray{val row=(0 until oracle.length()).map{oracle.getJSONObject(it)}.first{it.getString("name")==name};return Base64.getDecoder().decode(row.getString("zip"))}
    private fun pack(folder:File,id:String)=File(folder,"$id.pack")
    @Test fun reimportRepairsMissingOrChangedContentWithoutChangingSelectionOrLosingDamagedBytes(){
        val dir=temporary.newFolder();val index=MemoryIndex();val library=ResourcePackLibrary(dir,index)
        val data=bytes();val item=library.importPack("Original",{data.inputStream()});val metadata=index.value
        assertTrue(pack(dir,item.id).delete());assertEquals(item,library.importPack("Repair missing",{data.inputStream()}))
        assertEquals(metadata,index.value);assertArrayEquals(data,pack(dir,item.id).readBytes())
        val damaged=byteArrayOf(7,8,9);pack(dir,item.id).writeBytes(damaged)
        assertEquals(item,library.importPack("Repair changed",{data.inputStream()}));assertEquals(metadata,index.value)
        assertArrayEquals(data,pack(dir,item.id).readBytes());assertEquals(item.id,library.snapshot().activeId)
        val retained=dir.listFiles()!!.single{it.name.startsWith("resource-damaged-")};assertArrayEquals(damaged,retained.readBytes())
        library.openSelection().use{assertNotNull(it.stack)}
        assertEquals(1,library.snapshot().items.size);assertFalse(dir.listFiles()!!.any{it.name.endsWith(".part")})
    }
    @Test fun importedOriginalIsAddressedByContentAndDuplicateDoesNotChangeSelection(){
        val dir=temporary.newFolder();val index=MemoryIndex();val library=ResourcePackLibrary(dir,index){1000}
        val data=bytes();val item=library.importPack("  A\npack.zip  ",{data.inputStream()})
        assertEquals("Apack.zip",item.name);assertEquals(1000L,item.importedAt);assertEquals(data.size.toLong(),item.bytes);assertEquals(3,item.textures)
        assertEquals(item.id,library.snapshot().activeId);assertEquals(data.toList(),pack(dir,item.id).readBytes().toList())
        library.useOriginal();val before=index.value
        val duplicate=library.importPack("Another name",{data.inputStream()})
        assertEquals(item,duplicate);assertEquals(before,index.value);assertNull(library.snapshot().activeId);assertEquals(1,library.snapshot().items.size)
        assertEquals(ResourceContentState.PRESENT,library.inspectContents().getValue(item.id));assertEquals(1,dir.listFiles()!!.size)
    }
    @Test fun sourceBaseAndActivePriorityAreIndependentAndEqualPacksAreNotDoubled(){
        val dir=temporary.newFolder();val index=MemoryIndex();val library=ResourcePackLibrary(dir,index)
        library.useOriginal();val a=library.importPack("A",{bytes().inputStream()});assertNull(library.snapshot().activeId)
        val b=library.importPack("B",{bytes("tint:oak_leaves:0").inputStream()})
        library.select(a.id,base=true);library.openSelection().use{lease->assertEquals(1,lease.stack!!.layers.size);assertEquals(a.id,lease.stack!!.layers.single().archiveSha256)}
        library.select(b.id);library.openSelection().use{lease->assertEquals(listOf(a.id,b.id),lease.stack!!.layers.map{it.archiveSha256})}
        library.select(a.id);library.openSelection().use{assertEquals(1,it.stack!!.layers.size)}
        library.useOriginal();library.openSelection().use{assertNull(it.stack)}
        assertThrows(ResourceLibraryFailure::class.java){library.select("a".repeat(64))}
    }
    @Test fun failedOrUncertainMetadataCommitKeepsContentAndRetryIsSafe(){
        for(after in listOf(false,true)){
            val dir=temporary.newFolder();val index=MemoryIndex();val library=ResourcePackLibrary(dir,index)
            if(after)index.after=true else index.before=true
            val failure=assertThrows(ResourceLibraryFailure::class.java){library.importPack("A",{bytes().inputStream()})}
            assertEquals("RESOURCE_INDEX_COMMIT_UNCONFIRMED",failure.code);assertEquals(1,dir.listFiles()!!.size);assertTrue(dir.listFiles()!!.all{it.extension=="pack"})
            index.after=false;index.before=false
            assertEquals(if(after)1 else 0,library.snapshot().items.size)
            val item=library.importPack("A",{bytes().inputStream()});assertEquals(1,library.snapshot().items.size);assertTrue(pack(dir,item.id).isFile)
        }
    }
    @Test fun deletionCommitsIndexFirstAndUnknownCommitNeverUnlinksTheOriginal(){
        val dir=temporary.newFolder();val index=MemoryIndex();val library=ResourcePackLibrary(dir,index)
        val a=library.importPack("A",{bytes().inputStream()});library.select(a.id,base=true)
        val before=index.value;index.before=true
        assertThrows(ResourceLibraryFailure::class.java){library.remove(a.id)};assertEquals(before,index.value);assertTrue(pack(dir,a.id).exists())
        index.before=false;index.after=true
        assertThrows(ResourceLibraryFailure::class.java){library.remove(a.id)};assertTrue(pack(dir,a.id).exists());assertTrue(library.snapshot().items.isEmpty())
        // The uncertain deletion leaves recoverable bytes; reimport can adopt them again.
        index.after=false;library.importPack("A",{bytes().inputStream()});val result=library.remove(a.id)
        assertNull(result.activeId);assertNull(result.baseId);assertFalse(pack(dir,a.id).exists())
    }
    @Test fun brokenOrUnavailableIndexIsPreservedAndCannotBeOverwrittenByImport(){
        val dir=temporary.newFolder();val index=MemoryIndex().apply{value="{broken"};val library=ResourcePackLibrary(dir,index)
        assertEquals("RESOURCE_INDEX_INVALID",assertThrows(ResourceLibraryFailure::class.java){library.importPack("A",{bytes().inputStream()})}.code)
        assertEquals("{broken",index.value);assertTrue(dir.listFiles()!!.isEmpty());index.value=null;index.unavailable=true
        assertEquals("RESOURCE_INDEX_UNAVAILABLE",assertThrows(ResourceLibraryFailure::class.java){library.snapshot()}.code)
    }
    @Test fun missingAndChangedFilesRemainManageableButCannotBeUsedAsTheSelectedPack(){
        val dir=temporary.newFolder();val index=MemoryIndex();val library=ResourcePackLibrary(dir,index)
        val a=library.importPack("A",{bytes().inputStream()});val original=pack(dir,a.id).readBytes()
        check(pack(dir,a.id).delete());assertEquals(ResourceContentState.MISSING,library.inspectContents().getValue(a.id));assertEquals(1,library.snapshot().items.size)
        assertEquals("RESOURCE_CONTENT_MISSING",assertThrows(ResourceLibraryFailure::class.java){library.openSelection()}.code)
        pack(dir,a.id).writeBytes(byteArrayOf(0));assertEquals(ResourceContentState.CHANGED,library.inspectContents().getValue(a.id))
        assertEquals("RESOURCE_CONTENT_INVALID",assertThrows(ResourceLibraryFailure::class.java){library.openSelection()}.code)
        pack(dir,a.id).writeBytes(original);library.openSelection().close();library.remove(a.id);assertTrue(library.snapshot().items.isEmpty())
    }
    @Test fun malformedOversizedInterruptedAndCancelledInputsLeaveNoPartialFileOrIndex(){
        val dir=temporary.newFolder();val index=MemoryIndex();val library=ResourcePackLibrary(dir,index)
        assertThrows(ResourcePackException::class.java){library.importPack("invalid",{byteArrayOf(1,2,3).inputStream()})}
        val tooLarge=object:InputStream(){var left=NativeResourceArchive.MAX_JAR_BYTES.toLong()+1
            override fun read():Int=if(left-- >0)0 else -1
            override fun read(b:ByteArray,off:Int,len:Int):Int{if(left<=0)return -1;val n=minOf(left,len.toLong()).toInt();java.util.Arrays.fill(b,off,off+n,0.toByte());left-=n;return n}}
        assertEquals("RESOURCE_INPUT_TOO_LARGE",assertThrows(ResourceLibraryFailure::class.java){library.importPack("large",{tooLarge})}.code)
        assertThrows(CancellationException::class.java){library.importPack("cancelled",{bytes().inputStream()},cancelled={true})}
        assertThrows(ResourceLibraryFailure::class.java){library.importPack("interrupted",{object:InputStream(){override fun read():Int=throw java.io.IOException("read failed")}})}
        assertNull(index.value);assertTrue(dir.listFiles()!!.isEmpty())
    }
    @Test fun immutableMetadataAndSelectionRevisionAreVerifiedAfterReload(){
        val dir=temporary.newFolder();val index=MemoryIndex();val library=ResourcePackLibrary(dir,index)
        val a=library.importPack("A",{bytes().inputStream()});val saved=library.snapshot()
        assertThrows(UnsupportedOperationException::class.java){(saved.items as MutableList<StoredNativeResourcePack>).clear()}
        val reload=ResourcePackLibrary(dir,index).snapshot();assertEquals(saved.revision,reload.revision);assertEquals(saved.items,reload.items)
        val root=JSONObject(index.value!!);root.getJSONObject("payload").getJSONArray("items").getJSONObject(0).put("name","Tampered")
        index.value=root.toString();assertEquals("RESOURCE_INDEX_INVALID",assertThrows(ResourceLibraryFailure::class.java){library.snapshot()}.code)
        assertTrue(pack(dir,a.id).isFile)
    }
}
