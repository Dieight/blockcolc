package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.ReadOnlyBufferException
import java.security.MessageDigest

class OriginalBlockShapesTest {
    private val oracle by lazy{JSONObject(javaClass.getResource("/original-shape-oracle.json")!!.readText())}
    private fun equivalent(label:String,expected:Any?,actual:Any?) {
        when(expected) {
            null,JSONObject.NULL->assertTrue(label,actual==null||actual==JSONObject.NULL)
            is JSONObject->{assertTrue(label,actual is JSONObject);val value=actual as JSONObject;val keys=expected.keys().asSequence().toSet()
                assertEquals("$label keys",keys,value.keys().asSequence().toSet());for(key in keys)equivalent("$label.$key",expected.get(key),value.get(key))}
            is JSONArray->{assertTrue(label,actual is JSONArray);val value=actual as JSONArray;assertEquals("$label length",expected.length(),value.length());repeat(expected.length()){equivalent("$label[$it]",expected.get(it),value.get(it))}}
            is Number->{assertTrue(label,actual is Number);assertEquals(label,expected.toDouble(),(actual as Number).toDouble(),1e-12)}
            else->assertEquals(label,expected,actual)
        }
    }
    private fun point(p:BlockPoint)=JSONArray(listOf(p.x,p.y,p.z))
    private fun box(b:BlockBox)=JSONObject().put("min",point(b.min)).put("max",point(b.max))
    private fun plan(shape:OriginalBlockShape):JSONObject {
        val value=JSONObject().put("kind",if(shape.family==null)"cube-fallback"else"original-approximation").put("topologyKey",shape.topologyKey)
            .put("boxes",JSONArray(shape.boxes.map(::box))).put("bounds",box(shape.bounds)).put("volume",shape.volume)
        shape.sourceBlockId?.let{value.put("sourceBlockId",it)};shape.reason?.let{value.put("reason",it.wireValue)};shape.family?.let{value.put("family",it.wireValue)}
        shape.components?.let{components->value.put("components",JSONArray(components.map{c->JSONObject().put("key",c.key).put("topologyKey",c.topologyKey).put("boxes",JSONArray(c.boxes.map(::box)))
            .put("transform",JSONArray(List(16){c.transform[it]})).put("bounds",box(c.bounds))}))}
        return value
    }
    private fun state(input:JSONObject):OriginalBlockState {
        if(!input.has("sourceBlockState"))return OriginalBlockState.Absent
        val raw=input.opt("sourceBlockState") as? JSONObject?:return OriginalBlockState.Invalid
        val values=LinkedHashMap<String,String>()
        for(key in raw.keys()){val value=raw.get(key) as? String?:return OriginalBlockState.Invalid;values[key]=value}
        return OriginalBlockState.Values(values)
    }
    private fun sha(values:FloatBuffer):String {
        val bytes=ByteBuffer.allocate(values.remaining()*4).order(ByteOrder.LITTLE_ENDIAN)
        while(values.hasRemaining())bytes.putFloat(values.get())
        return MessageDigest.getInstance("SHA-256").digest(bytes.array()).joinToString(""){"%02x".format(it.toInt() and 255)}
    }
    @Test fun theBundledRegistryContainsOnlyExactCurrentVanillaFamilyMembership() {
        val expected=oracle.getJSONObject("registry");val registry=OriginalShapeRegistry.bundled;val ids=linkedSetOf<String>()
        for(family in expected.keys()) {
            val blocks=expected.getJSONArray(family)
            repeat(blocks.length()){val id=blocks.getString(it);if(ids.add(id))assertEquals(family,registry.family(id)!!.wireValue)}
        }
        assertEquals(459,ids.size);assertEquals(ids,registry.blockIds)
        assertEquals(oracle.getJSONObject("sourceHashes").getString("packages/voxel/src/original-static-shapes.ts"),registry.sourceSha)
        assertTrue(registry.contentSha.matches(Regex("[a-f0-9]{64}")))
        assertNull(registry.family("unknown_stairs"));assertNull(registry.family("minecraft:oak_stairs"))
        assertThrows(UnsupportedOperationException::class.java){(registry.blockIds as MutableSet).clear()}
    }
    @Test fun allStateFamiliesFallbacksComponentTransformsBoundsAndTopologyKeysMatchTheFormalPlanner() {
        val planner=OriginalBlockShapes();val cases=oracle.getJSONArray("plans");assertTrue(cases.length()>1200)
        for(i in 0 until cases.length()) {
            val c=cases.getJSONObject(i);val input=c.getJSONObject("input");val id=if(input.isNull("sourceBlockId"))null else input.getString("sourceBlockId")
            val actual=planner.plan(id,state(input));equivalent("shape $i $input",c.getJSONObject("result"),plan(actual))
            assertEquals(actual.family!=null||actual.reason==OriginalShapeFallback.STATE,planner.isCandidate(id))
        }
    }
    @Test fun nativeStateToActualComponentMeshesMatchesEveryFormalUploadWithoutFlatteningTransforms() {
        val planner=OriginalBlockShapes();val cases=oracle.getJSONArray("plans");val geometries=oracle.getJSONArray("geometries");var vertices=0
        for(i in 0 until cases.length()) {
            val c=cases.getJSONObject(i);val input=c.getJSONObject("input");val id=if(input.isNull("sourceBlockId"))null else input.getString("sourceBlockId")
            val shape=planner.plan(id,state(input));val refs=c.getJSONArray("meshes");val components=shape.renderComponents()
            assertEquals("shape $i parts",refs.length(),components.size)
            for((index,component)in components.withIndex()) {
                val mesh=BoxSurfaceMesher.create(component.boxes);val attrs=geometries.getJSONObject(refs.getInt(index)).getJSONObject("attributes")
                for((name,values)in mapOf("position" to mesh.positions(),"normal" to mesh.normals(),"uv" to mesh.textureCoordinates())) {
                    val expected=attrs.getJSONObject(name);assertEquals("shape $i/$index $name length",expected.getInt("length"),values.remaining())
                    assertEquals("shape $i/$index $name complete native upload",expected.getString("sha"),sha(values))
                };vertices+=mesh.vertexCount
            }
        }
        assertTrue(vertices>100000)
    }
    @Test fun rawStateOwnershipStrictAndSoftNormalizationAndTwoCellBedPartsRemainDistinct() {
        val planner=OriginalBlockShapes();val raw=linkedMapOf("type" to "bottom");val input=OriginalBlockState.Values(raw);raw["type"]="top"
        val bottom=planner.plan("oak_slab",input);assertEquals(-.5,bottom.bounds.min.y,0.0);assertEquals(0.0,bottom.bounds.max.y,0.0)
        assertNotNull(planner.plan("oak_stairs",OriginalBlockState.Values(mapOf("FACING" to "NORTH","HALF" to "BOTTOM","SHAPE" to "STRAIGHT"))).family)
        assertEquals(OriginalShapeFallback.STATE,planner.plan("lantern",OriginalBlockState.Values(mapOf("HANGING" to "FALSE","WATERLOGGED" to "FALSE"))).reason)
        val head=planner.plan("red_bed",OriginalBlockState.Values(mapOf("facing" to "north","part" to "head","occupied" to "false")))
        val foot=planner.plan("red_bed",OriginalBlockState.Values(mapOf("facing" to "north","part" to "foot","occupied" to "false")))
        assertEquals(3,head.renderComponents().size);assertEquals(2,foot.renderComponents().size)
        assertEquals(1.0,head.bounds.max.z-head.bounds.min.z,0.0);assertEquals(1.0,foot.bounds.max.z-foot.bounds.min.z,0.0)
        assertEquals(-.5,head.bounds.min.z,0.0);assertEquals(.5,foot.bounds.max.z,0.0)
        val transform=head.components!!.first().transform
        assertThrows(ReadOnlyBufferException::class.java){transform.elements().put(0,9.0)}
        assertThrows(UnsupportedOperationException::class.java){(head.boxes as MutableList).clear()}
        assertThrows(UnsupportedOperationException::class.java){(head.components as MutableList).clear()}
        assertEquals(OriginalShapeFallback.STATE,planner.plan("oak_slab",OriginalBlockState.Invalid).reason)
    }
}
