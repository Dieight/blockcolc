package com.blockcolc.audio

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

class AudioLibraryTest {
    @get:Rule val temp=TemporaryFolder()
    private class Index:AudioIndex {var wire:String?=null;var reject=false;var uncertain=false
        override fun read()=wire
        override fun write(value:String){if(reject)throw IOException("injected before commit");wire=value;if(uncertain)throw IOException("injected after commit")}}
    private fun fixture(index:Index=Index(),probe:Long=1000):Pair<AudioLibrary,Index> = AudioLibrary(temp.newFolder(),index){probe} to index
    @Test fun importedOriginalSurvivesNewReaderAndDuplicateImportKeepsItsIdentity(){
        val folder=temp.newFolder();val index=Index();val library=AudioLibrary(folder,index){1234}
        val first=library.importAudio("晚风\n.ogg"){ByteArrayInputStream(byteArrayOf(1,2,3,4))}
        assertEquals("晚风.ogg",first.name);assertEquals(4L,first.bytes);assertEquals(1234L,first.durationMs)
        assertArrayEquals(byteArrayOf(1,2,3,4),library.playable(first.id).readBytes())
        assertEquals(first,AudioLibrary(folder,index){1234}.list().single())
        assertEquals(first,library.importAudio("new name"){ByteArrayInputStream(byteArrayOf(1,2,3,4))})
        assertEquals(1,library.list().size);assertEquals(listOf(first.id),folder.list()!!.toList())
    }
    @Test fun capacityAndInvalidMediaNeverDestroyAnExistingOriginal(){
        val (library,index)=fixture();repeat(8){n->library.importAudio("$n"){ByteArrayInputStream(byteArrayOf(n.toByte()))}}
        val before=index.wire;var opened=false
        assertEquals("AUDIO_LIBRARY_FULL",assertThrows(AudioFailure::class.java){library.importAudio("overflow"){opened=true;ByteArrayInputStream(byteArrayOf(9))}}.code)
        assertFalse(opened);assertEquals(before,index.wire);assertEquals(8,library.list().size)
        val (empty,_)=fixture(probe=AudioLibrary.MAX_DURATION+1)
        assertEquals("AUDIO_INVALID_MEDIA",assertThrows(AudioFailure::class.java){empty.importAudio("long"){ByteArrayInputStream(byteArrayOf(1))}}.code)
        assertTrue(empty.list().isEmpty())
    }
    @Test fun oversizedStreamIsBoundedAndItsStagingFileIsRemoved(){
        val folder=temp.newFolder();val library=AudioLibrary(folder,Index()){1000};var remaining=AudioLibrary.MAX_BYTES+1
        val source=object:InputStream(){override fun read():Int=if(remaining-- >0)1 else -1
            override fun read(buffer:ByteArray,offset:Int,length:Int):Int{if(remaining<=0)return -1;val n=minOf(length.toLong(),remaining).toInt();java.util.Arrays.fill(buffer,offset,offset+n,1.toByte());remaining-=n;return n}}
        assertEquals("AUDIO_TOO_LARGE",assertThrows(AudioFailure::class.java){library.importAudio("large"){source}}.code)
        assertTrue(folder.list()!!.isEmpty());assertTrue(library.list().isEmpty())
    }
    @Test fun failedAndUncertainIndexWritesKeepBothPossibleGenerationsUsable(){
        val folder=temp.newFolder();val index=Index();val library=AudioLibrary(folder,index){1000}
        val before=library.importAudio("old"){ByteArrayInputStream(byteArrayOf(1))};index.reject=true
        assertThrows(AudioFailure::class.java){library.importAudio("new"){ByteArrayInputStream(byteArrayOf(2))}}
        assertEquals(listOf(before),library.list());assertTrue(library.playable(before.id).isFile)
        index.reject=false;index.uncertain=true
        assertThrows(AudioFailure::class.java){library.importAudio("new"){ByteArrayInputStream(byteArrayOf(2))}}
        index.uncertain=false;assertEquals(2,library.list().size)
        for(item in library.list())assertTrue(library.playable(item.id).isFile)
    }
    @Test fun failedDeleteRetainsIndexAndOriginalThenSuccessfulDeleteLeavesOtherContentAlone(){
        val (library,index)=fixture();val a=library.importAudio("a"){ByteArrayInputStream(byteArrayOf(1))};val b=library.importAudio("b"){ByteArrayInputStream(byteArrayOf(2))}
        val path=library.playable(a.id);index.reject=true;assertThrows(AudioFailure::class.java){library.remove(a.id)}
        assertTrue(path.isFile);assertEquals(listOf(a,b),library.list())
        index.reject=false;library.remove(a.id);assertFalse(path.exists());assertEquals(listOf(b),library.list());assertTrue(library.playable(b.id).isFile)
    }
    @Test fun corruptIndexMissingContentAndSameLengthTamperingCannotBecomeAnEmptyLibrary(){
        val (library,index)=fixture();val item=library.importAudio("bird"){ByteArrayInputStream(byteArrayOf(1,2))};val original=index.wire!!
        index.wire=JSONObject(original).put("sha256","0".repeat(64)).toString()
        val invalid=index.wire;assertThrows(AudioFailure::class.java){library.list()};assertEquals(invalid,index.wire)
        index.wire=original;val file=library.playable(item.id);file.writeBytes(byteArrayOf(9,9))
        assertEquals("AUDIO_CONTENT_INVALID",assertThrows(AudioFailure::class.java){library.playable(item.id)}.code)
        file.delete();assertEquals("AUDIO_CONTENT_MISSING",assertThrows(AudioFailure::class.java){library.list()}.code)
        assertEquals(original,index.wire)
    }
    @Test fun failedProviderReadCleansOnlyItsOwnStagingAndRejectsPathLikeIdentifiers(){
        val folder=temp.newFolder();val library=AudioLibrary(folder,Index()){1000}
        assertThrows(AudioFailure::class.java){library.importAudio("bad"){object:InputStream(){override fun read():Int=throw IOException("provider closed")}}}
        assertTrue(folder.list()!!.isEmpty());assertEquals("AUDIO_INVALID_ID",assertThrows(AudioFailure::class.java){library.remove("../outside")}.code)
    }
    @Test fun randomRestAndFadePoliciesAndExplicitPauseSurviveFocusRegain(){
        assertEquals(12000,AmbientPlaybackTiming.gapMs(0.0));assertEquals(30000,AmbientPlaybackTiming.gapMs(1.0));assertEquals(21000,AmbientPlaybackTiming.gapMs(Double.NaN))
        assertEquals(0f,AmbientPlaybackTiming.fadeGain(0,10000),0f);assertEquals(1f,AmbientPlaybackTiming.fadeGain(5000,10000),0f);assertEquals(0f,AmbientPlaybackTiming.fadeGain(10000,10000),0f)
        val control=AmbientPlaybackControl();control.focus(true);assertTrue(control.allowed());control.pause();control.focus(true);assertFalse(control.allowed());control.play();assertTrue(control.allowed())
        val light=AmbientRainMix.gains(.05);val hard=AmbientRainMix.gains(.95);assertTrue(light[0]>light[1]);assertTrue(hard[1]>hard[0])
        val mix=AmbientRainMix();mix.set(true,.95);val entered=mix.step(30000.0);mix.set(false,0.0);val left=mix.step(30000.0)
        assertTrue(entered[1]>.1);assertTrue(left.all{it<.0001})
    }
}
