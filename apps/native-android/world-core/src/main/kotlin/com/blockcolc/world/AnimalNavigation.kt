package com.blockcolc.world

import kotlin.math.*

data class AnimalPoint(val x:Double,val y:Double,val z:Double)
interface AnimalFootprint {val minX:Double;val maxX:Double;val minZ:Double;val maxZ:Double}
data class AnimalBounds(override val minX:Double,override val maxX:Double,override val minZ:Double,override val maxZ:Double):AnimalFootprint
data class AnimalSolid(val id:String,val owner:String,override val minX:Double,override val maxX:Double,val minY:Double,val maxY:Double,
    override val minZ:Double,override val maxZ:Double,val water:Boolean=false,val walkable:Boolean=true):AnimalFootprint
data class AnimalBody(val id:String,val radius:Double,val height:Double,val step:Double,val jump:Double,val drop:Double,val speed:Double,val supportRadius:Double=radius)
object AnimalBodies {
    val SHEEP=AnimalBody("sheep",.49,1.35,.51,1.01,1.05,1.65,.27)
    val COW=AnimalBody("cow",.55,1.65,.51,1.01,1.05,1.4,.3)
    val PIG=AnimalBody("pig",.32,.95,.51,1.01,1.05,1.8)
    val HORSE=AnimalBody("horse",.64,2.35,.51,1.01,1.05,2.2)
    val all=listOf(SHEEP,COW,PIG,HORSE)
}
private const val ANIMAL_EPS=.0001
private fun contains(b:AnimalFootprint,x:Double,z:Double)=x>=b.minX-ANIMAL_EPS&&x<=b.maxX+ANIMAL_EPS&&z>=b.minZ-ANIMAL_EPS&&z<=b.maxZ+ANIMAL_EPS
private fun overlaps(a:AnimalFootprint,b:AnimalFootprint)=a.maxX>b.minX+ANIMAL_EPS&&a.minX<b.maxX-ANIMAL_EPS&&a.maxZ>b.minZ+ANIMAL_EPS&&a.minZ<b.maxZ-ANIMAL_EPS
private fun footprint(p:AnimalPoint,r:Double)=AnimalBounds(p.x-r,p.x+r,p.z-r,p.z+r)
private fun jsRound(v:Double)=floor(v+.5)

/** IDs already live on immutable solids. A flat table avoids a second key
 * reference and a hash-node object for every voxel in a reef/forest. Iteration
 * order belongs to owner/bin lists, never to this validation lookup. */
private class AnimalSolidIndex {
    private object Deleted
    private var rows=arrayOfNulls<Any>(16)
    private var used=0
    var size=0;private set
    private fun hash(id:String):Int {
        // Hash full characters rather than inheriting Java String's familiar
        // Aa/BB collision families in IDs supplied by an imported workspace.
        var h=0x811c9dc5.toInt();for(c in id)h=(h xor c.code)*0x01000193
        return h xor(h ushr 16)
    }
    operator fun get(id:String):AnimalSolid? {
        var at=hash(id) and(rows.size-1)
        while(true){val value=rows[at]?:return null
            if(value is AnimalSolid&&value.id==id)return value
            at=(at+1)and(rows.size-1)
        }
    }
    operator fun contains(id:String)=get(id)!=null
    fun getValue(id:String)=get(id)?:throw NoSuchElementException("Missing collider ID")
    private fun resize(capacity:Int){
        val old=rows;rows=arrayOfNulls(capacity);used=0;size=0
        for(value in old)if(value is AnimalSolid)put(value)
    }
    private fun put(value:AnimalSolid){
        var at=hash(value.id)and(rows.size-1);var deleted=-1
        while(true){val old=rows[at]
            if(old==null){
                val slot=if(deleted>=0)deleted else at.also{used++}
                rows[slot]=value;size++;return
            }
            if(old is AnimalSolid&&old.id==value.id){rows[at]=value;return}
            if(old===Deleted&&deleted<0)deleted=at
            at=(at+1)and(rows.size-1)
        }
    }
    operator fun set(id:String,value:AnimalSolid){
        require(id==value.id)
        if((used+1)*4>=rows.size*3)resize(if((size+1)*4>=rows.size*3)rows.size*2 else rows.size)
        put(value)
    }
    fun add(value:AnimalSolid):Boolean{if(value.id in this)return false;set(value.id,value);return true}
    fun remove(id:String){
        var at=hash(id)and(rows.size-1)
        while(true){val value=rows[at]?:return
            if(value is AnimalSolid&&value.id==id){rows[at]=Deleted;size--;return}
            at=(at+1)and(rows.size-1)
        }
    }
}

