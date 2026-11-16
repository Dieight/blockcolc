package com.blockcolc.world.generation

import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.concurrent.CancellationException

/** Optional render data, never a domain/backup decoder. A shared kind palette
 * retains every source state/entity field. Only the small palette uses the
 * existing JSON validator; cells restore positions, kind and construction order.
 * Change SOURCE_REVISION whenever BlueprintSnapshot's normalization changes. */
object BlueprintSnapshotCodec {
    const val HEADER_BYTES=80
    const val MAX_BYTES=16*1024*1024
    private const val MAGIC=0x31504242
    private const val FORMAT=1
    private const val SOURCE_REVISION=1
    private const val MAX_PALETTE=16384
    private const val MAX_PALETTE_BYTES=4*1024*1024
    private const val SAFE=9007199254740991L
    private fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Blueprint render cache superseded")}
    private fun hex(bytes:ByteArray)=buildString(bytes.size*2){for(b in bytes){val n=b.toInt()and 255;append("0123456789abcdef"[n ushr 4]);append("0123456789abcdef"[n and 15])}}
    private fun keyBytes(key:String):ByteArray {require(key.matches(Regex("[a-f0-9]{64}")));return ByteArray(32){key.substring(it*2,it*2+2).toInt(16).toByte()}}
    fun key(sourceSha:String,decoration:Boolean):String {
        keyBytes(sourceSha)
        return hex(MessageDigest.getInstance("SHA-256").digest("blueprint-render-$FORMAT-$SOURCE_REVISION:$decoration:$sourceSha".toByteArray(Charsets.UTF_8)))
    }
    fun isCandidateHeader(key:String,decoration:Boolean,header:ByteArray,total:Long):Boolean=try{
        require(header.size==HEADER_BYTES&&total in (HEADER_BYTES+19L)..MAX_BYTES.toLong())
        val b=ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
        b.int==MAGIC&&b.int==FORMAT&&b.int==SOURCE_REVISION*2+(if(decoration)1 else 0)&&b.int.toLong()==total&&
            MessageDigest.isEqual(ByteArray(32).also{b.get(it)},keyBytes(key))
    }catch(_:Exception){false}
    private fun digest(bytes:ByteBuffer,cancelled:()->Boolean):ByteArray {
        val hash=MessageDigest.getInstance("SHA-256");var start=HEADER_BYTES
        while(start<bytes.limit()){checkpoint(cancelled);val end=minOf(bytes.limit(),start+65536);hash.update(bytes.duplicate().apply{position(start);limit(end)});start=end}
        return hash.digest()
    }
    private fun box(b:BlueprintBox)=JSONObject().put("minX",b.minX).put("maxX",b.maxX).put("minY",b.minY).put("maxY",b.maxY).put("minZ",b.minZ).put("maxZ",b.maxZ)
    private fun dimensions(b:BlueprintBox,decoration:Boolean):IntArray {
        val values=longArrayOf(b.minX,b.maxX,b.minY,b.maxY,b.minZ,b.maxZ);require(values.all{it in -SAFE..SAFE})
        return IntArray(3){axis->val span=values[axis*2+1]-values[axis*2]+1
            require(span in 1L..(if(decoration){if(axis==1)16L else 12L}else{if(axis==1)256L else 96L}));span.toInt()}
    }
    fun encode(key:String,source:BlueprintSnapshot,decoration:Boolean=false,cancelled:()->Boolean={false}):ByteArray? {
        var bytes:ByteArray?=null
        val result=encodeBuffer(key,source,decoration,{size->ByteArray(size).also{bytes=it}.let(ByteBuffer::wrap)},cancelled)
        return if(result==null)null else bytes
    }
    fun encodeBuffer(key:String,source:BlueprintSnapshot,decoration:Boolean,allocate:(Int)->ByteBuffer,cancelled:()->Boolean={false}):ByteBuffer? {
        checkpoint(cancelled);val identity=keyBytes(key);dimensions(source.bounds,decoration)
        if(source.voxels.size !in 1..(if(decoration)2000 else 300000))return null
        val kinds=LinkedHashMap<RenderVoxel,Int>();val indices=IntArray(source.voxels.size)
        for((i,v)in source.voxels.withIndex()){
            if(i%1024==0)checkpoint(cancelled)
            val kind=v.copy(x=0.0,y=0.0,z=0.0,buildOrder=0)
            val index=kinds[kind]?:run{if(kinds.size>=MAX_PALETTE)return null;kinds.size.also{kinds[kind]=it}}
            indices[i]=index
        }
        // Unique per-cell entities can make a palette larger than its source.
        // Keep those worlds live and leave this optional artifact uncached.
        if(source.voxels.size>64&&kinds.size*3>source.voxels.size)return null
        val cells=JSONArray()
        for((kind,index)in kinds)cells.put(BlueprintSnapshot.voxelJson(kind.copy(x=(index%96).toDouble(),y=(index/96).toDouble())))
        val palette=BlueprintSnapshot.canonicalJson(JSONObject().put("schemaVersion",1).put("id","render-palette").put("title","Render palette")
            .put("bounds",box(BlueprintBox(0,minOf(95,kinds.size-1).toLong(),0,((kinds.size-1)/96).toLong(),0,0))).put("voxels",cells)).toByteArray(Charsets.UTF_8)
        if(palette.size>MAX_PALETTE_BYTES)return null
        val meta=BlueprintSnapshot.canonicalJson(JSONObject().put("id",source.id).put("title",source.title).put("bounds",box(source.bounds))
            .put("geometrySha",source.geometrySha).put("canonicalLength",source.canonicalLength)).toByteArray(Charsets.UTF_8)
        if(meta.size>128*1024)return null
        val size=HEADER_BYTES+12L+meta.size+palette.size+source.voxels.size*7L
        if(size>MAX_BYTES)return null
        val out=allocate(size.toInt()).order(ByteOrder.LITTLE_ENDIAN)
        require(!out.isReadOnly&&out.position()==0&&out.remaining()==size.toInt())
        out.putInt(MAGIC).putInt(FORMAT).putInt(SOURCE_REVISION*2+if(decoration)1 else 0).putInt(size.toInt()).put(identity).put(ByteArray(32))
        out.putInt(meta.size).put(meta).putInt(palette.size).put(palette).putInt(source.voxels.size)
        for((i,v)in source.voxels.withIndex()){
            if(i%1024==0)checkpoint(cancelled)
            out.put((v.x.toLong()-source.bounds.minX).toByte()).put((v.y.toLong()-source.bounds.minY).toByte()).put((v.z.toLong()-source.bounds.minZ).toByte())
            out.putShort(indices[i].toShort()).putShort(v.buildOrder.toShort())
        }
        check(out.position()==size.toInt());val hash=digest(out,cancelled);out.position(48);out.put(hash);out.position(0)
        return out.asReadOnlyBuffer()
    }
    fun decode(key:String,bytes:ByteArray,decoration:Boolean=false,cancelled:()->Boolean={false}):BlueprintSnapshot?=decodeBuffer(key,ByteBuffer.wrap(bytes),decoration,cancelled)
    fun decodeBuffer(key:String,bytes:ByteBuffer,decoration:Boolean,cancelled:()->Boolean={false}):BlueprintSnapshot? {
      try{
        checkpoint(cancelled);val b=bytes.slice().order(ByteOrder.LITTLE_ENDIAN)
        if(b.remaining()<HEADER_BYTES)return null
        val header=ByteArray(HEADER_BYTES);b.get(header)
        if(!isCandidateHeader(key,decoration,header,b.limit().toLong()))return null
        if(!MessageDigest.isEqual(header.copyOfRange(48,80),digest(b,cancelled)))return null
        fun text(maximum:Int):String {
            val count=b.int;require(count in 1..maximum&&count<=b.remaining())
            val source=b.slice().apply{limit(count)};b.position(b.position()+count)
            return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(source).toString()
        }
        val meta=JSONObject(text(128*1024));require(meta.keys().asSequence().toSet()==setOf("id","title","bounds","geometrySha","canonicalLength"))
        fun integer(value:JSONObject,name:String):Long {val n=(value.get(name) as? Number)?.toDouble()?:error("Expected integer")
            require(n.isFinite()&&n in -SAFE.toDouble()..SAFE.toDouble()&&n==n.toLong().toDouble());return n.toLong()}
        val rawBounds=meta.getJSONObject("bounds");require(rawBounds.keys().asSequence().toSet()==setOf("minX","maxX","minY","maxY","minZ","maxZ"))
        val bounds=BlueprintBox(integer(rawBounds,"minX"),integer(rawBounds,"maxX"),integer(rawBounds,"minY"),integer(rawBounds,"maxY"),integer(rawBounds,"minZ"),integer(rawBounds,"maxZ"))
        val dimensions=dimensions(bounds,decoration)
        val paletteJson=JSONObject(text(MAX_PALETTE_BYTES));require(paletteJson.getJSONArray("voxels").length() in 1..MAX_PALETTE)
        // Real sign text, piston poses, campfire items, emissive data and
        // states use the same parser/normalizers as a freshly loaded blueprint.
        val palette=BlueprintSnapshot.read(paletteJson).voxels
        val count=b.int;require(count in 1..(if(decoration)2000 else 300000)&&b.remaining().toLong()==count*7L)
        val occupied=LongArray((dimensions[0]*dimensions[1]*dimensions[2]+63)/64)
        val low=IntArray(3){Int.MAX_VALUE};val high=IntArray(3){Int.MIN_VALUE};val cells=ArrayList<RenderVoxel>(count)
        repeat(count){i->
            if(i%1024==0)checkpoint(cancelled)
            val x=b.get().toInt()and 255;val y=b.get().toInt()and 255;val z=b.get().toInt()and 255
            val kind=b.short.toInt()and 65535;val order=b.short.toInt()and 65535
            require(x<dimensions[0]&&y<dimensions[1]&&z<dimensions[2]&&kind<palette.size&&order<=10000)
            val offset=x+(y+z*dimensions[1])*dimensions[0];val word=offset ushr 6;val bit=1L shl(offset and 63)
            require(occupied[word]and bit==0L);occupied[word]=occupied[word]or bit
            low[0]=minOf(low[0],x);low[1]=minOf(low[1],y);low[2]=minOf(low[2],z)
            high[0]=maxOf(high[0],x);high[1]=maxOf(high[1],y);high[2]=maxOf(high[2],z)
            cells.add(palette[kind].copy(x=(bounds.minX+x).toDouble(),y=(bounds.minY+y).toDouble(),z=(bounds.minZ+z).toDouble(),buildOrder=order))
        }
        require(low.all{it==0}&&(0..2).all{high[it]==dimensions[it]-1}&&!b.hasRemaining())
        val id=meta.get("id") as String;val title=meta.get("title") as String;val geometry=meta.get("geometrySha") as String
        val length=integer(meta,"canonicalLength");require(length in 2..512L*1024*1024)
        checkpoint(cancelled)
        return BlueprintSnapshot.fromCachedRender(id,title,bounds,cells,geometry,length.toInt())
      }catch(error:CancellationException){throw error}catch(_:Exception){return null}
    }
}
