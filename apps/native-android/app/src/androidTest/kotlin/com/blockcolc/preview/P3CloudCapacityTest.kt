package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.cloud.CloudTransport
import com.blockcolc.domain.DomainDocument
import com.blockcolc.domain.StrictJson
import com.blockcolc.storage.CloudWorkspace
import com.blockcolc.storage.NativeStateStore
import com.blockcolc.storage.android.AndroidStateDatabase
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.UUID

/** Dense legal voxels, no padding. Own account and own DB; no actual user backup. */
class P3CloudCapacityTest {
    @Test fun largeBlueprintCrossesTlsThenJoinsAndReopensInTheAndroidStore(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val args=InstrumentationRegistry.getArguments()
        val proxy=if(args.getString("p3CloudTunnel")=="true")Proxy(Proxy.Type.HTTP,InetSocketAddress("127.0.0.1",args.getString("p3CloudTunnelPort")?.toInt()?:18888))else null
        val transport=CloudTransport(context,proxy=proxy)
        val username="p3cap_"+UUID.randomUUID().toString().replace("-","").take(16)
        val login=transport.request("/v1/register","POST",body=JSONObject().put("username",username).put("password",UUID.randomUUID().toString())
            .put("name",username).put("timeZone","UTC").put("deviceId","capacity_device_12345678").put("deviceName","Synthetic capacity").toString())
        val token=login.getString("token");val account=login.getJSONObject("account").getString("id")
        File(context.filesDir,"p3-cloud-capacity-account.json").writeText(JSONObject().put("syntheticUsername",username).put("syntheticAccount",account).toString())
        val database="p2-cloud-capacity-"+UUID.randomUUID()+".db"
        try{
            fun api(path:String,method:String="GET",body:JSONObject?=null)=transport.request("/v1/$path",method,token,body?.toString())
            api("execution/claim","POST",JSONObject().put("generation",0))
            val body=buildString(20*1024*1024){
                append("{\"bounds\":{\"maxX\":59,\"maxY\":59,\"maxZ\":59,\"minX\":0,\"minY\":0,\"minZ\":0},\"id\":\"dense-60\",\"schemaVersion\":1,\"title\":\"Dense 60\",\"voxels\":[")
                repeat(216000){i->if(i>0)append(',');append("{\"buildOrder\":").append(i.coerceAtMost(10000)).append(",\"materialId\":\"stone\",\"stage\":\"foundation\",\"x\":").append(i%60)
                    .append(",\"y\":").append(i/3600).append(",\"z\":").append(i/60%60).append('}')}
                append("]}")
            }
            val key=StrictJson.sha(body);val bytes=StrictJson.utf8Size(body);assertTrue(bytes>16*1024*1024)
            transport.request("/v1/assets/$key","PUT",token,body)
            assertEquals(0,api("assets/status","POST",JSONObject().put("keys",JSONArray().put(key))).getJSONArray("missing").length())
            val base=DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()})
            val entries=CloudWorkspace.split(base).entries.toMutableMap()
            entries["buildingBlueprintResources/dense-60"]=StrictJson.render(JSONObject().put("ordinal",0).put("value",JSONObject().put("id","dense-60").put("displayName","Dense 60")
                .put("blueprint",JSONObject().put("\$asset",key)).put("importedAt","2026-11-15T10:00:00.000Z")))
            val head=api("workspace")
            api("workspace/commit","POST",JSONObject().put("epoch",head.getString("epoch")).put("execution",1).put("requestId",UUID.randomUUID().toString())
                .put("changes",JSONArray(CloudWorkspace.changes(entries,emptyMap()))))
            val remote=api("workspace").getJSONObject("entries");val restored=CloudWorkspace.join(remote.keys().asSequence().associateWith{remote.getString(it)}){sha->
                assertEquals(key,sha);transport.text("/v1/assets/$sha",token=token)}
            assertEquals(key,StrictJson.sha(restored.blueprintCanonical("buildingBlueprintResources","dense-60")!!))
            val digest=restored.sha256
            AndroidStateDatabase(context,database).use{db->assertEquals(digest,NativeStateStore(db).initialize(restored).domain.sha256)}
            AndroidStateDatabase(context,database).use{db->assertEquals(digest,NativeStateStore(db).load()!!.domain.sha256)}
            File(context.filesDir,"p3-cloud-capacity.json").writeText(JSONObject().put("schema",1).put("assetBytes",bytes).put("voxels",216000).put("tlsVerified",true)
                .put("nativeJoined",true).put("sqliteReopened",true).put("heapLimitBytes",Runtime.getRuntime().maxMemory()).toString())
        }finally{
            runCatching{transport.request("/v1/logout","POST",token,"{}")}
            if(context.getDatabasePath(database).exists())assertTrue(context.deleteDatabase(database))
        }
    }
}
