package com.blockcolc.world

import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.*
import java.nio.FloatBuffer
import java.nio.IntBuffer
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.CancellationException

class NativeResourceDrawBatch internal constructor(val part:NativeResourceModelPart,val emission:EffectiveEmission,val response:OriginalResponse,
    private val members:IntArray,private val transforms:FloatBuffer,private val ao:FloatArray,private val face:IntArray){
    val instanceCount=members.size
    val byteSize=members.size*80L+128
    fun members():IntBuffer=IntBuffer.wrap(members).asReadOnlyBuffer()
    fun matrices():FloatBuffer=transforms.asReadOnlyBuffer()
    fun occlusion():FloatBuffer=FloatBuffer.wrap(ao).asReadOnlyBuffer()
    fun faceWords():IntBuffer=IntBuffer.wrap(face).asReadOnlyBuffer()
}
class NativeResourceStructure internal constructor(val recipeKey:String,val stackIdentity:String,internal val atlas:ResourceTextureAtlas,val origin:BlockPoint,
    batches:List<NativeResourceDrawBatch>,accepted:Set<Int>,fallbacks:Map<Int,String>,val fluids:NativeResourceFluidPrepared?=null,val sourceVoxels:List<RenderVoxel> = emptyList(),specials:List<NativeResourceSpecialDraw> = emptyList()){
    val specials=Collections.unmodifiableList(specials.toList())
    val batches:List<NativeResourceDrawBatch> = Collections.unmodifiableList(batches.toList())
    val acceptedMembers:Set<Int> = Collections.unmodifiableSet(if(accepted is NativeSourceIndexSet)accepted else LinkedHashSet(accepted))
    val fallbacks:Map<Int,String> = Collections.unmodifiableMap(LinkedHashMap(fallbacks))
}

/** One generation-worker resource stack. Reusable models are bounded; the
 * archive owner remains alive for the compiler's entire lifetime. */
