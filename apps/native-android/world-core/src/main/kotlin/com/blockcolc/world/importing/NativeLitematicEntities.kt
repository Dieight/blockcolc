package com.blockcolc.world.importing

import com.blockcolc.world.importing.NativeLitematic.invalid
import com.blockcolc.world.importing.NativeLitematic.record
import com.blockcolc.world.resource.ResourceJson
import org.json.JSONArray
import org.json.JSONObject

/** Deliberate allowlist matches the formal importer. Display-affecting dynamic
 * text and item model payloads are rejected instead of silently flattened. */
internal object NativeLitematicEntities {
    private val dyes=setOf("white","orange","magenta","light_blue","yellow","lime","pink","gray","light_gray","cyan","purple","blue","brown","green","red","black")
    private val discarded=setOf("bold","italic","underlined","strikethrough","obfuscated","font","color","shadow_color","insertion","clickEvent","hoverEvent","click_event","hover_event")
    private fun unsupported(message:String):Nothing=throw NativeLitematicError("UNSUPPORTED_BLOCK_ENTITY_DATA",message)
    fun attach(v:NativeLitematic.Voxel,e:Map<String,Any>,dataVersion:Long){
        when(e["id"]){
            "minecraft:piston"->if(v.state.name=="minecraft:moving_piston"){
                moved(e)?.let{v.moved=it;pose(e)?.let{p->v.pose=p}}
            }
            "minecraft:sign","minecraft:hanging_sign"->if(Regex("minecraft:.*sign$").matches(v.state.name)){
                if(v.sign!=null)invalid("Duplicate sign block entity");v.sign=sign(e,dataVersion>=4298)
            }
            "minecraft:campfire"->if(v.state.name in setOf("minecraft:campfire","minecraft:soul_campfire")){
                if(v.campfire!=null)invalid("Duplicate campfire block entity");v.campfire=campfire(e)
            }
        }
    }
    private fun moved(e:Map<String,Any>):JSONObject? {
        if(e.containsKey("blockState")==e.containsKey("movedState"))return null
        val state=e[if(e.containsKey("blockState"))"blockState" else "movedState"] as? Map<*,*>?:return null
        if(state.containsKey("Name")==state.containsKey("id"))return null
        val id=state[if(state.containsKey("Name"))"Name" else "id"] as? String?:return null
        if(id.length>256||!Regex("minecraft:[a-z0-9_.-]+(?:/[a-z0-9_.-]+)*").matches(id)||NativeLitematic.air(id)||id=="minecraft:moving_piston")return null
        if(state.containsKey("Properties")&&state.containsKey("properties"))return null
        val properties=try{NativeLitematic.properties(state[if(state.containsKey("Properties"))"Properties" else "properties"])}catch(_:IllegalArgumentException){return null}
        if(properties.values.any{!Regex("[a-z0-9_./-]+").matches(it)})return null
        return JSONObject().put("blockId",id).apply{if(properties.isNotEmpty())put("properties",JSONObject(properties))}
    }
    private fun pose(e:Map<String,Any>):JSONObject? {
        val facing=e["facing"] as? Int?:return null;val progress=e["progress"] as? Float?:return null
        val extending=e["extending"] as? Byte?:return null;val source=e["source"] as? Byte?:return null
        if(facing !in 0..5||!progress.isFinite()||progress !in 0f..1f||extending.toInt() !in 0..1||source.toInt() !in 0..1)return null
        return JSONObject().put("facing",listOf("down","up","north","south","west","east")[facing]).put("progress",progress.toDouble()).put("extending",extending.toInt()==1).put("source",source.toInt()==1)
    }
    private fun boolean(raw:Any?,fallback:Boolean=false)=when{
        raw==null->fallback;raw==false||(raw is Number&&raw !is Long&&raw.toDouble()==0.0)->false
        raw==true||(raw is Number&&raw !is Long&&raw.toDouble()==1.0)->true
        else->invalid("Expected boolean byte")
    }
    private fun dye(raw:Any?)=(raw?:"black").also{if(it !is String||it !in dyes)invalid("Invalid sign dye")}
    private fun emptyFace()=JSONObject().put("lines",JSONArray()).put("dyeColor","black").put("glowing",false)
    private fun face(raw:Any?,direct:Boolean):JSONObject {
        if(raw==null)return emptyFace();val value=record(raw,"Sign face")
        val messages=value["messages"]?.let{NativeLitematic.list(it,"Sign messages")}?:emptyList()
        if(messages.size>4)invalid("Sign contains more than four lines")
        return JSONObject().put("lines",JSONArray(messages.map{component(it,direct)})).put("dyeColor",dye(value["color"])).put("glowing",boolean(value["has_glowing_text"]))
    }
    private fun sign(e:Map<String,Any>,direct:Boolean):JSONObject {
        if(e.containsKey("front_text")||e.containsKey("back_text"))return JSONObject().put("front",face(e["front_text"],direct)).put("back",face(e["back_text"],direct))
        val fields=listOf("Text1","Text2","Text3","Text4").filter{e.containsKey(it)}
        if(fields.isEmpty())return JSONObject().put("front",emptyFace()).put("back",emptyFace())
        val front=JSONObject().put("lines",JSONArray(fields.map{component(e.getValue(it),false)})).put("dyeColor",dye(e["Color"])).put("glowing",boolean(e["GlowingText"]))
        return JSONObject().put("front",front).put("back",emptyFace())
    }
    private fun component(raw:Any,direct:Boolean):String {
        var value=raw
        if(!direct){val text=raw as? String?:invalid("Expected serialized text component");if(text.length>8192)invalid("Sign component too long");if(text.isEmpty())return ""
            value=try{ResourceJson.parse(text.toByteArray(Charsets.UTF_8))}catch(e:Exception){invalid("Invalid serialized sign JSON")}}
        var nodes=0
        fun bounded(text:String)=text.also{if(it.length>256||it.any{c->c.code<=31||c.code==127})invalid("Sign line limit exceeded")}
        fun flatten(value:Any?,depth:Int):String {
            NativeLitematic.enforce(depth<=8&&++nodes<=64,"Sign component structure limit exceeded")
            if(value is String)return bounded(value)
            if(value is JSONArray)return bounded((0 until value.length()).joinToString(""){flatten(value.get(it),depth+1)})
            if(value is List<*>)return bounded(value.joinToString(""){flatten(it,depth+1)})
            val record=if(value is JSONObject)value.keys().asSequence().associateWith{value.get(it)}else record(value,"Sign component")
            if(direct&&record.size==1&&record.containsKey(""))return flatten(record[""],depth+1)
            val plain=record["text"]?.let{it as? String?:invalid("Sign text must be plain")}?:""
            val extra=record["extra"]
            if(extra!=null&&extra !is JSONArray&&extra !is List<*>)invalid("Sign extra must be a list")
            for(key in record.keys)if(key !in discarded&&key !in setOf("text","extra"))unsupported("Sign component contains unsupported display data")
            val suffix=when(extra){is JSONArray->(0 until extra.length()).joinToString(""){flatten(extra.get(it),depth+1)}
                is List<*>->extra.joinToString(""){flatten(it,depth+1)};else->""}
            return bounded(plain+suffix)
        }
        return bounded(flatten(value,0))
    }
    private fun campfire(e:Map<String,Any>):JSONObject {
        val items=e["Items"]?.let{NativeLitematic.list(it,"Campfire Items")}?:emptyList();if(items.size>4)invalid("Too many campfire items")
        val seen=hashSetOf<Long>()
        val slots=items.map{raw->val item=record(raw,"Campfire item");val id=item["id"] as? String?:invalid("Missing item ID")
            if(id.length>256||!Regex("[a-z0-9_.-]+:[a-z0-9_./-]+").matches(id))invalid("Invalid item ID")
            if(item.containsKey("Count")==item.containsKey("count"))invalid("Expected one item count field")
            val count=NativeLitematic.integer(item[if(item.containsKey("Count"))"Count" else "count"],"count");val slot=NativeLitematic.integer(item["Slot"],"Slot")
            if(count !in 1..64||slot !in 0..3||!seen.add(slot))invalid("Invalid campfire item slot/count")
            for(key in listOf("components","tag"))item[key]?.let{if(record(it,key).isNotEmpty())unsupported("Campfire item model components are unsupported")}
            if(item.keys.any{it !in setOf("id","Count","count","Slot","components","tag")})unsupported("Campfire item contains unsupported model data")
            JSONObject().put("slot",slot).put("itemId",id).put("count",count)
        }.sortedBy{it.getInt("slot")}
        return JSONObject().put("slots",JSONArray(slots))
    }
}
