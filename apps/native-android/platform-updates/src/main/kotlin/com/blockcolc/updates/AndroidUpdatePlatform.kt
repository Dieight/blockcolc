package com.blockcolc.updates

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.AtomicFile
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import javax.net.ssl.HttpsURLConnection

/** No credentials, app data or writable domain state crosses these ports. */
class PublicReleaseSource:ReleaseSource {
    override fun latest(cancel:UpdateCancellation):AppRelease {
        cancel.check()
        val connection=URL(UpdatePolicy.API).openConnection() as HttpsURLConnection
        cancel.connection(connection::disconnect)
        // Read timeout is per socket read. A total deadline also covers a
        // slow trickle of bytes and time spent waiting for response headers.
        val timeout=deadlines.schedule({connection.disconnect()},12,java.util.concurrent.TimeUnit.SECONDS)
        try{
            connection.connectTimeout=12_000;connection.readTimeout=12_000;connection.instanceFollowRedirects=false
            connection.setRequestProperty("Accept","application/vnd.github+json")
            connection.setRequestProperty("User-Agent","Blockcolc-Android")
            if(connection.responseCode!=200)throw UpdateFailure(UpdateProblem.CHECK)
            if((connection.getHeaderField("Content-Length")?.toLongOrNull()?:0)>1024*1024)throw UpdateFailure(UpdateProblem.CHECK)
            val bytes=connection.inputStream.use{input->val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
                while(true){cancel.check();val n=input.read(buffer);if(n<0)break;if(out.size()+n>1024*1024)throw UpdateFailure(UpdateProblem.CHECK);out.write(buffer,0,n)};out.toByteArray()}
            cancel.check()
            val body=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
            return UpdatePolicy.release(body)
        }finally{timeout.cancel(false);cancel.connection(null);connection.disconnect()}
    }
    companion object {
        private val deadlines=java.util.concurrent.ScheduledThreadPoolExecutor(1){r->Thread(r,"blockcolc-update-deadline").apply{isDaemon=true}}.apply{removeOnCancelPolicy=true}
    }
}

class AndroidUpdateJobStore(private val file:File):UpdateJobStore {
    private fun asset(json:JSONObject)=UpdateAsset(json.getString("version"),json.getString("url"),json.getLong("size"),json.getString("sha256"))
    override fun read():DownloadRecord? {
        val atomic=AtomicFile(file)
        if(!atomic.baseFile.exists()&&!File(file.path+".bak").exists())return null
        try{
            val bytes=atomic.openRead().use{input->val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(1024)
                while(true){val n=input.read(buffer);if(n<0)break;if(out.size()+n>8192)throw UpdateFailure(UpdateProblem.STORAGE);out.write(buffer,0,n)};out.toByteArray()}
            val root=JSONObject(String(bytes,Charsets.UTF_8));check(root.getInt("schema")==1)
            if(root.isNull("job"))return null
            val job=root.getJSONObject("job")
            return DownloadRecord(job.getLong("id"),job.getString("token"),asset(job.getJSONObject("asset")),if(job.isNull("failure"))null else UpdateProblem.valueOf(job.getString("failure")))
        }catch(e:Exception){throw UpdateFailure(UpdateProblem.STORAGE)}
    }
    override fun write(record:DownloadRecord?){
        val root=JSONObject().put("schema",1).put("job",record?.let{r->
            JSONObject().put("id",r.id).put("token",r.token).put("failure",r.failure?.name?:JSONObject.NULL).put("asset",JSONObject()
                .put("version",r.asset.version).put("url",r.asset.url).put("size",r.asset.size).put("sha256",r.asset.sha256))}?:JSONObject.NULL)
        val bytes=root.toString().toByteArray(Charsets.UTF_8)
        if(file.parentFile?.let{it.isDirectory||it.mkdirs()}!=true)throw UpdateFailure(UpdateProblem.STORAGE)
        val atomic=AtomicFile(file);val out=atomic.startWrite()
        try{out.write(bytes);out.fd.sync();atomic.finishWrite(out)}catch(e:Exception){atomic.failWrite(out);throw UpdateFailure(UpdateProblem.STORAGE)}
        // AtomicFile can log failures without throwing: actual bytes are the receipt.
        if(!atomic.openRead().use{it.readBytes()}.contentEquals(bytes)||read()!=record)throw UpdateFailure(UpdateProblem.STORAGE)
    }
}

internal fun updateFile(context:Context,token:String):File {
    if(!token.matches(Regex("[a-f0-9]{32}")))throw UpdateFailure(UpdateProblem.STORAGE)
    return File(context.getExternalFilesDir("updates")?:throw UpdateFailure(UpdateProblem.STORAGE),"$token.apk")
}

