package com.blockcolc.world.generation

import kotlin.math.*

enum class TerrainMaterial(val wireValue:String) { GRASS("grass"),DIRT("dirt"),STONE("stone"),WATER("water"),SAND("sand"),SNOW("snow"),ICE("ice"),TERRACOTTA("terracotta") }
enum class TerrainWater { NONE,RIVER,LAKE }
data class TerrainSample(val height:Double,val material:TerrainMaterial,val supportInfluence:Double,val moisture:Double,val waterKind:TerrainWater,val mountainSignal:Double=0.0)

sealed interface TerrainProfile {
    data class Floating(val cellSize:Int):TerrainProfile
    data class Regional(val near:Double,val middle:Double,val far:Double,val farFine:Double,val refinedFar:Boolean,val farCellSize:Int):TerrainProfile
    data class Ocean(val mainRadius:Double,val beach:Double,val near:Double,val middle:Double,val far:Double,val farCellSize:Int=32,val strait:Double=60.0):TerrainProfile
}

object TerrainProfiles {
    fun forEnvironment(environment:WorldEnvironment,radius:Double,refinedFar:Boolean?=null):TerrainProfile {
        require(radius.isFinite()&&radius>=0)
        if(environment==WorldEnvironment.FLOATING)return TerrainProfile.Floating(if(radius>70)2 else 1)
        val valley=environment!=WorldEnvironment.OCEAN
        val near=TerrainMath.align(max(if(valley)128.0 else 80.0,radius+if(valley)56 else 28),8)
        if(!valley) {
            val main=radius*1.55+20;val beach=max(12.0,TerrainMath.round(main*.22))
            val middle=TerrainMath.align(maxOf(160.0,near+64,main*1.2+beach*1.18+16),16)
            return TerrainProfile.Ocean(main,beach,near,middle,TerrainMath.align(maxOf(1200.0,middle+80,radius*5),16))
        }
        val middle=TerrainMath.align(max(256.0,near+112),16)
        val far=TerrainMath.align(maxOf(720.0,middle+80,radius*4.5),16)
        val refined=refinedFar?: (far<=1024)
        val fine=if(refined)TerrainMath.align(max(middle+112,middle*1.4),16)else middle
        return if(environment==WorldEnvironment.COAST) {
            val coastMiddle=TerrainMath.align(max(near+32,middle*.8),16)
            TerrainProfile.Regional(near,coastMiddle,TerrainMath.align(max(coastMiddle+80,far*.8),16),TerrainMath.align(max(coastMiddle,fine*.8),16),refined,if(far<=1024)8 else 16)
        }else TerrainProfile.Regional(near,middle,far,fine,refined,if(far<=1024)8 else 16)
    }
}

