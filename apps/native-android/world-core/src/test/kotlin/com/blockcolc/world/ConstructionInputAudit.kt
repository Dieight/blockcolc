package com.blockcolc.world

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.util.Base64
import java.util.zip.GZIPInputStream

/** Checks the entire admitted P2 construction corpus with the real Kotlin
 * readers, before any device allocation. This is not GPU/visual acceptance. */
object ConstructionInputAudit {
    private fun hash(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString(""){"%02x".format(it.toInt() and 255)}
    private fun bounded(root:File,name:String,maximum:Long):ByteArray {
        val file=File(root,name).canonicalFile
        require(file.toPath().startsWith(root.toPath())&&file.isFile&&file.length() in 1..maximum){"Missing/unsafe/oversized input: $name"}
        return file.readBytes().also{require(it.size.toLong()<=maximum)}
    }
    private fun rows(array:JSONArray)=List(array.length()){array.getJSONObject(it)}
    @JvmStatic fun main(args:Array<String>) {
        require(args.size==4){"frozen world, complete construction directory, repository root, new report required"}
        val base=File(args[0]).canonicalFile;val root=File(args[1]).canonicalFile
        val repository=File(args[2]).canonicalFile;val output=File(args[3]).canonicalFile
        require(base.isDirectory&&root.isDirectory&&repository.isDirectory&&!output.exists())
        val result=JSONObject().put("completed",false).put("kind","p2-complete-construction-reader-audit")
            .put("scope","Exact admitted progress corpus, Kotlin protocol/program/collision/budget readers; not GPU, visual or whole-App performance acceptance")
        val fixtures=JSONArray();result.put("fixtures",fixtures)
        var failure:Throwable?=null
        try {
            val manifest=JSONObject(String(bounded(base,"manifest.json",16L*1024*1024),Charsets.UTF_8))
            val index=JSONObject(String(bounded(root,"p2-construction.json",16L*1024*1024),Charsets.UTF_8))
            require(index.getInt("schema")==1&&index.getBoolean("completed")&&index.getBoolean("exhaustive"))
            require(index.getString("baseProducerFingerprint")==manifest.getString("producerFingerprint"))
            for(entry in rows(index.getJSONArray("worldSource"))){
                require(entry.getString("path").startsWith("packages/voxel/src/"))
                require(hash(bounded(repository,entry.getString("path"),16L*1024*1024))==entry.getString("sha256")){"Source world changed"}
            }
            val images=index.getJSONObject("images")
            for(name in images.keys()){
                require(name.matches(Regex("[a-f0-9]{64}\\.(png|f32)")))
                require(hash(bounded(root,"images/$name",128L*1024*1024))==images.getString(name)&&name.substringBefore('.')==images.getString(name))
            }
            val names=rows(manifest.getJSONArray("reports")).map{it.getString("name")}
            require(index.getJSONObject("fixtures").keySet()==names.toSet())
            var total=0
            for(name in names){
                val group=index.getJSONObject("fixtures").getJSONObject(name)
                val frozen=JSONObject(String(bounded(base,"$name.world.json",16L*1024*1024),Charsets.UTF_8))
                require(group.getString("baseBinary")==frozen.getString("binarySha256"))
                val entries=rows(group.getJSONArray("rows"));val progress=entries.map{it.getInt("progress")}
                require(progress.size>3&&progress.first()==0&&progress.last()==10000&&progress.zipWithNext().all{(a,b)->a<b})
                var instances=0L;var largestPack=0
                for(entry in entries){
                    val order=entry.getInt("progress");result.put("checking","$name:$order")
                    val file=entry.getString("file");require(file=="construction/$name-$order.p2pack")
                    val encoded=bounded(root,file,4L*1024*1024);largestPack=maxOf(largestPack,encoded.size)
                    require(encoded.size==entry.getInt("bytes")&&hash(encoded)==entry.getString("sha256"))
                    val text=GZIPInputStream(encoded.inputStream()).use{input->
                        val raw=input.readNBytes(32*1024*1024+1);require(raw.size<=32*1024*1024);String(raw,Charsets.UTF_8)
                    }
                    val packed=JSONObject(text);val metadata=packed.getJSONObject("metadata")
                    val binary=Base64.getDecoder().decode(packed.getString("bytes"))
                    require(hash(binary)==metadata.getString("binarySha256")&&hash(binary)==entry.getString("binarySha256"))
                    val world=WorldPackets.read(metadata.toString(),ByteBuffer.wrap(binary))
                    require(world.packets.all{it.owner=="building:complex-0"&&it.layer=="static"})
                    SourceCamera.read(metadata.getJSONObject("cameraVolume"))
                    SourceLighting.read(metadata.getJSONObject("environment"))
                    SourcePost.read(metadata.getJSONObject("environment").getJSONObject("pipeline"))
                    GpuFootprint.read(world,metadata);AtlasTimeline.readAll(metadata)
                    val programs=metadata.getJSONArray("programs")
                    val coverage=world.materials.map{raw->val m=JSONObject(raw);val recipe=m.optJSONObject("recipe")
                        ReviewedSurfacePrograms.resolve(recipe?.let{programs.getJSONObject(it.getInt("program"))},recipe?.getJSONObject("uniforms"))}
                    require(coverage.all{it.pending.isEmpty()}){"Unadmitted construction program"}
                    for(packet in world.packets)require((world.geometries[packet.geometry].vertexPreparation=="atlas-static-v1")== (coverage[packet.material].optics.atlas!=null))
                    for(image in rows(metadata.getJSONArray("textures"))){
                        val encoding=image.optString("encoding","png");require(encoding in setOf("png","r32f-le"))
                        val id=image.getString("image");require(id.matches(Regex("[a-f0-9]{64}")))
                        val asset="$id.${if(encoding=="png")"png" else "f32"}"
                        val assetRoot=if(File(root,"images/$asset").isFile)root else base
                        require(hash(bounded(assetRoot,"images/$asset",128L*1024*1024))==id)
                    }
                    val descriptor=metadata.getJSONObject("animalRuntime")
                    require(descriptor.getString("scope")=="owner-update"&&descriptor.getString("owner")=="building:complex-0"
                        &&descriptor.getString("file")=="$name-update.animals.bin")
                    val animal=Base64.getDecoder().decode(packed.getString("animals"));require(hash(animal)==descriptor.getString("sha256"))
                    val owners=descriptor.getJSONArray("owners")
                    val habitat=AnimalHabitatInput.read(ByteBuffer.wrap(animal),List(owners.length()){owners.getString(it)})
                    require(habitat.surfaces.isEmpty()&&descriptor.getInt("surfaceCount")==0&&habitat.solids.size==descriptor.getInt("solidCount")
                        &&habitat.solids.all{it.owner=="building:complex-0"})
                    instances+=world.packets.sumOf{it.count}.toLong();total++
                }
                fixtures.put(JSONObject().put("name",name).put("rows",entries.size).put("largestPackBytes",largestPack).put("totalInstancesAcrossPrefixes",instances))
            }
            result.remove("checking");result.put("rows",total).put("completed",true)
        }catch(error:Throwable){failure=error;result.put("failure",error.toString())}
        Files.createDirectories(output.toPath().parent)
        Files.writeString(output.toPath(),result.toString(2),StandardOpenOption.CREATE_NEW)
        println("P2 construction reader audit: completed=${result.getBoolean("completed")}; ${output.name}")
        failure?.let{throw it}
    }
}
