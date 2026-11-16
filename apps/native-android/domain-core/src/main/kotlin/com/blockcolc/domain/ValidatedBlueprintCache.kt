package com.blockcolc.domain

/** Proof of a successful validation of exact normalized content and limits.
 * Never retains caller JSON, a document, or large imported voxel archives. */
internal object ValidatedBlueprintCache {
    private data class Key(val decoration:Boolean,val fingerprint:String)
    private val entries=LinkedHashMap<Key,Unit>(16,.75f,true)
    @Synchronized fun contains(decoration:Boolean,fingerprint:String)=entries[Key(decoration,fingerprint)]!=null
    @Synchronized fun remember(decoration:Boolean,fingerprint:String){
        val key=Key(decoration,fingerprint)
        if(entries.containsKey(key))return
        if(entries.size>=32){
            val iterator=entries.entries.iterator();iterator.next();iterator.remove()
        }
        entries[key]=Unit
    }
    fun fingerprint(value:org.json.JSONObject):String?=Encoder().run{
        if(!emit(value))null else finish()
    }
    /** Tagged, length-delimited UTF-16 / binary64 content, with sorted object
     * keys and ordered arrays. SHA-256 avoids an entire canonical rendering on
     * every command. Work is bounded to small catalogue-sized inputs. */
    private class Encoder {
        private val digest=java.security.MessageDigest.getInstance("SHA-256")
        private val buffer=ByteArray(4096);private var at=0;private var nodes=0;private var characters=0
        private fun byte(value:Int){if(at==buffer.size)flush();buffer[at++]=value.toByte()}
        private fun flush(){digest.update(buffer,0,at);at=0}
        private fun integer(value:Int){for(shift in 24 downTo 0 step 8)byte(value ushr shift)}
        private fun text(value:String):Boolean {
            if(value.length>64*1024-characters)return false;characters+=value.length
            integer(value.length)
            for(c in value){byte(c.code ushr 8);byte(c.code)}
            return true
        }
        fun emit(value:Any):Boolean {
            if(++nodes>20000)return false
            when(value){
                org.json.JSONObject.NULL->byte(0)
                is org.json.JSONObject->{byte(1);integer(value.length());for(key in value.keys().asSequence().toList().sorted()){
                    if(!text(key)||!emit(value.get(key)))return false
                }}
                is org.json.JSONArray->{byte(2);integer(value.length());for(i in 0 until value.length())if(!emit(value.get(i)))return false}
                is String->{byte(3);if(!text(value))return false}
                is Boolean->{byte(4);byte(if(value)1 else 0)}
                is Number->{val n=value.toDouble();if(!n.isFinite())return false;byte(5)
                    val bits=java.lang.Double.doubleToLongBits(n);for(shift in 56 downTo 0 step 8)byte((bits ushr shift).toInt())}
                else->return false
            }
            return true
        }
        fun finish():String {
            flush();val bytes=digest.digest();val hex="0123456789abcdef"
            return String(CharArray(bytes.size*2){i->val value=bytes[i/2].toInt() and 255;hex[if(i%2==0)value ushr 4 else value and 15]})
        }
    }
}
