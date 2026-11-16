package com.blockcolc.presentation

import com.blockcolc.domain.StrictJson
import org.json.JSONObject
import java.util.Collections

/** Shared formal copy and glyphs. Load once on the host IO actor before the
 * ready state, never translate user-entered text or perform IO during drawing. */
class UiResources private constructor(val english:Map<String,String>,val icons:Map<String,List<String>>,val iconMotion:Map<String,PixelMotionIcon>){
    fun text(language:String,key:String,vararg values:Any?):String {
        val template=if(language=="en")english[key]?:NativeSystemCopy.english[key]?:NativeCopy.english[key]?:key else key
        if('{' !in template)return template
        return placeholder.replace(template){match->values.getOrNull(match.groupValues[1].toIntOrNull()?:-1)?.toString()?:""}
    }
    companion object {
        private val placeholder=Regex("\\{(\\d+)\\}")
        /** Only the real storage loading artwork reads this. The workspace
         * always receives the complete translations and glyph catalogue. */
        val storageLoading=UiResources(mapOf("方块钟" to "Blockcolc","本机记录" to "Local records",
            "正在读取本机记录" to "Reading local records"),emptyMap(),emptyMap())
        fun load():UiResources{
            val stream=checkNotNull(UiResources::class.java.getResourceAsStream("/native-ui-assets.json")){"Native UI resources were not generated"}
            val bytes=stream.use{input->val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192);while(true){val n=input.read(buffer);if(n<0)break;require(out.size()+n<=4*1024*1024);out.write(buffer,0,n)};out.toByteArray()}
            return parse(StrictJson.decode(bytes,4*1024*1024))
        }
        fun parse(text:String):UiResources {
            val root=StrictJson.parse(text,4*1024*1024) as JSONObject;require(root.getInt("schema")==1)
            val en=root.getJSONObject("en");require(en.length() in 1..10000)
            val english=linkedMapOf<String,String>();en.keys().forEach{k->val value=en.get(k);require(value is String);english[k]=value}
            val glyphs=root.getJSONObject("icons");require(glyphs.length() in 1..128)
            val icons=linkedMapOf<String,List<String>>();glyphs.keys().forEach{k->
                val a=glyphs.getJSONArray(k);require(a.length()==12)
                icons[k]=Collections.unmodifiableList(List(12){i->a.getString(i).also{row->require(row.length==12&&row.all{it=='0'||it=='1'})}})
            }
            val raw=root.optJSONObject("iconMotion")
            val motions=raw?.let{require(it.length()<=128);it.keys().asSequence().associateWith{key->PixelMotionIcon.read(it.getJSONObject(key))}}.orEmpty()
            return UiResources(Collections.unmodifiableMap(english),Collections.unmodifiableMap(icons),Collections.unmodifiableMap(motions))
        }
    }
}
