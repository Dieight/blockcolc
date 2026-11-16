package com.blockcolc.world.generation

import java.nio.ByteBuffer
import java.util.concurrent.CancellationException

/** Same-colour full-glass unions keep only exterior faces and only the union's
 * boundary lines. Panes continue through the separate state/component route. */
object ConnectedOriginalGlass {
    private val id=Regex("^minecraft:(glass|(?:white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_stained_glass)$")
    fun accepts(v:RenderVoxel)=v.sourceBlockId==null&&v.materialId=="glass"||v.sourceBlockId?.matches(id)==true
    private data class Face(val n:IntArray,val corners:Array<DoubleArray>)
    private fun face(x:Int,y:Int,z:Int,vararg corners:DoubleArray)=Face(intArrayOf(x,y,z),arrayOf(*corners))
    private val faces=listOf(
        face(1,0,0,doubleArrayOf(.5,-.5,.5),doubleArrayOf(.5,-.5,-.5),doubleArrayOf(.5,.5,-.5),doubleArrayOf(.5,.5,.5)),
        face(-1,0,0,doubleArrayOf(-.5,-.5,-.5),doubleArrayOf(-.5,-.5,.5),doubleArrayOf(-.5,.5,.5),doubleArrayOf(-.5,.5,-.5)),
        face(0,1,0,doubleArrayOf(-.5,.5,.5),doubleArrayOf(.5,.5,.5),doubleArrayOf(.5,.5,-.5),doubleArrayOf(-.5,.5,-.5)),
        face(0,-1,0,doubleArrayOf(-.5,-.5,-.5),doubleArrayOf(.5,-.5,-.5),doubleArrayOf(.5,-.5,.5),doubleArrayOf(-.5,-.5,.5)),
        face(0,0,1,doubleArrayOf(-.5,-.5,.5),doubleArrayOf(.5,-.5,.5),doubleArrayOf(.5,.5,.5),doubleArrayOf(-.5,.5,.5)),
        face(0,0,-1,doubleArrayOf(.5,-.5,-.5),doubleArrayOf(-.5,-.5,-.5),doubleArrayOf(-.5,.5,-.5),doubleArrayOf(.5,.5,-.5)))
    private data class Cell(val x:Double,val y:Double,val z:Double)
    private fun cell(x:Double,y:Double,z:Double)=Cell(if(x==0.0)0.0 else x,if(y==0.0)0.0 else y,if(z==0.0)0.0 else z)
    fun surface(voxels:List<RenderVoxel>,maximumVertices:Int=6_000_000,cancelled:()->Boolean={false}):BlockGeometry {
        require(maximumVertices in 0..6_000_000)
        fun checkpoint(){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Glass geometry superseded")}
        checkpoint();val cells=HashSet<Cell>()
        for((i,v)in voxels.withIndex()){if(i%256==0)checkpoint();cells+=cell(v.x,v.y,v.z)}
        val p=FloatAttributeBuilder(maximumVertices*3);val n=FloatAttributeBuilder(maximumVertices*3);val uv=FloatAttributeBuilder(maximumVertices*2);val indices=IndexAttributeBuilder(maximumVertices/4*6)
        for((i,v)in voxels.withIndex()) {
            if(i%128==0)checkpoint()
            for(face in faces) {
                val normal=face.n;val c=face.corners
                if(cell(v.x+normal[0],v.y+normal[1],v.z+normal[2])in cells)continue
                val u=DoubleArray(3){c[1][it]-c[0][it]};val up=DoubleArray(3){c[3][it]-c[0][it]}
                fun adjacent(delta:DoubleArray)=cell(v.x+delta[0],v.y+delta[1],v.z+delta[2])in cells&&cell(v.x+delta[0]+normal[0],v.y+delta[1]+normal[1],v.z+delta[2]+normal[2])!in cells
                val mask=(if(adjacent(u))0 else 2)or(if(adjacent(DoubleArray(3){-u[it]}))0 else 1)or(if(adjacent(up))0 else 8)or(if(adjacent(DoubleArray(3){-up[it]}))0 else 4)
                val base=p.size/3
                for(corner in c){p.add(v.x+corner[0]);p.add(v.y+corner[1]);p.add(v.z+corner[2]);for(axis in normal)n.add(axis.toDouble())}
                val left=(mask%4*32+8)/128.0;val bottom=(mask/4*32+8)/128.0;val size=16/128.0
                for(value in doubleArrayOf(left,bottom,left+size,bottom,left+size,bottom+size,left,bottom+size))uv.add(value)
                for(index in intArrayOf(0,1,2,0,2,3))indices.add(base+index)
            }
        }
        checkpoint();return AttributeBlockGeometry(p.freeze(),n.freeze(),uv.freeze(),index=indices.freeze())
    }
    private val pixelData:ByteArray by lazy {
        val data=ByteArray(128*128*4)
        for(mask in 0 until 16)for(py in 0 until 32)for(px in 0 until 32){
            val x=(px-8).coerceIn(0,15);val y=(py-8).coerceIn(0,15)
            val edge=(mask and 1!=0&&x==0)||(mask and 2!=0&&x==15)||(mask and 4!=0&&y==0)||(mask and 8!=0&&y==15)
            val value=if(edge)186 else 246;val at=((mask/4*32+py)*128+mask%4*32+px)*4
            data[at]=value.toByte();data[at+1]=value.toByte();data[at+2]=value.toByte();data[at+3]=(-1).toByte()
        };data
    }
    fun pixels():ByteBuffer=ByteBuffer.wrap(pixelData).asReadOnlyBuffer()
}
