package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.PipelineCost
import com.blockcolc.domain.StrictJson
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SnapshotContentReuseTest {
    @get:Rule val temporary=TemporaryFolder()
    private fun document()=DomainDocument.fromJson(JSONObject(javaClass.getResource("/state-oracle.json")!!.readText()).getJSONObject("states").getJSONObject("notes"))
    private fun known(doc:DomainDocument):ValidatedRecordContent {
        val layout=RecordLayout.split(doc)
        return ValidatedRecordContent(RecordLayout.contentDigest(layout.values,layout.records,RecordLayout.verifiedAssetKeysDigest(layout.assets.keys)),doc)
    }
    @Test fun identicalContentReusesValidationButAnExtraLinkStillFails(){
        JdbcStateDatabase(temporary.root.toPath().resolve("state.db")).use{db->
            val doc=document();val candidate=known(doc)
            db.transaction{sql->
                SnapshotStore.save(sql,"same","daily","2026-11-01T00:00:00.000Z","2026-11-01",0,"daily-merged",null,SnapshotStore.prepare(doc))
                val sections=mutableListOf<String>()
                val restored=PipelineCost.collect({name,_,_,_->sections+=name}){SnapshotStore.read(sql,"same",candidate)}
                assertSame(doc,restored);assertFalse(sections.contains("domain.validate"))
                val extraBody="{\"notReferenced\":true}"
                val extra=StrictJson.sha(extraBody)
                sql.execute("INSERT INTO backup_blocks(sha,canonical,bytes) VALUES(?,?,?)",listOf(extra,extraBody,StrictJson.utf8Size(extraBody)))
                sql.execute("INSERT INTO backup_links(root_id,sha) VALUES(?,?)",listOf("same",extra))
                assertThrows(StorageCorruption::class.java){SnapshotStore.read(sql,"same",candidate)}
            }
        }
    }
    @Test fun ADomainShaAloneCannotReuseDifferentRecords(){
        JdbcStateDatabase(temporary.root.toPath().resolve("state.db")).use{db->
            val doc=document();val candidate=known(doc);val next=doc.json()
            next.getJSONArray("quickNotes").getJSONObject(0).put("text","different but valid")
            val changed=DomainDocument.fromJson(next)
            db.transaction{sql->
                val content=SnapshotStore.prepare(changed)
                SnapshotStore.save(sql,"changed","daily","2026-11-01T00:00:00.000Z","2026-11-01",0,"daily-merged",null,content)
                val restored=SnapshotStore.read(sql,"changed",candidate)
                assertNotSame(doc,restored);assertEquals(changed,restored)
                sql.execute("UPDATE backup_roots SET domain_sha=? WHERE id=?",listOf(doc.sha256,"changed"))
                assertThrows(StorageCorruption::class.java){SnapshotStore.read(sql,"changed",candidate)}
            }
        }
    }
    @Test fun matchingMetadataNeverHidesChangedBlockBytes(){
        JdbcStateDatabase(temporary.root.toPath().resolve("state.db")).use{db->
            val doc=document();val candidate=known(doc)
            db.transaction{sql->
                SnapshotStore.save(sql,"same","daily","2026-11-01T00:00:00.000Z","2026-11-01",0,"daily-merged",null,SnapshotStore.prepare(doc))
                sql.execute("UPDATE backup_blocks SET canonical=canonical || ' ' WHERE sha=(SELECT sha FROM backup_links WHERE root_id=? LIMIT 1)",listOf("same"))
                assertThrows(StorageCorruption::class.java){SnapshotStore.read(sql,"same",candidate)}
            }
        }
    }
}