internal object TerrainMath {
    fun round(value:Double)=floor(value+.5)
    fun align(value:Double,multiple:Int)=ceil(value/multiple)*multiple
    fun smooth(a:Double,b:Double,value:Double):Double {val t=((value-a)/max(.001,b-a)).coerceIn(0.0,1.0);return t*t*(3-2*t)}
    fun hash(seed:Int,channel:Int,x:Double,z:Double):Long {
        var hash=seed xor (channel*0x45d9f3b) xor (x.toLong().toInt()*0x27d4eb2d) xor (z.toLong().toInt()*0x165667b1)
        hash=hash xor(hash ushr 16);hash*=0x85ebca6b.toInt();hash=hash xor(hash ushr 13)
        return hash.toLong() and 0xffffffffL
    }
    private fun signed(seed:Int,channel:Int,x:Double,z:Double)=hash(seed,channel,x,z)/2147483647.0-1
    fun value(x:Double,z:Double,seed:Int,channel:Int):Double {
        val x0=floor(x);val z0=floor(z);val tx=smooth(0.0,1.0,x-x0);val tz=smooth(0.0,1.0,z-z0)
        val n00=signed(seed,channel,x0,z0);val n10=signed(seed,channel,x0+1,z0)
        val n01=signed(seed,channel,x0,z0+1);val n11=signed(seed,channel,x0+1,z0+1)
        val top=n00+(n10-n00)*tx;val bottom=n01+(n11-n01)*tx
        return top+(bottom-top)*tz
    }
    fun fractal(x:Double,z:Double,seed:Int,channel:Int)=value(x,z,seed,channel)*.58+value(x*2,z*2,seed,channel+1)*.27+value(x*4,z*4,seed,channel+2)*.15
    private fun fieldHash(seed:Int,x:Double,z:Double):Long {
        var n=(x.toLong().toInt()*374761393) xor(z.toLong().toInt()*668265263) xor seed
        n=(n xor(n ushr 13))*1274126177
        return (n xor(n ushr 16)).toLong() and 0xffffffffL
    }
    fun landscapeNoise(seed:Int,x:Double,z:Double,scale:Double)=fieldNoise(seed,x,z,scale,4294967296.0)
    fun landscapeRandom(seed:Int,x:Double,z:Double)=fieldHash(seed,x,z)/4294967296.0
    fun mosaicNoise(seed:Int,x:Double,z:Double,scale:Double)=fieldNoise(seed,x,z,scale,4294967295.0)
    private fun fieldNoise(seed:Int,x:Double,z:Double,scale:Double,divisor:Double):Double {
        val u=x/scale;val v=z/scale;val ix=floor(u);val iz=floor(v);val a=smooth(0.0,1.0,u-ix);val b=smooth(0.0,1.0,v-iz)
        return (fieldHash(seed,ix,iz)/divisor*(1-a)+fieldHash(seed,ix+1,iz)/divisor*a)*(1-b)+
            (fieldHash(seed,ix,iz+1)/divisor*(1-a)+fieldHash(seed,ix+1,iz+1)/divisor*a)*b
    }
    data class Macro(val height:Double,val moisture:Double,val rocky:Boolean,val mountainSignal:Double)
    private val continentalSpline=arrayOf(-1.0 to 0.0,-.58 to .5,-.18 to 2.2,.24 to 4.2,.58 to 6.8,1.0 to 8.5)
    private fun remap(value:Double):Double {
        if(value<=continentalSpline[0].first)return continentalSpline[0].second
        for(index in 1 until continentalSpline.size) {
            val left=continentalSpline[index-1];val right=continentalSpline[index]
            if(value>right.first)continue
            return left.second+(right.second-left.second)*smooth(left.first,right.first,value)
        }
        return continentalSpline.last().second
    }
    fun macro(x:Double,z:Double,seed:Int,coarse:Boolean=false):Macro {
        val px=x+fractal(x*.0048,z*.0048,seed,0x121)*38;val pz=z+fractal(x*.0048,z*.0048,seed,0x131)*38
        val continental=fractal(px*.0046,pz*.0046,seed,0x141);val erosion=fractal(px*.0095,pz*.0095,seed,0x151)
        val ridge=(1-abs(fractal(px*.0085,pz*.0085,seed,0x161))).pow(2.15)
        val hills=fractal(px*.016,pz*.016,seed,0x171)-if(coarse)value(px*.064,pz*.064,seed,0x173)*.15 else 0.0
        val detail=if(coarse)0.0 else fractal(px*.044,pz*.044,seed,0x181)
        val moisture=fractal(px*.011,pz*.011,seed,0x191)
        val mask=smooth(-.2,.46,continental-erosion*.28);val mountain=ridge*mask*(18+max(0.0,-erosion)*15)
        val chainNoise=fractal(px*.0042+pz*.0016,pz*.012-px*.0011,seed,0x1a1)
        val chainRidge=(1-abs(chainNoise)).pow(2.35);val chainMask=smooth(.04,.56,continental-erosion*.22)
        val chain=chainRidge*chainMask*(8+ridge*11)
        val peak=smooth(.48,.82,max(ridge,chainRidge));val highPeaks=peak.pow(1.35)*chainMask*(18+mask*9+max(0.0,-erosion)*7)
        val rolling=smooth(-.7,.22,continental)*(hills+1)*1.55;val valley=smooth(.12,.76,erosion)*(2.4+ridge*1.5)
        val raw=remap(continental)+mountain+chain+highPeaks+rolling-valley+detail*.35
        val shaped=if(raw>34)34+tanh((raw-34)/14)*13 else raw
        val height=round(shaped).coerceIn(0.0,48.0)
        return Macro(height,moisture,height>=22&&(ridge>.48||chainRidge>.58||moisture<-.2),min(1.0,maxOf(ridge*mask,chainRidge*chainMask,peak*.7)))
    }
}

