package com.blockcolc.presentation

import com.blockcolc.domain.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RoomPresentationTest {
    private fun all()=AchievementProjection.definitions.map{AchievementProgress(it,it.target,true,null)}
    @Test fun firstSavedFocusUnlocksABedAndRestoringFactsRestoresItWithoutAClaimCounter(){
        var state=DomainEngine.initial("UTC");val now=DomainTime.millis("2026-10-29T04:00:00.000Z")
        fun command(type:String,at:Long=now,vararg values:Pair<String,Any?>){val r=DomainEngine.execute(state,DomainEngine.command(type,*values),at);check(r.ok){r.error!!};state=r.state}
        assertTrue(RoomPresentationProjection.from(AchievementProjection.from(state.json())).owned.isEmpty())
        command("CreateProject",values=arrayOf("projectId" to "p","title" to "Room","blueprintId" to "builtin-small-workshop","subtasks" to JSONArray().put(JSONObject().put("id","t").put("title","Task"))))
        command("StartFocus",values=arrayOf("sessionId" to "s","projectId" to "p","subtaskId" to "t","plannedDurationMs" to 60000))
        assertTrue(RoomPresentationProjection.from(AchievementProjection.from(state.json())).owned.isEmpty())
        command("CompleteFocus",now+60000)
        val room=RoomPresentationProjection.from(AchievementProjection.from(state.json()))
        assertEquals(listOf("bed"),room.owned.map{it.item.id});assertEquals("bed",room.placed.single().slot.id)
        assertEquals("2026-10-29T04:01:00.000Z",room.owned.single().unlockedAt)
        assertEquals(room.placed,RoomPresentationProjection.from(AchievementProjection.from(DomainDocument.parse(state.canonical).json())).placed)
    }
    @Test fun everyCurrentAchievementHasOneRoomObjectAndUnknownHistoricalTimesStayUnknown(){
        val room=RoomPresentationProjection.from(all())
        assertEquals(20,room.owned.size);assertEquals(20,room.placed.size);assertTrue(room.unplaced.isEmpty())
        assertTrue(room.owned.all{it.unlockedAt==null});assertTrue(room.ignoredSlots.isEmpty())
    }
    @Test fun onlyEarnedItemsAppearOnceAndTheirSupportsAreRequired(){
        val onlyBed=all().map{it.copy(unlocked=it.definition.id=="focus-first")}
        assertEquals(listOf("bed"),RoomPresentationProjection.from(onlyBed).placed.map{it.owned.item.id})
        val withoutSupport=all().map{it.copy(unlocked=it.definition.id!="focus-ten")}
        val unsupported=RoomPresentationProjection.from(withoutSupport)
        assertTrue(unsupported.placed.none{it.slot.mount==RoomMount.SHELF})
        assertEquals(7,unsupported.unplaced.size)
    }
    @Test fun earningObjectsNeverMovesPreviousObjectsAndTheDeskCenterStaysClear(){
        val onlyBed=all().map{it.copy(unlocked=it.definition.id=="focus-first")}
        val before=RoomPresentationProjection.from(onlyBed).placed.single()
        val complete=RoomPresentationProjection.from(all())
        assertEquals(before,complete.placed.single{it.owned.item.id=="bed"})
        assertEquals(20,complete.placed.map{it.owned.item.id}.toSet().size)
        assertEquals(20,complete.placed.map{it.slot.id}.toSet().size)
        assertTrue(complete.placed.filter{it.slot.mount==RoomMount.DESK}.all{kotlin.math.abs(it.slot.x)>.85})
    }
    @Test fun automaticBedTouchesTwoWallsAndShelfRowsHaveSpaceForEveryEarnedObject(){
        val room=RoomPresentationProjection.from(all());val bed=room.placed.single{it.owned.item.id=="bed"}
        assertEquals(-4.0,bed.slot.x-bed.owned.item.size.width/2,0.0)
        assertEquals(4.0,bed.slot.z+bed.owned.item.size.depth/2,0.0)
        val shelves=room.placed.filter{it.slot.mount==RoomMount.SHELF}
        assertEquals(7,shelves.size)
        for((i,a)in shelves.withIndex())for(b in shelves.drop(i+1))assertTrue(kotlin.math.abs(a.slot.y-b.slot.y)>=1.0||kotlin.math.abs(a.slot.z-b.slot.z)>=.8)
        assertEquals(room.placed,RoomPresentationProjection.from(all()).placed)
    }
}
