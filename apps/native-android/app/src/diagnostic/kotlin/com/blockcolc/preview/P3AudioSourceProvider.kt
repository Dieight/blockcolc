package com.blockcolc.preview

import android.content.ContentProvider
import android.content.ContentValues
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Private debug provider: exercises the real content resolver and media
 * metadata/decoder. It exposes no user file or arbitrary filesystem path. */
class P3AudioSourceProvider:ContentProvider(){
    override fun onCreate()=true
    private fun fixture(uri:Uri):File? {
        val parts=uri.pathSegments
        if(parts.size!=3||parts[0] !in setOf("format","pipe","broken","denied","missing")||!parts[1].matches(Regex("[a-f0-9]{32}"))||parts[2] !in setOf("pcm","mp3","aac","flac","vorbis","opus","empty","invalid"))return null
        return File(File(context!!.cacheDir,"p3-audio-formats-${parts[1]}"),parts[2])
    }
    override fun getType(uri:Uri)=if(fixture(uri)!=null)"application/octet-stream"else if(uri.path=="/short")"audio/wav"else"audio/ogg"
    override fun query(uri:Uri,projection:Array<out String>?,selection:String?,args:Array<out String>?,sort:String?):Cursor {
        val columns=projection?:arrayOf(OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE)
        val file=fixture(uri)
        return MatrixCursor(columns).apply{addRow(columns.map{when(it){
            OpenableColumns.DISPLAY_NAME->if(file!=null)"P3 ${uri.lastPathSegment}.bin"else if(uri.path=="/short")"P3 gap.wav"else"P3 bird.ogg"
            OpenableColumns.SIZE->file?.takeIf{uri.pathSegments[0]=="format"&&it.isFile}?.length()
            else->null
        }})}
    }
    override fun openAssetFile(uri:Uri,mode:String):AssetFileDescriptor {
        if(mode!="r")throw FileNotFoundException()
        fixture(uri)?.let{file->
            if(uri.pathSegments[0]=="denied")throw SecurityException("P3 provider access denied")
            if(uri.pathSegments[0]=="missing"||!file.isFile)throw FileNotFoundException("P3 fixture unavailable")
            if(uri.pathSegments[0] in setOf("pipe","broken")){
                val pipe=ParcelFileDescriptor.createReliablePipe()
                Thread({
                    try{ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]).use{output->
                        file.inputStream().use{input->
                            if(uri.pathSegments[0]=="broken"){
                                val bytes=ByteArray(128);val size=input.read(bytes);if(size>0)output.write(bytes,0,size)
                                pipe[1].closeWithError("P3 provider interrupted")
                            }else input.copyTo(output,4096)
                        }
                    }}catch(_:java.io.IOException){runCatching{pipe[1].closeWithError("P3 provider closed")}}
                },"p3-audio-provider").start()
                return AssetFileDescriptor(pipe[0],0,AssetFileDescriptor.UNKNOWN_LENGTH)
            }
            return AssetFileDescriptor(ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY),0,file.length())
        }
        if(uri.path=="/bird")return context!!.assets.openFd("public/audio/forest-birds.ogg")
        if(uri.path!="/short")throw FileNotFoundException()
        val samples=16000;val bytes=samples*2
        val pcm=ByteBuffer.allocate(44+bytes).order(ByteOrder.LITTLE_ENDIAN)
        pcm.put("RIFF".toByteArray()).putInt(36+bytes).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1)
            .putInt(8000).putInt(16000).putShort(2).putShort(16).put("data".toByteArray()).putInt(bytes)
        val file=File(context!!.cacheDir,"p3-audio-gap.wav");file.writeBytes(pcm.array())
        return AssetFileDescriptor(ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY),0,file.length())
    }
    override fun insert(uri:Uri,values:ContentValues?):Uri?=throw UnsupportedOperationException()
    override fun delete(uri:Uri,selection:String?,args:Array<out String>?)=throw UnsupportedOperationException()
    override fun update(uri:Uri,values:ContentValues?,selection:String?,args:Array<out String>?)=throw UnsupportedOperationException()
}
