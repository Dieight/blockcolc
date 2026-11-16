package com.blockcolc.focus
import org.junit.Assert.*
import org.junit.Test
class SystemNavigationTest {
    @Test fun leaseIsConsumedByActualStopNotOldSession(){
        var now=10L;val host=SystemNavigation({now},100)
        host.begin();now=20 // coordinator may complete and create another session here
        assertEquals("system-exempt",host.backgroundReason(false))
        assertEquals("app-switch",host.backgroundReason(false))
        host.begin();host.cancel();assertEquals("app-switch",host.backgroundReason(false))
        host.begin();now=120;assertEquals("app-switch",host.backgroundReason(false))
        host.begin();assertEquals("screen-lock",host.backgroundReason(true))
        assertEquals("app-switch",host.backgroundReason(false))
    }
}
