package com.blockcolc.presentation

import com.blockcolc.domain.DomainDocument
import org.json.JSONObject

data class ProjectCompletion(val projectId:String,val title:String){
    companion object {
        /** Same committed-event boundary as the formal completion ceremony.
         * Replayed receipts and imported finished projects do not celebrate. */
        fun from(domain:DomainDocument,events:List<String>,replayed:Boolean=false):ProjectCompletion? {
            if(replayed)return null
            val sealed=events.asSequence().map{JSONObject(it)}.firstOrNull{it.optString("type")=="ProjectSealedAsMonument"}?:return null
            val id=sealed.optString("projectId");val projects=domain.json().getJSONArray("projects")
            val project=(0 until projects.length()).map{projects.getJSONObject(it)}.firstOrNull{it.getString("id")==id}?:return null
            return ProjectCompletion(id,project.getString("title"))
        }
    }
}
