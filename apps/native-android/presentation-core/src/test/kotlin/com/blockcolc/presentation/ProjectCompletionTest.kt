package com.blockcolc.presentation

import com.blockcolc.domain.DomainEngine
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ProjectCompletionTest {
    @Test fun onlyTheFirstCommittedSealResolvesItsActualProjectAndTitle(){
        val state=DomainEngine.execute(DomainEngine.initial("UTC"),DomainEngine.command("CreateProject","projectId" to "p","title" to "My workshop","blueprintId" to "builtin-small-workshop",
            "subtasks" to JSONArray().put(JSONObject().put("id","t").put("title","Task"))),1792800000000).state
        fun event(type:String,id:String="p")=JSONObject().put("type",type).put("projectId",id).toString()
        val seal=event("ProjectSealedAsMonument")
        assertEquals(ProjectCompletion("p","My workshop"),ProjectCompletion.from(state,listOf(event("SubtaskProgressReported"),seal)))
        assertNull(ProjectCompletion.from(state,listOf(seal),true))
        assertNull(ProjectCompletion.from(state,listOf(event("ProjectCompleted"),event("HabitBuildingCompleted"))))
        assertNull(ProjectCompletion.from(state,listOf(event("ProjectSealedAsMonument","missing"),seal)))
        assertNull(ProjectCompletion.from(state,emptyList()))
    }
}
