package com.blockcolc.world

import com.blockcolc.world.generation.BlockPoint
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.IntBuffer
import java.util.Collections
import java.util.concurrent.CancellationException
import kotlin.math.*

data class NativePickRay(val origin:BlockPoint,val direction:BlockPoint) {
    init {require(listOf(origin.x,origin.y,origin.z,direction.x,direction.y,direction.z).all{it.isFinite()});require(direction.x!=0.0||direction.y!=0.0||direction.z!=0.0)}
}
data class NativeWorldHit(val id:String,val distance:Double)

/** Render-thread writer, UI-thread acceptance reader. A result belongs to one
 * tap and one camera/scene/visibility epoch, even when an older query finishes. */
class NativePickGate {
    @Volatile private var version=0L
    fun invalidate(){version=Math.addExact(version,1)}
    fun issue():Long {invalidate();return version}
    fun accepts(ticket:Long)=ticket>0&&ticket==version
}

internal data class PickBox(val low:DoubleArray,val high:DoubleArray) {
    fun near(ray:NativePickRay,limit:Double):Double {
        var lo=0.0;var hi=limit
        for(axis in 0..2){val d=ray.direction[axis];val p=ray.origin[axis]
            if(d==0.0){if(p<low[axis]||p>high[axis])return Double.POSITIVE_INFINITY}
            else {var a=(low[axis]-p)/d;var b=(high[axis]-p)/d;if(a>b){val n=a;a=b;b=n};lo=max(lo,a);hi=min(hi,b);if(hi<lo)return Double.POSITIVE_INFINITY}}
        return lo
    }
    companion object {
        fun points(points:List<BlockPoint>)=PickBox(DoubleArray(3){a->points.minOf{it[a]}},DoubleArray(3){a->points.maxOf{it[a]}})
        fun merge(values:Array<PickBox>,indices:IntArray,from:Int,to:Int)=PickBox(DoubleArray(3){a->(from until to).minOf{values[indices[it]].low[a]}},DoubleArray(3){a->(from until to).maxOf{values[indices[it]].high[a]}})
    }
}

internal interface PickBounds {
    val size:Int
    fun low(index:Int,axis:Int):Double
    fun high(index:Int,axis:Int):Double
    fun near(index:Int,ray:NativePickRay,limit:Double):Double {
        var lo=0.0;var hi=limit
        for(axis in 0..2){val d=ray.direction[axis];val p=ray.origin[axis]
            if(d==0.0){if(p<low(index,axis)||p>high(index,axis))return Double.POSITIVE_INFINITY}
            else{var a=(low(index,axis)-p)/d;var b=(high(index,axis)-p)/d;if(a>b){val old=a;a=b;b=old};lo=max(lo,a);hi=min(hi,b);if(hi<lo)return Double.POSITIVE_INFINITY}}
        return lo
    }
}
private class InstancePickBounds(private val boxes:Array<PickBox>):PickBounds {
    override val size get()=boxes.size
    override fun low(index:Int,axis:Int)=boxes[index].low[axis]
    override fun high(index:Int,axis:Int)=boxes[index].high[axis]
    override fun near(index:Int,ray:NativePickRay,limit:Double)=boxes[index].near(ray,limit)
}
private class TrianglePickBounds(private val packed:FloatBuffer):PickBounds {
    override val size get()=packed.limit()/6
    override fun low(index:Int,axis:Int)=packed[index*6+axis].toDouble()
    override fun high(index:Int,axis:Int)=packed[index*6+axis+3].toDouble()
}

/** Two-level BVH: shared local triangles and world-space instance bounds. It
 * keeps positions, indices and inverse poses only, not textures/old scenes. */