class NativeResourceStructureCompiler(private val stack:ResourcePackStack,val textures:NativeAtlasTextures,
    private val palette:ResourceBiomePalette=ResourceBiomePalette.from(stack),private val styles:OriginalMaterialStyles=OriginalMaterialStyles(),
    private val assetBudget:Long=32L*1024*1024,private val structureBudget:Long=48L*1024*1024,private val specials:NativeResourceSpecialCompiler=NativeResourceSpecialCompiler(stack)){
    private data class Query(val id:String,val state:List<Pair<String,String>>,val selection:String?)
    private data class Asset(val result:NativeResourceModelResult,val keys:List<String>,val bytes:Long)
    private data class PartKey(val shape:String,val page:Int,val alpha:String,val emission:EffectiveEmission,val response:OriginalResponse)
    private data class Group(val part:NativeResourceModelPart,val emission:EffectiveEmission,val response:OriginalResponse,val members:MutableList<Int>)
    private val resolver=stack.resolver()
    private val weightedBlocks=HashMap<String,Boolean>()
    private val models=LinkedHashMap<Query,Asset>(16,.75f,true)
    private val shapes=LinkedHashMap<String,Pair<NativeResourceModelPart,Long>>(16,.75f,true)
    var retainedBytes=0L;private set
    internal val cachedModelQueries get()=models.size
    init{require(assetBudget>=0&&structureBudget>=0)}
    private fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Resource structure superseded")}
    private fun weighted(id:String):Boolean=weightedBlocks[id]?:run{
        val value=stack.blocks.state(id)?.let{it.variants.any{v->v.choices.size>1}||it.multipart?.any{p->p.apply.size>1}==true}?:false
        if(weightedBlocks.size<4096)weightedBlocks[id]=value;value
    }
    private fun identity(part:NativeResourceModelPart):String{
        val hash=MessageDigest.getInstance("SHA-256")
        for(b in listOfNotNull(part.geometry.positions(),part.geometry.normals(),part.geometry.textureCoordinates(),part.geometry.colors(),part.geometry.colorAlpha())){
            val view=b.duplicate();val bytes=java.nio.ByteBuffer.allocate(4).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            while(view.hasRemaining()){bytes.clear();bytes.putFloat(view.get());hash.update(bytes.array())}
        }
        val index=checkNotNull(part.geometry.indices());val bytes=java.nio.ByteBuffer.allocate(4).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        while(index.hasRemaining()){bytes.clear();bytes.putInt(index.get());hash.update(bytes.array())}
        val digest=hash.digest();val digits="0123456789abcdef"
        val hex=CharArray(digest.size*2){i->val n=digest[i/2].toInt()and 255;digits[if(i%2==0)n ushr 4 else n and 15]}
        return "${part.page}:${part.alphaMode}:${part.geometry.vertexCount}:"+String(hex)
    }
    private fun evict(){
        while(retainedBytes>assetBudget&&models.isNotEmpty()){val iterator=models.entries.iterator();retainedBytes-=iterator.next().value.bytes;iterator.remove()}
        while(retainedBytes>assetBudget&&shapes.isNotEmpty()){val iterator=shapes.entries.iterator();retainedBytes-=iterator.next().value.second;iterator.remove()}
    }
    fun compile(recipe:BuildingInputRecipe,origin:BlockPoint=BlockPoint(0.0,0.0,0.0),cancelled:()->Boolean={false},reservedMembers:Set<Int> = emptySet()):NativeResourceStructure{
        checkpoint(cancelled);val groups=LinkedHashMap<PartKey,Group>();val accepted=NativeSourceIndexSet.Builder(recipe.intact.size);val fallbacks=LinkedHashMap<Int,String>()
        require(reservedMembers.all{it in recipe.intact.indices})
        var bytes=0L;val specialDraws=ArrayList<NativeResourceSpecialDraw>();val specialShapes=HashSet<NativeResourceSpecialModels.Part>();val specialTextures=HashSet<NativePixelTexture>()
        for((index,v)in recipe.intact.withIndex()){
            if(index%64==0)checkpoint(cancelled)
            val id=v.sourceBlockId
            if(index in reservedMembers){fallbacks[index]="RESERVED_RENDER_ROUTE";continue}
            if(OriginalBlockVisibility.invisible(v)){fallbacks[index]="INVISIBLE_BLOCK";continue}
            if(id==null){fallbacks[index]="NO_SOURCE_BLOCK";continue}
            if(styles.fluid(id)!=null){fallbacks[index]="FLUID_ROUTE";continue}
            val properties=v.sourceBlockState.orEmpty()
            val position=if(weighted(id))ResourceBlockPosition(v.x,v.y,v.z)else null
            val query=Query(id,properties.toList().sortedBy{it.first},if(position==null)null else resolver.geometryChoiceKey(id,properties,position,cancelled))
            val asset=models[query]?:run{
                val mapped=NativeResourceAtlasMapping.geometry(resolver.geometry(id,properties,position,cancelled),textures.atlas)
                val decoded=NativeResourceGeometry.compile(id,properties,mapped,textures.atlas,palette,cancelled)
                val keys=if(decoded is NativeResourceModelResult.Model)decoded.parts.map(::identity)else emptyList()
                // Position-weighted variants often resolve to the same few meshes.
                // Cache each query's result, but retain one copy of its geometry.
                val model=if(decoded is NativeResourceModelResult.Model)NativeResourceModelResult.Model(decoded.parts.mapIndexed{index,part->
                    val shape=keys[index]
                    val canonical=shapes[shape]?.first?:part.also{
                        val size=it.geometry.byteSize+256
                        if(size<=assetBudget){shapes[shape]=it to size;retainedBytes+=size;evict()}
                    }
                    if(canonical===part)part else NativeResourceModelPart(part.page,part.alphaMode,canonical.geometry,part.resources)
                })else decoded
                val size=256L+query.id.length*2+query.state.sumOf{(it.first.length+it.second.length)*2L}+
                    if(model is NativeResourceModelResult.Model)model.parts.sumOf{it.geometry.byteSize+256}else 64
                Asset(model,keys,size).also{if(size<=assetBudget){models[query]=it;retainedBytes+=size;evict()}}
            }
            val result=asset.result
            if(result is NativeResourceModelResult.Fallback){
                val special=specials.compile(v,index,cancelled)
                if(special==null){fallbacks[index]=result.reason;continue}
                for(draw in special){bytes+=128;if(specialShapes.add(draw.part))bytes+=draw.part.geometry.byteSize;val texture=draw.material.texture!!;if(specialTextures.add(texture))bytes+=texture.width.toLong()*texture.height*4}
                require(bytes<=structureBudget){"Special structure exceeds budget"};specialDraws+=special;accepted+=index;continue
            }
            result as NativeResourceModelResult.Model
            val emission=OriginalEmission.effective(v);val response=styles.response(id,v.materialId)
            for((partIndex,part)in result.parts.withIndex()){
                val shape=asset.keys[partIndex];val key=PartKey(shape,part.page,part.alphaMode,emission,response)
                val group=groups[key]?:run{
                    val reused=shapes[shape]?.first?.takeIf{it.page==part.page&&it.alphaMode==part.alphaMode}?:part.also{
                        val size=it.geometry.byteSize+256;if(size<=assetBudget){shapes[shape]=it to size;retainedBytes+=size;evict()}}
                    bytes+=reused.geometry.byteSize+256
                    require(bytes<=structureBudget){"Resource structure exceeds geometry budget"}
                    Group(reused,emission,response,arrayListOf()).also{groups[key]=it}
                }
                bytes+=80;require(bytes<=structureBudget){"Resource structure exceeds instance budget"};group.members+=index
            }
            accepted+=index
        }
        val batches=groups.values.map{g->checkpoint(cancelled);val members=g.members.toIntArray();val matrices=NativePacketBuffers.floats(members.size*16)
            val ao=FloatArray(members.size);val face=IntArray(members.size)
            for((i,index)in members.withIndex()){
                if(i%128==0)checkpoint(cancelled);val v=recipe.intact[index];val m=BlockTransform.translation(v.x-origin.x,v.y-origin.y,v.z-origin.z)
                repeat(16){matrices.put(i*16+it,m[it].toFloat().also{n->require(n.isFinite())})};ao[i]=recipe.occlusion(index);face[i]=recipe.faceWord(index)
            }
            NativeResourceDrawBatch(g.part,g.emission,g.response,members,matrices,ao,face)
        }
        checkpoint(cancelled);val fluids=NativeResourceFluidGeometry.prepare(recipe.intact,textures.atlas,palette,origin,structureBudget,cancelled)
        return NativeResourceStructure(recipe.key,stack.identity,textures.atlas,origin,batches,accepted.freeze(),fallbacks,fluids,recipe.intact,specialDraws)
    }
    fun clear(){models.clear();shapes.clear();weightedBlocks.clear();specials.clear();retainedBytes=0}
}

