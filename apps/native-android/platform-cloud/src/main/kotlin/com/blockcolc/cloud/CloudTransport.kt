package com.blockcolc.cloud

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.net.Proxy
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.security.KeyStore
import java.security.cert.CertificateFactory
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory

class CloudFailure(val code:String,val details:JSONObject?=null):Exception(code)
data class CloudSession(val token:String,val account:String,val username:String,val device:String)

/** Only this client's HTTPS connection trusts the deployment CA. Weather,
 * updates and other apps retain the platform trust store and hostname check. */
class CloudTransport(context:Context,private val base:String="https://107.150.98.105:8443",private val proxy:Proxy?=null,
    private val totalTimeoutMillis:Long=120000) {
    init {require(totalTimeoutMillis in 1000..600000)}
    private val ssl by lazy {
        val ca=context.assets.open("blockcolc-cloud-ca.pem").use{CertificateFactory.getInstance("X.509").generateCertificate(it)}
        val roots=KeyStore.getInstance(KeyStore.getDefaultType()).apply{load(null);setCertificateEntry("blockcolc-cloud",ca)}
        val trust=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply{init(roots)}
        SSLContext.getInstance("TLS").apply{init(null,trust.trustManagers,null)}.socketFactory
    }
    fun request(path:String,method:String="GET",token:String?=null,body:String?=null,timeoutMillis:Long=totalTimeoutMillis):JSONObject =
        JSONObject(text(path,method,token,body,timeoutMillis))
    fun text(path:String,method:String="GET",token:String?=null,body:String?=null,timeoutMillis:Long=totalTimeoutMillis):String {
        require(path.startsWith("/v1/")||path=="/healthz")
        require(timeoutMillis in 1000..600000)
        val budget=minOf(timeoutMillis,totalTimeoutMillis)
        val connection=(if(proxy==null)URL(base+path).openConnection()else URL(base+path).openConnection(proxy)) as HttpsURLConnection
        connection.setRequestProperty("X-Blockcolc-Focus-Credits", "1")
        connection.sslSocketFactory=ssl;connection.connectTimeout=minOf(15000L,budget).toInt();connection.readTimeout=minOf(90000L,budget).toInt()
        connection.instanceFollowRedirects=false;connection.requestMethod=method
        connection.setRequestProperty("Accept","application/json");token?.let{connection.setRequestProperty("Authorization","Bearer $it")}
        val expired=AtomicBoolean(false)
        // readTimeout only limits one stalled read, not a slow stream or a
        // blocked request-body write. A complete operation also has a deadline.
        val deadline=deadlines.schedule({expired.set(true);connection.disconnect()},budget,TimeUnit.MILLISECONDS)
        try {
            if(body!=null){connection.doOutput=true;connection.setRequestProperty("Content-Type","application/json; charset=utf-8")
                // No second 100 MiB UTF-8 byte array retained next to the wire.
                connection.setChunkedStreamingMode(65536);connection.outputStream.writer(Charsets.UTF_8).use{it.write(body)}}
            val status=connection.responseCode
            val input=if(status in 200..299)connection.inputStream else connection.errorStream
            val result=input?.bufferedReader(Charsets.UTF_8)?.use{reader->
                val out=StringBuilder();val buffer=CharArray(32768);var n=reader.read(buffer)
                while(n>=0){require(out.length.toLong()+n<=110L*1024*1024){"CLOUD_RESPONSE_TOO_LARGE"};out.append(buffer,0,n);n=reader.read(buffer)};out.toString()
            }.orEmpty()
            if(status !in 200..299){val error=runCatching{JSONObject(result)}.getOrNull();throw CloudFailure(error?.optString("error")?.takeIf{it.isNotEmpty()}?:"HTTP_$status",error?.optJSONObject("details"))}
            if(expired.get())throw CloudFailure("REQUEST_TIMEOUT")
            return result
        }catch(error:Exception){if(expired.get())throw CloudFailure("REQUEST_TIMEOUT")else throw error}
        finally{deadline.cancel(false);connection.disconnect()}
    }
    companion object {
        private val deadlines=ScheduledThreadPoolExecutor(1){work->Thread(work,"blockcolc-cloud-deadlines").apply{isDaemon=true}}.apply{removeOnCancelPolicy=true}
    }
}

/** Tokens never enter ordinary Android backup, preferences sync or logs. */
class CloudSessionStorage(context:Context,directory:File=context.noBackupFilesDir){
    private val file=AtomicFile(File(directory,"cloud-session.enc"))
    private val alias="blockcolc-cloud-session-v1"
    private fun key():SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        (store.getKey(alias,null) as? SecretKey)?.let{return it}
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{
            init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun read():CloudSession? {
        if(!file.baseFile.exists()&&!File(file.baseFile.path+".bak").exists())return null
        try{val x=JSONObject(file.openRead().bufferedReader().use{it.readText()})
            val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,Base64.decode(x.getString("iv"),Base64.NO_WRAP)))}
            val clear=JSONObject(String(cipher.doFinal(Base64.decode(x.getString("data"),Base64.NO_WRAP)),Charsets.UTF_8))
            return CloudSession(clear.getString("token"),clear.getString("account"),clear.getString("username"),clear.getString("device"))
        }catch(error:Exception){throw CloudFailure("LOCAL_CREDENTIALS_UNAVAILABLE")}
    }
    fun write(session:CloudSession?) {
        if(session==null){file.delete();return}
        val clear=JSONObject().put("token",session.token).put("account",session.account).put("username",session.username).put("device",session.device).toString()
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.ENCRYPT_MODE,key())}
        val wire=JSONObject().put("iv",Base64.encodeToString(cipher.iv,Base64.NO_WRAP)).put("data",Base64.encodeToString(cipher.doFinal(clear.toByteArray(Charsets.UTF_8)),Base64.NO_WRAP)).toString()
        val stream=file.startWrite();try{stream.write(wire.toByteArray(Charsets.UTF_8));file.finishWrite(stream)}catch(error:Exception){file.failWrite(stream);throw error}
        check(read()==session){"LOCAL_CREDENTIALS_UNAVAILABLE"}
    }
}