internal class PickTree(private val boxes:PickBounds,cancelled:()->Boolean) {
    constructor(boxes:Array<PickBox>,cancelled:()->Boolean):this(InstancePickBounds(boxes),cancelled)
    private val order=IntArray(boxes.size){it}
    companion object {
        private fun nodes(n:Int):Int=if(n==0)0 else if(n<=8)1 else 1+nodes(n/2)+nodes(n-n/2)
        fun storageBytes(items:Int):Long=items*4L+nodes(items)*64L
    }
    private val capacity=nodes(boxes.size)
    private val low=DoubleArray(capacity*3);private val high=DoubleArray(capacity*3)
    private val starts=IntArray(capacity);private val ends=IntArray(capacity)
    private val left=IntArray(capacity){-1};private val right=IntArray(capacity){-1};private var used=0
    private var nodesSinceCheck=0
    private fun build(from:Int,to:Int,centres:DoubleArray?,cancelled:()->Boolean):Int {
        // Tiny leaf nodes vastly outnumber large partitions. Check a bounded
        // batch of nodes; large scans also poll below, so cancellation remains
        // responsive without a native Thread.isInterrupted call per leaf.
        if(nodesSinceCheck++ and 255==0)checkpoint(cancelled)
        val node=used++;starts[node]=from;ends[node]=to;val offset=node*3
        for(axis in 0..2){var lo=Double.POSITIVE_INFINITY;var hi=Double.NEGATIVE_INFINITY
            for(i in from until to){if((i-from) and 4095==0&&to-from>4096)checkpoint(cancelled);lo=min(lo,boxes.low(order[i],axis));hi=max(hi,boxes.high(order[i],axis))};low[offset+axis]=lo;high[offset+axis]=hi}
        if(to-from<=8)return node
        var axis=0;for(a in 1..2)if(high[offset+a]-low[offset+a]>high[offset+axis]-low[offset+axis])axis=a
        val mid=(from+to)/2
        // Partition compares each centre repeatedly. Mapped triangle bounds
        // are substantially dearer to read than this temporary scalar array.
        // Refill only this subtree, preserving the same Double sum/order.
        if(centres!=null)for(i in from until to){
            if((i-from)%1024==0&&to-from>=1024)checkpoint(cancelled)
            val index=order[i];centres[index]=boxes.low(index,axis)+boxes.high(index,axis)
        }
        fun center(index:Int)=centres?.get(index)?: (boxes.low(index,axis)+boxes.high(index,axis))
        var lo=from;var hi=to-1
        while(lo<hi){val pivot=center(order[(lo+hi)/2]);var i=lo;var j=hi
            while(i<=j){while(center(order[i])<pivot)i++;while(center(order[j])>pivot)j--;if(i<=j){val swap=order[i];order[i]=order[j];order[j]=swap;i++;j--}}
            if(mid<=j)hi=j else if(mid>=i)lo=i else break}
        left[node]=build(from,mid,centres,cancelled);right[node]=build(mid,to,centres,cancelled);return node
    }
    // At most 4 MiB of short-lived ART workspace. Larger inputs retain the
    // previous direct-reading path; the array is not retained by the index.
    private val root=run{checkpoint(cancelled);val result=if(boxes.size==0)-1 else build(0,boxes.size,if(boxes.size<=524288)DoubleArray(boxes.size)else null,cancelled);checkpoint(cancelled);result}
    private fun near(node:Int,ray:NativePickRay,limit:Double):Double {
        var lo=0.0;var hi=limit;val offset=node*3
        for(axis in 0..2){val d=ray.direction[axis];val p=ray.origin[axis]
            if(d==0.0){if(p<low[offset+axis]||p>high[offset+axis])return Double.POSITIVE_INFINITY}
            else {var a=(low[offset+axis]-p)/d;var b=(high[offset+axis]-p)/d;if(a>b){val old=a;a=b;b=old};lo=max(lo,a);hi=min(hi,b);if(hi<lo)return Double.POSITIVE_INFINITY}}
        return lo
    }
    fun visit(ray:NativePickRay,limit:Double,leaf:(Int,Double)->Double):Double {
        var visited=0
        fun walk(node:Int,before:Double):Double {
            if(visited++%128==0)checkpoint{false}
            if(node<0||near(node,ray,before)>before)return before
            if(left[node]<0){var result=before;for(i in starts[node] until ends[node])if(boxes.near(order[i],ray,result)<=result)result=leaf(order[i],result);return result}
            val a=left[node];val b=right[node]
            return if(near(a,ray,before)<=near(b,ray,before))walk(b,walk(a,before))else walk(a,walk(b,before))
        }
        return walk(root,limit)
    }
}

