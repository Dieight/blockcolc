package com.blockcolc.preview

import com.blockcolc.domain.StrictJson
import com.blockcolc.storage.BackupCodec
import com.blockcolc.storage.ParsedBackup
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.nio.charset.CodingErrorAction
import java.security.DigestInputStream
import java.security.MessageDigest

/** Private pending original; no archive-sized byte array survives the picker.
 * The caller owns the input stream and explicitly discards this file when its
 * preview is cancelled or its original has been retained successfully. */
internal class NativeBackupImportFile private constructor(val file:File,val bytes:Long,val sha256:String){
    fun read():ParsedBackup {
        check(file.length()==bytes){"导入暂存文件已改变"}
        val digest=MessageDigest.getInstance("SHA-256")
        val decoder=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        val text=DigestInputStream(file.inputStream(),digest).use{input->java.io.InputStreamReader(input,decoder).buffered().use{it.readText()}}
        check(hex(digest.digest())==sha256){"导入暂存文件已改变"}
        return BackupCodec.read(text)
    }
    /** The destination's atomic writer retains ownership of its stream. */
    fun copyTo(output:OutputStream){
        val digest=MessageDigest.getInstance("SHA-256");var count=0L
        file.inputStream().use{input->val buffer=ByteArray(65536);while(true){val n=input.read(buffer);if(n<0)break
            count+=n;check(count<=bytes){"导入暂存文件已改变"};digest.update(buffer,0,n);output.write(buffer,0,n)}}
        check(count==bytes&&hex(digest.digest())==sha256){"导入暂存文件已改变"}
    }
    fun matches(original:File):Boolean {
        if(!original.isFile||original.length()!=bytes)return false
        val digest=MessageDigest.getInstance("SHA-256")
        original.inputStream().use{input->val buffer=ByteArray(65536);while(true){val n=input.read(buffer);if(n<0)break;digest.update(buffer,0,n)}}
        return hex(digest.digest())==sha256
    }
    fun discard(){check(!file.exists()||file.delete()){"导入暂存文件未清理"}}
    companion object {
        private fun hex(bytes:ByteArray)=bytes.joinToString(""){"%02x".format(it.toInt()and 255)}
        fun capture(directory:File,input:InputStream,limit:Long=StrictJson.FILE_LIMIT.toLong()):NativeBackupImportFile {
            require(limit in 1..StrictJson.FILE_LIMIT.toLong())
            check(directory.isDirectory||directory.mkdirs()){"导入暂存目录不可用"}
            val file=File.createTempFile("backup-",".pending",directory)
            try{
                val digest=MessageDigest.getInstance("SHA-256");var count=0L
                FileOutputStream(file).use{output->val buffer=ByteArray(65536);while(true){val n=input.read(buffer);if(n<0)break
                    count+=n;require(count<=limit){"备份超过 100 MiB"};digest.update(buffer,0,n);output.write(buffer,0,n)};output.fd.sync()}
                return NativeBackupImportFile(file,count,hex(digest.digest()))
            }catch(error:Throwable){if(file.exists()&&!file.delete())error.addSuppressed(java.io.IOException("Import staging cleanup failed"));throw error}
        }
    }
}
