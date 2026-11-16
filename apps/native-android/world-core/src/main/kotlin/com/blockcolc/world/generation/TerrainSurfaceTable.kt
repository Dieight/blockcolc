package com.blockcolc.world.generation

import java.util.concurrent.CancellationException
import kotlin.math.*

data class TerrainSurface(val minX:Double,val maxX:Double,val minZ:Double,val maxZ:Double,val supportY:Double,val material:TerrainMaterial) {
    val water get()=material==TerrainMaterial.WATER
}

/** Numeric top rows and compressed 8-block bins, not a second terrain mesh.
 * Equal-height ties retain material/quad input order; dry ground only wins
 * when it is over .01 above water. Continuously moving queries retain no
 * point-history cache. Creation is cancellable and transfers owned columns. */
class TerrainSurfaceTable private constructor(private val coordinates:DoubleArray,private val materials:ByteArray,
    private val minBinX:Double,private val minBinZ:Double,private val width:Int,private val height:Int,private val offsets:IntArray?,private val rows:IntArray?) {
    val length get()=materials.size
    val columnBytes get()=coordinates.size*8L+materials.size
    val indexBytes get()=if(offsets==null)256L else offsets.size*4L+rows!!.size*4L+256
    fun at(row:Int):TerrainSurface? {
        if(row !in materials.indices)return null
        val i=row*5
        return TerrainSurface(coordinates[i],coordinates[i+1],coordinates[i+2],coordinates[i+3],coordinates[i+4],TerrainMaterial.entries[materials[row].toInt()])
    }
    private fun sampleRows(x:Double,z:Double,start:Int,end:Int,indices:IntArray?):TerrainSurface? {
        var ground= -1;var water= -1;var groundY=0.0;var waterY=0.0
        for(i in start until end) {
            val row=indices?.get(i)?:i;val p=row*5
            if(!(coordinates[p]<coordinates[p+1]&&coordinates[p+2]<coordinates[p+3]&&x>=coordinates[p]&&x<=coordinates[p+1]&&z>=coordinates[p+2]&&z<=coordinates[p+3]))continue
            val y=coordinates[p+4]
            if(materials[row].toInt()==TerrainMaterial.WATER.ordinal){if(water<0||y>waterY){water=row;waterY=y}}
            else if(ground<0||y>groundY){ground=row;groundY=y}
        }
        return at(if(ground>=0&&(water<0||groundY>waterY+.01))ground else water)
    }
    fun sample(x:Double,z:Double):TerrainSurface? {
        if(!x.isFinite()||!z.isFinite())return null
        if(offsets==null)return sampleRows(x,z,0,length,null)
        val column=floor(x/8)-minBinX;val row=floor(z/8)-minBinZ
        if(column<0||row<0||column>=width||row>=height)return null
        val bin=row.toInt()*width+column.toInt()
        return sampleRows(x,z,offsets[bin],offsets[bin+1],rows)
    }
    fun query(bounds:TerrainPlanBounds):List<TerrainSurface> {
        val b=bounds
        if(!listOf(b.minX,b.maxX,b.minZ,b.maxZ).all{it.isFinite()}||b.minX>=b.maxX||b.minZ>=b.maxZ)return emptyList()
        val found=ArrayList<TerrainSurface>();val seen=HashSet<Int>()
        fun visit(row:Int){if(!seen.add(row))return;val s=at(row)!!;if(s.minX<b.maxX&&s.maxX>b.minX&&s.minZ<b.maxZ&&s.maxZ>b.minZ)found+=s}
        if(offsets==null){for(row in 0 until length)visit(row);return found}
        val x0=max(0.0,floor(b.minX/8)-minBinX);val x1=min(width-1.0,floor(b.maxX/8)-minBinX)
        val z0=max(0.0,floor(b.minZ/8)-minBinZ);val z1=min(height-1.0,floor(b.maxZ/8)-minBinZ)
        if(x0>x1||z0>z1)return found
        for(z in z0.toInt()..z1.toInt())for(x in x0.toInt()..x1.toInt()) {
            val bin=z*width+x;for(i in offsets[bin] until offsets[bin+1])visit(rows!![i])
        }
        return found
    }
    companion object {
        fun from(mesh:TerrainMesh,cancelled:()->Boolean={false}):TerrainSurfaceTable {
            fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Terrain surface indexing superseded")}
            checkpoint()
            val length=TerrainMaterial.entries.sumOf{mesh.topIndices(it).remaining()/6}
            require(length<=Int.MAX_VALUE/5)
            val coordinates=DoubleArray(length*5);val materials=ByteArray(length);val positions=mesh.positions();var row=0
            for(material in TerrainMaterial.entries) {
                val indices=mesh.topIndices(material);var offset=0
                while(offset+5<indices.limit()) {
                    if(row%256==0)checkpoint()
                    val vertices=intArrayOf(indices[offset]*3,indices[offset+1]*3,indices[offset+2]*3,indices[offset+5]*3)
                    val i=row*5
                    coordinates[i]=vertices.minOf{positions[it]};coordinates[i+1]=vertices.maxOf{positions[it]}
                    coordinates[i+2]=vertices.minOf{positions[it+2]};coordinates[i+3]=vertices.maxOf{positions[it+2]}
                    coordinates[i+4]=vertices.maxOf{positions[it+1]}+.5;materials[row]=material.ordinal.toByte();row++;offset+=6
                }
            }
            var minX=Double.POSITIVE_INFINITY;var minZ=Double.POSITIVE_INFINITY;var maxX=Double.NEGATIVE_INFINITY;var maxZ=Double.NEGATIVE_INFINITY;var references=0.0
            for(ordinal in 0 until length) {
                if(ordinal%256==0)checkpoint();val i=ordinal*5
                val x0=floor(coordinates[i]/8);val x1=floor(coordinates[i+1]/8);val z0=floor(coordinates[i+2]/8);val z1=floor(coordinates[i+3]/8)
                minX=min(minX,x0);minZ=min(minZ,z0);maxX=max(maxX,x1);maxZ=max(maxZ,z1);references+=(x1-x0+1)*(z1-z0+1)
            }
            val width=maxX-minX+1;val height=maxZ-minZ+1;val bins=width*height
            checkpoint()
            if(!bins.isFinite()||bins<=0||bins>1000000||bins!=floor(bins)||!references.isFinite()||references>2000000||references!=floor(references))
                return TerrainSurfaceTable(coordinates,materials,minX,minZ,0,0,null,null)
            val w=width.toInt();val h=height.toInt();val offsets=IntArray(bins.toInt()+1);val rows=IntArray(references.toInt())
            fun visitBins(ordinal:Int,work:(Int)->Unit) {
                val i=ordinal*5
                for(z in (floor(coordinates[i+2]/8)-minZ).toInt()..(floor(coordinates[i+3]/8)-minZ).toInt())
                    for(x in (floor(coordinates[i]/8)-minX).toInt()..(floor(coordinates[i+1]/8)-minX).toInt())work(z*w+x)
            }
            for(ordinal in 0 until length){if(ordinal%256==0)checkpoint();visitBins(ordinal){offsets[it+1]++}}
            for(i in 1 until offsets.size)offsets[i]+=offsets[i-1]
            val cursor=offsets.copyOf()
            for(ordinal in 0 until length){if(ordinal%256==0)checkpoint();visitBins(ordinal){rows[cursor[it]++]=ordinal}}
            checkpoint()
            return TerrainSurfaceTable(coordinates,materials,minX,minZ,w,h,offsets,rows)
        }
    }
}