internal class PickGeometry(world:WorldPackets,geometry:Geometry,cancelled:()->Boolean) {
    private val vertices:FloatBuffer
    private val indices:IntBuffer
    private val tree:PickTree
    companion object {
        fun estimatedBytes(g:Geometry):Long=g.vertexCount*12L+g.indexCount*4L+(g.indexCount/3)*24L+PickTree.storageBytes(g.indexCount/3)+1024
    }
    init {
        val vertexBytes=geometry.vertexCount*12;val indexBytes=geometry.indexCount*4;val triangles=geometry.indexCount/3
        // Own compact geometry storage, rather than retaining an entire old
        // owner's packet through a slice when just one shared cube is reused.
        // Android may map this block outside ART's non-moving array heap.
        val storage=NativePacketBuffers.allocate(vertexBytes+indexBytes+triangles*24).order(ByteOrder.LITTLE_ENDIAN)
        val source=world.section(geometry.vertex)
        for(i in 0 until geometry.vertexCount){if(i%1024==0)checkpoint(cancelled);for(a in 0..2)storage.putFloat(source.getFloat(i*48+a*4))}
        val sourceIndices=world.section(geometry.index).asIntBuffer()
        while(sourceIndices.hasRemaining())storage.putInt(sourceIndices.get())
        fun section(at:Int,length:Int)=storage.duplicate().apply{position(at);limit(at+length)}.slice().order(ByteOrder.LITTLE_ENDIAN)
        vertices=section(0,vertexBytes).asFloatBuffer().asReadOnlyBuffer()
        indices=section(vertexBytes,indexBytes).asIntBuffer().asReadOnlyBuffer()
        // Vertices already arrive as float32. Keep exact triangle bounds in
        // one scalar array instead of a PickBox plus two arrays per triangle;
        // old and candidate terrain indices coexist during a scene swap.
        val packed=section(vertexBytes+indexBytes,triangles*24).asFloatBuffer()
        for(i in 0 until triangles){if(i%1024==0)checkpoint(cancelled)
            for(axis in 0..2){val a=vertices[indices[i*3]*3+axis];val b=vertices[indices[i*3+1]*3+axis];val c=vertices[indices[i*3+2]*3+axis]
                packed.put(i*6+axis,min(a,min(b,c)));packed.put(i*6+axis+3,max(a,max(b,c)))}}
        tree=PickTree(TrianglePickBounds(packed.asReadOnlyBuffer()),cancelled)
    }
    private fun point(index:Int)=BlockPoint(vertices[index*3].toDouble(),vertices[index*3+1].toDouble(),vertices[index*3+2].toDouble())
    fun hit(ray:NativePickRay,side:Int,limit:Double):Double=tree.visit(ray,limit){triangle,before->
        val a=point(indices[triangle*3]);val edge1=NativeWorldNavigation.sub(point(indices[triangle*3+1]),a);val edge2=NativeWorldNavigation.sub(point(indices[triangle*3+2]),a)
        val p=NativeWorldNavigation.cross(ray.direction,edge2);val determinant=NativeWorldNavigation.dot(edge1,p)
        if(determinant==0.0||side==0&&determinant<0||side==1&&determinant>0)before else {
            val inverse=1/determinant;val offset=NativeWorldNavigation.sub(ray.origin,a);val u=NativeWorldNavigation.dot(offset,p)*inverse
            if(u<0||u>1)before else {val q=NativeWorldNavigation.cross(offset,edge1);val v=NativeWorldNavigation.dot(ray.direction,q)*inverse
                if(v<0||u+v>1)before else {val distance=NativeWorldNavigation.dot(edge2,q)*inverse;if(distance>=0&&distance<before)distance else before}}
        }
    }
}