class AndroidUpdateDownloads(private val context:Context,private val language:()->String):UpdateDownloads {
    private fun manager()=context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager?:throw UpdateFailure(UpdateProblem.TRANSFER)
    override fun enqueue(token:String,asset:UpdateAsset):Long {
        UpdatePolicy.validate(asset);updateFile(context,token)
        val request=DownloadManager.Request(Uri.parse(asset.url)).setTitle("blockcolc ${asset.version}")
            .setDescription(if(language()=="en")"Downloading update; installation needs your confirmation" else "正在下载更新；安装仍需你确认")
            .setMimeType("application/vnd.android.package-archive").setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setAllowedOverMetered(true).setAllowedOverRoaming(false).setDestinationInExternalFilesDir(context,"updates","$token.apk")
        return manager().enqueue(request).also{if(it<=0)throw UpdateFailure(UpdateProblem.TRANSFER)}
    }
    override fun query(id:Long):TransferProgress {
        manager().query(DownloadManager.Query().setFilterById(id))?.use{cursor->
            if(!cursor.moveToFirst())return TransferProgress(TransferPhase.FAILED)
            val status=cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            val received=cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)).coerceAtLeast(0)
            val total=cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)).takeIf{it>0}
            val phase=when(status){DownloadManager.STATUS_SUCCESSFUL->TransferPhase.COMPLETE;DownloadManager.STATUS_FAILED->TransferPhase.FAILED;DownloadManager.STATUS_PAUSED->TransferPhase.PAUSED;else->TransferPhase.DOWNLOADING}
            return TransferProgress(phase,received,total)
        }
        throw UpdateFailure(UpdateProblem.TRANSFER)
    }
    override fun remove(id:Long){manager().remove(id)}
}

@Suppress("DEPRECATION")
object AndroidApkIdentity {
    const val PRIVATE_FLAG="com.blockcolc.PRIVATE_RELAY"
    private val flags=PackageManager.GET_META_DATA or if(Build.VERSION.SDK_INT>=28)PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    private fun identity(info:PackageInfo):AppIdentity {
        val signers=if(Build.VERSION.SDK_INT>=28)info.signingInfo?.apkContentsSigners else info.signatures
        return AppIdentity(info.packageName,info.versionName?:"",if(Build.VERSION.SDK_INT>=28)info.longVersionCode else info.versionCode.toLong(),
            signers?.map{UpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(it.toByteArray()))}.orEmpty(),
            info.applicationInfo?.metaData?.getBoolean(PRIVATE_FLAG,false)==true)
    }
    fun installed(context:Context)=identity(context.packageManager.getPackageInfo(context.packageName,flags))
    fun archive(context:Context,file:File)=identity(context.packageManager.getPackageArchiveInfo(file.absolutePath,flags)?:throw UpdateFailure(UpdateProblem.IDENTITY))
}

class AndroidUpdateFiles(private val context:Context):UpdateFiles {
    private data class Verified(val record:DownloadRecord,val modified:Long,val length:Long,val identity:AppIdentity)
    private var verified:Verified?=null
    override fun verify(record:DownloadRecord,force:Boolean):AppIdentity {
        val file=updateFile(context,record.token)
        verified?.takeIf{!force&&it.record==record&&it.modified==file.lastModified()&&it.length==file.length()&&file.isFile}?.let{return it.identity}
        UpdatePolicy.verifyFile(file,record.asset)
        return AndroidApkIdentity.archive(context,file).also{verified=Verified(record,file.lastModified(),file.length(),it)}
    }
    override fun delete(token:String){verified=null;val file=updateFile(context,token);if(file.exists()&&!file.delete())throw UpdateFailure(UpdateProblem.STORAGE)}
}

class AndroidUpdateInstaller(private val context:Context):UpdateInstaller {
    override fun allowed()=Build.VERSION.SDK_INT<26||context.packageManager.canRequestPackageInstalls()
    override fun authorize(){
        if(Build.VERSION.SDK_INT>=26&&!allowed())launch(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${context.packageName}")))
    }
    override fun install(token:String){
        if(!allowed())throw UpdateFailure(UpdateProblem.PERMISSION)
        val uri=FileProvider.getUriForFile(context,"${context.packageName}.updates",updateFile(context,token))
        launch(Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }
    private fun launch(intent:Intent){try{context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))}catch(e:Exception){throw UpdateFailure(UpdateProblem.INSTALLER)}}
}

object AndroidUpdates {
    fun engine(context:Context,currentVersion:String,language:()->String)=UpdateEngine(AndroidApkIdentity.installed(context),currentVersion,
        AndroidUpdateJobStore(File(context.filesDir,"app-update/job.json")),AndroidUpdateDownloads(context,language),AndroidUpdateFiles(context),AndroidUpdateInstaller(context))
}
