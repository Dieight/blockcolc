package com.blockcolc.preview

import android.os.Debug
import android.os.Process
import android.os.SystemClock
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.StrictJson
import com.blockcolc.presentation.WorldAssetKind
import com.blockcolc.presentation.WorldBlueprintReference
import com.blockcolc.preview.world.AndroidBlueprintCache
import com.blockcolc.preview.world.NativeBlueprintSources
import com.blockcolc.world.generation.BlueprintSnapshotCodec
import com.blockcolc.world.generation.BuiltinBlueprintCatalog
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.CancellationException
import java.util.concurrent.TimeUnit

/** Uses only catalog assets and isolated, recomputable cache files. */
class P3BlueprintRenderCacheTest {
    @get:Rule val foreground=ActivityScenarioRule(P3DerivedCacheCheckActivity::class.java)
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val catalog by lazy{BuiltinBlueprintCatalog.load()}

    private fun reference(title:String):WorldBlueprintReference {
        val entry=catalog.entries.filter{it.category=="supplemental"&&it.voxelCount in 4096..24000}.maxBy{it.voxelCount}
        val source=catalog.content(entry.id).json().put("title",title)
        return WorldBlueprintReference(entry.id,WorldAssetKind.EMBEDDED,StrictJson.render(source))
    }

    private fun ownedRoot(token:String):File {
        require(token.matches(Regex("[a-f0-9]{32}")))
        return File(context.cacheDir,"p3-blueprint-render-$token").canonicalFile.also{
            require(it.parentFile==context.cacheDir.canonicalFile)
        }
    }

    private fun stagedRoot():File {
        val token=InstrumentationRegistry.getArguments().getString("p3BlueprintCacheToken")
        assumeTrue("Requires the separate-process driver",token!=null)
        return ownedRoot(checkNotNull(token))
    }

    private fun fileFor(root:File,reference:WorldBlueprintReference):File {
        val key=BlueprintSnapshotCodec.key(checkNotNull(reference.sourceSha),false)
        return File(root,"blueprint-render/$key.bin")
    }

    private fun close(port:AndroidBlueprintCache) {
        port.close()
        assertTrue(port.awaitTermination(20,TimeUnit.SECONDS))
    }

    @Test fun writeForIndependentProcess() {
        val root=stagedRoot()
        assertFalse(root.exists())
        val asset=reference("缓存复用 · 中文与像素")
        val port=AndroidBlueprintCache(context,root,writeDelayMs=0)
        try{
            val decoded=NativeBlueprintSources(catalog,renderCache=port).resolve(asset,false)
            assertTrue(decoded.voxels.size>=4096)
            assertTrue(port.awaitWritesForTest(45,TimeUnit.SECONDS))
            val file=fileFor(root,asset)
            assertTrue(file.length() in BlueprintSnapshotCodec.HEADER_BYTES.toLong() until asset.embeddedCanonical!!.length.toLong())
            println("P3BlueprintCache stage=write pid=${Process.myPid()} fileBytes=${file.length()} cells=${decoded.voxels.size} geometry=${decoded.geometrySha}")
        }finally{close(port)}
    }

    @Test fun readFromIndependentProcess() {
        val root=stagedRoot()
        val asset=reference("缓存复用 · 中文与像素")
        val port=AndroidBlueprintCache(context,root,writeDelayMs=0)
        try {
            val file=fileFor(root,asset)
            assertTrue(file.isFile)
            val before=file.length()
            val readWall=SystemClock.elapsedRealtimeNanos()
            val readCpu=Debug.threadCpuTimeNanos()
            val restored=checkNotNull(port.read(checkNotNull(asset.sourceSha),false){false})
            val restoreCpu=Debug.threadCpuTimeNanos()-readCpu
            val restoreWall=SystemClock.elapsedRealtimeNanos()-readWall
            val parseWall=SystemClock.elapsedRealtimeNanos()
            val parseCpu=Debug.threadCpuTimeNanos()
            val original=NativeBlueprintSources(catalog).resolve(asset,false)
            val rawCpu=Debug.threadCpuTimeNanos()-parseCpu
            val rawWall=SystemClock.elapsedRealtimeNanos()-parseWall
            assertEquals(original.voxels,restored.voxels)
            assertEquals(original.canonical,restored.canonical)
            assertEquals(original.geometrySha,restored.geometrySha)
            val reused=NativeBlueprintSources(catalog,renderCache=port).resolve(asset,false)
            assertEquals(restored.canonical,reused.canonical)
            assertEquals(before,file.length())
            println("P3BlueprintCache stage=read pid=${Process.myPid()} fileBytes=$before cells=${reused.voxels.size} geometry=${reused.geometrySha} restoreCpuNs=$restoreCpu rawCpuNs=$rawCpu restoreWallNs=$restoreWall rawWallNs=$rawWall")
        }finally{close(port)}
    }