internal class PickInstance(val geometry:PickGeometry,val side:Int,m:DoubleArray,bounds:Bounds) {
    private val inverse:DoubleArray
    val box:PickBox
    init {
        val a=m[0];val b=m[4];val c=m[8];val d=m[1];val e=m[5];val f=m[9];val g=m[2];val h=m[6];val i=m[10]
        val determinant=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g)
        require(determinant.isFinite()&&abs(determinant)>1e-15){"Degenerate pick instance"}
        inverse=doubleArrayOf((e*i-f*h)/determinant,(c*h-b*i)/determinant,(b*f-c*e)/determinant,
            (f*g-d*i)/determinant,(a*i-c*g)/determinant,(c*d-a*f)/determinant,
            (d*h-e*g)/determinant,(b*g-a*h)/determinant,(a*e-b*d)/determinant,m[12],m[13],m[14])
        box=PickBox.points((0..7).map{mask->val x=if(mask and 1==0)bounds.min.x.toDouble()else bounds.max.x.toDouble();val y=if(mask and 2==0)bounds.min.y.toDouble()else bounds.max.y.toDouble();val z=if(mask and 4==0)bounds.min.z.toDouble()else bounds.max.z.toDouble()
            BlockPoint(m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14])})
    }
    fun writePacked(data:ByteBuffer,geometryId:Int){
        data.putInt(geometryId).putInt(side)
        inverse.forEach(data::putDouble);box.low.forEach(data::putDouble);box.high.forEach(data::putDouble)
    }
    fun hit(ray:NativePickRay,limit:Double)=pickTransformed(geometry,side,ray,limit){inverse[it]}
}

private const val PICK_INSTANCE_BYTES=152 // geometry/side + inverse(12 doubles) + bounds(6 doubles)
private fun pickTransformed(geometry:PickGeometry,side:Int,ray:NativePickRay,limit:Double,inverse:(Int)->Double):Double {
    fun transform(point:BlockPoint,position:Boolean):BlockPoint {
        val x=point.x-if(position)inverse(9)else 0.0;val y=point.y-if(position)inverse(10)else 0.0;val z=point.z-if(position)inverse(11)else 0.0
        return BlockPoint(inverse(0)*x+inverse(1)*y+inverse(2)*z,inverse(3)*x+inverse(4)*y+inverse(5)*z,inverse(6)*x+inverse(7)*y+inverse(8)*z)
    }
    // Keep t in original world-ray units, including non-uniform instance scale.
    return geometry.hit(NativePickRay(transform(ray.origin,true),transform(ray.direction,false)),side,limit)
}

internal class NativePickOwner private constructor(val identity:Long,val id:String,private val tree:PickTree,
    private val hitInstance:(Int,NativePickRay,Double)->Double) {
    internal constructor(identity:Long,id:String,instances:List<PickInstance>,cancelled:()->Boolean):this(identity,id,
        PickTree(instances.map{it.box}.toTypedArray(),cancelled),{i,ray,before->instances[i].hit(ray,before)})
    fun hit(ray:NativePickRay,limit:Double)=tree.visit(ray,limit){i,before->hitInstance(i,ray,before)}
    companion object {
        fun packed(identity:Long,id:String,data:ByteBuffer,geometries:Array<PickGeometry?>,indices:IntArray?,count:Int,cancelled:()->Boolean):NativePickOwner {
            fun row(index:Int)=(indices?.get(index)?:index)*PICK_INSTANCE_BYTES
            val bounds=object:PickBounds {
                override val size=count
                override fun low(index:Int,axis:Int)=data.getDouble(row(index)+104+axis*8)
                override fun high(index:Int,axis:Int)=data.getDouble(row(index)+128+axis*8)
            }
            return NativePickOwner(identity,id,PickTree(bounds,cancelled)){index,ray,before->
                val at=row(index);val geometry=checkNotNull(geometries[data.getInt(at)])
                pickTransformed(geometry,data.getInt(at+4),ray,before){data.getDouble(at+8+it*8)}
            }
        }
    }
}

