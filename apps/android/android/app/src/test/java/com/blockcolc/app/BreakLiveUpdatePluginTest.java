package com.blockcolc.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class BreakLiveUpdatePluginTest {
    @Test
    public void sameUpdateKeySuppressesOnlyTheExactActiveTimer() {
        assertTrue(BreakLiveUpdatePlugin.sameUpdateKey("focus\u0000session", "focus\u0000session"));
        assertFalse(BreakLiveUpdatePlugin.sameUpdateKey("focus\u0000session", "break\u0000session"));
        assertFalse(BreakLiveUpdatePlugin.sameUpdateKey(null, "focus"));
        assertFalse(BreakLiveUpdatePlugin.sameUpdateKey("", ""));
    }

    @Test
    public void kindSpecificCleanupCannotCancelTheOtherTimerState() {
        assertTrue(BreakLiveUpdatePlugin.sameKind("focus", "focus"));
        assertTrue(BreakLiveUpdatePlugin.sameKind("break", "break"));
        assertFalse(BreakLiveUpdatePlugin.sameKind("focus", "break"));
        assertFalse(BreakLiveUpdatePlugin.sameKind("break", "focus"));
        // Pre-upgrade notifications had no kind and were always break updates.
        assertTrue(BreakLiveUpdatePlugin.sameKind(null, "break"));
        assertFalse(BreakLiveUpdatePlugin.sameKind(null, "focus"));
    }

    @Test
    public void timerTagIsStableForOneTimerAndChangesForTheNext() {
        assertTrue(BreakLiveUpdatePlugin.timerTag("focus\u0000session-a")
            .equals(BreakLiveUpdatePlugin.timerTag("focus\u0000session-a")));
        assertFalse(BreakLiveUpdatePlugin.timerTag("focus\u0000session-a")
            .equals(BreakLiveUpdatePlugin.timerTag("break\u0000session-a")));
        assertFalse(BreakLiveUpdatePlugin.timerTag("focus\u0000session-a")
            .equals(BreakLiveUpdatePlugin.timerTag("focus\u0000session-b")));
    }

    @Test
    public void everyBreakOwnsOneCleanupDeadlineAndFocusDoesNot() {
        assertTrue(BreakLiveUpdatePlugin.shouldScheduleDeadline("break", true));
        assertTrue(BreakLiveUpdatePlugin.shouldScheduleDeadline("break", false));
        assertFalse(BreakLiveUpdatePlugin.shouldScheduleDeadline("focus", true));
    }

    @Test
    public void deadlineRequestIdentityIsStableAndReachabilityIsAbsolute() {
        assertTrue(BreakLiveUpdatePlugin.deadlineRequestCode("break\u0000session-a")
            == BreakLiveUpdatePlugin.deadlineRequestCode("break\u0000session-a"));
        assertFalse(BreakLiveUpdatePlugin.deadlineRequestCode("break\u0000session-a")
            == BreakLiveUpdatePlugin.deadlineRequestCode("break\u0000session-b"));
        assertTrue(BreakLiveUpdatePlugin.deadlineReached(1000L, 1000L));
        assertFalse(BreakLiveUpdatePlugin.deadlineReached(1000L, 999L));
    }

    @Test
    public void automaticContinuationEventsRequireStableOpaqueIdentityAndAbsoluteTime() {
        assertTrue(BreakLiveUpdatePlugin.validAutomaticContinuationEvent(
            "authorization-a:round:3", "authorization-a", 1000L
        ));
        assertFalse(BreakLiveUpdatePlugin.validAutomaticContinuationEvent(
            "authorization-a/round/3", "authorization-a", 1000L
        ));
        assertFalse(BreakLiveUpdatePlugin.validAutomaticContinuationEvent(
            "authorization-a:round:3", "", 1000L
        ));
        assertFalse(BreakLiveUpdatePlugin.validAutomaticContinuationEvent(
            "authorization-a:round:3", "authorization-a", 0L
        ));
    }

    @Test
    public void automaticContinuationAlarmIdentityIsRepeatable() {
        assertTrue(BreakLiveUpdatePlugin.automaticContinuationRequestCode("authorization-a:round:3")
            == BreakLiveUpdatePlugin.automaticContinuationRequestCode("authorization-a:round:3"));
        assertFalse(BreakLiveUpdatePlugin.automaticContinuationRequestCode("authorization-a:round:3")
            == BreakLiveUpdatePlugin.automaticContinuationRequestCode("authorization-a:round:4"));
    }

    @Test
    public void deniedExactAlarmFallsBackToInexactScheduling() {
        assertTrue(BreakLiveUpdatePlugin.shouldUseInexactAutomaticAlarm(false, false));
        assertTrue(BreakLiveUpdatePlugin.shouldUseInexactAutomaticAlarm(true, true));
        assertFalse(BreakLiveUpdatePlugin.shouldUseInexactAutomaticAlarm(true, false));
    }

    @Test
    public void acknowledgedOrRevokedAutomaticEventCannotBeRequeuedOrPublished() {
        assertTrue(BreakLiveUpdatePlugin.shouldQueueAutomaticEvent(false, false));
        assertFalse(BreakLiveUpdatePlugin.shouldQueueAutomaticEvent(false, true));
        assertFalse(BreakLiveUpdatePlugin.shouldQueueAutomaticEvent(true, false));
        assertTrue(BreakLiveUpdatePlugin.shouldPublishAutomaticEvent(false, false, true));
        assertFalse(BreakLiveUpdatePlugin.shouldPublishAutomaticEvent(false, true, true));
        assertFalse(BreakLiveUpdatePlugin.shouldPublishAutomaticEvent(true, false, true));
        assertFalse(BreakLiveUpdatePlugin.shouldPublishAutomaticEvent(false, false, false));
        assertTrue(BreakLiveUpdatePlugin.shouldExposeAutomaticEvent(false, false, true));
        assertFalse(BreakLiveUpdatePlugin.shouldExposeAutomaticEvent(false, true, true));
        assertFalse(BreakLiveUpdatePlugin.shouldExposeAutomaticEvent(true, false, true));
        assertFalse(BreakLiveUpdatePlugin.shouldExposeAutomaticEvent(false, false, false));
    }

    @Test
    public void breakReminderReceiptIsAbsoluteDurablePresentationAndDismissalIsTerminal() {
        BreakReminderProjection pending = BreakReminderProjection.pending(5_000L);
        assertFalse(pending.isDue(4_999L));
        assertTrue(pending.isDue(5_000L));
        assertTrue(pending.isDue(60_000L));
        BreakReminderProjection restored = BreakReminderProjection.parse(pending.encode());
        assertEquals(5_000L, restored.endsAtEpochMs);
        assertTrue(restored.isDue(60_000L));
        assertTrue(restored.acceptsCountdownDismissal(5_000L, 4_999L));
        assertFalse(restored.acceptsCountdownDismissal(5_000L, 5_000L));
        assertFalse(restored.acceptsCountdownDismissal(5_000L, 60_000L));
        assertFalse(restored.acceptsCountdownDismissal(5_001L, 4_999L));
        assertNull(restored.asReminder(4_999L));
        BreakReminderProjection reminder = restored.asReminder(5_000L);
        assertEquals(BreakReminderProjection.Stage.REMINDER, BreakReminderProjection.parse(reminder.encode()).stage);
        assertTrue(reminder.acceptsReminderDismissal(5_000L));
        assertFalse(reminder.acceptsReminderDismissal(5_001L));
        assertFalse(reminder.acceptsCountdownDismissal(5_000L, 60_000L));
        assertEquals(BreakLiveUpdatePlugin.ACTION_BREAK_COUNTDOWN_DISMISSED,
            BreakLiveUpdatePlugin.dismissalActionForStage(BreakReminderProjection.Stage.PENDING));
        assertEquals(BreakLiveUpdatePlugin.ACTION_BREAK_REMINDER_DISMISSED,
            BreakLiveUpdatePlugin.dismissalActionForStage(BreakReminderProjection.Stage.REMINDER));
        assertFalse(BreakLiveUpdatePlugin.dismissalRequestCode("break-key", BreakReminderProjection.Stage.PENDING)
            == BreakLiveUpdatePlugin.dismissalRequestCode("break-key", BreakReminderProjection.Stage.REMINDER));
        assertFalse(BreakLiveUpdatePlugin.dismissalDataForStage("break-key", BreakReminderProjection.Stage.PENDING)
            .equals(BreakLiveUpdatePlugin.dismissalDataForStage("break-key", BreakReminderProjection.Stage.REMINDER)));
        assertTrue(BreakReminderProjection.allowsShow(reminder, 5_000L));
        BreakReminderProjection dismissed = reminder.dismiss();
        assertEquals(BreakReminderProjection.Stage.DISMISSED, BreakReminderProjection.parse(dismissed.encode()).stage);
        assertFalse(dismissed.isDue(60_000L));
        assertFalse(BreakReminderProjection.allowsShow(dismissed, 5_000L));
        BreakReminderProjection canceledAgain = BreakReminderProjection.parse(dismissed.dismiss().encode());
        assertEquals(BreakReminderProjection.Stage.DISMISSED, canceledAgain.stage);
        assertFalse(BreakReminderProjection.allowsShow(canceledAgain, 5_000L));
        assertTrue(BreakReminderProjection.allowsShow(dismissed, 6_000L));
        assertTrue(BreakReminderProjection.allowsShow(restored, 5_000L));
        assertTrue(BreakReminderProjection.allowsShow(null, 5_000L));
        assertNull(BreakReminderProjection.parse("pending|not-a-time"));
    }

    @Test
    public void absoluteTimelineProjectsMultipleOfflineFocusAndBreakStages() {
        AutomaticContinuationTimeline timeline = AutomaticContinuationTimeline.of(Arrays.asList(
            new AutomaticContinuationTimeline.Phase("focus", 2_000L, 4_000L, 2, "auth:round:2"),
            new AutomaticContinuationTimeline.Phase("break", 4_000L, 5_000L, 2, ""),
            new AutomaticContinuationTimeline.Phase("focus", 5_000L, 7_000L, 3, "auth:round:3"),
            new AutomaticContinuationTimeline.Phase("break", 7_000L, 8_000L, 3, ""),
            new AutomaticContinuationTimeline.Phase("focus", 8_000L, 10_000L, 4, "auth:round:4")
        ));

        assertEquals("break", timeline.phaseAt(4_500L).kind);
        assertEquals(5_000L, timeline.nextBoundaryAfter(4_500L));
        assertEquals("focus", timeline.phaseAt(8_500L).kind);
        assertEquals(4, timeline.phaseAt(8_500L).round);
        assertEquals("auth:round:2", timeline.dueFocusPhases(8_500L).get(0).eventId);
        assertEquals("auth:round:4", timeline.dueFocusPhases(8_500L).get(2).eventId);
        assertEquals(3, timeline.dueFocusPhases(8_500L).size());
        assertEquals(2_000L, timeline.nextBoundaryAfter(1_500L));
        assertNull(timeline.phaseAt(10_000L));
        assertEquals(0L, timeline.nextBoundaryAfter(10_000L));
    }

    @Test
    public void absoluteTimelineRejectsOverlapAndUnboundedProjection() {
        assertNull(AutomaticContinuationTimeline.of(Arrays.asList(
            new AutomaticContinuationTimeline.Phase("focus", 2_000L, 5_000L, 2, "auth:round:2"),
            new AutomaticContinuationTimeline.Phase("break", 4_000L, 6_000L, 2, "")
        )));
        AutomaticContinuationTimeline.Phase[] oversized = new AutomaticContinuationTimeline.Phase[
            AutomaticContinuationTimeline.MAX_PHASES + 1
        ];
        Arrays.fill(oversized, new AutomaticContinuationTimeline.Phase("focus", 2_000L, 5_000L, 2, ""));
        assertNull(AutomaticContinuationTimeline.of(Arrays.asList(oversized)));
        assertNull(AutomaticContinuationTimeline.of(Collections.emptyList()));
    }
}
