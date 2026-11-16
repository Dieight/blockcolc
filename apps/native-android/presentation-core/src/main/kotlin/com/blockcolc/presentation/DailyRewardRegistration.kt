package com.blockcolc.presentation

import com.blockcolc.focus.FocusCoordinator
import com.blockcolc.focus.Operation
import com.blockcolc.domain.StrictJson
import org.json.JSONObject

/** The actor calls this before a workspace with focus facts can reconcile.
 * Saved resources own their IDs, even when their content differs from the
 * current package. Missing assets use the normal validated command and SQL
 * transaction. All missing assets commit together, without advancing an
 * overdue focus halfway through the pool. */
object DailyRewardRegistration {
    fun prepare(coordinator:FocusCoordinator,ids:List<String>,blueprint:(String)->JSONObject,
        requestId:(String)->String,now:Long,onCommitted:(Operation)->Unit={}):Int {
        require(ids.size==ids.distinct().size)
        val known=coordinator.load().domain.registeredDailyRewardIds()
        val missing=ids.filter{it !in known}
        if(missing.isEmpty())return 0
        val values=missing.map{imported(it,blueprint(it))}
        onCommitted(coordinator.registerDailyRewardBlueprints(requestId("packaged-pool"),values,now))
        return missing.size
    }
    /** Same build-order adapter as the formal toImportedBlueprint. The
     * packaged voxel stage is a renderer hint, not a domain stage authority. */
    private fun imported(id:String,raw:JSONObject):JSONObject {
        require(raw.getString("id")==id)
        val source=StrictJson.copy(raw) as JSONObject
        val voxels=source.getJSONArray("voxels")
        repeat(voxels.length()){i->val voxel=voxels.getJSONObject(i);val order=voxel.getLong("buildOrder")
            voxel.put("stage",when{order<1800->"foundation";order<3800->"frame";order<6500->"walls";order<8800->"roof";else->"details"})
        }
        return source
    }
}
