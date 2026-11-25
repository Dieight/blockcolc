package com.blockcolc.storage

import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.DomainTime
import com.blockcolc.domain.StateInputException
import com.blockcolc.domain.StrictJson
import org.json.JSONArray
import org.json.JSONObject

data class ParsedBackup(val schema: Int, val exportedAt: String, val checksum: String, val domain: DomainDocument, val preferences: String? = null)
class BackupRejected(detail: String, cause: Throwable? = null) : IllegalArgumentException(detail, cause)

/** Domain-only versions 1/2 and version 3 with portable client preferences. */
object BackupCodec {
    private const val FORMAT = "tomato-clock-backup"
    private val slots = mapOf("projects" to "importedBlueprint", "habitBuildings" to "importedBlueprint", "buildingBlueprintResources" to "blueprint", "decorationBlueprintResources" to "blueprint")
    private fun check(ok: Boolean, detail: String) { if (!ok) throw BackupRejected(detail) }
    private fun exact(value: Any, fields: String): JSONObject {
        check(value is JSONObject, "Expected object"); val x = value as JSONObject
        check(x.keys().asSequence().toSet() == fields.split(' ').toSet(), "Unexpected or missing fields"); return x
    }
    private fun integer(value: Any): Long {
        check(value is Number, "Expected safe integer"); val n = (value as Number).toDouble()
        check(n.isFinite() && n == kotlin.math.floor(n) && kotlin.math.abs(n) <= 9007199254740991.0, "Expected safe integer"); return n.toLong()
    }
    fun read(bytes: ByteArray): ParsedBackup = read(StrictJson.decode(bytes))
    fun read(text: String): ParsedBackup = try {
        val x = exact(StrictJson.parse(text), "format schemaVersion exportedAt payload checksum")
        check(x.get("format") == FORMAT, "Unknown backup format")
        val schema = integer(x.get("schemaVersion")); check(schema in 1L..3L, "Unsupported backup version")
        check(x.get("exportedAt") is String, "Invalid export instant"); val at = DomainTime.instant(x.getString("exportedAt"))
        check(x.get("checksum") is String && Regex("[a-f0-9]{64}").matches(x.getString("checksum")), "Invalid checksum")
        val checksum = x.getString("checksum"); x.remove("checksum")
        check(StrictJson.sha(StrictJson.render(x)) == checksum, "Backup checksum mismatch")
        val envelope = if (schema == 3L) exact(x.get("payload"), "domain domainVersion preferences") else null
        val domainVersion = envelope?.let { integer(it.get("domainVersion")) } ?: schema
        check(domainVersion in 1L..2L, "Invalid backup domain version")
        val payload = envelope?.get("domain") ?: x.get("payload")
        val preferences = envelope?.let { preferenceWire(it.get("preferences")) }
        val raw = if (domainVersion == 2L) unpack(payload) else payload
        check(raw is JSONObject, "Invalid domain payload")
        // Both schema branches above produce a private decoder-owned tree.
        // No mutable JSON is returned to a caller. Transferring this ownership
        // avoids a second archive-sized tree during domain normalization.
        ParsedBackup(schema.toInt(), at, checksum, DomainDocument.fromOwnedJson(raw as JSONObject), preferences)
    } catch (e: BackupRejected) { throw e } catch (e: Exception) { throw BackupRejected("Invalid backup; current data unchanged", e) }

