package com.blockcolc.preview

import android.content.Context
import android.util.AtomicFile
import com.blockcolc.domain.StrictJson
import com.blockcolc.presentation.PreferencesStorage
import java.io.ByteArrayOutputStream
import java.io.File

/** App-private and independent of domain replacement/test DB pointers. Only
 * the IO actor calls this. A malformed original is preserved before repair. */
internal class AndroidPreferencesStorage(context:Context,private val directory:File=context.filesDir):PreferencesStorage {
    private val file=AtomicFile(File(directory,"client-preferences.json"))
    private var readFailed=false
    override fun read():String? {
        if(!file.baseFile.exists()&&!File(file.baseFile.path+".bak").exists())return null
        readFailed=true
        val result=file.openRead().use{input->
            val out=ByteArrayOutputStream();val buffer=ByteArray(4096)
            while(true){val n=input.read(buffer);if(n<0)break;require(out.size()+n<=1024*1024){"Preferences exceed local budget"};out.write(buffer,0,n)}
            val bytes=out.toByteArray()
            StrictJson.decode(bytes,1024*1024).also{StrictJson.parse(it,1024*1024)}
        }
        readFailed=false
        return result
    }
    override fun write(canonical:String) {
        require(canonical.toByteArray(Charsets.UTF_8).size<=1024*1024)
        StrictJson.parse(canonical,1024*1024)
        if(readFailed)preserveOriginal()
        write(file,canonical.toByteArray(Charsets.UTF_8));readFailed=false
    }
    private fun preserveOriginal(){
        val originals=File(directory,"preferences-originals");check(originals.isDirectory||originals.mkdirs())
        // Stream the original, including oversized or invalid UTF-8 files. If
        // recovery cannot be preserved, never overwrite it with the defaults.
        val temporary=File.createTempFile("preserve-",".tmp",originals)
        try{
            val digest=java.security.MessageDigest.getInstance("SHA-256")
            file.openRead().use{input->temporary.outputStream().use{out->
                val buffer=ByteArray(8192)
                while(true){val n=input.read(buffer);if(n<0)break;digest.update(buffer,0,n);out.write(buffer,0,n)}
                out.fd.sync()
            }}
            val hash=digest.digest().joinToString(""){"%02x".format(it.toInt() and 255)}
            val original=File(originals,"$hash.json")
            if(original.exists()){
                val archived=java.security.MessageDigest.getInstance("SHA-256")
                original.inputStream().use{input->val buffer=ByteArray(8192);while(true){val n=input.read(buffer);if(n<0)break;archived.update(buffer,0,n)}}
                val actual=archived.digest().joinToString(""){"%02x".format(it.toInt() and 255)}
                check(actual==hash){"Preserved preference original is damaged"}
            }else check(temporary.renameTo(original)){"Cannot preserve original preferences"}
        }finally{if(temporary.exists())check(temporary.delete())}
    }
    private fun write(target:AtomicFile,bytes:ByteArray){
        val stream=target.startWrite()
        // AtomicFile.finishWrite logs some sync/rename failures instead of
        // throwing. Sync explicitly, then verify the actual adopted bytes.
        try{stream.write(bytes);stream.fd.sync();target.finishWrite(stream)}catch(error:Exception){target.failWrite(stream);throw error}
        target.openRead().use{input->
            var offset=0;val buffer=ByteArray(4096)
            while(true){
                val n=input.read(buffer);if(n<0)break
                check(n<=bytes.size-offset){"Preference commit has an unexpected length"}
                repeat(n){check(buffer[it]==bytes[offset+it]){"Preference commit could not be verified"}}
                offset+=n
            }
            check(offset==bytes.size){"Preference commit was truncated"}
        }
    }
}