/** Same 8-block broad phase / owner epochs as the pure production navigator.
 * Ground is a separate read-only surface index; moving animals never add it
 * again or invalidate the whole scene. Incoming owners validate before swap. */
class AnimalCollisionWorld(val bounds:AnimalBounds,initial:List<AnimalSolid> = emptyList(),private val ground:((AnimalBounds)->List<AnimalSolid>)?=null,
                           private val strictSourceOverlap:Boolean=false) {
    private val solids=AnimalSolidIndex()
    // A solid is already immutable and identified in `solids`. Bucket and
    // owner membership need ordered references, not another hash node for
    // every voxel in a dense reef or forest.
    private val buckets=mutableMapOf<Pair<Int,Int>,MutableList<AnimalSolid>>()
    private val epochs=mutableMapOf<Pair<Int,Int>,Long>()
    private val owners=mutableMapOf<String,List<AnimalSolid>>()
    private var indexReferences=0
    var revision=0L;private set
    var queries=0L;private set
    init{require(listOf(bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ).all{it.isFinite()}&&bounds.maxX>bounds.minX&&bounds.maxZ>bounds.minZ);replaceOwner("initial",initial)}
    private fun bins(b:AnimalFootprint):List<Pair<Int,Int>> {
        require(listOf(b.minX,b.maxX,b.minZ,b.maxZ).all{it.isFinite()}&&b.maxX>b.minX&&b.maxZ>b.minZ)
        val margin=if(strictSourceOverlap)0.0 else ANIMAL_EPS
        val x0=floor(b.minX/8).toInt();val x1=floor((b.maxX-margin)/8).toInt()
        val z0=floor(b.minZ/8).toInt();val z1=floor((b.maxZ-margin)/8).toInt()
        require((x1.toLong()-x0+1)*(z1.toLong()-z0+1) in 0..65536){"Animal spatial query budget"}
        val result=ArrayList<Pair<Int,Int>>();for(z in z0..z1)for(x in x0..x1)result+=x to z;return result
    }
    data class Dirty(val bins:Int,val revision:Long)
    /** A complete multi-owner candidate is checked against the final budget.
     * Staging it changes no live index, epoch, animal or route. The GPU host
     * commits this ticket only after every corresponding upload succeeds. */
    inner class PreparedOwners internal constructor(private val atRevision:Long,private val replacements:Map<String,List<AnimalSolid>>,
        private val incomingReferences:Int,private val outgoingReferences:Int){
        private var committed=false
        fun commit():Dirty {
            check(!committed&&revision==atRevision){"Stale animal collision replacement"};committed=true
            val dirty=linkedSetOf<Pair<Int,Int>>()
            for(owner in replacements.keys)for(solid in owners[owner].orEmpty()){
                dirty.addAll(bins(solid));solids.remove(solid.id)
            }
            // Compact each affected bucket once. Removing one voxel at a time
            // would turn replacement of a tall shared bin into quadratic work.
            for(k in dirty)buckets[k]?.removeAll{it.owner in replacements}
            for((owner,values)in replacements){owners[owner]=values
                for(s in values){solids[s.id]=s;for(k in bins(s)){buckets.getOrPut(k){ArrayList()}.add(s);dirty+=k}}}
            indexReferences+=incomingReferences-outgoingReferences;revision++
            for(k in dirty){if(buckets[k]?.isEmpty()==true)buckets.remove(k);epochs[k]=revision}
            return Dirty(dirty.size,revision)
        }
    }
    fun prepareOwners(replacements:Map<String,List<AnimalSolid>>):PreparedOwners {
        require(replacements.isNotEmpty()&&replacements.size<=4096&&replacements.keys.all{it.length in 1..256})
        val saved=LinkedHashMap<String,List<AnimalSolid>>();val ids=AnimalSolidIndex();var references=0L
        for((owner,values)in replacements){require(values.size<=500000)
            saved[owner]=values.map{s->
                require(s.id.length in 1..512&&listOf(s.minX,s.maxX,s.minY,s.maxY,s.minZ,s.maxZ).all{it.isFinite()&&abs(it)<=1e6}
                    &&s.minX<s.maxX&&s.minY<s.maxY&&s.minZ<s.maxZ&&ids.add(s)
                    &&(s.id !in solids||solids.getValue(s.id).owner in replacements)){"Invalid or duplicate animal collider"}
                references+=bins(s).size;require(references<=4000000&&ids.size<=500000){"Animal collision index budget"}
                if(s.owner==owner)s else s.copy(owner=owner)
            }
        }
        val old=replacements.keys.flatMap{owners[it].orEmpty()};val oldReferences=old.sumOf{bins(it).size}
        require(solids.size-old.size+ids.size<=500000&&indexReferences-oldReferences+references<=4000000){"Animal collision world budget"}
        return PreparedOwners(revision,saved,references.toInt(),oldReferences)
    }
    fun validateOwner(owner:String,replacement:List<AnimalSolid>){prepareOwners(mapOf(owner to replacement))}
    fun replaceOwner(owner:String,replacement:List<AnimalSolid>)=prepareOwners(mapOf(owner to replacement)).commit()
    fun query(b:AnimalBounds):List<AnimalSolid> {
        queries++;val queried=bins(b);val firstX=floor(b.minX/8).toInt();val firstZ=floor(b.minZ/8).toInt()
        val result=ArrayList<AnimalSolid>()
        for(k in queried)for(solid in buckets[k].orEmpty()){
            // Each solid occupies a rectangular range of bins. Emit it only
            // in the first intersecting bin (z, then x), preserving the source
            // order without a new ID HashSet / lookup / filter per probe.
            if(k.first!=max(firstX,floor(solid.minX/8).toInt())||k.second!=max(firstZ,floor(solid.minZ/8).toInt()))continue
            if(if(strictSourceOverlap)solid.minX<b.maxX&&solid.maxX>b.minX&&solid.minZ<b.maxZ&&solid.maxZ>b.minZ else overlaps(solid,b))result+=solid
        }
        ground?.invoke(b)?.let(result::addAll);return result
    }
    fun stamp(b:AnimalBounds):List<Long> = bins(b).map{epochs[it]?:0L}
    fun clear(p:AnimalPoint,body:AnimalBody):Boolean {
        if(!contains(bounds,p.x-body.radius,p.z-body.radius)||!contains(bounds,p.x+body.radius,p.z+body.radius))return false
        return query(footprint(p,body.radius)).none{p.y+body.height>it.minY+ANIMAL_EPS&&p.y<it.maxY-ANIMAL_EPS}
    }
    fun supported(p:AnimalPoint,body:AnimalBody):Boolean {
        val near=query(footprint(p,body.radius));val r=body.supportRadius*.96
        return listOf(0.0 to 0.0,-r to -r,r to -r,-r to r,r to r).all{(dx,dz)->
            near.any{!it.water&&it.walkable&&abs(it.maxY-p.y)<.025&&contains(it,p.x+dx,p.z+dz)}}
    }
    fun floors(x:Double,z:Double,body:AnimalBody):List<AnimalPoint> = query(footprint(AnimalPoint(x,0.0,z),body.radius))
        .filter{!it.water&&it.walkable&&contains(it,x,z)}.map{it.maxY}.distinct().sorted().map{AnimalPoint(x,it,z)}.filter{clear(it,body)&&supported(it,body)}
    fun stats()=mapOf("solids" to solids.size.toLong(),"bins" to buckets.size.toLong(),"epochs" to epochs.size.toLong(),"queries" to queries,"revision" to revision)
}

