package com.blockcolc.domain

import com.blockcolc.domain.JsonChecks.arr
import com.blockcolc.domain.JsonChecks.bool
import com.blockcolc.domain.JsonChecks.choice
import com.blockcolc.domain.JsonChecks.date
import com.blockcolc.domain.JsonChecks.finite
import com.blockcolc.domain.JsonChecks.instant
import com.blockcolc.domain.JsonChecks.int
import com.blockcolc.domain.JsonChecks.localDate
import com.blockcolc.domain.JsonChecks.millis
import com.blockcolc.domain.JsonChecks.nil
import com.blockcolc.domain.JsonChecks.nullable
import com.blockcolc.domain.JsonChecks.obj
import com.blockcolc.domain.JsonChecks.shape
import com.blockcolc.domain.JsonChecks.string
import com.blockcolc.domain.JsonChecks.text
import com.blockcolc.domain.JsonChecks.trim
import com.blockcolc.domain.JsonChecks.unique
import com.blockcolc.domain.JsonChecks.zone
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

internal object DomainValidation {
    // Patterns are immutable; each match creates its own Matcher. Compiling
    // them per voxel/property overwhelms cold reads of real blueprint pools.
    private fun stateKey(value:String)=value.all{it in 'a'..'z'||it in '0'..'9'||it=='_'||it=='.'||it=='-'}
    private val unsafeStateKeys=setOf("__proto__","prototype","constructor")
    private fun validStateKey(key:String)=key.length in 1..64&&stateKey(key)&&key !in unsafeStateKeys
    private val movedBlockPattern=Regex("minecraft:[a-z0-9_.-]+(?:/[a-z0-9_.-]+)*")
    private val movedStatePattern=Regex("[a-z0-9_./-]+")
    private val signPattern=Regex("minecraft:[a-z0-9_]*sign")
    private val itemPattern=Regex("[a-z0-9_.-]+:[a-z0-9_./-]+")
    private val voxelMaterials=setOf("stone","wood","plank","roof","glass","accent")
    private val voxelStages=setOf("foundation","frame","walls","roof","details")
    const val ARRAYS = "projects habitBuildings retiredSubtaskIds focusHistory progressReports dailyGoals projectConditions decorationBlueprintResources decorationRewards holidayRewards buildingBlueprintResources quickNotes birthdayRewards"
    const val SINGLETONS = "schemaVersion activeProjectId activeFocusSession calendar decayPolicy focusIntegrityPolicy worldSettings birthday"
    /** A decoder may share an immutable asset object between several owners.
     * Validate each such body once in this traversal, with separate limits for
     * buildings and decorations. Nothing survives a later validation call. */
    internal data class BlueprintProof(val header:JSONObject,val voxelCount:Int,val decoration:Boolean)
    private class BlueprintChecks(private val canonicalBodies:java.util.IdentityHashMap<JSONObject,String>?,
        private val proofs:java.util.IdentityHashMap<JSONObject,BlueprintProof>?) {
        private val buildings=java.util.IdentityHashMap<JSONObject,Boolean>()
        private val decorations=java.util.IdentityHashMap<JSONObject,Boolean>()
        fun check(value:Any,path:String,decoration:Boolean=false){
            val body=obj(value,path);val checked=if(decoration)decorations else buildings
            proofs?.get(body)?.let{proof->check(!decoration||proof.decoration);return}
            if(checked.containsKey(body))return
            if(blueprint(body,path,decoration))canonicalBodies?.remove(body)
            checked[body]=true
        }
    }
    fun validate(root: JSONObject,canonicalBodies:java.util.IdentityHashMap<JSONObject,String>?=null,
        proofs:java.util.IdentityHashMap<JSONObject,BlueprintProof>?=null) {
        val blueprints=BlueprintChecks(canonicalBodies,proofs)
        shape(root, "$", "$ARRAYS $SINGLETONS")
        int(root.get("schemaVersion"), "$.schemaVersion", 15, 15)
        each(root, "projects") { v,p->project(v,p,blueprints) }; each(root, "habitBuildings") { v,p->habitBuilding(v,p,blueprints) }
        nullable(root.get("activeProjectId"), "$.activeProjectId")
        arr(root.get("retiredSubtaskIds"), "$.retiredSubtaskIds").forEach { text(it, "$.retiredSubtaskIds[]") }
        if (!root.isNull("activeFocusSession")) activeSession(root.get("activeFocusSession"))
        each(root, "focusHistory") { v, p -> session(v, p, false) }; each(root, "progressReports", ::report)
        each(root, "dailyGoals") { v, p ->
            val x = shape(v, p, "date targetPomodoros reachedAt enabled"); date(x.get("date"), "$p.date"); int(x.get("targetPomodoros"), "$p.targetPomodoros", 1)
            if (!x.isNull("reachedAt")) instant(x.get("reachedAt"), "$p.reachedAt"); bool(x.get("enabled"), "$p.enabled")
        }
        val calendar = shape(root.get("calendar"), "$.calendar", "timeZone restWeekdays"); zone(calendar.get("timeZone"), "$.calendar.timeZone")
        val days = arr(calendar.get("restWeekdays"), "$.calendar.restWeekdays").map { int(it, "$.calendar.restWeekdays[]", 0, 6) }
        requireInput(days.zipWithNext().all { (a, b) -> a < b }, "$.calendar.restWeekdays", "Must be unique and sorted")
        val decay = shape(root.get("decayPolicy"), "$.decayPolicy", "enabled gracePlannedDays repairMultiplierBasisPoints damagePerMissedPlannedDayBasisPoints")
        val enabled = bool(decay.get("enabled"), "$.decayPolicy.enabled")
        requireInput(enabled == !decay.isNull("damagePerMissedPlannedDayBasisPoints"), "$.decayPolicy", "Damage must be present exactly when enabled")
        if (enabled) int(decay.get("damagePerMissedPlannedDayBasisPoints"), "$.decayPolicy.damagePerMissedPlannedDayBasisPoints", 1, 10000)
        int(decay.get("gracePlannedDays"), "$.decayPolicy.gracePlannedDays"); int(decay.get("repairMultiplierBasisPoints"), "$.decayPolicy.repairMultiplierBasisPoints", 20000, 20000)
        each(root, "projectConditions") { v, p ->
            val x = shape(v, p, "projectId conditionBasisPoints inactivityAnchorAt assessedMissedPlannedDays")
            text(x.get("projectId"), "$p.projectId"); int(x.get("conditionBasisPoints"), "$p.conditionBasisPoints", 0, 10000)
            if (!x.isNull("inactivityAnchorAt")) instant(x.get("inactivityAnchorAt"), "$p.inactivityAnchorAt")
            int(x.get("assessedMissedPlannedDays"), "$p.assessedMissedPlannedDays")
        }
        val integrity = shape(root.get("focusIntegrityPolicy"), "$.focusIntegrityPolicy", "enabled maxEffectiveExcursions excursionThresholdSeconds")
        bool(integrity.get("enabled"), "$.focusIntegrityPolicy.enabled"); int(integrity.get("maxEffectiveExcursions"), "$.focusIntegrityPolicy.maxEffectiveExcursions", 1, 5)
        int(integrity.get("excursionThresholdSeconds"), "$.focusIntegrityPolicy.excursionThresholdSeconds", 1, 60)
        each(root, "decorationBlueprintResources") { v, p -> resource(v, p, true,blueprints) }
        each(root, "buildingBlueprintResources") { v, p -> resource(v, p, false,blueprints) }
        each(root, "decorationRewards") { v, p ->
            val x = shape(v, p, "date projectId resourceId awardedAt position rotationQuarterTurns")
            date(x.get("date"), "$p.date"); text(x.get("projectId"), "$p.projectId"); text(x.get("resourceId"), "$p.resourceId"); rewardPose(x, p)
        }
        each(root, "holidayRewards") { v, p ->
            val x = shape(v, p, "holidayId year date projectId settlementIndex sourceSessionId awardedAt position rotationQuarterTurns")
            requireInput(text(x.get("holidayId"), "$p.holidayId") in HolidayDates.ids, "$p.holidayId", "Unknown holiday")
            int(x.get("year"), "$p.year", 100, 9999); date(x.get("date"), "$p.date"); text(x.get("projectId"), "$p.projectId")
            int(x.get("settlementIndex"), "$p.settlementIndex"); text(x.get("sourceSessionId"), "$p.sourceSessionId"); rewardPose(x, p)
        }
        val world = shape(root.get("worldSettings"), "$.worldSettings", "worldSeed terrainGenerationVersion environmentStyle")
        text(world.get("worldSeed"), "$.worldSettings.worldSeed"); int(world.get("terrainGenerationVersion"), "$.worldSettings.terrainGenerationVersion", 4, 4)
        choice(world.get("environmentStyle"), "$.worldSettings.environmentStyle", "natural-valley classic-island ocean-island mosaic-coast")
        val birthday = shape(root.get("birthday"), "$.birthday", "enabled month day"); bool(birthday.get("enabled"), "$.birthday.enabled")
        val month = int(birthday.get("month"), "$.birthday.month", 1, 12).toInt(); val day = int(birthday.get("day"), "$.birthday.day", 1, 31).toInt()
        requireInput(day <= LocalDate.of(2000, month, 1).lengthOfMonth(), "$.birthday", "Invalid month/day")
        each(root, "birthdayRewards") { v, p ->
            val x = shape(v, p, "year date awardedAt settlementIndex"); val y = int(x.get("year"), "$p.year", 100, 9999)
            val d = date(x.get("date"), "$p.date"); requireInput(d.take(4).toLong() == y, "$p.year", "Year/date mismatch")
            instant(x.get("awardedAt"), "$p.awardedAt"); if (!x.isNull("settlementIndex")) int(x.get("settlementIndex"), "$p.settlementIndex")
        }
        each(root, "quickNotes") { v, p ->
            val x = shape(v, p, "id text completed createdAt")
            requireInput(text(x.get("id"), "$p.id").length <= 128 && text(x.get("text"), "$p.text").length <= 200, p, "Note is too long")
            bool(x.get("completed"), "$p.completed"); instant(x.get("createdAt"), "$p.createdAt")
        }
        requireInput(root.getJSONArray("quickNotes").length() <= 100, "$.quickNotes", "At most 100 notes")
        unique(objects(root, "quickNotes").map { it.getString("id") }, "$.quickNotes")
        unique(objects(root, "birthdayRewards").map { it.getLong("year") }, "$.birthdayRewards")
        DomainReferences.validate(root)
    }
    fun each(x: JSONObject, key: String, visit: (Any, String) -> Unit) = arr(x.get(key), "$.${key}").forEachIndexed { i, v -> visit(v, "$.$key[$i]") }
    fun objects(x: JSONObject, key: String) = JsonChecks.objects(x.get(key), "$.$key")
    private fun project(v: Any, p: String,blueprints:BlueprintChecks) {
        val x = shape(v, p, "id title kind settlementIndex blueprintId importedBlueprint createdAt status subtaskStructureLocked subtasks habit")
        text(x.get("id"), "$p.id"); text(x.get("title"), "$p.title"); text(x.get("blueprintId"), "$p.blueprintId")
        int(x.get("settlementIndex"), "$p.settlementIndex"); instant(x.get("createdAt"), "$p.createdAt")
        val kind = choice(x.get("kind"), "$p.kind", "finite habit"); val status = choice(x.get("status"), "$p.status", "active paused monument deleted")
        val locked = bool(x.get("subtaskStructureLocked"), "$p.subtaskStructureLocked"); imported(x, "importedBlueprint", p,blueprints)
        val subtasks = arr(x.get("subtasks"), "$p.subtasks").mapIndexed { i, task ->
            val t = shape(task, "$p.subtasks[$i]", "id title order progressBasisPoints")
            text(t.get("id"), "$p.subtasks[$i].id"); text(t.get("title"), "$p.subtasks[$i].title")
            int(t.get("order"), "$p.subtasks[$i].order", i.toLong(), i.toLong()); int(t.get("progressBasisPoints"), "$p.subtasks[$i].progressBasisPoints", 0, 10000)
        }
        if (kind == "habit") {
            requireInput(!x.isNull("habit") && subtasks.isEmpty() && locked && status != "monument", p, "Invalid habit project")
            val h = shape(x.get("habit"), "$p.habit", "cycleNumber targetRounds completedFocusSessionIds awaitingNextBuilding")
            int(h.get("cycleNumber"), "$p.habit.cycleNumber", 1); val target = int(h.get("targetRounds"), "$p.habit.targetRounds", 10, 30)
            val ids = arr(h.get("completedFocusSessionIds"), "$p.habit.completedFocusSessionIds").map { text(it, "$p.habit.completedFocusSessionIds[]") }; unique(ids, "$p.habit.completedFocusSessionIds")
            val awaiting = bool(h.get("awaitingNextBuilding"), "$p.habit.awaitingNextBuilding")
            requireInput(if (awaiting) ids.isEmpty() else ids.size < target, "$p.habit", "Invalid habit cycle")
        } else {
            requireInput(x.isNull("habit") && subtasks.isNotEmpty() && locked == subtasks.any { it > 0 } && (status == "monument") == subtasks.all { it == 10000L }, p, "Invalid finite project progress/status")
        }
    }
    private fun habitBuilding(v: Any, p: String,blueprints:BlueprintChecks) {
        val x = shape(v, p, "id habitProjectId habitTitle cycleNumber settlementIndex blueprintId importedBlueprint targetRounds focusSessionIds completedAt")
        for (k in listOf("id", "habitProjectId", "habitTitle", "blueprintId")) text(x.get(k), "$p.$k")
        int(x.get("cycleNumber"), "$p.cycleNumber", 1); int(x.get("settlementIndex"), "$p.settlementIndex")
        val target = int(x.get("targetRounds"), "$p.targetRounds", 10, 30)
        val ids = arr(x.get("focusSessionIds"), "$p.focusSessionIds").map { text(it, "$p.focusSessionIds[]") }
        unique(ids, "$p.focusSessionIds"); requireInput(ids.size.toLong() == target, "$p.focusSessionIds", "Wrong cycle size")
        instant(x.get("completedAt"), "$p.completedAt"); imported(x, "importedBlueprint", p,blueprints)
    }
    private fun imported(x: JSONObject, field: String, p: String,blueprints:BlueprintChecks) {
        if (x.isNull(field)) return
        blueprints.check(x.get(field), "$p.$field")
        requireInput(x.getJSONObject(field).getString("id") == x.getString("blueprintId"), "$p.$field.id", "Blueprint identity mismatch")
    }
    private inline fun sourceState(v:Any,path:()->String):JSONObject? {
        val x=if(v is JSONObject)v else obj(v,path())
        if(x.length()>32)requireInput(false,path(),"At most 32 block-state properties")
        val keys=x.keys()
        while(keys.hasNext()){val k=keys.next()
            if(!validStateKey(k))requireInput(false,"${path()}.$k","Unsafe state key")
            val value=x.get(k)
            if(value !is String||value.length !in 1..128){
                val fieldPath="${path()}.$k"
                requireInput(string(value,fieldPath).length in 1..128,fieldPath,"Invalid state value")
            }
        }
        return x.takeIf { it.length()!=0 }
    }
    /** True means normalization changed this owned body. All blueprint
     * normalizers live below and invalidate any reusable input spelling. */
    fun blueprint(v: Any, p: String, decoration: Boolean = false):Boolean {
        val body=shape(v,p,"schemaVersion id title bounds voxels")
        checkBlueprintHeader(body,p)
        // Restrict this optimization to small catalogue-sized inputs. Invalid
        // shapes still take the ordinary validator and its normal error path.
        val candidate=if((body.optJSONArray("voxels")?.length()?:Int.MAX_VALUE)<=2000)ValidatedBlueprintCache.fingerprint(body)else null
        if(candidate!=null&&ValidatedBlueprintCache.contains(decoration,candidate))return false
        val changed=PipelineCost.section("blueprint.validate"){validateBlueprint(body,p,decoration)}
        // Validation also normalizes e.g. campfire slot ordering. Only the
        // normalized bytes can serve as proof for a later detached copy.
        if(candidate!=null)ValidatedBlueprintCache.fingerprint(body)?.let{ValidatedBlueprintCache.remember(decoration,it)}
        return changed
    }
    internal fun checkBlueprintHeader(body:JSONObject,p:String){
        int(body.get("schemaVersion"),"$p.schemaVersion",1,1)
        text(body.get("id"),"$p.id");text(body.get("title"),"$p.title")
    }
    /** Strictly validate a canonical body without retaining its cell tree.
     * A lexical or normalization difference falls back to the full path. */
    fun proveCanonicalBlueprint(wire:String,p:String,decoration:Boolean):BlueprintProof? = PipelineCost.section("blueprint.stream-validate") {
        try{
            var cells:BlueprintVoxelChecks?=null
            val scanned=StrictJson.scanCanonicalBlueprint(wire,checkHeader={header->
                checkBlueprintHeader(header,p)
                cells=BlueprintVoxelChecks(header.get("bounds"),p,decoration)
            },checkVoxel={voxel,index->
                val validator=checkNotNull(cells)
                validator.checkCell(voxel,index)
                !validator.changed
            },checkPlain={voxel,index->checkNotNull(cells).checkPlain(voxel,index)},
                validStateProperty={key,value->validStateKey(key)&&value.length in 1..128})?:return@section null
            val validator=checkNotNull(cells)
            validator.checkCount(scanned.voxelCount)
            validator.checkExactBounds()
            BlueprintProof(scanned.fields,scanned.voxelCount,decoration)
        }catch(_:StateInputException){null}
    }
    private val requiredVoxelFields=setOf("x","y","z","materialId","stage","buildOrder")
    private val optionalVoxelFields=setOf("sourceBlockId","sourceBlockState","movingPistonMovedState","movingPistonPose","sign","campfire","emissiveKind","emissiveLevel")
    private fun validateBlueprint(x:JSONObject,p:String,decoration:Boolean):Boolean {
        val cells=BlueprintVoxelChecks(x.get("bounds"),p,decoration)
        val rawVoxels=x.get("voxels");requireInput(rawVoxels is JSONArray,"$p.voxels","Expected array")
        val voxels=rawVoxels as JSONArray
        cells.checkCount(voxels.length())
        for(i in 0 until voxels.length())cells.checkCell(voxels.get(i),i)
        cells.checkExactBounds()
        return cells.changed
    }
    private class BlueprintVoxelChecks(boundsValue:Any,private val p:String,private val decoration:Boolean){
        var changed=false;private set
        private val boundsPath="$p.bounds"
        private val bounds=shape(boundsValue,boundsPath,"minX maxX minY maxY minZ maxZ").let{b->
            listOf("minX","maxX","minY","maxY","minZ","maxZ").associateWith{int(b.get(it),"$boundsPath.$it",-JsonChecks.SAFE)}
        }
        init {
            for(axis in listOf("X","Y","Z")){
                val span=bounds.getValue("max$axis")-bounds.getValue("min$axis")+1
                val limit=if(decoration){if(axis=="Y")16 else 12}else if(axis=="Y")256 else 96
                requireInput(span in 1..limit.toLong(),boundsPath,"Invalid blueprint dimensions")
            }
        }
        private val minX=bounds.getValue("minX");private val minY=bounds.getValue("minY");private val minZ=bounds.getValue("minZ")
        private val sizeX=(bounds.getValue("maxX")-minX+1).toInt();private val sizeY=(bounds.getValue("maxY")-minY+1).toInt();private val sizeZ=(bounds.getValue("maxZ")-minZ+1).toInt()
        // Dimensions have already been bounded above. At most 294,912 bytes
        // replace a List, boxed coordinates and Triple for every voxel.
        private val coordinates=LongArray((sizeX*sizeY*sizeZ+63)/64)
        private val actualMin=LongArray(3){Long.MAX_VALUE};private val actualMax=LongArray(3){Long.MIN_VALUE}
        private fun voxelPath(index:Int)="$p.voxels[$index]"
        fun checkCount(count:Int){requireInput(count in 1..(if(decoration)2000 else 300000),"$p.voxels","Invalid voxel count")}
        private fun checkCoordinates(vx:Long,vy:Long,vz:Long,i:Int){
            val dx=vx-minX;val dy=vy-minY;val dz=vz-minZ
            requireInput(dx in 0 until sizeX.toLong()&&dy in 0 until sizeY.toLong()&&dz in 0 until sizeZ.toLong(),boundsPath,"Bounds must exactly enclose voxels")
            val coordinate=(dx+(dy+dz*sizeY)*sizeX).toInt();val word=coordinate ushr 6;val bit=1L shl (coordinate and 63)
            if(coordinates[word] and bit!=0L)requireInput(false,voxelPath(i),"Duplicate voxel coordinate")
            coordinates[word]=coordinates[word] or bit
            actualMin[0]=minOf(actualMin[0],vx);actualMax[0]=maxOf(actualMax[0],vx)
            actualMin[1]=minOf(actualMin[1],vy);actualMax[1]=maxOf(actualMax[1],vy)
            actualMin[2]=minOf(actualMin[2],vz);actualMax[2]=maxOf(actualMax[2],vz)
        }
        private fun checkMaterialAndStage(material:Any,stage:Any,i:Int){
            if(material !in voxelMaterials)choice(material,"${voxelPath(i)}.materialId","stone wood plank roof glass accent")
            if(stage !in voxelStages)choice(stage,"${voxelPath(i)}.stage","foundation frame walls roof details")
        }
        fun checkPlain(voxel:StrictJson.PlainBlueprintVoxel,i:Int){
            checkCoordinates(voxel.x,voxel.y,voxel.z,i)
            checkMaterialAndStage(voxel.material,voxel.stage,i)
            if(voxel.buildOrder !in 0L..10000L)JsonChecks.integer(voxel.buildOrder,0,10000){"${voxelPath(i)}.buildOrder"}
            voxel.sourceBlockId?.let{JsonChecks.nonBlank(it){"${voxelPath(i)}.sourceBlockId"}}
            voxel.emissiveKind?.let{JsonChecks.nonBlank(it){"${voxelPath(i)}.emissiveKind"}}
            voxel.emissiveLevel?.let{level->if(level !in 0L..15L)JsonChecks.integer(level,0,15){"${voxelPath(i)}.emissiveLevel"}}
        }
        fun checkCell(raw:Any,i:Int){
            val a=JsonChecks.shape(raw,requiredVoxelFields,optionalVoxelFields){voxelPath(i)}
            val vx=JsonChecks.integer(a.get("x"),-JsonChecks.SAFE){"${voxelPath(i)}.x"}
            val vy=JsonChecks.integer(a.get("y"),-JsonChecks.SAFE){"${voxelPath(i)}.y"}
            val vz=JsonChecks.integer(a.get("z"),-JsonChecks.SAFE){"${voxelPath(i)}.z"}
            checkCoordinates(vx,vy,vz,i)
            checkMaterialAndStage(a.get("materialId"),a.get("stage"),i)
            JsonChecks.integer(a.get("buildOrder"),0,10000){"${voxelPath(i)}.buildOrder"}
            if(a.has("sourceBlockId"))JsonChecks.nonBlank(a.get("sourceBlockId")){"${voxelPath(i)}.sourceBlockId"}
            if (a.has("sourceBlockState") && sourceState(a.get("sourceBlockState")) { "${voxelPath(i)}.sourceBlockState" } == null) {
                a.remove("sourceBlockState")
                changed=true
            }
            if (a.has("movingPistonMovedState")) {
                val at=voxelPath(i)
                requireInput(a.optString("sourceBlockId") == "minecraft:moving_piston", "$at.movingPistonMovedState", "Requires moving piston")
                val moved = shape(a.get("movingPistonMovedState"), "$at.movingPistonMovedState", "blockId", "properties")
                val id = string(moved.get("blockId"), "$at.movingPistonMovedState.blockId")
                requireInput(id.length <= 256 && movedBlockPattern.matches(id) && id !in setOf("minecraft:air", "minecraft:cave_air", "minecraft:void_air", "minecraft:moving_piston"), at, "Invalid moved block")
                if (moved.has("properties")) {
                    val properties = sourceState(moved.get("properties")){"$at.movingPistonMovedState.properties"}
                    if (properties == null) {moved.remove("properties");changed=true} else properties.keys().forEach { k -> requireInput(movedStatePattern.matches(properties.getString(k)), at, "Noncanonical moved state") }
                }
            }
            if (a.has("movingPistonPose")) {
                val at=voxelPath(i)
                requireInput(a.optString("sourceBlockId") == "minecraft:moving_piston", "$at.movingPistonPose", "Requires moving piston")
                val pose = shape(a.get("movingPistonPose"), "$at.movingPistonPose", "facing progress extending source")
                choice(pose.get("facing"), at, "down up north south west east"); finite(pose.get("progress"), at, 0.0, 1.0); bool(pose.get("extending"), at); bool(pose.get("source"), at)
            }
            if (a.has("sign")) {
                val at=voxelPath(i)
                requireInput(signPattern.matches(a.optString("sourceBlockId")), "$at.sign", "Requires vanilla sign")
                val sign = shape(a.get("sign"), "$at.sign", "front back")
                for (face in listOf("front", "back")) {
                    val f = shape(sign.get(face), "$at.sign.$face", "lines dyeColor glowing"); val lines = arr(f.get("lines"), at)
                    requireInput(lines.size <= 4, at, "Too many sign lines")
                    lines.forEach { line -> val s = string(line, at); requireInput(s.length <= 256 && s.none { it.code <= 31 || it.code == 127 }, at, "Invalid sign line") }
                    choice(f.get("dyeColor"), at, "white orange magenta light_blue yellow lime pink gray light_gray cyan purple blue brown green red black"); bool(f.get("glowing"), at)
                }
            }
            if (a.has("campfire")) {
                val at=voxelPath(i)
                requireInput(a.optString("sourceBlockId") in setOf("minecraft:campfire", "minecraft:soul_campfire"), at, "Requires campfire")
                val fire = shape(a.get("campfire"), "$at.campfire", "slots"); val slots = arr(fire.get("slots"), at).map { raw ->
                    val s = shape(raw, at, "slot itemId count"); int(s.get("slot"), at, 0, 3); int(s.get("count"), at, 1, 64)
                    val id = string(s.get("itemId"), at); requireInput(id.length <= 256 && itemPattern.matches(id), at, "Invalid item ID"); s
                }
                requireInput(slots.size <= 4, at, "Too many campfire slots")
                val indices=slots.map { it.getLong("slot") }
                unique(indices, at)
                if(indices.zipWithNext().any{(a,b)->a>b}){
                    fire.put("slots", JSONArray(slots.sortedBy { it.getLong("slot") }))
                    changed=true
                }
            }
            if(a.has("emissiveKind"))JsonChecks.nonBlank(a.get("emissiveKind")){"${voxelPath(i)}.emissiveKind"}
            if(a.has("emissiveLevel"))JsonChecks.integer(a.get("emissiveLevel"),0,15){"${voxelPath(i)}.emissiveLevel"}
        }
        fun checkExactBounds(){
            for((i,axis)in listOf("X","Y","Z").withIndex())requireInput(bounds.getValue("min$axis")==actualMin[i]&&bounds.getValue("max$axis")==actualMax[i],boundsPath,"Bounds must exactly enclose voxels")
        }
    }
    private fun resource(v: Any, p: String, decoration: Boolean,blueprints:BlueprintChecks) {
        val x = shape(v, p, if (decoration) "id blueprint importedAt" else "id displayName blueprint importedAt")
        blueprints.check(x.get("blueprint"), "$p.blueprint", decoration)
        requireInput(text(x.get("id"), "$p.id") == x.getJSONObject("blueprint").getString("id"), "$p.id", "Resource identity mismatch")
        instant(x.get("importedAt"), "$p.importedAt")
        if (!decoration) { val name = text(x.get("displayName"), "$p.displayName"); requireInput(name == trim(name) && name.length <= 80, "$p.displayName", "Invalid display name") }
    }
    private fun rewardPose(x: JSONObject, p: String) {
        instant(x.get("awardedAt"), "$p.awardedAt"); int(x.get("rotationQuarterTurns"), "$p.rotationQuarterTurns", 0, 3)
        val pos = shape(x.get("position"), "$p.position", "x z"); int(pos.get("x"), "$p.position.x", -JsonChecks.SAFE); int(pos.get("z"), "$p.position.z", -JsonChecks.SAFE)
    }
    internal fun activeSession(value:Any)=session(value,"$.activeFocusSession",true)
    private fun session(v: Any, p: String, active: Boolean) {
        val x = obj(v, p); val status = if (active) "active" else choice(x.get("status"), "$p.status", "completed completed-early interrupted")
        val fields = when (status) {
            "active" -> "integrity"
            "interrupted" -> "status interruptedAt interruptionReason interruptionCategory actualDurationMs"
            else -> "status completedAt completedLocalDate actualDurationMs"
        }
        val optional = when (status) { "interrupted" -> " interruptionNote"; "completed" -> " external"; else -> "" }
        shape(x, p, "id projectId subtaskId startedAt endsAt plannedDurationMs timeZoneAtStart $fields", "marathon settledAt deferredSettlement" + optional)
        text(x.get("id"), "$p.id"); text(x.get("projectId"), "$p.projectId"); nullable(x.get("subtaskId"), "$p.subtaskId")
        val start = instant(x.get("startedAt"), "$p.startedAt"); val end = instant(x.get("endsAt"), "$p.endsAt"); val duration = int(x.get("plannedDurationMs"), "$p.plannedDurationMs", 1)
        val tz = zone(x.get("timeZoneAtStart"), "$p.timeZoneAtStart")
        requireInput(millis(end) - millis(start) == duration, "$p.endsAt", "Invalid scheduled interval")
        if (x.opt("marathon") != true) x.remove("marathon")
        if (x.has("deferredSettlement")) requireInput(x.get("deferredSettlement") == true && x.opt("marathon") == true && x.isNull("subtaskId"), "$p.deferredSettlement", "Requires marathon, true flag and null subtask")
        if (x.has("settledAt")) instant(x.get("settledAt"), "$p.settledAt")
        if (active) {
            val i = shape(x.get("integrity"), "$p.integrity", "effectiveExcursions backgroundedAt backgroundReason exemptionPending")
            int(i.get("effectiveExcursions"), "$p.integrity.effectiveExcursions", 0, 5); bool(i.get("exemptionPending"), "$p.integrity.exemptionPending")
            requireInput(i.isNull("backgroundedAt") == i.isNull("backgroundReason"), "$p.integrity", "Inconsistent background state")
            if (!i.isNull("backgroundedAt")) {
                val at = instant(i.get("backgroundedAt"), "$p.integrity.backgroundedAt")
                requireInput(at >= start && at < end, "$p.integrity.backgroundedAt", "Outside focus interval")
                choice(i.get("backgroundReason"), "$p.integrity.backgroundReason", "app-switch screen-lock system-exempt web-visibility")
            }
            return
        }
        val actual = int(x.get("actualDurationMs"), "$p.actualDurationMs", 0, duration)
        if (x.has("external")) {
            val e = shape(x.get("external"), "$p.external", "source roundMs credited")
            val round = int(e.get("roundMs"), "$p.external.roundMs", 60000, 10800000)
            val credited = bool(e.get("credited"), "$p.external.credited")
            requireInput(text(e.get("source"), "$p.external.source").length <= 64 && x.isNull("subtaskId") &&
                !x.has("marathon") && !x.has("settledAt") && actual <= round && (credited || actual < round),
                "$p.external", "Invalid external focus fragment")
        }
        val finish = if (status == "interrupted") instant(x.get("interruptedAt"), "$p.interruptedAt") else instant(x.get("completedAt"), "$p.completedAt")
        if (status == "completed") requireInput(finish == end && actual == duration, p, "Natural completion must match deadline")
        else requireInput(finish >= start && finish < end && actual == millis(finish) - millis(start), p, "Invalid actual focus interval")
        if (status != "interrupted") requireInput(date(x.get("completedLocalDate"), "$p.completedLocalDate") == localDate(finish, tz), "$p.completedLocalDate", "Timezone/date mismatch")
        else {
            val reason = choice(x.get("interruptionReason"), "$p.interruptionReason", "user-cancelled app-switch-limit")
            if (!x.isNull("interruptionCategory")) choice(x.get("interruptionCategory"), "$p.interruptionCategory", "external-interruption task-blocked fatigue priority-changed device-or-app other")
            requireInput(reason != "app-switch-limit" || x.isNull("interruptionCategory"), "$p.interruptionCategory", "Automatic failure has no user category")
            if (x.has("interruptionNote")) { val note = trim(text(x.get("interruptionNote"), "$p.interruptionNote")); requireInput(note.length <= 200, "$p.interruptionNote", "Note too long"); x.put("interruptionNote", note) }
        }
    }
    private fun report(v: Any, p: String) {
        val x = shape(v, p, "id projectId subtaskId focusSessionIds progressBasisPoints reportedAt", "shared allocation")
        for (k in listOf("id", "projectId", "subtaskId")) text(x.get(k), "$p.$k")
        arr(x.get("focusSessionIds"), "$p.focusSessionIds").forEach { text(it, "$p.focusSessionIds[]") }
        int(x.get("progressBasisPoints"), "$p.progressBasisPoints", 0, 10000); instant(x.get("reportedAt"), "$p.reportedAt")
        if (x.has("allocation")) choice(x.get("allocation"), "$p.allocation", "explicit")
        requireInput(!x.has("allocation") || x.opt("shared") != true, p, "Explicit allocation cannot be shared")
        if (x.opt("shared") != true) x.remove("shared")
    }
}
