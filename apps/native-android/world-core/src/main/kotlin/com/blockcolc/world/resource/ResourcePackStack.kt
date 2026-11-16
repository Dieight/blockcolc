package com.blockcolc.world.resource

import org.json.JSONObject
import java.security.MessageDigest

/** Borrows one immutable archive. Its lifecycle remains with the import/cache owner. */
class ResourcePackAssets private constructor(val archive:NativeResourceArchive,val blocks:ResourceBlockCatalog,val textures:ResourceTextureCatalog,
    val extras:ResourcePackExtraCatalog,val ignoredFileCount:Int){
    val archiveSha256 get()=archive.inputSha256
    val pack get()=archive.pack
    companion object{
        fun prepare(archive:NativeResourceArchive,cancelled:()->Boolean={false}):ResourcePackAssets{
            checkpoint(cancelled);val blocks=NativeResourceBlocks.prepare(archive,cancelled);val textures=NativeResourceTextures.prepare(archive,cancelled)
            val extras=NativeResourcePackExtras.prepare(archive,cancelled=cancelled)
            val texturePath=Regex("^assets/([^/]+)/textures/block/(.+)\\.png(?:\\.mcmeta)?$")
            val recognized=blocks.recognizedPaths+extras.recognizedPaths+archive.paths.filter{texturePath.matches(it)}+"pack.mcmeta"
            return ResourcePackAssets(archive,blocks,textures,extras,archive.paths.count{it !in recognized})
        }
    }
}
class ResourceOwnedTexture internal constructor(val source:ResourcePackAssets,val descriptor:ResourceTextureDescriptor){
    val resourceId get()=descriptor.resourceId
    fun decode(cancelled:()->Boolean={false})=source.textures.decode(source.archive,resourceId,cancelled)
}
class ResourceOwnedSpecial internal constructor(val source:ResourcePackAssets,val descriptor:ResourceSpecialTexture){
    val resourceId get()=descriptor.resourceId
    fun decode(cancelled:()->Boolean={false})=source.extras.decodeSpecial(source.archive,resourceId,cancelled)
}
class ResourceOwnedColormap internal constructor(val source:ResourcePackAssets,val descriptor:ResourceColormap){
    val resourceId get()=descriptor.resourceId
    fun decode(cancelled:()->Boolean={false})=source.extras.decodeColormap(source.archive,descriptor.kind,cancelled)
}
data class ResourcePackStackIssue(val path:String,val code:String,val source:String)

/** Layer priority applies to complete IDs, never by splicing a child's model JSON or PNG. */
class ResourcePackStack private constructor(layers:List<ResourcePackAssets>,val identity:String,val pack:ResourcePackMetadata,
    val blocks:ResourceBlockCatalog,textures:Map<String,ResourceOwnedTexture>,special:Map<String,ResourceOwnedSpecial>,maps:Map<String,ResourceOwnedColormap>,
    issues:List<ResourcePackStackIssue>,private val counts:Map<String,Int>){
    val layers=resourceList(layers);val textures=resourceMap(textures);val specialTextures=resourceMap(special);val colormaps=resourceMap(maps);val issues=resourceList(issues)
    fun summary()=JSONObject().also{out->counts.forEach{(k,v)->out.put(k,v)}}.put("namespaces",jsonArray((textures.values.map{it.descriptor.namespace}+specialTextures.values.map{it.descriptor.namespace}).distinct().sorted()))
        .put("issues",jsonArray(issues.map{JSONObject().put("path",it.path).put("code",it.code).put("source",it.source)}))
    fun resolver()=ResourceBlockResolver(this)
    companion object{
        fun of(layer:ResourcePackAssets,cancelled:()->Boolean={false})=compose(listOf(layer),cancelled)
        fun layer(base:ResourcePackStack,overlay:ResourcePackAssets,cancelled:()->Boolean={false}):ResourcePackStack=compose(base.layers+overlay,cancelled)
        private fun compose(layers:List<ResourcePackAssets>,cancelled:()->Boolean):ResourcePackStack{
            checkpoint(cancelled)
            require(layers.size in 1..8){"At most eight immutable pack layers"}
            val identity=MessageDigest.getInstance("SHA-256").digest(("native-resource-stack-v1\n"+layers.joinToString("\n"){it.archiveSha256}).toByteArray())
                .joinToString(""){"%02x".format(it.toInt()and 255)}
            val states=linkedMapOf<String,ResourceBlockState>();val models=linkedMapOf<String,ResourceBlockModel>();val textures=linkedMapOf<String,ResourceOwnedTexture>()
            val specials=linkedMapOf<String,ResourceOwnedSpecial>();val maps=linkedMapOf<String,ResourceOwnedColormap>();val issues=ArrayList<ResourcePackStackIssue>()
            var fileCount=0;var candidateCount=0;var acceptedCount=0;var ignoredCount=0
            for((index,p)in layers.withIndex()){
                checkpoint(cancelled)
                p.blocks.blockStates.forEach{states[it.resourceId]=it};p.blocks.models.forEach{models[it.resourceId]=it}
                p.textures.textures.forEach{textures[it.resourceId]=ResourceOwnedTexture(p,it)}
                p.extras.specialTextures.forEach{specials[it.resourceId]=ResourceOwnedSpecial(p,it)};p.extras.colormaps.forEach{maps[it.resourceId]=ResourceOwnedColormap(p,it)}
                val source="$index:${p.archiveSha256}"
                issues+=p.blocks.issues.map{ResourcePackStackIssue(it.path,it.code,source)}
                issues+=(p.textures.issues+p.extras.issues).map{ResourcePackStackIssue(it.path,it.code,source)}
                fileCount+=p.archive.archiveFileCount;candidateCount+=p.textures.candidates;acceptedCount+=p.textures.textures.size;ignoredCount+=p.ignoredFileCount
            }
            val blocks=ResourceBlockCatalog(identity,states.values.sortedBy{it.resourceId},models.values.sortedBy{it.resourceId},emptyList(),emptySet())
            checkpoint(cancelled)
            return ResourcePackStack(layers,identity,layers.last().pack,blocks,textures.toSortedMap(),specials.toSortedMap(),maps.toSortedMap(),issues.sortedWith(compareBy({it.path},{it.code},{it.source})),
                mapOf("archiveFileCount" to fileCount,"candidateTextureCount" to candidateCount,"acceptedTextureCount" to acceptedCount,
                    "rejectedTextureCount" to candidateCount-acceptedCount,"ignoredFileCount" to ignoredCount))
        }
    }
}
