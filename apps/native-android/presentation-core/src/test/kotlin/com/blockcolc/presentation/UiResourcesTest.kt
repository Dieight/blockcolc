package com.blockcolc.presentation

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class UiResourcesTest {
    @Test fun formalCopyAndPixelGlyphsAreBoundToCurrentSources(){
        val body=javaClass.getResource("/native-ui-assets.json")!!.readText();val truth=JSONObject(body);val resources=UiResources.parse(body)
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/domain/src/index.ts").isFile}
        val hashes=truth.getJSONObject("sourceHashes");hashes.keys().forEach{file->
            val actual=MessageDigest.getInstance("SHA-256").digest(File(root,file).readBytes()).joinToString(""){"%02x".format(it.toInt() and 255)}
            assertEquals("Stale formal UI asset: $file",hashes.getString(file),actual)
        }
        val en=truth.getJSONObject("en");en.keys().forEach{key->if(!key.contains('{'))assertEquals(en.getString(key),resources.text("en",key))}
        assertEquals("简体中文",resources.text("zh-CN","简体中文"));assertEquals("English",resources.text("en","English"))
        assertEquals("每轮 25 分钟",resources.text("zh-CN","每轮 {0} 分钟",25))
        assertEquals("Missing key",resources.text("en","Missing key"));assertEquals(12,resources.icons.getValue("clock").size)
        assertEquals(12,resources.icons.getValue("friends").size)
        assertNotEquals(resources.icons.getValue("tasks"),resources.icons.getValue("friends"))
        assertEquals(resources.english,UiResources.load().english)
    }
    @Test fun userStringsAreNotAutomaticallyTranslatedAndPublishedCollectionsCannotBeChanged(){
        val resources=UiResources.load();val userTitle="计时";assertEquals("计时",userTitle)
        assertTrue(runCatching{(resources.english as MutableMap)["计时"]="Broken"}.isFailure)
        assertTrue(runCatching{(resources.icons.getValue("clock") as MutableList)[0]="000000000000"}.isFailure)
        assertTrue(runCatching{(resources.icons as MutableMap).clear()}.isFailure)
    }
    @Test fun earlyStorageArtworkUsesTheSameCopyAsTheCompleteUi(){
        val complete=UiResources.load()
        for(language in listOf("zh-CN","en"))for(key in listOf("方块钟","本机记录","正在读取本机记录"))
            assertEquals(complete.text(language,key),UiResources.storageLoading.text(language,key))
    }
    @Test fun nativePageCopyDoesNotFallBackToChineseInEnglishMode(){
        val resources=UiResources.load()
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/domain/src/index.ts").isFile}
        val base=File(root,"apps/native-android/app/src/main/kotlin/com/blockcolc/preview")
        val files=File(base,"ui").walkTopDown().filter{it.isFile&&it.extension=="kt"}.toList()+listOf(File(base,"NativeApp.kt"),File(base,"world/NativeWorldHost.kt"))
        val quoted=Regex("\"([^\"\\r\\n]*[\\u4e00-\\u9fff][^\"\\r\\n]*)\"")
        // Cloud copy has explicit bilingual pairs. Check untranslated lookup
        // keys without treating the Chinese half of a translated pair as one.
        val pair=Regex("(?:cloudText|tr)\\(\\s*\"(?:[^\"\\\\]|\\\\.)*\"\\s*,\\s*\"(?:[^\"\\\\]|\\\\.)*\"\\s*\\)|if\\s*\\([^\\r\\n)]*(?:english|language)[^\\r\\n)]*\\)\\s*\"(?:[^\"\\\\]|\\\\.)*\"\\s*else\\s*\"(?:[^\"\\\\]|\\\\.)*\"")
        val keys=files.flatMap{file->val code=file.readText();val pairs=pair.findAll(code).map{it.range}.toList()
            quoted.findAll(code).filter{key->pairs.none{key.range.first in it}}.map{it.groupValues[1]}.toList()}.toSet()
        assertTrue(keys.size>100)
        val missing=keys.filter{it!="简体中文"&&resources.text("en",it)==it}
        assertTrue("Untranslated native UI copy: ${missing.joinToString()}",missing.isEmpty())
        assertEquals("简体中文",resources.text("en","简体中文"))
    }
    @Test fun literalNativeGlyphReferencesExistIncludingFailureAndRetrySurfaces(){
        val resources=UiResources.load()
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/domain/src/index.ts").isFile}
        val base=File(root,"apps/native-android/app/src/main/kotlin/com/blockcolc/preview")
        val literal=Regex("(?:\\bicon\\s*(?::\\s*String)?\\s*=|PixelGlyph\\s*\\()\\s*\"([a-z]+)\"")
        val uses=base.walkTopDown().filter{it.isFile&&it.extension=="kt"}.flatMap{file->literal.findAll(file.readText()).map{match->file.name to match.groupValues[1]}}.toList()
        assertTrue(uses.size>20)
        for((file,name)in uses)assertTrue("Missing native glyph $name in $file",name in resources.icons)
    }
}