fun animalEdgeAction(a:AnimalPoint,b:AnimalPoint,body:AnimalBody)=if(b.y<a.y-.025)"drop" else if(b.y>a.y+.025){if(b.y-a.y<=body.step)"step" else "jump"}else "walk"
fun animalEdgePoint(a:AnimalPoint,b:AnimalPoint,t:Double,body:AnimalBody):AnimalPoint {
    fun mix(x:Double,y:Double,k:Double)=x+(y-x)*k
    val action=animalEdgeAction(a,b,body)
    if(action=="walk")return AnimalPoint(mix(a.x,b.x,t),a.y,mix(a.z,b.z,t))
    val peak=max(a.y,b.y)+if(action=="step").12 else .28
    if(t<.28)return AnimalPoint(a.x,mix(a.y,peak,sin(t/.28*PI/2)),a.z)
    if(t<.8){val k=(t-.28)/.52;return AnimalPoint(mix(a.x,b.x,k),peak+sin(k*PI)*.06,mix(a.z,b.z,k))}
    return AnimalPoint(b.x,mix(peak,b.y,1-cos((t-.8)/.2*PI/2)),b.z)
}
fun animalTraversable(world:AnimalCollisionWorld,a:AnimalPoint,b:AnimalPoint,body:AnimalBody):Boolean {
    val dy=b.y-a.y;if(dy>body.jump+ANIMAL_EPS||-dy>body.drop+ANIMAL_EPS)return false
    if(!world.clear(a,body)||!world.clear(b,body)||!world.supported(b,body))return false
    if(abs(dy)<.025){
        val r=body.radius;val swept=AnimalBounds(min(a.x,b.x)-r,max(a.x,b.x)+r,min(a.z,b.z)-r,max(a.z,b.z)+r)
        if(world.query(swept).any{a.y+body.height>it.minY+ANIMAL_EPS&&a.y<it.maxY-ANIMAL_EPS})return false
        return listOf(.25,.5,.75).all{world.supported(animalEdgePoint(a,b,it,body),body)}
    }
    return (1 until 32).all{world.clear(animalEdgePoint(a,b,it/32.0,body),body)}
}
data class AnimalRoute(val points:List<AnimalPoint>,val actions:List<String>,val expanded:Int,val reason:String)
private data class AnimalHeapEntry(val p:AnimalPoint,val g:Double,val f:Double)
private class AnimalHeap {
    private val values=ArrayList<AnimalHeapEntry>();val size get()=values.size
    fun push(v:AnimalHeapEntry){var i=values.size;values+=v;while(i>0){val parent=(i-1)/2;if(values[parent].f<=v.f)break;values[i]=values[parent];i=parent};values[i]=v}
    fun pop():AnimalHeapEntry {
        val top=values.first();val last=values.removeAt(values.lastIndex);if(values.isEmpty())return top
        var i=0;while(i*2+1<values.size){var child=i*2+1;if(child+1<values.size&&values[child+1].f<values[child].f)child++
            if(last.f<=values[child].f)break;values[i]=values[child];i=child};values[i]=last;return top
    }
}

