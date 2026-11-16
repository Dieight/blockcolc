package com.blockcolc.world.generation

import java.util.Collections
import java.util.Locale
import kotlin.math.PI
import kotlin.math.pow
import kotlin.math.sqrt

/** Self-authored flowers/crops, evaluated natively rather than treating small
 * crossed plants as opaque full cubes. Pack models retain routing priority. */
object OriginalFlowers {
    val colors:Map<String,Int> = Collections.unmodifiableMap(linkedMapOf(
        "allium" to 0xb46bcc,"azure_bluet" to 0xe3d5d0,"blue_orchid" to 0x568cb7,"cornflower" to 0x477dbb,"dandelion" to 0xe5c947,
        "lily_of_the_valley" to 0xe8e8d8,"orange_tulip" to 0xe07838,"oxeye_daisy" to 0xe4ded2,"pink_tulip" to 0xd77c9a,"poppy" to 0xc84a43,
        "red_tulip" to 0xc54a47,"torchflower" to 0xe27d3e,"white_tulip" to 0xe2d8cd,"wither_rose" to 0x382b37))
    val naturalIds:List<String> = Collections.unmodifiableList(listOf("minecraft:poppy","minecraft:dandelion","minecraft:azure_bluet","minecraft:oxeye_daisy"))
    fun naturalId(variant:Double):String {
        require(variant.isFinite());val index=kotlin.math.truncate(variant)%4;return naturalIds[((index+4)%4).toInt()]
    }
    fun key(voxel:RenderVoxel):String? {
        val id=voxel.sourceBlockId?.lowercase(Locale.ROOT)?.removePrefix("minecraft:")?:return null
        return when{ id=="wheat"->"wheat:${age(voxel)}";id in colors->id;else->null }
    }
    fun age(voxel:RenderVoxel):Int {
        val number=OriginalBlockDetails.number(voxel.sourceBlockState?.get("age")?:"7")
        return if(number.isFinite()&&number%1==0.0&&number>=0&&number<=7)number.toInt()else 7
    }
    private fun linear(color:Int)=DoubleArray(3){i->val c=((color shr((2-i)*8))and 255)/255.0;if(c<.04045)c*.0773993808 else (c*.9478672986+.0521327014).pow(2.4)}
    fun geometry(key:String):BlockGeometry {
        val crop=key.startsWith("wheat:");val age=if(crop)key.substring(6).toInt().also{require(it in 0..7)}else 0
        require(crop||key in colors)
        val position=FloatAttributeBuilder(18*108);val color=FloatAttributeBuilder(18*108)
        fun box(w:Double,h:Double,d:Double,x:Double,y:Double,z:Double,rgb:Int,rotationY:Double=0.0,rotationZ:Double=0.0) {
            val mesh=CuboidGeometry.create(w,h,d);val p=mesh.positions();val c=linear(rgb)
            val transform=(BlockTransform.rotationZ(rotationZ)*BlockTransform.rotationY(rotationY)).withPosition(x,y,z)
            repeat(mesh.vertexCount){
                val a=p.get().toDouble();val b=p.get().toDouble();val v=p.get().toDouble()
                // Flowers use applyMatrix4, crops add the translation directly.
                // Preserve their separate Float32 rounding points.
                val point=if(crop)BlockPoint(a+x,b+y,v+z)else transform.point(BlockPoint(a,b,v))
                position.add(point.x);position.add(point.y);position.add(point.z)
                for(channel in c)color.add(channel)
            }
        }
        if(crop) {
            val height=.18+age/7.0*.68
            for(x in listOf(-.24,0.0,.24))for(z in listOf(-.21,.21)) {
                box(.045,height,.045,x,-.48+height/2,z,if(age>=6)0xa99448 else 0x62853e)
                if(age>=5){box(.09,.18,.07,x,-.52+height,z,if(age==7)0xd7b65a else 0x9cab46);box(.16,.05,.035,x,-.62+height,z,if(age==7)0xc9a24d else 0x9cab46)}
            }
        }else {
            box(.075,.58,.075,0.0,-.16,0.0,0x527b43)
            box(.26,.065,.12,-.1,-.25,0.0,0x668b4c,rotationZ=-.24)
            box(.26,.065,.12,.1,-.09,0.0,0x668b4c,rotationZ=.24)
            box(.42,.43,.035,0.0,.19,0.0,colors.getValue(key),rotationZ=.03)
            box(.42,.43,.035,0.0,.19,0.0,colors.getValue(key),rotationY=PI/2,rotationZ=-.03)
        }
        val vertices=position.freeze();val normal=FloatArray(vertices.size)
        // Same non-indexed normal construction as Three.js (MIT): cross on
        // uploaded positions, narrow the unnormalized result, then normalize.
        for(i in vertices.indices step 9) {
            val cb=DoubleArray(3){vertices[i+6+it].toDouble()-vertices[i+3+it].toDouble()}
            val ab=DoubleArray(3){vertices[i+it].toDouble()-vertices[i+3+it].toDouble()}
            val n=floatArrayOf((cb[1]*ab[2]-cb[2]*ab[1]).toFloat(),(cb[2]*ab[0]-cb[0]*ab[2]).toFloat(),(cb[0]*ab[1]-cb[1]*ab[0]).toFloat())
            val length=sqrt(n[0].toDouble()*n[0]+n[1].toDouble()*n[1]+n[2].toDouble()*n[2]);val inverse=1/(if(length==0.0)1.0 else length)
            for(v in 0..2)for(axis in 0..2)normal[i+v*3+axis]=(n[axis].toDouble()*inverse).toFloat()
        }
        return AttributeBlockGeometry(vertices,normal,color=color.freeze())
    }
}
