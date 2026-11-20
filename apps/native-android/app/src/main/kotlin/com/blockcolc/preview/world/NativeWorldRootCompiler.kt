package com.blockcolc.preview.world

import com.blockcolc.world.*
import com.blockcolc.world.generation.*
import java.nio.FloatBuffer
import java.util.concurrent.CancellationException
import kotlin.math.*

/** Static terrain/scenery owns its material and geometry caches. It never
 * shares a mutable compiler with building/entity preparation. */
internal class NativeWorldRootCompiler {
    private val materials=NativeOriginalMaterials()
    private val originals=NativeOriginalPackets(materials)
    private val compiler=OriginalStructureCompiler()
    private val identity=FloatBuffer.wrap(FloatArray(16){BlockTransform.IDENTITY[it].toFloat()}).asReadOnlyBuffer()
    private var resourceAssets:NativeResourceWorldAssets?=null
    private var resourceCompiler:NativeResourceStructureCompiler?=null
    private var resourcePackets:NativeResourcePackets?=null
    private fun check(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Static world packing superseded")}
    fun prepare(world:WorldTerrainPlan,state:NativeSurfaceState,assets:NativeResourceWorldAssets?,retainManifest:Boolean,cancelled:()->Boolean):NativePacketSource {
        if(resourceAssets!==assets){
            resourceCompiler?.clear();resourceAssets=assets
            resourceCompiler=assets?.let{NativeResourceStructureCompiler(it.stack,it.textures,it.palette,specials=it.specials)}
            resourcePackets=assets?.let{NativeResourcePackets(it.textures)}
        }
        return build(world,state,retainManifest,cancelled)
    }
    private fun build(world:WorldTerrainPlan,state:NativeSurfaceState,retainManifest:Boolean,cancelled:()->Boolean):NativePacketSource {
        val target=NativePacketBuilder("world",retainManifest=retainManifest);val coast=world.input.spatial.environment==WorldEnvironment.COAST
        val geometries=NativePlanarGeometry.terrain(world.terrain,cancelled)
        for((i,geometry)in geometries.withIndex()){check(cancelled);if(geometry==null)continue
            val side=i>=TerrainMaterial.entries.size;val material=if(side)if(i==TerrainMaterial.entries.size)TerrainMaterial.DIRT else TerrainMaterial.STONE else TerrainMaterial.entries[i]
            val surface=resourceAssets?.terrain?.material(material,state,side)
                ?:materials.terrain(material,state,coast,world.input.spatial.environment!=WorldEnvironment.FLOATING,side)
            target.add(geometry,surface,identity,
                castShadow=material!=TerrainMaterial.WATER||world.input.spatial.environment==WorldEnvironment.FLOATING,receiveShadow=true)
        }
        NativePlanarGeometry.roads(world.input.spatial.roadGeometry,cancelled)?.let{target.add(it,materials.path(state),identity,castShadow=false)}
        fun worldVoxels(object_:SceneryObject,voxels:List<RenderVoxel>)=voxels.map{it.copy(x=it.x+object_.x,y=it.y+object_.y,z=it.z+object_.z)}
        fun append(voxels:List<RenderVoxel>,id:String,lod:SceneryLod?=null,neighbors:List<RenderVoxel> = voxels,shared:StaticStructurePreparation?=null){
            if(voxels.isEmpty())return;check(cancelled)
            val recipe=shared?.prepare(voxels,"${world.sceneryKey}:$id",cancelled)?:BuildingPreparation.staticStructure(voxels,"${world.sceneryKey}:$id",neighbors,cancelled)
            // External models decide membership before original fallback.
            val mesh=if(resourceCompiler==null)compiler.compile(recipe,cancelled=cancelled)else null
            appendStructure(target,"world",recipe,mesh,NativeStructurePlacement(BlockPoint(0.0,0.0,0.0)),state,lod=lod,cancelled=cancelled)
        }
        val scenery=world.scenery.objects
        // Compact spatial batches retain every tree and its real voxel shadow,
        // while avoiding one draw set per individual decorative tree.
        // The generation-local translated tree list/index can be retired
        // before landmark preparation, including on unoptimized Android ART.
        fun appendTrees(){
            val trees=scenery.filter{it.role==SceneryRole.TREE}.flatMap{worldVoxels(it,it.blocks.voxels)}
            val treeGroups=trees.groupBy{floor(it.x/64).toLong() to floor(it.z/64).toLong()}
            val treeField=if(trees.isEmpty())null else StaticStructurePreparation(trees,cancelled)
            for((index,group)in treeGroups.values.withIndex()){append(group,"trees:$index",shared=treeField)}
        }
        appendTrees()
        val gardens=scenery.filter{it.role==SceneryRole.GARDEN&&it.blocks.voxels.size==it.blocks.distantVoxels.size}
        append(gardens.flatMap{worldVoxels(it,it.blocks.voxels)},"gardens")
        val landmarks=scenery.filter{it.role!=SceneryRole.TREE&&it.role!=SceneryRole.GARDEN}
        append(landmarks.flatMap{worldVoxels(it,it.blocks.distantVoxels)},"landmark-silhouettes")
        for(object_ in scenery)if(object_.role!=SceneryRole.TREE&&object_ !in gardens){
            val lod=SceneryLod(object_.id,"full",Point3(object_.x.toFloat(),(object_.y+3).toFloat(),object_.z.toFloat()),max(object_.width,object_.depth).toFloat())
            val detail=if(object_.role==SceneryRole.GARDEN)object_.blocks.voxels else object_.blocks.detail()
            append(worldVoxels(object_,detail),object_.id,lod,worldVoxels(object_,object_.blocks.voxels))
        }
        check(cancelled);return target.build(cancelled)
    }
    private fun appendStructure(target:NativePacketBuilder,owner:String,recipe:BuildingInputRecipe,original:OriginalStructure?,placement:NativeStructurePlacement,
        state:NativeSurfaceState,weathering:Double=0.0,excluded:Set<Int> = emptySet(),lod:SceneryLod?=null,origin:BlockPoint=original?.origin?:BlockPoint(0.0,0.0,0.0),cancelled:()->Boolean){
        val pack=resourceCompiler
        if(pack==null){originals.append(target,original?:compiler.compile(recipe,origin,cancelled),placement,state,weathering,lod,excluded,cancelled);return}
        val resource=pack.compile(recipe,origin,cancelled,excluded)
        // Static entity bodies still use their explicit renderer route. Model
        // replacement must not erase an overlay's metadata or duplicate a body.
        val reserved=excluded
        check(resource.acceptedMembers.none{it in reserved})
        resourcePackets!!.append(target,owner,resource,placement,state,weathering,lod,cancelled)
        val fallback=compiler.compile(recipe,origin,cancelled,NativeSourceIndices.unionView(resource.acceptedMembers,excluded),resource.fluids?.plan?.acceptedFree.orEmpty(),resource.fluids?.plan?.acceptedWaterlogged.orEmpty())
        originals.append(target,fallback,placement,state,weathering,lod,cancelled=cancelled)
    }
    fun clear(){compiler.clear();materials.clear();resourceCompiler?.clear();resourceCompiler=null;resourcePackets=null;resourceAssets=null}
}
