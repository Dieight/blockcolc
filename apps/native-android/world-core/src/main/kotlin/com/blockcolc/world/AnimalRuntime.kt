package com.blockcolc.world

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*

private fun animalNumber(raw:Any,min:Double,max:Double):Double {
    require(raw is Number);return raw.toDouble().also{require(it.isFinite()&&it in min..max){"Invalid animal state number"}}
}
private fun animalPoint(v:JSONObject)=AnimalPoint(animalNumber(v.get("x"),-1e6,1e6),animalNumber(v.get("y"),-1e6,1e6),animalNumber(v.get("z"),-1e6,1e6))
data class AnimalInitialState(val bounds:AnimalBounds,val center:AnimalPoint,val landSeeds:List<AnimalPoint>,
    val seed:Long,val sequence:Long,val time:Double,val agents:List<NativeAnimalAgent>) {
    companion object {
        fun read(v:JSONObject):AnimalInitialState {
            require(animalNumber(v.get("schema"),1.0,1.0)==1.0&&v.getString("scope")=="full"&&animalNumber(v.get("rootRotationY"),0.0,0.0)==0.0)
            fun integer(raw:Any,min:Double,max:Double):Long {val n=animalNumber(raw,min,max);require(n==floor(n));return n.toLong()}
            val b=v.getJSONObject("bounds");val bounds=AnimalBounds(animalNumber(b.get("minX"),-1e6,1e6),animalNumber(b.get("maxX"),-1e6,1e6),animalNumber(b.get("minZ"),-1e6,1e6),animalNumber(b.get("maxZ"),-1e6,1e6))
            require(bounds.minX<bounds.maxX&&bounds.minZ<bounds.maxZ)
            val rawSeeds=v.getJSONArray("landSeeds");require(rawSeeds.length()<=128);val seeds=List(rawSeeds.length()){animalPoint(rawSeeds.getJSONObject(it))}
            val community=v.getJSONObject("community");val rows=community.getJSONArray("agents");require(rows.length() in 1..64)
            val agents=List(rows.length()){i->val a=rows.getJSONObject(i);val kind=a.getString("kind");val species=a.getString("species");val activity=a.getString("activity")
                require(when(kind){"land"->species in setOf("sheep","cow","pig","horse")&&activity in setOf("rest","graze")
                    "fish"->species in setOf("silverfish","salmon","tropicalfish")&&activity in setOf("rest","swim")
                    "bird"->species in setOf("gull","swallow","finch")&&activity=="perch";else->false}){"Initial animal state must be captured before trajectories"}
                require(a.isNull("route")){"Active animal trajectory is not an initial snapshot"}
                fun n(key:String,min:Double,max:Double)=animalNumber(a.get(key),min,max)
                val agent=NativeAnimalAgent(integer(a.get("id"),1.0,64.0).toInt(),species,kind,animalPoint(a.getJSONObject("position")),n("heading",-1e6,1e6),activity,
                    n("remaining",-1e6,1e6),n("phase",0.0,PI*2),n("speed",0.0,100.0),n("traveled",0.0,1e9),n("response",0.0,1.3),
                    integer(a.get("reactions"),0.0,1e9).toInt(),n("ripple",0.0,1.0),n("jumpCooldown",0.0,10000.0),integer(a.get("school"),0.0,64.0).toInt(),
                    if(a.isNull("waterY"))null else n("waterY",-1e6,1e6))
                a.optJSONObject("walker")?.let{w->
                    require(kind=="land"&&animalPoint(w.getJSONObject("position"))==agent.position)
                    require(animalNumber(w.get("heading"),-1e6,1e6)==agent.heading&&animalNumber(w.get("traveled"),0.0,1e9)==agent.traveled)
                    require(animalNumber(w.get("reactionRemaining"),0.0,1.3)==agent.response&&animalNumber(w.get("speedScale"),1.0,1.0)==1.0&&animalNumber(w.get("curve"),0.0,0.0)==0.0)
                }
                agent
            }
            require(agents.map{it.id}.distinct().size==agents.size)
            return AnimalInitialState(bounds,animalPoint(v.getJSONObject("center")),seeds,integer(community.get("seed"),0.0,4294967295.0),
                integer(community.get("sequence"),0.0,1e9),animalNumber(community.get("time"),0.0,1e9),agents)
        }
    }
}
data class AnimalCamera(val eye:DoubleArray,val target:DoubleArray,val fov:Double,val aspect:Double,val near:Double,val far:Double) {
    private val forward=DoubleArray(3)
    private val right=DoubleArray(3)
    private val up=DoubleArray(3)
    private val tanY:Double
    private val tanX:Double
    private val cosX:Double
    private val cosY:Double
    init{require(eye.size==3&&target.size==3&&(eye.toList()+target.toList()+listOf(fov,aspect,near,far)).all{it.isFinite()}
        &&fov>0&&fov<179&&aspect>0&&near>0&&far>near)
        for(i in 0..2)forward[i]=target[i]-eye[i]
        val length=sqrt(forward.sumOf{it*it});require(length>1e-8)
        for(i in 0..2)forward[i]/=length
        val horizontal=hypot(forward[0],forward[2]);require(horizontal>1e-8)
        right[0]=-forward[2]/horizontal;right[2]=forward[0]/horizontal
        up[0]=-right[2]*forward[1];up[1]=right[2]*forward[0]-right[0]*forward[2];up[2]=right[0]*forward[1]
        tanY=tan(fov*PI/360);tanX=tanY*aspect;cosX=1/sqrt(1+tanX*tanX);cosY=1/sqrt(1+tanY*tanY)
    }
    fun visible(a:NativeAnimalAgent):Boolean {
        val px=a.position.x-eye[0];val py=a.position.y+.7-eye[1];val pz=a.position.z-eye[2]
        val radius=if(a.kind=="bird")1.5 else 1.8
        val depth=px*forward[0]+py*forward[1]+pz*forward[2];if(depth+radius<near||depth-radius>far)return false
        val x=px*right[0]+pz*right[2];val y=px*up[0]+py*up[1]+pz*up[2]
        return depth*tanX*cosX-abs(x)*cosX>=-radius&&depth*tanY*cosY-abs(y)*cosY>=-radius
    }
}

