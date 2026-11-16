package com.blockcolc.world.generation

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Collections
import java.util.IdentityHashMap
import java.util.concurrent.CancellationException

/** A bounded recomputable artifact, not a blueprint import or domain backup.
 * Block/state palettes are shared across objects. Far LOD stores source-list
 * indices, so restoration preserves the same subset identity used by meshes. */
object SceneryCodec {
    const val MAX_BYTES=32*1024*1024
    const val HEADER_BYTES=80
    private const val MAGIC=0x314e4353
    private const val FORMAT=1
    private const val GENERATOR=4
    private const val MAX_OBJECTS=8192
    private const val MAX_PALETTE=16384
    private const val MAX_VOXELS=1000000
    private const val MAX_STRING=4096
    private data class Kind(val material:String,val block:String,val state:Map<String,String>?)
    private fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Scenery cache superseded")}
    private fun keyBytes(key:String):ByteArray {
        require(key.matches(Regex("[a-f0-9]{64}")))
        return ByteArray(32){key.substring(it*2,it*2+2).toInt(16).toByte()}
    }
    fun isCandidateHeader(key:String,header:ByteArray,totalBytes:Long):Boolean {
        if(header.size!=HEADER_BYTES||totalBytes !in HEADER_BYTES.toLong()..MAX_BYTES.toLong())return false
        return try {
            val b=ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
            b.int==MAGIC&&b.int==FORMAT&&b.int==GENERATOR&&b.int.toLong()==totalBytes&&
                MessageDigest.isEqual(ByteArray(32).also{b.get(it)},keyBytes(key))
        }catch(_:IllegalArgumentException){false}
    }
    fun encode(key:String,scene:WorldScenery,cancelled:()->Boolean={false}):ByteArray? {
        var bytes:ByteArray?=null
        val result=encodeBuffer(key,scene,{size->ByteArray(size).also{bytes=it}.let(ByteBuffer::wrap)},cancelled)
        return if(result==null)null else bytes
    }
    private fun digest(bytes:ByteBuffer,cancelled:()->Boolean):ByteArray {
        val hash=MessageDigest.getInstance("SHA-256");var offset=HEADER_BYTES
        while(offset<bytes.limit()){checkpoint(cancelled);val size=minOf(65536,bytes.limit()-offset);hash.update(bytes.duplicate().apply{position(offset);limit(offset+size)});offset+=size}
        return hash.digest()
    }
    fun encodeBuffer(key:String,scene:WorldScenery,allocate:(Int)->ByteBuffer,cancelled:()->Boolean={false}):ByteBuffer? {
        checkpoint(cancelled);val keyData=keyBytes(key)
        if(scene.objects.size>MAX_OBJECTS)return null
        val palette=LinkedHashMap<Kind,Int>();var bodyBytes=12L+(if(scene.village==null)0 else 32);var voxelCount=0L
        val ids=HashSet<String>()
        fun validRect(x:Double,z:Double,width:Double,depth:Double)=listOf(x,z,width,depth).all(Double::isFinite)&&width>0&&depth>0
        scene.village?.let{if(!validRect(it.x,it.z,it.width,it.depth))return null}
        fun textSize(s:String):Long {val n=s.toByteArray(Charsets.UTF_8).size;require(n<=MAX_STRING);return 4L+n}
        try {
            for(o in scene.objects) {
                checkpoint(cancelled)
                if(!o.id.startsWith("scenery:")||!ids.add(o.id)||!o.y.isFinite()||!validRect(o.x,o.z,o.width,o.depth))return null
                bodyBytes+=textSize(o.id)+52L+o.blocks.voxels.size*28L+o.blocks.distantVoxels.size*4L
                voxelCount+=o.blocks.voxels.size;if(voxelCount>MAX_VOXELS||bodyBytes>MAX_BYTES-HEADER_BYTES)return null
                for((i,v)in o.blocks.voxels.withIndex()) {
                    if(i%1024==0)checkpoint(cancelled)
                    if(v.buildOrder!=0||!v.x.isFinite()||!v.y.isFinite()||!v.z.isFinite())return null
                    if(v.movingPistonMovedState!=null||v.movingPistonPose!=null||v.sign!=null||v.campfire!=null||v.emissiveKind!=null||v.emissiveLevel!=null)return null
                    val kind=Kind(v.materialId,v.sourceBlockId?:return null,v.sourceBlockState)
                    if(kind !in palette) {
                        if(kind.material.isEmpty()||!kind.block.startsWith("minecraft:")||kind.block.length<=10||kind.state?.keys?.any{it.isEmpty()}==true)return null
                        if(palette.size>=MAX_PALETTE)return null
                        palette[kind]=palette.size
                        bodyBytes+=textSize(kind.material)+textSize(kind.block)+4
                        if((kind.state?.size?:0)>64)return null
                        for((k,value)in kind.state.orEmpty())bodyBytes+=textSize(k)+textSize(value)
                    }
                }
            }
        }catch(_:IllegalArgumentException){return null}
        if(bodyBytes>MAX_BYTES-HEADER_BYTES)return null
        val size=(HEADER_BYTES+bodyBytes).toInt();val b=allocate(size).order(ByteOrder.LITTLE_ENDIAN)
        require(!b.isReadOnly&&b.position()==0&&b.remaining()==size)
        b.putInt(MAGIC).putInt(FORMAT).putInt(GENERATOR).putInt(size).put(keyData);b.position(HEADER_BYTES)
        fun text(s:String){val data=s.toByteArray(Charsets.UTF_8);b.putInt(data.size).put(data)}
        b.putInt(scene.objects.size).putInt(if(scene.village==null)0 else 1)
        scene.village?.let{b.putDouble(it.x).putDouble(it.z).putDouble(it.width).putDouble(it.depth)}
        b.putInt(palette.size)
        for(kind in palette.keys) {
            checkpoint(cancelled);text(kind.material);text(kind.block);b.putInt(kind.state?.size?:-1)
            for((k,value)in kind.state.orEmpty().toSortedMap()){text(k);text(value)}
        }
        for(o in scene.objects) {
            checkpoint(cancelled);text(o.id);b.putInt(o.role.ordinal).putDouble(o.x).putDouble(o.y).putDouble(o.z).putDouble(o.width).putDouble(o.depth)
            b.putInt(o.blocks.voxels.size);val refs=IdentityHashMap<RenderVoxel,Int>()
            for((i,v)in o.blocks.voxels.withIndex()) {
                if(i%1024==0)checkpoint(cancelled)
                b.putDouble(v.x).putDouble(v.y).putDouble(v.z).putInt(palette.getValue(Kind(v.materialId,v.sourceBlockId!!,v.sourceBlockState)));refs[v]=i
            }
            if(refs.size!=o.blocks.voxels.size)return null
            b.putInt(o.blocks.distantVoxels.size)
            val seen=HashSet<Int>()
            for(v in o.blocks.distantVoxels){val index=refs.getValue(v);if(!seen.add(index))return null;b.putInt(index)}
        }
        check(b.position()==size){"Scenery cache size accounting mismatch"}
        checkpoint(cancelled);val hash=digest(b,cancelled)
        b.position(48);b.put(hash);b.position(0);return b.asReadOnlyBuffer()
    }
    fun decode(key:String,bytes:ByteArray,cancelled:()->Boolean={false}):WorldScenery?=decodeBuffer(key,ByteBuffer.wrap(bytes),cancelled)
    fun decodeBuffer(key:String,bytes:ByteBuffer,cancelled:()->Boolean={false}):WorldScenery? {
        checkpoint(cancelled)
        if(bytes.remaining() !in HEADER_BYTES..MAX_BYTES)return null
        val input=bytes.slice();val header=ByteArray(HEADER_BYTES).also{input.duplicate().get(it)}
        if(!isCandidateHeader(key,header,input.remaining().toLong())||!MessageDigest.isEqual(digest(input,cancelled),header.copyOfRange(48,80)))return null
        try {
            val b=input.order(ByteOrder.LITTLE_ENDIAN);b.position(HEADER_BYTES)
            fun count(maximum:Int):Int=b.int.also{require(it in 0..maximum)}
            fun finite():Double=b.double.also{require(it.isFinite())}
            fun positive():Double=finite().also{require(it>0)}
            fun text():String {
                val size=count(minOf(MAX_STRING,b.remaining()-4));require(size<=b.remaining())
                val data=b.slice().apply{limit(size)}
                val value=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(data).toString()
                b.position(b.position()+size);return value
            }
            val objectsCount=count(MAX_OBJECTS);val hasVillage=count(1)
            val village=if(hasVillage==0)null else SceneryRect(finite(),finite(),positive(),positive())
            val paletteCount=count(minOf(MAX_PALETTE,b.remaining()/12));val palette=ArrayList<Kind>(paletteCount)
            repeat(paletteCount) {
                checkpoint(cancelled);val material=text();val block=text();require(material.isNotEmpty()&&block.startsWith("minecraft:")&&block.length>10)
                val size=b.int;require(size in -1..64)
                val state=if(size<0)null else LinkedHashMap<String,String>().apply{
                    repeat(size){val k=text();val value=text();require(k.isNotEmpty()&&!containsKey(k));put(k,value)}
                }.let{Collections.unmodifiableMap(it)}
                palette+=Kind(material,block,state)
            }
            val ids=HashSet<String>();val result=ArrayList<SceneryObject>(objectsCount);var voxelCount=0L
            repeat(objectsCount) {
                checkpoint(cancelled);val id=text();require(id.startsWith("scenery:")&&ids.add(id))
                val role=SceneryRole.entries[count(SceneryRole.entries.lastIndex)]
                val x=finite();val y=finite();val z=finite();val width=positive();val depth=positive()
                val size=count(minOf(MAX_VOXELS,b.remaining()/28));voxelCount+=size;require(voxelCount<=MAX_VOXELS)
                val full=ArrayList<RenderVoxel>(size)
                repeat(size) {i->
                    if(i%1024==0)checkpoint(cancelled)
                    val vx=finite();val vy=finite();val vz=finite();val kind=palette[count(paletteCount-1)]
                    full+=RenderVoxel(vx,vy,vz,kind.material,0,kind.block,kind.state)
                }
                val farCount=count(minOf(size,b.remaining()/4));val far=ArrayList<RenderVoxel>(farCount);val seen=BooleanArray(size)
                repeat(farCount){val index=count(size-1);require(!seen[index]);seen[index]=true;far+=full[index]}
                result+=SceneryObject(id,role,x,y,z,width,depth,SceneryBlockSet(full,far))
            }
            require(!b.hasRemaining());checkpoint(cancelled);return WorldScenery(village,result)
        }catch(error:CancellationException){throw error}
        catch(_:Exception){return null}
    }
}
