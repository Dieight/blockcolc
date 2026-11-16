package com.blockcolc.preview

import com.blockcolc.domain.DomainEngine
import com.blockcolc.storage.BackupCodec
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class NativeBackupImportFileTest {
    @get:Rule val temporary=TemporaryFolder()
    private fun archive()=BackupCodec.write(DomainEngine.initial("UTC"),"2026-11-02T00:00:00.000Z").toByteArray()
    @Test fun originalBytesRoundTripWithoutRetainingAnArchiveArray(){
        val bytes=archive();val capture=NativeBackupImportFile.capture(temporary.newFolder(),bytes.inputStream())
        assertEquals(bytes.size.toLong(),capture.bytes)
        assertEquals(BackupCodec.read(bytes).domain,capture.read().domain)
        val retained=temporary.newFile();retained.outputStream().use(capture::copyTo)
        assertTrue(capture.matches(retained));assertArrayEquals(bytes,retained.readBytes())
        capture.discard();capture.discard();assertFalse(capture.file.exists());assertTrue(retained.isFile)
    }
    @Test fun changedBytesAndLengthCannotBeAdoptedOrRetained(){
        val capture=NativeBackupImportFile.capture(temporary.newFolder(),archive().inputStream())
        val bytes=capture.file.readBytes();bytes[0]=' '.code.toByte();capture.file.writeBytes(bytes)
        assertThrows(IllegalStateException::class.java){capture.read()}
        assertThrows(IllegalStateException::class.java){capture.copyTo(java.io.ByteArrayOutputStream())}
        assertFalse(capture.matches(capture.file))
        capture.file.appendText(" ");assertThrows(IllegalStateException::class.java){capture.read()}
    }
    @Test fun malformedUtf8DoesNotBecomeReplacementCharacters(){
        val capture=NativeBackupImportFile.capture(temporary.newFolder(),byteArrayOf(0xc3.toByte(),0x28).inputStream())
        assertThrows(java.nio.charset.MalformedInputException::class.java){capture.read()}
    }
    @Test fun streamingLimitAndReadFailureRemoveOnlyTheirOwnedTemporary(){
        val folder=temporary.newFolder();val other=File(folder,"keep.json").apply{writeText("original")}
        assertThrows(IllegalArgumentException::class.java){NativeBackupImportFile.capture(folder,ByteArray(9).inputStream(),8)}
        val broken=object:java.io.InputStream(){var reads=0;override fun read():Int=throw java.io.IOException("provider lost")
            override fun read(buffer:ByteArray,offset:Int,length:Int):Int{if(reads++>0)throw java.io.IOException("provider lost");buffer[offset]=123;return 1}}
        assertThrows(java.io.IOException::class.java){NativeBackupImportFile.capture(folder,broken)}
        assertEquals(listOf(other.name),folder.list()!!.toList());assertEquals("original",other.readText())
    }
    @Test fun wrongOriginalDigestIsDetectedEvenAtTheSameLength(){
        val capture=NativeBackupImportFile.capture(temporary.newFolder(),archive().inputStream())
        val original=temporary.newFile();original.writeBytes(archive().also{it[0]=' '.code.toByte()})
        assertFalse(capture.matches(original));original.appendText(" ");assertFalse(capture.matches(original))
    }
}
