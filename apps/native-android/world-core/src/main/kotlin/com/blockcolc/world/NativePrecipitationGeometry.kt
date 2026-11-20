package com.blockcolc.world

import com.blockcolc.world.generation.AttributeBlockGeometry
import com.blockcolc.world.generation.BlockGeometry
import com.blockcolc.world.generation.CuboidGeometry
import kotlin.math.*

/** Four-sided rain cylinder follows Three.js CylinderGeometry (MIT), including
 * cap vertices/UVs. Snow shares the existing one-segment cuboid recipe. */
object NativePrecipitationGeometry {
    fun paper(snow:Boolean,intensity:Double):BlockGeometry {
        require(intensity.isFinite()&&intensity in 0.0..1.0)
        if(snow)return CuboidGeometry.create(.48,.17,.48)
        val width=(.1+intensity*.03).toFloat()
        val top=(1.22+intensity*.4).toFloat()
        val lean=top*.21f
        // Two thin strips share the same slant. One stays visible as the
        // orthographic camera turns past the other strip's edge.
        val position=floatArrayOf(
            -width,-top,0f,width,-top,0f, lean-width,top,0f,lean+width,top,0f,
            0f,-top,-width,0f,-top,width,lean,top,-width,lean,top,width)
        val normals=floatArrayOf(0f,0f,1f,0f,0f,1f,0f,0f,1f,0f,0f,1f,
            1f,0f,0f,1f,0f,0f,1f,0f,0f,1f,0f,0f)
        return AttributeBlockGeometry(position,normals,index=intArrayOf(0,1,2,1,3,2,4,5,6,5,7,6))
    }

    fun create(snow:Boolean,visualIntensity:Double):BlockGeometry {
        require(visualIntensity.isFinite()&&visualIntensity in 0.0..1.0)
        if(snow)return CuboidGeometry.create(.36,.22,.36)
        val bottom=.022+visualIntensity*.013;val top=bottom*.32;val height=1.02+visualIntensity*.96;val half=height/2
        val positions=ArrayList<Float>();val normals=ArrayList<Float>();val uv=ArrayList<Float>();val indices=ArrayList<Int>()
        fun vertex(x:Double,y:Double,z:Double,nx:Double,ny:Double,nz:Double,u:Double,v:Double){positions+=x.toFloat();positions+=y.toFloat();positions+=z.toFloat();normals+=nx.toFloat();normals+=ny.toFloat();normals+=nz.toFloat();uv+=u.toFloat();uv+=v.toFloat()}
        val slope=(bottom-top)/height
        for(y in 0..1){val v=y.toDouble();val radius=v*(bottom-top)+top
            for(x in 0..4){val u=x/4.0;val theta=u*PI*2;val s=sin(theta);val c=cos(theta);val inverse=1/sqrt(s*s+slope*slope+c*c)
                vertex(radius*s,-v*height+half,radius*c,s*inverse,slope*inverse,c*inverse,u,1-v)}
        }
        for(x in 0..3){val a=x;val b=x+5;val c=x+6;val d=x+1;indices+=listOf(a,b,d,b,c,d)}
        for(sign in listOf(1,-1)){val radius=if(sign==1)top else bottom;val center=positions.size/3
            repeat(4){vertex(0.0,half*sign,0.0,0.0,sign.toDouble(),0.0,.5,.5)}
            val edge=positions.size/3
            for(x in 0..4){val theta=x/4.0*PI*2;val c=cos(theta);val s=sin(theta)
                vertex(radius*s,half*sign,radius*c,0.0,sign.toDouble(),0.0,c*.5+.5,s*.5*sign+.5)}
            for(x in 0..3)indices+=if(sign==1)listOf(edge+x,edge+x+1,center+x)else listOf(edge+x+1,edge+x,center+x)
        }
        return AttributeBlockGeometry(positions.toFloatArray(),normals.toFloatArray(),uv.toFloatArray(),index=indices.toIntArray())
    }
}
