package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.StrictJson
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SnapshotBlockBatchTest {
    @get:Rule val temporary=TemporaryFolder()
    private fun document():DomainDocument {
        val root=JSONObject(javaClass.getResource("/state-oracle.json")!!.readText()).getJSONObject("states").getJSONObject("notes")
        root.put("quickNotes",JSONArray().also{rows->repeat(100){i->rows.put(JSONObject().put("id","note-$i")
            .put("text","便签 $i 😀").put("completed",false).put("createdAt","2026-10-01T00:00:00.000Z"))}})
        return DomainDocument.fromJson(root)
    }
    @Test fun manySmallBlocksUseBoundedBatchQueriesAndPreserveTheCompleteDocument(){
        JdbcStateDatabase(temporary.root.toPath().resolve("batch.db")).use{db->
            val doc=document();val prepared=SnapshotStore.prepare(doc)
            db.transaction{sql->SnapshotStore.save(sql,"batch","daily","2026-10-23T08:00:00.000Z","2026-10-23",0,"daily-merged",null,prepared)}
            var batches=0;var pointReads=0
            val restored=db.transaction{sql->SnapshotStore.read(object:SqlSession by sql {
                override fun largeTextRows(text:String,args:List<Any?>):List<List<String>>{
                    if(text.contains("FROM backup_blocks")){
                        if(text.contains("sha IN")){batches++;assertTrue(args.size<=64)}else pointReads++
                    }
                    return sql.largeTextRows(text,args)
                }
            },"batch")}
            assertEquals(doc.canonical,restored.canonical);assertEquals(doc.sha256,restored.sha256)
            assertTrue("The fixture must contain many independent blocks",prepared.blocks.size>100)
            assertTrue("Small records must not open one cursor each",batches in 2..3);assertEquals(0,pointReads)
        }
    }
    @Test fun batchReadsStillRejectCorruptSizesBodiesAndExtraReferences(){
        for(kind in listOf("size","body","extra-link")){
            JdbcStateDatabase(temporary.root.toPath().resolve("$kind.db")).use{db->
                val doc=document();val prepared=SnapshotStore.prepare(doc)
                db.transaction{sql->
                    SnapshotStore.save(sql,"batch","daily","2026-10-23T08:00:00.000Z","2026-10-23",0,"daily-merged",null,prepared)
                    when(kind){
                        "size"->sql.execute("UPDATE backup_blocks SET bytes=bytes+1 WHERE sha=(SELECT sha FROM backup_blocks LIMIT 1)")
                        "body"->sql.execute("UPDATE backup_blocks SET canonical='null' WHERE sha=(SELECT sha FROM backup_blocks LIMIT 1)")
                        else->{val body="\"extra\"";val sha=StrictJson.sha(body)
                            sql.execute("INSERT INTO backup_blocks(sha,canonical,bytes) VALUES(?,?,?)",listOf(sha,body,body.length))
                            sql.execute("INSERT INTO backup_links(root_id,sha) VALUES(?,?)",listOf("batch",sha))}
                    }
                }
                assertThrows(kind,StorageCorruption::class.java){db.transaction{SnapshotStore.read(it,"batch")}}
            }
        }
    }
}
