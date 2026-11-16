package com.blockcolc.domain

import org.junit.Assert.*
import org.junit.Test

class DigestEncodingTest {
    @Test fun everyByteMatchesTheIndependentJdkHexEncoder(){
        val bytes=ByteArray(256){it.toByte()}
        assertEquals(java.util.HexFormat.of().formatHex(bytes),DigestHex.encode(bytes))
        assertEquals("",DigestHex.encode(byteArrayOf()))
    }
    @Test fun canonicalAndExactDigestTextKeepTheirExistingEncoding(){
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",StrictJson.sha(""))
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",StrictJson.sha("abc"))
        val source=DomainEngine.initial("UTC").json()
        val original=DomainDocument.fromOwnedJson(StrictJson.copy(source) as org.json.JSONObject)
        for(hint in listOf(-1,16,1024,Int.MAX_VALUE))assertEquals(original,DomainDocument.fromOwnedJson(StrictJson.copy(source) as org.json.JSONObject,hint))
    }
}