    @Test fun cleanIndependentProcessFiles() {
        val root=stagedRoot()
        removeBlueprintRenderTestFiles(root)
        if(root.exists())assertTrue(root.delete())
        println("P3BlueprintCache stage=cleanup pid=${Process.myPid()}")
    }

    @Test fun sourceChangesCorruptionAndEvictionKeepTheOriginalAssetsUsable() {
        val root=ownedRoot(UUID.randomUUID().toString().replace("-",""))
        val asset=reference("第一次建造")
        val updated=asset.copy(embeddedCanonical=StrictJson.render(org.json.JSONObject(asset.embeddedCanonical!!).put("title","第二次建造")))
        val port=AndroidBlueprintCache(context,root,maximumEntries=1,writeDelayMs=0)
        val foreign=File(root,"blueprint-render/sentinel.txt")
        try {
            fun resolve(ref:WorldBlueprintReference)=NativeBlueprintSources(catalog,renderCache=port).resolve(ref,false)
            val first=resolve(asset)
            assertTrue(port.awaitWritesForTest(45,TimeUnit.SECONDS))
            val file=fileFor(root,asset)
            assertTrue(file.isFile)
            foreign.writeText("private cache isolation")
            assertNull(port.read(checkNotNull(asset.sourceSha),true){false})
            assertNull(port.read(checkNotNull(updated.sourceSha),false){false})
            assertThrows(CancellationException::class.java){port.read(checkNotNull(asset.sourceSha),false){true}}
            RandomAccessFile(file,"rw").use{handle->
                val offset=handle.length()-1
                handle.seek(offset)
                val previous=handle.readUnsignedByte()
                handle.seek(offset)
                handle.write(previous xor 1)
            }
            assertNull(port.read(checkNotNull(asset.sourceSha),false){false})
            assertEquals(first.canonical,resolve(asset).canonical)
            assertTrue(port.awaitWritesForTest(45,TimeUnit.SECONDS))
            assertNotNull(port.read(checkNotNull(asset.sourceSha),false){false})
            assertTrue(file.setLastModified(1000))
            val second=resolve(updated)
            assertEquals("第二次建造",second.title)
            assertEquals(first.geometrySha,second.geometrySha)
            assertTrue(port.awaitWritesForTest(45,TimeUnit.SECONDS))
            assertTrue(fileFor(root,updated).isFile)
            assertFalse(file.exists())
            assertEquals("private cache isolation",foreign.readText())
            assertThrows(IllegalArgumentException::class.java){AndroidBlueprintCache(context,context.filesDir)}
        }finally{
            close(port)
            if(foreign.exists())assertTrue(foreign.delete())
            removeBlueprintRenderTestFiles(root)
            if(root.exists())assertTrue(root.delete())
        }
    }
}

internal fun removeBlueprintRenderTestFiles(root:File) {
    val folder=File(root,"blueprint-render")
    if(!folder.exists())return
    require(folder.canonicalFile.parentFile==root.canonicalFile&&folder.isDirectory)
    val allowed=Regex("[a-f0-9]{64}\\.bin(?:\\.(?:new|bak))?")
    for(file in checkNotNull(folder.listFiles())) {
        require(file.isFile&&allowed.matches(file.name))
        check(file.delete())
    }
    check(folder.delete())
}
