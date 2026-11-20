package com.blockcolc.presentation

import com.blockcolc.domain.DomainEngine
import com.blockcolc.focus.FocusCoordinator
import org.json.JSONArray
import org.json.JSONObject

/** The only page-intent -> legacy domain wire mapping. JSON stays behind the
 * page port until the independently verified domain wire format is retired. */
object WorkspaceCommands {
    internal data class Encoded(val command:JSONObject,val expectedProject:String?=null)
    internal fun encode(value:WorkspaceMutation):Encoded {
        fun command(type:String,vararg fields:Pair<String,Any?>)=DomainEngine.command(type,*fields)
        return when(value){
            is WorkspaceMutation.CreateProject->Encoded(command("CreateProject","projectId" to value.id,"title" to value.title,"blueprintId" to value.blueprint,
                "subtasks" to JSONArray(value.subtasks.map{JSONObject().put("id",it.id).put("title",it.title)})))
            is WorkspaceMutation.CreateHabit->Encoded(command("CreateHabitProject","projectId" to value.id,"title" to value.title,"blueprintId" to value.blueprint,"targetRounds" to value.targetRounds))
            is WorkspaceMutation.NextHabitBuilding->Encoded(command("SelectNextHabitBuilding","blueprintId" to value.blueprint,"targetRounds" to value.targetRounds),value.projectId)
            is WorkspaceMutation.SwitchProject->Encoded(command("SwitchActiveProject","projectId" to value.projectId))
            is WorkspaceMutation.DeleteProject->Encoded(command("DeleteActiveProject","projectId" to value.projectId),value.projectId)
            is WorkspaceMutation.RenameProject->Encoded(command("RenameProject","title" to value.title),value.projectId)
            is WorkspaceMutation.AddSubtask->Encoded(command("AddSubtask","subtaskId" to value.id,"title" to value.title),value.projectId)
            is WorkspaceMutation.RenameSubtask->Encoded(command("RenameSubtask","subtaskId" to value.id,"title" to value.title),value.projectId)
            is WorkspaceMutation.RemoveSubtask->Encoded(command("RemoveSubtask","subtaskId" to value.id),value.projectId)
            is WorkspaceMutation.ReorderSubtasks->Encoded(command("ReorderSubtasks","orderedSubtaskIds" to JSONArray(value.ids)),value.projectId)
            is WorkspaceMutation.AddNote->Encoded(command("AddQuickNote","noteId" to value.id,"text" to value.text))
            is WorkspaceMutation.RenameNote->Encoded(command("RenameQuickNote","noteId" to value.id,"text" to value.text))
            is WorkspaceMutation.CompleteNote->Encoded(command("SetQuickNoteCompleted","noteId" to value.id,"completed" to value.completed))
            is WorkspaceMutation.DeleteNote->Encoded(command("DeleteQuickNote","noteId" to value.id))
            is WorkspaceMutation.DailyGoal->Encoded(if(value.rounds==0)command("DisableDailyGoal","date" to value.date)else command("SetDailyGoal","date" to value.date,"targetPomodoros" to value.rounds))
            is WorkspaceMutation.Integrity->Encoded(command("ConfigureFocusIntegrity","enabled" to value.enabled,"maxEffectiveExcursions" to value.excursions,"excursionThresholdSeconds" to value.thresholdSeconds))
            is WorkspaceMutation.Calendar->Encoded(command("ConfigureCalendar","timeZone" to value.timeZone,"restWeekdays" to JSONArray(value.restWeekdays)))
            is WorkspaceMutation.Birthday->Encoded(command("ConfigureBirthday","enabled" to value.enabled,"month" to value.month,"day" to value.day))
            WorkspaceMutation.ObserveBirthday->Encoded(command("ObserveBirthday"))
            is WorkspaceMutation.RegisterDailyReward->{
                val blueprint=JSONObject(value.blueprintCanonical);require(blueprint.getString("id")==value.id)
                Encoded(command("ImportDecorationBlueprint","blueprint" to blueprint))
            }
            is WorkspaceMutation.Environment->Encoded(command("ConfigureWorldEnvironment","environmentStyle" to value.id))
            is WorkspaceMutation.ImportBlueprint->Encoded(command(if(value.decoration)"ImportDecorationBlueprint" else "ImportBuildingBlueprint","blueprint" to JSONObject(value.canonical)))
            is WorkspaceMutation.RenameBlueprint->Encoded(command("RenameBuildingBlueprint","blueprintId" to value.id,"displayName" to value.displayName))
            is WorkspaceMutation.DeleteBlueprint->Encoded(command("DeleteBuildingBlueprint","blueprintId" to value.id))
        }
    }
    fun freeze(value:WorkspaceMutation):WorkspaceMutation=when(value){
        is WorkspaceMutation.CreateProject->value.copy(subtasks=value.subtasks.toList())
        is WorkspaceMutation.ReorderSubtasks->value.copy(ids=value.ids.toList())
        is WorkspaceMutation.Calendar->value.copy(restWeekdays=value.restWeekdays.toList())
        else->value
    }
    fun commit(coordinator:FocusCoordinator,requestId:String,value:WorkspaceMutation,now:Long,resolveBlueprint:((String)->JSONObject?)?=null)=encode(value).let{
        val blueprint=when(value){is WorkspaceMutation.CreateProject->value.blueprint;is WorkspaceMutation.CreateHabit->value.blueprint;is WorkspaceMutation.NextHabitBuilding->value.blueprint;else->null}
        val prepare:((com.blockcolc.domain.DomainDocument,JSONObject)->JSONObject)?=if(blueprint!=null&&resolveBlueprint!=null){_,wire->
            resolveBlueprint(blueprint)?.let{source->wire.put("importedBlueprint",source)};wire
        }else null
        coordinator.command(requestId,it.command,now,it.expectedProject,prepare)
    }
    fun decide(coordinator:FocusCoordinator,requestId:String,decision:FocusDecision,now:Long)=when(decision){
        FocusDecision.CompleteEarly->coordinator.manual(requestId,true,false,null,null,now)
        FocusDecision.EndRest->coordinator.manual(requestId,false,false,null,null,now)
        FocusDecision.FinishExtension->coordinator.finishExtension(requestId,now)
        is FocusDecision.Interrupt->coordinator.manual(requestId,false,false,decision.reason?.key,decision.note,now)
        is FocusDecision.Cancel->coordinator.manual(requestId,false,true,decision.reason?.key,decision.note,now)
    }
}
