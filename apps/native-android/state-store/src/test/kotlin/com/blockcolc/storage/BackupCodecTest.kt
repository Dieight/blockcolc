package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.StrictJson
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BackupCodecTest {
    private fun oracle() = JSONObject(javaClass.getResource("/backup-oracle.json")!!.readText())
    @Test fun envelopeOneTwoAndHistoricalDomainMatchFormalReader() {
        val cases = oracle().getJSONArray("cases"); val errors = arrayListOf<String>()
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i); val result = runCatching { BackupCodec.read(c.getString("text")) }
            if (result.isSuccess != c.getBoolean("ok")) errors.add(c.getString("name") + ": " + result.exceptionOrNull())
            else if (result.isSuccess && result.getOrThrow().domain.canonical != c.getString("canonical")) errors.add(c.getString("name") + ": complete output differs")
        }
        assertTrue(errors.joinToString("\n"), errors.isEmpty())
    }
    @Test fun bothNativeExportsHaveFormalChecksumAndContent() {
        val outputs = oracle().getJSONArray("outputs")
        for (i in 0 until outputs.length()) {
            val c = outputs.getJSONObject(i); val doc = DomainDocument.fromJson(c.getJSONObject("domain"))
            for (compact in listOf(false, true)) {
                val wire = BackupCodec.write(doc, c.getString("exportedAt"), compact)
                assertEquals(c.getString("name"), c.getString(if (compact) "compact" else "legacy"), wire)
                assertEquals(doc, BackupCodec.read(wire).domain)
            }
        }
    }
    @Test fun stricterWireGateRejectsAmbiguousKeysAndBadUtf8() {
        val v = oracle().getJSONArray("outputs").getJSONObject(0).getString("legacy")
        val ambiguous = v.replaceFirst("\"schemaVersion\":1", "\"schemaVersion\":2,\"schemaVersion\":1")
        assertTrue(runCatching { BackupCodec.read(ambiguous) }.isFailure)
        assertTrue(runCatching { BackupCodec.read(byteArrayOf(0xff.toByte())) }.isFailure)
    }
    @Test fun measuredBytesEqualEncodedCanonicalBytesWithoutMaterializingTwice() {
        val cases = listOf("{\"emoji\":\"😀\",\"control\":\"\\u0001\\n\\t\",\"n\":1e30}", "[null,true,false,0.3,\"汉字\"]")
        for (c in cases) { val v = StrictJson.parse(c); assertEquals(StrictJson.render(v).toByteArray(Charsets.UTF_8).size.toLong(), StrictJson.measure(v)) }
    }
}
