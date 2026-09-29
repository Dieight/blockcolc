package com.blockcolc.app;

/**
 * Durable presentation receipt for an opted-in return-to-focus break reminder.
 * It mirrors an already-authorized absolute deadline; it is not domain timer
 * state and never creates or settles a focus round.
 */
final class BreakReminderProjection {
    enum Stage { PENDING, REMINDER, DISMISSED }

    final long endsAtEpochMs;
    final Stage stage;

    private BreakReminderProjection(long endsAtEpochMs, Stage stage) {
        this.endsAtEpochMs = endsAtEpochMs;
        this.stage = stage;
    }

    static BreakReminderProjection pending(long endsAtEpochMs) {
        return endsAtEpochMs > 0L ? new BreakReminderProjection(endsAtEpochMs, Stage.PENDING) : null;
    }

    static BreakReminderProjection parse(String value) {
        if (value == null) return null;
        String[] parts = value.split("\\|", -1);
        if (parts.length != 2) return null;
        try {
            long endsAt = Long.parseLong(parts[1]);
            Stage stage = "pending".equals(parts[0]) ? Stage.PENDING
                : "reminder".equals(parts[0]) ? Stage.REMINDER
                : "dismissed".equals(parts[0]) ? Stage.DISMISSED : null;
            return endsAt > 0L && stage != null ? new BreakReminderProjection(endsAt, stage) : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    boolean isDue(long nowEpochMs) {
        return stage == Stage.PENDING && endsAtEpochMs <= nowEpochMs;
    }

    BreakReminderProjection asReminder(long nowEpochMs) {
        if (stage == Stage.REMINDER) return this;
        return isDue(nowEpochMs) ? new BreakReminderProjection(endsAtEpochMs, Stage.REMINDER) : null;
    }

    boolean acceptsCountdownDismissal(long requestedEndsAtEpochMs, long nowEpochMs) {
        if (requestedEndsAtEpochMs != endsAtEpochMs || stage != Stage.PENDING) return false;
        // AOSP dispatches deleteIntent on both user clear and TIMEOUT. For a
        // countdown receipt, only an early delivery can be treated as a user
        // dismissal; at/after its absolute deadline it is ambiguous and must
        // preserve the due reminder.
        return nowEpochMs < endsAtEpochMs;
    }

    boolean acceptsReminderDismissal(long requestedEndsAtEpochMs) {
        return requestedEndsAtEpochMs == endsAtEpochMs && stage == Stage.REMINDER;
    }

    static boolean allowsShow(BreakReminderProjection existing, long requestedEndsAtEpochMs) {
        return existing == null || existing.endsAtEpochMs != requestedEndsAtEpochMs
            || existing.stage != Stage.DISMISSED;
    }

    String encode() {
        String encodedStage = stage == Stage.PENDING ? "pending"
            : stage == Stage.REMINDER ? "reminder" : "dismissed";
        return encodedStage + "|" + endsAtEpochMs;
    }

    BreakReminderProjection dismiss() {
        return new BreakReminderProjection(endsAtEpochMs, Stage.DISMISSED);
    }
}
