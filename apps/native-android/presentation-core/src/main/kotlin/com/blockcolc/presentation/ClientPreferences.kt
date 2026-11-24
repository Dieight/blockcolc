package com.blockcolc.presentation

import com.blockcolc.domain.StrictJson
import org.json.JSONObject
import kotlin.math.floor

data class WorldColor(val saturation:Int=100,val brightness:Int=100,val contrast:Int=100)
data class Ambience(val enabled:Boolean=false,val primary:String="forest-birds",val rainEnabled:Boolean=false,val volume:Int=30)

/** Local presentation choices, deliberately outside domain backups and plans.
 * Parsing keeps the actual formal legacy defaults; new values are validated
 * before saving. Changing preferences never moves an adopted deadline. */
data class ClientPreferences(
    val focusMinutes:Int=45,val habitFocusMinutes:Int=45,val habitTargetRounds:Int=10,val breakMinutes:Int=5,
    val lightingQuality:String="cinematic",val constructionOutlineVisibility:String="current",val worldColorAdjustment:WorldColor=WorldColor(),
    val showWorldCoordinates:Boolean=false,val focusGlassTransparency:Int=100,val themeMode:String="system",val fontStyle:String="pixel",
    val returnToFocusReminders:Boolean=true,val autoContinueFocus:Boolean=false,val autoCheckUpdates:Boolean=false,
    val realWeatherEnabled:Boolean=false,val minimalMode:Boolean=false,
    val ambience:Ambience=Ambience(),val language:String="zh-CN",val quickNotesEnabled:Boolean=false,
    val autoExtendFocus:Boolean=false,
) {
    fun validate(){
        require(focusMinutes in 1..180&&habitFocusMinutes in 1..180&&habitTargetRounds in 10..30&&breakMinutes in 0..60)
        require(lightingQuality in setOf("auto","paper","pixel","performance","balanced","cinematic")&&constructionOutlineVisibility in setOf("off","current","all"))
        require(worldColorAdjustment.saturation in 50..150&&worldColorAdjustment.brightness in 80..120&&worldColorAdjustment.contrast in 80..120)
        require(focusGlassTransparency in 0..100&&themeMode in setOf("system","light","dark")&&fontStyle in setOf("pixel","system","mixed"))
        require(language in setOf("zh-CN","en")&&ambientPrimary(ambience.primary)&&ambience.volume in 0..100)
    }
    fun canonical():String {
        validate()
        val color=JSONObject().put("saturation",worldColorAdjustment.saturation).put("brightness",worldColorAdjustment.brightness).put("contrast",worldColorAdjustment.contrast)
        val sound=JSONObject().put("enabled",ambience.enabled).put("primary",ambience.primary).put("rainEnabled",ambience.rainEnabled).put("volume",ambience.volume)
        return StrictJson.render(JSONObject().put("focusMinutes",focusMinutes).put("habitFocusMinutes",habitFocusMinutes).put("habitTargetRounds",habitTargetRounds).put("breakMinutes",breakMinutes)
            .put("lightingQuality",lightingQuality).put("constructionOutlineVisibility",constructionOutlineVisibility).put("worldColorAdjustment",color)
            .put("showWorldCoordinates",showWorldCoordinates).put("focusGlassTransparency",focusGlassTransparency).put("themeMode",themeMode).put("fontStyle",fontStyle)
            .put("returnToFocusReminders",returnToFocusReminders).put("autoContinueFocus",autoContinueFocus).put("autoCheckUpdates",autoCheckUpdates)
            .put("realWeatherEnabled",realWeatherEnabled).put("minimalMode",minimalMode)
            .put("ambience",sound).put("language",language).put("quickNotesEnabled",quickNotesEnabled).also{
                if(autoExtendFocus)it.put("autoExtendFocus",true)
            })
    }
    companion object {
        const val LEGACY_STORAGE_KEY="blockcolc-focus-preferences-v1"
        private val hash=Regex("[a-f0-9]{64}")
        fun ambientPrimary(s:String)=s in setOf("forest-birds","shore-waves")||hash.matches(s)
        private fun number(x:JSONObject,key:String):Double?=(x.opt(key) as? Number)?.toDouble()?.takeIf{it.isFinite()}
        private fun integer(x:JSONObject,key:String,fallback:Int,min:Int,max:Int)=number(x,key)?.let{floor(it+.5).coerceIn(min.toDouble(),max.toDouble()).toInt()}?:fallback
        private fun bool(x:JSONObject,key:String,fallback:Boolean=false)=(x.opt(key) as? Boolean)?:fallback
        private fun choice(x:JSONObject,key:String,fallback:String,vararg allowed:String)=(x.opt(key) as? String)?.takeIf{it in allowed}?:fallback
        fun parse(value:Any?):ClientPreferences {
            val x=value as? JSONObject?:return ClientPreferences()
            if(number(x,"focusMinutes")==null||number(x,"breakMinutes")==null)return ClientPreferences()
            val focus=integer(x,"focusMinutes",45,1,180);val color=x.optJSONObject("worldColorAdjustment")?:JSONObject()
            val sound=x.optJSONObject("ambience")?:JSONObject();val raw=sound.opt("primary") as? String
            val imports=sound.optJSONArray("imports");val legacy=imports?.let{a->(0 until a.length()).mapNotNull{a.opt(it) as? String}.firstOrNull(::ambientPrimary)}
            val primary=raw?.takeIf(::ambientPrimary)?:legacy?:"forest-birds"
            val retired=jsString(sound.opt("primary")) in setOf("evening-lakeside","morning-birdsong","calm-ocean")
            return ClientPreferences(focus,integer(x,"habitFocusMinutes",focus,1,180),integer(x,"habitTargetRounds",10,10,30),integer(x,"breakMinutes",5,0,60),
                choice(x,"lightingQuality","cinematic","auto","paper","pixel","performance","balanced","cinematic"),choice(x,"constructionOutlineVisibility","current","off","current","all"),
                WorldColor(integer(color,"saturation",100,50,150),integer(color,"brightness",100,80,120),integer(color,"contrast",100,80,120)),
                bool(x,"showWorldCoordinates",true),integer(x,"focusGlassTransparency",100,0,100),choice(x,"themeMode","system","light","dark"),choice(x,"fontStyle","pixel","system","mixed"),
                bool(x,"returnToFocusReminders",true),bool(x,"autoContinueFocus"),bool(x,"autoCheckUpdates"),bool(x,"realWeatherEnabled"),bool(x,"minimalMode"),
                Ambience(bool(sound,"enabled")&&!retired,primary,bool(sound,"rainEnabled"),integer(sound,"volume",30,0,100)),choice(x,"language","zh-CN","en"),bool(x,"quickNotesEnabled"),bool(x,"autoExtendFocus"))
        }
        fun parseText(text:String)=parse(StrictJson.parse(text,1024*1024))
        // Only used for the formal retired-recording migration's String(value).
        private fun jsString(value:Any?):String=when(value){
            null,JSONObject.NULL->"null"
            is org.json.JSONArray->(0 until value.length()).joinToString(","){i->val item=value.opt(i);if(item==null||item==JSONObject.NULL)"" else jsString(item)}
            is JSONObject->"[object Object]"
            else->value.toString()
        }
    }
}
