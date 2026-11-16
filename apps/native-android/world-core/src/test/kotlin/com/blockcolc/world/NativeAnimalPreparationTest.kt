package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CancellationException

class NativeAnimalPreparationTest {
    @Test fun temporaryBirthLookupKeepsSeedQueriesAndCrossingObstaclesWithoutRestrictingTheLiveHabitat(){
        val center=AnimalPoint(0.0,1.0,0.0)
        val seeds=listOf(AnimalPoint(120.0,1.0,0.0));val water=listOf(AnimalPoint(-120.0,1.0,0.0))
        fun solid(id:String,x:Double,z:Double,width:Double=1.0)=AnimalSolid(id,"scenery",x,x+width,0.0,4.0,z,z+1)
        val cells=listOf(solid("center",0.0,0.0),solid("water",-122.0,0.0),solid("far-east",450.0,0.0),
            solid("crossing",-400.0,0.0,800.0),solid("far-north",0.0,450.0),solid("padding-edge",128.0,0.0))
        val habitat=AnimalHabitatInput(emptyList(),cells);val bounds=AnimalBounds(-512.0,512.0,-512.0,512.0)
        val prepared=NativeAnimalPrepared(habitat,bounds,center,seeds,water,mapOf("scenery" to cells))
        val birth=prepared.birthHabitat{false}
        assertEquals(listOf("center","water","crossing","padding-edge"),birth.solids.map{it.id})
        assertSame(habitat.surfaces,birth.surfaces);assertEquals(cells,prepared.habitat.solids)
        val all=NativeAnimalHabitat(habitat,bounds,center,seeds);val local=NativeAnimalHabitat(birth,bounds,center,seeds)
        for(x in listOf(-123.25,-120.0,0.0,120.0,122.14))for(z in listOf(-.64,0.0,.64)){
            val probe=AnimalBounds(x-.64,x+.64,z-.64,z+.64)
            assertEquals(all.world.query(probe),local.world.query(probe))
        }
        assertEquals(listOf("far-east"),all.world.query(AnimalBounds(449.9,451.1,-.1,1.1)).map{it.id})
        assertThrows(CancellationException::class.java){prepared.birthHabitat{true}}
        assertEquals(cells,prepared.habitat.solids)
    }
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-animal-preparation-oracle.json")!!.readText())}
    private fun point(p:JSONObject)=AnimalPoint(p.getDouble("x"),p.getDouble("y"),p.getDouble("z"))
    private fun bounds(b:JSONObject)=AnimalBounds(b.getDouble("minX"),b.getDouble("maxX"),b.getDouble("minZ"),b.getDouble("maxZ"))
    private fun obstacle(o:JSONObject)=NativeAnimalObstacle(o.getString("id"),o.toString(),o.getJSONArray("voxels").let{a->List(a.length()){i->
        val v=a.getJSONObject(i);val state=v.optJSONObject("sourceBlockState")
        RenderVoxel(v.getDouble("x"),v.getDouble("y"),v.getDouble("z"),v.getString("materialId"),v.getInt("buildOrder"),
            v.optString("sourceBlockId").ifEmpty{null},state?.keys()?.asSequence()?.associateWith{state.getString(it)})}},
        point(o.getJSONObject("origin")).let{BlockPoint(it.x,it.y,it.z)},o.getDouble("rotation"),
        o.optJSONObject("offset")?.let{Position2(it.getDouble("x"),it.getDouble("z"))}?:Position2(0.0,0.0),o.optJSONObject("birthExclusion")?.let(::bounds))
    private fun surfaces(a:JSONArray):TerrainSurfaceTable {
        val positions=ArrayList<Double>();val tops=Array(TerrainMaterial.entries.size){ArrayList<Int>()}
        repeat(a.length()){i->val row=a.getJSONObject(i);val x0=row.getDouble("minX");val x1=row.getDouble("maxX");val z0=row.getDouble("minZ");val z1=row.getDouble("maxZ");val y=row.getDouble("supportY")-.5
            val first=positions.size/3;positions+=listOf(x0,y,z0,x0,y,z1,x1,y,z0,x1,y,z1)
            tops[TerrainMaterial.entries.single{it.wireValue==row.getString("material")}.ordinal]+=listOf(first,first+1,first+2,first+2,first+1,first+3)
        }
        val b=TerrainPlanBounds(-256.0,256.0,-256.0,256.0)
        return TerrainSurfaceTable.from(TerrainMesh(positions.toDoubleArray(),tops.map{it.toIntArray()}.toTypedArray(),arrayOf(IntArray(0),IntArray(0)),a.length(),
            TerrainBounds(-256.0,256.0,0.0,4.0,-256.0,256.0),b,b,emptyList(),TerrainLodCounts(0,0,0),TerrainWaterStats(0,0,0,0,0,0,0.0,0,0.0,0.0),null,null))
    }
    private fun prepare(input:JSONObject,compiler:NativeAnimalHabitatCompiler=NativeAnimalHabitatCompiler()):NativeAnimalPrepared =
        compiler.prepare(surfaces(input.getJSONArray("surfaces")),bounds(input.getJSONObject("bounds")),point(input.getJSONObject("center")),
            input.getJSONArray("sources").let{a->List(a.length()){obstacle(a.getJSONObject(it))}})
    @Test fun referenceUsesCurrentHabitatBehaviorNavigationAndShapes(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/animal-habitat.ts").exists()}
        val hashes=oracle.getJSONObject("sourceHashes")
        for(p in hashes.keys()){val actual=MessageDigest.getInstance("SHA-256").digest(File(root,p).readBytes()).joinToString(""){"%02x".format(it.toInt()and 255)};assertEquals(p,hashes.getString(p),actual)}
        assertEquals(16,oracle.getJSONArray("populations").length());assertEquals(4,oracle.getJSONArray("collision").length())
    }
    @Test fun allPhysicalBoxesAndFlagsMatchTheSourceUnderRotatedPlacement(){
        val cases=oracle.getJSONArray("collision");val compiler=NativeAnimalHabitatCompiler()
        repeat(cases.length()){i->val case=cases.getJSONObject(i);val actual=compiler.obstacle(obstacle(case.getJSONObject("input")));val expected=case.getJSONArray("expected")
            assertEquals(expected.length(),actual.size)
            actual.forEachIndexed{j,s->val e=expected.getJSONObject(j);assertEquals(e.getString("id"),s.id);assertEquals(e.getString("owner"),s.owner)
                val values=listOf(s.minX,s.maxX,s.minY,s.maxY,s.minZ,s.maxZ)
                listOf("minX","maxX","minY","maxY","minZ","maxZ").forEachIndexed{k,name->assertEquals("$i/$j/$name",e.getDouble(name),values[k],1e-9)}
                assertEquals(e.optBoolean("water",false),s.water);assertEquals(e.optBoolean("walkable",true),s.walkable)
            }
        }
    }
    private fun seeds(expected:JSONArray,actual:List<AnimalPoint>){assertEquals(expected.length(),actual.size);actual.forEachIndexed{i,p->val e=point(expected.getJSONObject(i));assertEquals(e,p)}}
    @Test fun realPopulationAndBirthReservoirMatchAllEnvironmentsAndEmptyGround(){
        val cases=oracle.getJSONArray("populations")
        repeat(cases.length()){i->val case=cases.getJSONObject(i);val input=case.getJSONObject("input");val expected=case.getJSONObject("expected");val prepared=prepare(input)
            seeds(expected.getJSONArray("land"),prepared.landSeeds);seeds(expected.getJSONArray("water"),prepared.waterSeeds)
            val state=prepared.populate(WorldEnvironment.fromWire(input.getString("style")),input.getLong("seed"))
            assertEquals(expected.getLong("sequence"),state.sequence);assertEquals(expected.getDouble("time"),state.time,0.0)
            val agents=expected.getJSONArray("agents");assertEquals("Population case $i",agents.length(),state.agents.size)
            state.agents.forEachIndexed{j,a->val e=agents.getJSONObject(j);assertEquals(e.getInt("id"),a.id);assertEquals(e.getString("species"),a.species)
                assertEquals(e.getString("kind"),a.kind);assertEquals(e.getString("activity"),a.activity)
                val p=point(e.getJSONObject("position"));assertEquals(p.x,a.position.x,1e-9);assertEquals(p.y,a.position.y,1e-9);assertEquals(p.z,a.position.z,1e-9)
                assertEquals(e.getDouble("heading"),a.heading,1e-9);assertEquals(e.getDouble("remaining"),a.remaining,1e-9);assertEquals(e.getDouble("phase"),a.phase,1e-9)
                assertEquals(e.getDouble("jumpCooldown"),a.jumpCooldown,1e-9);assertEquals(e.getInt("school"),a.school)
                assertEquals(if(e.has("waterY"))e.getDouble("waterY")else null,a.waterY)
            }
        }
    }
    @Test fun currentOwnerReuseSurvivesFailureAndPreservesGroundAndOtherOwners(){
        val input=oracle.getJSONArray("populations").getJSONObject(0).getJSONObject("input");val table=surfaces(input.getJSONArray("surfaces"));val b=bounds(input.getJSONObject("bounds"));val center=point(input.getJSONObject("center"))
        val a=obstacle(input.getJSONArray("sources").getJSONObject(0));val second=a.copy(owner="building:second",origin=BlockPoint(-12.0,.5,-8.0))
        val compiler=NativeAnimalHabitatCompiler();val initial=compiler.prepare(table,b,center,listOf(a,second));assertSame(initial,compiler.prepare(table,b,center,listOf(a,second)))
        var calls=0
        try{compiler.prepare(table,b,center,listOf(a.copy(sourceKey="cancelled",voxels=a.voxels+a.voxels),second)){++calls>2};fail()}catch(_:CancellationException){}
        assertSame(initial,compiler.prepare(table,b,center,listOf(a,second)))
        val changed=compiler.prepare(table,b,center,listOf(a.copy(sourceKey="raised",origin=a.origin.copy(y=2.5)),second))
        assertSame(initial.habitat.surfaces,changed.habitat.surfaces);assertSame(initial.owners.getValue(second.owner),changed.owners.getValue(second.owner))
        assertSame(initial.habitat.surfaceIndex,changed.habitat.surfaceIndex)
        assertNotSame(initial.owners.getValue(a.owner),changed.owners.getValue(a.owner));assertTrue(compiler.retainedColliderEstimate>0)
        compiler.clear();assertEquals(0L,compiler.retainedColliderEstimate)
    }
    @Test fun budgetsAndCancellationRejectCandidatesWithoutPublishingPartialInput(){
        val input=oracle.getJSONArray("populations").getJSONObject(0).getJSONObject("input");val table=surfaces(input.getJSONArray("surfaces"));val b=bounds(input.getJSONObject("bounds"));val center=point(input.getJSONObject("center"))
        val compiler=NativeAnimalHabitatCompiler(0);val empty=compiler.prepare(table,b,center,emptyList())
        try{compiler.prepare(table,b,center,listOf(obstacle(input.getJSONArray("sources").getJSONObject(0))));fail()}catch(_:IllegalArgumentException){}
        assertSame(empty,compiler.prepare(table,b,center,emptyList()))
        try{empty.populate(WorldEnvironment.VALLEY,1){true};fail()}catch(_:CancellationException){}
        try{(empty.landSeeds as MutableList).clear();fail()}catch(_:UnsupportedOperationException){}
    }
}
