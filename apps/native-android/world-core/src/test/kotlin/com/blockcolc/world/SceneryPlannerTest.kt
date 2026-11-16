package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.IdentityHashMap
import java.util.concurrent.CancellationException

class SceneryPlannerTest {
    companion object {private val oracle by lazy{JSONObject(SceneryPlannerTest::class.java.getResource("/scenery-oracle.json")!!.readText())}}
    private fun rows(a:JSONArray)=List(a.length()){a.getJSONObject(it)}
    private fun digest(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).hex()
    private fun ByteArray.hex()=joinToString(""){"%02x".format(it.toInt() and 255)}
    private fun voxelHash(voxels:List<RenderVoxel>):String {
        val hash=MessageDigest.getInstance("SHA-256");val buffer=ByteBuffer.allocate(28).order(ByteOrder.LITTLE_ENDIAN)
        fun int(n:Int){buffer.clear();buffer.putInt(n);hash.update(buffer.array(),0,4)}
        fun text(s:String){val bytes=s.toByteArray(Charsets.UTF_8);int(bytes.size);hash.update(bytes)}
        fun zero(n:Double)=if(n==0.0)0.0 else n
        for(v in voxels) {
            buffer.clear();buffer.putDouble(zero(v.x));buffer.putDouble(zero(v.y));buffer.putDouble(zero(v.z));buffer.putInt(v.buildOrder);hash.update(buffer.array())
            text(v.materialId);text(v.sourceBlockId!!)
            val states=v.sourceBlockState?.toSortedMap();int(states?.size?:-1)
            for((key,value)in states.orEmpty()){text(key);text(value)}
        }
        return hash.digest().hex()
    }
    private fun blocks(label:String,expected:JSONObject,actual:SceneryBlockSet) {
        assertEquals("$label all voxel count",expected.getInt("count"),actual.voxels.size)
        assertEquals("$label silhouette count",expected.getInt("distantCount"),actual.distantVoxels.size)
        assertEquals("$label every voxel/state",expected.getString("voxels"),voxelHash(actual.voxels))
        val refs=IdentityHashMap<RenderVoxel,Int>();actual.voxels.forEachIndexed{i,v->refs[v]=i}
        val indices=ByteBuffer.allocate(actual.distantVoxels.size*4).order(ByteOrder.LITTLE_ENDIAN)
        for(v in actual.distantVoxels){assertTrue("$label silhouette is source subset",refs.containsKey(v));indices.putInt(refs.getValue(v))}
        assertEquals("$label distant identity/order",expected.getString("distant"),digest(indices.array()))
    }
    @Test fun continuousEcologyReefAndBiomeFieldsMatchFormalSourceRatherThanMaterialLabels() {
        val cases=rows(oracle.getJSONArray("fields"));assertTrue(cases.size>=600)
        for(c in rows(oracle.getJSONArray("hypots")))assertEquals(c.getDouble("result"),SourceNumbers.hypot(c.getDouble("x"),c.getDouble("z")),0.0)
        val climates=HashMap<Pair<Int,Double>,SceneryClimate>()
        for(c in cases) {
            val seed=c.getLong("seed").toInt();val radius=c.getDouble("radius");val x=c.getDouble("x");val z=c.getDouble("z");val height=c.getDouble("height")
            assertEquals(c.getDouble("hypot"),SourceNumbers.hypot(x,z),0.0)
            val actual=climates.getOrPut(seed to radius){SceneryClimate(seed,radius)}.treeSuitability(x,z,height,c.getBoolean("cold"));val e=c.getJSONObject("result")
            assertEquals(e.getDouble("forest"),actual.forest,1e-12);assertEquals(e.getDouble("conifer"),actual.conifer,1e-12)
            assertEquals(e.getDouble("meadow"),actual.meadow,1e-12);assertEquals(e.getDouble("treeline"),actual.treeline,1e-12)
            assertEquals(c.getDouble("density"),SceneryClimate.reefDensity(seed,x,z,32.0,-95.0,132.0,6+height/7),1e-12)
            assertEquals(c.getBoolean("channel"),SceneryClimate.reefChannel(seed,x,z))
            assertEquals(c.getDouble("coverage"),ReefField.coverage(seed,x,z,32.0,-95.0,132.0),1e-12)
            for(b in rows(c.getJSONArray("biomes")))assertEquals(b.getString("biome"),WorldSceneryPlanner.biome("中文世界 😀",x,z,WorldEnvironment.fromWire(b.getString("environment")),height))
        }
    }
    @Test fun coralColoniesClippingAndWorldGridHaloMatchBothUnsignedSeedBoundaries() {
        val cases=rows(oracle.getJSONArray("reefs"));assertEquals(15,cases.size)
        for(c in cases) {
            val seed=c.getLong("seed").toInt();val mode=c.getString("mode");val halfX=c.getDouble("halfX");val halfZ=c.getDouble("halfZ")
            val originX=c.getDouble("originX");val originZ=c.getDouble("originZ")
            val allowed:(Double,Double)->Boolean={x,z->mode=="standalone"||x>=-halfX&&x<halfX&&z>=-halfZ&&z<halfZ&&!(x>3&&z< -2)}
            val field=if(mode!="connected")null else ReefWorldField(originX,originZ,{x,z->kotlin.math.floor(-9+.02*(x+originX)+.03*(z+originZ))},
                {x,z->SceneryClimate.reefDensity(seed,x+originX,z+originZ,-20.0,55.0,56.0,9.0)})
            blocks("reef $mode ${c.getLong("seed")}",c,ReefField.create(seed,halfX,halfZ,allowed,field))
        }
    }
    private fun placement(value:JSONObject):VillagePlacement {
        val p=value.getJSONObject("worldPosition");val f=value.getJSONObject("footprint");val o=value.getJSONObject("blueprintOffset");val e=value.getJSONObject("entrance")
        return VillagePlacement(value.getLong("settlementIndex"),Position3(p.getDouble("x"),p.getDouble("y"),p.getDouble("z")),value.getDouble("rotationY"),
            Footprint(f.getDouble("width"),f.getDouble("depth")),Position2(o.getDouble("x"),o.getDouble("z")),RoadCell(e.getInt("x"),e.getInt("z")))
    }
    @Test fun allFourEnvironmentsExpandedWorldsAndUnicodeSeedsKeepFormalSceneryOrderAndGeometry() {
        val cases=rows(oracle.getJSONArray("worlds"));assertEquals(16,cases.size)
        var voxelCount=0;var wrecks=0;var reefs=0;val roles=hashSetOf<SceneryRole>()
        for(c in cases) {
            val label=c.getString("name");val environment=WorldEnvironment.fromWire(c.getString("environment"))
            val placements=rows(c.getJSONArray("placements")).map(::placement);val roads=rows(c.getJSONArray("roads")).map{RoadCell(it.getInt("x"),it.getInt("z"))}
            val pads=rows(c.getJSONArray("pads")).map{TerrainPad(it.getDouble("x"),it.getDouble("z"),it.getDouble("width"),it.getDouble("depth"),it.getDouble("groundLevel"))}
            val mesh=SteppedTerrain.generate(placements,roads,pads,options=TerrainOptions(environment,c.getString("seed")))
            val protected=rows(c.getJSONArray("protectedRects")).map{SceneryRect(it.getDouble("x"),it.getDouble("z"),it.getDouble("width"),it.getDouble("depth"))}
            val input=WorldSceneryInput(environment,c.getString("seed"),TerrainSurfaceTable.from(mesh),protected,roads,mesh.naturalTrees,mesh.nearDetailBounds,
                maxOf(kotlin.math.abs(mesh.framingBounds.minX),kotlin.math.abs(mesh.framingBounds.maxX)))
            val actual=WorldSceneryPlanner.plan(input);val village=actual.village
            val key=SceneryInputKey.key("12".repeat(32),input)
            val restored=SceneryCodec.decode(key,SceneryCodec.encode(key,actual)!!)!!
            assertEquals(village,restored.village);assertEquals(actual.objects.size,restored.objects.size)
            if(c.isNull("village"))assertNull("$label village",village)else {
                assertNotNull("$label village",village);val e=c.getJSONObject("village")
                assertEquals(e.getDouble("x"),village!!.x,0.0);assertEquals(e.getDouble("z"),village.z,0.0)
                assertEquals(e.getDouble("width"),village.width,0.0);assertEquals(e.getDouble("depth"),village.depth,0.0)
            }
            val objects=rows(c.getJSONArray("objects"));assertEquals("$label object count",objects.size,actual.objects.size)
            for((index,o)in actual.objects.withIndex()) {
                val e=objects[index];val name="$label ${e.getString("id")}"
                assertEquals(name,e.getString("id"),o.id);assertEquals(name,e.getString("role"),o.role.wireValue)
                assertEquals(name,e.getDouble("x"),o.x,0.0);assertEquals(name,e.getDouble("y"),o.y,0.0);assertEquals(name,e.getDouble("z"),o.z,0.0)
                assertEquals(name,e.getDouble("width"),o.width,0.0);assertEquals(name,e.getDouble("depth"),o.depth,0.0)
                blocks(name,e,o.blocks);voxelCount+=o.blocks.voxels.size;roles+=o.role
                val fromFile=restored.objects[index]
                assertEquals(o.id,fromFile.id);assertEquals(o.role,fromFile.role);assertEquals(o.rect,fromFile.rect);assertEquals(o.y,fromFile.y,0.0)
                blocks("$name from file",e,restored.objects[index].blocks)
                if(o.role==SceneryRole.WRECK)wrecks++;if(":reef:" in o.id)reefs++
            }
            assertThrows(UnsupportedOperationException::class.java){(actual.objects as MutableList).clear()}
        }
        assertTrue(voxelCount>100000);assertTrue(wrecks>0);assertTrue(reefs>0)
        assertEquals(SceneryRole.entries.toSet(),roles)
    }
    @Test fun callerMutationCancellationAndLodHysteresisDoNotPublishPartialOrDuplicateScenery() {
        val terrain=SteppedTerrain.generate(emptyList(),emptyList());val table=TerrainSurfaceTable.from(terrain)
        val protected=mutableListOf(SceneryRect(0.0,0.0,16.0,16.0));val roads=mutableListOf(RoadCell(2,0));val trees=mutableListOf(TerrainTree(0.0,3.0,0.0,1.0))
        val input=WorldSceneryInput(WorldEnvironment.FLOATING,"immutable",table,protected,roads,trees)
        protected.clear();roads.clear();trees.clear()
        assertEquals(1,input.protectedRects.size);assertEquals(1,input.roads.size);assertEquals(1,input.trees.size)
        assertThrows(UnsupportedOperationException::class.java){(input.roads as MutableList).clear()}
        assertThrows(CancellationException::class.java){WorldSceneryPlanner.plan(input){true}}
        var checkpoints=0;assertThrows(CancellationException::class.java){WorldSceneryPlanner.plan(input){++checkpoints>8}}
        assertThrows(CancellationException::class.java){ReefField.create(7,20.0,20.0,cancelled={true})}
        assertThrows(CancellationException::class.java){EcotoneTrees.plan(EcotoneTreeInput(7,0.0,0.0,26.0,TerrainPlanBounds(-512.0,512.0,-512.0,512.0),{_,_->null},{_,_,_,_->null},{_,_->false})){true}}
        assertFalse(WorldSceneryPlanner.lod(30.0));assertTrue(WorldSceneryPlanner.lod(29.99));assertTrue(WorldSceneryPlanner.lod(42.0,true));assertFalse(WorldSceneryPlanner.lod(42.01,true))
        assertThrows(IllegalArgumentException::class.java){WorldSceneryInput(WorldEnvironment.OCEAN,"invalid",table,listOf(SceneryRect(Double.NaN,0.0,1.0,1.0)),emptyList(),emptyList())}
    }
}