    fun write(domain: DomainDocument, exportedAt: String, compact: Boolean = false, preferences: String? = null): String {
        DomainTime.instant(exportedAt)
        val root = JSONObject().put("format", FORMAT).put("schemaVersion", 1).put("exportedAt", exportedAt).put("payload", domain.json())
        val legacySize = StrictJson.measure(root) + 78 + (preferences?.let { StrictJson.utf8Size(it) + 56 } ?: 0)
        if (compact || legacySize > StrictJson.FILE_LIMIT) {
            check(legacySize <= StrictJson.EXPANDED_LIMIT, "Backup exceeds expanded budget")
            val packed = pack(root.getJSONObject("payload"))
            unpack(StrictJson.copy(packed)) // Apply the same amplification gate to exported archives.
            root.put("schemaVersion", 2).put("payload", packed)
        }
        if (preferences != null) {
            val settings = StrictJson.parse(preferences, 65536)
            preferenceWire(settings)
            val payload = JSONObject().put("domainVersion", root.getInt("schemaVersion"))
                .put("domain", root.get("payload")).put("preferences", settings)
            root.put("schemaVersion", 3).put("payload", payload)
        }
        root.put("checksum", StrictJson.sha(StrictJson.render(root)))
        check(StrictJson.measure(root) <= StrictJson.FILE_LIMIT, "Backup exceeds file budget")
        return StrictJson.render(root)
    }
    internal fun preferenceWire(settings: Any): String {
        check(settings is JSONObject, "Invalid backup preferences")
        val value = settings as JSONObject
        check(value.opt("focusMinutes") is Number && value.opt("breakMinutes") is Number, "Incomplete backup preferences")
        if (value.has("resourceSelection")) {
            val selection = exact(value.get("resourceSelection"), "activeId baseId")
            val sha = Regex("[a-f0-9]{64}")
            for (key in listOf("activeId", "baseId")) {
                val resource = selection.get(key)
                check(resource == JSONObject.NULL || resource is String && sha.matches(resource), "Invalid backup resource selection")
            }
        }
        return StrictJson.render(value).also { check(StrictJson.utf8Size(it) <= 65536, "Backup preferences too large") }
    }
    private fun mapSlots(state: JSONObject, convert: (Any) -> Any): JSONObject {
        for ((collection, slot) in slots) {
            val rows = state.opt(collection); check(rows is JSONArray, "Missing blueprint collection"); rows as JSONArray
            for (i in 0 until rows.length()) { val owner = rows.get(i); check(owner is JSONObject, "Invalid blueprint owner"); owner as JSONObject
                check(owner.has(slot), "Missing blueprint slot"); owner.put(slot, convert(owner.get(slot))) }
        }
        return state
    }
    private fun pack(state: JSONObject): JSONObject {
        val blueprints = JSONArray(); val byContent = HashMap<String, Int>()
        val mapped = mapSlots(state) { raw ->
            if (raw == JSONObject.NULL) raw else {
                val bp = raw as JSONObject; val packed = JSONObject()
                for (key in listOf("schemaVersion", "id", "title", "bounds")) packed.put(key, bp.get(key))
                val palette = JSONArray(); val styles = HashMap<String, Int>(); val voxels = JSONArray(); val source = bp.getJSONArray("voxels")
                for (i in 0 until source.length()) {
                    val v = source.getJSONObject(i); val style = JSONObject()
                    v.keys().forEach { if (it !in setOf("x", "y", "z")) style.put(it, v.get(it)) }
                    val key = StrictJson.render(style); val index = styles.getOrPut(key) { palette.length().also { palette.put(style) } }
                    voxels.put(JSONArray().put(v.get("x")).put(v.get("y")).put(v.get("z")).put(index))
                }
                packed.put("palette", palette).put("voxels", voxels)
                val hash = StrictJson.sha(StrictJson.render(packed))
                val index = byContent.getOrPut(hash) { blueprints.length().also { blueprints.put(packed) } }
                JSONObject().put("\$blueprint", index)
            }
        }
        return JSONObject().put("state", mapped).put("blueprints", blueprints)
    }
    private fun unpack(raw: Any): JSONObject {
        val payload = exact(raw, "state blueprints"); val state = payload.get("state"); check(state is JSONObject, "Invalid compact state")
        val blueprints = payload.get("blueprints"); check(blueprints is JSONArray, "Invalid compact content"); blueprints as JSONArray
        var expandedBytes = StrictJson.measure(state); val decoded = HashMap<Int, Pair<JSONObject, Long>>(); val used = HashSet<Int>()
        return mapSlots(state as JSONObject) { ref ->
            if (ref == JSONObject.NULL) ref else {
                val x = exact(ref, "\$blueprint"); val index = integer(x.get("\$blueprint"))
                check(index >= 0 && index < blueprints.length(), "Invalid blueprint reference"); val id = index.toInt(); used.add(id)
                val (blueprint, size) = decoded.getOrPut(id) {
                    val p = exact(blueprints.get(id), "schemaVersion id title bounds palette voxels")
                    val palette = p.get("palette"); val coordinates = p.get("voxels")
                    check(palette is JSONArray && palette.length() in 1..300000 && coordinates is JSONArray && coordinates.length() in 1..300000, "Invalid packed blueprint")
                    palette as JSONArray; coordinates as JSONArray
                    val styles = (0 until palette.length()).map { n ->
                        val style = palette.get(n); check(style is JSONObject, "Invalid palette entry"); style as JSONObject
                        check(listOf("x", "y", "z").none { style.has(it) }, "Palette overrides coordinates"); style
                    }
                    val styleBytes = styles.map(StrictJson::measure)
                    val header = JSONObject(); for (key in listOf("schemaVersion", "id", "title", "bounds")) header.put(key, p.get(key))
                    var estimate = StrictJson.measure(header) + 16
                    for (n in 0 until coordinates.length()) {
                        val row = coordinates.get(n); check(row is JSONArray && row.length() == 4, "Invalid packed voxel"); row as JSONArray
                        val values = (0..3).map { integer(row.get(it)) }; check(values[3] >= 0 && values[3] < styles.size, "Invalid palette index")
                        estimate += styleBytes[values[3].toInt()] + StrictJson.measure(JSONObject().put("x", values[0]).put("y", values[1]).put("z", values[2])) + 1
                        check(expandedBytes + estimate <= StrictJson.EXPANDED_LIMIT, "Backup reference expansion exceeds budget")
                    }
                    val voxels = JSONArray()
                    for (n in 0 until coordinates.length()) {
                        val row = coordinates.getJSONArray(n); val style = styles[integer(row.get(3)).toInt()]
                        val voxel = StrictJson.copy(style) as JSONObject
                        voxel.put("x", row.get(0)).put("y", row.get(1)).put("z", row.get(2)); voxels.put(voxel)
                    }
                    header.put("voxels", voxels); header to StrictJson.measure(header)
                }
                expandedBytes += size; check(expandedBytes <= StrictJson.EXPANDED_LIMIT, "Backup repeated references exceed budget")
                blueprint
            }
        }.also { check(used.size == blueprints.length(), "Unreferenced blueprint content") }
    }
}
