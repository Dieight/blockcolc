package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.BlueprintReadProofs

/** Owner addresses are taken from the verified SQL layout and compared with
 * the validated document before it can supply independent blueprint headers. */
data class BlueprintCheckpointSource internal constructor(val digest:String,val owners:Map<String,Pair<String,String>>)

/** Optional authenticated indexes. The caller reads and verifies actual SQL
 * bodies first, and reconstructs recovery from its own transaction. */
interface DomainReadCache {
    /** A scheduling hint only. Cache reads still authenticate against the verified rows. */
    fun indexesAbsent(contentDigest:String,domainSha:String,assetDigest:String):Boolean=false
    fun read(contentDigest:String,domainSha:String,parts:()->List<String>):DomainDocument?
    fun readBlueprints(assetDigest:String):BlueprintReadProofs?=null
    fun offer(contentDigest:String,domain:DomainDocument,blueprints:BlueprintCheckpointSource?=null)
}
