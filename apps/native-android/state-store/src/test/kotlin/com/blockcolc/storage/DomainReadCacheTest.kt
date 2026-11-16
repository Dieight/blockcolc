package com.blockcolc.storage

import com.blockcolc.domain.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import javax.crypto.spec.SecretKeySpec

class DomainReadCacheTest {
    @get:Rule val temporary=TemporaryFolder()
    @Test fun bulkProofKeepsTheExistingExactUtf16Wire() {
        val cells=listOf("", "海岸\u0000", "\uFFFD", "\uD800", "a".repeat(4095)+"\uD83D\uDC1F"+"雪".repeat(4095)+"\uDFFF")+List(200){"行$it".repeat(it)}
        val bytes=java.io.ByteArrayOutputStream()
        java.io.DataOutputStream(bytes).use{legacy->
            for(cell in cells){legacy.writeInt(cell.length);for(unit in cell)legacy.writeChar(unit.code)}
        }
        val expected=DigestHex.encode(java.security.MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray()))
        val proof=ExactReadDigest();cells.forEach(proof::text)
        assertEquals(expected,proof.finish())
    }
    @Test fun assetAddressesRequireExactUtf8AcrossChunkBoundaries(){
        val bodies=listOf("", "海岸?", "a".repeat(4095)+"🐟"+"雪".repeat(4096), "b".repeat(8192))
        val assets=bodies.associateBy(StrictJson::sha)
        assertEquals(RecordLayout.verifiedAssetKeysDigest(assets.keys),RecordLayout.verifyAssetDigest(assets))
        val original="海岸?";val malformed="海岸\uD800"
        assertThrows(StorageCorruption::class.java){RecordLayout.verifyAssetDigest(mapOf(StrictJson.sha(original) to malformed))}
        assertThrows(StorageCorruption::class.java){RecordLayout.verifyAssetDigest(mapOf(StrictJson.sha(original) to "海岛?"))}
    }
    private fun domain():DomainDocument{
        val root=DomainEngine.initial("UTC").json();root.getJSONObject("worldSettings").put("worldSeed","cache-seed".repeat(40000))
        return DomainDocument.fromOwnedJson(root)
    }
    private class Cache(val file:File):DomainReadCache {
        private val key=SecretKeySpec(ByteArray(32){(it+1).toByte()},"HmacSHA256")
        var hits=0
        override fun read(contentDigest:String,domainSha:String,parts:()->List<String>)=DomainCheckpointCodec.read(file,key,contentDigest,domainSha,parts)?.also{hits++}
        override fun offer(contentDigest:String,domain:DomainDocument,blueprints:BlueprintCheckpointSource?){file.outputStream().use{DomainCheckpointCodec.write(it,key,contentDigest,domain)}}
    }
    @Test fun aNewStoreCanReuseOnlyAuthenticatedActualRowsAndStillChecksRecovery(){
        JdbcStateDatabase(temporary.newFile("state.db").toPath()).use{db->
            val expected=domain();val cache=Cache(temporary.newFile("read.cache"));val initial=NativeStateStore(db,cache)
            initial.initialize(expected);assertEquals(expected,initial.load()!!.domain);assertEquals(0,cache.hits)
            assertEquals(expected,NativeStateStore(db,cache).load()!!.domain);assertEquals(1,cache.hits)
            db.transaction{it.execute("UPDATE local_recovery SET canonical='{}' WHERE id=1")}
            assertThrows(StorageCorruption::class.java){NativeStateStore(db,cache).load()}
            assertEquals(2,cache.hits)
        }
    }
    @Test fun changedDatabaseContentAndPostWriteTriggersCannotBeHiddenByASignedCheckpoint(){
        JdbcStateDatabase(temporary.newFile("state.db").toPath()).use{db->
            val cache=Cache(temporary.newFile("read.cache"));val store=NativeStateStore(db,cache)
            store.initialize(domain());val before=store.load()!!
            db.transaction{it.execute("UPDATE domain_values SET canonical='999' WHERE name='schemaVersion'")}
            assertThrows(StorageCorruption::class.java){NativeStateStore(db,cache).load()};assertEquals(0,cache.hits)
            db.transaction{it.execute("UPDATE domain_values SET canonical='15' WHERE name='schemaVersion'")}
            val writer=NativeStateStore(db,cache);assertEquals(before,writer.load())
            db.transaction{it.execute("CREATE TRIGGER corrupt_cache AFTER UPDATE ON state_meta BEGIN UPDATE domain_values SET canonical='999' WHERE name='schemaVersion'; END")}
            writer.commit(before.token,"post-write",before.domain,RecoveryContext())
            assertThrows(StorageCorruption::class.java){writer.load()}
            assertThrows(StorageCorruption::class.java){NativeStateStore(db,cache).load()}
        }
    }
    @Test fun cacheReadAndWriteFailuresRemainOptionalAndWrongDomainDigestsAreNotAdopted(){
        JdbcStateDatabase(temporary.newFile("state.db").toPath()).use{db->
            val expected=domain();NativeStateStore(db).initialize(expected)
            val broken=object:DomainReadCache {
                override fun read(contentDigest:String,domainSha:String,parts:()->List<String>):DomainDocument=throw java.io.IOException("cache unavailable")
                override fun offer(contentDigest:String,domain:DomainDocument,blueprints:BlueprintCheckpointSource?){throw java.io.IOException("cache full")}
            }
            assertEquals(expected,NativeStateStore(db,broken).load()!!.domain)
            val wrong=object:DomainReadCache {
                override fun read(contentDigest:String,domainSha:String,parts:()->List<String>)=DomainEngine.initial("Asia/Shanghai")
                override fun offer(contentDigest:String,domain:DomainDocument,blueprints:BlueprintCheckpointSource?){}
            }
            assertEquals(expected,NativeStateStore(db,wrong).load()!!.domain)
        }
    }
}
