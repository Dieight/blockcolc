package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class BuiltinBlueprintCatalogTest {
    private fun bundled(name:String)=javaClass.classLoader!!.getResourceAsStream(name)!!.use{it.readBytes()}
    @Test fun allRegisteredBlueprintCategoriesAreActualDataRatherThanFrozenWorlds(){
        val catalog=BuiltinBlueprintCatalog.load()
        assertEquals(3,catalog.entries.count{it.category=="native"})
        assertTrue(catalog.entries.count{it.category=="supplemental"}>=16)
        assertTrue(catalog.entries.count{it.category=="daily"}>=6)
        assertEquals(20,catalog.entries.count{it.category=="holiday"})
        assertEquals(1,catalog.entries.count{it.category=="birthday"});assertEquals(1,catalog.entries.count{it.category=="placeholder"})
        for(entry in catalog.entries){
            val value=catalog.content(entry.id).json()
            assertEquals(entry.id,value.getString("id"));assertEquals(entry.voxelCount,value.getJSONArray("voxels").length())
            assertTrue(entry.bounds.footprint.width>0&&entry.bounds.footprint.depth>0)
        }
        val houses=catalog.entries.filter{it.category in setOf("native","supplemental")}
        val inputs=houses.mapIndexed{i,e->VillageInput(i.toLong(),e.bounds.footprint)}
        val placed=VillageLayout.generate(inputs)
        assertEquals(houses.size,placed.size)
        for((i,p)in placed.withIndex()){
            val expected=houses[i].bounds.footprint
            assertTrue((p.footprint.width==expected.width.toDouble()&&p.footprint.depth==expected.depth.toDouble())||
                (p.footprint.width==expected.depth.toDouble()&&p.footprint.depth==expected.width.toDouble()))
        }
    }
    @Test fun packagedCatalogRemainsBoundToTheCurrentSourceAssets(){
        val catalog=BuiltinBlueprintCatalog.load()
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/blueprint.ts").isFile}
        assertTrue(catalog.sourceHashes.size>20)
        for((path,expected)in catalog.sourceHashes){
            val actual=MessageDigest.getInstance("SHA-256").digest(File(root,path).readBytes()).joinToString(""){"%02x".format(it.toInt() and 255)}
            assertEquals("Stale bundled blueprint source: $path",expected,actual)
        }
    }
    @Test fun indexLookupsDoNotReadVoxelPayloadsAndMutableCopiesDoNotAlterTheAsset(){
        val reads=mutableListOf<String>()
        val catalog=BuiltinBlueprintCatalog.load{path->reads+=path;bundled(path)}
        assertEquals(listOf("native-blueprints/catalog.json"),reads)
        val entry=catalog.find("builtin-small-workshop")!!
        assertEquals(1,reads.size)
        val content=catalog.content(entry.id)
        assertEquals(2,reads.size)
        content.json().getJSONArray("voxels").remove(0)
        assertEquals(entry.voxelCount,content.json().getJSONArray("voxels").length())
        assertThrows(UnsupportedOperationException::class.java){(catalog.entries as MutableList).clear()}
        assertThrows(UnsupportedOperationException::class.java){(catalog.sourceHashes as MutableMap).clear()}
        assertEquals("builtin-unknown-placeholder",catalog.resolve("old-missing-blueprint").entry.id)
        assertEquals("builtin-small-workshop",catalog.resolve("builtin-small-workshop").entry.id)
        val holiday=catalog.entries.first{it.category=="holiday"}
        assertEquals("builtin-unknown-placeholder",catalog.resolve(holiday.id).entry.id)
        assertEquals(holiday.id,catalog.content(holiday.id).entry.id)
        assertThrows(IllegalArgumentException::class.java){catalog.content("user-import")}
    }
    @Test fun corruptPayloadAndMalformedUtf8AreRejectedWithoutChangingAnySourceAsset(){
        val catalog=BuiltinBlueprintCatalog.load{path->bundled(path).also{bytes->if(path!="native-blueprints/catalog.json")bytes[bytes.lastIndex]=(bytes.last().toInt() xor 1).toByte()}}
        assertThrows(IllegalArgumentException::class.java){catalog.content("builtin-small-workshop")}
        assertTrue(runCatching{BuiltinBlueprintCatalog.load{byteArrayOf(0xc3.toByte(),0x28)}}.isFailure)
        assertTrue(BuiltinBlueprintCatalog.load().content("builtin-small-workshop").entry.voxelCount>0)
    }
}
