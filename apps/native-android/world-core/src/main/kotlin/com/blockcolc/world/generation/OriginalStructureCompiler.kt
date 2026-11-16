package com.blockcolc.world.generation

import java.nio.FloatBuffer
import java.nio.IntBuffer
import java.util.Collections
import java.util.IdentityHashMap
import java.util.concurrent.CancellationException

enum class OriginalDrawRoute { FLOWER,DETAIL,JOINED_GLASS,FLUID,COMPONENT,CUBE }
sealed interface OriginalDrawMaterial {
    data class Pattern(val style:OriginalVisualStyle):OriginalDrawMaterial
    data class Detail(val texture:OriginalDetailTexture,val roughness:Double=.82,val metalness:Double=0.0):OriginalDrawMaterial
    data object Plant:OriginalDrawMaterial
    data class Glass(val color:Int,val opacity:Double=.36,val roughness:Double=.12,val metalness:Double=.08):OriginalDrawMaterial
    data class Fluid(val kind:OriginalFluid,val waterlogged:Boolean):OriginalDrawMaterial {
        val opacity get()=if(kind==OriginalFluid.LAVA)1.0 else if(waterlogged).48 else .76
    }
}

/** Source membership is independent of GPU instance count: a joined glass
 * surface has one instance but may contain many source cells. -1 means the
 * geometry is already owner-local, not an invented source voxel identity. */
class OriginalDrawBatch internal constructor(val route:OriginalDrawRoute,val geometry:BlockGeometry,val material:OriginalDrawMaterial,val emission:EffectiveEmission,
    private val members:IntArray,private val instances:IntArray,private val matrix:FloatArray,private val ao:FloatArray,private val faceAo:IntArray,
    private val response:IntArray=IntArray(instances.size)) {
    val instanceCount get()=instances.size
    init {require(matrix.size==instances.size*16&&ao.size==instances.size&&faceAo.size==instances.size&&response.size==instances.size)}
    fun members():IntBuffer=IntBuffer.wrap(members).asReadOnlyBuffer()
    fun instanceMembers():IntBuffer=IntBuffer.wrap(instances).asReadOnlyBuffer()
    fun matrices():FloatBuffer=FloatBuffer.wrap(matrix).asReadOnlyBuffer()
    fun occlusion():FloatBuffer=FloatBuffer.wrap(ao).asReadOnlyBuffer()
    fun faceOcclusion():IntBuffer=IntBuffer.wrap(faceAo).asReadOnlyBuffer()
    fun materialResponse():IntBuffer=IntBuffer.wrap(response).asReadOnlyBuffer()
    val instanceByteSize get()=(members.size+instances.size+matrix.size+ao.size+faceAo.size+response.size)*4L
}

/** Original route only. Fluid cells retain their packed surface inputs, and
 * block-entity overlays remain explicitly named rather than discarded. Pack
 * model resolution must run before this fallback route at the render boundary. */
class OriginalStructure internal constructor(val inputKey:String,val sourceCount:Int,val origin:BlockPoint,batches:List<OriginalDrawBatch>,
    private val invisible:IntArray,private val fluids:IntArray,private val entities:IntArray) {
    val batches:List<OriginalDrawBatch> = Collections.unmodifiableList(batches.toList())
    fun invisibleIndices():IntBuffer=IntBuffer.wrap(invisible).asReadOnlyBuffer()
    fun fluidIndices():IntBuffer=IntBuffer.wrap(fluids).asReadOnlyBuffer()
    fun blockEntityIndices():IntBuffer=IntBuffer.wrap(entities).asReadOnlyBuffer()
    val estimatedBytes:Long=run {
        val geometries=Collections.newSetFromMap(IdentityHashMap<BlockGeometry,Boolean>())
        val textures=Collections.newSetFromMap(IdentityHashMap<OriginalDetailTexture,Boolean>())
        var size=256L+(invisible.size+fluids.size+entities.size)*4L
        for(batch in batches){size+=batch.instanceByteSize+128;if(geometries.add(batch.geometry))size+=batch.geometry.byteSize
            val texture=(batch.material as? OriginalDrawMaterial.Detail)?.texture;if(texture!=null&&textures.add(texture))size+=texture.byteSize}
        size
    }
}

/** Generation-worker owner. Keeps only bounded reusable assets, never a graph
 * of source owners. Owner coordinates are rebased in Double before narrowing;
 * the final parent placement must restore origin before its world transform. */
