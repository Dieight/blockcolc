package com.blockcolc.preview

import android.app.Notification
import android.app.NotificationManager
import android.provider.Settings
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.DomainTime
import com.blockcolc.focus.DeadlineTicket
import com.blockcolc.presentation.ClientPreferences
import org.junit.Assert.*
import org.junit.Test

/** Construction/capability contracts only. No post, setting change, user DB or alarm mutation. */
class P3NotificationContractTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private val platform=FocusPlatform(context)
    private fun ticket()=DeadlineTicket("test",1,"p","s","FOCUS",DomainTime.format(System.currentTimeMillis()+60000))
    @Test fun absoluteCountdownExpiresAndCarriesSavedTicket(){
        val t=ticket();val n=platform.notification(PreviewSnapshot(phase="FOCUS",rounds=3,planId="p",generation=1),t)
        assertEquals(DomainTime.millis(t.end),n.`when`)
        assertTrue(n.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
        if(android.os.Build.VERSION.SDK_INT>=26)assertTrue(n.timeoutAfter in 1..60000)
        assertEquals(t.json().toString(),n.extras.getString("blockcolc.focus.ticket"))
        assertEquals(Notification.CATEGORY_STOPWATCH,n.category)
        assertEquals("blockcolc-focus-audio",n.group)
    }
    @Test fun expiredCountdownAndReminderNeverCountBelowZero(){
        val t=ticket().copy(end=DomainTime.format(System.currentTimeMillis()-1000))
        assertFalse(platform.notification(PreviewSnapshot(),t).extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
        val reminder=platform.notification(PreviewSnapshot(phase="READY",preferences=ClientPreferences(language="en")),null)
        assertFalse(reminder.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
        assertEquals("Ready for the next round",reminder.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertFalse(reminder.extras.containsKey("notification.superx.scene"))
    }
    @Test fun promotionAndOriginOsAreCapabilityGated(){
        val n=platform.notification(PreviewSnapshot(phase="FOCUS"),ticket())
        assertEquals(platform.promotedAllowed(),n.extras.getBoolean("android.requestPromotedOngoing"))
        if(!OriginOsTimerSurface.allowed(context))assertFalse(n.extras.containsKey("notification.superx.scene"))
        assertTrue(OriginOsTimerSurface.ownsTag("VIVO_SUPERX_TAG","ours"))
        assertFalse(OriginOsTimerSurface.ownsTag("unrelated","ours"))
    }
    @Test fun powerEntryTargetsThisAppAndDoesNotRequestBatteryWhitelist(){
        val power=platform.settingsIntent("battery")
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,power.action)
        assertEquals("package:${context.packageName}",power.data.toString())
    }
}
