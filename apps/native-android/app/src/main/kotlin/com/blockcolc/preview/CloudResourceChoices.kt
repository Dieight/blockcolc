package com.blockcolc.preview

import android.content.Context
import org.json.JSONObject

/** Shared preference references, never the imported files. A missing local
 * original keeps this desired choice until an explicit local selection; the
 * renderer may fall back without publishing that fallback to other devices. */
internal class CloudResourceChoices(context:Context,name:String="cloud-resource-choice"){
    private val prefs=context.getSharedPreferences(name,Context.MODE_PRIVATE)
    fun read():JSONObject?=prefs.getString("choice",null)?.let(::JSONObject)
    fun save(active:String?,base:String?){
        require(listOfNotNull(active,base).all{it.matches(Regex("[a-f0-9]{64}"))})
        val value=JSONObject().put("activeId",active?:JSONObject.NULL).put("baseId",base?:JSONObject.NULL).toString()
        if(prefs.getString("choice",null)!=value)check(prefs.edit().putString("choice",value).commit())
    }
}
