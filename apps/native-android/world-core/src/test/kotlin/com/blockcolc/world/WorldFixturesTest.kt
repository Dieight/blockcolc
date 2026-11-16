package com.blockcolc.world

import org.junit.Assert.*
import org.junit.Test

class WorldFixturesTest {
    @Test fun fourBoundedWorldsAndTheirOwnerUpdatesAreAccepted(){
        for(name in listOf("ocean","coast","valley","floating")){
            assertEquals(name,WorldFixtures.requireName(name))
            assertEquals("$name-update",WorldFixtures.requireStem("$name-update"))
        }
    }
    @Test fun malformedNamesNeverFallBackToAnUnrelatedWorld(){
        for(name in listOf("../ocean","coast/","unknown","","ocean-update-update"))
            assertThrows(IllegalArgumentException::class.java){WorldFixtures.requireStem(name)}
        assertThrows(IllegalArgumentException::class.java){WorldFixtures.requireName("ocean-update")}
    }
}