class OriginalStructureCompiler(private val styles:OriginalMaterialStyles=OriginalMaterialStyles(),private val shapePlans:OriginalBlockShapes=OriginalBlockShapes(),
    private val components:OriginalGeometryCompiler=OriginalGeometryCompiler(),private val assetBudget:Long=16L*1024*1024) {
    private data class StateKey(val id:String?,val properties:List<Pair<String,String>>,val material:String)
    private val details=OriginalBlockDetails(styles)
    private val fluidPlanner=OriginalFluids(styles)
    private class Asset(val geometry:BlockGeometry?=null,val texture:OriginalDetailTexture?=null) {val bytes=(geometry?.byteSize?:0)+(texture?.byteSize?:0)+256}
    private val assets=LinkedHashMap<Any,Asset>(16,.75f,true);var retainedAssetBytes=0L;private set
    private val cube=CuboidGeometry.create()
    init {require(assetBudget>=0)}
    private fun asset(key:Any,make:()->Asset):Asset {
        assets[key]?.let{return it};val value=make()
        if(value.bytes<=assetBudget){while(assets.isNotEmpty()&&retainedAssetBytes+value.bytes>assetBudget){val first=assets.entries.iterator();retainedAssetBytes-=first.next().value.bytes;first.remove()};assets[key]=value;retainedAssetBytes+=value.bytes}
        return value
    }
    private fun stateKey(v:RenderVoxel)=StateKey(v.sourceBlockId,v.sourceBlockState.orEmpty().entries.map{it.key to it.value}.sortedBy{it.first},v.materialId)
    fun compile(recipe:BuildingInputRecipe,origin:BlockPoint=BlockPoint(0.0,0.0,0.0),cancelled:()->Boolean={false},excludedMembers:Set<Int> = emptySet(),excludedFreeFluids:Set<Int> = emptySet(),excludedWaterloggedFluids:Set<Int> = emptySet()):OriginalStructure {
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Structure geometry superseded")}
        checkpoint();val source=recipe.intact
        require(excludedMembers.all{it in source.indices})
        val voxels=if(origin.x==0.0&&origin.y==0.0&&origin.z==0.0)source else source.mapIndexed{i,v->if(i%128==0)checkpoint();v.copy(x=v.x-origin.x,y=v.y-origin.y,z=v.z-origin.z)}
        val candidateCache=HashMap<String?,Boolean>()
        fun candidate(v:RenderVoxel)=candidateCache[v.sourceBlockId]?:shapePlans.isCandidate(v.sourceBlockId).also{if(candidateCache.size<4096)candidateCache[v.sourceBlockId]=it}
        // The formal renderer puts generic candidates first, known non-cubes
        // last. Keep that order for grouping, component limits and reveal IDs.
        val order=sequence {
            for(known in listOf(false,true))for(index in voxels.indices){
                if(index%128==0)checkpoint();val v=voxels[index]
                if(candidate(v)!=known)continue
                if(index in excludedMembers&&v.sign==null&&v.campfire==null)continue
                yield(index)
            }
        }
        val invisible=ArrayList<Int>();val fluids=ArrayList<Int>();val entities=ArrayList<Int>();val remaining=ArrayList<Int>()
        val flowers=linkedMapOf<String,MutableList<Int>>();val detailGroups=linkedMapOf<StateKey,Pair<List<DetailCuboid>,MutableList<Int>>>();val glass=linkedMapOf<String,MutableList<Int>>()
        for(index in order) {
            if(index%128==0)checkpoint();val v=voxels[index]
            // Entity overlays still belong to accepted pack models. Exclude
            // geometry before joined-glass/plant grouping, never after meshing.
            if(index in excludedMembers){if(v.sign!=null||v.campfire!=null)entities+=index;continue}
            if(OriginalBlockVisibility.invisible(v)){invisible+=index;continue}
            if(v.sign!=null||v.campfire!=null)entities+=index // retained overlay inputs, not discarded
            val plant=OriginalFlowers.key(v)
            if(plant!=null){flowers.getOrPut(plant){arrayListOf()}.add(index);continue}
            val key=stateKey(v);val parts=detailGroups[key]?.first?:details.parts(v)
            if(parts!=null){detailGroups.getOrPut(key){parts to arrayListOf()}.second.add(index);continue}
            if(ConnectedOriginalGlass.accepts(v)){glass.getOrPut(v.sourceBlockId?:"builtin:glass"){arrayListOf()}.add(index);continue}
            if(styles.fluid(v.sourceBlockId)!=null){fluids+=index;continue}
            remaining+=index
        }
        val batches=ArrayList<OriginalDrawBatch>();val noEmission=EffectiveEmission("",0)
        fun batch(route:OriginalDrawRoute,geometry:BlockGeometry,material:OriginalDrawMaterial,members:List<Int>,emission:EffectiveEmission=noEmission,transforms:(Int)->BlockTransform,
            occlusion:Boolean=false) {
            val matrices=FloatArray(members.size*16);val ao=FloatArray(members.size);val face=IntArray(members.size)
            for((i,index)in members.withIndex()){if(i%128==0)checkpoint();val m=transforms(index);for(j in 0..15)matrices[i*16+j]=m[j].toFloat().also{require(it.isFinite())}
                if(occlusion){ao[i]=recipe.occlusion(index);face[i]=recipe.faceWord(index)}}
            val ids=members.toIntArray();batches+=OriginalDrawBatch(route,geometry,material,emission,ids,ids,matrices,ao,face)
        }
        for((key,members)in flowers) {
            checkpoint();val geometry=asset("plant:$key"){Asset(geometry=OriginalFlowers.geometry(key))}.geometry!!
            batch(OriginalDrawRoute.FLOWER,geometry,OriginalDrawMaterial.Plant,members,transforms={i->voxels[i].let{BlockTransform.translation(it.x,it.y,it.z)}})
        }
        for((key,group)in detailGroups) {
            checkpoint();val first=voxels[group.second.first()]
            val geometry=asset(group.first){Asset(geometry=details.geometry(group.first))}.geometry!!
            val texture=asset(key){Asset(texture=details.pixels(first))}.texture!!
            val materialName=(first.sourceBlockId?:"")+first.sourceBlockState.orEmpty().toString()
            val metalness=if(materialName.contains("anvil")||materialName.contains("hopper")||materialName.contains("chain")) .3 else 0.0
            batch(OriginalDrawRoute.DETAIL,geometry,OriginalDrawMaterial.Detail(texture,metalness=metalness),group.second,transforms={details.transform(voxels[it])})
        }
        for((_,members)in glass) {
            checkpoint();val geometry=ConnectedOriginalGlass.surface(members.map{voxels[it]},cancelled=cancelled)
            val material=OriginalDrawMaterial.Glass(styles.voxel(voxels[members.first()]).color)
            batches+=OriginalDrawBatch(OriginalDrawRoute.JOINED_GLASS,geometry,material,noEmission,members.toIntArray(),intArrayOf(-1),FloatArray(16){BlockTransform.IDENTITY[it].toFloat()},floatArrayOf(0f),intArrayOf(0))
        }
        for(plan in listOf(fluidPlanner.waterlogged(voxels,cancelled=cancelled),fluidPlanner.free(voxels,cancelled=cancelled)))for(fluid in plan.batches) {
            checkpoint();val entries=fluid.entries.filter{it.sourceIndex !in if(fluid.waterlogged)excludedWaterloggedFluids else excludedFreeFluids};if(entries.isEmpty())continue
            val members=IntArray(entries.size){entries[it].sourceIndex};val matrices=FloatArray(members.size*16)
            for((i,index)in members.withIndex()){if(i%128==0)checkpoint();val v=voxels[index];val transform=BlockTransform.translation(v.x,v.y,v.z)
                for(j in 0..15)matrices[i*16+j]=transform[j].toFloat().also{require(it.isFinite())}}
            val geometry=asset("fluid:${fluid.faceMask}:${fluid.waterlogged}"){Asset(geometry=OriginalFluids.geometry(fluid.faceMask,fluid.waterlogged))}.geometry!!
            batches+=OriginalDrawBatch(OriginalDrawRoute.FLUID,geometry,OriginalDrawMaterial.Fluid(fluid.kind,fluid.waterlogged),noEmission,members,members,matrices,FloatArray(members.size),
                IntArray(members.size){entries[it].packedMetadata},IntArray(members.size){entries[it].packedCorners})
        }
        val static=remaining.filter{candidate(voxels[it])};val compiled=components.compile(static.map{voxels[it]},cancelled=cancelled)
        val handled=HashSet<Int>();val it=compiled.handledIndices();while(it.hasRemaining())handled+=static[it.get()]
        for(part in compiled.batches) {
            checkpoint();val indices=part.voxelIndices();val members=IntArray(indices.remaining()){static[indices.get()]}
            val matrix=part.matrices();batches+=OriginalDrawBatch(OriginalDrawRoute.COMPONENT,part.geometry,OriginalDrawMaterial.Pattern(part.material),part.emission,
                members,members,FloatArray(matrix.remaining()){matrix.get()},FloatArray(members.size){recipe.occlusion(members[it])},IntArray(members.size){recipe.faceWord(members[it])})
        }
        data class CubeKey(val material:OriginalVisualStyle,val emission:EffectiveEmission)
        val cubes=linkedMapOf<CubeKey,MutableList<Int>>();val styleCache=HashMap<Pair<String?,String>,OriginalVisualStyle>()
        for(index in remaining)if(index !in handled){
            if(index%128==0)checkpoint();val v=voxels[index];val identity=v.sourceBlockId to v.materialId
            val style=styleCache[identity]?:styles.voxel(v).also{if(styleCache.size<4096)styleCache[identity]=it}
            cubes.getOrPut(CubeKey(style,OriginalEmission.effective(v))){arrayListOf()}.add(index)
        }
        for((key,members)in cubes){checkpoint();batch(OriginalDrawRoute.CUBE,cube,OriginalDrawMaterial.Pattern(key.material),members,key.emission,
            transforms={i->voxels[i].let{BlockTransform.translation(it.x,it.y,it.z)}},occlusion=true)}
        checkpoint();return OriginalStructure(recipe.key,source.size,origin,batches,invisible.toIntArray(),fluids.toIntArray(),entities.toIntArray())
    }
    fun clear(){assets.clear();retainedAssetBytes=0;components.clear()}
}