data class MosaicFields(val a:Double,val b:Double,val spacing:Double,val detail:Double,val broad:Double,val ridge:Double,val mountain:Double,val ice:Double,
    val bad:Double,val forest:Double,val forestHabitat:Double,val coast:Double,val rolling:Double,val peak:Double,val mesaRaw:Double,val legacyPremix:Double,val shoreField:Double,val coldHotBorder:Double)
data class MosaicSample(val biome:String,val height:Double,val material:TerrainMaterial)

/** A generation-scoped field keeps the shore-distance grid private to its
 * seed/radius. It never reuses distances from a previously displayed world. */
class MosaicTerrain(val seed:Int,val coreRadius:Double) {
    private data class Grid(val x:Int,val z:Int)
    private val distances=HashMap<Grid,Double>()
    private fun noise(channel:Int,x:Double,z:Double,scale:Double)=TerrainMath.mosaicNoise(seed xor channel,x,z,scale)
    private fun smooth(a:Double,b:Double,n:Double)=TerrainMath.smooth(a,b,n)
    private fun smoother(n:Double):Double {val t=n.coerceIn(0.0,1.0);return t*t*t*(t*(t*6-15)+10)}
    fun grid(x:Double,z:Double):Triple<Double,Double,Double> {
        val spacing=max(116.0,coreRadius+84);return Triple((x-z)/sqrt(2.0)/spacing,(x+z)/sqrt(2.0)/spacing,spacing)
    }
    fun regionAt(x:Double,z:Double):String {val(u,v)=grid(x,z);return "${(TerrainMath.round(v)+2).coerceIn(1.0,3.0).toInt()}${(TerrainMath.round(u)+2).coerceIn(1.0,3.0).toInt()}"}
    fun warmSeaWeight(x:Double,z:Double):Double {val(u,v)=grid(x,z);return smooth(.22,.64,u)*(1-smooth(.06,.40,v))}
    fun fields(x:Double,z:Double):MosaicFields {
        val(u,v,spacing)=grid(x,z);val warp=(noise(0x1891,x,z,110.0)-.5)*.12;val a=u+warp;val b=v+warp*.6
        val detail=noise(0x621,x,z,33.0);val broad=noise(0x2891,x,z,94.0);val ridge=1-abs(noise(0x482,x,z,52.0)*2-1)
        val mountain=smooth(.08,.78,-a)*smooth(.2,.86,-b);val ice=smooth(.3,.86,-a)*(1-smooth(.13,.72,abs(b)))
        val bad=smooth(.32,.84,-a)*smooth(.42,.95,b)+smooth(.77,1.22,b)*(1-smooth(.04,.42,a))
        val ocean=smooth(.18,.7,a)*smooth(.16,.72,-b);val inlet=smooth(-.08,.2,a)*smooth(.28,.75,-b)*(1-smooth(.35,.7,abs(a)))
        val rightSea=smooth(.38,.82,a)*(1-smooth(-.15,.18,b));val coast=1-(1-ocean)*(1-inlet)*(1-rightSea)
        val forest=smooth(.65,1.02,a)*smooth(.04,.36,b)
        val woodland=smooth(.32,.52,a)*smooth(.55,.85,b)*(1-smooth(.28,.40,coast))*(1-smooth(.12,.20,bad))
        val rolling=4+(detail-.5)*5+(broad-.5)*7;val peak=25+ridge*25+(1-abs(noise(0x741,x,z,30.0)*2-1)).pow(3)*20
        val mesaRaw=6+broad*25+detail*9;val mesa=floor(mesaRaw/4)*4
        val land=rolling+mountain*peak+ice*(5+detail*6)+min(1.0,bad)*mesa+forest*(3+ridge*9)
        val premix=land*(1-coast)+(-4+detail*2)*coast
        val cold=max(mountain,ice);val hot=bad.coerceIn(0.0,1.0);val total=cold+hot;val ratio=cold/(total+.0001)
        val border=(1-smooth(.12,.32,abs(ratio-.5)))*smooth(.10,.30,total)
        return MosaicFields(a,b,spacing,detail,broad,ridge,mountain,ice,hot,forest,max(forest,woodland),coast,rolling,peak,mesaRaw,premix,min(.66-coast,(premix-.4)/24),border)
    }
    fun sample(x:Double,z:Double):MosaicSample {
        val f=fields(x,z)
        if(f.shoreField<0)return MosaicSample("ocean",0.0,TerrainMaterial.WATER)
        if(f.coast>.40) {
            val shelf=1+2*(1-smooth(.40,.66,f.coast));val blend=smooth(.28,.40,f.coast)
            return MosaicSample("beach",max(1.0,TerrainMath.round(f.legacyPremix*(1-blend)+shelf*blend)),TerrainMaterial.SAND)
        }
        val dominant=f.bad/(f.bad+f.mountain+f.ice+.0001);val mesaBlend=smoother((dominant-.65)/.30)
        val mesa=f.mesaRaw*(1-mesaBlend)+floor(f.mesaRaw/4)*4*mesaBlend
        val relief=((f.mountain*f.peak).pow(4)+(f.ice*(5+f.detail*6)).pow(4)+(f.bad*mesa).pow(4)+(f.forest*(3+f.ridge*9)).pow(4)).pow(.25)
        val shore=smoother((f.coast-.08)/.32);val height=max(2.0,TerrainMath.round((f.rolling+relief)*(1-shore)+3*shore))
        val rough=(noise(0x55f1,x,z,11.0)-.5)*.12
        val scores=arrayListOf("snow-mountain" to f.mountain,"glacier" to f.ice,"badlands" to f.bad,"forest" to f.forestHabitat)
        if(f.a>=-.50)scores+=(if(hypot(f.a,f.b)>.5)"valley"else"plains") to .20
        var biome="plains";var best=Double.NEGATIVE_INFINITY
        for((index,entry)in scores.withIndex()) {val score=entry.second+rough*sin(index*2.7+1);if(score>best){best=score;biome=entry.first}}
        if(biome=="snow-mountain")return MosaicSample(biome,height,if(height>=19+(noise(0x712a,x,z,31.0)-.5)*8)TerrainMaterial.SNOW else TerrainMaterial.STONE)
        val rock=f.coldHotBorder>.3&&noise(0x219e,x,z,14.0)>.3
        val material=when(biome){"glacier"->if(rock)TerrainMaterial.STONE else if(f.detail>.64)TerrainMaterial.ICE else TerrainMaterial.SNOW
            "badlands"->if(rock)TerrainMaterial.STONE else TerrainMaterial.TERRACOTTA;else->TerrainMaterial.GRASS}
        return MosaicSample(biome,height,material)
    }
    fun shoreDistance(x:Double,z:Double):Double {
        fun cell(gx:Int,gz:Int):Double {
            val key=Grid(gx,gz);distances[key]?.let{return it};val px=gx*8.0;val pz=gz*8.0;var result=0.0
            if(fields(px,pz).shoreField<0) {
                var nearest=48.0
                for(index in 0 until 16) {val dx=cos(index*PI/8);val dz=sin(index*PI/8);var t=8.0
                    while(t<=nearest) {if(fields(px+dx*t,pz+dz*t).shoreField<0){t+=8;continue}
                        var low=t-8;var high=t;repeat(4){val mid=(low+high)/2;if(fields(px+dx*mid,pz+dz*mid).shoreField<0)low=mid else high=mid}
                        nearest=min(nearest,(low+high)/2);break
                    }
                }
                result=-nearest
            }
            if(distances.size>=32768)distances.clear();distances[key]=result;return result
        }
        val gx=floor(x/8).toInt();val gz=floor(z/8).toInt();val u=smooth(0.0,1.0,x/8-gx);val v=smooth(0.0,1.0,z/8-gz)
        return (cell(gx,gz)*(1-u)+cell(gx+1,gz)*u)*(1-v)+(cell(gx,gz+1)*(1-u)+cell(gx+1,gz+1)*u)*v
    }
    fun seabedHeight(x:Double,z:Double):Double {
        val(u,v)=grid(x,z);val offshore=smooth(.32,1.25,u)*smooth(-.15,.8,-v)
        val broad=noise(0x62b9,x,z,70.0);val detail=noise(0x19b7,x,z,24.0);val gully=(1-abs(noise(0x29ac,x,z,42.0)*2-1)).pow(3)
        val depth=-5.4-offshore*5-broad*1.6+detail*.7-gully*1.4
        val shore=smoother(max(0.0,-shoreDistance(x,z))/44)
        return -1.1+(depth+1.1)*shore
    }
}
