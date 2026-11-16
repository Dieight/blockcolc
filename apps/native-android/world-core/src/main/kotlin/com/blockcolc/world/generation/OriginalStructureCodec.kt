package com.blockcolc.world.generation

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.IntBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.IdentityHashMap
import java.util.concurrent.CancellationException

/** Recomputable original-material geometry only. Bump REVISION when shape,
 * material, lighting attributes or construction preparation rules change.
 * No GPU handles, project data or imported resource-pack pixels are stored. */
object OriginalStructureCodec {
    const val HEADER_BYTES=80
    const val MAX_BYTES=8*1024*1024
    private const val MAGIC=0x31534742
    private const val FORMAT=1
    private const val REVISION=1
    private const val MAX_CELLS=300000
    private fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Structure cache superseded")}
    private fun hex(bytes:ByteArray)=bytes.joinToString(""){"%02x".format(it.toInt()and 255)}
    private fun keyBytes(key:String):ByteArray{require(key.matches(Regex("[a-f0-9]{64}")));return ByteArray(32){key.substring(it*2,it*2+2).toInt(16).toByte()}}
    fun key(inputKey:String,origin:BlockPoint):String {
        require(inputKey.isNotBlank()&&inputKey.length<=512&&listOf(origin.x,origin.y,origin.z).all{it.isFinite()})
        return hex(MessageDigest.getInstance("SHA-256").digest("original-structure:$FORMAT:$REVISION:$inputKey:${origin.x}:${origin.y}:${origin.z}".toByteArray(Charsets.UTF_8)))
    }
    fun isCandidateHeader(key:String,header:ByteArray,total:Long):Boolean=try{
        require(header.size==HEADER_BYTES&&total in HEADER_BYTES.toLong()..MAX_BYTES.toLong())
        val b=ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
        b.int==MAGIC&&b.int==FORMAT&&b.int==REVISION&&b.int.toLong()==total&&MessageDigest.isEqual(ByteArray(32).also{b.get(it)},keyBytes(key))
    }catch(_:Exception){false}
    private fun digest(b:ByteBuffer,cancelled:()->Boolean):ByteArray{
        val hash=MessageDigest.getInstance("SHA-256");var at=HEADER_BYTES
        while(at<b.limit()){checkpoint(cancelled);val end=minOf(b.limit(),at+65536);hash.update(b.duplicate().apply{position(at);limit(end)});at=end};return hash.digest()
    }
    private class Sink(val out:ByteBuffer?){
        var size=0L;private set
        fun int(v:Int){size+=4;out?.putInt(v)}
        fun double(v:Double){require(v.isFinite());size+=8;out?.putDouble(v)}
        fun text(v:String?){val bytes=v?.toByteArray(Charsets.UTF_8);int(bytes?.size?:-1);if(bytes!=null){size+=bytes.size;out?.put(bytes)}}
        fun floats(v:FloatBuffer?){int(v?.remaining()?:-1);if(v!=null){size+=v.remaining()*4L;if(out!=null){val n=v.remaining()*4;out.slice().order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().put(v.duplicate());out.position(out.position()+n)}}}
        fun ints(v:IntBuffer){int(v.remaining());size+=v.remaining()*4L;if(out!=null){val n=v.remaining()*4;out.slice().order(ByteOrder.LITTLE_ENDIAN).asIntBuffer().put(v.duplicate());out.position(out.position()+n)}}
        fun bytes(v:ByteBuffer){int(v.remaining());size+=v.remaining();out?.put(v.duplicate())}
    }
    fun encode(key:String,value:OriginalStructure,cancelled:()->Boolean={false}):ByteArray?{
        var array:ByteArray?=null;val result=encodeBuffer(key,value,{n->ByteArray(n).also{array=it}.let(ByteBuffer::wrap)},cancelled)
        return if(result==null)null else array
    }
    fun encodeBuffer(key:String,value:OriginalStructure,allocate:(Int)->ByteBuffer,cancelled:()->Boolean={false}):ByteBuffer?{
        checkpoint(cancelled);require(key==key(value.inputKey,value.origin));if(value.sourceCount !in 0..MAX_CELLS)return null
        val geometries=IdentityHashMap<BlockGeometry,Int>();val geometryList=ArrayList<BlockGeometry>()
        val textures=IdentityHashMap<OriginalDetailTexture,Int>();val textureList=ArrayList<OriginalDetailTexture>()
        for(batch in value.batches){if(!geometries.containsKey(batch.geometry)){geometries[batch.geometry]=geometryList.size;geometryList+=batch.geometry}
            (batch.material as? OriginalDrawMaterial.Detail)?.texture?.let{if(!textures.containsKey(it)){textures[it]=textureList.size;textureList+=it}}}
        fun write(s:Sink){
            s.text(value.inputKey);s.int(value.sourceCount);s.double(value.origin.x);s.double(value.origin.y);s.double(value.origin.z)
            s.int(geometryList.size)
            for(g in geometryList){checkpoint(cancelled);s.int(g.vertexCount);s.int(if(g.bounds==null)0 else 1);g.bounds?.let{for(v in listOf(it.min.x,it.min.y,it.min.z,it.max.x,it.max.y,it.max.z))s.double(v)}
                s.text(g.vertexPreparation);s.floats(g.positions());s.floats(g.normals());s.floats(g.textureCoordinates());s.floats(g.colors());s.floats(g.colorAlpha());s.ints(g.indices()?:IntBuffer.allocate(0))}
            s.int(textureList.size);for(t in textureList){checkpoint(cancelled);s.bytes(t.rgba())}
            s.int(value.batches.size)
            for(batch in value.batches){checkpoint(cancelled);s.int(batch.route.ordinal);s.int(geometries.getValue(batch.geometry))
                when(val material=batch.material){
                    is OriginalDrawMaterial.Pattern->{s.int(0);val style=material.style;s.int(style.color);s.int(style.response.ordinal);s.int(style.pattern.ordinal);s.int(if(style.transparent)1 else 0);s.double(style.opacity)}
                    is OriginalDrawMaterial.Detail->{s.int(1);s.int(textures.getValue(material.texture));s.double(material.roughness);s.double(material.metalness)}
                    OriginalDrawMaterial.Plant->s.int(2)
                    is OriginalDrawMaterial.Glass->{s.int(3);s.int(material.color);s.double(material.opacity);s.double(material.roughness);s.double(material.metalness)}
                    is OriginalDrawMaterial.Fluid->{s.int(4);s.int(material.kind.ordinal);s.int(if(material.waterlogged)1 else 0)}
                }
                s.text(batch.emission.kind);s.int(batch.emission.level);s.ints(batch.members());s.ints(batch.instanceMembers());s.floats(batch.matrices());s.floats(batch.occlusion());s.ints(batch.faceOcclusion());s.ints(batch.materialResponse())
            }
            s.ints(value.invisibleIndices());s.ints(value.fluidIndices());s.ints(value.blockEntityIndices())
        }
        val measure=Sink(null);write(measure);val total=measure.size+HEADER_BYTES;if(total>MAX_BYTES)return null
        val b=allocate(total.toInt()).order(ByteOrder.LITTLE_ENDIAN);require(!b.isReadOnly&&b.position()==0&&b.remaining()==total.toInt())
        b.putInt(MAGIC).putInt(FORMAT).putInt(REVISION).putInt(total.toInt()).put(keyBytes(key)).put(ByteArray(32));write(Sink(b));check(b.position()==total.toInt())
        val hash=digest(b,cancelled);b.position(48);b.put(hash);b.position(0);return b.asReadOnlyBuffer()
    }
    fun decode(key:String,bytes:ByteArray,cancelled:()->Boolean={false})=decodeBuffer(key,ByteBuffer.wrap(bytes),cancelled)
    fun decodeBuffer(key:String,bytes:ByteBuffer,cancelled:()->Boolean={false}):OriginalStructure?=try{
        checkpoint(cancelled);val b=bytes.slice().order(ByteOrder.LITTLE_ENDIAN);require(b.remaining()>=HEADER_BYTES)
        val header=ByteArray(HEADER_BYTES);b.get(header);require(isCandidateHeader(key,header,b.limit().toLong())&&MessageDigest.isEqual(header.copyOfRange(48,80),digest(b,cancelled)))
        fun count(max:Int):Int=b.int.also{require(it in 0..max)}
        fun double():Double=b.double.also{require(it.isFinite())}
        fun text(max:Int,nullable:Boolean=false):String?{val n=b.int;if(n== -1){require(nullable);return null};require(n in 0..max&&n<=b.remaining());val view=b.slice().apply{limit(n)};b.position(b.position()+n)
            return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(view).toString()}
        fun floats(max:Int,nullable:Boolean=false):FloatBuffer?{val n=b.int;if(n== -1){require(nullable);return null};require(n in 0..max&&n.toLong()*4<=b.remaining())
            val view=b.slice().order(ByteOrder.LITTLE_ENDIAN).apply{limit(n*4)}.asFloatBuffer().asReadOnlyBuffer();b.position(b.position()+n*4)
            for(i in 0 until n){if(i%16384==0)checkpoint(cancelled);require(view[i].isFinite())};return view}
        fun ints(max:Int):IntArray{val n=count(max);require(n.toLong()*4<=b.remaining());return IntArray(n){b.int}}
        fun bool():Boolean=b.int.also{require(it==0||it==1)}==1
        fun fraction():Double=double().also{require(it in 0.0..1.0)}
        val input=checkNotNull(text(2048));val sources=count(MAX_CELLS);val origin=BlockPoint(double(),double(),double());require(key==key(input,origin))
        val geometries=ArrayList<BlockGeometry>();repeat(count(100000)){
            checkpoint(cancelled);val vertices=count(MAX_BYTES/24);val bounds=if(bool())BlockBox(BlockPoint(double(),double(),double()),BlockPoint(double(),double(),double()))else null
            if(bounds!=null)require(bounds.min.x<=bounds.max.x&&bounds.min.y<=bounds.max.y&&bounds.min.z<=bounds.max.z)
            val preparation=text(512,true);val positions=checkNotNull(floats(vertices*3));val normals=checkNotNull(floats(vertices*3));require(positions.remaining()==vertices*3&&normals.remaining()==vertices*3)
            val uv=floats(vertices*2,true);val color=floats(vertices*3,true);val alpha=floats(vertices,true);val indices=ints(MAX_BYTES/4)
            require((uv==null||uv.remaining()==vertices*2)&&(color==null||color.remaining()==vertices*3)&&(alpha==null||alpha.remaining()==vertices)&&indices.size%3==0&&indices.all{it in 0 until vertices})
            require((vertices==0)==(bounds==null))
            geometries+=CachedGeometry(vertices,bounds,preparation,positions,normals,uv,color,alpha,indices.takeIf{it.isNotEmpty()}?.let{IntBuffer.wrap(it).asReadOnlyBuffer()})
        }
        val textures=ArrayList<OriginalDetailTexture>();repeat(count(1024)){checkpoint(cancelled);val n=count(128*64*4);require(n==128*64*4&&n<=b.remaining());textures+=OriginalDetailTexture(ByteArray(n).also{b.get(it)})}
        val batches=ArrayList<OriginalDrawBatch>();repeat(count(100000)){
            checkpoint(cancelled);val route=OriginalDrawRoute.entries[b.int];val geometry=geometries[b.int]
            val material=when(b.int){
                0->OriginalDrawMaterial.Pattern(OriginalVisualStyle(b.int,OriginalResponse.entries[b.int],OriginalPattern.entries[b.int],bool(),fraction()))
                1->OriginalDrawMaterial.Detail(textures[b.int],fraction(),fraction())
                2->OriginalDrawMaterial.Plant
                3->OriginalDrawMaterial.Glass(b.int,fraction(),fraction(),fraction())
                4->OriginalDrawMaterial.Fluid(OriginalFluid.entries[b.int],bool())
                else->error("Unknown material")
            }
            val emission=EffectiveEmission(checkNotNull(text(512)),count(15));val members=ints(MAX_CELLS);val instances=ints(MAX_CELLS)
            require(members.all{it in 0 until sources}&&instances.all{it in -1 until sources})
            val matrix=checkNotNull(floats(instances.size*16));val ao=checkNotNull(floats(instances.size));val face=ints(instances.size);val response=ints(instances.size)
            batches+=OriginalDrawBatch(route,geometry,material,emission,members,instances,FloatArray(matrix.remaining()).also{matrix.get(it)},FloatArray(ao.remaining()).also{ao.get(it)},face,response)
        }
        fun sourceIndices()=ints(MAX_CELLS).also{require(it.all{n->n in 0 until sources})}
        val invisible=sourceIndices();val fluids=sourceIndices();val entities=sourceIndices();require(!b.hasRemaining());checkpoint(cancelled)
        OriginalStructure(input,sources,origin,batches,invisible,fluids,entities)
    }catch(error:CancellationException){throw error}catch(_:Exception){null}

    private class CachedGeometry(override val vertexCount:Int,override val bounds:BlockBox?,override val vertexPreparation:String?,
        private val position:FloatBuffer,private val normal:FloatBuffer,private val uv:FloatBuffer?,private val color:FloatBuffer?,private val alpha:FloatBuffer?,private val index:IntBuffer?):BlockGeometry{
        override val byteSize=(position.remaining()+normal.remaining()+(uv?.remaining()?:0)+(color?.remaining()?:0)+(alpha?.remaining()?:0)+(index?.remaining()?:0))*4L
        override fun positions()=position.asReadOnlyBuffer()
        override fun normals()=normal.asReadOnlyBuffer()
        override fun textureCoordinates()=uv?.asReadOnlyBuffer()
        override fun colors()=color?.asReadOnlyBuffer()
        override fun colorAlpha()=alpha?.asReadOnlyBuffer()
        override fun indices()=index?.asReadOnlyBuffer()
    }
}
