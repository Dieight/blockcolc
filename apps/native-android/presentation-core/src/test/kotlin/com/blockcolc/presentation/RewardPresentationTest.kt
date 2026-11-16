package com.blockcolc.presentation

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class RewardPresentationTest {
    private fun event(type:String,vararg values:Pair<String,Any>)=JSONObject().put("type",type).apply{values.forEach{put(it.first,it.second)}}.toString()

    @Test fun committedEventsKeepBuildingAndGoalInOrderAndNeverReplaySnapshotsOrReceipts(){
        val queue=CelebrationQueue()
        val both=listOf(event("HabitBuildingCompleted"),event("DailyGoalReached","date" to "2026-12-25"))
        queue.accept(both,true);assertNull(queue.peek())
        queue.accept(listOf(event("StateRestored"),event("HolidayRewardGranted")));assertNull(queue.peek())
        queue.accept(both);val building=queue.take()!!;val goal=queue.take()!!
        assertEquals(CelebrationKind.BUILDING,building.kind);assertEquals(CelebrationKind.GOAL,goal.kind)
        assertTrue(building.serial<goal.serial)
        queue.accept(listOf(event("DailyGoalReached","date" to "2026-12-25")));assertNull(queue.take())
        queue.accept(listOf(event("BirthdayRewardGranted"),event("ProjectSealedAsMonument"),event("DailyGoalReached","date" to "2026-12-26")))
        assertEquals(listOf(CelebrationKind.BIRTHDAY,CelebrationKind.BUILDING,CelebrationKind.GOAL),List(3){queue.take()!!.kind})
        assertNull(queue.take())
    }

    @Test fun consecutiveIdenticalBurstsHaveSeparateClocksAndBackgroundTimeIsNotConsumed(){
        val queue=CelebrationQueue();repeat(2){queue.accept(listOf(event("ProjectSealedAsMonument")))}
        val first=queue.take()!!;val second=queue.take()!!
        assertEquals(first.kind,second.kind);assertNotEquals(first.serial,second.serial)
        val clock=CelebrationTimeline()
        assertEquals(0L,clock.frame(1_000_000_000L));assertEquals(900L,clock.frame(1_900_000_000L))
        clock.pause();assertEquals(900L,clock.frame(80_000_000_000L));assertEquals(1200L,clock.frame(80_300_000_000L))
        clock.pause();assertEquals(1200L,clock.frame(90_000_000_000L));assertEquals(3400L,clock.frame(92_200_000_000L))
        assertEquals(0L,CelebrationTimeline().frame(92_200_000_000L))
        repeat(200){queue.preview(false)};assertTrue(queue.take()!!.preview);assertNull(queue.take())
        queue.accept(listOf(event("BirthdayRewardGranted")));assertNull(queue.take(false))
        queue.preview(true);assertEquals(CelebrationKind.GOAL_PREVIEW,queue.take(false)!!.kind)
        assertEquals(CelebrationKind.BIRTHDAY,queue.take()!!.kind)
    }

    @Test fun holidaySlotsWindowsBirthdayOverlapAndConfettiMatchTheFormalProductionSources(){
        val oracle=JSONObject(javaClass.getResource("/reward-presentation-oracle.json")!!.readText())
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/domain/src/index.ts").isFile}
        val hashes=oracle.getJSONObject("sourceHashes")
        hashes.keys().forEach{file->assertEquals("Stale reward source $file",hashes.getString(file),MessageDigest.getInstance("SHA-256").digest(File(root,file).readBytes()).joinToString(""){"%02x".format(it.toInt() and 255)})}
        val cases=oracle.getJSONArray("holidays");assertTrue(cases.length()>3000)
        val found=hashSetOf<String>();val resources=UiResources.load()
        repeat(cases.length()){i->
            val row=cases.getJSONObject(i);val b=row.optJSONObject("birthday")?.let{BirthdaySettings(it.getBoolean("enabled"),it.getInt("month"),it.getInt("day"))}
            val actual=HolidayEmblems.at(row.getString("date"),row.getInt("slot"),b);val expected=row.getJSONArray("entries")
            assertEquals("$i ${row.getString("date")}",expected.length(),actual.size)
            actual.forEachIndexed{k,entry->
                val e=expected.getJSONObject(k);assertEquals(e.getString("id"),entry.id);assertEquals(e.getString("name"),entry.name)
                assertEquals(e.getString("description"),entry.description);assertEquals(e.getString("emblem"),entry.emblem);found.add(entry.id)
                for(text in listOf(entry.name,entry.description,entry.emblem))assertNotEquals("Untranslated holiday: $text",text,resources.text("en",text))
            }
        }
        assertEquals(21,found.size)
        val frames=oracle.getJSONArray("frames");assertEquals(60,frames.length())
        repeat(frames.length()){i->val f=frames.getJSONObject(i)
            val actual=CelebrationFrames.frame(if(f.getBoolean("goal"))CelebrationKind.GOAL else CelebrationKind.BUILDING,f.getLong("elapsed"),f.getDouble("width").toFloat(),f.getDouble("height").toFloat())
            val pixels=f.getJSONArray("pixels");assertEquals("frame $i",pixels.length(),actual.size)
            actual.forEachIndexed{k,p->val e=pixels.getJSONObject(k)
                assertEquals("frame $i pixel $k",listOf(e.getInt("x"),e.getInt("y"),e.getInt("width"),e.getInt("height"),e.getInt("turn"),e.getInt("color")),listOf(p.x,p.y,p.width,p.height,p.turn,p.color))
            }
        }
    }

    private class Storage(var raw:String?=null):AchievementReceiptStorage {
        var failRead=false;var failWrite=false;var discardWrite=false;var writes=0
        override fun read():String?{check(!failRead);return raw}
        override fun write(value:String){writes++;check(!failWrite);if(!discardWrite)raw=value}
    }
    private fun entries(excluded:String?=null)=AchievementProjection.definitions.map{AchievementProgress(it,if(it.id==excluded)0 else it.target,it.id!=excluded,null)}

    @Test fun historicalBatchIsAcknowledgedOnceThenOnlyNewUnlocksRemainAcrossRestart(){
        val storage=Storage();val receipts=AchievementReceipts(storage);val historical=entries("goals-seven")
        val batch=receipts.pending(historical,receipts.read());assertEquals(19,batch.size);assertTrue(batch.all{it.unlockedAt==null})
        val seen=receipts.acknowledge(batch.map{it.definition.id});assertEquals(1,storage.writes)
        assertTrue(receipts.pending(historical,seen).isEmpty())
        val reopened=AchievementReceipts(storage);assertEquals(seen,reopened.read())
        val fresh=reopened.pending(entries(),reopened.read());assertEquals(listOf("goals-seven"),fresh.map{it.definition.id})
        reopened.acknowledge(fresh.map{it.definition.id});assertTrue(reopened.pending(entries(),reopened.read()).isEmpty())
    }

    @Test fun receiptFailuresRemainRetryableAndInvalidStorageIsNeverOverwrittenAsAnEmptySet(){
        val storage=Storage("[\"future-receipt\"]");val receipts=AchievementReceipts(storage)
        storage.failWrite=true;assertTrue(runCatching{receipts.acknowledge(listOf("focus-first"))}.isFailure)
        assertEquals(setOf("future-receipt"),receipts.read())
        storage.failWrite=false;storage.discardWrite=true
        assertTrue(runCatching{receipts.acknowledge(listOf("focus-first"))}.isFailure)
        storage.discardWrite=false;assertEquals(setOf("future-receipt","focus-first"),receipts.acknowledge(listOf("focus-first")))
        for(raw in listOf("{}","[1]","[\"\"]","[\"a\"] trailing","[null]")){
            storage.raw=raw;val writes=storage.writes
            assertTrue("invalid $raw",runCatching{receipts.acknowledge(listOf("focus-first"))}.isFailure)
            assertEquals(raw,storage.raw);assertEquals(writes,storage.writes)
        }
        storage.failRead=true;assertTrue(runCatching{receipts.read()}.isFailure)
    }
}
