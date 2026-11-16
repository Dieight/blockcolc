package com.blockcolc.world.generation

import kotlin.math.*

internal object OceanTerrainGenerator {
    fun generate(placements:List<VillagePlacement>,roads:List<RoadCell>,pads:List<TerrainPad>,radius:Double,seed:Int,profile:TerrainProfile.Ocean,
        ground:(Double,Double)->Double,checkpoint:()->Unit):TerrainMesh {
        val support=TerrainSupportField(placements,roads,pads,ground);val field=OceanField(radius,seed,profile,support)
        val mesh=TerrainMeshBuilder(checkpoint);val metrics=TerrainMetrics(seed);val renderCells=ArrayList<OceanRenderCell>()
        val cache=HashMap<TerrainCoordinate,TerrainSample>();var visited=0
        fun nearTransition(raw:TerrainSample,x:Double,z:Double):TerrainSample {
            if(raw.waterKind!=TerrainWater.NONE||raw.supportInfluence>=.18)return raw
            val wx=TerrainMath.smooth(profile.near-16,profile.near-1,abs(x));val wz=TerrainMath.smooth(profile.near-16,profile.near-1,abs(z))
            if(wx==0.0&&wz==0.0)return raw
            val targets=ArrayList<Pair<Double,Double>>()
            for((weight,cx,cz)in listOf(Triple(wx,sign(x)*(profile.near+2),floor(z/4)*4+2),Triple(wz,floor(x/4)*4+2,sign(z)*(profile.near+2)))) {
                if(weight==0.0)continue
                val other=field.sample(cx,cz);if(other.waterKind==TerrainWater.NONE&&other.supportInfluence<.18)targets+=weight to other.height
            }
            var sum=0.0;var total=0.0;var blend=0.0
            for((index,target)in targets.withIndex()) {
                val other=if(targets.size==2)targets[1-index].first else 0.0
                val weight=if(target.first==1.0&&other==1.0)1.0 else target.first*(1-other)
                sum+=target.second*weight;total+=weight;blend=max(blend,target.first)
            }
            return if(total>0)raw.copy(height=TerrainMath.round(raw.height*(1-blend)+sum/total*blend))else raw
        }
        fun addCell(x:Double,z:Double,size:Int,lod:Int) {
            if(visited++%128==0)checkpoint()
            val sample=cache.getOrPut(TerrainCoordinate.at(x,z)) {
                val raw=field.sample(x,z)
                if(size==2&&abs(x)<profile.near&&abs(z)<profile.near)nearTransition(raw,x,z)else raw
            }
            val half=size/2.0;val top=sample.height-if(sample.material==TerrainMaterial.WATER).34 else .5
            mesh.top(doubleArrayOf(x-half,top,z-half,x-half,top,z+half,x+half,top,z+half,x+half,top,z-half),sample.material)
            renderCells+=OceanRenderCell(x,z,size.toDouble(),top);metrics.add(x,z,size,lod,sample)
        }
        fun inPatch(x:Double,z:Double)=field.patches.any{x>it.minX&&x<it.maxX&&z>it.minZ&&z<it.maxZ}
        fun backgroundCell(x:Double,z:Double,size:Int,lod:Int,inner:Double){
            val half=size/2.0;val x0=x-half;val x1=x+half;val z0=z-half;val z1=z+half
            if(inner>0&&x0>=-inner&&x1<=inner&&z0>=-inner&&z1<=inner)return
            if(field.patches.any{x0>=it.minX&&x1<=it.maxX&&z0>=it.minZ&&z1<=it.maxZ})return
            val crossesInner=inner>0&&x0<inner&&x1>-inner&&z0<inner&&z1>-inner
            val crossesPatch=field.patches.any{x0<it.maxX&&x1>it.minX&&z0<it.maxZ&&z1>it.minZ}
            if(size>2&&(crossesInner||crossesPatch)){
                val next=size/2;val offset=size/4.0
                for(dx in listOf(-offset,offset))for(dz in listOf(-offset,offset))backgroundCell(x+dx,z+dz,next,lod,inner)
            }else if(!inPatch(x,z))addCell(x,z,size,lod)
        }
        SteppedTerrain.lodSquare(profile.near,0.0,2,checkpoint){x,z->backgroundCell(x,z,2,0,0.0)}
        SteppedTerrain.lodSquare(profile.middle,0.0,4,checkpoint){x,z->backgroundCell(x,z,4,1,profile.near)}
        SteppedTerrain.lodSquare(profile.far,0.0,profile.farCellSize,checkpoint){x,z->backgroundCell(x,z,profile.farCellSize,2,profile.middle)}
        val emitted=HashSet<TerrainCoordinate>()
        for(patch in field.patches) {
            var x=patch.minX+1
            while(x<patch.maxX) {
                checkpoint();var z=patch.minZ+1
                while(z<patch.maxZ){if(emitted.add(TerrainCoordinate.at(x,z)))addCell(x,z,2,1);z+=2};x+=2
            }
        }
        addSides(renderCells,mesh,checkpoint)
        return mesh.finish(metrics.cells,TerrainBounds(-profile.far,profile.far,metrics.minimum-.5,metrics.maximum+.5,-profile.far,profile.far),
            TerrainPlanBounds(-radius,radius,-radius,radius),TerrainPlanBounds(-profile.near,profile.near,-profile.near,profile.near),metrics.trees,metrics.lod,
            metrics.water(0,0,0,0,0.0),field.islets,OceanMain(profile.mainRadius,profile.beach))
    }
    private fun addSides(cells:List<OceanRenderCell>,mesh:TerrainMeshBuilder,checkpoint:()->Unit) {
        val left=LinkedHashMap<Double,MutableList<TerrainEdge>>();val right=LinkedHashMap<Double,MutableList<TerrainEdge>>()
        val near=LinkedHashMap<Double,MutableList<TerrainEdge>>();val far=LinkedHashMap<Double,MutableList<TerrainEdge>>()
        var visited=0
        for(cell in cells) {
            if(visited++%256==0)checkpoint()
            val half=cell.size/2
            left.getOrPut(cell.x-half){arrayListOf()}.add(TerrainEdge(cell.z-half,cell.z+half,cell.top))
            right.getOrPut(cell.x+half){arrayListOf()}.add(TerrainEdge(cell.z-half,cell.z+half,cell.top))
            near.getOrPut(cell.z-half){arrayListOf()}.add(TerrainEdge(cell.x-half,cell.x+half,cell.top))
            far.getOrPut(cell.z+half){arrayListOf()}.add(TerrainEdge(cell.x-half,cell.x+half,cell.top))
        }
        val indexedLeft=left.mapValues{TerrainLineIntervals(it.value)};val indexedRight=right.mapValues{TerrainLineIntervals(it.value)}
        val indexedNear=near.mapValues{TerrainLineIntervals(it.value)};val indexedFar=far.mapValues{TerrainLineIntervals(it.value)}
        fun emit(cell:OceanRenderCell,dx:Int,dz:Int,neighbors:TerrainLineIntervals?) {
            if(neighbors==null)return
            val half=cell.size/2;val start=if(dx!=0)cell.z-half else cell.x-half;val end=if(dx!=0)cell.z+half else cell.x+half
            val material=if(cell.top>12)TerrainMaterial.STONE else TerrainMaterial.DIRT
            for(neighbor in neighbors.overlapping(start,end)) {
                val from=max(start,neighbor.start);val until=min(end,neighbor.end)
                if(until-from<.001||neighbor.top>=cell.top-.01)continue
                SteppedTerrain.emitSide(mesh,cell.x,cell.z,half,dx,dz,material,neighbor.top,cell.top,from,until)
            }
        }
        for(cell in cells) {
            if(visited++%256==0)checkpoint();val half=cell.size/2
            emit(cell,-1,0,indexedRight[cell.x-half]);emit(cell,1,0,indexedLeft[cell.x+half])
            emit(cell,0,-1,indexedFar[cell.z-half]);emit(cell,0,1,indexedNear[cell.z+half])
        }
    }