/** Search remains incremental in the same native world. A revision change
 * cancels in-flight search before another slice; cached columns use bin epochs. */
class AnimalNavigator(val world:AnimalCollisionWorld,val body:AnimalBody,val cell:Double=1.0,val cacheLimit:Int=4096) {
    private data class Column(val stamp:List<Long>,val points:List<AnimalPoint>)
    private val columns=linkedMapOf<Pair<Double,Double>,Column>()
    var cacheHits=0L;private set
    var cacheMisses=0L;private set
    init{require(cell.isFinite()&&cell>0&&cell<=16&&cacheLimit in 1..65536)}
    fun column(x:Double,z:Double):List<AnimalPoint> {
        val key=(if(x==0.0)0.0 else x) to (if(z==0.0)0.0 else z);val stamp=world.stamp(footprint(AnimalPoint(x,0.0,z),body.radius))
        val old=columns.remove(key)
        if(old?.stamp==stamp){cacheHits++;columns[key]=old;return old.points}
        cacheMisses++;val points=world.floors(x,z,body);columns[key]=Column(stamp,points)
        if(columns.size>cacheLimit)columns.remove(columns.keys.first());return points
    }
    fun nearest(p:AnimalPoint,distance:Int=3):AnimalPoint? {
        require(distance in 0..64);val cx=jsRound(p.x/cell)*cell;val cz=jsRound(p.z/cell)*cell
        var best:AnimalPoint?=null;var score=Double.POSITIVE_INFINITY
        for(dz in -distance..distance)for(dx in -distance..distance){if(hypot(dx.toDouble(),dz.toDouble())>distance)continue
            for(q in column(cx+dx*cell,cz+dz*cell)){val next=hypot(q.x-p.x,q.z-p.z)+abs(q.y-p.y)*2;if(next<score){best=q;score=next}}}
        return best
    }
    private fun nodeKey(p:AnimalPoint)=Triple(if(p.x==0.0)0.0 else p.x,if(p.z==0.0)0.0 else p.z,jsRound(p.y*10000).toLong())
    fun search(start:AnimalPoint,goal:AnimalPoint,budget:Int=8000)=Search(start,goal,budget)
    fun plan(start:AnimalPoint,goal:AnimalPoint,budget:Int=8000):AnimalRoute {
        val search=search(start,goal,budget);while(!search.advance(Int.MAX_VALUE,Long.MAX_VALUE)){};return search.result!!
    }
    inner class Search(private val start:AnimalPoint,private val goal:AnimalPoint,private val budget:Int) {
        private val revision=world.revision;private val heap=AnimalHeap()
        private val costs=mutableMapOf<Triple<Double,Double,Long>,Double>();private val parents=mutableMapOf<Triple<Double,Double,Long>,AnimalPoint>()
        private var origin:AnimalPoint?=null;private var target:AnimalPoint?=null;private var initialized=false
        private var expanded=0
        var result:AnimalRoute?=null;private set
        init{require(budget in 1..100000)}
        private fun finish(points:List<AnimalPoint>,reason:String){result=AnimalRoute(points,points.zipWithNext{a,b->animalEdgeAction(a,b,body)},expanded,reason)}
        fun cancel(){if(result==null)finish(emptyList(),"cancelled")}
        fun advance(maxNodes:Int=64,maxNanos:Long=2_000_000):Boolean {
            require(maxNodes>0&&maxNanos>0);if(result!=null)return true
            if(world.revision!=revision){cancel();return true}
            val began=System.nanoTime()
            if(!initialized){initialized=true
                if(!world.clear(start,body)||!world.supported(start,body)||!world.clear(goal,body)||!world.supported(goal,body)){finish(emptyList(),"invalid");return true}
                origin=nearest(start,1);target=nearest(goal,1)
                if(origin==null||target==null||!animalTraversable(world,start,origin!!,body)||!animalTraversable(world,target!!,goal,body)){finish(emptyList(),"invalid");return true}
                costs[nodeKey(origin!!)]=0.0;heap.push(AnimalHeapEntry(origin!!,0.0,hypot(origin!!.x-target!!.x,origin!!.z-target!!.z)))
            }
            val initial=expanded
            while(heap.size>0&&expanded<budget){
                if(expanded-initial>=maxNodes||System.nanoTime()-began>=maxNanos)return false
                val (p,g)=heap.pop();val id=nodeKey(p);if(g>(costs[id]?:Double.POSITIVE_INFINITY)+ANIMAL_EPS)continue
                expanded++
                if(id==nodeKey(target!!)){
                    val points=mutableListOf(p);var cursor=p;while(parents.containsKey(nodeKey(cursor))){cursor=parents.getValue(nodeKey(cursor));points+=cursor};points.reverse()
                    if(hypot(start.x-origin!!.x,start.z-origin!!.z)>ANIMAL_EPS)points.add(0,start)
                    if(hypot(goal.x-target!!.x,goal.z-target!!.z)>ANIMAL_EPS)points+=goal
                    finish(points,"arrived");return true
                }
                for((dx,dz) in listOf(cell to 0.0,-cell to 0.0,0.0 to cell,0.0 to -cell,cell to cell,-cell to cell,cell to -cell,-cell to -cell))
                    for(next in column(p.x+dx,p.z+dz)){
                        val nextId=nodeKey(next);val nextG=g+hypot(dx,dz)+abs(next.y-p.y)*.6+if(abs(next.y-p.y)>.025).35 else 0.0
                        if(nextG>=(costs[nextId]?:Double.POSITIVE_INFINITY)-ANIMAL_EPS||!animalTraversable(world,p,next,body))continue
                        costs[nextId]=nextG;parents[nextId]=p;heap.push(AnimalHeapEntry(next,nextG,nextG+hypot(next.x-target!!.x,next.z-target!!.z)))
                    }
            }
            finish(emptyList(),if(heap.size>0)"budget" else "unreachable");return true
        }
    }
    fun stats()=mapOf("columns" to columns.size.toLong(),"limit" to cacheLimit.toLong(),"hits" to cacheHits,"misses" to cacheMisses)
}

