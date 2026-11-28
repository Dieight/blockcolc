package com.blockcolc.presentation

import org.junit.Assert.*
import org.junit.Test

class SettingsCatalogTest {
    @Test fun bothLanguagesSearchTheSameControls(){
        assertEquals(listOf("字体"),SettingsCatalog.search("mixed").map{it.id})
        assertEquals(listOf("同步现实天气"),SettingsCatalog.search("天文").map{it.id})
        assertTrue(SettingsCatalog.search("导入").any{it.id=="蓝图库"})
        assertTrue(SettingsCatalog.search("  BACKUP  ").any{it.id=="本地备份"})
        assertTrue(SettingsCatalog.search("not-an-existing-option").isEmpty())
        for(query in listOf("好友","云备份","披露","cloud sync","friends","takeover"))
            assertEquals(query,"账户与云同步",SettingsCatalog.search(query).first().id)
        assertEquals(listOf("世界叙事模式","单体画面背景"),SettingsCatalog.search("single building").map{it.id})
        assertEquals(listOf("单体画面背景"),SettingsCatalog.search("maquette").map{it.id})
        assertEquals(listOf("单体画面背景"),SettingsCatalog.search("天光").map{it.id})
    }
    @Test fun treeHasNoDuplicateDestinationsAndNestedBackupsKeepTheirParent(){
        val ids=SettingsCatalog.groups.flatMap{group->SettingsCatalog.entries.filter{it.group==group.id}.map{it.id}}
        assertEquals(SettingsCatalog.entries.map{it.id},ids)
        assertEquals(listOf("本地备份"),SettingsCatalog.entries.single{it.id=="每日合并备份"}.parents)
        assertEquals("world",SettingsCatalog.entries.single{it.id=="蓝图库"}.group)
        assertEquals("world",SettingsCatalog.entries.single{it.id=="世界叙事模式"}.group)
    }
    @Test fun clockSelectionRemainingGoalDetentMatchesRemainingRounds(){
        assertEquals(3,ClockSelection.remainingGoalRounds(true,8,5))
        assertNull(ClockSelection.remainingGoalRounds(true,8,8))
        assertNull(ClockSelection.remainingGoalRounds(true,8,10))
        assertNull(ClockSelection.remainingGoalRounds(false,8,2))
        assertTrue(ClockSelection.crossesGoalRound(2,3,3))
        assertTrue(ClockSelection.crossesGoalRound(4,3,3))
        assertFalse(ClockSelection.crossesGoalRound(3,4,3))
        assertFalse(ClockSelection.crossesGoalRound(1,2,3))
    }
}
