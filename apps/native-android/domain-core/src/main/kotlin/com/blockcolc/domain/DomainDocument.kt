package com.blockcolc.domain

import org.json.JSONObject
import org.json.JSONArray
import java.util.concurrent.FutureTask

private data class BlueprintSlice(val start:Int,val end:Int)

/** Validated, complete domain wire state. Mutable JSON never crosses the owned boundary. */
class DomainDocument private constructor(private val wire:CanonicalWire, private val snapshot: JSONObject?,private val focusControls:String?,private val activeSession:String?,private val dailyResources:Set<String>,private val birthdayControls:String,
    private val projection:String?,private val blueprintSlices:Map<Pair<String,String>,BlueprintSlice>,private val rootSlices:Map<String,BlueprintSlice>,
    private val projectionSections:Map<String,String>,private val controlSections:Map<String,String>,private val checkedSha:String?=null,
    private val focusStartBaseSha:String?=null) {
    val canonical:String get()=wire.text
    val canonicalLength:Int get()=wire.length
    val sha256: String by lazy { checkedSha?:wire.sha256() }
    fun json(): JSONObject = if(snapshot==null) StrictJson.parse(canonical, StrictJson.EXPANDED_LIMIT) as JSONObject else StrictJson.copy(snapshot) as JSONObject
    /** Scheduling reads never need to expand immutable building voxel bodies. */
    fun focusControlJson():JSONObject=focusControls?.let{StrictJson.parse(it,StrictJson.EXPANDED_LIMIT) as JSONObject}
        ?:readFields(focusFields,controlSections)
    fun activeFocusSession():JSONObject?=activeSession?.let{StrictJson.parse(it) as JSONObject}
    /** Validated canonical arrays use [] for an empty history. This check
     * does not materialize history or any blueprint bodies. */
    fun hasFocusFacts():Boolean=activeSession!=null||rootSlices.getValue("focusHistory").let{it.end-it.start>2}
    fun registeredDailyRewardIds():Set<String> = dailyResources
    fun birthdayObservationJson():JSONObject=StrictJson.parse(birthdayControls) as JSONObject
    /** Presentation-only facts. Embedded blueprint bodies are replaced by
     * id/title/bounds/voxelCount headers, so this is NOT a domain wire state. */
    fun projectionJson():JSONObject=projection?.let{StrictJson.parse(it,StrictJson.EXPANDED_LIMIT) as JSONObject}
        ?:readFields(rootSlices.keys,projectionSections)
    private fun readFields(fields:Iterable<String>,replacements:Map<String,String>):JSONObject {
        val result=JSONObject()
        for(field in fields){
            val fieldWire=replacements[field]?:rootSlices.getValue(field).let{wire.substring(it.start,it.end)}
            result.put(field,StrictJson.parse(fieldWire,StrictJson.EXPANDED_LIMIT))
        }
        return result
    }
    /** Exact canonical bytes already owned by this validated document. Scope
     * by entity as different buildings may retain different bodies for one ID. */
    fun blueprintCanonical(section:String,entityId:String):String?=blueprintSlices[section to entityId]?.let{wire.substring(it.start,it.end)}
    /** Compare actual persisted text with this validated slice without
     * allocating or keeping another copy of a large blueprint. */
    fun matchesBlueprintCanonical(section:String,entityId:String,actual:String):Boolean {
        val slice=blueprintSlices[section to entityId]?:return false
        return actual.length==slice.end-slice.start&&wire.matches(slice.start,actual)
    }
    /** The store can apply just this singleton after verifying the same base
     * document in its transaction. Parsing a document does not grant a patch. */
    fun startedFocusWireFrom(base:DomainDocument):String? =
        if(focusStartBaseSha!=null&&focusStartBaseSha==base.sha256)activeSession else null
    internal val canSpliceStartedFocus get()=snapshot==null
    internal fun checkpointMetadata():JSONObject=JSONObject()
        .put("roots",JSONObject().also{out->rootSlices.forEach{(name,s)->out.put(name,JSONArray().put(s.start).put(s.end))}})
        .put("blueprints",JSONArray().also{out->blueprintSlices.forEach{(key,s)->out.put(JSONArray().put(key.first).put(key.second).put(s.start).put(s.end))}})
        .put("projections",JSONObject(projectionSections)).put("controls",JSONObject(controlSections))
    internal fun checkpointBlueprints(owners:Map<String,Pair<String,String>>):JSONObject {
        val sections=HashMap<String,Map<String,JSONObject>>()
        return JSONObject().also{out->
            for((sha,owner) in owners){
                val (section,id)=owner
                val entries=sections.getOrPut(section){
                    val rows=StrictJson.parse(projectionSections.getValue(section),StrictJson.EXPANDED_LIMIT) as JSONArray
                    (0 until rows.length()).associate{index->rows.getJSONObject(index).let{it.getString("id") to it}}
                }
                val item=entries.getValue(id).getJSONObject(blueprintFields.getValue(section))
                val header=JSONObject().put("schemaVersion",1).put("id",item.get("id")).put("title",item.get("title")).put("bounds",item.get("bounds"))
                out.put(sha,JSONObject().put("header",header).put("voxelCount",item.getInt("voxelCount"))
                    .put("decoration",section=="decorationBlueprintResources"))
            }
        }
    }
    /** Only StartFocus may use this path. Its original command runs on a
     * detached metadata view; every other field must remain byte-identical.
     * The new session uses the same shape and full reference checks as a
     * whole-domain decode. Immutable blueprint/history bytes are inherited. */
    internal fun startedFocus(view:JSONObject,beforeMetadata:String):DomainDocument? {
        check(canSpliceStartedFocus&&activeSession==null)
        val session=view.get("activeFocusSession")
        view.put("activeFocusSession",JSONObject.NULL)
        val unchanged=StrictJson.render(view)==beforeMetadata
        view.put("activeFocusSession",session)
        if(!unchanged)return null
        DomainValidation.activeSession(session)
        DomainReferences.validate(view)
        val sessionWire=StrictJson.render(session);val old=rootSlices.getValue("activeFocusSession")
        val delta=sessionWire.length-(old.end-old.start)
        val next=wire.replace(old.start,old.end,sessionWire)
        fun shifted(slice:BlueprintSlice)=if(slice.start>=old.end)BlueprintSlice(slice.start+delta,slice.end+delta)else slice
        val roots=java.util.Collections.unmodifiableMap(rootSlices.mapValues{(name,slice)->if(name=="activeFocusSession")BlueprintSlice(old.start,old.start+sessionWire.length)else shifted(slice)})
        val blueprints=java.util.Collections.unmodifiableMap(blueprintSlices.mapValues{(_,slice)->shifted(slice)})
        return DomainDocument(next,null,null,sessionWire,dailyResources,birthdayControls,null,blueprints,roots,projectionSections,controlSections,focusStartBaseSha=sha256)
    }
    override fun equals(other: Any?) = other is DomainDocument && wire.sameAs(other.wire)
    override fun hashCode() = canonical.hashCode()
    companion object {
        // Per-document, not a global history cache. Large archives retain only
        // canonical text; the hot path never borrows an exposed mutable tree.
        // The bundled daily catalogue alone takes a normal workspace beyond
        // 64 Ki characters. Keep these small documents cheap without keeping
        // a second parsed tree for multi-megabyte imported archives.
        internal const val SNAPSHOT_CHARACTERS = 256 * 1024
        private const val STREAMED_BLUEPRINT_CHARACTERS = 4096
        private const val PARALLEL_BLUEPRINT_CHARACTERS = 4 * 1024 * 1024
        private val focusFields=listOf("activeProjectId","activeFocusSession","focusHistory","progressReports","calendar","projects","habitBuildings")
        private val blueprintFields=mapOf("projects" to "importedBlueprint","habitBuildings" to "importedBlueprint",
            "buildingBlueprintResources" to "blueprint","decorationBlueprintResources" to "blueprint")
        /** Called only after DomainCheckpointCodec has authenticated the
         * complete payload and matched actual row content and validator code. */
        internal fun fromCheckpoint(wire:CanonicalWire,metadata:JSONObject,sha:String):DomainDocument {
            require(wire.length>SNAPSHOT_CHARACTERS&&wire[0]=='{'&&wire[wire.length-1]=='}')
            JsonChecks.shape(metadata,"$.checkpoint","roots blueprints projections controls")
            val expected=(DomainValidation.ARRAYS+" "+DomainValidation.SINGLETONS).split(' ').toSet()
            val source=metadata.getJSONObject("roots");require(source.keys().asSequence().toSet()==expected)
            fun number(value:Any)=JsonChecks.int(value,"$.checkpoint.offset",0,wire.length.toLong()).toInt()
            val roots=expected.sorted().associateWith{name->
                val pair=source.getJSONArray(name);require(pair.length()==2)
                BlueprintSlice(number(pair.get(0)),number(pair.get(1))).also{s->
                    val prefix="\"$name\":"
                    require(s.end>s.start&&s.end<wire.length&&wire[s.end] in ",}")
                    require(wire.matches(s.start-prefix.length,prefix))
                }
            }
            var end=-1;for(name in expected.sorted()){val span=roots.getValue(name);require(span.start>end);end=span.end}
            val blueprints=linkedMapOf<Pair<String,String>,BlueprintSlice>()
            val bodies=metadata.getJSONArray("blueprints")
            for(i in 0 until bodies.length()){
                val row=bodies.getJSONArray(i);require(row.length()==4)
                val section=row.getString(0);val id=row.getString(1);require(section in blueprintFields&&id.isNotEmpty())
                val span=BlueprintSlice(number(row.get(2)),number(row.get(3)))
                // Identical bodies may share the first canonical span across
                // owners. Distinct owner bodies still have distinct spans.
                require(span.end>span.start&&blueprintFields.keys.any{name->val outer=roots.getValue(name);span.start>=outer.start&&span.end<=outer.end})
                require(blueprints.put(section to id,span)==null)
            }
            fun strings(name:String,keys:Set<String>):Map<String,String>{
                val values=metadata.getJSONObject(name);require(values.keys().asSequence().toSet()==keys)
                return java.util.Collections.unmodifiableMap(keys.associateWith{key->JsonChecks.string(values.get(key),"$.checkpoint.$name.$key")})
            }
            val projections=strings("projections",blueprintFields.keys);val controls=strings("controls",setOf("projects","habitBuildings"))
            fun field(key:String)=roots.getValue(key).let{wire.substring(it.start,it.end)}
            val active=field("activeFocusSession").takeUnless{it=="null"}?.also{DomainValidation.activeSession(StrictJson.parse(it))}
            val resources=StrictJson.parse(projections.getValue("decorationBlueprintResources")) as JSONArray
            val ids=java.util.Collections.unmodifiableSet((0 until resources.length()).map{resources.getJSONObject(it).getString("id")}.toSet())
            val birthday=JSONObject();for(name in listOf("birthday","birthdayRewards","calendar"))birthday.put(name,StrictJson.parse(field(name)))
            return DomainDocument(wire,null,null,active,ids,StrictJson.render(birthday),null,
                java.util.Collections.unmodifiableMap(blueprints),java.util.Collections.unmodifiableMap(roots),projections,controls,sha)
        }
        fun parse(text: String): DomainDocument = fromOwned(StrictJson.parse(text, StrictJson.EXPANDED_LIMIT))
        fun fromJson(value: JSONObject): DomainDocument = fromOwned(StrictJson.copy(value))
        /** Consumes a freshly assembled tree owned solely by a decoder/builder.
         * Normalization may mutate it; any retained snapshot is detached. */
        fun fromOwnedJson(value:JSONObject):DomainDocument=fromOwned(value)
        /** Allocation hint only. Validation and canonical writing are unchanged. */
        fun fromOwnedJson(value:JSONObject,renderCapacityHint:Int):DomainDocument=fromOwned(value,renderCapacityHint)
        /** The storage decoder relinquishes its metadata tree here. Blueprint
         * text is parsed privately, attached once and fully validated before
         * writing. No parsed body or reusable spelling escapes this factory.
         * With authenticated proofs, keys must be verified content addresses
         * of the actual strings. Without proofs they are opaque dedup keys. */
        fun fromBlueprintParts(value:JSONObject,owners:Map<Pair<String,String>,String>,bodies:Map<String,String>,renderCapacityHint:Int,
                               verifiedBlueprintProofs:BlueprintReadProofs?=null,rawCandidate:CanonicalReadCandidate?=null):DomainDocument {
            val parsed=HashMap<String,JSONObject>();val reusable=java.util.IdentityHashMap<JSONObject,String>()
            val consumed=HashSet<Pair<String,String>>()
            val currentSchema=(value.opt("schemaVersion") as? Number)?.toDouble()==15.0
            val streamBlueprints=currentSchema&&renderCapacityHint>SNAPSHOT_CHARACTERS
            val decorations=owners.filterKeys{it.first=="decorationBlueprintResources"}.values.toSet()
            val cached=if(currentSchema&&verifiedBlueprintProofs!=null)PipelineCost.section("blueprint.checkpoint-reuse"){
                buildMap {for(key in bodies.keys)verifiedBlueprintProofs.proof(key,key in decorations)?.let{put(key,it)}}
            }else emptyMap()
            val scanned=if(currentSchema&&verifiedBlueprintProofs!=null)buildMap{
                for((key,wire) in bodies)verifiedBlueprintProofs.scan(key,wire,key in decorations)?.let{put(key,it)}
            }else emptyMap()
            val prepared=if(streamBlueprints)prepareLargeBlueprints(bodies.filterKeys{it !in cached&&it !in scanned},decorations)else emptyMap()
            val proofs=java.util.IdentityHashMap<JSONObject,DomainValidation.BlueprintProof>()
            for((section,slot)in blueprintFields){
                val rows=value.getJSONArray(section)
                for(i in 0 until rows.length()){
                    val row=rows.getJSONObject(i);val owner=section to row.getString("id");val key=owners[owner]?:continue
                    requireInput(consumed.add(owner)&&row.has(slot)&&row.isNull(slot),"$.$section[$i].$slot","Invalid blueprint attachment")
                    val body=parsed.getOrPut(key){
                        val wire=checkNotNull(bodies[key]){"Missing blueprint body"}
                        val path="$.$section[$i].$slot"
                        val proof=cached[key]?:when{
                            key in scanned->scanned.getValue(key).proof()
                            key in prepared->prepared[key]
                            currentSchema&&(wire.length>SNAPSHOT_CHARACTERS||streamBlueprints&&wire.length>=STREAMED_BLUEPRINT_CHARACTERS)->
                                DomainValidation.proveCanonicalBlueprint(wire,path,key in decorations)
                            else->null
                        }
                        if(proof!=null){
                            reusable[proof.header]=wire;proofs[proof.header]=proof
                            proof.header
                        }else{
                            val input=StrictJson.parseCanonicalInput(wire);val result=JsonChecks.obj(input.value,path)
                            if(input.reusable)reusable[result]=wire
                            result
                        }
                    }
                    row.put(slot,body)
                }
            }
            requireInput(consumed==owners.keys&&parsed.keys==bodies.keys,"$","Unreferenced blueprint parts")
            return fromOwned(value,renderCapacityHint,reusable,proofs.takeUnless{it.isEmpty()},rawCandidate)
        }
        /** The expensive scan of immutable bodies is independent of owner
         * assembly. One extra lane is enough for a large archive. Entries
         * needing normalization still go through the serial, owned decoder. */
        private fun prepareLargeBlueprints(bodies:Map<String,String>,decorations:Set<String>):Map<String,DomainValidation.BlueprintProof?> {
            if(Runtime.getRuntime().availableProcessors()<3||bodies.values.sumOf{it.length.toLong()}<PARALLEL_BLUEPRINT_CHARACTERS)return emptyMap()
            val eligible=bodies.entries.filter{it.value.length>=STREAMED_BLUEPRINT_CHARACTERS}.sortedByDescending{it.value.length}
            if(eligible.size<2)return emptyMap()
            val lanes=List(2){ArrayList<Map.Entry<String,String>>()}
            val weights=LongArray(2)
            for(entry in eligible){
                val lane=if(weights[0]<=weights[1])0 else 1
                lanes[lane].add(entry)
                weights[lane]+=entry.value.length.toLong()
            }
            fun prove(entries:List<Map.Entry<String,String>>) = entries.associateTo(HashMap()){(key,wire)->
                key to DomainValidation.proveCanonicalBlueprint(wire,"$.blueprint",key in decorations)
            }
            return PipelineCost.section("blueprint.parallel-proof"){
                val worker=FutureTask{prove(lanes[1])}
                Thread(worker,"blockcolc-blueprint-proof").apply{isDaemon=true;start()}
                try{prove(lanes[0]).also{it.putAll(worker.get())}}
                finally{worker.cancel(true)}
            }
        }
        internal fun adopt(value: JSONObject): DomainDocument = fromOwned(value)
        private fun fromOwned(raw: Any,renderCapacityHint:Int=16,canonicalBodies:java.util.IdentityHashMap<JSONObject,String>?=null,
                              blueprintProofs:java.util.IdentityHashMap<JSONObject,DomainValidation.BlueprintProof>?=null,
                              rawCandidate:CanonicalReadCandidate?=null): DomainDocument {
            try {
                // Migrations remain authoritative. Reuse is restricted to the
                // current schema and blueprint validation revokes it whenever
                // a normalizer changes the privately parsed body.
                if((raw as? JSONObject)?.opt("schemaVersion")?.let{it is Number&&it.toDouble()==15.0}!=true)canonicalBodies?.clear()
                val normalized = PipelineCost.section("domain.migrate") { DomainMigrations.current(JsonChecks.obj(raw, "$")) }
                PipelineCost.section("domain.validate") { DomainValidation.validate(normalized,canonicalBodies,blueprintProofs) }
                val spans=java.util.IdentityHashMap<JSONObject,StrictJson.ObjectSpan>()
                val sources=linkedMapOf<Pair<String,String>,StrictJson.ObjectSpan>()
                val metadata=JSONObject()
                normalized.keys().forEach{section->
                    val slot=blueprintFields[section]
                    if(slot==null)metadata.put(section,normalized.get(section))else{
                        val entries=normalized.getJSONArray(section);val headers=JSONArray()
                        for(i in 0 until entries.length()){
                            val item=entries.getJSONObject(i);val header=JSONObject()
                            item.keys().forEach{field->
                                if(field!=slot||item.isNull(field))header.put(field,item.get(field))else{
                                    val body=item.getJSONObject(field)
                                    val span=spans[body]?:StrictJson.ObjectSpan().also{spans[body]=it}
                                    sources[section to item.getString("id")]=span
                                    header.put(field,JSONObject().put("id",body.get("id")).put("title",body.get("title"))
                                        .put("bounds",body.get("bounds")).put("voxelCount",blueprintProofs?.get(body)?.voxelCount?:body.getJSONArray("voxels").length()))
                                }
                            }
                            headers.put(header)
                        }
                        metadata.put(section,headers)
                    }
                }
                val rootSpans=linkedMapOf<String,StrictJson.ObjectSpan>()
                // Split only when every tracked body can be replayed directly.
                // Mixed legacy inputs keep the original writer and its spans.
                val segments=if(renderCapacityHint>SNAPSHOT_CHARACTERS&&canonicalBodies!=null&&
                    canonicalBodies.values.any{it.length>=8192}&&spans.keys.all(canonicalBodies::containsKey))ArrayList<String>()else null
                val tail=StrictJson.renderTracked(normalized,spans,rootSpans,renderCapacityHint,canonicalBodies,segments)
                val canonical=if(segments.isNullOrEmpty())CanonicalWire(tail)else CanonicalWire(segments.apply{add(tail)})
                val slices=java.util.Collections.unmodifiableMap(sources.mapValues{(_,span)->
                    check(span.start>=0&&span.end>span.start);BlueprintSlice(span.start,span.end)
                })
                // A stream-validated header has no cell tree to snapshot.
                val snapshot=if(blueprintProofs==null&&canonical.length<=SNAPSHOT_CHARACTERS)StrictJson.copy(normalized) as JSONObject else null
                val controls=JSONObject()
                for(key in listOf("activeProjectId","activeFocusSession","focusHistory","progressReports","calendar"))controls.put(key,normalized.get(key))
                for(key in listOf("projects","habitBuildings")){
                    val source=normalized.getJSONArray(key);val rows=org.json.JSONArray()
                    for(i in 0 until source.length()){
                        val item=source.getJSONObject(i);val header=JSONObject()
                        item.keys().forEach{name->if(name!="importedBlueprint")header.put(name,item.get(name))}
                        rows.put(header)
                    }
                    controls.put(key,rows)
                }
                val active=normalized.optJSONObject("activeFocusSession")?.let(StrictJson::render)
                val resources=normalized.getJSONArray("decorationBlueprintResources")
                val resourceIds=java.util.Collections.unmodifiableSet((0 until resources.length()).map{resources.getJSONObject(it).getString("id")}.toSet())
                val birthday=JSONObject()
                for(key in listOf("birthday","birthdayRewards","calendar"))birthday.put(key,normalized.get(key))
                // Long histories can dominate an archive even without large
                // blueprints. Retain one canonical history, not separate full
                // focus and presentation copies. Read requested fields from
                // validated spans; only compact blueprint headers are stored.
                val rootSlices=java.util.Collections.unmodifiableMap(rootSpans.mapValues{(_,s)->BlueprintSlice(s.start,s.end)})
                val projectionSections=if(snapshot==null)blueprintFields.keys.associateWith{StrictJson.render(metadata.get(it))}else emptyMap()
                val controlSections=if(snapshot==null)listOf("projects","habitBuildings").associateWith{StrictJson.render(controls.get(it))}else emptyMap()
                return DomainDocument(canonical,snapshot,if(snapshot!=null)StrictJson.render(controls)else null,active,resourceIds,StrictJson.render(birthday),
                    if(snapshot!=null)StrictJson.render(metadata)else null,slices,rootSlices,projectionSections,controlSections,rawCandidate?.exactSha(canonical))
            } catch (e: org.json.JSONException) {
                throw StateInputException("INVALID_DOMAIN_STATE", "$", "Missing or mistyped JSON field")
            }
        }
    }
}
