package com.blockcolc.preview.world

import com.blockcolc.world.*
import com.blockcolc.world.generation.*
import java.nio.FloatBuffer
import java.util.Collections
import java.util.TimeZone
import java.util.concurrent.CancellationException
import kotlin.math.*

data class WorldRenderOptions(val time:Long,val zone:String=TimeZone.getDefault().id,val quality:NativeLightingQuality=NativeLightingQuality.HIGH,
    val aspect:Double=.75,val weather:NativeWeatherOverride?=null,val coordinates:NativeCoordinates?=null,val worldColor:SourceWorldColor=SourceWorldColor(),val atmosphere:NativeAtmosphereFacts?=null,
    val outlines:NativeOutlineVisibility=NativeOutlineVisibility.CURRENT,val resources:NativeResourceWorldAssets?=null) {
    init {require(aspect.isFinite()&&aspect in .1..10.0&&zone in TimeZone.getAvailableIDs())}
}
class NativeWorldFrame(val identity:WorldRequestIdentity,val scene:NativeGeneratedScene,val environment:NativeEnvironmentSample,val spatialKey:String,
    val terrainKey:String,val sceneryKey:String,val pendingBlockEntities:Int,val environmentContext:NativeEnvironmentContext,
    val cloudContext:NativeCloudContext,val clouds:NativeCloudPrepared,val precipitationContext:NativePrecipitationContext,val precipitation:NativePrecipitationPrepared)

/** Generation-thread adapter. Root geometry survives title/note/progress-only
 * changes; every business building/reward keeps an independently replaceable
 * owner. CPU preparation never opens an engine or reads business storage. */
