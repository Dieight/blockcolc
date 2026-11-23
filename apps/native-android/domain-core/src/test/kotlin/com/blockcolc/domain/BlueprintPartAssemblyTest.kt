package com.blockcolc.domain

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

class BlueprintPartAssemblyTest {
    private fun fixture(count:Int=1):Pair<JSONObject,JSONObject>{
        val result=DomainEngine.execute(DomainEngine.initial("UTC"),DomainEngine.command("CreateProject",
            "projectId" to "work","title" to "Work","blueprintId" to "parts-test",
            "subtasks" to JSONArray().put(JSONObject().put("id","task").put("title","Task"))),0)
        check(result.ok){result.error.orEmpty()}
        val cells=JSONArray()
        repeat(count){i->cells.put(JSONObject().put("x",i%64).put("y",i/64).put("z",0)
            .put("materialId","stone").put("stage","foundation").put("buildOrder",0))}
        val body=JSONObject().put("schemaVersion",1).put("id","parts-test").put("title","部分拼接😀")
            .put("bounds",JSONObject().put("minX",0).put("maxX",minOf(63,count-1)).put("minY",0)
                .put("maxY",(count-1)/64).put("minZ",0).put("maxZ",0)).put("voxels",cells)
        val root=result.state.json()
        root.getJSONArray("projects").getJSONObject(0).put("importedBlueprint",body)
        root.getJSONArray("buildingBlueprintResources").put(JSONObject().put("id","parts-test").put("displayName","Parts")
            .put("blueprint",body).put("importedAt","1970-01-01T00:00:00.000Z"))
        return root to body
    }
    private val owners=mapOf(("projects" to "work") to "body",("buildingBlueprintResources" to "parts-test") to "body")
    private fun assemble(root:JSONObject,wire:String,hint:Int=wire.length*2+4096,
                         proofs:BlueprintReadProofs?=null,candidate:CanonicalReadCandidate?=null):DomainDocument {
        root.getJSONArray("projects").getJSONObject(0).put("importedBlueprint",JSONObject.NULL)
        root.getJSONArray("buildingBlueprintResources").getJSONObject(0).put("blueprint",JSONObject.NULL)
        return DomainDocument.fromBlueprintParts(root,owners,mapOf("body" to wire),hint,proofs,candidate)
    }
    @Test fun speculativeProofsCannotReplaceValidationOfDifferentActualText(){
        val (root,body)=fixture(80)
        val wire=StrictJson.render(body)
        val scan=BlueprintReadProofs.fromCompletedScans(mapOf("body" to BlueprintReadProofs.scanCurrentWire(wire,false)))
        val raw=CanonicalReadCandidate.digest(listOf(StrictJson.render(root)))
        body.put("title","更新标题🐈")
        val expected=DomainDocument.fromJson(root)
        val updated=StrictJson.render(body)
        val actual=assemble(StrictJson.copy(root) as JSONObject,updated,proofs=scan,candidate=raw)
        assertEquals(expected.canonical,actual.canonical)
        assertEquals(expected.sha256,actual.sha256)
        val invalid=updated.replaceFirst("\"buildOrder\":0","\"buildOrder\":-1")
        assertThrows(StateInputException::class.java){assemble(root,invalid,proofs=scan,candidate=raw)}
        assertThrows(IllegalArgumentException::class.java){CanonicalReadCandidate.digest(listOf("\uD83D","","\uDC08"))}
    }
    @Test fun largeSharedBodiesKeepEveryCanonicalByteOwnerSliceAndDetachedProjection(){
        val (root,body)=fixture(4096)
        val voxels=body.getJSONArray("voxels")
        voxels.getJSONObject(0).put("x",-1).put("sourceBlockId","minecraft:sea_lantern")
            .put("sourceBlockState",JSONObject().put("axis","x").put("waterlogged","false"))
            .put("emissiveKind","glow").put("emissiveLevel",15)
        body.getJSONObject("bounds").put("minX",-1)
        fun signFace()=JSONObject().put("lines",JSONArray().put("路标")).put("dyeColor","white").put("glowing",false)
        voxels.getJSONObject(1).put("sourceBlockId","minecraft:oak_sign")
            .put("sign",JSONObject().put("front",signFace()).put("back",signFace()))
        val wire=StrictJson.render(body)
        val expected=DomainDocument.parse(StrictJson.render(root));var reused=0;val stages=mutableSetOf<String>()
        lateinit var actual:DomainDocument
        PipelineCost.collect({name,_,_,_->stages.add(name);if(name=="json.reuse-blueprint")reused++}){actual=assemble(root,wire)}
        assertEquals(1,reused)
        assertTrue("blueprint.stream-validate" in stages)
        assertTrue("json.retain-blueprint" in stages)
        assertFalse("blueprint.validate" in stages)
        assertEquals(expected.canonical,actual.canonical);assertEquals(expected.sha256,actual.sha256)
        for(owner in owners.keys)assertSame(wire,actual.blueprintCanonical(owner.first,owner.second))
        assertEquals(expected.projectionJson().toString(),actual.projectionJson().toString())
        root.getJSONArray("projects").getJSONObject(0).getJSONObject("importedBlueprint").put("title","mutated later")
        assertEquals(expected.canonical,actual.canonical)
        assertEquals(wire,actual.blueprintCanonical("projects","work"))
        val command=DomainEngine.command("StartFocus","sessionId" to "first","projectId" to "work","subtaskId" to "task","plannedDurationMs" to 60_000)
        val started=DomainEngine.execute(actual,command,0)
        assertTrue(started.error,started.ok)
        assertNotNull(started.state.activeFocusWireFrom(actual))
        assertSame(wire,started.state.blueprintCanonical("buildingBlueprintResources","parts-test"))
        assertEquals(DomainEngine.execute(expected,command,0).state.canonical,started.state.canonical)
    }
    @Test fun twoValidationLanesKeepWireOrderAndRejectAnInvalidBodyInEitherLane(){
        assumeTrue(Runtime.getRuntime().availableProcessors()>=3)
        val (root,first)=fixture(10000)
        val voxels=first.getJSONArray("voxels")
        val longState=JSONObject().put("type","x".repeat(128))
        repeat(voxels.length()){index->voxels.getJSONObject(index).put("sourceBlockId","minecraft:stone").put("sourceBlockState",longState)}
        val second=JSONObject().put("schemaVersion",1).put("id","other-parts").put("title","Other parts")
            .put("bounds",first.getJSONObject("bounds")).put("voxels",voxels)
        val resource=root.getJSONArray("buildingBlueprintResources").getJSONObject(0)
        resource.put("id","other-parts").put("blueprint",second)
        val firstWire=StrictJson.render(first);val secondWire=StrictJson.render(second)
        val expected=StrictJson.render(root)
        val metadata=root.getJSONArray("projects").getJSONObject(0)
        metadata.put("importedBlueprint",JSONObject.NULL)
        resource.put("blueprint",JSONObject.NULL)
        val source=StrictJson.render(root)
        val separateOwners=mapOf(("projects" to "work") to "first",("buildingBlueprintResources" to "other-parts") to "second")
        fun assembleBoth(a:String,b:String):DomainDocument = DomainDocument.fromBlueprintParts(JSONObject(source),separateOwners,
            mapOf("first" to a,"second" to b),a.length+b.length+4096)
        val stages=mutableSetOf<String>()
        val actual=PipelineCost.collect({name,_,_,_->stages.add(name)}){assembleBoth(firstWire,secondWire)}
        assertTrue("blueprint.parallel-proof" in stages)
        assertEquals(expected,actual.canonical)
        assertEquals(secondWire,actual.blueprintCanonical("buildingBlueprintResources","other-parts"))
        fun invalid(wire:String)=wire.replaceFirst("\"buildOrder\":0","\"buildOrder\":-1")
        val left=assertThrows(StateInputException::class.java){assembleBoth(invalid(firstWire),secondWire)}
        val right=assertThrows(StateInputException::class.java){assembleBoth(firstWire,invalid(secondWire))}
        assertEquals("$.projects[0].importedBlueprint.voxels[0].buildOrder",left.path)
        assertEquals("$.buildingBlueprintResources[0].blueprint.voxels[0].buildOrder",right.path)
    }
    @Test fun noncanonicalSpellingsRemainValidButAreWrittenCanonically(){
        for(kind in listOf("whitespace","key-order","escape","number")){
            val (root,body)=fixture(if(kind=="number")4096 else 1)
            val wire=when(kind){
                "whitespace"->StrictJson.render(body).replace(",",", ")
                "key-order"->"{\"voxels\":"+StrictJson.render(body.get("voxels"))+","+StrictJson.render(body).substring(1).substringBeforeLast(",\"voxels\"")+"}"
                "escape"->StrictJson.render(body).replace("部分","\\u90e8分")
                else->StrictJson.render(body).replace("\"x\":0","\"x\":0.0")
            }
            val expected=DomainDocument.parse(StrictJson.render(root));var reused=0
            lateinit var actual:DomainDocument
            PipelineCost.collect({name,_,_,_->if(name=="json.reuse-blueprint")reused++}){actual=assemble(root,wire)}
            assertEquals(kind,0,reused);assertEquals(kind,expected.canonical,actual.canonical)
        }
    }
    @Test fun overestimatedSizeDoesNotTurnStreamedHeadersIntoASnapshot(){
        val (root,body)=fixture(80)
        val expected=DomainDocument.fromJson(root)
        val actual=assemble(root,StrictJson.render(body),DomainDocument.SNAPSHOT_CHARACTERS+1)
        assertTrue(actual.canSpliceStartedFocus)
        assertFalse(DomainCheckpointCodec.eligible(actual))
        assertEquals(expected.canonical,actual.canonical)
        assertEquals(expected.canonical,StrictJson.render(actual.json()))
        assertEquals(expected.projectionJson().toString(),actual.projectionJson().toString())
    }
    @Test fun canonicalCampfireSlotsKeepTheStreamedBody(){
        val (root,body)=fixture(4096)
        body.getJSONArray("voxels").getJSONObject(0).put("sourceBlockId","minecraft:campfire")
            .put("campfire",JSONObject().put("slots",JSONArray()
                .put(JSONObject().put("slot",0).put("itemId","minecraft:potato").put("count",1))
                .put(JSONObject().put("slot",2).put("itemId","minecraft:carrot").put("count",1))))
        val wire=StrictJson.render(body)
        val expected=DomainDocument.fromJson(root)
        val stages=mutableSetOf<String>()
        val actual=PipelineCost.collect({name,_,_,_->stages.add(name)}){assemble(root,wire)}
        assertEquals(expected.canonical,actual.canonical)
        assertEquals(wire,actual.blueprintCanonical("projects","work"))
        assertTrue("json.reuse-blueprint" in stages)
        assertFalse("blueprint.validate" in stages)
    }
    @Test fun normalizationRevokesRawReuseForEmptyStatesAndUnsortedCampfireSlots(){
        for(kind in listOf("empty-state","moved-state","campfire")){
            val (root,body)=fixture(if(kind=="moved-state")1 else 4096);val cell=body.getJSONArray("voxels").getJSONObject(0)
            when(kind){
                "empty-state"->cell.put("sourceBlockState",JSONObject())
                "moved-state"->cell.put("sourceBlockId","minecraft:moving_piston").put("movingPistonMovedState",JSONObject()
                    .put("blockId","minecraft:stone").put("properties",JSONObject()))
                else->cell.put("sourceBlockId","minecraft:campfire").put("campfire",JSONObject().put("slots",JSONArray()
                    .put(JSONObject().put("slot",1).put("itemId","minecraft:carrot").put("count",1))
                    .put(JSONObject().put("slot",0).put("itemId","minecraft:potato").put("count",1))))
            }
            val wire=StrictJson.render(body);assertTrue(StrictJson.parseCanonicalInput(wire).reusable)
            val expected=DomainDocument.parse(StrictJson.render(root));var reused=0
            lateinit var actual:DomainDocument
            PipelineCost.collect({name,_,_,_->if(name=="json.reuse-blueprint")reused++}){actual=assemble(root,wire)}
            assertEquals(kind,0,reused);assertEquals(kind,expected.canonical,actual.canonical)
            assertNotEquals(kind,wire,actual.blueprintCanonical("projects","work"))
        }
    }
    @Test fun rawReuseDoesNotSkipBodyValidationOrCrossRecordReferences(){
        val (root,body)=fixture(4096);body.getJSONArray("voxels").getJSONObject(4095).put("buildOrder",-1)
        val invalid=assertThrows(StateInputException::class.java){assemble(root,StrictJson.render(body))}
        assertEquals("$.projects[0].importedBlueprint.voxels[4095].buildOrder",invalid.path)
        val (unsafe,withState)=fixture(4096)
        for(index in 0..1)withState.getJSONArray("voxels").getJSONObject(index).put("sourceBlockState",JSONObject().put("axis","x"))
        withState.getJSONArray("voxels").getJSONObject(2).put("sourceBlockState",JSONObject().put("__proto__","stone"))
        val stateError=assertThrows(StateInputException::class.java){assemble(unsafe,StrictJson.render(withState))}
        assertTrue(stateError.path.endsWith("sourceBlockState.__proto__"))
        val (duplicate,withRepeatedKey)=fixture(4096)
        val repeated=StrictJson.render(withRepeatedKey).replaceFirst("\"x\":0","\"x\":0,\"x\":0")
        assertEquals("INVALID_JSON",assertThrows(StateInputException::class.java){assemble(duplicate,repeated)}.code)
        val (wrong,valid)=fixture(4096);wrong.getJSONArray("projects").getJSONObject(0).put("blueprintId","other")
        assertThrows(StateInputException::class.java){assemble(wrong,StrictJson.render(valid))}
        val (decoration,wide)=fixture(4096)
        decoration.getJSONArray("decorationBlueprintResources").put(JSONObject().put("id","parts-test")
            .put("blueprint",JSONObject.NULL).put("importedAt","1970-01-01T00:00:00.000Z"))
        decoration.getJSONArray("projects").getJSONObject(0).put("importedBlueprint",JSONObject.NULL)
        decoration.getJSONArray("buildingBlueprintResources").getJSONObject(0).put("blueprint",JSONObject.NULL)
        assertThrows(StateInputException::class.java){DomainDocument.fromBlueprintParts(decoration,
            owners+(("decorationBlueprintResources" to "parts-test") to "body"),mapOf("body" to StrictJson.render(wide)),10000)}
    }
    @Test fun unreferencedBodiesAndOwnersAreRejected(){
        val (root,body)=fixture();val wire=StrictJson.render(body)
        root.getJSONArray("projects").getJSONObject(0).put("importedBlueprint",JSONObject.NULL)
        root.getJSONArray("buildingBlueprintResources").getJSONObject(0).put("blueprint",JSONObject.NULL)
        assertThrows(StateInputException::class.java){DomainDocument.fromBlueprintParts(root,owners,mapOf("body" to wire,"unused" to wire),10000)}
        val (missing,_)=fixture()
        missing.getJSONArray("projects").getJSONObject(0).put("importedBlueprint",JSONObject.NULL)
        missing.getJSONArray("buildingBlueprintResources").getJSONObject(0).put("blueprint",JSONObject.NULL)
        assertThrows(StateInputException::class.java){DomainDocument.fromBlueprintParts(missing,owners+(("projects" to "absent") to "body"),mapOf("body" to wire),10000)}
    }
}