    private class OceanField(radius:Double,private val seed:Int,private val profile:TerrainProfile.Ocean,private val support:TerrainSupportField) {
        private data class Peak(val x:Double,val z:Double,val height:Double,val radius:Double)
        private data class Headland(val center:Double,val width:Double)
        private data class Reef(val x:Double,val z:Double,val radius:Double)
        private fun hash(channel:Int,x:Double=0.0,z:Double=0.0)=TerrainMath.hash(seed,channel,x,z)
        private fun phase(channel:Int)=hash(channel)/4294967295.0*PI*2
        private val construction=radius*.92
        private val hillAzimuth=phase(0x911)
        private val hillDistance=max(construction*1.4,profile.mainRadius*.42+hash(0x912)%21)
        private val hill=Peak(cos(hillAzimuth)*hillDistance,sin(hillAzimuth)*hillDistance,22.0+hash(0x913)%13,16.0+hash(0x914)%10)
        private val interiorAxis=hillAzimuth+.28+(hash(0x91a)%48)/100.0
        private val interiorOffset=profile.mainRadius*(.27+(hash(0x91b)%12)/100.0)
        private val interiorWidth=profile.mainRadius*(.13+(hash(0x91c)%8)/100.0)
        private val interiorStrength=.8+(hash(0x91d)%75)/100.0
        private val secondary=listOf(.42,.96,1.5).map{offset->Peak(hill.x*cos(offset)-hill.z*sin(offset),hill.x*sin(offset)+hill.z*cos(offset),
            8.0+hash(0x915,TerrainMath.round(offset*10))%7,9.0+hash(0x916,TerrainMath.round(offset*10))%6)}
        private val phaseA=phase(0x941);private val phaseB=phase(0x942);private val phaseC=phase(0x943)
        private val headlands=List(2+(hash(0x945)%3).toInt()){index->Headland(phase(0x946+index),.5+(hash(0x947+index)%62)/100.0)}
        private val lagoonAzimuth=hillAzimuth+PI+((hash(0x917)%628)/100.0-3.1)*.8
        private val lagoonDistance=maxOf(radius+20,construction*1.35,profile.mainRadius*.52+hash(0x918)%14)
        private val lagoon=Reef(cos(lagoonAzimuth)*lagoonDistance,sin(lagoonAzimuth)*lagoonDistance,4.0+hash(0x919)%4)
        private val reefs=List(6+(hash(0x95a)%5).toInt()){index->
            val ring=profile.mainRadius+profile.beach+10+hash(0x95b+index)%26;val angle=phase(0x95c+index)
            Reef(cos(angle)*ring,sin(angle)*ring,1.5+(hash(0x95d+index)%20)/10.0)
        }
        val islets:List<OceanIslet>
        val patches:List<TerrainPlanBounds>
        init {
            val count=4+(hash(0x921)%4).toInt();val angles=MutableList(count){phase(0x960+it)}.sorted().toMutableList()
            for(index in angles.indices) {
                val next=(index+1)%angles.size;val gap=(angles[next]-angles[index]+PI*2)%(PI*2)
                if(gap<.45){angles[next]=(angles[index]+.45)%(PI*2);if(next==0)angles[0]+=PI*2}
            }
            islets=List(count){index->
                val angle=angles[index];val r=13.0+hash(0x932+index)%15
                val distance=profile.mainRadius+profile.beach+profile.strait+r+hash(0x931+index)%85
                OceanIslet(cos(angle)*distance,sin(angle)*distance,r,5.0+hash(0x933+index)%7)
            }
            patches=islets.map{val reach=it.radius+12;TerrainPlanBounds(floor((it.x-reach)/32)*32,ceil((it.x+reach)/32)*32,floor((it.z-reach)/32)*32,ceil((it.z+reach)/32)*32)}
        }
        private fun ocean()=TerrainSample(0.0,TerrainMaterial.WATER,0.0,1.0,TerrainWater.LAKE)
        private fun shoreWarp(angle:Double):Double {
            val waves=sin(angle*2+phaseA)*.5+sin(angle*3+phaseB)*.32+sin(angle*5+phaseC)*.2
            val fractal=TerrainMath.value(cos(angle)*1.9,sin(angle)*1.9,seed,0x944)*.3
            return (1+waves*.16+fractal*.12).coerceIn(.78,1.22)
        }
        private fun mainWarp(angle:Double,x:Double,z:Double):Double {
            val angular=sin(angle*2+phaseA)*.5+sin(angle*3+phaseB)*.3+sin(angle*5+phaseC)*.15
            val broad=TerrainMath.fractal(x*.011,z*.011,seed,0x948);val detail=TerrainMath.value(x*.032,z*.032,seed,0x949)
            return (1+angular*.13+broad*.07+detail*.035).coerceIn(.8,1.2)
        }
        private fun rockyStrength(angle:Double):Double {
            var strength=0.0
            for(head in headlands){var delta=abs(angle-head.center);if(delta>PI)delta=PI*2-delta;strength=max(strength,1-TerrainMath.smooth(head.width*.55,head.width,delta))}
            return strength
        }
        fun sample(x:Double,z:Double):TerrainSample {
            val supported=support.sample(x,z)
            for(islet in islets) {
                val dx=x-islet.x;val dz=z-islet.z;val distance=hypot(dx,dz);val warp=shoreWarp(atan2(dz,dx));val shore=islet.radius*warp+1.5
                if(distance<=shore) {
                    val ridge=.5+.5*sin(TerrainMath.fractal(x*.07,z*.07,seed,0x941)*PI)
                    val height=TerrainLandforms.isletHeight(distance,shore,islet.peakHeight,ridge);val sandy=warp<1.06&&distance>islet.radius-2
                    return TerrainSample(height,if(height>6)TerrainMaterial.STONE else if(sandy)TerrainMaterial.SAND else TerrainMaterial.GRASS,0.0,.14,TerrainWater.NONE)
                }
            }
            for(reef in reefs)if(hypot(x-reef.x,z-reef.z)<=reef.radius)return TerrainSample(1.0,TerrainMaterial.STONE,0.0,0.0,TerrainWater.NONE)
            if(supported.influence<.08&&hypot(x-lagoon.x,z-lagoon.z)<=lagoon.radius)return ocean()
            val angle=atan2(z,x);val warp=mainWarp(angle,x,z);val distance=hypot(x,z)
            val landRadius=profile.mainRadius*warp;val coastWidth=profile.beach*(1.02+(1-warp)*.6).coerceIn(.72,1.18);val outer=landRadius+coastWidth
            if(distance>outer)return ocean()
            val along=x*cos(interiorAxis)+z*sin(interiorAxis);val across=-x*sin(interiorAxis)+z*cos(interiorAxis)
            val ridge=exp(-((across-interiorOffset)/interiorWidth).pow(2))*interiorStrength
            val tilt=along/max(1.0,profile.mainRadius)*.55;val weathered=TerrainMath.value(x*.038,z*.038,seed,0x950)*.55
            val interiorRise=TerrainMath.smooth(0.0,max(12.0,profile.beach*.9),landRadius-distance)
            val beachRise=TerrainMath.smooth(0.0,coastWidth,outer-distance)
            var height=if(distance<=landRadius)max(1.0,TerrainMath.round(1.25+interiorRise*2.65+(ridge+tilt+weathered)*interiorRise))else max(0.0,TerrainMath.round(beachRise*1.6))
            fun peak(peak:Peak)=TerrainLandforms.islandHill(hypot(x-peak.x,z-peak.z),peak.radius,peak.height,TerrainMath.fractal(x*.045,z*.045,seed,0x952),supported.influence)
            height+=TerrainMath.round(peak(hill));for(secondary in secondary)height+=TerrainMath.round(peak(secondary))
            if(supported.influence>.001)height=TerrainMath.round(height+(supported.height-height)*TerrainMath.smooth(.72,.995,supported.influence))
            val protected=supported.influence>=.08;val exposure=max(TerrainMath.smooth(1.025,1.11,warp),rockyStrength(angle))
            val texture=TerrainMath.value(x*.075,z*.075,seed,0x94e)*.22
            val rocky=!protected&&(height>=16||distance>landRadius-(2.5+exposure*4.5)&&exposure+texture>.48)
            val sandy=!protected&&!rocky&&distance>landRadius-5
            val material=TerrainLandforms.islandSurface(height,distance,landRadius,coastWidth,warp,exposure,supported.influence,x,z,seed,
                if(rocky)TerrainMaterial.STONE else if(sandy)TerrainMaterial.DIRT else TerrainMaterial.GRASS)
            return TerrainSample(height,material,supported.influence,.12,TerrainWater.NONE)
        }
    }
}
