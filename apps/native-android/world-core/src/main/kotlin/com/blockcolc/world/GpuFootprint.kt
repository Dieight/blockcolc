package com.blockcolc.world

import org.json.JSONObject

/** Explicit resource bounds, not a claim about total driver or process PSS.
 * Accounts for the actual native vertex stride and complete texture mip chain. */
data class GpuFootprint(val geometryBytes:Long,val instanceBytes:Long,val textureBytes:Long) {
    init {
        require(geometryBytes in 0..256L*1024*1024){"Native geometry budget"}
        require(instanceBytes in 0..64L*1024*1024){"Native instance budget"}
        require(textureBytes in 0..128L*1024*1024){"Native texture budget"}
    }
    fun json()=JSONObject().put("geometryBytes",geometryBytes).put("instanceBytes",instanceBytes).put("textureBytes",textureBytes)
        .put("scope","Input GPU estimate; excludes materials, render targets, driver and process memory; staged owner overlap may temporarily add its bounded subset")
    companion object {
        fun mipBytes(width:Int,height:Int):Long {
            require(width in 1..8192&&height in 1..8192&&width.toLong()*height<=32*1024*1024)
            var w=width;var h=height;var bytes=0L
            while(true){bytes+=w.toLong()*h*4;if(w==1&&h==1)return bytes;w=(w/2).coerceAtLeast(1);h=(h/2).coerceAtLeast(1)}
        }
        fun read(world:WorldPackets,metadata:JSONObject):GpuFootprint {
            val textures=metadata.getJSONArray("textures");val images=mutableSetOf<String>();var textureBytes=0L
            fun charge(id:Int){
                require(id in 0 until textures.length());val t=textures.getJSONObject(id);val encoding=t.optString("encoding","png")
                require(encoding in setOf("png","r32f-le"))
                val key=encoding+":"+t.getString("image")+":"+t.getString("colorSpace")+":"+t.optString("animationIdentity")+":"+t.optString("animationRole")
                if(images.add(key))textureBytes+=if(encoding=="r32f-le"){
                    val w=t.getInt("width");val h=t.getInt("height");require(w in 1..512&&h in 1..512);w.toLong()*h*4
                }else mipBytes(t.getInt("width"),t.getInt("height"))
            }
            for(material in world.packets.map{it.material}.distinct()){
                val m=JSONObject(world.materials[material])
                if(m.isNull("texture")){if(images.add("white"))textureBytes+=4}else charge(m.getInt("texture"))
                m.optJSONObject("recipe")?.getJSONObject("uniforms")?.let{u->for(key in u.keys()){
                    val ref=u.optJSONObject(key);if(ref?.has("texture")==true)charge(ref.getInt("texture"))
                }}
            }
            return GpuFootprint(world.geometries.sumOf{it.gpuBytes},world.packets.sumOf{it.count*96L}+32,textureBytes)
        }
    }
}