/** Current version per owner only, never every progress step. Admission is an
 * estimated CPU budget, not a PSS claim; published results survive eviction. */
interface OriginalStructureStorage {
    fun read(key:String,cancelled:()->Boolean):OriginalStructure?
    fun offer(key:String,value:OriginalStructure)
}
class OriginalStructureCache(private val compiler:OriginalStructureCompiler=OriginalStructureCompiler(),private val budgetBytes:Long=48L*1024*1024,
    private val storage:OriginalStructureStorage?=null) {
    private data class Value(val recipeKey:String,val origin:BlockPoint,val mesh:OriginalStructure)
    private val entries=LinkedHashMap<String,Value>(16,.75f,true)
    var retainedBytes=0L;private set
    val size get()=entries.size
    init {require(budgetBytes>=0)}
    fun prepare(owner:String,recipe:BuildingInputRecipe,origin:BlockPoint,cancelled:()->Boolean={false}):OriginalStructure {
        if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Structure cache superseded")
        entries[owner]?.takeIf{it.recipeKey==recipe.key&&it.origin==origin}?.let{return it.mesh}
        val key=if(storage!=null)OriginalStructureCodec.key(recipe.key,origin)else null
        val cached=(try{key?.let{storage?.read(it,cancelled)}}catch(error:CancellationException){throw error}catch(_:Exception){null})
            ?.takeIf{it.inputKey==recipe.key&&it.origin==origin&&it.sourceCount==recipe.intact.size}
        val result=cached?:compiler.compile(recipe,origin,cancelled)
        if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Structure cache superseded")
        if(cached==null&&key!=null)try{storage?.offer(key,result)}catch(_:Exception){/* Optional derived storage never owns the live result. */}
        entries.remove(owner)?.let{retainedBytes-=it.mesh.estimatedBytes}
        if(result.estimatedBytes<=budgetBytes){while(entries.isNotEmpty()&&retainedBytes+result.estimatedBytes>budgetBytes){val first=entries.entries.iterator();retainedBytes-=first.next().value.mesh.estimatedBytes;first.remove()}
            entries[owner]=Value(recipe.key,origin,result);retainedBytes+=result.estimatedBytes}
        return result
    }
    fun retainOwners(owners:Set<String>){val iterator=entries.entries.iterator();while(iterator.hasNext()){val entry=iterator.next();if(entry.key !in owners){retainedBytes-=entry.value.mesh.estimatedBytes;iterator.remove()}}}
    fun clear(){entries.clear();retainedBytes=0;compiler.clear()}
}