/** Same packet/transaction path as original structures, including per-face AO
 * and emission. Unresolved members remain available for the original route. */
class NativeResourcePackets(private val textures:NativeAtlasTextures,private val library:OriginalMaterialLibrary=OriginalMaterialLibrary.bundled){
    fun append(target:NativePacketBuilder,owner:String,structure:NativeResourceStructure,placement:NativeStructurePlacement,state:NativeSurfaceState,
        weathering:Double=0.0,lod:SceneryLod?=null,cancelled:()->Boolean={false},fog:Boolean=true){
        require(weathering.isFinite()&&weathering in 0.0..1.0)
        require(structure.atlas===textures.atlas){"Resource structure belongs to another atlas"}
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Resource packets superseded")}
        checkpoint();NativeResourceSpecialPackets.append(target,structure.specials,structure.sourceVoxels,structure.origin,placement,lod,cancelled)
        val active=(structure.batches.flatMap{it.part.resources}+structure.fluids?.batches.orEmpty().flatMap{it.resources}).toSet();val bindings=textures.forOwner(owner,active)
        structure.fluids?.let{NativeResourceFluidPackets(textures).append(target,owner,it,structure.sourceVoxels,placement,state,lod,cancelled,bindings)}
        val parent=placement.parent(structure.origin)
        for(batch in structure.batches){checkpoint();val part=batch.part;val response=library.response(batch.response);val surface=NativeSurfaceBinding(if(part.alphaMode=="translucent")0f else .025f)
            val strength=(batch.emission.level/15f)*1.55f
            val material=NativeRenderMaterial(color=LinearRgb.WHITE.let{c->val f=(1-weathering*.28).toFloat();LinearRgb(c.red*f,c.green*f,c.blue*f)},texture=bindings.getValue(part.page).color,
                roughness=minOf(1.0,response.roughness+weathering*.1).toFloat(),metalness=response.metalness.toFloat(),transparent=part.alphaMode=="translucent",
                vertexColors=true,alphaCutoff=if(part.alphaMode=="cutout").5f else 0f,atlas=bindings.getValue(part.page),surface=surface.resolve(state),fog=fog,
                emission=if(strength==0f)LinearRgb.BLACK else LinearRgb.fromSrgb(when{batch.emission.kind.contains("soul",true)->0x65cfe3;batch.emission.kind.contains("redstone",true)->0xe94b35;else->0xffb45f}),
                emissionStrength=state.nightFactor*strength,environment=NativeMaterialBinding(surface,if(strength==0f)null else strength))
            val matrix=batch.matrices();val transformed=NativePacketBuffers.floats(batch.instanceCount*16);val colors=NativePacketBuffers.floats(batch.instanceCount*4);val aux=NativePacketBuffers.floats(batch.instanceCount*4)
            val ao=batch.occlusion();val face=batch.faceWords()
            repeat(batch.instanceCount){i->if(i%128==0)checkpoint();val world=parent*BlockTransform.fromElements(DoubleArray(16){matrix.get(i*16+it).toDouble()})
                repeat(16){transformed.put(i*16+it,world[it].toFloat().also{v->require(v.isFinite())})}
                repeat(3){colors.put(i*4+it,1-ao.get(i)*state.ambientOcclusion*.7f)};colors.put(i*4+3,1f)
                aux.put(i*4,face.get(i).toFloat());aux.put(i*4+1,batch.response.code.toFloat())
            }
            target.add(part.geometry,material,transformed,colors,aux,castShadow=part.alphaMode!="translucent",receiveShadow=true,priority=if(material.transparent)5 else 4,lod=lod)
        }
        checkpoint()
    }
}
