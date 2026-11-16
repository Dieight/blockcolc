package com.blockcolc.world

/** Geometry is prepared once on the generation worker. A tap copies only the
 * current visible matrix rows; intersection runs on the existing pick worker,
 * without sharing mutable agents or reading GPU resources there. */
class NativeAnimalPickTemplate(source:NativePacketSource) {
    private val geometry:List<PickGeometry>
    private val bounds:List<Bounds>
    private val sides:List<Int>
    init {
        NativeAnimalPackets.validate(source);val world=checkNotNull(source.world)
        val draws=(0..1).map{kind->world.packets.first{world.section(it.aux!!).getFloat(4)==kind.toFloat()}}
        geometry=draws.map{PickGeometry(world,world.geometries[it.geometry]){false}}
        bounds=draws.map{world.geometries[it.geometry].bounds}
        sides=draws.map{org.json.JSONObject(world.materials[it.material]).getInt("side")}
    }
    fun snapshot(rig:AnimalRig):NativeAnimalPickSnapshot {
        val ids=IntArray(rig.counts[0]+rig.counts[1]);val kinds=IntArray(ids.size);val matrices=FloatArray(ids.size*16)
        var at=0
        for(kind in 0..1)repeat(rig.counts[kind]){slot->ids[at]=rig.actorId(kind,slot);kinds[at]=kind
            repeat(16){matrices[at*16+it]=rig.value(kind,slot,it)};at++}
        return NativeAnimalPickSnapshot(geometry,bounds,sides,ids,kinds,matrices)
    }
}

data class NativeAnimalHit(val id:Int,val distance:Double)
class NativeAnimalPickSnapshot internal constructor(private val geometry:List<PickGeometry>,private val bounds:List<Bounds>,private val sides:List<Int>,
    private val ids:IntArray,private val kinds:IntArray,private val matrices:FloatArray){
    fun pick(ray:NativePickRay,occlusion:NativeWorldPickIndex):NativeAnimalHit? {
        var closest=Double.POSITIVE_INFINITY;var id=0
        for(i in ids.indices){
            if(i%64==0&&Thread.currentThread().isInterrupted)throw java.util.concurrent.CancellationException("Animal pick superseded")
            val kind=kinds[i];val instance=PickInstance(geometry[kind],sides[kind],DoubleArray(16){matrices[i*16+it].toDouble()},bounds[kind])
            if(instance.box.near(ray,closest)>closest)continue
            val distance=instance.hit(ray,closest);if(distance<closest){closest=distance;id=ids[i]}
        }
        return if(id==0||occlusion.occluded(ray,closest))null else NativeAnimalHit(id,closest)
    }
}
