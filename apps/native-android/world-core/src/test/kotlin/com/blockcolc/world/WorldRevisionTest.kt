package com.blockcolc.world

import org.junit.Assert.*
import org.junit.Test

class WorldRevisionTest {
    @Test fun buildingDoesNotInvalidateOtherOwners() {
        val world = WorldRevision(setOf("world", "building:a", "building:b"))
        assertTrue(world.replace("building:a", 0, 0))
        assertEquals(1L, world.revision("building:a"))
        assertEquals(0L, world.revision("building:b"))
        assertEquals(0L, world.revision("world"))
    }
    @Test fun staleAndDuplicateUpdatesAreRejected() {
        val world = WorldRevision(setOf("building:a"))
        assertTrue(world.replace("building:a", 0, 0))
        assertFalse(world.replace("building:a", 0, 0))
        world.rebuild(setOf("building:a"))
        assertFalse(world.replace("building:a", 0, 1))
        assertTrue(world.replace("building:a", 1, 0))
    }
    @Test fun unknownOwnerCannotCreateNewBuilding() {
        assertFalse(WorldRevision(setOf("world")).replace("building:unknown", 0, 0))
    }
}
