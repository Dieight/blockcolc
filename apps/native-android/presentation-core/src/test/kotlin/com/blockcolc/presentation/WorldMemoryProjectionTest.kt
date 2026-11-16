package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class WorldMemoryProjectionTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/building-memory-oracle.json")!!.readText())}
    private fun minutes(value:Long)=(value+30000)/60000
    @Test fun referenceIsTheActualFormalMemoryAndAttributionSource(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/application/src/focus-attribution.ts").exists()}
        val hashes=oracle.getJSONObject("sourceHashes");hashes.keys().forEach{file->assertEquals(file,hashes.getString(file),MessageDigest.getInstance("SHA-256").digest(File(root,file).readBytes()).joinToString(""){"%02x".format(it.toInt()and 255)})}
    }
    @Test fun currentAndMonumentMemoriesIncludeActualTimeUnknownGapsHabitCyclesAndRewards(){
        val cases=oracle.getJSONArray("cases");assertTrue(cases.length()>400);var checked=0;var archives=0;var rewards=0
        repeat(cases.length()){index->val case=cases.getJSONObject(index);val document=DomainDocument.parse(case.getString("canonical"));val before=document.canonical;val actual=WorldMemoryProjection.from(document)
            assertEquals(before,document.canonical)
            val memories=case.getJSONArray("memories");assertEquals(case.getString("name"),memories.length(),actual.buildings.size)
            repeat(memories.length()){i->val e=memories.getJSONObject(i);val a=actual.buildings.first{it.id==e.getString("projectId")};checked++
                val title=if(a.cycleNumber==null)a.title else "${a.title} · 第 ${a.cycleNumber} 座";assertEquals(e.getString("title"),title)
                assertEquals(e.getBoolean("isActive"),a.active);assertEquals(e.getBoolean("isMonument"),a.status=="monument")
                assertEquals(e.getLong("completionPercent"),(a.progress+50L)/100)
                assertEquals(e.getLong("focusMinutes"),minutes(a.durationMs));assertEquals(e.getInt("completedRounds"),a.completed);assertEquals(e.getInt("interruptedRounds"),a.interrupted)
                assertEquals(e.getLong("interruptedMinutes"),minutes(a.interruptedMs));assertEquals(e.getInt("unknownRounds"),a.unknownRounds);assertEquals(e.getLong("unknownMinutes"),minutes(a.unknownMs))
                assertEquals(if(e.isNull("lastFocusDate"))null else e.getString("lastFocusDate"),a.lastFocusDate)
                val next=a.nextTask?:if(a.awaitingBuilding)"选择下一座习惯建筑"else if(a.nextHabitRound!=null)"完成本周期第 ${a.nextHabitRound} / ${a.habitTarget} 轮" else null
                assertEquals(e.opt("nextStep").takeUnless{it==JSONObject.NULL},next)
            }
            val expectedArchives=case.getJSONArray("archives");assertEquals(expectedArchives.length(),actual.archives.size)
            repeat(expectedArchives.length()){i->val e=expectedArchives.getJSONObject(i);val a=actual.archives.first{it.id==e.getString("id")};archives++
                assertEquals(e.getString("projectId"),a.projectId);assertEquals(if(e.isNull("completedAt"))null else e.getString("completedAt"),a.completedAt)
                assertEquals(e.getInt("rounds"),a.rounds);assertEquals(e.getInt("interruptedRounds"),a.interrupted);assertEquals(e.getInt("unknownRounds"),a.unknownRounds)
                assertEquals(e.getLong("minutes"),minutes(a.durationMs));assertEquals(e.getLong("interruptedMinutes"),minutes(a.interruptedMs));assertEquals(e.getLong("unknownMinutes"),minutes(a.unknownMs))
                assertEquals(if(e.isNull("expectedRounds"))null else e.getInt("expectedRounds"),a.expectedRounds)
                val tasks=e.getJSONArray("subtasks");assertEquals(tasks.length(),a.tasks.size)
                repeat(tasks.length()){j->val t=tasks.getJSONObject(j);val b=a.tasks[j];assertEquals(t.getString("subtaskId"),b.id);assertEquals(t.getString("title"),b.title);assertEquals(t.getLong("minutes"),minutes(b.durationMs));assertEquals(t.getInt("rounds"),b.rounds)
                    assertEquals(t.getInt("interruptedRounds"),b.interrupted);assertEquals(t.getLong("interruptedMinutes"),minutes(b.interruptedMs));assertEquals(if(t.isNull("share"))null else t.getInt("share"),b.share)}
            }
            val expectedRewards=case.getJSONArray("rewards");assertEquals(expectedRewards.length(),actual.rewards.size)
            repeat(expectedRewards.length()){i->val e=expectedRewards.getJSONObject(i);val a=actual.rewards.first{it.id==e.getString("id")};assertEquals(e.getString("resource"),a.resource);assertEquals(e.getString("date"),a.date);rewards++}
        }
        assertTrue(checked>1000);assertTrue(archives>0);assertTrue(rewards>300)
    }
}
