package com.blockcolc.world

import org.junit.Assert.*
import org.junit.Test

class DepthComparisonTest {
    private fun accepts(rule:DepthComparison,a:Double,b:Double)=when(rule){
        DepthComparison.NEVER->false;DepthComparison.ALWAYS->true;DepthComparison.LESS->a<b
        DepthComparison.LESS_EQUAL->a<=b;DepthComparison.EQUAL->a==b;DepthComparison.GREATER_EQUAL->a>=b
        DepthComparison.GREATER->a>b;DepthComparison.NOT_EQUAL->a!=b
    }
    @Test fun allRulesPreserveNearFarOcclusionWithReversedZ() {
        val source=listOf(DepthComparison.NEVER,DepthComparison.ALWAYS,DepthComparison.LESS,DepthComparison.LESS_EQUAL,
            DepthComparison.EQUAL,DepthComparison.GREATER_EQUAL,DepthComparison.GREATER,DepthComparison.NOT_EQUAL)
        for((id,rule)in source.withIndex())for(a in listOf(0.0,.25,.5,.75,1.0))for(b in listOf(0.0,.25,.5,.75,1.0))
            assertEquals("rule=$id a=$a b=$b",accepts(rule,a,b),accepts(reversedDepthComparison(id),1-a,1-b))
    }
    @Test fun standardOpaqueFragmentsPassZeroClearedDepthButRawLessWouldDiscardWorld() {
        assertTrue(accepts(reversedDepthComparison(3),.8,0.0));assertTrue(accepts(reversedDepthComparison(2),.8,0.0))
        assertFalse(accepts(DepthComparison.LESS_EQUAL,.8,0.0));assertFalse(accepts(DepthComparison.LESS,.8,0.0))
    }
    @Test(expected=IllegalArgumentException::class) fun unknownComparisonDoesNotFallBack(){reversedDepthComparison(8)}
}