class NativeWorldPickIndex internal constructor(owners:List<NativePickOwner>,val estimatedBytes:Long,occluders:List<NativePickOwner> = emptyList()) {
    private val owners=Collections.unmodifiableList(owners.toList())
    private val occluders=Collections.unmodifiableList(occluders.toList())
    val ids:List<String> = Collections.unmodifiableList(owners.map{it.id})
    fun pick(ray:NativePickRay):NativeWorldHit? {
        checkpoint{false}
        var id:String?=null;var closest=Double.POSITIVE_INFINITY
        for(owner in owners){val distance=owner.hit(ray,closest);if(distance<closest){id=owner.id;closest=distance}}
        return id?.let{NativeWorldHit(it,closest)}
    }
    fun occluded(ray:NativePickRay,distance:Double):Boolean {
        val limit=distance-.02;if(limit<=0)return false
        for(owner in occluders)if(owner.hit(ray,limit)<limit)return true
        return false
    }
    companion object {val EMPTY=NativeWorldPickIndex(emptyList(),0)}
}

/** Generation-thread cache, pruned to the current owners after a complete
 * prepare. Cancellation leaves the prior index available to the visible GPU. */
class NativeWorldPickCompiler {
    private class Owner(val identity:Long,val occlusion:Boolean,val target:NativePickOwner?,val opaque:NativePickOwner?)
    private data class PacketPlan(val packet:DrawPacket,val side:Int,val opaque:Boolean)
    private data class PickMaterial(val side:Int,val opaque:Boolean)
    private class OwnerPlan(val source:NativePacketSource,val selectable:Boolean,val packets:List<PacketPlan>){
        val count=packets.sumOf{it.packet.count}
        val opaqueCount=packets.filter{it.opaque}.sumOf{it.packet.count}
        val subset=opaqueCount in 1 until count
        fun bytes():Long=count*PICK_INSTANCE_BYTES.toLong()+2048+
            (if(selectable)PickTree.storageBytes(count)else 0)+
            (if(opaqueCount>0&&(!selectable||opaqueCount!=count))PickTree.storageBytes(opaqueCount)else 0)+
            (if(subset)opaqueCount*4L else 0)
    }
    private var owners=emptyMap<String,Owner>()
    private var geometries=emptyMap<String,PickGeometry>()
    private data class SourceIdentity(val owner:String,val upload:Long)
    private var previousSources:List<SourceIdentity>?=null
    private var previousOcclusion=false
    private var previousIndex:NativeWorldPickIndex?=null
    fun prepare(sources:List<NativePacketSource>,cancelled:()->Boolean={false})=prepare(sources,false,cancelled)
    fun prepare(sources:List<NativePacketSource>,withOcclusion:Boolean,cancelled:()->Boolean={false}):NativeWorldPickIndex {
        checkpoint(cancelled)
        fun target(source:NativePacketSource)=source.owner.startsWith("building:")||source.owner.startsWith("reward:")
        val selected=sources.filter{it.layer==NativePacketLayer.STATIC&&(target(it)||withOcclusion)}
        require(selected.map{it.owner}.distinct().size==selected.size&&selected.size<=4096)
        // Sources are immutable and upload identities are unique. Starting a
        // round often changes no static source, so even rebuilding material /
        // instance plans and their budget inventory is unnecessary. A fresh
        // empty interior has no geometry and is equivalent to the old empty
        // source; owner order and the occlusion contract still form the key.
        val identities=selected.map{SourceIdentity(it.owner,if(it.world==null)0 else it.uploadIdentity)}
        if(previousOcclusion==withOcclusion&&previousSources==identities){
            checkpoint(cancelled);return checkNotNull(previousIndex)
        }
        val plans=selected.map{source->
            val selectable=target(source);val world=source.world
            // Many spatial/LOD draws share the same material. Decode its
            // immutable metadata once per owner, not once per draw packet.
            val materials=arrayOfNulls<PickMaterial>(world?.materials?.size?:0)
            val packets=world?.packets?.mapNotNull{packet->
                if(packet.id%128==0)checkpoint(cancelled)
                val material=materials[packet.material]?:run{
                    val raw=JSONObject(world.materials[packet.material])
                    require(raw.optInt("billboard",0)==0){"Billboard picking requires a camera-dependent contract"}
                    PickMaterial(raw.getInt("side"),withOcclusion&&!(raw.getBoolean("transparent")&&raw.getDouble("opacity")<=.85))
                }.also{materials[packet.material]=it}
                if(selectable||material.opaque)PacketPlan(packet,material.side,material.opaque)else null
            }.orEmpty()
            OwnerPlan(source,selectable,packets)
        }
        var bytes=0L;val geometryKeys=hashSetOf<String>()
        for(plan in plans){checkpoint(cancelled);val source=plan.source;val w=source.world
            if(w!=null)for(id in plan.packets.map{it.packet.geometry}.distinct()){
                val g=w.geometries[id];if(geometryKeys.add(source.geometryKeys[id]))bytes+=PickGeometry.estimatedBytes(g)
            }
            bytes+=plan.bytes()
        }
        require(bytes<=128L*1024*1024){"World picking budget exceeded: $bytes bytes"}
        val nextGeometry=linkedMapOf<String,PickGeometry>();val nextOwners=linkedMapOf<String,Owner>()
        for(plan in plans){checkpoint(cancelled);val source=plan.source
            val world=source.world
            val localGeometry=arrayOfNulls<PickGeometry>(world?.geometries?.size?:0)
            if(world!=null)for(id in plan.packets.map{it.packet.geometry}.distinct()){
                val g=world.geometries[id];val key=source.geometryKeys[id]
                localGeometry[id]=nextGeometry.getOrPut(key){geometries[key]?:PickGeometry(world,g,cancelled)}
            }
            nextOwners[source.owner]=owners[source.owner]?.takeIf{it.identity==source.uploadIdentity&&it.occlusion==withOcclusion}?:run {
                val id=if(source.owner.startsWith("building:"))source.owner.removePrefix("building:")else source.owner
                if(plan.count==0)Owner(source.uploadIdentity,withOcclusion,
                    if(plan.selectable)NativePickOwner(source.uploadIdentity,id,emptyList(),cancelled)else null,null)
                else {
                    val data=NativePacketBuffers.allocate(plan.count*PICK_INSTANCE_BYTES).order(ByteOrder.LITTLE_ENDIAN)
                    val opaqueRows=if(plan.subset)IntArray(plan.opaqueCount)else null
                    var at=0;var blocked=0
                    for(p in plan.packets){val packet=p.packet;val rows=checkNotNull(world).section(packet.instances)
                    repeat(packet.count){n->if(n%128==0)checkpoint(cancelled);val matrix=DoubleArray(16){rows.getFloat(n*80+it*4).toDouble()}
                        val g=world.geometries[packet.geometry]
                        PickInstance(checkNotNull(localGeometry[packet.geometry]),p.side,matrix,g.bounds).writePacked(data,packet.geometry)
                        if(p.opaque){opaqueRows?.set(blocked,at);blocked++};at++
                    }}
                    check(at==plan.count&&blocked==plan.opaqueCount);data.flip()
                    val packed=data.asReadOnlyBuffer().order(ByteOrder.LITTLE_ENDIAN)
                    val targets=if(plan.selectable)NativePickOwner.packed(source.uploadIdentity,id,packed,localGeometry,null,at,cancelled)else null
                    val opaque=if(blocked==0)null else if(blocked==at&&targets!=null)targets
                        else NativePickOwner.packed(source.uploadIdentity,id,packed,localGeometry,opaqueRows,blocked,cancelled)
                    Owner(source.uploadIdentity,withOcclusion,targets,opaque)
                }
            }
        }
        checkpoint(cancelled);val result=NativeWorldPickIndex(nextOwners.values.mapNotNull{it.target},bytes,nextOwners.values.mapNotNull{it.opaque})
        owners=nextOwners;geometries=nextGeometry;previousSources=identities;previousOcclusion=withOcclusion;previousIndex=result;return result
    }
    fun clear(){owners=emptyMap();geometries=emptyMap();previousSources=null;previousIndex=null}
}

private fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("World picking superseded")}
