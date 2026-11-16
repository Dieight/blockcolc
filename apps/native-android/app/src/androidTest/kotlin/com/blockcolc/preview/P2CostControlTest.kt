package com.blockcolc.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.*
import com.blockcolc.storage.*
import org.junit.Test
import java.util.concurrent.TimeUnit

/** Setup is outside the cost window, leaving the original DB pointer recoverable. */
class P2CostControlTest {
    @Test fun prepare(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext;val runtime=PreviewRuntime.get(context)
        runtime.testDatabase(true).get(30,TimeUnit.SECONDS)
        val initial=DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()})
        runtime.testOperation{c->c.importBackup("fixture",BackupCodec.read(BackupCodec.write(initial,DomainTime.format(System.currentTimeMillis()))),System.currentTimeMillis())}.get(30,TimeUnit.SECONDS)
        runtime.testRecording(true).get(30,TimeUnit.SECONDS)
    }
}
