package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainTime
import com.blockcolc.domain.StrictJson
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/** Read-only preflight for the actor. The actual award still belongs to the
 * domain command and is checked again inside its transaction. */
object BirthdayObservation {
    fun due(document:DomainDocument,now:Long):Boolean {
        val s=document.birthdayObservationJson();val birthday=s.getJSONObject("birthday")
        if(!birthday.getBoolean("enabled"))return false
        val day=LocalDate.parse(DomainTime.localDate(DomainTime.format(now),s.getJSONObject("calendar").getString("timeZone")))
        if(day.monthValue!=birthday.getInt("month")||day.dayOfMonth!=minOf(birthday.getInt("day"),day.lengthOfMonth()))return false
        val rewards=s.getJSONArray("birthdayRewards")
        return (0 until rewards.length()).none{rewards.getJSONObject(it).getInt("year")==day.year}
    }
}

enum class CelebrationKind { BIRTHDAY, BUILDING, GOAL, ACHIEVEMENT, BUILDING_PREVIEW, GOAL_PREVIEW }
data class CelebrationBurst(val serial:Long,val kind:CelebrationKind) {
    val preview:Boolean get()=kind==CelebrationKind.BUILDING_PREVIEW||kind==CelebrationKind.GOAL_PREVIEW
}

/** Events enter only after COMMIT. Replays and restored snapshots never enter
 * this queue. One operation may enqueue both a building and a goal. */
class CelebrationQueue {
    private val pending=java.util.ArrayDeque<CelebrationBurst>()
    private val goals=hashSetOf<String>()
    private var serial=0L
    private fun add(kind:CelebrationKind){pending.add(CelebrationBurst(++serial,kind))}
    fun accept(events:List<String>,replayed:Boolean=false) {
        if(replayed)return
        val parsed=events.map{JSONObject(it)}
        if(parsed.any{it.optString("type")=="BirthdayRewardGranted"})add(CelebrationKind.BIRTHDAY)
        if(parsed.any{it.optString("type") in setOf("ProjectSealedAsMonument","HabitBuildingCompleted")})add(CelebrationKind.BUILDING)
        for(event in parsed)if(event.optString("type")=="DailyGoalReached"&&goals.add(event.getString("date")))add(CelebrationKind.GOAL)
    }
    fun preview(goal:Boolean){if(pending.none{it.preview})add(if(goal)CelebrationKind.GOAL_PREVIEW else CelebrationKind.BUILDING_PREVIEW)}
    fun peek(worldReady:Boolean=true):CelebrationBurst?=if(worldReady)pending.peek()else pending.firstOrNull{it.preview}
    fun take(worldReady:Boolean=true):CelebrationBurst?=peek(worldReady)?.also{pending.remove(it)}
}

/** Accumulates only visible frame time. Starting a new burst gets a new clock,
 * even for two consecutive buildings. A background gap never consumes it. */
class CelebrationTimeline {
    private var previous:Long?=null
    private var elapsedNanos=0L
    val elapsedMs:Long get()=elapsedNanos/1_000_000
    fun frame(nowNanos:Long):Long {
        previous?.let{elapsedNanos+=(nowNanos-it).coerceAtLeast(0)}
        previous=nowNanos
        return elapsedMs
    }
    fun pause(){previous=null}
}

data class ConfettiPixel(val x:Int,val y:Int,val width:Int,val height:Int,val turn:Int,val color:Int)
object CelebrationFrames {
    const val DURATION_MS=3400
    fun frame(kind:CelebrationKind,elapsedMs:Long,width:Float,height:Float):List<ConfettiPixel>{
        if(elapsedMs<0||elapsedMs>DURATION_MS||width<=0||height<=0)return emptyList()
        val goal=kind==CelebrationKind.GOAL||kind==CelebrationKind.GOAL_PREVIEW
        return (0 until if(goal)84 else 112).mapNotNull{i->
            val t=elapsedMs/1000.0-if(goal)(i/28)*.28 else (i%7)*.027
            if(t<0)return@mapNotNull null
            val seed=((i*16807+17389)%65521)/65521.0
            if(goal){
                val x=width*.5+(seed-.5)*width*.76*t+sin(t*3+i)*7*t
                val y=height*.15-height*(.15+seed*.11)*t+height*.31*t*t
                if(y>height+12||x< -12||x>width+12)null else ConfettiPixel(x.roundToInt(),y.roundToInt(),4+(i%2)*2,2+2*abs(cos(t*6+i)).roundToInt(),(t*3+i).toInt()%4,when(i%3){0->0;1->1;else->5})
            }else{
                val side=if(i%2==0)1 else -1;val speed=width*(.18+seed*.26);val flight=height*(.58+((i*31)%83)/160.0)
                val x=width*(if(side==1).07 else .93)+side*speed*t+sin(t*3+i)*t*11
                val y=height*.78-flight*t+height*.43*t*t
                if(y>height+20||x< -20||x>width+20)null else ConfettiPixel(x.roundToInt(),y.roundToInt(),4+(i%3)*2,maxOf(2,((5+i%4)*abs(cos(t*5+i))).roundToInt()),(t*(2+i%3)+i).toInt()%4,i%6)
            }
        }
    }
}

interface AchievementReceiptStorage {
    fun read():String?
    fun write(value:String)
}

/** Separate local display receipt; only a verified write changes the adopted
 * set. Invalid or failed reads are never silently overwritten. */
class AchievementReceipts(private val storage:AchievementReceiptStorage) {
    fun read():Set<String> {
        val raw=storage.read()?:return emptySet()
        val array=StrictJson.parse(raw,65536) as? JSONArray?:error("Invalid achievement display receipts")
        require(array.length()<=256)
        return (0 until array.length()).map{val id=array.get(it);require(id is String&&id.isNotBlank()&&id.length<=128);id}.toSet()
    }
    fun acknowledge(ids:Collection<String>):Set<String> {
        val merged=read()+ids
        require(merged.size<=256&&merged.all{it.isNotBlank()&&it.length<=128})
        storage.write(JSONArray(merged.sorted()).toString())
        check(read()==merged){"Achievement display receipt could not be verified"}
        return merged
    }
    fun pending(entries:List<AchievementProgress>,seen:Set<String>)=entries.filter{it.unlocked&&it.definition.id !in seen}
}
