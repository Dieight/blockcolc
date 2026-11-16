package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.DoubleBuffer
import java.nio.IntBuffer
import java.nio.ReadOnlyBufferException
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class TerrainGeneratorTest {
    companion object {private val oracle by lazy{JSONObject(TerrainGeneratorTest::class.java.getResource("/terrain-oracle.json")!!.readText())}}
    private fun rows(a:JSONArray)=List(a.length()){a.getJSONObject(it)}
    private fun equivalent(label:String,expected:Any?,actual:Any?) {
        when(expected) {
            null,JSONObject.NULL->assertTrue(label,actual==null||actual==JSONObject.NULL)
            is JSONObject->{assertTrue(label,actual is JSONObject);val value=actual as JSONObject
                val keys=expected.keys().asSequence().toSet();assertEquals("$label keys",keys,value.keys().asSequence().toSet());for(key in keys)equivalent("$label.$key",expected.get(key),value.get(key))}
            is JSONArray->{assertTrue(label,actual is JSONArray);val value=actual as JSONArray;assertEquals("$label length",expected.length(),value.length());repeat(expected.length()){equivalent("$label[$it]",expected.get(it),value.get(it))}}
            is Number->{assertTrue(label,actual is Number);assertEquals(label,expected.toDouble(),(actual as Number).toDouble(),1e-9)}
            else->assertEquals(label,expected,actual)
        }
    }
    @Test fun oracleUsesCurrentFormalTerrainRatherThanAPreparedWorldOrNativeOutput() {
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/terrain.ts").isFile}
        val hashes=oracle.getJSONObject("sourceHashes")
        for(name in hashes.keys())assertEquals("Stale terrain oracle: $name",hashes.getString(name),sha(File(root,name).readBytes()))
    }
    private fun profileJson(p:TerrainProfile):JSONObject=when(p) {
        is TerrainProfile.Floating->JSONObject().put("kind","classic-island").put("cellSize",p.cellSize)
        is TerrainProfile.Ocean->JSONObject().put("kind","ocean-island").put("mainRadius",p.mainRadius).put("beach",p.beach).put("nearExtent",p.near)
            .put("middleExtent",p.middle).put("farExtent",p.far).put("farCellSize",p.farCellSize).put("strait",p.strait)
        is TerrainProfile.Regional->JSONObject().put("kind","natural-valley").put("nearExtent",p.near).put("middleExtent",p.middle).put("farExtent",p.far)
            .put("farFineExtent",p.farFine).put("refinedFar",p.refinedFar).put("farCellSize",p.farCellSize)
    }
    @Test fun seededFieldsMacroReliefAndEveryProfileBoundaryMatchFormalMath() {
        val profiles=rows(oracle.getJSONArray("profiles"));assertEquals(108,profiles.size)
        for(p in profiles)equivalent("profile $p",p.getJSONObject("result"),profileJson(TerrainProfiles.forEnvironment(WorldEnvironment.fromWire(p.getString("environment")),p.getDouble("radius"),if(p.isNull("refined"))null else p.getBoolean("refined"))))
        val samples=rows(oracle.getJSONArray("samples"));assertTrue(samples.size>900)
        for(p in samples) {
            val seed=p.getLong("seed").toInt();val x=p.getDouble("x");val z=p.getDouble("z");val channel=p.getInt("channel")
            assertEquals(p.toString(),p.getLong("hash"),TerrainMath.hash(seed,channel,kotlin.math.floor(x),kotlin.math.floor(z)))
            assertEquals(p.getDouble("value"),TerrainMath.value(x*.021,z*.021,seed,channel),1e-12)
            assertEquals(p.getDouble("fractal"),TerrainMath.fractal(x*.021,z*.021,seed,channel),1e-12)
            assertEquals(p.getDouble("landNoise"),TerrainMath.landscapeNoise(seed,x,z,31.0),1e-12)
            assertEquals(p.getDouble("mosaicNoise"),TerrainMath.mosaicNoise(seed,x,z,31.0),1e-12)
            for(coarse in listOf(false,true)) {
                val actual=TerrainMath.macro(x,z,seed,coarse);val expected=p.getJSONObject(if(coarse)"coarse"else"macro")
                assertEquals(expected.getDouble("height"),actual.height,0.0);assertEquals(expected.getBoolean("rocky"),actual.rocky)
                assertEquals(expected.getDouble("moisture"),actual.moisture,1e-12);assertEquals(expected.getDouble("mountainSignal"),actual.mountainSignal,1e-12)
            }
        }
    }
    private fun fieldsJson(f:MosaicFields)=JSONObject().put("a",f.a).put("b",f.b).put("spacing",f.spacing).put("detail",f.detail).put("broad",f.broad).put("ridge",f.ridge)
        .put("mountain",f.mountain).put("ice",f.ice).put("bad",f.bad).put("forest",f.forest).put("forestHabitat",f.forestHabitat).put("coast",f.coast)
        .put("rolling",f.rolling).put("peak",f.peak).put("mesaRaw",f.mesaRaw).put("legacyPremix",f.legacyPremix).put("shoreField",f.shoreField).put("coldHotBorder",f.coldHotBorder)
    @Test fun coastClimateReliefShoreDistanceAndSeabedKeepTheirSeparateFields() {
        val samplers=HashMap<Pair<Int,Double>,MosaicTerrain>();val cases=rows(oracle.getJSONArray("mosaicSamples"));assertTrue(cases.size>800)
        for(p in cases) {
            val seed=p.getLong("seed").toInt();val radius=p.getDouble("radius");val x=p.getDouble("x");val z=p.getDouble("z")
            val field=samplers.getOrPut(seed to radius){MosaicTerrain(seed,radius)}
            equivalent("mosaic fields $p",p.getJSONObject("fields"),fieldsJson(field.fields(x,z)))
            val sample=field.sample(x,z);val truth=p.getJSONObject("sample")
            assertEquals(truth.getString("biome"),sample.biome);assertEquals(truth.getString("material"),sample.material.wireValue);assertEquals(truth.getDouble("height"),sample.height,0.0)
            val(u,v,spacing)=field.grid(x,z);equivalent("grid",p.getJSONObject("grid"),JSONObject().put("u",u).put("v",v).put("spacing",spacing))
            assertEquals(p.getString("region"),field.regionAt(x,z));assertEquals(p.getDouble("warm"),field.warmSeaWeight(x,z),1e-12)
            if(p.has("shore")){assertEquals(p.getDouble("shore"),field.shoreDistance(x,z),1e-9);assertEquals(p.getDouble("seabed"),field.seabedHeight(x,z),1e-9)}
        }
    }
    private fun placement(value:JSONObject):VillagePlacement {
        val p=value.getJSONObject("worldPosition");val f=value.getJSONObject("footprint");val o=value.getJSONObject("blueprintOffset");val e=value.getJSONObject("entrance")
        return VillagePlacement(value.getLong("settlementIndex"),Position3(p.getDouble("x"),p.getDouble("y"),p.getDouble("z")),value.getDouble("rotationY"),
            Footprint(f.getDouble("width"),f.getDouble("depth")),Position2(o.getDouble("x"),o.getDouble("z")),RoadCell(e.getInt("x"),e.getInt("z")))
    }
    private fun planBounds(b:TerrainPlanBounds)=JSONObject().put("minX",b.minX).put("maxX",b.maxX).put("minZ",b.minZ).put("maxZ",b.maxZ)
    private fun metadata(mesh:TerrainMesh):JSONObject {
        val b=mesh.bounds;val h=mesh.hydrology
        return JSONObject().put("cellCount",mesh.cellCount).put("triangleCount",mesh.triangleCount).put("terrainGenerationVersion",mesh.generationVersion)
            .put("bounds",JSONObject().put("minX",b.minX).put("maxX",b.maxX).put("minY",b.minY).put("maxY",b.maxY).put("minZ",b.minZ).put("maxZ",b.maxZ))
            .put("framingBounds",planBounds(mesh.framingBounds)).put("nearDetailBounds",planBounds(mesh.nearDetailBounds))
            .put("naturalTrees",JSONArray(mesh.naturalTrees.map{JSONObject().put("x",it.x).put("y",it.y).put("z",it.z).put("scale",it.scale)}))
            .put("lodCellCounts",JSONObject().put("near",mesh.lod.near).put("middle",mesh.lod.middle).put("far",mesh.lod.far))
            .put("hydrology",JSONObject().put("networkCount",h.networks).put("basinCount",h.basins).put("riverCellCount",h.rivers).put("lakeCellCount",h.lakes)
                .put("riverSegmentCount",h.segments).put("outletCount",h.outlets).put("maxUphillWaterStep",h.maxUphill).put("protectedWaterCellCount",h.protectedCells)
                .put("waterSurfaceArea",h.waterArea).put("terrainSurfaceArea",h.terrainArea)).apply {
                mesh.oceanMain?.let{put("oceanMain",JSONObject().put("radius",it.radius).put("beach",it.beach))}
                mesh.oceanIslets?.let{put("oceanIslets",JSONArray(it.map{islet->JSONObject().put("x",islet.x).put("z",islet.z).put("radius",islet.radius).put("peakHeight",islet.peakHeight)}))}
            }
    }
    private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
    private fun positionsHash(values:DoubleBuffer):String {
        val bytes=ByteBuffer.allocate(values.remaining()*4).order(ByteOrder.LITTLE_ENDIAN)
        while(values.hasRemaining())bytes.putFloat(values.get().toFloat());return sha(bytes.array())
    }
    private fun indexHash(values:IntBuffer):String {
        val bytes=ByteBuffer.allocate(values.remaining()*4).order(ByteOrder.LITTLE_ENDIAN)
        while(values.hasRemaining())bytes.putInt(values.get());return sha(bytes.array())
    }
    private fun surfaceJson(s:TerrainSurface?)=s?.let{JSONObject().put("minX",it.minX).put("maxX",it.maxX).put("minZ",it.minZ).put("maxZ",it.maxZ)
        .put("supportY",it.supportY).put("material",it.material.wireValue).put("water",it.water)}?:JSONObject.NULL
    private fun supportedPositionJson(p:DecorationPlacement)=JSONObject().put("x",p.worldPosition.x).put("y",p.worldPosition.y).put("z",p.worldPosition.z)
    @Test fun fullFourEnvironmentMeshesMatchActualFormalBuffersAndHydrology() {
        val cases=rows(oracle.getJSONArray("cases"));assertEquals(40,cases.size);var actualFootings=0
        for(p in cases) {
            val name=p.getString("name");val placements=rows(p.getJSONArray("placements")).map(::placement)
            val roads=rows(p.getJSONArray("roads")).map{RoadCell(it.getInt("x"),it.getInt("z"))}
            val pads=rows(p.getJSONArray("pads")).map{TerrainPad(it.getDouble("x"),it.getDouble("z"),it.getDouble("width"),it.getDouble("depth"),it.getDouble("groundLevel"))}
            val minimum=if(p.isNull("minimumRadius"))null else p.getJSONObject("minimumRadius").let{Position2(it.getDouble("x"),it.getDouble("z"))}
            val mesh=SteppedTerrain.generate(placements,roads,pads,minimum,TerrainOptions(WorldEnvironment.fromWire(p.getString("environment")),p.getString("seed"),4,if(p.isNull("refined"))null else p.getBoolean("refined")))
            val geometry=p.getJSONObject("geometry")
            equivalent(name,p.getJSONObject("metadata"),metadata(mesh))
            assertEquals("$name vertices",geometry.getInt("vertexCount"),mesh.vertexCount)
            assertEquals("$name all Float32 positions",geometry.getString("positions"),positionsHash(mesh.positions()))
            for(material in TerrainMaterial.entries) {
                val expected=geometry.getJSONObject("tops").getJSONObject(material.wireValue);val indices=mesh.topIndices(material)
                assertEquals("$name ${material.wireValue}",expected.getInt("length"),indices.remaining())
                assertEquals("$name ${material.wireValue} indices",expected.getString("sha"),indexHash(indices))
            }
            for(material in listOf(TerrainMaterial.DIRT,TerrainMaterial.STONE)) {
                val expected=geometry.getJSONObject("sides").getJSONObject(material.wireValue);val indices=mesh.sideIndices(material)
                assertEquals("$name side ${material.wireValue}",expected.getInt("length"),indices.remaining())
                assertEquals("$name side ${material.wireValue} indices",expected.getString("sha"),indexHash(indices))
            }
            val cacheKey=TerrainInputKey.key(placements,roads,pads,minimum,TerrainOptions(WorldEnvironment.fromWire(p.getString("environment")),p.getString("seed"),4,if(p.isNull("refined"))null else p.getBoolean("refined")))
            val encoded=TerrainMeshCodec.encode(cacheKey,mesh)!!;val restored=TerrainMeshCodec.decode(cacheKey,encoded)!!
            equivalent("$name restored metadata",p.getJSONObject("metadata"),metadata(restored))
            assertEquals("$name restored coordinates",geometry.getString("positions"),positionsHash(restored.positions()))
            for(material in TerrainMaterial.entries)assertEquals("$name restored ${material.wireValue}",geometry.getJSONObject("tops").getJSONObject(material.wireValue).getString("sha"),indexHash(restored.topIndices(material)))
            for(material in listOf(TerrainMaterial.DIRT,TerrainMaterial.STONE))assertEquals("$name restored side ${material.wireValue}",geometry.getJSONObject("sides").getJSONObject(material.wireValue).getString("sha"),indexHash(restored.sideIndices(material)))
            val table=TerrainSurfaceTable.from(restored);val surfaces=p.getJSONObject("surface")
            assertEquals(surfaces.getInt("length"),table.length);assertEquals(surfaces.getLong("columnBytes"),table.columnBytes);assertEquals(surfaces.getLong("indexBytes"),table.indexBytes)
            for(probe in rows(surfaces.getJSONArray("rows")))equivalent("$name table row",probe.get("surface"),surfaceJson(table.at(probe.getInt("index"))))
            for(probe in rows(surfaces.getJSONArray("points")))equivalent("$name surface point $probe",probe.get("surface"),surfaceJson(table.sample(probe.getDouble("x"),probe.getDouble("z"))))
            for(probe in rows(surfaces.getJSONArray("queries"))) {
                val b=probe.getJSONObject("bounds")
                equivalent("$name surface query",probe.get("rows"),JSONArray(table.query(TerrainPlanBounds(b.getDouble("minX"),b.getDouble("maxX"),b.getDouble("minZ"),b.getDouble("maxZ"))).map(::surfaceJson)))
            }
            for(reward in rows(p.getJSONArray("rewards"))) {
                val input=reward.getJSONObject("input");val raw=input.getJSONObject("blueprint");val blueprint=BlueprintSnapshot.read(raw,true)
                val position=input.getJSONObject("worldPosition");val f=input.getJSONObject("footprint");val offset=input.getJSONObject("blueprintOffset");val local=input.getJSONObject("localPosition")
                val placement=DecorationPlacement(DecorationInput(input.getString("rewardId"),input.getString("resourceId"),input.getString("date"),input.getString("projectId"),blueprint.bounds.footprint,
                    Position2(local.getDouble("x"),local.getDouble("z")),input.getInt("rotationQuarterTurns")),Position3(position.getDouble("x"),position.getDouble("y"),position.getDouble("z")),input.getDouble("rotationY"),
                    Footprint(f.getDouble("width"),f.getDouble("depth")),Position2(offset.getDouble("x"),offset.getDouble("z")))
                val supported=DecorationSupport.place(placement,blueprint,table)
                actualFootings+=supported.foundation.size
                equivalent("$name supported reward",reward.getJSONObject("supported").getJSONObject("worldPosition"),supportedPositionJson(supported.placement))
                equivalent("$name reward foundations",reward.getJSONArray("foundation"),JSONArray(supported.foundation.map(BlueprintSnapshot::voxelJson)))
            }
        }
        assertTrue("Uneven ground must exercise actual footing blocks",actualFootings>0)
    }
    @Test fun immutableResultsInvalidVersionsAndCancelledBuildsCannotBecomePartialWorlds() {
        assertThrows(IllegalArgumentException::class.java){SteppedTerrain.generate(emptyList(),emptyList(),options=TerrainOptions(generation=3))}
        assertThrows(IllegalArgumentException::class.java){SteppedTerrain.generate(emptyList(),emptyList(),minimumRadius=Position2(Double.NaN,1.0))}
        assertThrows(CancellationException::class.java){SteppedTerrain.generate(emptyList(),emptyList()){true}}
        var checks=0
        assertThrows(CancellationException::class.java){SteppedTerrain.generate(emptyList(),emptyList(),options=TerrainOptions(WorldEnvironment.VALLEY)){++checks>10}}
        val result=SteppedTerrain.generate(emptyList(),emptyList())
        assertTrue(result.cellCount>1000)
        assertThrows(ReadOnlyBufferException::class.java){result.positions().put(0,99.0)}
        assertThrows(ReadOnlyBufferException::class.java){result.topIndices(TerrainMaterial.GRASS).put(0,99)}
        assertThrows(ReadOnlyBufferException::class.java){result.sideIndices(TerrainMaterial.STONE).put(0,99)}
        assertThrows(UnsupportedOperationException::class.java){(result.naturalTrees as MutableList).clear()}
        assertFalse(result.positions().hasArray())
        assertThrows(CancellationException::class.java){TerrainSurfaceTable.from(result){true}}
        val table=TerrainSurfaceTable.from(result)
        assertNull(table.sample(Double.NaN,0.0));assertTrue(table.query(TerrainPlanBounds(1.0,0.0,0.0,1.0)).isEmpty())
    }
    @Test fun mixedResolutionIntervalQueriesRetainSourceEmissionOrder() {
        val edges=listOf(TerrainEdge(8.0,16.0,1.0),TerrainEdge(0.0,32.0,2.0),TerrainEdge(-8.0,4.0,3.0),TerrainEdge(4.0,8.0,4.0))
        val index=TerrainLineIntervals(edges)
        assertEquals(listOf(edges[0],edges[1],edges[3]),index.overlapping(4.0,12.0))
        assertEquals(listOf(edges[1],edges[2]),index.overlapping(0.0,4.0))
        assertTrue(index.overlapping(40.0,48.0).isEmpty())
        assertEquals(TerrainCoordinate.at(-0.0,0.0),TerrainCoordinate.at(0.0,-0.0))
    }
}
