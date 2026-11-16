package com.blockcolc.storage

import com.blockcolc.domain.BlueprintReadProofs
import com.blockcolc.domain.CanonicalReadCandidate
import com.blockcolc.domain.PipelineCost
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorCompletionService
import java.util.concurrent.Executors

/** Only the transaction owner touches SQLite. Workers receive immutable text
 * and finish all address checks before these rows can enter the decoder. */
internal class ColdAssetRead private constructor(val assets:Map<String,String>,val scans:BlueprintReadProofs?,
    val rawCandidate:CanonicalReadCandidate?){
    companion object {
        fun load(sql:SqlSession,keys:List<String>,values:Map<String,String>,records:List<StateRecord>,
                 scanMissingIndexes:Boolean):ColdAssetRead = PipelineCost.section("storage.asset-read-pipeline"){
            val owners=if(scanMissingIndexes)try{RecordLayout.assetOwners(records)}catch(_:Exception){null}else null
            val lanes=if(owners==null)1 else 2
            val workers=Executors.newFixedThreadPool(lanes){task->Thread(task,"blockcolc-asset-read").apply{isDaemon=true}}
            val completed=ExecutorCompletionService<Pair<String,BlueprintReadProofs.Scan?>>(workers)
            val hashers=object:ThreadLocal<AssetTextHasher>(){
                override fun initialValue()=AssetTextHasher()
            }
            val assets=LinkedHashMap<String,String>(keys.size)
            val scans=HashMap<String,BlueprintReadProofs.Scan>()
            var pending=0
            var characters=0L
            fun receive(){
                val (sha,scan)=try{completed.take().get()}catch(error:ExecutionException){throw error.cause?:error}
                pending--
                if(scan!=null)scans[sha]=scan
            }
            try{
                for(sha in keys){
                    if(pending>=lanes*2)receive()
                    val wire=sql.blueprintBody(sha)
                    check(assets.put(sha,wire)==null){"Duplicate blueprint address"}
                    characters+=wire.length
                    val owner=owners?.get(sha)
                    completed.submit{
                        checkNotNull(hashers.get()).verify(sha,wire)
                        val scan=if(owner!=null&&wire.length>=4096)try{
                            BlueprintReadProofs.scanCurrentWire(wire,owner.first=="decorationBlueprintResources")
                        }catch(_:Exception){null}else null
                        sha to scan
                    }
                    pending++
                }
                val candidate=if(owners!=null&&characters in (1024L*1024+1)..(32L*1024*1024))try{
                    PipelineCost.section("storage.candidate-wire-hash"){
                        CanonicalReadCandidate.digest(RecordLayout.checkpointParts(values,records,assets))
                    }
                }catch(_:Exception){null}else null
                PipelineCost.section("storage.asset-proof-wait"){while(pending>0)receive()}
                ColdAssetRead(assets,scans.takeIf{it.isNotEmpty()}?.let{BlueprintReadProofs.fromCompletedScans(it)},candidate)
            }finally{workers.shutdownNow()}
        }
    }
}
