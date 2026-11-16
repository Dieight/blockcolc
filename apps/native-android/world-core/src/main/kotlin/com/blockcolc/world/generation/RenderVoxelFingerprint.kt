package com.blockcolc.world.generation

import java.io.BufferedOutputStream
import java.io.DataOutputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.concurrent.CancellationException

/** Complete, ordered voxel identity without a second JSON tree or a large
 * canonical string. Lengths and null markers make adjacent fields unambiguous. */
internal object RenderVoxelFingerprint {
    fun key(voxels:List<RenderVoxel>,cancelled:()->Boolean):String {
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Voxel fingerprint superseded")}
        checkpoint()
        val digest=MessageDigest.getInstance("SHA-256")
        val sink=object:OutputStream(){
            override fun write(value:Int){digest.update(value.toByte())}
            override fun write(bytes:ByteArray,offset:Int,length:Int){digest.update(bytes,offset,length)}
        }
        val output=DataOutputStream(BufferedOutputStream(sink,8192))
        // Block/state names repeat heavily in reefs and forests. This scratch
        // dictionary is bounded and dies with the hash; it retains no scene.
        val strings=HashMap<String,ByteArray>();var stringBytes=0
        fun text(value:String?){
            if(value==null){output.writeInt(-1);return}
            val bytes=strings[value]?:value.toByteArray(Charsets.UTF_8).also{
                if(strings.size<1024&&stringBytes+it.size<=65536){strings[value]=it;stringBytes+=it.size}
            }
            output.writeInt(bytes.size);output.write(bytes)
        }
        fun properties(value:Map<String,String>?){
            if(value==null){output.writeInt(-1);return}
            output.writeInt(value.size)
            for(key in value.keys.sorted()){text(key);text(value.getValue(key))}
        }
        fun face(value:SignFace){
            output.writeInt(value.lines.size);value.lines.forEach(::text)
            text(value.dyeColor);output.writeBoolean(value.glowing)
        }
        output.writeInt(1);output.writeInt(voxels.size)
        for((i,v)in voxels.withIndex()){
            if(i%256==0)checkpoint()
            output.writeDouble(v.x);output.writeDouble(v.y);output.writeDouble(v.z)
            text(v.materialId);output.writeInt(v.buildOrder);text(v.sourceBlockId);properties(v.sourceBlockState)
            output.writeBoolean(v.movingPistonMovedState!=null)
            v.movingPistonMovedState?.let{text(it.blockId);properties(it.properties)}
            output.writeBoolean(v.movingPistonPose!=null)
            v.movingPistonPose?.let{text(it.facing.key);output.writeDouble(it.progress);output.writeBoolean(it.extending);output.writeBoolean(it.source)}
            output.writeBoolean(v.sign!=null);v.sign?.let{face(it.front);face(it.back)}
            val items=v.campfire;output.writeInt(items?.size?:-1)
            items?.forEach{output.writeInt(it.slot);text(it.itemId);output.writeInt(it.count)}
            text(v.emissiveKind);output.writeBoolean(v.emissiveLevel!=null);v.emissiveLevel?.let(output::writeInt)
        }
        checkpoint();output.flush()
        return digest.digest().joinToString(""){"%02x".format(it.toInt()and 255)}
    }
}
