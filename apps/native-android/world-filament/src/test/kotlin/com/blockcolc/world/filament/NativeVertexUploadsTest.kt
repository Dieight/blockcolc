package com.blockcolc.world.filament

import java.nio.ByteBuffer
import java.nio.FloatBuffer
import org.junit.Assert.*
import org.junit.Test

class NativeVertexUploadsTest {
    @Test fun largeInputKeepsGeometryAttributesAndNormalFramesAcrossBoundedUploadChunks(){
        val count=NativeVertexUploads.CHUNK_VERTICES+5
        val normals=listOf(floatArrayOf(0f,1f,0f),floatArrayOf(0f,0f,1f),floatArrayOf(0f,0f,-1f),floatArrayOf(2f,0f,0f),floatArrayOf(0f,0f,0f))
        val source=FloatArray(count*12+3)
        repeat(count){i->
            val at=3+i*12
            source[at]=i*1.5f;source[at+1]=-i.toFloat();source[at+2]=(i%3).toFloat()
            repeat(3){source[at+3+it]=normals[i%normals.size][it]}
            repeat(6){source[at+6+it]=(i+it*.125).toFloat()}
        }
        val input=FloatBuffer.wrap(source).apply{position(3)}
        val offsets=mutableListOf<Int>();var staging:ByteBuffer?=null;var rows=0
        NativeVertexUploads.each(input,count){offset,data->
            offsets+=offset
            assertTrue(data.isDirect)
            assertTrue(data.remaining()<=1024*1024)
            if(staging==null)staging=data else assertSame("The bounded staging allocation is reused",staging,data)
            while(data.hasRemaining()){
                val at=3+rows*12
                repeat(3){assertEquals(source[at+it],data.float,0f)}
                val q=FloatArray(4){data.float}
                assertEquals(1f,q.sumOf{it.toDouble()*it}.toFloat(),1e-5f)
                repeat(6){assertEquals(source[at+6+it],data.float,0f)}
                val expected=when(rows%5){0,4->floatArrayOf(0f,1f,0f);1->floatArrayOf(0f,0f,1f);2->floatArrayOf(0f,0f,-1f);else->floatArrayOf(1f,0f,0f)}
                val custom=FloatArray(3){data.float}
                val rotatedZ=floatArrayOf(2*(q[0]*q[2]+q[1]*q[3]),2*(q[1]*q[2]-q[0]*q[3]),1-2*(q[0]*q[0]+q[1]*q[1]))
                repeat(3){assertEquals(expected[it],custom[it],1e-5f);assertEquals(expected[it],rotatedZ[it],1e-5f)}
                rows++
            }
        }
        assertEquals(listOf(0,NativeVertexUploads.CHUNK_VERTICES*64),offsets)
        assertEquals(count,rows);assertEquals(3,input.position())
    }
    @Test fun invalidGeometryCannotStartAnUploadOrAdvanceTheSource(){
        val input=FloatBuffer.wrap(FloatArray(12))
        for(count in listOf(0,2,4_000_001)){
            assertThrows(IllegalArgumentException::class.java){NativeVertexUploads.each(input,count){_,_->fail("Invalid upload")}}
            assertEquals(0,input.position())
        }
    }
    @Test fun aFailedConsumerStopsBeforeTheNextChunk(){
        val input=FloatBuffer.wrap(FloatArray((NativeVertexUploads.CHUNK_VERTICES+1)*12))
        var calls=0;val failure=IllegalStateException("upload rejected")
        assertSame(failure,assertThrows(IllegalStateException::class.java){NativeVertexUploads.each(input,NativeVertexUploads.CHUNK_VERTICES+1){_,_->calls++;throw failure}})
        assertEquals(1,calls);assertEquals(0,input.position())
    }
}
