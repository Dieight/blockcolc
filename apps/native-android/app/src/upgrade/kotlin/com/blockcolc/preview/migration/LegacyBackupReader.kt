package com.blockcolc.preview.migration

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.domain.StrictJson
import com.blockcolc.storage.BackupArchive
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.charset.CodingErrorAction

/** Reads the already copied legacy backups for the same initialization
 * transaction that installs the active domain and the live plan. */
internal object LegacyBackupReader {
    private val blueprintSlots = mapOf(
        "projects" to "importedBlueprint",
        "habitBuildings" to "importedBlueprint",
        "buildingBlueprintResources" to "blueprint",
        "decorationBlueprintResources" to "blueprint",
    )

    fun archives(capture: LegacyWorkspaceCapture, timeZone: String): Sequence<BackupArchive> = sequence {
        for (file in capture.rollbackFiles) {
            val record = parse(file) as JSONObject
            val kind = record.getString("reason")
            val sourceKey = when (kind) {
                "before-import" -> "sourceChecksum"
                "before-delete-active-project" -> "projectId"
                "before-restore" -> "sourceRollbackBackupId"
                else -> error("LEGACY_ROLLBACK_REASON")
            }
            require(record.has("state"))
            val domain = if (record.isNull("state")) DomainEngine.initial(timeZone)
                else DomainDocument.fromOwnedJson(record.getJSONObject("state"))
            // Legacy rollback records have no independent revision.
            yield(BackupArchive("legacy-rollback:" + record.getString("id"), DomainTime.instant(record.getString("createdAt")),
                null, 0, kind, record.getString(sourceKey), domain))
        }
        capture.dailyManifests?.let { file ->
            val manifests = parse(file) as JSONArray
            require(manifests.length() == 1) { "LEGACY_DAILY_ROTATION" }
            val manifest = manifests.getJSONObject(0)
            val date = DomainTime.date(manifest.getString("date"))
            require(date == manifest.getString("id"))
            yield(BackupArchive(
                "daily:$date", DomainTime.instant(manifest.getString("createdAt")), date, manifest.getLong("sourceRevision"),
                "daily-merged", null, expandDaily(capture, manifest),
            ))
        }
    }

    private fun expandDaily(capture: LegacyWorkspaceCapture, manifest: JSONObject): DomainDocument {
        val references = manifest.getJSONArray("blocks")
        val files = (0 until references.length()).associate { index ->
            val id = references.getJSONObject(index).getString("id")
            id to capture.dailyBlock(id)
        }
        val state = manifest.getString("stateBlock")
        val rootFile = files.getValue(state)
        val root = parse(rootFile) as JSONObject
        var expanded = rootFile.length()
        fun readPart(id: String): Any {
            require(id != state)
            val file = files.getValue(id)
            expanded += file.length()
            require(expanded <= StrictJson.EXPANDED_LIMIT) { "LEGACY_BACKUP_EXPANSION" }
            return parse(file)
        }
        val domain = if (root.opt("format") == "blockcolc-daily-merged-v2") {
            val fields = root.getJSONObject("properties")
            JSONObject().also { target ->
                for (key in fields.keys()) {
                    val field = fields.getJSONObject(key)
                    val value = when (field.getString("kind")) {
                        "value" -> field.get("value")
                        "array" -> {
                            val parts = field.getJSONArray("parts")
                            JSONArray().also { array ->
                                for (index in 0 until parts.length()) {
                                    val rows = readPart(parts.getString(index)) as JSONArray
                                    require(rows.length() in 1..16)
                                    for (item in 0 until rows.length()) array.put(rows.get(item))
                                }
                                require(array.length() == field.getInt("length"))
                            }
                        }
                        else -> error("LEGACY_BACKUP_SECTION")
                    }
                    target.put(key, value)
                }
            }
        } else root

        val blueprints = mutableMapOf<String, JSONObject>()
        for ((section, slot) in blueprintSlots) {
            val rows = domain.optJSONArray(section) ?: continue
            for (index in 0 until rows.length()) {
                val row = rows.getJSONObject(index)
                val body = row.optJSONObject(slot) ?: continue
                val id = body.opt("\$blueprint") as? String ?: continue
                require(body.length() == 1 && id != state)
                val file = files.getValue(id)
                val blueprint = blueprints[id]?.also {
                    expanded += file.length()
                    require(expanded <= StrictJson.EXPANDED_LIMIT) { "LEGACY_BACKUP_EXPANSION" }
                } ?: (readPart(id) as JSONObject).also { blueprints[id] = it }
                row.put(slot, blueprint)
            }
        }
        return DomainDocument.fromOwnedJson(domain)
    }

    private fun parse(file: File): Any {
        val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        val text = java.io.InputStreamReader(file.inputStream(), decoder).buffered().use { it.readText() }
        return StrictJson.parse(text, StrictJson.EXPANDED_LIMIT)
    }
}
