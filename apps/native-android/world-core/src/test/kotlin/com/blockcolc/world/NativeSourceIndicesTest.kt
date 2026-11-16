package com.blockcolc.world

import org.junit.Assert.*
import org.junit.Test

class NativeSourceIndicesTest {
    @Test fun sparseAndDenseMembershipRetainOrderAcrossWordBoundariesAndFreezeOwnership(){
        val builder=NativeSourceIndexSet.Builder(500003);val expected=linkedSetOf<Int>()
        for(i in 0..500002)if(i%3!=0){builder+=i;expected+=i}
        for(i in listOf(0,63,64,65,500002)){builder+=i;expected+=i}
        val snapshot=builder.freeze()
        assertEquals(expected.sorted(),snapshot.toList());assertEquals(expected.size,snapshot.size)
        for(i in -1..500003)assertEquals(i in expected,i in snapshot)
        builder+=499998;assertFalse(499998 in snapshot)
        assertEquals(emptyList<Int>(),NativeSourceIndexSet.Builder(0).freeze().toList())
    }
    @Test fun entityExclusionsUnionDoesNotCopyDenseModelMembershipOrRepeatIndices(){
        val builder=NativeSourceIndexSet.Builder(200001);for(i in 0..200000 step 2)builder+=i
        val models=builder.freeze();assertSame(models,NativeSourceIndices.unionView(models,emptySet()))
        val union=NativeSourceIndices.unionView(models,linkedSetOf(2,5,11))
        assertEquals(models.size+2,union.size);assertTrue(5 in union);assertFalse(7 in union)
        assertEquals(models.toList()+listOf(5,11),union.toList())
    }
}
