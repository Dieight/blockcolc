package com.blockcolc.world

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.StandardOpenOption
import java.security.MessageDigest

/** Offline use of the real native readers. No renderer, device, or P1 gate is
 * implied by successful protocol / program / resource-budget preflight. */
object FrozenInputAudit {
    private fun hash(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString(""){"%02x".format(it.toInt() and 255)}
    private fun bounded(file:File,maximum:Long):ByteArray {
        require(file.isFile&&file.length() in 1..maximum){"Missing or oversized frozen input: ${file.name}"}
        return file.readBytes().also{require(it.size.toLong()<=maximum)}
    }
    private fun rows(array:JSONArray)=List(array.length()){array.getJSONObject(it)}
    @JvmStatic fun main(args:Array<String>){
        require(args.size==2){"input directory and new output report required"}
        val root=File(args[0]).canonicalFile;val output=File(args[1]).canonicalFile
        require(root.isDirectory&&!output.exists())
        val manifest=JSONObject(String(bounded(File(root,"manifest.json"),16L*1024*1024),Charsets.UTF_8))
        require(manifest.getJSONArray("errors").length()==0)
        require(!manifest.optBoolean("inventoryOnly",false)){"Inventory-only report is not an encoded native world"}
        val pack=manifest.optJSONObject("resourcePack")?.getJSONObject("identity")
        if(manifest.optString("assets")=="mc263"){
            require(pack!=null&&pack.getString("kind")=="mc263")
            require(hash(bounded(File(root,"resource-pack.json"),64L*1024*1024))==pack.getString("wireSha256")){"Normalized reference pack identity changed"}
        }else require(pack==null)
        val names=rows(manifest.getJSONArray("reports")).map{it.getString("name")}
        require(names==listOf("ocean","coast")||names==listOf("ocean","coast","valley","floating"))
        val results=JSONArray()
        for(name in names)for(suffix in listOf("","-update")){
            val stem=name+suffix
            val text=String(bounded(File(root,"$stem.world.json"),16L*1024*1024),Charsets.UTF_8)
            val json=JSONObject(text);require(json.getInt("exportSchema") in 9..10)
            val actualPack=json.optJSONObject("resourcePack")
            if(pack!=null){require(actualPack!=null);for(key in listOf("kind","sha256","bytes","wireSha256"))require(actualPack.get(key)==pack.get(key))}
            else require(actualPack==null)
            val bytes=bounded(File(root,"$stem.bin"),WorldPackets.MAX_BYTES.toLong())
            require(hash(bytes)==json.getString("binarySha256")){"World payload identity changed"}
            val world=WorldPackets.read(text,ByteBuffer.wrap(bytes))
            val camera=SourceCamera.read(json.getJSONObject("cameraVolume"))
            val lighting=SourceLighting.read(json.getJSONObject("environment"))
            SourcePost.read(json.getJSONObject("environment").getJSONObject("pipeline"))
            val footprint=GpuFootprint.read(world,json)
            val atlas=AtlasTimeline.readAll(json)
            val programs=json.getJSONArray("programs")
            val materials=world.materials.map(::JSONObject)
            val coverage=materials.map{m->val recipe=m.optJSONObject("recipe")
                ReviewedSurfacePrograms.resolve(recipe?.let{programs.getJSONObject(it.getInt("program"))},recipe?.getJSONObject("uniforms"))}
            for(packet in world.packets)require((world.geometries[packet.geometry].vertexPreparation=="atlas-static-v1")== (coverage[packet.material].optics.atlas!=null))
            val gaps=rows(json.getJSONArray("unsupported")).filter{g->when(g.getString("kind")){
                "custom-program"->false
                "unported-material-model"->g.getString("name")!="MeshLambertMaterial"||materials.indices.any{i->
                    materials[i].getString("sourceType")=="MeshLambertMaterial"&&coverage[i].optics.cloud==null}
                else->true
            }}.groupingBy{it.getString("kind")+":"+it.optString("name")}.eachCount()
            val pending=coverage.mapIndexedNotNull{i,c->if(c.pending.isEmpty())null else
                JSONObject().put("material",i).put("name",materials[i].optString("sourceType")).put("pending",JSONArray(c.pending))}
            val images=rows(json.getJSONArray("textures"));require(images.size<=4096)
            var encodedBytes=0L
            for(image in images.distinctBy{it.getString("image")+":"+it.optString("encoding","png")}){
                val id=image.getString("image");require(id.matches(Regex("[a-f0-9]{64}")))
                val encoding=image.optString("encoding","png");require(encoding in setOf("png","r32f-le"))
                val raw=bounded(File(root,"images/$id.${if(encoding=="png")"png" else "f32"}"),128L*1024*1024)
                encodedBytes+=raw.size;require(encodedBytes<=256L*1024*1024)
                require(hash(raw)==id){"Frozen image identity changed"}
            }
            val animal=json.getJSONObject("animalRuntime")
            require(animal.getString("file")=="$stem.animals.bin")
            val rawAnimal=bounded(File(root,animal.getString("file")),32L*1024*1024)
            require(hash(rawAnimal)==animal.getString("sha256"))
            val owners=animal.getJSONArray("owners")
            val habitat=AnimalHabitatInput.read(ByteBuffer.wrap(rawAnimal),List(owners.length()){owners.getString(it)})
            require(habitat.surfaces.size==animal.getInt("surfaceCount")&&habitat.solids.size==animal.getInt("solidCount"))
            val population=if(suffix.isEmpty())AnimalInitialState.read(animal).agents.size else 0
            val admissible=gaps.isEmpty()&&pending.isEmpty()&&
                (lighting.fog==null||lighting.lights.any{it.type=="DirectionalLight"})
            results.put(JSONObject().put("fixture",stem).put("admissible",admissible)
                .put("structuralGaps",JSONObject(gaps)).put("pendingMaterials",JSONArray(pending))
                .put("packetCount",world.packets.size).put("geometryCount",world.geometries.size)
                .put("population",population).put("encodedImageBytes",encodedBytes)
                .put("atlasPages",atlas.size).put("activeAtlasSequences",atlas.sumOf{a->a.sequences.count{it.index in a.active}})
                .put("gpuInputBudget",footprint.json()).put("sourceSkyRadius",camera.sourceSkyRadius))
        }
        val admissible=rows(results).all{it.getBoolean("admissible")}
        val report=JSONObject().put("kind","p1-native-offline-input-audit").put("completed",true)
            .put("producerFingerprint",manifest.getString("producerFingerprint")).put("fixtures",results)
            .put("resourcePack",pack)
            .put("allAdmissible",admissible).put("p1GatePassed",false).put("p2Started",false)
            .put("scope","Native CPU readers, reviewed program identities and input budgets; not GPU allocation, rendering, or device performance")
        Files.createDirectories(output.toPath().parent)
        Files.writeString(output.toPath(),report.toString(2),StandardOpenOption.CREATE_NEW)
        println("Native input audit: ${results.length()} fixture/updates, allAdmissible=$admissible; ${output.name}")
        require(admissible){"Native source input has unported operations; report retained"}
    }
}
