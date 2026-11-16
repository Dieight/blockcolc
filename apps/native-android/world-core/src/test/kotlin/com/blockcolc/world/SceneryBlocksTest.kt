package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class SceneryBlocksTest {
    @Test fun completeSceneryIdentitySurvivesReconstructionAndDetectsEveryVoxelInputChange(){
        val base=RenderVoxel(0.0,1.0,2.0,"stone",0,"minecraft:stone",linkedMapOf("axis" to "x","waterlogged" to "false"))
        fun key(v:RenderVoxel)=SceneryBlockSet(listOf(v),emptyList()).sourceKey()
        val original=key(base)
        assertEquals(original,key(base.copy(sourceBlockState=linkedMapOf("waterlogged" to "false","axis" to "x"))))
        assertEquals(original,SceneryBlockSet(listOf(base),listOf(base)).sourceKey())
        val face=SignFace(listOf("One"),"black",false)
        val changes=listOf(base.copy(x=1.0),base.copy(y=2.0),base.copy(z=3.0),base.copy(materialId="wood"),base.copy(buildOrder=1),
            base.copy(sourceBlockId="minecraft:glass"),base.copy(sourceBlockId=null),base.copy(sourceBlockState=null),
            base.copy(sourceBlockState=mapOf("axis" to "z","waterlogged" to "false")),
            base.copy(movingPistonMovedState=PistonMovedState("minecraft:stone",mapOf("axis" to "x"))),
            base.copy(movingPistonPose=PistonPose(BlockFacing.EAST,.5,true,false)),
            base.copy(sign=SignText(face,face)),base.copy(campfire=listOf(CampfireItem(0,"minecraft:apple",1))),
            base.copy(emissiveKind="torch"),base.copy(emissiveLevel=0))
        assertEquals(changes.size,changes.map(::key).toSet().size)
        changes.forEach{assertNotEquals(original,key(it))}
        val second=base.copy(x=5.0)
        assertNotEquals(SceneryBlockSet(listOf(base,second),emptyList()).sourceKey(),SceneryBlockSet(listOf(second,base),emptyList()).sourceKey())
        assertNotEquals(key(base.copy(materialId="ab",sourceBlockId="c")),key(base.copy(materialId="a",sourceBlockId="bc")))
    }
    @Test fun cancelledSceneryIdentityNeverPublishesAPartialHashAndCacheHitsStillRespectCancellation(){
        val cells=List(1024){RenderVoxel(it.toDouble(),0.0,0.0,"stone",0,"minecraft:stone")}
        val blocks=SceneryBlockSet(cells,emptyList());var calls=0
        assertThrows(java.util.concurrent.CancellationException::class.java){blocks.sourceKey{++calls>2}}
        assertEquals(SceneryBlockSet(cells,emptyList()).sourceKey(),blocks.sourceKey())
        assertThrows(java.util.concurrent.CancellationException::class.java){blocks.sourceKey{true}}
    }
    @Test fun repeatedSceneryBlockIdentifiersShareOneImmutableLiteral(){
        val builder=SceneryBlocksBuilder()
        repeat(32){x->builder.put(x,0,0,String("sand".toCharArray()),"stone")}
        val blocks=builder.result();val id=blocks.voxels.first().sourceBlockId
        assertEquals("minecraft:sand",id)
        blocks.voxels.forEach{assertSame(id,it.sourceBlockId)}
        assertEquals(32,blocks.voxels.size)
    }
    private val oracle by lazy{JSONObject(javaClass.getResource("/scenery-oracle.json")!!.readText())}
    private fun equivalent(label:String,expected:Any?,actual:Any?) {
        when(expected) {
            null,JSONObject.NULL->assertTrue(label,actual==null||actual==JSONObject.NULL)
            is JSONObject->{assertTrue(label,actual is JSONObject);val value=actual as JSONObject;val keys=expected.keys().asSequence().toSet()
                assertEquals("$label keys",keys,value.keys().asSequence().toSet());for(key in keys)equivalent("$label.$key",expected.get(key),value.get(key))}
            is JSONArray->{assertTrue(label,actual is JSONArray);val value=actual as JSONArray;assertEquals("$label length",expected.length(),value.length());repeat(expected.length()){equivalent("$label[$it]",expected.get(it),value.get(it))}}
            is Number->{assertTrue(label,actual is Number);assertEquals(label,expected.toDouble(),(actual as Number).toDouble(),0.0)}
            else->assertEquals(label,expected,actual)
        }
    }
    @Test fun sourceFingerprintsBindArchetypesToTheCurrentAcceptedScenery() {
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/scenery.ts").isFile}
        val hashes=oracle.getJSONObject("sourceHashes")
        for(name in hashes.keys()) {
            val hash=MessageDigest.getInstance("SHA-256").digest(File(root,name).readBytes()).joinToString(""){"%02x".format(it.toInt() and 255)}
            assertEquals("Stale scenery model oracle: $name",hashes.getString(name),hash)
        }
    }
    @Test fun allBlockStatesVariantsAndDistantSubsetReferencesMatchActualSourceFunctions() {
        val cases=oracle.getJSONArray("models");assertEquals(100,cases.length())
        for(index in 0 until cases.length()) {
            val c=cases.getJSONObject(index);val args=c.getJSONObject("args");val name=c.getString("kind");val label="$name $args"
            val actual=when(name) {
                "tree"->SceneryBlocks.tree(SceneryTreeSpecies.entries.first{it.wireValue==args.getString("species")},args.getLong("variant"),args.getBoolean("tall"))
                "house"->SceneryBlocks.house(args.getString("wood"),args.getString("roof"),args.getBoolean("chimney"))
                "well"->SceneryBlocks.well();"farm"->SceneryBlocks.farm();"wreck"->SceneryBlocks.wreck();"dock"->SceneryBlocks.dock();"ruin"->SceneryBlocks.ruin()
                "camp"->SceneryBlocks.camp(args.getString("cloth"));"rock"->SceneryBlocks.rock(args.getString("seed"));"ice"->SceneryBlocks.iceSpire(args.getLong("seed"))
                else->error(name)
            }
            equivalent(label,c.getJSONArray("voxels"),JSONArray(actual.voxels.map(BlueprintSnapshot::voxelJson)))
            val distant=c.getJSONArray("distant");assertEquals(label,distant.length(),actual.distantVoxels.size)
            for(i in 0 until distant.length())assertSame(label,actual.voxels[distant.getInt(i)],actual.distantVoxels[i])
            assertEquals(actual.voxels.size-actual.distantVoxels.size,actual.detail().size)
        }
    }
    @Test fun overwrittenBlocksAndMutableCallerStatesDoNotChangePublishedArchetypes() {
        val builder=SceneryBlocksBuilder();val state=mutableMapOf("axis" to "x")
        builder.put(0,0,0,"oak_log","wood",true,state);val first=builder.result()
        state["axis"]="z";builder.put(0,0,0,"stone","stone",false)
        assertEquals("minecraft:oak_log",first.voxels.single().sourceBlockId);assertEquals("x",first.voxels.single().sourceBlockState!!["axis"])
        val second=builder.result();assertEquals(1,second.voxels.size);assertTrue(second.distantVoxels.isEmpty())
        assertThrows(UnsupportedOperationException::class.java){(first.voxels as MutableList).clear()}
        assertThrows(UnsupportedOperationException::class.java){(first.distantVoxels as MutableList).clear()}
        assertThrows(UnsupportedOperationException::class.java){(first.voxels.single().sourceBlockState as MutableMap)["axis"]="y"}
        assertThrows(IllegalArgumentException::class.java){SceneryBlockSet(first.voxels,listOf(first.voxels.single().copy()))}
        assertThrows(IllegalArgumentException::class.java){SceneryBlocks.tree(SceneryTreeSpecies.POPLAR,-1)}
    }
}
