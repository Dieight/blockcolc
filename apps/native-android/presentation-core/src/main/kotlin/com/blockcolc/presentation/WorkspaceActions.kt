package com.blockcolc.presentation

/** Page intentions contain values, never storage rows, JSON or platform handles.
 * The application writer resolves context and validates them at commit time. */
sealed interface WorkspaceMutation {
    data class NewSubtask(val id:String,val title:String)
    data class CreateProject(val id:String,val title:String,val blueprint:String,val subtasks:List<NewSubtask>):WorkspaceMutation
    data class CreateHabit(val id:String,val title:String,val blueprint:String,val targetRounds:Int):WorkspaceMutation
    data class NextHabitBuilding(val projectId:String,val blueprint:String,val targetRounds:Int):WorkspaceMutation
    data class SwitchProject(val projectId:String):WorkspaceMutation
    data class DeleteProject(val projectId:String):WorkspaceMutation
    data class RenameProject(val projectId:String,val title:String):WorkspaceMutation
    data class AddSubtask(val projectId:String,val id:String,val title:String):WorkspaceMutation
    data class RenameSubtask(val projectId:String,val id:String,val title:String):WorkspaceMutation
    data class RemoveSubtask(val projectId:String,val id:String):WorkspaceMutation
    data class ReorderSubtasks(val projectId:String,val ids:List<String>):WorkspaceMutation
    sealed interface Note:WorkspaceMutation
    data class AddNote(val id:String,val text:String):Note
    data class RenameNote(val id:String,val text:String):Note
    data class CompleteNote(val id:String,val completed:Boolean):Note
    /** The undo window may outlive the visible workspace. */
    data class DeleteNote(val id:String,val expectedWorkspace:String):Note
    data class DailyGoal(val date:String,val rounds:Int):WorkspaceMutation
    data class Integrity(val enabled:Boolean,val excursions:Int,val thresholdSeconds:Int):WorkspaceMutation
    data class Calendar(val timeZone:String,val restWeekdays:List<Int>):WorkspaceMutation
    data class Birthday(val enabled:Boolean,val month:Int,val day:Int):WorkspaceMutation
    data object ObserveBirthday:WorkspaceMutation
    /** Opaque, immutable packaged asset; only startup supplies this intent. */
    data class RegisterDailyReward(val id:String,val blueprintCanonical:String):WorkspaceMutation
    data class Environment(val id:String):WorkspaceMutation
    data class ImportBlueprint(val canonical:String,val decoration:Boolean):WorkspaceMutation
    data class RenameBlueprint(val id:String,val displayName:String):WorkspaceMutation
    data class DeleteBlueprint(val id:String):WorkspaceMutation
}

enum class FocusEndReason(val key:String) {
    EXTERNAL("external-interruption"),BLOCKED("task-blocked"),FATIGUE("fatigue"),
    PRIORITY("priority-changed"),DEVICE("device-or-app"),OTHER("other")
}
sealed interface FocusDecision {
    data object CompleteEarly:FocusDecision
    data object EndRest:FocusDecision
    data object FinishExtension:FocusDecision
    data class Interrupt(val reason:FocusEndReason?=null,val note:String?=null):FocusDecision
    data class Cancel(val reason:FocusEndReason?=null,val note:String?=null):FocusDecision
}

/** Feature pages depend on this port, not the Android runtime or its diagnostics.
 * IDs identify actual saved receipts; callbacks must not optimistically publish
 * facts. Every implementation still uses the same serialized business writer. */
interface WorkspaceActions {
    fun dispatch(mutation:WorkspaceMutation,uiRequest:String)
    fun updatePreferences(change:(ClientPreferences)->ClientPreferences)
    fun confirmPlan(draft:FocusDraft,uiRequest:String?=null)
    fun startPlan(uiRequest:String?=null)
    fun beginFocus(draft:FocusDraft,uiRequest:String)
    fun amendPlan(planId:String,draft:FocusDraft,uiRequest:String)
    fun decideFocus(decision:FocusDecision,uiRequest:String)
    fun submitReport(draft:ReportDraft,uiRequest:String?=null)
    fun restore(root:String,uiRequest:String?=null)
    fun refreshBackups(uiRequest:String)
    fun refreshWorkspace(uiRequest:String)
    fun finishTutorial()
}

/** Local presentation receipts do not become business or backup facts. */
interface AchievementReceiptActions {
    fun readAchievementReceipts(done:(Set<String>?,Boolean)->Unit)
    fun acknowledgeAchievements(ids:List<String>,done:(Set<String>?,Boolean)->Unit)
}

