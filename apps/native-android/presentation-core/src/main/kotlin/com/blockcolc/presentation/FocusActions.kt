package com.blockcolc.presentation

import com.blockcolc.focus.FocusCoordinator
import com.blockcolc.focus.FocusFailure
import com.blockcolc.focus.Operation

/** UI intent boundary shared by Android and host integration tests. The host
 * serializes calls on its IO actor; drafts do not own a second timer/state. */
class FocusActions(private val coordinator:FocusCoordinator,private val preferences:PreferencesController){
    fun confirm(requestId:String,planId:String,draft:FocusDraft,now:Long):Operation{
        val state=coordinator.load()
        return coordinator.confirm(requestId,draft.prepare(planId,state.domain,state.recovery,preferences.load().value,now),now)
    }
    fun start(requestId:String,now:Long)=coordinator.start(requestId,preferences.load().value.autoContinueFocus,now)
    fun begin(requestId:String,planId:String,draft:FocusDraft,now:Long):Operation{
        val state=coordinator.load();val pref=preferences.load().value
        return coordinator.begin(requestId,draft.prepare(planId,state.domain,state.recovery,pref,now),pref.autoContinueFocus,now)
    }
    fun amend(requestId:String,expectedPlanId:String,planId:String,draft:FocusDraft,now:Long):Operation{
        val state=coordinator.load();val old=state.recovery.plan?:throw FocusFailure("PLAN_NOT_FOUND")
        require(old.id==expectedPlanId&&old.phase==com.blockcolc.storage.PlanPhase.READY&&!old.hasStarted)
        val spec=draft.prepare(planId,state.domain,com.blockcolc.storage.RecoveryContext(),preferences.load().value,now)
        return coordinator.amend(requestId,expectedPlanId,spec,now)
    }
    fun report(requestId:String,draft:ReportDraft,now:Long,newId:()->String):Operation{
        val state=coordinator.load();val pool=ReportPool.from(state.domain,state.recovery)?:throw FocusFailure("PLAN_NOT_REPORTING")
        return coordinator.command(requestId,draft.command(pool,newId),now)
    }
}
