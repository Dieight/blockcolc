package com.blockcolc.presentation

import org.junit.Assert.*
import org.junit.Test

class PreferencesControllerTest {
    private class Memory(var text:String?=null):PreferencesStorage {
        var writes=0;var fail=false
        override fun read()=text
        override fun write(canonical:String){if(fail)error("Storage unavailable");text=canonical;writes++}
    }
    @Test fun allThreeFontChoicesSurviveReloadAndFailedChangesRetainTheSavedMode(){
        val storage=Memory();val controller=PreferencesController(storage)
        for(mode in listOf("pixel","system","mixed")){
            controller.update{it.copy(fontStyle=mode)}
            assertEquals(mode,PreferencesController(storage).load().value.fontStyle)
        }
        storage.fail=true
        assertTrue(runCatching{controller.update{it.copy(fontStyle="system")}}.isFailure)
        assertEquals("mixed",controller.load().value.fontStyle)
        assertEquals("mixed",PreferencesController(storage).load().value.fontStyle)
    }
    @Test fun everyLightingChoiceIncludingPixelSurvivesReload(){
        val storage=Memory();val controller=PreferencesController(storage)
        for(tier in listOf("auto","paper","pixel","performance","balanced","cinematic")){
            controller.update{it.copy(lightingQuality=tier)}
            assertEquals(tier,PreferencesController(storage).load().value.lightingQuality)
        }
        // An unknown style from a newer client falls back to the default tier.
        val future=org.json.JSONObject(ClientPreferences().canonical()).put("lightingQuality","hologram")
        assertEquals("cinematic",ClientPreferences.parse(future).lightingQuality)
    }
    @Test fun retiredCustomRoomChoicesDoNotResetPreferencesOrSurviveNewSaves(){
        val desired=ClientPreferences(focusMinutes=30,language="en",fontStyle="mixed")
        val old=org.json.JSONObject(desired.canonical()).put("roomLayout",org.json.JSONObject().put("desk-center","bed").put("obsolete-slot","plant"))
        val storage=Memory(old.toString());val controller=PreferencesController(storage)
        assertEquals(desired,controller.load().value)
        controller.update{it.copy(focusMinutes=35)}
        assertFalse(org.json.JSONObject(storage.text!!).has("roomLayout"))
        assertEquals("en",PreferencesController(storage).load().value.language)
    }
    @Test fun adoptsOnlyAfterSuccessfulSaveAndDoesNotRewriteUnchangedValues(){
        val memory=Memory();val controller=PreferencesController(memory);assertEquals(ClientPreferences(),controller.load().value)
        controller.update{it};assertEquals(0,memory.writes)
        val saved=controller.update{it.copy(focusMinutes=30,language="en")};assertEquals(30,saved.value.focusMinutes)
        memory.fail=true;assertTrue(runCatching{controller.update{it.copy(focusMinutes=60)}}.isFailure)
        assertEquals(saved,controller.load());assertEquals(saved,PreferencesController(memory).load());assertEquals(1,memory.writes)
    }
    @Test fun malformedPreferencesDoNotBecomeBrokenDomainDataOrDisappearOnFailedRepair(){
        val memory=Memory("{bad");val controller=PreferencesController(memory);assertTrue(controller.load().readFailed)
        memory.fail=true;assertTrue(runCatching{controller.update{it.copy(themeMode="dark")}}.isFailure);assertEquals("{bad",memory.text);assertTrue(controller.load().readFailed)
        memory.fail=false;assertFalse(controller.update{it.copy(themeMode="dark")}.readFailed)
    }
    @Test fun partialChangesComposeOnTheLastAdoptedValueAndInvalidCandidatesNeverWrite(){
        val memory=Memory();val controller=PreferencesController(memory)
        controller.update{it.copy(focusMinutes=30)};controller.update{it.copy(ambience=it.ambience.copy(rainEnabled=true))}
        assertEquals(30,controller.load().value.focusMinutes);assertTrue(controller.load().value.ambience.rainEnabled)
        assertTrue(runCatching{controller.update{it.copy(focusMinutes=0)}}.isFailure);assertEquals(2,memory.writes)
    }
}
