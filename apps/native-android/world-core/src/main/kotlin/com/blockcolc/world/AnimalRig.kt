package com.blockcolc.world

import java.nio.ByteBuffer
import kotlin.math.*

/** Original source cuboid rig, written into reusable six-texel rows. No
 * Object3D per bone and no per-frame geometry or texture allocation. */
class AnimalRig(private val paper:Boolean=false) {
    companion object {val capacities=listOf(1536,64,32,32)}
    private val rows=capacities.mapIndexed{kind,capacity->FloatArray(capacity*24).apply{for(i in 0 until capacity){this[i*24]=1f;this[i*24+5]=1f;this[i*24+10]=1f;this[i*24+15]=1f;this[i*24+20]=i.toFloat();this[i*24+21]=kind.toFloat()}}}
    private val previous=IntArray(4);val counts=IntArray(4)
    private val ids=capacities.map{IntArray(it)}
    private val base=DoubleArray(16);private val head=DoubleArray(16);private val local=DoubleArray(16);private val product=DoubleArray(16)
    private val colorCache=mutableMapOf<Int,FloatArray>()
    private val colors=mapOf("sheep" to 0xe6dfc9,"cow" to 0x615047,"pig" to 0xe1a09a,"horse" to 0x986d4c,
        "silverfish" to 0x9bbcb5,"salmon" to 0xbe6d58,"tropicalfish" to 0xe1a245,"gull" to 0xf0e9d3,"swallow" to 0x424b59,"finch" to 0xb8965a)
    private fun compose(out:DoubleArray,x:Double,y:Double,z:Double,sx:Double=1.0,sy:Double=1.0,sz:Double=1.0,rx:Double=0.0,ry:Double=0.0,rz:Double=0.0){
        val c1=cos(rx/2);val c2=cos(ry/2);val c3=cos(rz/2);val s1=sin(rx/2);val s2=sin(ry/2);val s3=sin(rz/2)
        val qx=s1*c2*c3+c1*s2*s3;val qy=c1*s2*c3-s1*c2*s3;val qz=c1*c2*s3+s1*s2*c3;val qw=c1*c2*c3-s1*s2*s3
        val x2=qx+qx;val y2=qy+qy;val z2=qz+qz;val xx=qx*x2;val xy=qx*y2;val xz=qx*z2;val yy=qy*y2;val yz=qy*z2;val zz=qz*z2;val wx=qw*x2;val wy=qw*y2;val wz=qw*z2
        out[0]=(1-(yy+zz))*sx;out[1]=(xy+wz)*sx;out[2]=(xz-wy)*sx;out[3]=0.0
        out[4]=(xy-wz)*sy;out[5]=(1-(xx+zz))*sy;out[6]=(yz+wx)*sy;out[7]=0.0
        out[8]=(xz+wy)*sz;out[9]=(yz-wx)*sz;out[10]=(1-(xx+yy))*sz;out[11]=0.0
        out[12]=x;out[13]=y;out[14]=z;out[15]=1.0
    }
    private fun multiply(a:DoubleArray,b:DoubleArray,out:DoubleArray){
        for(c in 0..3)for(r in 0..3)product[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3]
        if(out!==product)product.copyInto(out)
    }
    private fun attach(parent:DoubleArray,x:Double,y:Double,z:Double,rx:Double=0.0,ry:Double=0.0,rz:Double=0.0){
        compose(local,x,y,z,rx=rx,ry=ry,rz=rz);multiply(parent,local,head)
    }
    private fun rotateHead(rx:Double=0.0,ry:Double=0.0,rz:Double=0.0){compose(local,0.0,0.0,0.0,rx=rx,ry=ry,rz=rz);multiply(head,local,head)}
    private fun color(hex:Int)=colorCache.getOrPut(hex){FloatArray(3){i->val n=((hex ushr(16-i*8))and 255)/255.0
        (if(n<.04045)n*.07739938080495357 else (n*.9478672985781991+.05213270142180095).pow(2.4)).toFloat()}}
    private fun put(a:NativeAnimalAgent,kind:Int,parent:DoubleArray,x:Double,y:Double,z:Double,sx:Double,sy:Double,sz:Double,c:Int,rx:Double=0.0,ry:Double=0.0,rz:Double=0.0){
        val slot=counts[kind]++;require(slot<capacities[kind]){"Animal rig capacity"};compose(local,x,y,z,sx,sy,sz,rx,ry,rz);multiply(parent,local,product)
        val out=rows[kind];val at=slot*24;for(i in 0..15)out[at+i]=product[i].toFloat()
        val rgb=color(c);for(i in 0..2)out[at+16+i]=rgb[i];out[at+19]=1f;out[at+20]=slot.toFloat();out[at+21]=kind.toFloat();out[at+22]=1f;out[at+23]=0f;ids[kind][slot]=a.id
    }
    private fun cube(a:NativeAnimalAgent,parent:DoubleArray,x:Double,y:Double,z:Double,sx:Double,sy:Double,sz:Double,c:Int,rx:Double=0.0,ry:Double=0.0,rz:Double=0.0)=put(a,0,parent,x,y,z,sx,sy,sz,c,rx,ry,rz)
    fun update(agents:List<NativeAnimalAgent>,time:Double,visible:Set<Int>?=null, silhouette:Boolean=false){
        require(time.isFinite());for(k in 0..3){previous[k]=counts[k];counts[k]=0}
        for(a in agents){if(visible!=null&&a.id !in visible)continue
            val c=colors[a.species]?:error("Unknown animal rig");val moving=a.activity in setOf("walk","swim","jump","takeoff","fly","land");val response=a.response>0
            val pulse=if(response)sin((1.3-a.response)*5)else 0.0;val gait=a.traveled*6
            compose(base,a.position.x,a.position.y,a.position.z,rx=if(a.kind=="fish"&&a.activity=="jump")-cos((a.route?.t?:0.0)*PI)*.6 else 0.0,ry=a.heading)
            if(paper){
                paperPose(a,c,time,gait,moving,pulse,silhouette)
                continue
            }
            if(a.kind=="land"){
                val horse=a.species=="horse";val cow=a.species=="cow";val pig=a.species=="pig"
                val bodyY=if(horse)1.22 else if(cow).91 else if(pig).55 else .76;val bodyZ=if(horse)1.3 else if(cow)1.05 else if(pig).9 else .75;val bodyW=if(horse).72 else if(cow).76 else if(pig).62 else .64
                val rest=if(a.activity=="rest").16 else 0.0;val bob=if(moving)abs(sin(gait))*.025 else sin(time+a.phase)*.008
                cube(a,base,0.0,bodyY-rest+bob,-.05,bodyW,if(horse).72 else if(cow).65 else if(pig).48 else .58,bodyZ,c)
                if(cow){cube(a,base,.015,bodyY+.03,-.2,bodyW+.015,.34,.3,0xe6e0cd);cube(a,base,-.1,bodyY+.3,.2,.33,.02,.3,0xd9d5c6)}
                if(horse){cube(a,base,0.0,1.62,.48,.32,.75,.4,c,-.22);cube(a,base,0.0,1.72,.27,.12,.66,.15,0x493d31,-.22);cube(a,base,0.0,1.0,-.77,.15,.75,.16,0x483c30,.28)}
                val lower=if(a.activity=="graze"&&!response).38 else 0.0
                attach(base,0.0,(if(horse)2.0 else if(cow)1.25 else if(pig).69 else 1.03)-lower-rest+bob,bodyZ*.46)
                rotateHead(ry=if(response)pulse*.38 else sin(time*.6+a.phase)*.1)
                val headW=if(horse).33 else if(cow).45 else if(pig).45 else .43;val headH=if(horse).48 else if(cow).45 else if(pig).36 else .45
                cube(a,head,0.0,0.0,.11,headW,headH,.43,c);cube(a,head,0.0,-.08,.36,headW*.8,.18,.15,if(pig)0xc7797e else if(cow)0xb7a38c else if(horse)0xc1a27f else 0xb5a18a)
                for(side in listOf(-1,1)){
                    cube(a,head,side*(headW/2+.065),if(horse).27 else .02,.08,if(horse).13 else .16,if(horse).3 else .1,.17,c,rz=side*(.12+if(response)sin(time*17)*.35 else 0.0))
                    if(cow)cube(a,head,side*.2,.28,.06,.07,.18,.08,0xd8cfac)
                }
                put(a,1,head,0.0,.06,.332,headW*.94,headH*.6,1.0,if(pig)0xe5ada0 else 0xe8dec7)
                val legs=if(horse).84 else if(cow).59 else if(pig).3 else .48
                for(leg in 0..3){val x=(if(leg%2==1)1 else -1)*bodyW*.32;val z=if(leg<2)-bodyZ*.32 else bodyZ*.32
                    attach(base,x,legs-rest,z);rotateHead(rx=if(moving)sin(gait+if(leg==0||leg==3)0.0 else PI)*.4 else 0.0)
                    cube(a,head,0.0,-(legs-rest)/2,0.0,if(horse).14 else .15,legs-rest,.16,if(pig)c else 0xa58a71)
                    cube(a,head,0.0,-(legs-rest)+.04,.025,.16,.12,.19,0x514b40)
                }
                if(!horse)cube(a,base,0.0,bodyY-.05,-bodyZ*.58,.12,.27,.12,c,rz=sin(time*2+a.phase)*.18)
                val floor=a.walker?.navigator?.world?.query(AnimalBounds(a.position.x-.01,a.position.x+.01,a.position.z-.01,a.position.z+.01))
                    ?.filter{!it.water&&it.maxY<=a.position.y+.025}?.fold(-2048.0){n,s->max(n,s.maxY)}?:a.position.y
                if(floor>-2048)put(a,2,base,0.0,floor-a.position.y+.015,0.0,bodyW*.95,1.0,bodyZ*.9,0xffffff)
            }else if(a.kind=="fish"){
                val tail=sin(time*(if(response)24 else 10)+a.phase)*.55
                cube(a,base,0.0,0.0,0.0,.21,.32,.68,c,ry=sin(time*4+a.phase)*.06)
                cube(a,base,0.0,.02,-.42,.06,.38,.24,if(a.species=="tropicalfish")0xe5dbb9 else c,ry=tail)
                cube(a,base,0.0,.2,-.06,.045,.18,.27,0x6f9081,ry=tail*.3);cube(a,base,0.0,-.13,.08,.36,.04,.24,c,ry=tail*.3)
                if(a.species=="tropicalfish")cube(a,base,0.0,0.0,.04,.216,.33,.12,0xede8cc)
                for(side in listOf(-1,1))cube(a,base,side*.112,.055,.22,.018,.06,.07,0x252e2e)
                if(a.ripple>0&&a.waterY!=null)put(a,3,base,0.0,a.waterY!!-a.position.y+.035,0.0,(1.2-a.ripple)*2.1,1.0,(1.2-a.ripple)*2.1,0xffffff)
            }else{
                val gull=a.species=="gull";val size=if(gull)1.0 else .72
                val flapping=a.activity=="takeoff"||a.activity=="land"||response||a.activity=="fly"&&sin(time*.6+a.phase)>.2
                cube(a,base,0.0,.24,0.0,.3*size,.32*size,.59*size,c);cube(a,base,0.0,.45,.24,.25*size,.27*size,.29*size,c,ry=pulse*.25)
                cube(a,base,0.0,.4,.44,.1*size,.09*size,.2*size,0xc9a24c)
                for(side in listOf(-1,1)){
                    cube(a,base,side*.13*size,.5,.34,.025,.045,.05,0x27302e);attach(base,side*.16*size,.3,0.0)
                    val flap=if(flapping)sin(time*(if(response)21 else 13)+a.phase)*.9 else if(a.activity=="perch").95 else .08
                    rotateHead(rz=-side*flap);cube(a,head,side*.32*size,0.0,-.04,.64*size,.065,.34*size,c);cube(a,head,side*.63*size,-.015,-.09,.19*size,.065,.27*size,if(gull)0x555b5e else c)
                    if(a.activity=="perch")cube(a,base,side*.075,.045,0.0,.045,.08,.12,0x796343)
                }
                cube(a,base,0.0,.22,-.36,.2*size,.045,.29*size,if(gull)0x61666b else c,.15)
            }
        }
        for(k in 0..3)for(i in counts[k] until previous[k]){rows[k][i*24+22]=0f;ids[k][i]=0}
    }
    private fun paperPose(a:NativeAnimalAgent,color:Int,time:Double,gait:Double,moving:Boolean,pulse:Double,silhouette:Boolean){
        when(a.kind){
            "land"->{
                val height=when(a.species){"horse"->1.26;"cow"->.9;"sheep"->.76;else->.56}
                val length=when(a.species){"horse"->1.36;"cow"->1.14;else->.86}
                val rest=if(a.activity=="rest")height*.26 else 0.0
                val bodyY=height-rest
                val headY=bodyY+if(a.activity=="graze"&&a.response<=0).06 else height*.44
                cube(a,base,0.0,bodyY,0.0,.65,height*.65,length,color)
                cube(a,base,0.0,headY,length*.47,.36,.38,.38,if(a.species=="pig")0xf0beba else color,ry=pulse*.36)
                if(!silhouette){
                    for(leg in 0..3){
                        val x=if(leg%2==0)-.21 else .21
                        val z=if(leg<2)-length*.31 else length*.31
                        val bend=if(moving)sin(gait+if(leg==0||leg==3)0.0 else PI)*.4 else 0.0
                        cube(a,base,x,bodyY*.34,z,.15,bodyY*.74,.17,0x78634f,rx=bend)
                    }
                    cube(a,base,0.0,headY-.052,length*.47+.226,.24,.123,.11,0x948173,ry=pulse*.36)
                }
            }
            "fish"->{
                val tail=sin(time*(if(a.response>0)19 else 8)+a.phase)*.53
                cube(a,base,0.0,0.0,0.0,.24,.30,.69,color)
                cube(a,base,0.0,.025,-.43,.095,.30,.26,if(a.species=="tropicalfish")0xeddca8 else color,ry=tail)
                if(a.ripple>0&&a.waterY!=null)put(a,3,base,0.0,a.waterY!!-a.position.y+.04,0.0,
                    (1.2-a.ripple)*1.8,1.0,(1.2-a.ripple)*1.8,0xffffff)
            }
            "bird"->{
                val wings=if(a.activity=="perch") .64 else sin(time*10+a.phase)*.64
                cube(a,base,0.0,.25,0.0,.28,.24,.56,color,ry=pulse*.23)
                for(side in listOf(-1,1)){
                    attach(base,side*.13,.29,0.0)
                    cube(a,head,side*.23,0.0,-.045,.51,.075,.29,color,rz=side*wings)
                }
                if(!silhouette)cube(a,base,0.0,.33,.32,.1,.1,.18,0xc29847)
            }
        }
    }
    fun actorId(kind:Int,slot:Int)=ids[kind][slot]
    fun value(kind:Int,slot:Int,channel:Int)=rows[kind][slot*24+channel]
    fun copySlots(kind:Int,slots:IntArray,target:ByteBuffer){for(slot in slots){require(slot in 0 until capacities[kind]);for(c in 0..23)target.putFloat(rows[kind][slot*24+c])}}
}
