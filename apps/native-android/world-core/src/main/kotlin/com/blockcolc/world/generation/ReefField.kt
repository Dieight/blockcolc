package com.blockcolc.world.generation

import java.util.concurrent.CancellationException
import kotlin.math.*
import com.blockcolc.world.generation.SourceNumbers.hypot

data class ReefWorldField(val originX:Double,val originZ:Double,val baseY:(Double,Double)->Double,val density:((Double,Double)->Double)?=null)

object ReefField {
    private val kinds=listOf("tube","brain","bubble","fire","horn")
    private fun random(seed:Int,x:Double,z:Double)=TerrainMath.landscapeRandom(seed,x,z)
    private fun noise(seed:Int,x:Double,z:Double)=TerrainMath.landscapeNoise(seed,x,z,1.0)
    fun coverage(seed:Int,x:Double,z:Double,centerX:Double,centerZ:Double,radius:Double):Double {
        val dx=(x-centerX)/radius;val dz=(z-centerZ)/radius;val warp=(noise(seed+411,x/38,z/38)-.5)*.18
        val main=1-hypot(dx+sin(dz*3)*.12+warp,dz/.86-warp);val lobe=.48-hypot(dx-.66,dz+.28)
        val edge=max(main,lobe)+(noise(seed+719,x/23,z/23)-.5)*.18
        val amount=((edge+.12)/.34).coerceIn(0.0,1.0);return amount*amount*(3-2*amount)
    }
    fun create(seed:Int,halfX:Double,halfZ:Double,allowed:(Double,Double)->Boolean={_,_->true},field:ReefWorldField?=null,cancelled:()->Boolean={false}):SceneryBlockSet {
        require(halfX.isFinite()&&halfZ.isFinite()&&halfX>0&&halfZ>0)
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Reef generation superseded")}
        checkpoint();val cells=SceneryBlocksBuilder();val permitted=HashMap<TerrainCoordinate,Boolean>();val elevations=HashMap<TerrainCoordinate,Double>()
        val originX=field?.originX?:0.0;val originZ=field?.originZ?:0.0;val unsigned=seed.toLong() and 0xffffffffL
        fun accepts(x:Double,z:Double):Boolean=permitted.getOrPut(TerrainCoordinate.at(x,z)) {
            val density=field?.density?.invoke(x,z)?:1.0;val wx=x+originX;val wz=z+originZ
            density>.12+noise(seed+882,wx/6,wz/6)*.34&&allowed(x,z)
        }
        fun elevation(x:Double,z:Double)=elevations.getOrPut(TerrainCoordinate.at(x,z)){field?.baseY?.invoke(x,z)?:0.0}
        fun put(x:Double,y:Int,z:Double,block:String,solid:Boolean=true,state:Map<String,String>?=null) {
            if(!accepts(x,z))return
            cells.put(x,y+elevation(x,z),z,block,if(block=="sand")"stone"else"accent",solid,state)
        }
        fun inside(x:Double,z:Double):Boolean {
            if(field!=null)return true
            val wx=x+(noise(seed+31,x/9,z/9)-.5)*7;val wz=z+(noise(seed+77,x/11,z/11)-.5)*6
            val edge=1-(wx/halfX).pow(2)-(wz/halfZ).pow(2);val channel=abs(z-halfZ*.22*sin(x/8+unsigned%13))
            return edge+(noise(seed,x/7,z/7)-.5)*.7>.05&&!(channel<1.3&&abs(x)>halfX*.28)
        }
        var x= -halfX
        while(x<=halfX) {
            checkpoint();var z= -halfZ
            while(z<=halfZ) {
                if(!inside(x,z)||!accepts(x,z)){z++;continue}
                put(x,0,z,"sand");val wx=x+originX;val wz=z+originZ
                val family=kinds[min(4,floor(noise(seed+90,wx/15,wz/15)*5).toInt())]
                val channel=field!=null&&SceneryClimate.reefChannel(seed,wx,wz);val coral=!channel&&noise(seed+4,wx/8,wz/8)>.17
                if(coral)put(x,1,z,"${family}_coral_block")
                if(random(seed+17,wx,wz)>.975)put(x,2,z,"${family}_coral_fan",false,mapOf("waterlogged" to "true"))
                if(!coral&&random(seed+47,wx,wz)>.992)put(x,1,z,"sea_pickle",false,mapOf("pickles" to (1+floor(random(seed+48,wx,wz)*4).toInt()).toString(),"waterlogged" to "true"))
                z++
            };x++
        }
        val firstX=if(field!=null)floor((originX-halfX-7)/5)*5+3-originX else -halfX+3
        val firstZ=if(field!=null)floor((originZ-halfZ-7)/5)*5+3-originZ else -halfZ+3
        x=firstX
        while(x<halfX+if(field!=null)5 else 0) {
            checkpoint();var z=firstZ
            while(z<halfZ+if(field!=null)5 else 0) {
                val wx=x+originX;val wz=z+originZ;val cx=x+floor(random(seed+5,wx,wz)*3)-1;val cz=z+floor(random(seed+6,wx,wz)*3)-1
                if(!inside(cx,cz)||(field==null&&!accepts(cx,cz))||random(seed+8,wx,wz)<.12){z+=5;continue}
                val family=kinds[min(4,floor(noise(seed+90,(cx+originX)/15,(cz+originZ)/15)*5).toInt())]
                val form=floor(random(seed+12,wx,wz)*3).toInt();val height=1+floor(random(seed+9,wx,wz)*2).toInt()
                for(y in 1..height)put(cx,y,cz,"${family}_coral_block")
                for(dx in -2..2)for(dz in -2..2) {
                    if(when(form){0->abs(dx)+abs(dz)>2;1->abs(dx)>1||abs(dz)>1;else->dz!=0&&abs(dx)!=2})continue
                    if(random(seed+23,cx+dx+originX,cz+dz+originZ)<.18)continue
                    put(cx+dx,height+1,cz+dz,"${family}_coral_block")
                    if(random(seed+24,cx+dx+originX,cz+dz+originZ)>.76)put(cx+dx,height+2,cz+dz,"${family}_coral_fan",false,mapOf("waterlogged" to "true"))
                };z+=5
            };x+=5
        }
        if(field==null) {
            put(0.0,0,0.0,"sand");put(0.0,1,0.0,"sea_pickle",false,mapOf("pickles" to (1+unsigned%4).toString(),"waterlogged" to "true"))
            put(1.0,2,0.0,"${kinds[(unsigned%5).toInt()]}_coral_fan",false,mapOf("waterlogged" to "true"))
        }
        checkpoint();return cells.result()
    }
}