class NativeWorldPacketCompiler internal constructor(signRasterizer:NativeSignRasterizer?,private val allocator:NativePacketAllocator?,parallel:Boolean,
    private val staticWorldCache:AndroidStaticWorldCache?,private val paperWorldCache:AndroidStaticWorldCache?=null,
    private val compactGeometry:Boolean=true):AutoCloseable {
    constructor(signRasterizer:NativeSignRasterizer?=null,allocator:NativePacketAllocator?=null,parallel:Boolean=false):
        this(signRasterizer,allocator,parallel,null)
    private val preparation=WorldPacketPreparation(allocator,parallel)
    private var rootCompiler:NativeWorldRootCompiler?=null
    private val materials=NativeOriginalMaterials();private val originals=NativeOriginalPackets(materials);private val compiler=OriginalStructureCompiler()
    private val construction=NativeConstructionDetails(materials)
    private val picking=NativeWorldPickCompiler()
    private val entities=NativeStaticBlockEntities(signRasterizer)
    private val clouds=NativeCloudCompiler()
    private val precipitation=NativePrecipitationCompiler()
    private val sky=NativeSkyCompiler()
    private val lightning=NativeLightningCompiler()
    private val animals=WorldAnimalPreparation()
    private var resourceAssets:NativeResourceWorldAssets?=null
    private var resourceCompiler:NativeResourceStructureCompiler?=null
    private var resourcePackets:NativeResourcePackets?=null
    private var ground:Pair<String,NativePrecipitationGround>?=null
    private data class RootKey(val spatial:String,val terrain:String,val scenery:String,val state:NativeSurfaceState,val paper:Boolean)
    private var root:Pair<RootKey,NativePacketSource>?=null
    // Preparation caches may evict/recreate an identical structure after a
    // cancelled or failed candidate. Reuse by its complete immutable input and
    // rebase origin, not the temporary geometry container's object identity.
    private data class OwnerKey(val structureKey:String,val origin:BlockPoint,val placement:NativeStructurePlacement,val weathering:Double,val state:NativeSurfaceState,val foundation:List<RenderVoxel> = emptyList(),val outline:Boolean=false,val entities:NativeStaticEntityPlan?=null,val paper:Boolean=false)
    private val owners=LinkedHashMap<String,Pair<OwnerKey,NativePacketSource>>()
    private fun placement(position:Position3,rotation:Double,offset:Position2)=NativeStructurePlacement(BlockPoint(position.x,position.y,position.z),rotation,offset)
    private val preparedResources=HashMap<String,NativeResourceStructure>()
    private fun entityRequest(owner:String,recipe:BuildingInputRecipe,geometry:OriginalStructure,cancelled:()->Boolean):NativeBlockEntityRequest {
        val resource=resourceCompiler?.compile(recipe,geometry.origin,cancelled);if(resource!=null)preparedResources[owner]=resource
        val indices=geometry.blockEntityIndices()
        // The structure compiler already found metadata while routing blocks.
        // Restore original source order for world-wide admission, without
        // walking every ordinary voxel again on each presentation request.
        val metadata=List(indices.remaining()){indices.get()}.sorted()
        return NativeBlockEntityRequest(owner,recipe.intact,fallbackIndices=metadata.filter{it !in resource?.acceptedMembers.orEmpty()}.toSet(),metadataIndices=metadata)
    }
    private fun check(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Generated world packing superseded")}
    fun prepare(request:WorldRequestIdentity,world:WorldTerrainPlan,options:WorldRenderOptions,cancelled:()->Boolean={false}):NativeWorldFrame =
        preparation.batch(cancelled,enabled=options.resources==null){batch->prepare(request,world,options,batch)}
    private fun prepare(request:WorldRequestIdentity,world:WorldTerrainPlan,options:WorldRenderOptions,batch:WorldPacketPreparation.Batch):NativeWorldFrame {
        val cancelled=batch::cancelled
        check(cancelled)
        val paper=options.quality==NativeLightingQuality.PAPER
        // Scratch for entity membership in this preparation, not another
        // resource cache. Retiring it before the next root is important when
        // restoring originals while the old textured GPU world stays visible.
        preparedResources.clear()
        if(resourceAssets!==options.resources){
            resourceCompiler?.clear();resourceAssets=options.resources
            resourceCompiler=options.resources?.let{NativeResourceStructureCompiler(it.stack,it.textures,it.palette,specials=it.specials)}
            resourcePackets=options.resources?.let{NativeResourcePackets(it.textures)}
            root=null;owners.clear()
        }
        val camera=camera(world,options.aspect,paper);val t=world.terrain;val b=t.bounds
        val half=maxOf(abs(b.minX),abs(b.maxX),abs(b.minZ),abs(b.maxZ));val core=camera.volume.framingRadius
        val environmentContext=NativeEnvironmentContext(options.zone,options.quality,core,half,camera.fittedDistance*.45,
            world.input.spatial.environment==WorldEnvironment.OCEAN,options.coordinates,options.weather,
            NativeSkyOptions(world.input.spatial.environment==WorldEnvironment.FLOATING,world.input.spatial.environment==WorldEnvironment.COAST),options.atmosphere?.inputs?.timeMinutes)
        val sample=options.atmosphere?.let(environmentContext::project)?:environmentContext.sample(options.time)
        // AO is baked into instance rows. Sun, night, water reflection and
        // weather tint are uniforms and must not invalidate these CPU packets.
        val materialState=NativeSurfaceState(ambientOcclusion=options.quality.ambientOcclusion)
        val key=RootKey(world.input.spatial.key,world.cacheKey,world.sceneryKey,materialState,paper)
        val cachedRoot=root?.takeIf{it.first==key}?.second
        val cache=if(paper)paperWorldCache else staticWorldCache?.takeIf{options.resources==null}
        // Keep the original cell edges in the fast pipeline. Merging flat
        // tops introduces long/short edge junctions that can expose sky
        // samples as the camera moves, especially on mobile rasterizers.
        val compactTerrain=compactGeometry&&!paper&&options.quality!=NativeLightingQuality.LOW
        val diskKey=cache?.key(world,materialState.ambientOcclusion,compactTerrain)
        val rootTask=batch.submit{com.blockcolc.preview.NativeStartupTrace.measure("packets-root",benchmark=true){
            val reused=cachedRoot?:diskKey?.let{cache?.read(it,cancelled)?.also{
                com.blockcolc.preview.NativeStartupTrace.point(if(paper)"paper-packets-cache-hit" else "root-packets-cache-hit")
            }}
            if(reused!=null)reused to false else if(paper){
                rootCompiler?.clear();rootCompiler=null
                val target=NativePacketBuilder("world",retainManifest=diskKey!=null)
                PaperWorldMesh.appendRoot(target,world,allocator,cancelled)
                target.build(cancelled) to (diskKey!=null)
            } else {
                val compiler=rootCompiler?:NativeWorldRootCompiler().also{rootCompiler=it}
                compiler.prepare(world,materialState,options.resources,diskKey!=null,compactTerrain,cancelled) to (diskKey!=null)
            }
        }}
        val animalTask=batch.submit{com.blockcolc.preview.NativeStartupTrace.measure("packets-animals",benchmark=true){animals.prepare(world,paper,cancelled)}}
        val cachedGround=ground?.takeIf{it.first==world.cacheKey}?.second
        val groundTask=batch.submit{com.blockcolc.preview.NativeStartupTrace.measure("packets-rain-ground",benchmark=true){cachedGround?:NativePrecipitationGround.prepare(world.surfaces,cancelled)}}
        val inputs=ArrayList<NativePacketSource>()
        val entityPlans=if(paper)emptyMap() else com.blockcolc.preview.NativeStartupTrace.measure("packets-entities"){entities.prepare(world.input.buildings.map{entityRequest("building:${it.fact.id}",it.recipe,it.originalGeometry,cancelled)}+
            world.rewards.map{entityRequest("reward:${it.source.fact.rewardId}",it.source.recipe,it.source.originalGeometry,cancelled)},cancelled)}
        val adopted=LinkedHashMap<String,Pair<OwnerKey,NativePacketSource>>();var pendingEntities=0
        com.blockcolc.preview.NativeStartupTrace.measure("packets-buildings"){
        for(building in world.input.buildings){check(cancelled);val owner="building:${building.fact.id}"
            val pose=placement(building.placement.worldPosition,building.placement.rotationY,building.placement.blueprintOffset)
            val show=options.outlines.shows(building.fact.active,building.fact.completion)
            val entityPlan=entityPlans[owner]
            val input=OwnerKey(building.recipe.key,building.origin,pose,building.recipe.weathering,materialState,outline=show,entities=entityPlan,paper=paper)
            val source=owners[owner]?.takeIf{it.first==input}?.second?:NativePacketBuilder(owner).also{target->
                if(paper)PaperWorldMesh.appendOwner(target,building.recipe.intact,emptyList(),building.origin,pose,building.recipe.weathering,allocator,cancelled)
                else {
                    val plan=checkNotNull(entityPlan)
                    appendStructure(target,owner,building.recipe,building.originalGeometry,pose,materialState,building.recipe.weathering,plan.replacedIndices,cancelled=cancelled)
                    entities.append(target,plan,building.origin,pose,cancelled)
                    construction.appendVines(target,building.recipe.vines,building.origin,pose,materialState,cancelled)
                }
                construction.appendOutline(target,building.blueprint,building.fact.completion,show,building.origin,pose,cancelled,paper=paper)
            }.build(cancelled)
            pendingEntities+=entityPlan?.pendingBlocks?:0;adopted[owner]=input to source;inputs+=source
        }
        }
        com.blockcolc.preview.NativeStartupTrace.measure("packets-rewards"){
        for(reward in world.rewards){check(cancelled);val owner="reward:${reward.source.fact.rewardId}";val p=reward.support.placement
            val pose=placement(p.worldPosition,p.rotationY,p.blueprintOffset);val entityPlan=entityPlans[owner];val origin=reward.source.origin
            val input=OwnerKey(reward.source.recipe.key,origin,pose,0.0,materialState,reward.support.foundation,entities=entityPlan,paper=paper)
            val source=owners[owner]?.takeIf{it.first==input}?.second?:NativePacketBuilder(owner).also{target->
                if(paper)PaperWorldMesh.appendOwner(target,reward.source.recipe.intact,reward.support.foundation,origin,pose,0.0,allocator,cancelled)
                else {
                    val plan=checkNotNull(entityPlan)
                    appendStructure(target,owner,reward.source.recipe,reward.source.originalGeometry,pose,materialState,excluded=plan.replacedIndices,cancelled=cancelled)
                    entities.append(target,plan,origin,pose,cancelled)
                    if(reward.support.foundation.isNotEmpty()){
                        val recipe=BuildingPreparation.staticStructure(reward.support.foundation,"${world.cacheKey}:$owner:foundation",cancelled=cancelled)
                        val mesh=if(resourceCompiler==null)compiler.compile(recipe,origin,cancelled)else null
                        appendStructure(target,owner,recipe,mesh,pose,materialState,origin=origin,cancelled=cancelled)
                    }
                }
            }.build(cancelled)
            pendingEntities+=entityPlan?.pendingBlocks?:0;adopted[owner]=input to source;inputs+=source
        }
        }
        val (rootSource,storeRoot)=rootTask();inputs.add(0,rootSource)
        val animal=animalTask()
        val cloudContext=cloudContext(world)
        val cloud=com.blockcolc.preview.NativeStartupTrace.measure("packets-clouds"){clouds.prepare(cloudContext,sample.weather,options.quality.cloudDensity,cancelled,paper)};inputs+=cloud.source
        val ground=groundTask()
        val visible=camera.volume.visibility;val precipitationContext=NativePrecipitationContext(
            listOf(visible[0][0],visible[1][0],visible[0][2],visible[1][2]),listOf(cloudContext.view.contentWidth,cloudContext.view.contentDepth),ground)
        val rain=com.blockcolc.preview.NativeStartupTrace.measure("packets-rain"){precipitation.prepare(precipitationContext,sample.weather,options.quality.cloudDensity,cloud.randomTail,cancelled,paper)};inputs+=rain.source
        // Pixel and paper retain the same small sky owner. The renderer
        // chooses the pixel dome or the flat paper background at draw time.
        inputs+=sky.prepare(world.input.spatial.environment==WorldEnvironment.FLOATING,cancelled)
        val stormContext=NativeStormContext(camera.target,cloudContext.view.contentWidth,cloudContext.view.contentDepth,cloudContext.baseY)
        inputs+=lightning.prepare(stormContext,cancelled)
        animal?.let{inputs+=it.second}
        val targets=world.input.buildings.map{b->val p=b.placement;NativeOrbitTarget(b.fact.id,BlockPoint(p.worldPosition.x,p.worldPosition.y,p.worldPosition.z),p.footprint.width.toDouble(),p.footprint.depth.toDouble(),(b.blueprint.bounds.maxY-b.blueprint.bounds.minY+1).toDouble())}+
            world.rewards.map{r->val p=r.support.placement;NativeOrbitTarget("reward:${r.source.fact.rewardId}",BlockPoint(p.worldPosition.x,p.worldPosition.y,p.worldPosition.z),p.footprint.width.toDouble(),p.footprint.depth.toDouble(),(r.source.blueprint.bounds.maxY-r.source.blueprint.bounds.minY+1).toDouble())}
        inputs+=NativeInteriorCompiler.empty()
        val pickIndex=com.blockcolc.preview.NativeStartupTrace.measure("packets-picking"){
            picking.prepare(if(paper)inputs.filter{it.owner!="world"} else inputs,animal!=null,cancelled)
        }
        check(cancelled);val scene=NativeGeneratedScene(inputs,sample.lighting,sample.post.copy(worldColor=options.worldColor),camera,request.replacementGeneration,request.revision,sample.surface,sample.cloudColor,sample.sky,sample.fogProjection,
            NativeStormWeather(sample.weather.thunderstorm,sample.weather.seed),stormContext,targets,pickIndex,animal?.first)
        // Cache only the current result. Failed/cancelled packing cannot replace
        // the reusable inputs still supporting the visible generation.
        check(cancelled);root=key to rootSource;owners.clear();owners.putAll(adopted);this.ground=world.cacheKey to ground;preparedResources.clear()
        if(storeRoot&&diskKey!=null)cache?.write(diskKey,rootSource)
        return NativeWorldFrame(request,scene,sample,world.input.spatial.key,world.cacheKey,world.sceneryKey,pendingEntities,environmentContext,cloudContext,cloud,precipitationContext,rain)
    }
    private fun cloudContext(world:WorldTerrainPlan):NativeCloudContext {
        val t=world.terrain;val f=t.framingBounds;val near=t.nearDetailBounds;val bounds=t.bounds
        var minX=f.minX;var maxX=f.maxX;var minZ=f.minZ;var maxZ=f.maxZ;var maxY=4.0
        fun include(p:Position3,top:Double){minX=min(minX,p.x);maxX=max(maxX,p.x);minZ=min(minZ,p.z);maxZ=max(maxZ,p.z);maxY=max(maxY,p.y+top+.5)}
        for(building in world.input.buildings)include(building.placement.worldPosition,building.blueprint.bounds.maxY.toDouble())
        for(reward in world.rewards)include(reward.support.placement.worldPosition,reward.source.blueprint.bounds.maxY.toDouble())
        val vx0=min(bounds.minX,minX);val vx1=max(bounds.maxX,maxX);val vz0=min(bounds.minZ,minZ);val vz1=max(bounds.maxZ,maxZ)
        return NativeCloudContext(NativeCloudView(maxX-minX,maxZ-minZ,vx1-vx0,vz1-vz0,near.maxX-near.minX,near.maxZ-near.minZ),
            (vx0+vx1)/2,(vz0+vz1)/2,max(20.0,max(bounds.maxY,maxY)+9))
    }
    private fun camera(world:WorldTerrainPlan,aspect:Double,paper:Boolean):NativeSceneCamera {
        val t=world.terrain;val framing=t.framingBounds;val b=t.bounds
        val minY= -2.5;var maxY=4.0
        for(building in world.input.buildings)maxY=max(maxY,building.placement.worldPosition.y+building.blueprint.bounds.maxY+1)
        for(reward in world.rewards)maxY=max(maxY,reward.support.placement.worldPosition.y+reward.source.blueprint.bounds.maxY+1)
        val width=framing.maxX-framing.minX;val depth=framing.maxZ-framing.minZ;val radius=max(6.0,sqrt(width*width+(maxY-minY).pow(2)+depth*depth)/2)
        val target=BlockPoint((framing.minX+framing.maxX)/2,max(1.5,(minY+maxY)/2*.68),(framing.minZ+framing.maxZ)/2)
        val fov=40.0;val vertical=fov*PI/180;val horizontal=2*atan(tan(vertical/2)*aspect);val fitted=radius/sin(max(.1,min(vertical,horizontal))/2)*1.04
        val distance=(fitted*.45).coerceIn(min(fitted*.9,max(12.0,fitted*.1)),fitted*.9);val pitch=38*PI/180;val azimuth=PI/4
        val eye=BlockPoint(target.x+distance*cos(pitch)*sin(azimuth),target.y+distance*sin(pitch),target.z+distance*cos(pitch)*cos(azimuth))
        val volume=SourceCamera(radius,listOf(listOf(b.minX,min(b.minY,minY),b.minZ),listOf(b.maxX,max(b.maxY,maxY),b.maxZ)),NativeSky.RADIUS,.82,.91,1.5,NativeSky.RADIUS)
        return NativeSceneCamera(target,eye,fitted,fov,volume,aspect,paper=paper)
    }
    private fun appendStructure(target:NativePacketBuilder,owner:String,recipe:BuildingInputRecipe,original:OriginalStructure?,placement:NativeStructurePlacement,
        state:NativeSurfaceState,weathering:Double=0.0,excluded:Set<Int> = emptySet(),lod:SceneryLod?=null,origin:BlockPoint=original?.origin?:BlockPoint(0.0,0.0,0.0),cancelled:()->Boolean){
        val pack=resourceCompiler
        val cubeContacts = recipe.intact.takeIf { compactGeometry }
        if(pack==null){
            originals.append(target,original?:compiler.compile(recipe,origin,cancelled),placement,state,weathering,lod,excluded,cancelled,
                cubeContacts=cubeContacts)
            return
        }
        val resource=preparedResources[owner]?.takeIf{it.recipeKey==recipe.key&&it.origin==origin}?:pack.compile(recipe,origin,cancelled,excluded)
        // Static entity bodies still use their explicit renderer route. Model
        // replacement must not erase an overlay's metadata or duplicate a body.
        val reserved=excluded
        check(resource.acceptedMembers.none{it in reserved})
        resourcePackets!!.append(target,owner,resource,placement,state,weathering,lod,cancelled)
        val fallback=compiler.compile(recipe,origin,cancelled,NativeSourceIndices.unionView(resource.acceptedMembers,excluded),resource.fluids?.plan?.acceptedFree.orEmpty(),resource.fluids?.plan?.acceptedWaterlogged.orEmpty())
        originals.append(target,fallback,placement,state,weathering,lod,cancelled=cancelled,cubeContacts=cubeContacts)
    }
    fun clear(){rootCompiler?.clear();rootCompiler=null;root=null;owners.clear();compiler.clear();preparedResources.clear();resourceCompiler?.clear();resourceCompiler=null;resourcePackets=null;resourceAssets=null;materials.clear();clouds.clear();precipitation.clear();sky.clear();lightning.clear();picking.clear();entities.clear();animals.clear();ground=null}
    override fun close(){try{clear()}finally{preparation.close()}}
}
