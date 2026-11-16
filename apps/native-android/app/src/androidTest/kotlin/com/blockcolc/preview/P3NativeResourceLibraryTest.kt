package com.blockcolc.preview

import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.preview.resources.AndroidResourceLibraryIndex
import com.blockcolc.preview.resources.NativeResourceController
import com.blockcolc.preview.resources.NativeWorldResourcePreparation
import com.blockcolc.world.resource.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class P3NativeResourceLibraryTest{
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val label get()=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-resource-geometry-oracle.json")!!.readText()).getJSONArray("cases")}
    private fun input(name:String)=Base64.decode((0 until oracle.length()).map{oracle.getJSONObject(it)}.first{it.getString("name")==name}.getString("zip"),Base64.DEFAULT)
    private fun folder(suffix:String)=File.createTempFile("resource-library-$suffix-",".probe",context.cacheDir).also{check(it.delete());check(it.mkdir())}
    private fun clean(folder:File){require(folder.canonicalFile.parentFile==context.cacheDir.canonicalFile)
        for(file in folder.listFiles().orEmpty()){require(file.canonicalFile.parentFile==folder.canonicalFile&&file.isFile);check(file.delete())};check(folder.delete())}
    private fun record(suffix:String,value:JSONObject){File(context.filesDir,"p3-world-resource-library-$suffix.json").writeText(value.put("schema",1).put("caseLabel",label).toString())}
    @Test @androidx.test.filters.SdkSuppress(minSdkVersion=29) @android.annotation.TargetApi(29)
    fun fullClientArchiveStreamsThroughTheDocumentResolverAndReopensWithoutChangingItsOriginal(){
        val args=InstrumentationRegistry.getArguments();val path=checkNotNull(args.getString("p3CapacityArchive"))
        val expected=checkNotNull(args.getString("p3CapacityArchiveSha"))
        require(path=="p3-capacity-$label.jar"&&expected.matches(Regex("[a-f0-9]{64}")))
        val original=File(context.filesDir,path);assertTrue(original.length()>32L*1024*1024)
        fun digest(file:File):String{
            val sha=java.security.MessageDigest.getInstance("SHA-256")
            file.inputStream().use{input->val buffer=ByteArray(32768);while(true){val n=input.read(buffer);if(n<0)break;assertTrue(n>0);sha.update(buffer,0,n)}}
            return sha.digest().joinToString(""){"%02x".format(it.toInt()and 255)}
        }
        assertEquals(expected,digest(original));val bytes=original.length()
        val folder=folder("large-provider");val controller=NativeResourceController.isolated(context,folder)
        val resolver=context.contentResolver;var uri:android.net.Uri?=null;var completed=false;var ownedDocumentRemoved=false
        var textures=0;var models=0;var states=0
        fun action(block:()->Unit){
            InstrumentationRegistry.getInstrumentation().runOnMainSync(block)
            val deadline=android.os.SystemClock.uptimeMillis()+90000
            while(!controller.snapshot().ready||controller.snapshot().busy){
                assertTrue("Large resource operation did not complete",android.os.SystemClock.uptimeMillis()<deadline);Thread.sleep(10)
            }
            assertNull(controller.snapshot().error)
        }
        try{
            uri=checkNotNull(resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,android.content.ContentValues().apply{
                put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME,"blockcolc-$label.jar")
                put(android.provider.MediaStore.MediaColumns.MIME_TYPE,"application/java-archive")
                put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,"Download/")
                put(android.provider.MediaStore.MediaColumns.IS_PENDING,1)
            }))
            checkNotNull(resolver.openOutputStream(uri!!,"w")).use{output->original.inputStream().use{it.copyTo(output,32768)}}
            assertEquals(1,resolver.update(uri!!,android.content.ContentValues().apply{put(android.provider.MediaStore.MediaColumns.IS_PENDING,0)},null,null))
            action{controller.refresh()};action{controller.original()}
            action{controller.import(uri!!)}
            val imported=controller.snapshot().metadata!!.items.single()
            assertEquals(expected,imported.id);assertEquals(bytes,imported.bytes);assertTrue(imported.clientJar)
            textures=imported.textures;models=imported.models;states=imported.states
            assertTrue(textures>1000&&models>1000&&states>1000)
            assertNull(controller.snapshot().metadata!!.activeId)
            val stored=File(folder,"$expected.pack");assertEquals(bytes,stored.length());assertEquals(expected,digest(stored))
            action{controller.select(expected)}
            val selected=controller.snapshot().metadata!!
            val reopened=ResourcePackLibrary(folder,AndroidResourceLibraryIndex(folder))
            assertEquals(selected.revision,reopened.snapshot().revision);assertEquals(expected,reopened.snapshot().activeId)
            reopened.openSelection().use{lease->assertEquals(expected,lease.stack!!.layers.single().archiveSha256)}
            action{controller.import(uri!!)}
            assertEquals(selected.revision,controller.snapshot().metadata!!.revision)
            assertEquals(imported,controller.snapshot().metadata!!.items.single())
            action{controller.remove(expected)};assertTrue(controller.snapshot().metadata!!.items.isEmpty());assertNull(controller.snapshot().metadata!!.activeId)
            assertEquals(bytes,original.length());assertEquals(expected,digest(original));completed=true
        }finally{
            try{controller.closeForTest();clean(folder)}finally{
                uri?.let{resolver.delete(it,null,null);ownedDocumentRemoved=resolver.query(it,arrayOf(android.provider.MediaStore.MediaColumns._ID),null,null,null)?.use{cursor->!cursor.moveToFirst()}?:true}
                record("large-provider",JSONObject().put("completed",completed).put("wireBytes",bytes).put("sourceSha256",expected)
                    .put("textures",textures).put("models",models).put("states",states).put("ownedDocumentRemoved",ownedDocumentRemoved))
                assertTrue("Owned provider document must be removed",ownedDocumentRemoved)
            }
        }
    }
    @Test fun missingSelectedOriginalKeepsTheLastPreparedAssetsAndRefreshDoesNotHideItsFailure(){
        val folder=folder("controller");val library=ResourcePackLibrary(folder,AndroidResourceLibraryIndex(folder))
        val first=library.importPack("A",{input("simple").inputStream()})
        val second=library.importPack("B",{input("render-gallery").inputStream()})
        val controller=NativeResourceController.isolated(context,folder);val preparation=NativeWorldResourcePreparation(controller)
        fun action(block:()->Unit){
            InstrumentationRegistry.getInstrumentation().runOnMainSync(block)
            val deadline=android.os.SystemClock.uptimeMillis()+10000
            while(!controller.snapshot().ready||controller.snapshot().busy){assertTrue("Resource operation timed out",android.os.SystemClock.uptimeMillis()<deadline);Thread.sleep(10)}
            assertNull(controller.snapshot().error)
        }
        try{
            action{controller.refresh()};assertEquals(first.id,controller.snapshot().metadata!!.activeId)
            val oldSelection=checkNotNull(controller.snapshot().selection);val oldAssets=checkNotNull(preparation.prepare(oldSelection){false})
            assertSame(oldAssets,preparation.prepare(oldSelection){false})
            action{controller.select(second.id)};val missingSelection=checkNotNull(controller.snapshot().selection)
            val original=File(folder,"${second.id}.pack");val offline=File(folder,"${second.id}.offline");assertTrue(original.renameTo(offline))
            assertThrows(ResourceLibraryFailure::class.java){preparation.prepare(missingSelection){false}}
            val failure=controller.snapshot().worldError;assertNotNull(failure)
            assertSame(oldAssets,preparation.prepare(oldSelection){false});assertEquals(failure,controller.snapshot().worldError)
            action{controller.refresh()};assertEquals(failure,controller.snapshot().worldError);assertEquals(ResourceContentState.MISSING,controller.snapshot().contents[second.id])
            action{controller.import(android.net.Uri.fromFile(offline))};assertTrue(original.isFile)
            val retrySelection=checkNotNull(controller.snapshot().selection);assertTrue(retrySelection.reload>missingSelection.reload)
            val repaired=checkNotNull(preparation.prepare(retrySelection){false});assertNotSame(oldAssets,repaired);assertNull(controller.snapshot().worldError)
            action{controller.retry()};val explicitRetry=checkNotNull(controller.snapshot().selection)
            assertTrue(explicitRetry.reload>retrySelection.reload);assertNotSame(repaired,preparation.prepare(explicitRetry){false})
            action{controller.original()};assertNull(preparation.prepare(controller.snapshot().selection){false});assertNull(controller.snapshot().worldError)
            record("controller",JSONObject().put("retainedPreparedAssets",true).put("refreshPreservedFailure",true).put("missingContentIdentified",true)
                .put("reimportedMissingContent",true).put("retryPreparedRepairedOriginal",true)
                .put("originalSelectionClearedBothLayers",controller.snapshot().metadata!!.activeId==null&&controller.snapshot().metadata!!.baseId==null))
        }finally{preparation.close();controller.closeForTest();clean(folder)}
    }
    @Test fun actualAndroidIndexPreservesUnicodeAndIndependentLayerSelectionAcrossReopen(){
        val folder=folder("roundtrip")
        try{
            val library=ResourcePackLibrary(folder,AndroidResourceLibraryIndex(folder)){1000}
            val first=library.importPack("中文 / \"A\".zip",{input("simple").inputStream()});val second=library.importPack("Oak",{input("tint:oak_leaves:0").inputStream()})
            library.select(first.id,base=true);library.select(second.id)
            val reopened=ResourcePackLibrary(folder,AndroidResourceLibraryIndex(folder));assertEquals(first.name,reopened.snapshot().items.first().name)
            reopened.openSelection().use{lease->assertEquals(listOf(first.id,second.id),lease.stack!!.layers.map{it.archiveSha256})
                assertTrue(lease.stack!!.resolver().geometry("minecraft:oak_leaves") is ResourceBlockGeometry)}
            val duplicate=reopened.importPack("New name",{input("simple").inputStream()});assertEquals(first,duplicate);assertEquals(2,reopened.snapshot().items.size)
            reopened.useOriginal();reopened.openSelection().use{assertNull(it.stack)}
            reopened.remove(second.id);assertEquals(listOf(first.id),reopened.snapshot().items.map{it.id})
            record("roundtrip",JSONObject().put("imported",2).put("unicodeName",first.name).put("reopened",true).put("deduplicated",true).put("selectionClearedAtomically",true).put("sourceFilesUnchanged",true))
        }finally{clean(folder)}
    }
    @Test fun actualAtomicIndexUncertainCommitRetainsContentAndCorruptIndexIsNotReplaced(){
        val folder=folder("failure")
        try{
            val atomic=AndroidResourceLibraryIndex(folder);var fail=true
            val uncertain=object:ResourceLibraryIndex{override fun read()=atomic.read();override fun write(canonical:String){atomic.write(canonical);if(fail)throw java.io.IOException("Injected after actual AtomicFile commit")}}
            val library=ResourcePackLibrary(folder,uncertain)
            assertEquals("RESOURCE_INDEX_COMMIT_UNCONFIRMED",assertThrows(ResourceLibraryFailure::class.java){library.importPack("A",{input("simple").inputStream()})}.code)
            assertEquals(1,library.snapshot().items.size);fail=false
            val same=library.importPack("A",{input("simple").inputStream()});assertEquals(1,library.snapshot().items.size)
            val original=File(folder,"${same.id}.pack");assertTrue(original.isFile)
            File(folder,"index.json").writeText("{broken")
            assertEquals("RESOURCE_INDEX_INVALID",assertThrows(ResourceLibraryFailure::class.java){library.importPack("B",{input("tint:oak_leaves:0").inputStream()})}.code)
            assertEquals("{broken",File(folder,"index.json").readText());assertTrue(original.isFile)
            record("failure",JSONObject().put("uncertainCommitRetained",true).put("retryDeduplicated",true).put("corruptIndexPreserved",true).put("oldContentRetained",true))
        }finally{clean(folder)}
    }
}