class NativeAnimalRuntime(input:AnimalHabitatInput,val initial:AnimalInitialState,activityScale:Double) {
    var activityScale:Double=activityScale;private set
    init{require(activityScale.isFinite()&&activityScale in .25..1.0)}
    fun updateActivityScale(value:Double){require(value.isFinite()&&value in .25..1.0);activityScale=value}
    val habitat=NativeAnimalHabitat(input,initial.bounds,initial.center,initial.landSeeds)
    // The prepared scene can be adopted again after surface recreation. Its
    // initial poses must never become another renderer's live mutable actors.
    private val agents=initial.agents.map{a->
        require(a.route==null){"Animal initial state contains an active trajectory"}
        NativeAnimalAgent(a.id,a.species,a.kind,a.position,a.heading,a.activity,a.remaining,a.phase,a.speed,a.traveled,a.response,a.reactions,
            a.ripple,a.jumpCooldown,a.school,a.waterY)
    }
    val community=NativeAnimalCommunity(habitat,initial.seed,agents,initial.sequence,initial.time)
    val rig=AnimalRig()
    private var lastAt=0L;private var lastFrame=0L;private var lastPose=0L
    private var visible=emptySet<Int>()
    private val births=initial.agents.associate{it.id to (it.position to it.heading)}
    private val suppressed=mutableSetOf<Int>()
    var updates=0;private set
    var planningMaxNs=0L;private set
    var ownerReplacements=0;private set
    fun pause(){lastAt=0;lastFrame=0;community.suspend()}
    fun advance(nowNs:Long,camera:AnimalCamera,motion:Boolean):Boolean {
        require(nowNs>0);if(lastFrame>0&&nowNs-lastFrame<31_000_000)return false
        val dt=if(lastAt>0)((nowNs-lastAt)/1e9).coerceIn(0.0,.12)else 0.0;lastAt=nowNs;lastFrame=nowNs
        val next=community.agents.filter{it.id !in suppressed&&camera.visible(it)}.map{it.id}.toSet();val changed=next!=visible;visible=next
        val responding=community.agents.any{it.response>0||it.ripple>0}
        if(!motion&&!responding&&!changed&&updates>0)return false
        community.update(dt,motion,visible,activityScale)
        if(motion){val began=System.nanoTime();community.pumpPlanning();planningMaxNs=max(planningMaxNs,System.nanoTime()-began)}
        val moving=community.agents.any{it.id in visible&&it.activity in setOf("walk","swim","jump","takeoff","fly","land")}
        if(!changed&&!responding&&!moving&&lastPose>0&&nowNs-lastPose<180_000_000)return false
        rig.update(community.agents,community.time,visible);lastPose=nowNs;updates++;return true
    }
    inner class OwnerUpdate internal constructor(private val collision:AnimalCollisionWorld.PreparedOwners,private val count:Int){
        fun commit(){collision.commit();ownerReplacements+=count;recoverAfterOwnerChange()}
    }
    fun prepareOwners(values:Map<String,List<AnimalSolid>>):OwnerUpdate {
        require(values.all{(owner,solids)->solids.all{it.owner==owner}})
        return OwnerUpdate(habitat.world.prepareOwners(values),values.size)
    }
    fun replaceOwner(owner:String,solids:List<AnimalSolid>)=prepareOwners(mapOf(owner to solids)).commit()
    private fun recoverAfterOwnerChange(){
        community.suspend()
        for(a in community.agents){
            when(a.kind){
                "land"->{val walker=a.walker!!;val body=walker.navigator.body
                    val safe=if(habitat.world.clear(a.position,body)&&habitat.world.supported(a.position,body))a.position
                        else walker.navigator.nearest(a.position,3)?:initial.landSeeds.asSequence().mapNotNull{walker.navigator.nearest(it,1)}.firstOrNull()
                    if(safe==null){suppressed+=a.id;walker.resetAfterOwnerChange();continue}
                    suppressed-=a.id;a.position=safe;walker.resetAfterOwnerChange(safe);a.activity="graze";a.remaining=2.0+(a.id%4)
                }
                "fish"->{if(a.route!=null||!habitat.swimClear(a.position)){
                    val p=births.getValue(a.id).first;val water=habitat.waterAt(p.x,p.z);val safe=water?.let{p.copy(y=it-.6)}
                    if(safe!=null&&habitat.swimClear(safe)){suppressed-=a.id;a.position=safe;a.waterY=water;a.route=null;a.activity="swim";a.remaining=3.0}
                    else suppressed+=a.id
                }}
                "bird"->{if(a.route!=null||a.position.y<habitat.flightFloor(a.position.x,a.position.z)){
                    val p=births.getValue(a.id).first;a.position=p.copy(y=habitat.flightFloor(p.x,p.z)+.08);a.route=null;a.activity="perch";a.remaining=3.0
                }}
            }
        }
        lastPose=0;visible=emptySet()
        // Source searches cancel on revision changes; unrelated cached columns
        // keep their local bin stamps. Do not replace the habitat or population.
    }
    fun diagnostics()=JSONObject().put("count",community.agents.size).put("visible",JSONArray(visible)).put("updates",updates)
        .put("time",community.time).put("activityScale",activityScale).put("plans",community.plans).put("cancelled",community.cancelled).put("planningMaxMs",planningMaxNs/1e6)
        .put("ownerReplacements",ownerReplacements).put("collision",JSONObject(habitat.world.stats()))
        .put("suppressedIds",JSONArray(suppressed))
        .put("rigCounts",JSONArray(rig.counts.toList())).put("scalarGroundIndexEstimate",habitat.groundIndexBytes())
        .put("agents",JSONArray(community.agents.map{a->JSONObject().put("id",a.id).put("species",a.species).put("kind",a.kind).put("activity",a.activity)
            .put("position",JSONArray(listOf(a.position.x,a.position.y,a.position.z))).put("heading",a.heading).put("traveled",a.traveled).put("response",a.response).put("reactions",a.reactions)}))
    fun close(){community.close()}
}
