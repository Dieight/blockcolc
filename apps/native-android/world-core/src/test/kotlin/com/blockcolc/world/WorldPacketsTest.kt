package com.blockcolc.world

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WorldPacketsTest {
    private fun source() = javaClass.getResource("/codec-fixture.json")!!.readText()
    private fun bytes() = javaClass.getResource("/codec-fixture.bin")!!.readBytes()
    private fun read(json: String = source(), data: ByteArray = bytes()) = WorldPackets.read(json, ByteBuffer.wrap(data))
    private fun rejected(json: String = source(), data: ByteArray = bytes()) {
        try { read(json, data); fail("Malformed scene accepted") } catch (_: IllegalArgumentException) { }
    }
    @Test fun crossLanguageSourcePreservesInstancesAndReadOnlyBuffers() {
        val world = read(); assertEquals(1, world.geometries.size); assertEquals(2, world.packets.single().count)
        assertTrue(world.section(world.geometries.single().vertex).isReadOnly)
        assertEquals(0f, world.section(world.packets.single().instances).getFloat(12 * 4), 0f)
        assertEquals(2f, world.section(world.packets.single().instances).getFloat(80 + 12 * 4), 0f)
    }
    @Test fun truncatedPayloadIsRejected() { rejected(data = bytes().copyOf(bytes().size - 4)) }
    @Test fun overlappingSectionsAreRejected() {
        val json = JSONObject(source()); json.getJSONArray("packets").getJSONObject(0).getJSONObject("instances").put("offset", 16)
        rejected(json.toString())
    }
    @Test fun oversizedRangeDoesNotOverflow() {
        val json = JSONObject(source()); json.getJSONArray("geometries").getJSONObject(0).getJSONObject("vertex").put("offset", Long.MAX_VALUE)
        rejected(json.toString())
    }
    @Test fun indexOutsideGeometryIsRejected() {
        val json = JSONObject(source()); val offset = json.getJSONArray("geometries").getJSONObject(0).getJSONObject("index").getInt("offset")
        val data = bytes(); ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).putInt(offset, Int.MAX_VALUE)
        rejected(data = data)
    }
    @Test fun nonFiniteInstanceIsRejected() {
        val json = JSONObject(source()); val offset = json.getJSONArray("packets").getJSONObject(0).getJSONObject("instances").getInt("offset")
        val data = bytes(); ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).putFloat(offset, Float.NaN)
        rejected(data = data)
    }
    @Test fun missingOwnerDoesNotBecomeGlobalReplacement() {
        val json = JSONObject(source()); json.getJSONArray("packets").getJSONObject(0).put("owner", "")
        rejected(json.toString())
    }
    @Test fun unknownVersionIsRejected() {
        val json = JSONObject(source()).put("version", 99);val data=bytes()
        ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).putInt(4,99);rejected(json.toString(),data)
    }
    @Test fun versionOneRemainsReadableWithNeutralAuxiliaryTexels() {
        val legacy=WorldPackets.read(javaClass.getResource("/codec-v1.json")!!.readText(),
            ByteBuffer.wrap(javaClass.getResource("/codec-v1.bin")!!.readBytes()))
        val packet=legacy.packets.single();assertNull(packet.aux);assertTrue(packet.auxChannels.isEmpty())
        assertEquals(4,packet.priority);assertNull(packet.lod)
        val rows=legacy.instanceRows(packet);assertTrue(rows.isDirect);assertEquals(192,rows.remaining())
        assertEquals(2f,rows.getFloat(96+48),0f)
        for(i in 0..1)for(channel in 0..3)assertEquals(0f,rows.getFloat(i*96+80+channel*4),0f)
    }
    @Test fun versionTwoFluidPayloadKeepsItsOldPackedMeaning() {
        val world=WorldPackets.read(javaClass.getResource("/codec-v2.json")!!.readText(),ByteBuffer.wrap(javaClass.getResource("/codec-v2.bin")!!.readBytes()))
        assertEquals(listOf("instanceFaceOcclusion","instanceMaterialResponse"),world.packets.single().auxChannels)
        assertEquals(1098304f,world.instanceRows(world.packets.single()).getFloat(80),0f)
    }
    @Test fun auxiliaryChannelsReachTheExactSixTexelGpuLayout() {
        val raw=javaClass.getResource("/codec-aux.json")!!.readText()
        val aux=WorldPackets.read(raw,ByteBuffer.wrap(javaClass.getResource("/codec-aux.bin")!!.readBytes()))
        val packet=aux.packets.single();val rows=aux.instanceRows(packet)
        assertEquals(listOf("instanceFaceOcclusion","instanceMaterialResponse"),packet.auxChannels)
        assertEquals(1098304f,rows.getFloat(80),0f);assertEquals(16777215f,rows.getFloat(84),0f)
        assertEquals(2f,rows.getFloat(96+48),0f);assertEquals(1065536f,rows.getFloat(96+80),0f)
        assertEquals(262144f,rows.getFloat(96+84),0f);assertEquals(0f,rows.getFloat(96+92),0f)
        assertThrows(IllegalArgumentException::class.java){aux.instanceRows(read().packets.single())}
    }
    @Test fun cloudFractionsKeepTheirMeaningAndCannotMasqueradeAsLegacyPackedData() {
        val raw=javaClass.getResource("/codec-cloud.json")!!.readText()
        val original=javaClass.getResource("/codec-cloud.bin")!!.readBytes()
        val world=WorldPackets.read(raw,ByteBuffer.wrap(original));val p=world.packets.single()
        assertEquals(listOf("cloudCenter","cloudVelocity"),p.auxChannels)
        val rows=world.instanceRows(p);assertEquals(-12.5f,rows.getFloat(80),0f);assertEquals(.15f,rows.getFloat(88),0f)
        for(bad in listOf(Float.NaN,101f,-101f)){
            val data=original.copyOf();ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).putFloat(p.aux!!.offset+8,bad);rejected(raw,data)
        }
        val old=JSONObject(raw).put("version",2);val data=original.copyOf()
        ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).putInt(4,2);rejected(old.toString(),data)
    }
    @Test fun corruptAuxiliarySectionsAndInventoryAreRejected() {
        val raw=javaClass.getResource("/codec-aux.json")!!.readText()
        val original=javaClass.getResource("/codec-aux.bin")!!.readBytes()
        for(bad in listOf(Float.NaN,-1f,.5f,16777216f)){
            val data=original.copyOf();val at=JSONObject(raw).getJSONArray("packets").getJSONObject(0).getJSONObject("aux").getInt("offset")
            ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).putFloat(at,bad);rejected(raw,data)
        }
        for(change in 0..3){
            val json=JSONObject(raw);val p=json.getJSONArray("packets").getJSONObject(0)
            when(change){0->p.getJSONObject("aux").put("bytes",16)
                1->p.put("auxChannels",org.json.JSONArray(listOf("unreviewed")))
                2->p.put("aux",JSONObject.NULL)
                3->p.put("auxChannels",org.json.JSONArray(listOf("instanceFaceOcclusion")))}
            rejected(json.toString(),original)
        }
        val reserved=original.copyOf();val at=JSONObject(raw).getJSONArray("packets").getJSONObject(0).getJSONObject("aux").getInt("offset")
        ByteBuffer.wrap(reserved).order(ByteOrder.LITTLE_ENDIAN).putFloat(at+8,1f);rejected(raw,reserved)
    }
    @Test fun fractionalCountsAreNotTruncated() {
        val json=JSONObject(source());json.getJSONArray("packets").getJSONObject(0).put("count",2.5)
        rejected(json.toString())
    }
    @Test fun adoptedCollectionsCannotBeMutated() {
        val world=read()
        try { (world.packets as MutableList<DrawPacket>).clear();fail("Mutable adopted inventory") }
        catch (_: UnsupportedOperationException) { }
    }
    @Test fun versionThreeCloudAndVersionFourWeatherRemainReadable() {
        for((name,channels)in listOf("codec-v3" to listOf("cloudCenter","cloudVelocity"),"codec-v4" to listOf("weatherPhase","weatherOffset"))){
            val w=WorldPackets.read(javaClass.getResource("/$name.json")!!.readText(),ByteBuffer.wrap(javaClass.getResource("/$name.bin")!!.readBytes()))
            assertEquals(channels,w.packets.single().auxChannels)
        }
    }
    @Test fun animalSlotsAreVersionedAndRejectMalformedGpuRows() {
        val raw=javaClass.getResource("/codec-animal.json")!!.readText();val original=javaClass.getResource("/codec-animal.bin")!!.readBytes()
        val w=WorldPackets.read(raw,ByteBuffer.wrap(original));val p=w.packets.single();val rows=w.instanceRows(p)
        assertEquals(listOf("animalSlot"),p.auxChannels);assertEquals(1f,rows.getFloat(88),0f);assertEquals(0f,rows.getFloat(96+88),0f)
        for((channel,bad)in listOf(0 to -.1f,0 to 1536f,0 to .5f,1 to 4f,1 to .5f,2 to .5f,3 to 1f,0 to Float.NaN)){
            val data=original.copyOf();ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).putFloat(p.aux!!.offset+channel*4,bad);rejected(raw,data)
        }
        val old=JSONObject(raw).put("version",4);val data=original.copyOf();ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).putInt(4,4)
        rejected(old.toString(),data)
    }
    @Test fun projectiveAndSingularTransformsAreRejected() {
        val json=JSONObject(source());val offset=json.getJSONArray("packets").getJSONObject(0).getJSONObject("instances").getInt("offset")
        val projective=bytes();ByteBuffer.wrap(projective).order(ByteOrder.LITTLE_ENDIAN).putFloat(offset+12,.5f);rejected(data=projective)
        val singular=bytes();ByteBuffer.wrap(singular).order(ByteOrder.LITTLE_ENDIAN).putFloat(offset,0f);rejected(data=singular)
    }
    @Test fun invalidTransformInTheTailOfALargePacketIsRejected() {
        val json = JSONObject(source())
        val packet = json.getJSONArray("packets").getJSONObject(0)
        val instances = packet.getJSONObject("instances")
        val start = instances.getInt("offset")
        val count = 512
        val row = bytes().copyOfRange(start, start + 80)
        val expanded = bytes().copyOf(start + count * row.size)
        val wire = ByteBuffer.wrap(expanded).order(ByteOrder.LITTLE_ENDIAN)
        wire.putInt(8, expanded.size)
        wire.position(start)
        repeat(count) { wire.put(row) }
        packet.put("count", count)
        instances.put("bytes", count * row.size)
        assertEquals(count, read(json.toString(), expanded).packets.single().count)
        val last = start + (count - 1) * row.size
        wire.putFloat(last + 12, 0.5f)
        rejected(json.toString(), expanded)
        wire.putFloat(last + 12, 0f)
        wire.putFloat(last + 76, Float.NaN)
        rejected(json.toString(), expanded)
    }
    @Test fun malformedMaterialNumbersAndFlagsAreRejectedBeforeGpuAllocation() {
        fun materialChange(key:String,value:Any) {
            val json=JSONObject(source());json.getJSONArray("materials").getJSONObject(0).put(key,value);rejected(json.toString())
        }
        materialChange("roughness",2);materialChange("opacity","0.5");materialChange("depthTest","true")
        materialChange("color",org.json.JSONArray(listOf(1,1)));materialChange("side",0.5);materialChange("depthFunc",9)
    }
}
