package com.blockcolc.preview.world

import org.junit.Assert.*
import org.junit.Test

class NativeWorldInteractionStateTest {
    @Test fun viewingAKnownBuildingLeavesTheRoomAndKeepsThatBuildingsMemoryAndAxis(){
        val state=NativeWorldInteractionState();state.scene("a",1,listOf("house"));state.toggleInterior()
        assertTrue(state.indoors);state.pick("unknown");assertTrue(state.indoors)
        state.pick("house");assertFalse(state.indoors);assertEquals("house",state.selected);assertEquals("house",state.memory)
    }
    @Test fun closingMemoryAndResettingViewKeepTheSelectedAxis(){
        val state=NativeWorldInteractionState();state.scene("a",1,listOf("house","reward:cake"));state.pick("house")
        assertEquals("house",state.memory);state.closeMemory();assertNull(state.memory);assertEquals("house",state.selected)
        val version=state.resetVersion;state.resetView();assertEquals(version+1,state.resetVersion);assertEquals("house",state.selected)
        state.pick("reward:cake");state.resetMap();assertNull(state.memory);assertNull(state.selected)
    }
    @Test fun sceneReplacementAndMissingOwnersRejectStaleSelections(){
        val state=NativeWorldInteractionState();state.scene("a",1,listOf("house"));state.pick("unknown");assertNull(state.selected)
        state.pick("house");state.scene("a",1,listOf("house"));assertEquals("house",state.memory)
        state.scene("a",1,listOf("new"));assertNull(state.memory);assertNull(state.selected)
        state.pick("new");state.scene("a",2,listOf("new"));assertNull(state.memory);assertNull(state.selected)
        state.pick("new");state.scene("other-database",2,listOf("new"));assertNull(state.memory);assertNull(state.selected)
    }
}
