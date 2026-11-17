package com.blockcolc.world

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.json.JSONArray
import org.json.JSONObject

data class BufferRange(val offset: Int, val bytes: Int)
data class Point3(val x: Float, val y: Float, val z: Float) {
    operator fun get(index: Int): Float = when(index) { 0 -> x; 1 -> y; 2 -> z; else -> throw IndexOutOfBoundsException() }
}
data class Bounds(val min: Point3, val max: Point3)
data class Geometry(val id: Int, val vertex: BufferRange, val index: BufferRange,
                    val vertexCount: Int, val indexCount: Int, val bounds: Bounds,val vertexPreparation:String?=null)
data class DrawPacket(val id: Int, val owner: String, val layer: String, val geometry: Int,
                      val material: Int, val count: Int, val instances: BufferRange,
                      val bounds: Bounds, val castShadow: Boolean, val receiveShadow: Boolean,
                      val aux: BufferRange?, val auxChannels: List<String>,val priority:Int=4,val lod:SceneryLod?=null)

/** Validated descriptors and read-only buffer views. The reader transfers ownership of input;
 * callers must not mutate its original backing buffer after adoption. */
class WorldPackets private constructor(geometries: List<Geometry>, materials: List<String>,
                                      packets: List<DrawPacket>, private val payload: ByteBuffer) {
    val geometries: List<Geometry> = java.util.Collections.unmodifiableList(geometries)
    val materials: List<String> = java.util.Collections.unmodifiableList(materials)
    val packets: List<DrawPacket> = java.util.Collections.unmodifiableList(packets)
    val byteSize: Int get() = payload.remaining()
    fun section(range: BufferRange): ByteBuffer = payload.asReadOnlyBuffer().order(ByteOrder.LITTLE_ENDIAN)
        .apply { position(range.offset); limit(range.offset + range.bytes) }.slice().order(ByteOrder.LITTLE_ENDIAN)

    companion object {
        const val MAX_BYTES = 256 * 1024 * 1024
        const val MAX_INSTANCE_BYTES = 64L * 1024 * 1024
        private fun integer(value: JSONObject, key: String): Int {
            val raw = value.get(key) as? Number ?: throw IllegalArgumentException("Expected integer: $key")
            val number = raw.toDouble()
            require(number.isFinite() && number >= Int.MIN_VALUE && number <= Int.MAX_VALUE && number == number.toInt().toDouble()) { "Expected integer: $key" }
            return number.toInt()
        }
        fun read(manifest: String, input: ByteBuffer): WorldPackets {
            require(manifest.length <= 16 * 1024 * 1024) { "Manifest budget" }
            val bytes = input.asReadOnlyBuffer().slice().order(ByteOrder.LITTLE_ENDIAN)
            require(bytes.remaining() in 16..MAX_BYTES) { "World buffer budget" }
            require(bytes.getInt(0) == 0x31504342 && bytes.getInt(4) in 1..5) { "Unknown world format" }
            require(bytes.getInt(8) == bytes.remaining()) { "Truncated world buffer" }
            val json = JSONObject(manifest)
            val version=integer(json,"version")
            require(version == bytes.getInt(4)) { "Manifest/binary version mismatch" }
            val ranges = mutableListOf<BufferRange>()
            fun range(value: JSONObject): BufferRange {
                val offset = integer(value,"offset").toLong(); val size = integer(value,"bytes").toLong()
                require(offset >= 16 && size > 0 && offset % 4 == 0L && size % 4 == 0L &&
                    offset <= bytes.remaining().toLong() && size <= bytes.remaining().toLong() - offset) { "Invalid buffer section" }
                return BufferRange(offset.toInt(), size.toInt()).also { ranges += it }
            }
            fun bounds(value: JSONArray): Bounds {
                require(value.length() == 2)
                fun point(index: Int): Point3 {
                    val vector = value.getJSONArray(index); require(vector.length() == 3)
                    val values = FloatArray(3) { vector.getDouble(it).toFloat().also { n -> require(n.isFinite()) { "Invalid bounds" } } }
                    return Point3(values[0],values[1],values[2])
                }
                return Bounds(point(0), point(1)).also { box -> require((0..2).all { box.min[it] <= box.max[it] }) }
            }
            val rawGeometry = json.getJSONArray("geometries"); require(rawGeometry.length() in 1..10_000)
            val geometry = List(rawGeometry.length()) { i ->
                val value = rawGeometry.getJSONObject(i); require(integer(value,"id") == i)
                val vertices = integer(value,"vertexCount"); val indices = integer(value,"indexCount")
                require(vertices in 1..4_000_000 && indices in 3..12_000_000 && indices % 3 == 0)
                Geometry(i, range(value.getJSONObject("vertex")), range(value.getJSONObject("index")), vertices, indices,
                    bounds(value.getJSONArray("bounds")),if(value.has("vertexPreparation"))value.getString("vertexPreparation").also{require(it=="atlas-static-v1")}else null).also {
                    require(it.vertex.bytes.toLong() == vertices.toLong() * 48 && it.index.bytes.toLong() == indices.toLong() * 4)
                }
            }
            val rawMaterials = json.getJSONArray("materials"); require(rawMaterials.length() in 1..8_192)
            fun number(value: Any): Double {
                val number = (value as? Number)?.toDouble() ?: throw IllegalArgumentException("Expected material number")
                require(number.isFinite() && kotlin.math.abs(number)<=1e6);return number
            }
            val materials = List(rawMaterials.length()) { i -> rawMaterials.getJSONObject(i).also { m ->
                require(integer(m,"id") == i)
                for ((key,size) in listOf("color" to 3,"emissive" to 3,"uvTransform" to 9)) {
                    val values=m.getJSONArray(key);require(values.length()==size)
                    repeat(size){number(values.get(it))}
                }
                for(key in listOf("opacity","roughness","metalness","alphaTest"))require(number(m.get(key)) in 0.0..1.0)
                require(number(m.get("emissiveIntensity"))>=0)
                for(key in listOf("transparent","vertexColors","unlit","depthWrite","colorWrite","depthTest","flipY"))require(m.get(key) is Boolean)
                if(m.has("fog"))require(m.get("fog") is Boolean)
                if(m.has("billboard")){
                    require(integer(m,"billboard") in 0..2 && number(m.get("pointSize")) in 0.0..64.0)
                    val center=m.getJSONArray("billboardCenter");require(center.length()==2)
                    for(c in 0..1)require(number(center.get(c)) in 0.0..1.0)
                }
                require(integer(m,"side") in 0..2 && integer(m,"depthFunc") in 0..7 && integer(m,"blending") in 0..5)
                if(!m.isNull("texture"))require(integer(m,"texture")>=0)
                require(m.getString("program") in setOf("standard","custom"))
                require(m.getString("sourceType").length in 1..128)
            }.toString() }
            val rawPackets = json.getJSONArray("packets"); require(rawPackets.length() in 1..30_000)
            var totalInstances = 0
            val packets = List(rawPackets.length()) { i ->
                val value = rawPackets.getJSONObject(i); require(integer(value,"id") == i)
                val owner = value.getString("owner"); val layer = value.getString("layer")
                require(PacketOwners.valid(owner))
                require(layer in setOf("static", "animals", "clouds", "precipitation", "sky", "lightning"))
                val count = integer(value,"count"); require(count in 1..1_024)
                totalInstances += count; require(totalInstances*96L<=MAX_INSTANCE_BYTES){"Native instance row budget"}
                val g = integer(value,"geometry"); val m = integer(value,"material")
                require(g in geometry.indices && m in materials.indices)
                val aux=if(version>=2&&!value.isNull("aux"))range(value.getJSONObject("aux"))else null
                val channels=if(version>=2)value.getJSONArray("auxChannels").let{array->(0 until array.length()).map{array.getString(it)}}else emptyList()
                val cloud=version>=3&&channels==listOf("cloudCenter","cloudVelocity")
                val weather=version>=4&&channels==listOf("weatherPhase","weatherOffset")
                val animal=version>=5&&channels==listOf("animalSlot")
                require(cloud||weather||animal||channels.size<=2&&channels.distinct().size==channels.size&&channels.all{it in setOf("instanceFaceOcclusion","instanceMaterialResponse")})
                require((aux!=null)==channels.isNotEmpty()){"Auxiliary channel inventory mismatch"}
                if(aux!=null)require(aux.bytes==count*16){"Invalid auxiliary instance size"}
                DrawPacket(i, owner, layer, g, m, count, range(value.getJSONObject("instances")),
                    bounds(value.getJSONArray("bounds")), value.getBoolean("castShadow"), value.getBoolean("receiveShadow"),aux,java.util.Collections.unmodifiableList(channels),
                    if(value.has("priority"))integer(value,"priority").also{require(it in 0..7)}else 4,
                    if(value.has("lod")&&!value.isNull("lod"))SceneryLod.read(value.getJSONObject("lod"))else null).also {
                    require(it.instances.bytes == count * 80)
                }
            }
            val ordered = ranges.sortedBy { it.offset }; var end = 16
            for (section in ordered) { require(section.offset == end) { "Overlapping or unreferenced data" }; end += section.bytes }
            require(end == bytes.remaining() && ranges.size == bytes.getInt(12)) { "Section inventory mismatch" }
            // Validate every value, but read fixed-size typed batches. Android
            // HeapByteBuffer.getFloat/getInt otherwise checks and assembles
            // four bytes per scalar, millions of times at a cold launch.
            val floatBatch = FloatArray(minOf(4096,bytes.remaining()/4))
            val indexBatch = IntArray(floatBatch.size)
            fun section(range:BufferRange):ByteBuffer = bytes.duplicate().order(ByteOrder.LITTLE_ENDIAN)
                .apply{position(range.offset);limit(range.offset+range.bytes)}.slice().order(ByteOrder.LITTLE_ENDIAN)
            fun finite(range:BufferRange,message:String){
                val values=section(range).asFloatBuffer()
                while(values.hasRemaining()){
                    val count=minOf(values.remaining(),floatBatch.size);values.get(floatBatch,0,count)
                    for(i in 0 until count)require(floatBatch[i].isFinite()){message}
                }
            }
            for (g in geometry) {
                finite(g.vertex,"Non-finite vertex")
                val indices=section(g.index).asIntBuffer()
                while(indices.hasRemaining()){
                    val count=minOf(indices.remaining(),indexBatch.size);indices.get(indexBatch,0,count)
                    for(i in 0 until count)require(indexBatch[i] in 0 until g.vertexCount){"Index outside geometry"}
                }
            }
            for (packet in packets) {
                // Validate transforms in the same pass as their finite-value
                // check. A batch contains only complete 20-float rows.
                val instances = section(packet.instances).asFloatBuffer()
                while (instances.hasRemaining()) {
                    val count = minOf(instances.remaining(), floatBatch.size / 20 * 20)
                    instances.get(floatBatch, 0, count)
                    for (i in 0 until count) require(floatBatch[i].isFinite()) { "Non-finite instance" }
                    for (row in 0 until count step 20) {
                        require(floatBatch[row+3]==0f&&floatBatch[row+7]==0f&&floatBatch[row+11]==0f&&floatBatch[row+15]==1f) { "Non-affine instance" }
                        val a=floatBatch[row];val b=floatBatch[row+4];val c=floatBatch[row+8]
                        val d=floatBatch[row+1];val e=floatBatch[row+5];val f=floatBatch[row+9]
                        val g=floatBatch[row+2];val h=floatBatch[row+6];val j=floatBatch[row+10]
                        require(kotlin.math.abs(a.toDouble()*(e*j-f*h)-b.toDouble()*(d*j-f*g)+c.toDouble()*(d*h-e*g))>1e-10) { "Singular instance" }
                    }
                }
                val auxiliary = packet.aux ?: continue
                val channels = packet.auxChannels
                val hasOcclusion = "instanceFaceOcclusion" in channels
                val hasMaterialResponse = "instanceMaterialResponse" in channels
                val rows = section(auxiliary).asFloatBuffer()
                while (rows.hasRemaining()) {
                    val count = minOf(rows.remaining(), floatBatch.size)
                    rows.get(floatBatch, 0, count)
                    for (row in 0 until count step 4) {
                        val x = floatBatch[row]; val y = floatBatch[row+1]
                        val z = floatBatch[row+2]; val w = floatBatch[row+3]
                        when (channels[0]) {
                            "animalSlot" -> require(
                                x in 0f..1535f && x==x.toInt().toFloat() &&
                                    y in 0f..3f && y==y.toInt().toFloat() && (z==0f||z==1f) && w==0f
                            ) { "Invalid animal rig slot" }
                            "weatherPhase" -> require(
                                x in 0f..1f && y in -0.5f..0.5f && z in -0.5f..0.5f && w in 0f..49151f && w==w.toInt().toFloat()
                            ) { "Invalid weather instance channel" }
                            "cloudCenter" -> require(
                                x in -1e6f..1e6f && y in -1e6f..1e6f && z in -100f..100f && w in -100f..100f
                            ) { "Invalid cloud instance channel" }
                            else -> {
                                require(x in 0f..16777215f&&x==x.toInt().toFloat()&&y in 0f..16777215f&&y==y.toInt().toFloat()) { "Invalid packed instance channel" }
                                require((hasOcclusion||x==0f)&&(hasMaterialResponse||y==0f)&&z==0f&&w==0f) { "Nonzero reserved channel" }
                            }
                        }
                    }
                }
            }
            return WorldPackets(geometry, materials, packets, bytes)
        }
    }
}

/** Owner-scoped invalidation. A stale generation cannot discard a later building or world. */
class WorldRevision(initialOwners: Set<String>) {
    private val owners = initialOwners.associateWith { 0L }.toMutableMap()
    var generation = 0L; private set
    fun revision(owner: String): Long? = owners[owner]
    fun replace(owner: String, expectedGeneration: Long, expectedRevision: Long): Boolean {
        return replaceAll(expectedGeneration,mapOf(owner to expectedRevision))
    }
    fun replaceAll(expectedGeneration:Long,expected:Map<String,Long>):Boolean {
        if(expected.isEmpty()||expectedGeneration!=generation||expected.any{owners[it.key]!=it.value})return false
        for((owner,revision)in expected)owners[owner]=revision+1
        return true
    }
    fun rebuild(newOwners: Set<String>) { generation++; owners.clear(); owners.putAll(newOwners.associateWith { 0L }) }
}
