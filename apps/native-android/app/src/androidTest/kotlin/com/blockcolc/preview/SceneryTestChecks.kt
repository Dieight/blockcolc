package com.blockcolc.preview

import com.blockcolc.world.generation.*
import org.json.JSONObject
import org.junit.Assert.*
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.IdentityHashMap

/** The same source-specified binary digest as the JVM oracle. Test code only;
 * no generation fixtures or input-specific expected models ship in the app. */
internal object SceneryTestChecks {
    private fun ByteArray.hex()=joinToString(""){"%02x".format(it.toInt() and 255)}
    fun voxels(voxels:List<RenderVoxel>):String {
        val hash=MessageDigest.getInstance("SHA-256");val b=ByteBuffer.allocate(28).order(ByteOrder.LITTLE_ENDIAN)
        fun int(n:Int){b.clear();b.putInt(n);hash.update(b.array(),0,4)}
        fun text(s:String){val bytes=s.toByteArray(Charsets.UTF_8);int(bytes.size);hash.update(bytes)}
        fun zero(n:Double)=if(n==0.0)0.0 else n
        for(v in voxels) {
            b.clear();b.putDouble(zero(v.x)).putDouble(zero(v.y)).putDouble(zero(v.z)).putInt(v.buildOrder);hash.update(b.array())
            text(v.materialId);text(v.sourceBlockId!!);val state=v.sourceBlockState?.toSortedMap();int(state?.size?:-1)
            for((key,value)in state.orEmpty()){text(key);text(value)}
        }
        return hash.digest().hex()
    }
    fun distant(blocks:SceneryBlockSet):String {
        val refs=IdentityHashMap<RenderVoxel,Int>();blocks.voxels.forEachIndexed{i,v->refs[v]=i}
        val b=ByteBuffer.allocate(blocks.distantVoxels.size*4).order(ByteOrder.LITTLE_ENDIAN)
        for(v in blocks.distantVoxels){assertTrue(refs.containsKey(v));b.putInt(refs.getValue(v))}
        return MessageDigest.getInstance("SHA-256").digest(b.array()).hex()
    }
    fun source(c:JSONObject,scene:WorldScenery) {
        val label=c.getString("name")
        if(c.isNull("village"))assertNull(scene.village)else {
            val e=c.getJSONObject("village");val v=scene.village!!
            assertEquals(label,e.getDouble("x"),v.x,0.0);assertEquals(label,e.getDouble("z"),v.z,0.0)
            assertEquals(label,e.getDouble("width"),v.width,0.0);assertEquals(label,e.getDouble("depth"),v.depth,0.0)
        }
        val objects=c.getJSONArray("objects");assertEquals(label,objects.length(),scene.objects.size)
        for((i,o)in scene.objects.withIndex()) {
            val e=objects.getJSONObject(i);val name="$label ${e.getString("id")}"
            assertEquals(name,e.getString("id"),o.id);assertEquals(name,e.getString("role"),o.role.wireValue)
            assertEquals(name,e.getDouble("x"),o.x,0.0);assertEquals(name,e.getDouble("y"),o.y,0.0);assertEquals(name,e.getDouble("z"),o.z,0.0)
            assertEquals(name,e.getDouble("width"),o.width,0.0);assertEquals(name,e.getDouble("depth"),o.depth,0.0)
            assertEquals(name,e.getInt("count"),o.blocks.voxels.size);assertEquals(name,e.getInt("distantCount"),o.blocks.distantVoxels.size)
            assertEquals(name,e.getString("voxels"),voxels(o.blocks.voxels));assertEquals(name,e.getString("distant"),distant(o.blocks))
        }
    }
}
