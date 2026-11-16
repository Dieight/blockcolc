package com.blockcolc.preview

import android.content.Context
import android.content.ContextWrapper
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.presentation.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.UUID

/** Only a fresh per-case directory is touched, never the preview's real prefs. */
class P3PreferencesStorageTest {
    private fun runCase(block:(Context,File)->Unit){
        val target=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=File(target.cacheDir,"p3-prefs-test-${UUID.randomUUID()}");check(folder.mkdir())
        val context=object:ContextWrapper(target){override fun getFilesDir()=folder}
        try{block(context,folder)}finally{check(folder.deleteRecursively())}
    }
    @Test fun actualAtomicStorageRoundTripsAndAnInterruptedWriteKeepsTheCommittedOriginal()=runCase{ctx,folder->
        val storage=AndroidPreferencesStorage(ctx);assertNull(storage.read())
        val saved=ClientPreferences(focusMinutes=30,language="en").canonical();storage.write(saved)
        assertEquals(saved,AndroidPreferencesStorage(ctx).read())
        val atomic=android.util.AtomicFile(File(folder,"client-preferences.json"));val stream=atomic.startWrite();stream.write("{broken".toByteArray());atomic.failWrite(stream)
        assertEquals(saved,AndroidPreferencesStorage(ctx).read())
    }
    @Test fun invalidUtf8AndOversizedOriginalsArePreservedByteForByteBeforeExplicitRepair(){
        for(raw in listOf(byteArrayOf(0xc3.toByte(),0x28),ByteArray(1024*1024+1){' '.code.toByte()},"{bad".toByteArray()))runCase{ctx,folder->
            val file=File(folder,"client-preferences.json");file.writeBytes(raw)
            val prefs=PreferencesController(AndroidPreferencesStorage(ctx));assertTrue(prefs.load().readFailed);assertArrayEquals(raw,file.readBytes())
            prefs.update{it.copy(themeMode="dark")}
            val hash=MessageDigest.getInstance("SHA-256").digest(raw).joinToString(""){"%02x".format(it.toInt() and 255)}
            assertArrayEquals(raw,File(folder,"preferences-originals/$hash.json").readBytes())
            assertFalse(PreferencesController(AndroidPreferencesStorage(ctx)).load().readFailed)
            assertEquals("dark",ClientPreferences.parseText(file.readText()).themeMode)
        }
    }
    @Test fun inabilityToPreserveCorruptionNeverOverwritesItWithFallbackDefaults()=runCase{ctx,folder->
        val file=File(folder,"client-preferences.json");file.writeText("{bad");File(folder,"preferences-originals").writeText("Not a directory")
        val prefs=PreferencesController(AndroidPreferencesStorage(ctx));assertTrue(prefs.load().readFailed)
        assertTrue(runCatching{prefs.update{it.copy(themeMode="dark")}}.isFailure);assertEquals("{bad",file.readText());assertTrue(prefs.load().readFailed)
    }
    @Test fun actualApkCanLoadFormalTextGlyphsTheNativeFontAndTheBrandVector(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val ui=UiResources.load();assertEquals(26,ui.icons.size);assertTrue("study" in ui.icons);assertTrue(ui.english.size>=1300)
        val font=androidx.core.content.res.ResourcesCompat.getFont(context,R.font.fusion_pixel_12px_zh_hans)
        assertNotNull(font);val paint=android.graphics.Paint().apply{typeface=font;textSize=24f}
        assertTrue(paint.hasGlyph("方"));assertTrue(paint.hasGlyph("A"))
        assertNotNull(context.getDrawable(R.drawable.native_brand))
    }
    @Test fun corruptExistingArchiveCannotBeMistakenForAPreservedOriginal()=runCase{ctx,folder->
        val raw="{bad".toByteArray();val file=File(folder,"client-preferences.json");file.writeBytes(raw)
        val hash=MessageDigest.getInstance("SHA-256").digest(raw).joinToString(""){"%02x".format(it.toInt() and 255)}
        val originals=File(folder,"preferences-originals");check(originals.mkdir());File(originals,"$hash.json").writeText("Damaged archive")
        val prefs=PreferencesController(AndroidPreferencesStorage(ctx));assertTrue(prefs.load().readFailed)
        assertTrue(runCatching{prefs.update{it.copy(themeMode="dark")}}.isFailure);assertArrayEquals(raw,file.readBytes())
    }
    @Test fun quietAtomicRenameFailureCannotBeReportedAsSuccessfulSave()=runCase{ctx,folder->
        val target=File(folder,"client-preferences.json");check(target.mkdir());File(target,"keep").writeText("Existing content")
        val result=runCatching{AndroidPreferencesStorage(ctx).write(ClientPreferences().canonical())}
        assertTrue(result.isFailure);assertTrue(target.isDirectory);assertEquals("Existing content",File(target,"keep").readText())
    }
}
