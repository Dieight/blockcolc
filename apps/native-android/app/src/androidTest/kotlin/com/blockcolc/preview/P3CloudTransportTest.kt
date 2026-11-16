package com.blockcolc.preview

import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.cloud.CloudFailure
import com.blockcolc.cloud.CloudTransport
import org.junit.Assert.*
import org.junit.Test
import java.net.InetSocketAddress
import java.net.Proxy

/** The host-only slow TLS fixture keeps sending bytes. A per-read timeout
 * would never fire, but the whole operation must still finish and release IO. */
class P3CloudTransportTest {
    @Test fun aContinuousSlowResponseCannotKeepTheCloudLaneBusyForever(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val port=InstrumentationRegistry.getArguments().getString("p3CloudTunnelPort")!!.toInt()
        val proxy=Proxy(Proxy.Type.HTTP,InetSocketAddress("127.0.0.1",port))
        assertTrue(CloudTransport(context,proxy=proxy).request("/healthz").getBoolean("ok"))
        val start=SystemClock.elapsedRealtime()
        val error=runCatching{CloudTransport(context,proxy=proxy,totalTimeoutMillis=1000).request("/v1/slow")}.exceptionOrNull()
        assertEquals("REQUEST_TIMEOUT",(error as? CloudFailure)?.code)
        assertTrue("Whole-operation deadline did not release IO",SystemClock.elapsedRealtime()-start<8000)
        assertTrue(CloudTransport(context,proxy=proxy).request("/healthz").getBoolean("ok"))
    }
}
