package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.StrictJson
import org.json.JSONArray
import org.json.JSONObject

/** Portable facts only. File handles, OS permissions, authentication and
 * derived world data are deliberately absent from this format. */
data class CloudWorkspace(val entries:Map<String,String>,val assets:Map<String,String>) {
    val hashes:Map<String,String> get()=entries.mapValues{StrictJson.sha(it.value)}
    companion object {
        private val packages = setOf("building", "focus")

        fun packageOf(key: String): String = when {
            key == "\$/activeFocusSession" || key == "@plan" ||
                key.startsWith("focusHistory/") || key.startsWith("progressReports/") -> "focus"
            else -> "building"
        }

        fun matchesPackages(hashes: Map<String, String>, heads: Map<String, CloudPackageHead>): Boolean {
            if (heads.keys != packages) return false
            val input = packages.associateWith { StringBuilder() }
            for (key in hashes.keys.sorted()) {
                input.getValue(packageOf(key))
                    .append(StrictJson.render(JSONArray(listOf(key, hashes.getValue(key)))))
                    .append('\n')
            }
            return input.all { (name, wire) -> StrictJson.sha(wire.toString()) == heads.getValue(name).hash }
        }

        private fun slot(section:String)=when(section){"projects","habitBuildings"->"importedBlueprint";"buildingBlueprintResources","decorationBlueprintResources"->"blueprint";else->null}
        fun split(domain:DomainDocument):CloudWorkspace {
            val layout=RecordLayout.split(domain)
            val entries=LinkedHashMap<String,String>()
            layout.values.forEach{(key,value)->entries["\$/"+key]=value}
            for(row in layout.records){
                val value=StrictJson.parse(row.canonical,StrictJson.EXPANDED_LIMIT)
                val field=slot(row.section)
                if(field!=null&&value is JSONObject&&!value.isNull(field))value.put(field,JSONObject().put("\$asset",value.getJSONObject(field).getString("\$nativeAsset")))
                entries[row.section+"/"+row.key]=StrictJson.render(JSONObject().put("ordinal",row.ordinal).put("value",value))
            }
            return CloudWorkspace(entries,layout.assets)
        }
        fun join(entries:Map<String,String>,asset:(String)->String):DomainDocument {
            val values=LinkedHashMap<String,String>();val records=ArrayList<StateRecord>()
            for((key,wire)in entries){
                if(key.startsWith("@"))continue
                require(key.length<=600)
                if(key.startsWith("\$/")){val name=key.substring(2);require(name in RecordLayout.singletons);values[name]=wire;continue}
                val at=key.indexOf('/');require(at>0)
                val section=key.substring(0,at);val id=key.substring(at+1);require(section in RecordLayout.arrays)
                val row=StrictJson.parse(wire) as JSONObject;val value=row.get("value");val field=slot(section)
                if(field!=null&&value is JSONObject&&!value.isNull(field)){
                    val ref=value.getJSONObject(field);require(ref.keys().asSequence().toSet()==setOf("\$asset"))
                    value.put(field,JSONObject().put("\$nativeAsset",ref.getString("\$asset")))
                }
                records.add(StateRecord(section,id,row.getInt("ordinal"),StrictJson.render(value)))
            }
            val normalized=records.groupBy{it.section}.flatMap{(_,rows)->rows.sortedWith(compareBy<StateRecord>{it.ordinal}.thenBy{it.key}).mapIndexed{i,row->row.copy(ordinal=i)}}
            return RecordLayout.join(values,normalized){sha->asset(sha).also{require(StrictJson.sha(it)==sha){"CLOUD_ASSET_DIGEST"}}}
        }
        fun recovery(entries:Map<String,String>,domain:DomainDocument):RecoveryContext {
            val plan=entries["@plan"]?.let{JSONObject(it).opt("plan")}?:JSONObject.NULL
            return RecoveryContext.parse(StrictJson.render(JSONObject().put("schema",1).put("plan",plan).put("automatic",JSONObject.NULL)),domain)
        }
        /** CAS compares the last acknowledged remote value, never a new
         * value guessed from the latest local edit. Deletions are explicit. */
        fun changes(local:Map<String,String>,baseline:Map<String,String>):List<JSONObject> =
            (local.keys+baseline.keys).filter{local[it]?.let(StrictJson::sha)!=baseline[it]}.sorted().map{key->
                JSONObject().put("key",key).put("before",baseline[key]?:JSONObject.NULL).put("canonical",local[key]?:JSONObject.NULL)
            }
    }
}

data class CloudPackageHead(val revision: Long, val hash: String) {
    fun json() = JSONObject().put("revision", revision).put("hash", hash)

    companion object {
        fun readAll(document: JSONObject?): Map<String, CloudPackageHead> {
            if(document==null)return emptyMap()
            return document.keys().asSequence().associateWith { name ->
                val item = document.getJSONObject(name)
                CloudPackageHead(item.getLong("revision"), item.getString("hash"))
            }
        }
    }
}

data class CloudBaseline(val account:String,val epoch:String,val revision:Long,val hashes:Map<String,String>,
    val execution:Long=0, val packages:Map<String,CloudPackageHead> = emptyMap()){
    fun canonical()=StrictJson.render(JSONObject().put("account",account).put("epoch",epoch).put("revision",revision)
        .put("hashes",JSONObject(hashes)).put("execution",execution).put("packages",JSONObject(packages.mapValues { it.value.json() })))
    companion object {
        fun parse(text:String):CloudBaseline {
            val x=JSONObject(text);val hashes=x.getJSONObject("hashes")
            return CloudBaseline(x.getString("account"),x.getString("epoch"),x.getLong("revision"),
                hashes.keys().asSequence().associateWith{hashes.getString(it)},x.optLong("execution"),
                CloudPackageHead.readAll(x.optJSONObject("packages")))
        }
    }
}
