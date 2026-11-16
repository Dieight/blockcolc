package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.junit.Assert.*
import org.junit.Test

class OceanTileCoverageTest {
    @Test fun refinedIsletsAndFarRingsHaveExactlyOneTopSurfaceAtEveryWaterColumn(){
        for(radius in listOf(26.0,70.0,128.0)){
            val mesh=SteppedTerrain.generate(emptyList(),emptyList(),emptyList(),Position2(radius,radius),TerrainOptions(WorldEnvironment.OCEAN,"world-default",4))
            val b=mesh.bounds;val width=((b.maxX-b.minX)/2).toInt();val height=((b.maxZ-b.minZ)/2).toInt()
            val coverage=ByteArray(width*height);val positions=mesh.positions()
            for(material in TerrainMaterial.entries){val indices=mesh.topIndices(material);var row=0
                while(row<indices.remaining()){
                    var x0=Double.POSITIVE_INFINITY;var x1=Double.NEGATIVE_INFINITY;var z0=x0;var z1=x1
                    repeat(6){k->val v=indices[row+k]*3;x0=minOf(x0,positions[v]);x1=maxOf(x1,positions[v]);z0=minOf(z0,positions[v+2]);z1=maxOf(z1,positions[v+2])}
                    for(z in ((z0-b.minZ)/2).toInt() until ((z1-b.minZ)/2).toInt())for(x in ((x0-b.minX)/2).toInt() until ((x1-b.minX)/2).toInt()){
                        val index=z*width+x;assertEquals("radius=$radius overlapping top at $x,$z",0,coverage[index].toInt());coverage[index]=1
                    };row+=6
                }
            }
            assertEquals("radius=$radius must have no open-water holes",0,coverage.count{it.toInt()==0})
        }
    }
}
