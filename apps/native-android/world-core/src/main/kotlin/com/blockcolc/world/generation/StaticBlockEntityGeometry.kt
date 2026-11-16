package com.blockcolc.world.generation

import kotlin.math.*

/** Static fallback primitives adapted from Three.js Box/Cylinder/PolyhedronGeometry
 * (MIT). These are the existing approximate displays, not Minecraft item models. */
object StaticBlockEntityGeometry {
    enum class Mounting { STANDING,WALL,HANGING,WALL_HANGING }
    data class Board(val width:Double,val height:Double,val y:Double,val z:Double)
    fun board(mounting:Mounting):Board {
        val hanging=mounting==Mounting.HANGING||mounting==Mounting.WALL_HANGING
        val wall=mounting==Mounting.WALL||mounting==Mounting.WALL_HANGING
        return Board(if(hanging).9 else .875,if(hanging).4 else if(wall).5 else .375,if(hanging)-.06 else if(wall)0.0 else .14,if(wall)-.42 else 0.0)
    }
    private data class Part(val size:BlockPoint,val position:BlockPoint,val yaw:Double=0.0)
    private fun boxes(parts:List<Part>):BlockGeometry {
        val positions=ArrayList<Float>();val normals=ArrayList<Float>();val uv=ArrayList<Float>()
        for(part in parts){val g=CuboidGeometry.create(part.size.x,part.size.y,part.size.z);val p=g.positions();val n=g.normals();val t=g.textureCoordinates()!!
            val rotation=BlockTransform.rotationY(part.yaw);val transform=BlockTransform.translation(part.position.x,part.position.y,part.position.z)*rotation
            repeat(g.vertexCount){
                val v=transform.point(BlockPoint(p.get().toDouble(),p.get().toDouble(),p.get().toDouble()))
                val normal=rotation.point(BlockPoint(n.get().toDouble(),n.get().toDouble(),n.get().toDouble()))
                positions.addAll(listOf(v.x.toFloat(),v.y.toFloat(),v.z.toFloat()));normals.addAll(listOf(normal.x.toFloat(),normal.y.toFloat(),normal.z.toFloat()));uv.add(t.get());uv.add(t.get())
            }
        }
        return AttributeBlockGeometry(positions.toFloatArray(),normals.toFloatArray(),uv.toFloatArray())
    }
    fun sign(mounting:Mounting):BlockGeometry {
        val b=board(mounting);val parts=arrayListOf(Part(BlockPoint(b.width,b.height,.07),BlockPoint(0.0,b.y,b.z)))
        when(mounting){
            Mounting.STANDING->parts+=Part(BlockPoint(.065,.62,.065),BlockPoint(0.0,-.19,0.0))
            Mounting.WALL->parts+=Part(BlockPoint(.1,.12,.12),BlockPoint(0.0,0.0,b.z-.08))
            Mounting.HANGING->{for(x in listOf(-.25,.25))parts+=Part(BlockPoint(.035,.31,.035),BlockPoint(x,.325,0.0));parts+=Part(BlockPoint(.56,.035,.035),BlockPoint(0.0,.475,0.0))}
            Mounting.WALL_HANGING->{for(x in listOf(-.25,.25))parts+=Part(BlockPoint(.035,.035,.24),BlockPoint(x,.16,b.z-.075));parts+=Part(BlockPoint(.56,.04,.04),BlockPoint(0.0,.25,b.z-.19))}
        }
        return boxes(parts)
    }
    fun signFace(mounting:Mounting,back:Boolean):BlockGeometry {
        val b=board(mounting);val direction=if(back)-1 else 1;val z=b.z+direction*(.07/2+.003)
        val p=floatArrayOf((-b.width/2*direction).toFloat(),(b.y-b.height/2).toFloat(),z.toFloat(),
            (b.width/2*direction).toFloat(),(b.y-b.height/2).toFloat(),z.toFloat(),
            (b.width/2*direction).toFloat(),(b.y+b.height/2).toFloat(),z.toFloat(),
            (-b.width/2*direction).toFloat(),(b.y+b.height/2).toFloat(),z.toFloat())
        val normal=FloatArray(12){if(it%3==2)direction.toFloat()else 0f}
        // Each face owns one tile rather than invalidating a shared 64-cell atlas.
        val l=2f/128;val r=1-l;val bottom=2f/64;val top=1-bottom
        return AttributeBlockGeometry(p,normal,floatArrayOf(l,bottom,r,bottom,r,top,l,top),index=intArrayOf(0,1,2,0,2,3))
    }
    fun campfireLogs():BlockGeometry=boxes(listOf(-PI/4,PI/4).reversed().map{Part(BlockPoint(.86,.12,.15),BlockPoint(0.0,-.365,0.0),it)})
    fun coals():BlockGeometry=cylinder(.22,.24,.075,8)
    fun fire():BlockGeometry=cylinder(0.0,.17,.25,5)
    private fun cylinder(top:Double,bottom:Double,height:Double,segments:Int):BlockGeometry {
        val p=ArrayList<Float>();val n=ArrayList<Float>();val uv=ArrayList<Float>();val indices=ArrayList<Int>()
        fun vertex(x:Double,y:Double,z:Double,nx:Double,ny:Double,nz:Double,u:Double,v:Double){p.addAll(listOf(x.toFloat(),y.toFloat(),z.toFloat()));n.addAll(listOf(nx.toFloat(),ny.toFloat(),nz.toFloat()));uv.add(u.toFloat());uv.add(v.toFloat())}
        val slope=(bottom-top)/height;val length=sqrt(1+slope*slope)
        for(y in 0..1){val radius=if(y==0)top else bottom
            for(x in 0..segments){val u=x.toDouble()/segments;val a=u*PI*2;vertex(radius*sin(a),-y*height+height/2,radius*cos(a),sin(a)/length,slope/length,cos(a)/length,u,1.0-y)}
        }
        for(x in 0 until segments){val a=x;val b=x+segments+1;val c=b+1;val d=a+1
            if(top>0)indices.addAll(listOf(a,b,d));if(bottom>0)indices.addAll(listOf(b,c,d))}
        for(isTop in listOf(true,false)){val radius=if(isTop)top else bottom;if(radius<=0)continue
            val sign=if(isTop)1.0 else -1.0;val start=p.size/3
            repeat(segments){vertex(0.0,height/2*sign,0.0,0.0,sign,0.0,.5,.5)}
            val edge=p.size/3
            for(x in 0..segments){val a=x.toDouble()/segments*PI*2;vertex(radius*sin(a),height/2*sign,radius*cos(a),0.0,sign,0.0,cos(a)*.5+.5,sin(a)*.5*sign+.5)}
            for(x in 0 until segments){val i=edge+x;val c=start+x;indices.addAll(if(isTop)listOf(i,i+1,c)else listOf(i+1,i,c))}
        }
        return AttributeBlockGeometry(p.toFloatArray(),n.toFloatArray(),uv.toFloatArray(),index=indices.toIntArray())
    }
    fun itemToken():BlockGeometry {
        val points=listOf(BlockPoint(.5,0.0,0.0),BlockPoint(-.5,0.0,0.0),BlockPoint(0.0,.5,0.0),BlockPoint(0.0,-.5,0.0),BlockPoint(0.0,0.0,.5),BlockPoint(0.0,0.0,-.5))
        val source=intArrayOf(0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2)
        val p=FloatArray(72);val normal=FloatArray(72);val uv=DoubleArray(48)
        for(face in 0..7){val vertices=listOf(points[source[face*3+1]],points[source[face*3+2]],points[source[face*3]])
            val a=vertices[0];val b=vertices[1];val c=vertices[2];val nx=(c.y-b.y)*(a.z-b.z)-(c.z-b.z)*(a.y-b.y);val ny=(c.z-b.z)*(a.x-b.x)-(c.x-b.x)*(a.z-b.z);val nz=(c.x-b.x)*(a.y-b.y)-(c.y-b.y)*(a.x-b.x);val length=sqrt(nx*nx+ny*ny+nz*nz)
            val azimuth=atan2((a.z+b.z+c.z)/3,-(a.x+b.x+c.x)/3)
            for((i,v)in vertices.withIndex()){val at=face*9+i*3;p[at]=v.x.toFloat();p[at+1]=v.y.toFloat();p[at+2]=v.z.toFloat();normal[at]=(nx/length).toFloat();normal[at+1]=(ny/length).toFloat();normal[at+2]=(nz/length).toFloat()
                var u=atan2(v.z,-v.x)/2/PI+.5;if(azimuth<0&&u==1.0)u-=1;if(v.x==0.0&&v.z==0.0)u=azimuth/2/PI+.5
                uv[face*6+i*2]=u;uv[face*6+i*2+1]=1-(atan2(-v.y,sqrt(v.x*v.x+v.z*v.z))/PI+.5)
            }
            val values=(0..2).map{uv[face*6+it*2]};if(values.max()>.9&&values.min()<.1)for(i in 0..2)if(uv[face*6+i*2]<.2)uv[face*6+i*2]+=1
        }
        return AttributeBlockGeometry(p,normal,uv.map{it.toFloat()}.toFloatArray())
    }
}
