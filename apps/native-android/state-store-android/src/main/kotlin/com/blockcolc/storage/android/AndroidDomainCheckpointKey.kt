package com.blockcolc.storage.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** The Android key wraps only 32 random bytes. The domain-file MAC never
 * sends a multi-megabyte message through the system keystore service. */
class AndroidDomainCheckpointKey(context:Context,scope:String="domain-read-cache-v1") {
    init{require(scope.matches(Regex("[a-z0-9-]{1,80}")))}
    private val alias="${context.packageName}.$scope.wrap.v1"
    private val file=AtomicFile(File(context.noBackupFilesDir,"$scope-key.bin"))
    private val aad="blockcolc-domain-checkpoint-key-v1:${android.os.Build.FINGERPRINT}".toByteArray(Charsets.UTF_8)
    private var retained:SecretKey?=null
    fun hasWrappedKey():Boolean=file.baseFile.isFile
    @Synchronized fun read():SecretKey? {
      retained?.let{return it}
      return try{
        val wrapped=DataInputStream(file.openRead()).use{input->
            require(input.readInt()==0x4243444b)
            val ivSize=input.readInt();require(ivSize in 12..16)
            val iv=ByteArray(ivSize).also(input::readFully)
            val size=input.readInt();require(size==48)
            val ciphertext=ByteArray(size).also(input::readFully);require(input.read()==-1)
            iv to ciphertext
        }
        val wrapping=wrapping(false)?:return null
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.DECRYPT_MODE,wrapping,GCMParameterSpec(128,wrapped.first));updateAAD(aad)}
        val secret=cipher.doFinal(wrapped.second)
        try{require(secret.size==32);SecretKeySpec(secret,"HmacSHA256").also{retained=it}}finally{secret.fill(0)}
      }catch(_:Exception){null}
    }
    @Synchronized fun create():SecretKey {
        read()?.let{return it}
        val secret=ByteArray(32).also{SecureRandom().nextBytes(it)}
        try{
            val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.ENCRYPT_MODE,checkNotNull(wrapping(true)));updateAAD(aad)}
            val ciphertext=cipher.doFinal(secret);val stream=file.startWrite()
            try{
                val output=DataOutputStream(stream);output.writeInt(0x4243444b);output.writeInt(cipher.iv.size);output.write(cipher.iv);output.writeInt(ciphertext.size);output.write(ciphertext);output.flush()
                file.finishWrite(stream)
            }catch(error:Exception){file.failWrite(stream);throw error}
            return SecretKeySpec(secret,"HmacSHA256").also{retained=it}
        }finally{secret.fill(0)}
    }
    private fun wrapping(create:Boolean):SecretKey? {
        val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        (store.getKey(alias,null) as? SecretKey)?.let{return it}
        if(!create)return null
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{
            init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
}
