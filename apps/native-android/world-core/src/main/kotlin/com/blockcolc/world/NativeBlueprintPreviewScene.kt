package com.blockcolc.world

import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import java.nio.FloatBuffer
import java.util.TimeZone
import java.util.concurrent.CancellationException
import kotlin.math.*

/** Isolated complete-building scene shared by creation and the catalogue. It
 * takes only source values: no domain project, repository, actor, terrain cache,
 * animals or permanent world identity can be read or changed by a preview. */
class NativeBlueprintPreviewScene(private val rasterizer:NativeSignRasterizer?=null) {
    private val materials=NativeOriginalMaterials()
    private val originals=NativeOriginalPackets(materials)
    private val compiler=OriginalStructureCompiler()
    private val entities=NativeStaticBlockEntities(rasterizer)
    private val clouds=NativeCloudCompiler()
    private val sky=NativeSkyCompiler()
    fun prepare(blueprint:BlueprintSnapshot,dark:Boolean,aspect:Double,resources:NativeResourceWorldAssets?=null,cancelled:()->Boolean={false}):NativeGeneratedScene {
        fun check(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Preview preparation cancelled")}
        check();val b=blueprint.bounds;val width=(b.maxX-b.minX+1).toDouble();val depth=(b.maxZ-b.minZ+1).toDouble();val height=(b.maxY-b.minY+1).toDouble()
        val recipe=BuildingPreparation.prepare(blueprint,"blueprint-preview",10000,10000,cancelled)
        val origin=BlockPoint(b.minX.toDouble(),b.minY.toDouble(),b.minZ.toDouble())
        val supported=SettlementSupport.align(VillageLayout.generate(listOf(VillageInput(0,b.footprint)),cancelled),WorldEnvironment.FLOATING,cancelled)
        val placed=supported.placements.single();val p=placed.worldPosition
        val placement=NativeStructurePlacement(BlockPoint(p.x,p.y-b.minY,p.z),placed.rotationY,placed.blueprintOffset)
        val roads=VillageLayout.roads(supported.placements,cancelled)
        val terrain=SteppedTerrain.generate(supported.placements,roads,supported.pads,Position2(64.0,64.0),TerrainOptions(WorldEnvironment.FLOATING,"world-default"),cancelled)
        // Same preview content bounds as renderer.ts; the full small island is
        // visible background and must not shrink the building's camera fit.
        val radius=maxOf(9.0,width*.8,depth*.8);val groundWidth=radius*2;val groundDepth=groundWidth
        val top=max(4.0,p.y+height-.5);val framing=max(6.0,sqrt(groundWidth*groundWidth+groundDepth*groundDepth+(top+2.5).pow(2))/2)
        val fov=38.0;val fit=framing/sin(min(fov*PI/180,2*atan(tan(fov*PI/360)*max(.1,aspect)))/2)*1.04
        val target=BlockPoint(p.x,max(1.5,(top-2.5)/2*.68),p.z);val pitch=38*PI/180
        val camera=NativeSceneCamera(target,BlockPoint(fit*cos(pitch)/sqrt(2.0),target.y+fit*sin(pitch),fit*cos(pitch)/sqrt(2.0)),fit,fov,
            SourceCamera(framing,listOf(listOf(terrain.bounds.minX,-2.5,terrain.bounds.minZ),listOf(terrain.bounds.maxX,top+8,terrain.bounds.maxZ)),max(80.0,framing*3),.9,.98,1.02,1.0),aspect,preview=true)
        // Theme is local to this small scene. It neither follows a debug clock
        // nor changes the shared world's live weather/daylight facts.
        val sample=NativeEnvironment.sample(0,TimeZone.getTimeZone("UTC"),NativeLightingQuality.BALANCED,framing,max(groundWidth,groundDepth),fit,
            override=NativeWeatherOverride(NativeWeatherKind.CLEAR,cloudIntensity=.25),skyOptions=NativeSkyOptions(floating=true),timeMinutes=if(dark)22*60 else 12*60)
        val state=sample.surface
        val root=NativePacketBuilder("world")
        val identity=FloatBuffer.wrap(FloatArray(16){BlockTransform.IDENTITY[it].toFloat()})
        for((i,geometry)in NativePlanarGeometry.terrain(terrain,cancelled).withIndex()){
            if(geometry==null)continue;check();val side=i>=TerrainMaterial.entries.size
            val material=if(side)if(i==TerrainMaterial.entries.size)TerrainMaterial.DIRT else TerrainMaterial.STONE else TerrainMaterial.entries[i]
            root.add(geometry,resources?.terrain?.material(material,state,side)?:materials.terrain(material,state,side=side),identity)
        }
        NativePlanarGeometry.roads(SettlementSupport.roads(roads,supported.placements,supported.pads,WorldEnvironment.FLOATING,cancelled),cancelled)?.let{root.add(it,materials.path(state),identity,castShadow=false)}
        val owner="building:blueprint-preview"
        val plan=entities.prepare(listOf(NativeBlockEntityRequest(owner,recipe.intact)),cancelled).getValue(owner)
        val builder=NativePacketBuilder(owner)
        if(resources!=null){
            val external=NativeResourceStructureCompiler(resources.stack,resources.textures,resources.palette)
            try{
                val adopted=external.compile(recipe,origin,cancelled,plan.replacedIndices)
                NativeResourcePackets(resources.textures).append(builder,owner,adopted,placement,state,cancelled=cancelled)
                val fallback=compiler.compile(recipe,origin,cancelled,adopted.acceptedMembers+plan.replacedIndices)
                originals.append(builder,fallback,placement,state,cancelled=cancelled)
            }finally{external.clear()}
        }else originals.append(builder,compiler.compile(recipe,origin,cancelled,plan.replacedIndices),placement,state,cancelled=cancelled)
        entities.append(builder,plan,origin,placement,cancelled)
        val cloud=clouds.prepare(NativeCloudContext(NativeCloudView(groundWidth,groundDepth,terrain.bounds.maxX-terrain.bounds.minX,terrain.bounds.maxZ-terrain.bounds.minZ,groundWidth,groundDepth,preview=true),p.x,p.z,max(12.0,top+8)),sample.weather,.72,cancelled)
        check()
        return NativeGeneratedScene(listOf(root.build(cancelled),builder.build(cancelled),cloud.source,sky.prepare(true,cancelled)),sample.lighting,sample.post,camera,0,0,
            state,sample.cloudColor,sample.sky,sample.fogProjection)
    }
    fun clear(){compiler.clear();materials.clear();entities.clear();clouds.clear();sky.clear()}
    companion object {
        /** Include the exact weighted variants used by this source, while a
         * preview atlas decodes only its referenced textures, not an entire pack. */
        fun textureIds(blueprint:BlueprintSnapshot,stack:ResourcePackStack,cancelled:()->Boolean={false}):Set<String> {
            val resolver=stack.resolver();val seen=hashSetOf<Triple<String,Map<String,String>,ResourceBlockPosition?>>()
            val ids=linkedSetOf<String>()
            for(block in listOf("grass_block","dirt","stone"))when(val geometry=resolver.geometry("minecraft:$block",if(block=="grass_block")mapOf("snowy" to "false")else emptyMap(),null,cancelled)){
                is ResourceBlockGeometry->geometry.elements.forEach{e->ids+=e.faces.values.map{it.texture}.filter{it in stack.textures}}
                is ResourceBlockTextures->ids+=geometry.faces.values.filter{it in stack.textures}
                else->Unit
            }
            for((i,v)in BuildingPreparation.pistonDisplay(blueprint.voxels,cancelled).voxels.withIndex()){
                if(i%128==0&&(cancelled()||Thread.currentThread().isInterrupted))throw CancellationException("Preview atlas cancelled")
                val id=v.sourceBlockId?:continue;val state=stack.blocks.state(id)
                val weighted=state?.let{it.variants.any{part->part.choices.size>1}||it.multipart?.any{part->part.apply.size>1}==true}?:false
                val position=if(weighted)ResourceBlockPosition(v.x,v.y,v.z)else null
                if(!seen.add(Triple(id,v.sourceBlockState.orEmpty(),position)))continue
                when(val geometry=resolver.geometry(id,v.sourceBlockState.orEmpty(),position,cancelled)){
                    is ResourceBlockGeometry->geometry.elements.forEach{e->ids+=e.faces.values.map{it.texture}.filter{it in stack.textures}}
                    is ResourceBlockTextures->ids+=geometry.faces.values.filter{it in stack.textures}
                    else->Unit
                }
            };return ids
        }
    }
}
