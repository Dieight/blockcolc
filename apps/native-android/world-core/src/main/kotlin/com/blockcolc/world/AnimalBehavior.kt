package com.blockcolc.world

import kotlin.math.*

fun animalRandomUnit(seed:Long):Double {
    var n=(seed.toInt() xor 0x9e3779b9.toInt())*0x21f0aaad
    n=(n xor (n ushr 15))*0x735a2d97
    return ((n xor(n ushr 15)).toLong() and 0xffffffffL)/4294967296.0
}
data class AnimalFlightRoute(val from:AnimalPoint,val to:AnimalPoint,val control:AnimalPoint,val height:Double,var t:Double,val duration:Double)
class NativeAnimalAgent(val id:Int,val species:String,val kind:String,var position:AnimalPoint,var heading:Double,var activity:String,
    var remaining:Double,val phase:Double,var speed:Double=0.0,var traveled:Double=0.0,var response:Double=0.0,var reactions:Int=0,
    var ripple:Double=0.0,var jumpCooldown:Double=30.0,var school:Int=0,var waterY:Double?=null,var route:AnimalFlightRoute?=null,
    var walker:AnimalWalker?=null)
private fun angleMix(a:Double,b:Double,t:Double)=a+atan2(sin(b-a),cos(b-a))*min(1.0,t)
private fun mix(a:Double,b:Double,t:Double)=a+(b-a)*t
fun speedForNativeAnimal(a:NativeAnimalAgent,time:Double):Double {
    val base=if(a.kind=="land")AnimalBodies.all.single{it.id==a.species}.speed else if(a.kind=="fish").85 else 2.5
    return base*(.62+animalRandomUnit(a.id*107L+13)*.48+sin(time*.53+a.phase)*.16+sin(time*.19+a.phase*2)*.1)*
        if(a.species=="horse"&&sin(time*.13+a.phase)>.65)1.35 else 1.0
}

/** Source behavior runs on native state, not a recorded matrix animation.
 * Planning has one in-flight job and explicit cancellation / slice budgets. */
