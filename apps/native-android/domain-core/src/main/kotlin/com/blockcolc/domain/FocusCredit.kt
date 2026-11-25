package com.blockcolc.domain

import org.json.JSONObject

fun countsAsFocusRound(record: JSONObject): Boolean =
    record.getString("status") != "interrupted" && record.optJSONObject("external")?.getBoolean("credited") != false
