package com.blockcolc.focus

import com.blockcolc.domain.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class FocusProjectionTest {
    @Test fun everyFormalStepPreservesExactAttributionIncludingUnallocatedAndHabitRounds() {
        val cases = JSONObject(javaClass.getResource("/command-oracle.json")!!.readText()).getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            assertEquals(c.getString("name"), c.getString("attribution"), StrictJson.render(FocusProjection.attribution(DomainDocument.parse(c.getString("canonical")))))
        }
    }
}
