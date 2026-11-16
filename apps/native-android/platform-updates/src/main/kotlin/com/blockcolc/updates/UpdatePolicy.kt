package com.blockcolc.updates

import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

enum class UpdateProblem { CHECK, DESCRIPTOR, CHANNEL, NOT_NEWER, STORAGE, TRANSFER, INTEGRITY, IDENTITY, SIGNATURE, PERMISSION, INSTALLER, CANCELLED }
class UpdateFailure(val problem:UpdateProblem):java.io.IOException(problem.name)
data class UpdateAsset(val version:String,val url:String,val size:Long,val sha256:String)
data class AppRelease(val version:String,val url:String,val asset:UpdateAsset?)
enum class UpdateChannel { STANDARD, PRIVATE, PREVIEW }
data class AppIdentity(val packageName:String,val version:String,val code:Long,val signers:List<String>,val privateBuild:Boolean=false)

/** Same public stable source and asset contract as app-update.ts / AppUpdatePolicy.
 * An independent gate prevents a preview or private installation from fetching
 * the public APK even when a caller bypasses the About UI. */
object UpdatePolicy {
    const val REPOSITORY="https://github.com/Dieight/blockcolc"
    const val API="https://api.github.com/repos/Dieight/blockcolc/releases/latest"
    const val MAX_BYTES=100L*1024*1024
    private val version=Regex("(?:0|[1-9][0-9]{0,5})\\.(?:0|[1-9][0-9]{0,5})\\.(?:0|[1-9][0-9]{0,5})")
    fun isVersion(value:String)=version.matches(value)
    fun compare(a:String,b:String):Int {
        if(!isVersion(a)||!isVersion(b))throw UpdateFailure(UpdateProblem.DESCRIPTOR)
        a.split('.').map(String::toInt).zip(b.split('.').map(String::toInt)).forEach{(x,y)->if(x!=y)return x.compareTo(y)}
        return 0
    }
    fun channel(installed:AppIdentity)=when {installed.privateBuild->UpdateChannel.PRIVATE;installed.packageName!="com.blockcolc.app"->UpdateChannel.PREVIEW;else->UpdateChannel.STANDARD}
    fun requireDownload(installed:AppIdentity){if(channel(installed)!=UpdateChannel.STANDARD)throw UpdateFailure(UpdateProblem.CHANNEL)}
    fun validate(asset:UpdateAsset){
        if(!isVersion(asset.version)||asset.size !in 1..MAX_BYTES||!Regex("[a-fA-F0-9]{64}").matches(asset.sha256))throw UpdateFailure(UpdateProblem.DESCRIPTOR)
        val suffix="/Blockcolc-v${asset.version}.apk"
        if(asset.url!="$REPOSITORY/releases/download/v${asset.version}$suffix"&&asset.url!="$REPOSITORY/releases/download/${asset.version}$suffix")throw UpdateFailure(UpdateProblem.DESCRIPTOR)
    }
    fun release(body:String):AppRelease {
        try {
            require(body.toByteArray(Charsets.UTF_8).size<=1024*1024)
            val json=JSONObject(body);val tag=json.getString("tag_name");val v=tag.removePrefix("v")
            require(isVersion(v)&&json.opt("draft")==false&&json.opt("prerelease")==false)
            val assets=json.optJSONArray("assets")
            val matching=if(assets==null)emptyList()else(0 until assets.length()).mapNotNull{assets.optJSONObject(it)}.filter{it.opt("name")=="Blockcolc-v$v.apk"}
            val asset=matching.singleOrNull()?.let{a->
                val size=a.opt("size") as? Number;val digest=a.opt("digest") as? String
                if(a.opt("state")!="uploaded"||size==null||size.toDouble()!=size.toLong().toDouble()||digest==null||!Regex("sha256:[a-fA-F0-9]{64}").matches(digest))null
                else UpdateAsset(v,a.optString("browser_download_url"),size.toLong(),digest.substring(7).lowercase()).takeIf{runCatching{validate(it)}.isSuccess}
            }
            return AppRelease(v,"$REPOSITORY/releases/tag/$tag",asset)
        }catch(e:Exception){throw UpdateFailure(UpdateProblem.CHECK)}
    }
    fun identity(candidate:AppIdentity,installed:AppIdentity,expected:UpdateAsset){
        requireDownload(installed);validate(expected)
        if(candidate.packageName!=installed.packageName||candidate.version!=expected.version||candidate.code<=installed.code||candidate.privateBuild
            ||(isVersion(installed.version)&&compare(candidate.version,installed.version)<=0))throw UpdateFailure(UpdateProblem.IDENTITY)
        if(candidate.signers.isEmpty()||installed.signers.isEmpty()||candidate.signers.sorted()!=installed.signers.sorted())throw UpdateFailure(UpdateProblem.SIGNATURE)
    }
    fun verifyFile(file:File,asset:UpdateAsset){
        validate(asset)
        if(!file.isFile||file.length()!=asset.size)throw UpdateFailure(UpdateProblem.INTEGRITY)
        val sha=MessageDigest.getInstance("SHA-256")
        file.inputStream().use{input->val buffer=ByteArray(65536);var count=0L
            while(true){val n=input.read(buffer);if(n<0)break;count+=n;if(count>asset.size)throw UpdateFailure(UpdateProblem.INTEGRITY);sha.update(buffer,0,n)}
            if(count!=asset.size)throw UpdateFailure(UpdateProblem.INTEGRITY)}
        if(hex(sha.digest())!=asset.sha256.lowercase())throw UpdateFailure(UpdateProblem.INTEGRITY)
    }
    fun hex(bytes:ByteArray)=bytes.joinToString(""){"%02x".format(it.toInt() and 255)}
}
