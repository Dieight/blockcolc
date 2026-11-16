package com.blockcolc.preview

import com.blockcolc.presentation.*
import com.blockcolc.storage.BackupRoot
import com.blockcolc.preview.blueprints.NativeBlueprintLibrary

data class TaskRow(val id:String,val title:String,val progress:Int)
data class ProjectRow(val id:String,val title:String,val kind:String,val status:String,val tasks:List<TaskRow>,val progress:Int,val blueprint:String)
data class NoteRow(val id:String,val text:String,val completed:Boolean)
data class UiReceipt(val id:String,val saved:Boolean,val reason:String?=null)
enum class BackupOperation { EXPORT, READ_IMPORT, RESTORE_IMPORT }
enum class BackupImportIssue { INVALID, CHECKSUM, VERSION, READ, MEMORY, LIMIT, BUSY }

/** Read-only application projection. Diagnostic tickets, fixture progress and
 * scheduler internals cannot accidentally become a feature page's state. */
data class WorkspaceUiState(
    val ready:Boolean=false,val error:String?=null,val message:String?=null,
    val projects:List<ProjectRow> = emptyList(),val activeProject:String?=null,val notes:List<NoteRow> = emptyList(),
    val roots:List<BackupRoot> = emptyList(),val busy:Boolean=false,val importSummary:String?=null,val backupOperation:BackupOperation?=null,
    val preferences:ClientPreferences=ClientPreferences(),val preferencesReadFailed:Boolean=false,val preferencesSaving:Boolean=false,
    val choices:List<ProjectChoice> = emptyList(),val reportPool:ReportPool?=null,val planId:String?=null,
    val timer:TimerPresentation?=null,val uiResources:UiResources?=null,val workspace:WorkspaceProjection?=null,val blueprintNames:Map<String,String> = emptyMap(),
    val receipts:List<UiReceipt> = emptyList(),val setupRequired:Boolean=false,val tutorialPending:Boolean=false,val generation:Long=0,val refreshRequired:Boolean=false,val dailyBackupFailed:Boolean=false,
    val blueprints:NativeBlueprintLibrary=NativeBlueprintLibrary(),val achievementAttention:Set<String> = emptySet(),val achievementAttentionFailed:Boolean=false,val roomContext:String?=null,val backupListingReady:Boolean=false,val backupImportIssue:BackupImportIssue?=null
)

internal fun PreviewSnapshot.forWorkspace()=WorkspaceUiState(
    ready=ready,error=error,message=message,projects=projects,activeProject=activeProject,notes=notes,roots=roots,busy=busy,importSummary=importSummary,backupOperation=backupOperation,
    preferences=preferences,preferencesReadFailed=preferencesReadFailed,preferencesSaving=preferencesSaving,choices=choices,reportPool=reportPool,
    planId=planId,timer=timer,uiResources=uiResources,workspace=workspace,blueprintNames=blueprintNames,receipts=receipts,setupRequired=setupRequired,tutorialPending=tutorialPending,generation=generation,refreshRequired=refreshRequired,dailyBackupFailed=dailyBackupFailed,blueprints=blueprints,achievementAttention=achievementAttention,achievementAttentionFailed=achievementAttentionFailed,roomContext=roomContext,backupListingReady=backupListingReady,backupImportIssue=backupImportIssue
)
