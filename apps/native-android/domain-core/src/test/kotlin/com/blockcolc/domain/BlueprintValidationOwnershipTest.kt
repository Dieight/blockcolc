package com.blockcolc.domain

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BlueprintValidationOwnershipTest {
    private fun cellsBody(points:List<Triple<Long,Long,Long>>):JSONObject {
        val cells=JSONArray()
        for((x,y,z) in points)cells.put(JSONObject().put("x",x).put("y",y).put("z",z).put("materialId","stone").put("stage","foundation").put("buildOrder",0))
        return JSONObject().put("schemaVersion",1).put("id","coordinate-test").put("title","Coordinates")
            .put("bounds",JSONObject().put("minX",points.minOf{it.first}).put("maxX",points.maxOf{it.first})
                .put("minY",points.minOf{it.second}).put("maxY",points.maxOf{it.second}).put("minZ",points.minOf{it.third}).put("maxZ",points.maxOf{it.third}))
            .put("voxels",cells)
    }
    @Test fun sparseCoordinatesMatchIndependentUniquenessAcrossTheFullAllowedVolume(){
        val random=java.util.Random(80477)
        for(base in listOf(-JsonChecks.SAFE,0L,JsonChecks.SAFE-256)){
            val points=linkedSetOf(Triple(base,base,base),Triple(base+95,base+255,base+95))
            repeat(1000){points.add(Triple(base+random.nextInt(96),base+random.nextInt(256),base+random.nextInt(96)))}
            val body=cellsBody(points.toList())
            DomainValidation.blueprint(body,"$.coordinates")
            body.getJSONArray("voxels").put(StrictJson.copy(body.getJSONArray("voxels").getJSONObject(0)))
            val duplicate=assertThrows(StateInputException::class.java){DomainValidation.blueprint(body,"$.coordinates")}
            assertTrue(duplicate.message.orEmpty().contains("Duplicate voxel coordinate"))
        }
    }
    @Test fun adjacentCoordinatesNeverAliasAndBoundsStillExactlyEncloseTheirCells(){
        val points=(0L..95).map{Triple(it,0L,0L)}
        val body=cellsBody(points)
        DomainValidation.blueprint(body,"$.adjacent")
        body.getJSONObject("bounds").put("maxX",94)
        assertThrows(StateInputException::class.java){DomainValidation.blueprint(body,"$.adjacent")}
        body.getJSONObject("bounds").put("maxX",95).put("minY",-1)
        assertThrows(StateInputException::class.java){DomainValidation.blueprint(body,"$.adjacent")}
    }
    @Test fun voxelShapeChecksOptionalFieldsAndReportsExactInvalidFieldPaths(){
        val body=cellsBody(listOf(Triple(0L,0L,0L)))
        val cell=body.getJSONArray("voxels").getJSONObject(0)
        cell.put("sourceBlockId","minecraft:oak_log").put("sourceBlockState",JSONObject().put("axis","y"))
        assertFalse(DomainValidation.blueprint(body,"$.blueprint"))
        cell.remove("stage")
        cell.put("extra",true)
        fun invalidPath()=assertThrows(StateInputException::class.java){DomainValidation.blueprint(body,"$.blueprint")}.path
        assertEquals("$.blueprint.voxels[0].extra",invalidPath())
        cell.remove("extra")
        assertEquals("$.blueprint.voxels[0].stage",invalidPath())
        cell.put("stage","foundation")
        cell.getJSONObject("sourceBlockState").put("axis","")
        assertEquals("$.blueprint.voxels[0].sourceBlockState.axis",invalidPath())
    }
    private fun fixture(width:Int=1):Pair<JSONObject,JSONObject>{
        val voxel={x:Int->JSONObject().put("x",x).put("y",0).put("z",0).put("materialId","stone").put("stage","foundation").put("buildOrder",0)}
        val cells=JSONArray().put(voxel(0));if(width>1)cells.put(voxel(width-1))
        val body=JSONObject().put("schemaVersion",1).put("id","owned-test").put("title","Owned")
            .put("bounds",JSONObject().put("minX",0).put("maxX",width-1).put("minY",0).put("maxY",0).put("minZ",0).put("maxZ",0)).put("voxels",cells)
        val result=DomainEngine.execute(DomainEngine.initial("UTC"),DomainEngine.command("CreateProject","projectId" to "work","title" to "Work","blueprintId" to "owned-test",
            "subtasks" to JSONArray().put(JSONObject().put("id","task").put("title","Task"))),0)
        check(result.ok){result.error.orEmpty()}
        val root=result.state.json();val project=root.getJSONArray("projects").getJSONObject(0)
        project.put("importedBlueprint",body)
        root.getJSONArray("buildingBlueprintResources").put(JSONObject().put("id","owned-test").put("displayName","Owned").put("blueprint",body).put("importedAt",project.getString("createdAt")))
        return root to body
    }
    @Test fun sharedDecoderAssetsMatchDetachedWireAndLaterMutationIsRevalidated(){
        val (root,body)=fixture()
        val detached=DomainDocument.parse(StrictJson.render(root));val owned=DomainDocument.fromOwnedJson(root)
        assertEquals(detached.canonical,owned.canonical)
        assertEquals(owned.blueprintCanonical("projects","work"),owned.blueprintCanonical("buildingBlueprintResources","owned-test"))
        body.getJSONArray("voxels").getJSONObject(0).put("buildOrder",-1)
        assertThrows(StateInputException::class.java){DomainDocument.fromOwnedJson(root)}
        assertEquals(detached.canonical,owned.canonical)
    }
    @Test fun aSharedBuildingBodyStillMustMeetTheStricterDecorationLimits(){
        val (root,body)=fixture(13)
        DomainDocument.fromOwnedJson(root)
        root.getJSONArray("decorationBlueprintResources").put(JSONObject().put("id","owned-test").put("blueprint",body).put("importedAt","1970-01-01T00:00:00.000Z"))
        assertThrows(StateInputException::class.java){DomainDocument.fromOwnedJson(root)}
    }
    @Test fun repeatedNormalizedBodiesCanReuseValidationButChangedValuesAndLimitsCannot(){
        val (root,body)=fixture()
        body.put("title","Cache ownership probe")
        val cell=body.getJSONArray("voxels").getJSONObject(0)
        cell.put("sourceBlockId","minecraft:campfire").put("campfire",JSONObject().put("slots",JSONArray()
            .put(JSONObject().put("slot",1).put("itemId","minecraft:carrot").put("count",1))
            .put(JSONObject().put("slot",0).put("itemId","minecraft:potato").put("count",1))))
        val first=DomainDocument.fromOwnedJson(root)
        var validations=0
        PipelineCost.collect({name,_,_,_->if(name=="blueprint.validate")validations++}){
            assertEquals(first,DomainDocument.parse(first.canonical))
        }
        assertEquals(0,validations)
        val changed=first.json()
        val blueprint=changed.getJSONArray("projects").getJSONObject(0).getJSONObject("importedBlueprint")
        assertEquals(0,blueprint.getJSONArray("voxels").getJSONObject(0).getJSONObject("campfire").getJSONArray("slots").getJSONObject(0).getInt("slot"))
        blueprint.getJSONArray("voxels").getJSONObject(0).getJSONObject("campfire").getJSONArray("slots").getJSONObject(0).put("count",-1)
        assertThrows(StateInputException::class.java){DomainDocument.fromOwnedJson(changed)}
        val unknown=first.json();unknown.getJSONArray("projects").getJSONObject(0).getJSONObject("importedBlueprint").put("unexpected",true)
        assertThrows(StateInputException::class.java){DomainDocument.fromOwnedJson(unknown)}
    }
    @Test fun blockPropertiesKeepTheirAsciiGrammarAndUnsafeKeyRejections(){
        for(key in listOf("facing","axis_2","custom.part-1","a".repeat(64))){
            val (root,body)=fixture();body.getJSONArray("voxels").getJSONObject(0).put("sourceBlockState",JSONObject().put(key,"north"))
            assertEquals("north",DomainDocument.fromOwnedJson(root).json().getJSONArray("projects").getJSONObject(0).getJSONObject("importedBlueprint").getJSONArray("voxels").getJSONObject(0).getJSONObject("sourceBlockState").getString(key))
        }
        for(key in listOf("","Facing","方位","x/y","x\ny","a".repeat(65),"__proto__","prototype","constructor")){
            val (root,body)=fixture();body.getJSONArray("voxels").getJSONObject(0).put("sourceBlockState",JSONObject().put(key,"north"))
            assertThrows(key,StateInputException::class.java){DomainDocument.fromOwnedJson(root)}
        }
    }
}
