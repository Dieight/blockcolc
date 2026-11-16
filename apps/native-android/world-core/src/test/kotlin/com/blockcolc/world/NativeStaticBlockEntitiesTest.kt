package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import kotlin.math.*

class NativeStaticBlockEntitiesTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/native-block-entities-oracle.json")!!.readText())}
    private val rasterizer=NativeSignRasterizer{NativePixelTexture(128,64,ByteBuffer.wrap(ByteArray(128*64*4)),mipmaps=false,wrapS=1001,wrapT=1001,minFilter=1006,magFilter=1006,anisotropy=1f)}
    private fun face(raw:JSONObject)=SignFace(raw.getJSONArray("lines").let{a->List(a.length()){a.getString(it)}},raw.getString("dyeColor"),raw.getBoolean("glowing"))
    private fun voxel(v:JSONObject):RenderVoxel {
        val props=v.optJSONObject("sourceBlockState")?.let{s->s.keys().asSequence().associateWith{s.getString(it)}}
        return RenderVoxel(v.getDouble("x"),v.getDouble("y"),v.getDouble("z"),v.getString("materialId"),v.getInt("buildOrder"),v.optString("sourceBlockId").ifEmpty{null},props,
            sign=v.optJSONObject("sign")?.let{SignText(face(it.getJSONObject("front")),face(it.getJSONObject("back")))},
            campfire=v.optJSONObject("campfire")?.getJSONArray("slots")?.let{a->List(a.length()){i->val s=a.getJSONObject(i);CampfireItem(s.getInt("slot"),s.getString("itemId"),s.getInt("count"))}})
    }
    private fun request(raw:JSONObject)=NativeBlockEntityRequest(raw.getString("owner"),raw.getJSONArray("voxels").let{a->List(a.length()){voxel(a.getJSONObject(it))}},
        if(raw.isNull("fallback"))null else raw.getJSONArray("fallback").let{a->(0 until a.length()).map{a.getInt(it)}.toSet()})
    @Test fun referenceIsBoundToTheActualSourceRendererAndThreePrimitives(){
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/renderer.ts").exists()}
        val hashes=oracle.getJSONObject("sourceHashes");hashes.keys().forEach{f->assertEquals(f,hashes.getString(f),MessageDigest.getInstance("SHA-256").digest(File(root,f).readBytes()).joinToString(""){"%02x".format(it.toInt()and 255)})}
    }
    private data class Triangle(val position:List<Double>,val normal:List<Double>,val uv:List<Double>,val color:List<Double>)
    private fun triangles(positions:JSONArray,normals:JSONArray,uv:JSONArray,indices:JSONArray,matrices:JSONArray,colors:JSONArray):List<Triangle> {
        val result=ArrayList<Triangle>()
        repeat(matrices.length()/16){instance->val m=BlockTransform.fromElements(DoubleArray(16){matrices.getDouble(instance*16+it)})
            val rotate=m.withPosition(0.0,0.0,0.0)
            for(t in 0 until indices.length() step 3){val p=ArrayList<Double>();val n=ArrayList<Double>();val texture=ArrayList<Double>()
                repeat(3){vertex->val id=indices.getInt(t+vertex)
                    val point=m.point(BlockPoint(positions.getDouble(id*3),positions.getDouble(id*3+1),positions.getDouble(id*3+2)))
                    val normal=rotate.point(BlockPoint(normals.getDouble(id*3),normals.getDouble(id*3+1),normals.getDouble(id*3+2)));val length=sqrt(normal.x*normal.x+normal.y*normal.y+normal.z*normal.z)
                    p.addAll(listOf(point.x,point.y,point.z));n.addAll(listOf(normal.x/length,normal.y/length,normal.z/length));texture.add(uv.getDouble(id*2));texture.add(uv.getDouble(id*2+1))
                }
                result+=Triangle(p,n,texture,List(3){colors.getDouble(instance*3+it)})
            }
        };return result
    }
    private fun kind(m:JSONObject):String {
        if(m.getBoolean("unlit"))return "approximate_sign_text"
        if(m.getBoolean("vertexColors"))return "approximate_campfire_item_markers"
        val color=m.getJSONArray("color").getDouble(0)
        return listOf(0x855a3a to "board",0x5f402d to "approximate_campfire_logs",0x302a25 to "approximate_campfire_coals",0xe97532 to "approximate_static_campfire_fire",0x5bc2d2 to "approximate_static_soul_campfire_fire")
            .minBy{abs(color-LinearRgb.fromSrgb(it.first).red)}.second
    }
    @Test fun allSignRotationsMountingsFrontBackAndCampfireDisplaysMatchTheCurrentRenderer(){
        val cases=oracle.getJSONArray("cases");assertEquals(117,cases.length())
        repeat(cases.length()){index->val c=cases.getJSONObject(index);val input=request(c.getJSONObject("input"));val expected=c.getJSONObject("expected")
            val compiler=NativeStaticBlockEntities(rasterizer);val plan=compiler.prepare(listOf(input)).getValue(input.owner)
            assertEquals("replaced $index",expected.getJSONArray("replaced").toList().map{(it as Number).toInt()}.toSet(),plan.replacedIndices)
            val builder=NativePacketBuilder(input.owner);compiler.append(builder,plan,BlockPoint(0.0,0.0,0.0),NativeStructurePlacement(BlockPoint(0.0,0.0,0.0)))
            val source=builder.build();val actual=linkedMapOf<String,MutableList<Triangle>>();val expectedTriangles=linkedMapOf<String,MutableList<Triangle>>()
            val meshes=expected.getJSONArray("meshes")
            for(i in 0 until meshes.length()){val mesh=meshes.getJSONObject(i);val k=mesh.getString("kind").let{if(it.startsWith("approximate_sign_board_"))"board"else it}
                expectedTriangles.getOrPut(k){arrayListOf()}.addAll(triangles(mesh.getJSONArray("position"),mesh.getJSONArray("normal"),mesh.getJSONArray("uv"),mesh.getJSONArray("indices"),mesh.getJSONArray("instances"),mesh.getJSONArray("colors")))
            }
            source.world?.let{w->for(packet in w.packets){val material=JSONObject(w.materials[packet.material]);val k=kind(material);val e=(0 until meshes.length()).map{meshes.getJSONObject(it)}.first{it.getString("kind").let{v->if(k=="board")v.startsWith("approximate_sign_board_")else v==k}}.getJSONObject("material")
                for(key in listOf("color","emission")){val a=material.getJSONArray(if(key=="emission")"emissive"else key);val b=e.getJSONArray(key);repeat(3){assertEquals("$index $k $key",b.getDouble(it),a.getDouble(it),1e-7)}}
                for(key in listOf("opacity","roughness","metalness"))if(!e.isNull(key))assertEquals(e.getDouble(key),material.getDouble(key),1e-7)
                assertEquals(e.getDouble("emissionStrength"),material.getDouble("emissiveIntensity"),1e-7)
                for(key in listOf("unlit","transparent","depthWrite","toneMapped","fog"))assertEquals("$index $k $key",e.getBoolean(key),material.getBoolean(key))
                assertEquals(e.getInt("side"),material.getInt("side"));assertEquals(e.getBoolean("castShadow"),packet.castShadow);assertEquals(e.getBoolean("receiveShadow"),packet.receiveShadow)
                assertEquals(e.getBoolean("texture"),!material.isNull("texture"))
                if(!material.isNull("texture")){val texture=source.textures[material.getInt("texture")];assertEquals(128,texture.width);assertEquals(64,texture.height);assertFalse(texture.mipmaps);assertTrue(material.getBoolean("flipY"))}
                val g=w.geometries[packet.geometry];val vertices=w.section(g.vertex);val positions=JSONArray();val normals=JSONArray();val uv=JSONArray()
                repeat(g.vertexCount){vertex->repeat(3){positions.put(vertices.getFloat(vertex*48+it*4).toDouble())};repeat(3){normals.put(vertices.getFloat(vertex*48+12+it*4).toDouble())};repeat(2){uv.put(vertices.getFloat(vertex*48+24+it*4).toDouble())}}
                val indices=w.section(g.index).asIntBuffer().let{b->JSONArray(List(b.remaining()){b.get()})};val rows=w.section(packet.instances).asFloatBuffer();val matrices=JSONArray();val colors=JSONArray()
                repeat(packet.count){repeat(16){matrices.put(rows.get().toDouble())};repeat(3){colors.put(rows.get().toDouble())};assertEquals(1f,rows.get(),0f)}
                actual.getOrPut(k){arrayListOf()}.addAll(triangles(positions,normals,uv,indices,matrices,colors))
            }}
            assertEquals("$index routes",expectedTriangles.keys,actual.keys)
            for((key,values)in expectedTriangles){val a=actual.getValue(key);assertEquals("$index $key triangles",values.size,a.size)
                for(i in values.indices)for((name,pair)in listOf("position" to (values[i].position to a[i].position),"normal" to (values[i].normal to a[i].normal),"uv" to (values[i].uv to a[i].uv),"color" to (values[i].color to a[i].color)))
                    for(j in pair.first.indices)assertEquals("$index $key $i $name $j",pair.first[j],pair.second[j],2e-6)
            }
        }
    }
    @Test fun worldWideAdmissionAndTileDeduplicationMatchTheSourceAcrossOwners(){
        val sequences=oracle.getJSONArray("budget")
        repeat(sequences.length()){i->val s=sequences.getJSONObject(i);val requests=s.getJSONArray("requests").let{a->List(a.length()){request(a.getJSONObject(it))}}
            val compiler=NativeStaticBlockEntities(rasterizer);val plans=compiler.prepare(requests);val expected=s.getJSONArray("expected")
            for((index,request)in requests.withIndex()){val plan=plans.getValue(request.owner);val e=expected.getJSONObject(index)
                assertEquals(e.getJSONArray("replaced").toList().map{(it as Number).toInt()}.toSet(),plan.replacedIndices)
                assertEquals(e.getInt("textFaces"),plan.signs.sumOf{(if(it.front==null)0 else 1)+(if(it.back==null)0 else 1)})
                assertEquals(e.getInt("tokens"),plan.campfires.sumOf{it.markers.sumOf{m->m.tokens}})
                compiler.append(NativePacketBuilder(request.owner),plan,BlockPoint(0.0,0.0,0.0),NativeStructurePlacement(BlockPoint(0.0,0.0,0.0)))
            }
            assertTrue(compiler.retainedTextBytes<=2L*1024*1024);assertEquals(104,plans.values.sumOf{it.pendingBlocks})
            assertEquals(if(s.getString("mode")=="faces")192 else 0,plans.values.sumOf{it.omittedTextFaces})
            val again=compiler.prepare(requests);assertEquals(plans,again)
            compiler.prepare(emptyList());assertEquals(0L,compiler.retainedTextBytes)
        }
    }
    @Test fun markerHashHueScaleYawAndJavascriptRotationParsingRemainDeterministic(){
        val rotations=oracle.getJSONArray("rotations");repeat(rotations.length()){i->val r=rotations.getJSONObject(i);assertEquals(r.getDouble("yaw"),NativeStaticBlockEntities.standingYaw(if(r.isNull("value"))null else r.getString("value")),0.0)}
        val items=oracle.getJSONArray("items");repeat(items.length()){i->val r=items.getJSONObject(i);val e=r.getJSONObject("expected");val a=NativeStaticBlockEntities.appearance(r.getString("id"))
            assertEquals(e.getLong("hash"),a.hash);assertEquals(e.getInt("hueDegrees"),a.hueDegrees);assertEquals(e.getDouble("saturation"),a.saturation,0.0);assertEquals(e.getDouble("lightness"),a.lightness,0.0);assertEquals(e.getDouble("scale"),a.scale,0.0);assertEquals(e.getDouble("yaw"),a.yaw,0.0)}
    }
    @Test fun onlyReplacedFallbackMembersAreRemovedAndOtherInstanceAttributesStayAligned(){
        val input=request(oracle.getJSONArray("cases").getJSONObject(0).getJSONObject("input"));val sign=input.voxels.single()
        val voxels=listOf(RenderVoxel(-1.0,0.0,0.0,"stone",0),sign,RenderVoxel(1.0,0.0,0.0,"wood",0,"minecraft:oak_log"),RenderVoxel(3.0,0.0,0.0,"wood",0,"minecraft:oak_log"))
        val recipe=BuildingPreparation.staticStructure(voxels,"filter");val structure=OriginalStructureCompiler().compile(recipe);val packets=NativeOriginalPackets();val pose=NativeStructurePlacement(BlockPoint(0.0,0.0,0.0))
        val entities=NativeStaticBlockEntities(rasterizer)
        assertEquals(entities.prepare(listOf(NativeBlockEntityRequest("building:filter",voxels))),entities.prepare(listOf(NativeBlockEntityRequest("building:filter",voxels,metadataIndices=listOf(1)))))
        assertThrows(IllegalArgumentException::class.java){entities.prepare(listOf(NativeBlockEntityRequest("building:filter",voxels,metadataIndices=listOf(1,1))))}
        fun pack(skip:Set<Int>)=NativePacketBuilder("building:filter").also{packets.append(it,structure,pose,NativeSurfaceState(),skippedMembers=skip)}.build()
        val before=pack(emptySet());val after=pack(setOf(1));assertEquals(before.world!!.packets.sumOf{it.count}-1,after.world!!.packets.sumOf{it.count})
        val originalRows=before.world.packets.flatMap{p->val b=before.world.instanceRows(p);List(p.count){i->ByteArray(96).also{b.duplicate().position(i*96).get(it)}}}
        for(p in after.world.packets){val b=after.world.instanceRows(p);repeat(p.count){i->val bytes=ByteArray(96).also{b.duplicate().position(i*96).get(it)};assertTrue(originalRows.any{it.contentEquals(bytes)})}}
    }
    @Test fun distantOriginsPreserveDetailsAndFailedOrCancelledRasterizationCannotPublishHalfAnOwner(){
        val v=request(oracle.getJSONArray("cases").getJSONObject(0).getJSONObject("input")).voxels.single();val compiler=NativeStaticBlockEntities(rasterizer)
        fun build(voxel:RenderVoxel,origin:BlockPoint,pose:NativeStructurePlacement):NativePacketSource {val plan=compiler.prepare(listOf(NativeBlockEntityRequest("building:far",listOf(voxel)))).getValue("building:far");return NativePacketBuilder("building:far").also{compiler.append(it,plan,origin,pose)}.build()}
        val near=build(v,BlockPoint(0.0,0.0,0.0),NativeStructurePlacement(BlockPoint(7.0,5.0,-8.0),.7))
        val base=1e12;val far=build(v.copy(x=v.x+base,y=v.y+base,z=v.z+base),BlockPoint(base,base,base),NativeStructurePlacement(BlockPoint(7.0,5.0-base,-8.0),.7,Position2(-base,-base)))
        assertEquals(near.geometryKeys,far.geometryKeys)
        for((i,p)in near.world!!.packets.withIndex()){val a=near.world.section(p.instances).asFloatBuffer();val b=far.world!!.section(far.world.packets[i].instances).asFloatBuffer();while(a.hasRemaining())assertEquals(a.get(),b.get(),0f)}
        assertThrows(CancellationException::class.java){compiler.prepare(listOf(NativeBlockEntityRequest("building:cancel",listOf(v)))){true}}
        val missing=NativeStaticBlockEntities();val plan=missing.prepare(listOf(NativeBlockEntityRequest("building:missing",listOf(v)))).getValue("building:missing")
        assertThrows(IllegalStateException::class.java){missing.append(NativePacketBuilder("building:missing"),plan,BlockPoint(0.0,0.0,0.0),NativeStructurePlacement(BlockPoint(0.0,0.0,0.0)))}
        compiler.clear();assertEquals(0L,compiler.retainedTextBytes)
    }
}
