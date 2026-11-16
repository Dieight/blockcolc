package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CancellationException

class BuildingRecipeCacheTest {
    private fun source()=BlueprintSnapshot.read(BuiltinBlueprintCatalog.load().entries.first{it.category=="native"}.let{BuiltinBlueprintCatalog.load().content(it.id).json()})

    @Test fun progressOnlyReplacesItsOwnCurrentRecipeAndMetadataDoesNotInvalidateGeometry() {
        val blueprint=source();val cache=BuildingRecipeCache()
        val first=cache.prepare("building:a",blueprint,"a",2000,10000)
        val other=cache.prepare("building:b",blueprint,"b",8000,7500)
        assertEquals(first.key,BuildingPreparation.key(blueprint,"a",2000,10000))
        val renamed=BlueprintSnapshot.read(blueprint.json().put("id","new-name").put("title","Different label"))
        assertSame(first,cache.prepare("building:a",renamed,"a",2000,10000))
        assertNotSame(first,cache.prepare("building:a",blueprint,"a",2001,10000))
        assertSame(other,cache.prepare("building:b",blueprint,"b",8000,7500))
        repeat(20){cache.prepare("building:a",blueprint,"a",3000+it,10000-it)}
        assertEquals(2,cache.stats.entries)
        assertEquals(2L,cache.stats.hits)
        cache.retainOwners(setOf("building:a"));assertEquals(1,cache.stats.entries)
        cache.clear();assertEquals(0,cache.stats.entries);assertEquals(0L,cache.stats.estimatedRetainedBytes)
    }

    @Test fun cancelledOrInvalidRequestsDoNotReplaceAnExistingOwnerAndRetentionIsBounded() {
        val blueprint=source();val cache=BuildingRecipeCache(maximumEntries=1)
        val initial=cache.prepare("building:a",blueprint,"a",5000,10000)
        assertThrows(CancellationException::class.java){cache.prepare("building:a",blueprint,"a",6000,10000){true}}
        assertThrows(IllegalArgumentException::class.java){cache.prepare("building:a",blueprint,"a",10001,10000)}
        assertSame(initial,cache.prepare("building:a",blueprint,"a",5000,10000))
        val overflow=cache.prepare("building:b",blueprint,"b",5000,10000);assertEquals(1,cache.stats.entries)
        assertSame(initial,cache.prepare("building:a",blueprint,"a",5000,10000))
        cache.retainOwners(setOf("building:b"))
        assertNotSame(overflow,cache.prepare("building:b",blueprint,"b",5000,10000))
        val disabled=BuildingRecipeCache(0)
        assertNotSame(disabled.prepare("a",blueprint,"a",1,10000),disabled.prepare("a",blueprint,"a",1,10000))
        assertEquals(0,disabled.stats.entries)
    }
    @Test fun repeatedlyScanningJustOverTheByteBudgetKeepsTheAdmittedLiveOwnersWarm(){
        val blueprint=source();val estimate=BuildingRecipeCache().also{it.prepare("a",blueprint,"a",5000,10000)}.stats.estimatedRetainedBytes
        val cache=BuildingRecipeCache(maximumEstimatedBytes=estimate*2)
        val a=cache.prepare("a",blueprint,"a",5000,10000);val b=cache.prepare("b",blueprint,"b",5000,10000)
        val overflow=cache.prepare("c",blueprint,"c",5000,10000)
        repeat(3){
            assertSame(a,cache.prepare("a",blueprint,"a",5000,10000))
            assertSame(b,cache.prepare("b",blueprint,"b",5000,10000))
            assertNotSame(overflow,cache.prepare("c",blueprint,"c",5000,10000))
        }
        assertEquals(6L,cache.stats.hits);assertEquals(2,cache.stats.entries)
        assertTrue(cache.stats.estimatedRetainedBytes<=estimate*2)
        cache.retainOwners(setOf("c"))
        val c=cache.prepare("c",blueprint,"c",5000,10000)
        assertSame(c,cache.prepare("c",blueprint,"c",5000,10000))
    }
}
