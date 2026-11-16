package com.blockcolc.world

import com.blockcolc.world.generation.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.ReadOnlyBufferException
import java.security.MessageDigest

class OriginalMaterialStylesTest {
    companion object {private val oracle by lazy{JSONObject(OriginalMaterialStylesTest::class.java.getResource("/original-material-oracle.json")!!.readText())}}
    private fun rows(a:JSONArray)=List(a.length()){a.getJSONObject(it)}
    private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
    private fun style(e:JSONObject,a:OriginalVisualStyle,label:String) {
        assertEquals("$label key",e.getString("key"),a.key);assertEquals(label,e.getInt("color"),a.color)
        assertEquals(label,e.getString("response"),a.response.wireValue);assertEquals(label,e.getString("pattern"),a.pattern.wireValue)
        assertEquals(label,e.getBoolean("transparent"),a.transparent);assertEquals(label,e.getDouble("opacity"),a.opacity,0.0)
    }
    private fun voxel(v:JSONObject):RenderVoxel {
        val state=v.optJSONObject("sourceBlockState")?.let{raw->raw.keys().asSequence().associateWith{raw.getString(it)}}
        return RenderVoxel(0.0,0.0,0.0,v.getString("materialId"),0,if(v.isNull("sourceBlockId"))null else v.getString("sourceBlockId"),state)
    }
    @Test fun sourceFingerprintsAndEachOriginalRgbaTileKeepPixelSamplerAndResponseContracts() {
        val root=generateSequence(File(System.getProperty("user.dir"))){it.parentFile}.first{File(it,"packages/voxel/src/original-materials.ts").isFile}
        val hashes=oracle.getJSONObject("sourceHashes")
        for(name in hashes.keys())assertEquals("Stale original material oracle: $name",hashes.getString(name),sha(File(root,name).readBytes()))
        val library=OriginalMaterialLibrary.bundled;val patterns=rows(oracle.getJSONArray("patterns"));assertEquals(24,patterns.size)
        for(p in patterns) {
            val pattern=OriginalPattern.entries.first{it.wireValue==p.getString("pattern")};val descriptor=library.descriptor(pattern);val texture=library.texture(pattern)
            assertSame(descriptor,texture.descriptor);assertEquals(p.getString("sha256"),descriptor.sha256)
            assertEquals(16,descriptor.width);assertEquals(16,descriptor.height);assertEquals("srgb",descriptor.colorSpace)
            assertEquals(p.getInt("wrapS"),descriptor.wrapS);assertEquals(p.getInt("wrapT"),descriptor.wrapT)
            assertEquals(p.getInt("minFilter"),descriptor.minFilter);assertEquals(p.getInt("magFilter"),descriptor.magFilter)
            assertEquals(p.getDouble("anisotropy"),descriptor.anisotropy,0.0);assertTrue(descriptor.generateMipmaps);assertFalse(descriptor.flipY)
            val b=texture.pixels();val data=ByteArray(b.remaining());b.get(data);assertEquals(1024,data.size);assertEquals(descriptor.sha256,sha(data))
            assertThrows(ReadOnlyBufferException::class.java){texture.pixels().put(0,0)};assertFalse(texture.pixels().hasArray())
        }
        assertEquals(MaterialResponse(.16,0.0),library.response(OriginalResponse.GLASS));assertEquals(MaterialResponse(.5,.32),library.response(OriginalResponse.METAL))
        assertThrows(UnsupportedOperationException::class.java){(library.colors("DYE_COLORS") as MutableList).clear()}
    }
    @Test fun blockSemanticFallbacksDyesNamespacesAndOpaqueIceMatchCurrentFormalMaterials() {
        val resolver=OriginalMaterialStyles();val cases=rows(oracle.getJSONArray("cases"));assertTrue(cases.size>8000)
        for(c in cases) {
            val v=voxel(c.getJSONObject("voxel"));val label="${v.sourceBlockId} ${v.materialId}"
            val actual=resolver.voxel(v);style(c.getJSONObject("style"),actual,label)
            assertEquals(label,c.getString("pattern"),resolver.pattern(v.sourceBlockId,v.materialId).wireValue)
            assertEquals(label,c.getString("response"),resolver.response(v.sourceBlockId,v.materialId).wireValue)
            assertEquals(label,if(c.isNull("fluid"))null else c.getString("fluid"),resolver.fluid(v.sourceBlockId)?.name?.lowercase())
            style(c.getJSONObject("style"),resolver.parseLegacyKey(actual.key)!!,"$label legacy identity")
        }
    }
    @Test fun multipieceMaterialsFluidLevelsAndCompatibilityIdentitiesKeepTheirDistinctRoles() {
        val resolver=OriginalMaterialStyles();val cases=rows(oracle.getJSONArray("components"));assertTrue(cases.size>1000)
        for(c in cases)style(c.getJSONObject("style"),resolver.component(voxel(c.getJSONObject("voxel")),c.getString("key")),c.getString("key"))
        for(c in rows(oracle.getJSONArray("materialDefaults"))) {
            val material=c.getString("material");assertEquals(c.getString("pattern"),resolver.patternForMaterial(material).wireValue)
            assertEquals(c.getString("response"),resolver.responseForMaterial(material).wireValue)
            assertEquals(if(c.isNull("block"))null else c.getString("block"),resolver.builtinBlock(material))
        }
        for(c in rows(oracle.getJSONArray("fluids")))assertEquals(c.toString(),c.getDouble("height"),resolver.fluidHeight(if(c.isNull("level"))null else mapOf("level" to c.getString("level"))),0.0)
        for(c in rows(oracle.getJSONArray("invalidKeys"))){assertTrue(c.isNull("result"));assertNull(resolver.parseLegacyKey(c.getString("key")))}
    }
    @Test fun damagedBundledTexturesMetadataAndCallerBuffersCannotAlterAnAdoptedTile() {
        val metadata=javaClass.getResourceAsStream("/native-original-materials/materials.json")!!.use{it.readBytes()}
        val library=OriginalMaterialLibrary.bundled;val descriptor=library.descriptor(OriginalPattern.STONE)
        val b=library.texture(OriginalPattern.STONE).pixels();val raw=ByteArray(b.remaining());b.get(raw)
        val reader=OriginalMaterialLibrary.read(metadata){path->assertEquals("native-original-materials/${descriptor.sha256}.rgba",path);ByteArrayInputStream(raw)}
        val adopted=reader.texture(OriginalPattern.STONE);val digest=sha(raw);raw.fill(0)
        val copy=ByteArray(adopted.pixels().remaining());adopted.pixels().get(copy);assertEquals(digest,sha(copy))
        assertThrows(IllegalArgumentException::class.java){reader.texture(OriginalPattern.STONE)}
        assertThrows(IllegalArgumentException::class.java){OriginalMaterialLibrary.read(metadata){ByteArrayInputStream(ByteArray(1025))}.texture(OriginalPattern.STONE)}
        val changes=listOf<(JSONObject)->Unit>(
            {it.getJSONArray("entries").getJSONObject(0).put("sha256","../other")},
            {it.getJSONArray("entries").getJSONObject(0).put("width",16.5)},
            {it.getJSONObject("tables").getJSONArray("DYE_COLORS").getJSONObject(0).put("color",1.5)},
            {it.getJSONArray("entries").getJSONObject(0).put("generateMipmaps","true")},
            {it.getJSONArray("responses").getJSONObject(0).put("roughness",-1)})
        for(change in changes){val root=JSONObject(metadata.toString(Charsets.UTF_8));change(root);assertThrows(IllegalArgumentException::class.java){OriginalMaterialLibrary.read(root.toString().toByteArray()){ByteArrayInputStream(raw)}}}
    }
}
