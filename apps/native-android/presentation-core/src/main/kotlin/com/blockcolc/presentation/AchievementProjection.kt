package com.blockcolc.presentation

import com.blockcolc.domain.countsAsFocusRound

import org.json.JSONObject

data class AchievementDefinition(val id:String,val title:String,val description:String,val metric:String,val target:Int,val unit:String)
data class AchievementProgress(val definition:AchievementDefinition,val progress:Int,val unlocked:Boolean,val unlockedAt:String?)

/** Derived only from retained facts. Dates are the frozen completion dates;
 * no new product counters, clock-dependent awards or inferred timestamps. */
object AchievementProjection {
    val definitions=listOf(
        AchievementDefinition("focus-first","第一块基石","完成第一轮专注","completed-rounds",1,"轮"),
        AchievementDefinition("focus-ten","渐入佳境","累计完成 10 轮专注","completed-rounds",10,"轮"),
        AchievementDefinition("focus-fifty","日积月累","累计完成 50 轮专注","completed-rounds",50,"轮"),
        AchievementDefinition("focus-hundred","百轮成形","累计完成 100 轮专注","completed-rounds",100,"轮"),
        AchievementDefinition("time-hour","投入一小时","累计记录 60 分钟实际专注","focus-minutes",60,"分钟"),
        AchievementDefinition("time-ten-hours","十小时的形状","累计记录 600 分钟实际专注","focus-minutes",600,"分钟"),
        AchievementDefinition("time-twenty-five-hours","长路有光","累计记录 1500 分钟实际专注","focus-minutes",1500,"分钟"),
        AchievementDefinition("building-first","初见落成","完成第一栋普通或习惯建筑","buildings",1,"栋"),
        AchievementDefinition("building-five","聚落初成","累计完成 5 栋普通或习惯建筑","buildings",5,"栋"),
        AchievementDefinition("building-ten","十景相连","累计完成 10 栋普通或习惯建筑","buildings",10,"栋"),
        AchievementDefinition("days-seven","七日足迹","在 7 个不同日期完成专注，无需连续","focus-days",7,"天"),
        AchievementDefinition("days-thirty","三十日留痕","在 30 个不同日期完成专注，无需连续","focus-days",30,"天"),
        AchievementDefinition("focus-two-fifty","聚沙成塔","累计完成 250 轮专注","completed-rounds",250,"轮"),
        AchievementDefinition("focus-five-hundred","五百次出发","累计完成 500 轮专注","completed-rounds",500,"轮"),
        AchievementDefinition("time-fifty-hours","五十小时的积累","累计记录 3000 分钟实际专注","focus-minutes",3000,"分钟"),
        AchievementDefinition("time-hundred-hours","百小时工坊","累计记录 6000 分钟实际专注","focus-minutes",6000,"分钟"),
        AchievementDefinition("building-twenty-five","小镇落成","累计完成 25 栋普通或习惯建筑","buildings",25,"栋"),
        AchievementDefinition("days-hundred","百日足迹","在 100 个不同日期完成专注，无需连续","focus-days",100,"天"),
        AchievementDefinition("habit-buildings-three","习惯成景","累计完成 3 栋习惯建筑","habit-buildings",3,"栋"),
        AchievementDefinition("goals-seven","七次如约","在 7 个不同日期达成已开启的每日目标，无需连续","goal-days",7,"天"),
    )
    private data class Point(val at:String?,val amount:Long)
    fun from(s:JSONObject):List<AchievementProgress>{
        fun rows(key:String)=s.getJSONArray(key).let{a->List(a.length()){a.getJSONObject(it)}}
        val milestones=definitions.map{it.metric}.distinct().associateWith{arrayListOf<Point>()}
        val dates=hashSetOf<String>()
        val sessions=rows("focusHistory").sortedWith(compareBy<JSONObject>{it.getString(if(it.getString("status")=="interrupted")"interruptedAt" else "completedAt")}.thenBy{it.getString("id")})
        for(session in sessions){
            val interrupted=session.getString("status")=="interrupted";val at=session.getString(if(interrupted)"interruptedAt" else "completedAt")
            milestones.getValue("focus-minutes").add(Point(at,session.getLong("actualDurationMs")))
            if(countsAsFocusRound(session)){milestones.getValue("completed-rounds").add(Point(at,1));if(dates.add(session.getString("completedLocalDate")))milestones.getValue("focus-days").add(Point(at,1))}
        }
        val finalReports=rows("progressReports").filter{it.getInt("progressBasisPoints")==10000}.groupBy{it.getString("projectId")}.mapValues{(_,items)->items.maxOf{it.getString("reportedAt")}}
        for(project in rows("projects")){
            val tasks=project.getJSONArray("subtasks")
            if(project.getString("kind")=="finite"&&tasks.length()>0&&(0 until tasks.length()).all{tasks.getJSONObject(it).getInt("progressBasisPoints")==10000})
                milestones.getValue("buildings").add(Point(finalReports[project.getString("id")],1))
        }
        for(building in rows("habitBuildings")){val point=Point(building.getString("completedAt"),1);milestones.getValue("buildings").add(point);milestones.getValue("habit-buildings").add(point)}
        val reached=hashSetOf<String>()
        for(goal in rows("dailyGoals").filter{it.getBoolean("enabled")&&it.getLong("targetPomodoros")>0&&!it.isNull("reachedAt")}.sortedBy{it.getString("reachedAt")}){
            if(reached.add(goal.getString("date")))milestones.getValue("goal-days").add(Point(goal.getString("reachedAt"),1))
        }
        for(metric in listOf("buildings","habit-buildings"))milestones.getValue(metric).sortWith(compareBy<Point>{it.at==null}.thenBy{it.at})
        return definitions.map{definition->
            val scale=if(definition.metric=="focus-minutes")60000L else 1L;val threshold=definition.target*scale
            var total=0L;var unlockedAt:String?=null
            for(point in milestones.getValue(definition.metric)){val previous=total;total+=point.amount;if(previous<threshold&&total>=threshold)unlockedAt=point.at}
            if(definition.metric=="buildings"&&milestones.getValue("buildings").any{it.at==null})unlockedAt=null
            AchievementProgress(definition,minOf(definition.target.toLong(),total/scale).toInt(),total>=threshold,unlockedAt)
        }
    }
}
