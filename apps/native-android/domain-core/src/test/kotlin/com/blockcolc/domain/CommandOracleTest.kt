package com.blockcolc.domain

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CommandOracleTest {
    @Test fun everyCommandMatchesFullFormalStateEventsAndFailureCode() {
        val oracle = JSONObject(javaClass.getResource("/command-oracle.json")!!.readText()); val cases = oracle.getJSONArray("cases"); val failures = arrayListOf<String>()
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i); val before = DomainDocument.fromJson(c.getJSONObject("before")); val result = DomainEngine.execute(before, c.getJSONObject("command"), c.getLong("now")); val name = c.getString("name") + "/" + c.getJSONObject("command").getString("type")
            if (c.getBoolean("ok") != result.ok || (if (c.isNull("error")) null else c.getString("error")) != result.error) failures.add("$name: ok=${result.ok} code=${result.error} wanted ${c.get("ok")}/${c.get("error")}")
            else if (result.state.canonical != c.getString("canonical")) failures.add("$name: complete state differs")
            else if ("[" + result.events.joinToString(",") + "]" != c.getString("events")) failures.add("$name: events differ: ${result.events}")
            if (!result.ok && result.state !== before) failures.add("$name: failure adopted mutated state")
        }
        assertTrue(failures.take(50).joinToString("\n"), failures.isEmpty())
    }
    @Test fun initialStateHasFormalDefaultsAndNoSeedTasks() {
        val oracle = JSONObject(javaClass.getResource("/state-oracle.json")!!.readText())
        assertEquals(DomainDocument.fromJson(oracle.getJSONObject("states").getJSONObject("empty")), DomainEngine.initial("Asia/Shanghai"))
    }
}
