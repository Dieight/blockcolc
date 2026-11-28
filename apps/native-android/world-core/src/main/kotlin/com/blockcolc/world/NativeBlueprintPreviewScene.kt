package com.blockcolc.world

import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import java.util.concurrent.CancellationException
import kotlin.math.*

/** Isolated complete-building scene shared by creation and the catalogue,
 * presented on the Single-Building architectural maquette plinth under calm
 * studio lighting matching the app's gallery canvas. It takes only source
 * values: no domain project, repository, actor, terrain cache, animals or
 * permanent world identity can be read or changed by a preview. */
class NativeBlueprintPreviewScene(private val rasterizer:NativeSignRasterizer?=null) {
    private val materials=NativeOriginalMaterials()
    private val originals=NativeOriginalPackets(materials)
    private val compiler=OriginalStructureCompiler()
    private val entities=NativeStaticBlockEntities(rasterizer)
    private val clouds=NativeCloudCompiler()
    fun prepare(blueprint:BlueprintSnapshot,dark:Boolean,aspect:Double,resources:NativeResourceWorldAssets?=null,cancelled:()->Boolean={false}):NativeGeneratedScene {
        fun check(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Preview preparation cancelled")}
        check()
        val b=blueprint.bounds
        val width=(b.maxX-b.minX+1).toDouble()
        val depth=(b.maxZ-b.minZ+1).toDouble()
        val height=(b.maxY-b.minY+1).toDouble()
        val recipe=BuildingPreparation.prepare(blueprint,"blueprint-preview",10000,10000,cancelled)
        val origin=BlockPoint(b.minX.toDouble(),b.minY.toDouble(),b.minZ.toDouble())
        val hx=(ceil(width/2.0).toInt()+2).coerceIn(4,24)
        val hz=(ceil(depth/2.0).toInt()+2).coerceIn(4,24)
        val cx=(b.minX+b.maxX)/2.0
        val cz=(b.minZ+b.maxZ)/2.0
        val placement=NativeStructurePlacement(BlockPoint(0.0,-b.minY.toDouble(),0.0),0.0,Position2(-cx,-cz))

        val padWidth=(hx*2+1).toDouble()
        val padDepth=(hz*2+1).toDouble()
        val framing=max(5.5,sqrt(padWidth*padWidth+padDepth*padDepth+(height+3.0).pow(2))/2.0*0.92)
        val fov=36.0
        val fit=framing/sin(min(fov*PI/180,2*atan(tan(fov*PI/360)*max(.1,aspect)))/2)*1.02
        val target=BlockPoint(0.0,max(1.2,height*0.42),0.0)
        val pitch=34*PI/180
        val extent=max(padWidth,padDepth)*1.4
        val camera=NativeSceneCamera(
            target,
            BlockPoint(fit*cos(pitch)/sqrt(2.0),target.y+fit*sin(pitch),fit*cos(pitch)/sqrt(2.0)),
            fit,
            fov,
            SourceCamera(framing,listOf(listOf(-extent,-6.0,-extent),listOf(extent,height+10.0,extent)),max(80.0,framing*3),.9,.98,1.02,1.0),
            aspect,
            preview=true,
        )

        // Studio maquette lighting: matches the app's gallery paper/obsidian
        // canvas seamlessly while preserving local Light/Dark theme isolation.
        fun rgb(hex:Int)=LinearRgb.fromSrgb(hex).let{listOf(it.red,it.green,it.blue)}
        val clearHex=if(dark)0x0B0D0C else 0xF6F5F1
        val rawDir=listOf(-0.52,-0.74,-0.42);val dirLen=sqrt(rawDir.sumOf{it*it})
        val keyDir=rawDir.map{(it/dirLen).toFloat()}
        val keyRgb=rgb(if(dark)0xE8EEF2 else 0xFFF7EA)
        val hemiSky=rgb(if(dark)0xA4B8CC else 0xFAF8F2)
        val hemiGround=rgb(if(dark)0x2B332F else 0xCFCBC1)
        val lights=listOf(
            SourceLight("DirectionalLight",keyRgb,if(dark)1.62f else 1.88f,keyDir,listOf(0f,0f,0f),true,listOf(0f,0f,0f),0f,0.012f),
            SourceLight("HemisphereLight",hemiSky,if(dark)1.32f else 1.24f,listOf(0f,1f,0f),listOf(0f,0f,0f),false,hemiGround,0f,0f),
        )
        val lighting=SourceLighting(
            exposure=if(dark)1.28f else 1.18f,
            clearColor=rgb(clearHex),
            lights=lights,
            shadowsEnabled=true,
            pending=emptyList(),
            fog=null,
        )
        val quality=NativeLightingQuality.BALANCED
        val state=NativeSurfaceState(
            SurfaceEffects(keyDir.map{-it},keyRgb,rgb(quality.coolColor),quality.faceContrast,0f),
            NightField.NONE,
            if(dark)0.22f else 0f,
            quality.ambientOcclusion,
            1f,
            1f,
        )

        val plinthVoxels=buildMaquettePlinth(hx,hz,dark)
        val plinthOrigin=BlockPoint(0.0,0.0,0.0)
        val plinthPose=NativeStructurePlacement(BlockPoint(0.0,0.0,0.0))
        val plinthRecipe=BuildingPreparation.staticStructure(plinthVoxels,"preview-plinth:${hx}x${hz}:$dark",cancelled=cancelled)
        val root=NativePacketBuilder("world")
        originals.append(root,compiler.compile(plinthRecipe,plinthOrigin,cancelled),plinthPose,state,cancelled=cancelled)

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

        val clearWeather=NativeWeather("2026-01-01",NativeWeatherKind.CLEAR,false,1,0,0.0,0,0,0.0,0.0)
        val cloud=clouds.prepare(
            NativeCloudContext(NativeCloudView(padWidth*2.0,padDepth*2.0,padWidth*3.0,padDepth*3.0,padWidth*2.0,padDepth*2.0,preview=true),0.0,0.0,max(14.0,height+8.0)),
            clearWeather,
            0.0,
            cancelled,
        )
        check()
        return NativeGeneratedScene(
            listOf(root.build(cancelled),builder.build(cancelled),cloud.source),
            lighting,
            SourcePost.NONE.copy(direct=true,samples=4),
            camera,
            0,
            0,
            state,
            LinearRgb.fromSrgb(0xFFFFFF),
            null,
            null,
        )
    }
    private fun buildMaquettePlinth(hx:Int,hz:Int,dark:Boolean):List<RenderVoxel> {
        val out=ArrayList<RenderVoxel>()
        var order=0
        val topBlock=if(dark)"minecraft:deepslate_tiles" else "minecraft:quartz_block"
        val rimBlock=if(dark)"minecraft:polished_deepslate" else "minecraft:smooth_quartz"
        val baseBlock=if(dark)"minecraft:blackstone" else "minecraft:polished_andesite"
        for(x in -hx..hx)for(z in -hz..hz){
            val edge=abs(x)==hx||abs(z)==hz
            out+=RenderVoxel(x.toDouble(),-1.0,z.toDouble(),"stone",order++,if(edge)rimBlock else topBlock)
        }
        val bx=(hx-1).coerceAtLeast(2);val bz=(hz-1).coerceAtLeast(2)
        for(x in -bx..bx)for(z in -bz..bz){
            out+=RenderVoxel(x.toDouble(),-2.0,z.toDouble(),"stone",order++,baseBlock)
        }
        return out
    }
    fun clear(){compiler.clear();materials.clear();entities.clear();clouds.clear()}
    companion object {
        /** Include the exact weighted variants used by this source, while a
         * preview atlas decodes only its referenced textures, not an entire pack. */
        fun textureIds(blueprint:BlueprintSnapshot,stack:ResourcePackStack,cancelled:()->Boolean={false}):Set<String> {
            val resolver=stack.resolver();val seen=hashSetOf<Triple<String,Map<String,String>,ResourceBlockPosition?>>()
            val ids=linkedSetOf<String>()
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