class NativeAnimalCommunity(val habitat:AnimalHabitatAccess,val seed:Long,val agents:List<NativeAnimalAgent>,
                            sequence:Long=0,time:Double=0.0) {
    var time=time;private set
    var sequence=sequence;private set
    var plans=0;private set
    var cancelled=0;private set
    private var alive=true
    private data class Pending(val agent:NativeAnimalAgent,val origin:AnimalPoint,var attempt:Int,var search:AnimalNavigator.Search?,var goal:AnimalPoint?)
    private var pending:Pending?=null
    init{
        require(agents.size<=64&&agents.map{it.id}.distinct().size==agents.size&&sequence>=0&&time.isFinite()&&time>=0)
        for(a in agents)if(a.kind=="land"){
            val body=AnimalBodies.all.single{it.id==a.species};val nav=AnimalNavigator(habitat.world,body,1.0,1024)
            if(a.walker==null)a.walker=AnimalWalker(nav,a.position).also{it.heading=a.heading;it.traveled=a.traveled}
            a.walker!!.canOccupy={q->agents.all{other->other===a||other.kind!="land"||abs(other.position.y-q.y)>1.3||
                hypot(other.position.x-q.x,other.position.z-q.z)>body.radius+AnimalBodies.all.single{it.id==other.species}.radius+.08}}
        }
    }
    private fun random()=animalRandomUnit(seed+(++sequence)*269)
    fun tap(id:Int):Boolean {
        val a=agents.firstOrNull{it.id==id}?:return false;a.response=1.3;a.reactions++;a.walker?.tap();if(a.kind=="fish")a.ripple=1.0;return true
    }
    private fun nextGoal(job:Pending):Boolean {
        val nav=job.agent.walker!!.navigator
        while(job.attempt<3){job.attempt++
            val angle=job.agent.heading+(random()-.5)*PI*1.7;val length=4+random()*12
            val x=floor(job.origin.x+sin(angle)*length+.5);val z=floor(job.origin.z+cos(angle)*length+.5)
            val goal=nav.column(x,z).filter{abs(it.y-job.origin.y)<4}.minByOrNull{abs(it.y-job.origin.y)}?:continue
            job.goal=goal;job.search=nav.search(job.origin,goal,1200);return true
        }
        return false
    }
    private fun finishPlanning(job:Pending){pending=null;if(job.agent.activity!="walk")job.agent.remaining=2+random()*5}
    private fun chooseWalk(a:NativeAnimalAgent){
        if(pending!=null||a.walker==null||!alive)return
        val job=Pending(a,a.position,0,null,null);pending=job;if(!nextGoal(job))finishPlanning(job)
    }
    fun pumpPlanning(maxNanos:Long=2_000_000) {
        require(maxNanos>0);val job=pending?:return;val began=System.nanoTime()
        while(pending===job&&System.nanoTime()-began<maxNanos){
            val search=job.search?:break
            if(!alive){search.cancel()}
            val remaining=max(1L,maxNanos-(System.nanoTime()-began))
            if(!search.advance(Int.MAX_VALUE,remaining))return
            val result=search.result!!
            if(result.reason=="cancelled"){cancelled++;finishPlanning(job);return}
            if(result.reason=="arrived"&&result.points.size>1){
                val a=job.agent;a.walker!!.adoptRoute(job.goal!!,result);a.walker!!.curve=(random()-.5)*.28
                a.activity="walk";a.remaining=6+random()*10;plans++;finishPlanning(job);return
            }
            if(!nextGoal(job)){finishPlanning(job);return}
        }
    }
    fun suspend(){pending?.let{it.search?.cancel();cancelled++;finishPlanning(it)}}
    fun close(){alive=false;suspend()}
    fun update(seconds:Double,motion:Boolean,visible:Set<Int>?=null,activityScale:Double=1.0){
        require(seconds.isFinite()&&activityScale.isFinite());val dt=seconds.coerceIn(0.0,.12);time+=dt
        for(a in agents){
            a.response=max(0.0,a.response-dt);a.ripple=max(0.0,a.ripple-dt*.8)
            if(!motion)a.walker?.reactionRemaining=a.response
            if(!motion||visible!=null&&a.id !in visible)continue
            a.remaining-=dt*activityScale.coerceIn(.25,1.0);a.speed=speedForNativeAnimal(a,time)*(.8+.2*activityScale)
            when(a.kind){"land"->updateLand(a,dt);"fish"->updateFish(a,dt);"bird"->updateBird(a,dt);else->error("Unreviewed animal kind")}
        }
    }
    private fun updateLand(a:NativeAnimalAgent,dt:Double){
        val walker=a.walker!!
        if(a.activity=="walk"){
            walker.speedScale=a.speed/walker.navigator.body.speed;walker.update(dt);a.position=walker.position;a.heading=walker.heading;a.traveled=walker.traveled
            if((!walker.moving||a.remaining<=0)&&habitat.world.supported(a.position,walker.navigator.body)){
                walker.route=null;a.activity=if(random()<.75)"graze" else "rest";a.remaining=3+random()*9
            }
        }else if(a.remaining<=0&&a.response==0.0)chooseWalk(a)
    }
    private fun updateFish(a:NativeAnimalAgent,dt:Double){
        a.jumpCooldown=max(0.0,a.jumpCooldown-dt)
        if(a.activity=="jump"&&a.route!=null){val r=a.route!!;r.t=min(1.0,r.t+dt/r.duration)
            a.position=AnimalPoint(mix(r.from.x,r.to.x,r.t),mix(r.from.y,r.to.y,r.t)+sin(r.t*PI)*1.25,mix(r.from.z,r.to.z,r.t))
            if(r.t>=1){a.activity="swim";a.remaining=5+random()*12;a.ripple=1.0;a.route=null};return
        }
        if(a.response>0)return
        if(a.remaining<=0){a.activity=if(a.activity=="rest")"swim" else if(random()<.55)"rest" else "swim";a.remaining=3+random()*if(a.activity=="rest")5 else 13}
        if(a.activity=="rest")return
        val neighbors=agents.filter{it.kind=="fish"&&it.school==a.school&&it!==a&&hypot(it.position.x-a.position.x,it.position.z-a.position.z)<8}
        var desired=a.heading+sin(time*.7+a.phase)*dt*.7
        if(neighbors.isNotEmpty()){val x=neighbors.sumOf{it.position.x}/neighbors.size;val z=neighbors.sumOf{it.position.z}/neighbors.size
            desired=angleMix(desired,atan2(x-a.position.x,z-a.position.z),dt*.3)}
        a.heading=angleMix(a.heading,desired,dt*2)
        var next=AnimalPoint(a.position.x+sin(a.heading)*a.speed*dt,a.position.y,a.position.z+cos(a.heading)*a.speed*dt)
        val surface=habitat.waterAt(next.x,next.z);if(surface!=null)next=next.copy(y=surface-.6+sin(time*.5+a.phase)*.14)
        if(habitat.swimClear(next)){a.traveled+=hypot(next.x-a.position.x,next.z-a.position.z);a.position=next;a.waterY=surface}
        else{a.heading+=dt*3.3;a.remaining=min(a.remaining,2.0)}
        if(a.jumpCooldown<=0&&random()<dt/45&&surface!=null){
            val to=AnimalPoint(a.position.x+sin(a.heading)*1.4,a.position.y,a.position.z+cos(a.heading)*1.4)
            val mid=AnimalPoint((to.x+a.position.x)/2,to.y,(to.z+a.position.z)/2)
            val clear=(0..12).all{i->val t=i/12.0;val p=AnimalPoint(mix(a.position.x,to.x,t),mix(a.position.y,to.y,t)+sin(t*PI)*1.25,mix(a.position.z,to.z,t));habitat.waterAt(p.x,p.z)!=null&&habitat.obstacleClear(p)}
            if(habitat.swimClear(to)&&habitat.swimClear(mid)&&clear){a.route=AnimalFlightRoute(a.position,to,mid,surface+1,0.0,1.1);a.activity="jump";a.ripple=1.0;a.jumpCooldown=25+random()*60}
        }
    }
    private fun updateBird(a:NativeAnimalAgent,dt:Double){
        if(a.activity=="perch"){
            if(agents.any{it.kind=="land"&&hypot(it.position.x-a.position.x,it.position.z-a.position.z)<2.5})a.remaining=0.0
            if(a.remaining>0||a.response>0)return
            val angle=random()*PI*2;val length=8+random()*24
            var to=AnimalPoint(a.position.x+sin(angle)*length,0.0,a.position.z+cos(angle)*length)
            if(a.species!="gull"&&habitat.waterAt(to.x,to.z)!=null){
                val land=habitat.landSeeds.firstOrNull{hypot(it.x-a.position.x,it.z-a.position.z)>6&&hypot(it.x-a.position.x,it.z-a.position.z)<32}
                if(land==null){a.remaining=3.0;return};to=to.copy(x=land.x,z=land.z)
            }
            val b=habitat.bounds;if(to.x<b.minX+2||to.x>b.maxX-2||to.z<b.minZ+2||to.z>b.maxZ-2){a.remaining=2.0;return}
            to=to.copy(y=habitat.flightFloor(to.x,to.z)+.08)
            val control=AnimalPoint((a.position.x+to.x)/2+cos(angle)*length*.3,0.0,(a.position.z+to.z)/2-sin(angle)*length*.3)
            var height=max(a.position.y,to.y)+6;var t=0.0
            while(t<=1){val x=(1-t).pow(2)*a.position.x+2*(1-t)*t*control.x+t*t*to.x;val z=(1-t).pow(2)*a.position.z+2*(1-t)*t*control.z+t*t*to.z
                height=max(height,habitat.flightFloor(x,z)+4);t+=.1}
            a.route=AnimalFlightRoute(a.position,to,control,height,0.0,length/2.8);a.activity="takeoff";return
        }
        val r=a.route?:return
        fun smooth(t:Double)=t*t*(3-2*t)
        when(a.activity){
            "takeoff"->{r.t=min(1.0,r.t+dt*.75);a.position=a.position.copy(y=mix(r.from.y,r.height,smooth(r.t)));if(r.t>=1){a.activity="fly";r.t=0.0}}
            "fly"->{r.t=min(1.0,r.t+dt*a.speed/2.5/r.duration);val t=r.t
                val x=(1-t).pow(2)*r.from.x+2*(1-t)*t*r.control.x+t*t*r.to.x;val z=(1-t).pow(2)*r.from.z+2*(1-t)*t*r.control.z+t*t*r.to.z
                a.heading=angleMix(a.heading,atan2(x-a.position.x,z-a.position.z),dt*5);a.traveled+=hypot(x-a.position.x,z-a.position.z)
                a.position=AnimalPoint(x,r.height+sin(t*PI)*1.8,z);if(t>=1){a.activity="land";r.t=0.0}}
            else->{r.t=min(1.0,r.t+dt*.75);a.position=a.position.copy(y=mix(r.height,r.to.y,smooth(r.t)))
                if(r.t>=1){a.position=r.to;a.activity="perch";a.remaining=5+random()*12;a.route=null}}
        }
    }
}
