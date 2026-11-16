package com.blockcolc.preview.resources

import android.util.AtomicFile
import com.blockcolc.domain.StrictJson
import com.blockcolc.world.resource.ResourceLibraryIndex
import com.blockcolc.world.resource.ResourcePackLibrary
import java.io.ByteArrayOutputStream
import java.io.File

/** IO-actor storage. Invalid originals are reported to the library and never
 * treated as an empty index; no preference or business database is touched. */
internal class AndroidResourceLibraryIndex(private val directory:File):ResourceLibraryIndex{
    private val file=AtomicFile(File(directory,"index.json"))
    override fun read():String?{
        if(!file.baseFile.exists()&&!File(file.baseFile.path+".bak").exists())return null
        return file.openRead().use{input->val output=ByteArrayOutputStream();val buffer=ByteArray(4096)
            while(true){val n=input.read(buffer);if(n<0)break;check(n>0&&output.size()+n<=ResourcePackLibrary.MAX_INDEX_BYTES){"Resource index exceeds read budget"};output.write(buffer,0,n)}
            StrictJson.decode(output.toByteArray(),ResourcePackLibrary.MAX_INDEX_BYTES)}
    }
    override fun write(canonical:String){
        val bytes=canonical.toByteArray(Charsets.UTF_8);require(bytes.size<=ResourcePackLibrary.MAX_INDEX_BYTES)
        StrictJson.parse(canonical,ResourcePackLibrary.MAX_INDEX_BYTES)
        check(directory.isDirectory||directory.mkdirs())
        val stream=file.startWrite()
        try{stream.write(bytes);stream.fd.sync();file.finishWrite(stream)}catch(error:Exception){file.failWrite(stream);throw error}
        // AtomicFile may only log sync/rename errors. Check the adopted bytes.
        file.openRead().use{input->val buffer=ByteArray(4096);var offset=0
            while(true){val n=input.read(buffer);if(n<0)break;check(n>0&&n<=bytes.size-offset)
                repeat(n){check(buffer[it]==bytes[offset+it])};offset+=n};check(offset==bytes.size)}
    }
}
