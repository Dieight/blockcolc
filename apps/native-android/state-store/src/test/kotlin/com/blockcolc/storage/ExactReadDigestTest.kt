package com.blockcolc.storage

import org.junit.Assert.*
import org.junit.Test

class ExactReadDigestTest {
    private fun text(vararg values:String)=ExactReadDigest().apply{values.forEach(::text)}.finish()
    @Test fun boundariesAndInvalidSurrogatesCannotAliasValidStoredText(){
        assertNotEquals(text("ab","c"),text("a","bc"))
        assertNotEquals(text("?"),text("\uD800"))
        assertNotEquals(text("\uD800"),text("\uDC00"))
        val a=ExactReadDigest().apply{table(listOf(listOf(null)))}.finish()
        val b=ExactReadDigest().apply{table(listOf(listOf("null")))}.finish()
        assertNotEquals(a,b)
    }
    @Test fun aChangePastManyScratchBuffersStillInvalidatesTheWitness(){
        val prefix="x".repeat(1024*1024+7)
        assertEquals(text(prefix+"😀"),text(prefix+"😀"))
        assertNotEquals(text(prefix+"😀"),text(prefix+"😁"))
    }
}
