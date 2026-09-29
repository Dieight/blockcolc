package com.blockcolc.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Pure bounded timeline math shared by the native scheduler and JVM tests. */
final class AutomaticContinuationTimeline {
    static final int MAX_PHASES = 128;

    static final class Phase {
        final String kind;
        final long startsAtEpochMs;
        final long endsAtEpochMs;
        final int round;
        final String eventId;

        Phase(String kind, long startsAtEpochMs, long endsAtEpochMs, int round, String eventId) {
            this.kind = kind;
            this.startsAtEpochMs = startsAtEpochMs;
            this.endsAtEpochMs = endsAtEpochMs;
            this.round = round;
            this.eventId = eventId == null ? "" : eventId;
        }
    }

    private final List<Phase> phases;

    private AutomaticContinuationTimeline(List<Phase> phases) {
        this.phases = Collections.unmodifiableList(phases);
    }

    static AutomaticContinuationTimeline of(List<Phase> input) {
        if (input == null || input.isEmpty() || input.size() > MAX_PHASES) return null;
        List<Phase> copy = new ArrayList<>(input.size());
        long previousStart = 0L;
        long previousEnd = 0L;
        int previousRound = 0;
        for (Phase phase : input) {
            if (phase == null || !("focus".equals(phase.kind) || "break".equals(phase.kind))
                || phase.startsAtEpochMs <= 0L || phase.endsAtEpochMs <= phase.startsAtEpochMs
                || phase.round < 1 || phase.startsAtEpochMs < previousStart
                || phase.startsAtEpochMs < previousEnd || phase.round < previousRound) return null;
            if ("focus".equals(phase.kind) && !phase.eventId.isEmpty()
                && (phase.eventId.length() > 180 || !phase.eventId.matches("[A-Za-z0-9:_-]+"))) return null;
            copy.add(phase);
            previousStart = phase.startsAtEpochMs;
            previousEnd = phase.endsAtEpochMs;
            previousRound = phase.round;
        }
        return new AutomaticContinuationTimeline(copy);
    }

    Phase phaseAt(long epochMs) {
        for (Phase phase : phases) {
            if (phase.startsAtEpochMs <= epochMs && epochMs < phase.endsAtEpochMs) return phase;
        }
        return null;
    }

    long nextBoundaryAfter(long epochMs) {
        for (Phase phase : phases) {
            if (phase.startsAtEpochMs > epochMs) return phase.startsAtEpochMs;
            if (phase.endsAtEpochMs > epochMs) return phase.endsAtEpochMs;
        }
        return 0L;
    }

    List<Phase> dueFocusPhases(long epochMs) {
        List<Phase> due = new ArrayList<>();
        for (Phase phase : phases) {
            if ("focus".equals(phase.kind) && !phase.eventId.isEmpty() && phase.startsAtEpochMs <= epochMs) due.add(phase);
        }
        return due;
    }

    List<Phase> phases() { return phases; }
}