class AnimalWalker(val navigator:AnimalNavigator,start:AnimalPoint) {
    var speedScale=1.0;var curve=0.0
    var canOccupy:((AnimalPoint)->Boolean)?=null
    var position=start;var heading=0.0;var traveled=0.0;var reactions=0;var reactionRemaining=0.0
    var route:AnimalRoute?=null;var goal:AnimalPoint?=null;var replans=0;var blocked=0;var droppedSeconds=0.0
    private var edge=0;private var t=0.0;private var seenRevision=navigator.world.revision;private var replanOnLanding=false
    val moving get()=route?.let{edge+1<it.points.size}?:false
    fun adoptRoute(goal:AnimalPoint,route:AnimalRoute):AnimalRoute {this.goal=goal;this.route=route;edge=0;t=0.0;seenRevision=navigator.world.revision;return route}
    fun setTarget(goal:AnimalPoint)=adoptRoute(goal,navigator.plan(position,goal))
    fun tap(){reactions++;reactionRemaining=1.3}
    /** Native owner updates retain the habitat / column cache, but a former
     * path cannot remain live across newly constructed collision. */
    fun resetAfterOwnerChange(point:AnimalPoint=position){position=point;route=null;goal=null;edge=0;t=0.0;replanOnLanding=false;seenRevision=navigator.world.revision}
    fun update(elapsed:Double){
        if(!elapsed.isFinite()||elapsed<=0)return
        val bounded=min(elapsed,.12);droppedSeconds+=max(0.0,elapsed-bounded)
        if(reactionRemaining>0){reactionRemaining=max(0.0,reactionRemaining-bounded);if(navigator.world.supported(position,navigator.body))return}
        if(seenRevision!=navigator.world.revision){seenRevision=navigator.world.revision
            goal?.let{if(moving){if(navigator.world.supported(position,navigator.body)){replans++;setTarget(it)}else replanOnLanding=true}}}
        var remaining=bounded
        while(remaining>ANIMAL_EPS&&moving){
            val dt=min(remaining,1.0/90);remaining-=dt;val a=route!!.points[edge];val b=route!!.points[edge+1]
            val length=max(.001,hypot(b.x-a.x,b.z-a.z));val walk=animalEdgeAction(a,b,navigator.body)=="walk"
            val duration=length/(navigator.body.speed*max(.1,speedScale))+if(walk)0.0 else .45
            val nextT=min(1.0,t+dt/duration);val straight=animalEdgePoint(a,b,nextT,navigator.body);var next=straight
            if(walk&&curve!=0.0){val offset=sin(PI*nextT)*curve;val curved=AnimalPoint(straight.x-(b.z-a.z)/length*offset,straight.y,straight.z+(b.x-a.x)/length*offset)
                if(navigator.world.clear(curved,navigator.body)&&navigator.world.supported(curved,navigator.body))next=curved}
            if(!navigator.world.clear(next,navigator.body)||walk&&!navigator.world.supported(next,navigator.body)||canOccupy?.invoke(next)==false){blocked++;route=null;break}
            traveled+=hypot(next.x-position.x,next.z-position.z)
            val desired=if(hypot(next.x-position.x,next.z-position.z)>.00001)atan2(next.x-position.x,next.z-position.z)else heading
            val turn=atan2(sin(desired-heading),cos(desired-heading));position=next;heading+=turn*min(1.0,dt*12);t=nextT
            if(nextT>=1){edge++;t=0.0;if(replanOnLanding&&goal!=null){replanOnLanding=false;replans++;setTarget(goal!!)}}
        }
    }
}
