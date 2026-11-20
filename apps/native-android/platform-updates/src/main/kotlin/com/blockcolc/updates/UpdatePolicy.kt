package com.blockcolc.updates

import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.security.MessageDigest

enum class UpdateProblem { CHECK, DESCRIPTOR, CHANNEL, NOT_NEWER, STORAGE, TRANSFER, INTEGRITY, IDENTITY, SIGNATURE, PERMISSION, INSTALLER, CANCELLED }
class UpdateFailure(val problem:UpdateProblem):java.io.IOException(problem.name)
data class UpdateAsset(val version:String,val url:String,val size:Long,val sha256:String)
data class AppRelease(val version:String,val url:String,val asset:UpdateAsset?)
enum class UpdateChannel { STANDARD, PRIVATE, PREVIEW }
enum class UpdateFeed { STABLE, BETA }
data class AppIdentity(val packageName:String,val version:String,val code:Long,val signers:List<String>,val privateBuild:Boolean=false)

/** Public releases share a package and signing identity across both feeds.
 * An independent gate prevents a preview or private installation from fetching
 * the public APK even when a caller bypasses the About UI. */
object UpdatePolicy {
    const val REPOSITORY="https://github.com/Dieight/blockcolc"
    const val API="https://api.github.com/repos/Dieight/blockcolc/releases/latest"
    const val BETA_API="https://api.github.com/repos/Dieight/blockcolc/releases?per_page=30"
    const val MAX_BYTES=100L*1024*1024
    private const val number="(0|[1-9][0-9]{0,5})"
    private val version=Regex("$number\\.$number\\.$number(?:-beta\\.([1-9][0-9]{0,5}))?")
    fun isVersion(value:String)=version.matches(value)
    fun isBeta(value:String)=version.matchEntire(value)?.groups?.get(4)!=null
    fun compare(a:String,b:String):Int {
        val left=version.matchEntire(a)?:throw UpdateFailure(UpdateProblem.DESCRIPTOR)
        val right=version.matchEntire(b)?:throw UpdateFailure(UpdateProblem.DESCRIPTOR)
        for(index in 1..3){
            val result=left.groupValues[index].toInt().compareTo(right.groupValues[index].toInt())
            if(result!=0)return result
        }
        return (left.groups[4]?.value?.toInt()?:Int.MAX_VALUE)
            .compareTo(right.groups[4]?.value?.toInt()?:Int.MAX_VALUE)
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
            return parseRelease(JSONObject(body),UpdateFeed.STABLE)?:throw UpdateFailure(UpdateProblem.CHECK)
        }catch(e:Exception){throw UpdateFailure(UpdateProblem.CHECK)}
    }
    fun betaFeed(body:String):AppRelease? {
        try {
            val rows=JSONArray(body)
            return (0 until rows.length()).mapNotNull{index->rows.optJSONObject(index)?.let{parseRelease(it,UpdateFeed.BETA)}}
                .maxWithOrNull{a,b->compare(a.version,b.version)}
        }catch(e:Exception){throw UpdateFailure(UpdateProblem.CHECK)}
    }
    private fun parseRelease(json:JSONObject,feed:UpdateFeed):AppRelease? {
            val tag=json.opt("tag_name") as? String?:return null
            val v=tag.removePrefix("v")
            if(!isVersion(v)||json.opt("draft")!=false||json.opt("prerelease")!=isBeta(v)||feed==UpdateFeed.STABLE&&isBeta(v))return null
            val assets=json.optJSONArray("assets")
            val matching=if(assets==null)emptyList()else(0 until assets.length()).mapNotNull{assets.optJSONObject(it)}.filter{it.opt("name")=="Blockcolc-v$v.apk"}
            val asset=matching.singleOrNull()?.let{a->
                val size=a.opt("size") as? Number;val digest=a.opt("digest") as? String
                if(a.opt("state")!="uploaded"||size==null||size.toDouble()!=size.toLong().toDouble()||digest==null||!Regex("sha256:[a-fA-F0-9]{64}").matches(digest))null
                else UpdateAsset(v,a.optString("browser_download_url"),size.toLong(),digest.substring(7).lowercase()).takeIf{runCatching{validate(it)}.isSuccess}
            }
            return AppRelease(v,"$REPOSITORY/releases/tag/$tag",asset)
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
