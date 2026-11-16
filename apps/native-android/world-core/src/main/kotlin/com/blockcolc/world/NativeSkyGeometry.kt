package com.blockcolc.world

import com.blockcolc.world.generation.AttributeBlockGeometry
import com.blockcolc.world.generation.BlockGeometry
import kotlin.math.*

/** SphereGeometry(120,24,12) / PlaneGeometry(1,1), adapted from Three.js
 * (MIT). Dome RGB stores horizon/zenith/lower interpolation weights; the
 * original per-vertex gradient is evaluated with current uniform colours. */
object NativeSkyGeometry {
    fun dome():BlockGeometry {
        val positions=ArrayList<Float>();val normals=ArrayList<Float>();val uvs=ArrayList<Float>();val weights=ArrayList<Float>();val indices=ArrayList<Int>()
        for(y in 0..12){val v=y/12.0;val offset=if(y==0).5/24 else if(y==12)-.5/24 else 0.0
            for(x in 0..24){val u=x/24.0;val px=-NativeSky.RADIUS*cos(u*PI*2)*sin(v*PI);val py=NativeSky.RADIUS*cos(v*PI);val pz=NativeSky.RADIUS*sin(u*PI*2)*sin(v*PI)
                val inverse=1/sqrt(px*px+py*py+pz*pz);positions+=listOf(px.toFloat(),py.toFloat(),pz.toFloat());normals+=listOf((px*inverse).toFloat(),(py*inverse).toFloat(),(pz*inverse).toFloat());uvs+=listOf((u+offset).toFloat(),(1-v).toFloat())
                val h=py.toFloat().toDouble()/NativeSky.RADIUS;val t=(if(h>=0)h/.82 else(h+.72)/.72).coerceIn(0.0,1.0);val smooth=t*t*(3-2*t)
                weights+=if(h>=0)listOf((1-smooth).toFloat(),smooth.toFloat(),0f)else listOf(smooth.toFloat(),0f,(1-smooth).toFloat())
            }
        }
        for(y in 0 until 12)for(x in 0 until 24){val a=y*25+x+1;val b=y*25+x;val c=(y+1)*25+x;val d=c+1
            if(y!=0)indices+=listOf(a,b,d);if(y!=11)indices+=listOf(b,c,d)
        }
        return AttributeBlockGeometry(positions.toFloatArray(),normals.toFloatArray(),uvs.toFloatArray(),weights.toFloatArray(),indices.toIntArray())
    }
    fun celestial():BlockGeometry=AttributeBlockGeometry(floatArrayOf(-.5f,.5f,0f,.5f,.5f,0f,-.5f,-.5f,0f,.5f,-.5f,0f),
        floatArrayOf(0f,0f,1f,0f,0f,1f,0f,0f,1f,0f,0f,1f),floatArrayOf(0f,1f,1f,1f,0f,0f,1f,0f),index=intArrayOf(0,2,1,2,3,1))
}
