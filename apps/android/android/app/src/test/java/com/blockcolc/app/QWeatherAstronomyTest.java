package com.blockcolc.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.time.Duration;
import java.time.Instant;

public class QWeatherAstronomyTest {
    private static final long NOW = Instant.parse("2026-01-01T00:00:00Z").toEpochMilli();

    @Test
    public void mapsHalfOpenEpochIntervalsAndEveryProviderMoonPhase() throws Exception {
        String[] phases = {"new-moon", "waxing-crescent", "first-quarter", "waxing-gibbous",
            "full-moon", "waning-gibbous", "last-quarter", "waning-crescent"};
        StringBuilder days = new StringBuilder("[");
        for (int index = 0; index < phases.length; index++) {
            if (index > 0) days.append(',');
            days.append(day(String.format("2026-01-%02dT00:00Z", index + 1),
                String.format("2026-01-%02dT00:00Z", index + 2), phases[index]));
        }
        days.append(']');
        JSObject mapped = QWeatherAstronomy.mapResponse(response(days.toString()), 39.92, 116.41, "fresh", NOW);
        assertNotNull(mapped);
        assertEquals("ok", mapped.getString("status"));
        JSONArray mappedDays = mapped.getJSONArray("days");
        assertEquals(QWeatherAstronomy.MAX_DAYS, mappedDays.length());
        JSONObject first = mappedDays.getJSONObject(0);
        assertEquals(Instant.parse("2026-01-01T00:00:00Z").toEpochMilli(), first.getLong("intervalStartMs"));
        assertEquals(Instant.parse("2026-01-02T00:00:00Z").toEpochMilli(), first.getLong("intervalEndMs"));
        assertEquals("new-moon", first.getJSONObject("lunar").getString("phase"));
        assertEquals("waxing-crescent", mappedDays.getJSONObject(1).getJSONObject("lunar").getString("phase"));
    }

    @Test
    public void mapsAllEightMoonPhaseNames() throws Exception {
        String[] phases = {"new-moon", "waxing-crescent", "first-quarter", "waxing-gibbous",
            "full-moon", "waning-gibbous", "last-quarter", "waning-crescent"};
        for (String phase : phases) {
            JSObject mapped = QWeatherAstronomy.mapResponse(response("[" + day(
                "2026-01-01T00:00Z", "2026-01-02T00:00Z", phase) + "]"), 0, 0, "fresh", NOW);
            assertNotNull(mapped);
            assertEquals(phase, mapped.getJSONArray("days").getJSONObject(0).getJSONObject("lunar").getString("phase"));
        }
    }

    @Test
    public void acceptsDstDayIntervalsOfTwentyThreeAndTwentyFiveHours() throws Exception {
        assertEquals(Duration.ofHours(23).toMillis(), QWeatherAstronomy.parseRfc3339("2026-03-30T00:00+02:00")
            - QWeatherAstronomy.parseRfc3339("2026-03-29T00:00+01:00"));
        assertEquals(Duration.ofHours(25).toMillis(), QWeatherAstronomy.parseRfc3339("2026-10-26T00:00+01:00")
            - QWeatherAstronomy.parseRfc3339("2026-10-25T00:00+02:00"));
        JSObject spring = QWeatherAstronomy.mapResponse(response("[" + day(
            "2026-03-29T00:00+01:00", "2026-03-30T00:00+02:00", "new-moon") + "]"), 0, 0, "cached", NOW);
        JSObject autumn = QWeatherAstronomy.mapResponse(response("[" + day(
            "2026-10-25T00:00+02:00", "2026-10-26T00:00+01:00", "full-moon") + "]"), 0, 0, "cached", NOW);
        assertNotNull(spring);
        assertNotNull(autumn);
        assertEquals(Duration.ofHours(23).toMillis(), intervalLength(spring));
        assertEquals(Duration.ofHours(25).toMillis(), intervalLength(autumn));
    }

    @Test
    public void isolatesBadAstronomyFieldsAndAllowsPolarNullEvents() throws Exception {
        String invalidEvents = "{\"sunrise\":\"2026-01-01T06:00:00\",\"sunset\":\"not-a-date\","
            + "\"moonrise\":\"2026-01-01T10:00:00+00:00\",\"moonPhase\":\"unknown\"}";
        JSObject mapped = QWeatherAstronomy.mapResponse(response("[" + dayWithAstro(
            "2026-01-01T00:00Z", "2026-01-02T00:00Z", invalidEvents) + "]"), 90, 180, "fresh", NOW);
        assertNotNull(mapped);
        JSONObject astro = mapped.getJSONArray("days").getJSONObject(0);
        assertTrue(astro.getJSONObject("solar").get("sunriseMs") == org.json.JSONObject.NULL);
        assertTrue(astro.getJSONObject("solar").get("sunsetMs") == org.json.JSONObject.NULL);
        assertEquals(Instant.parse("2026-01-01T10:00:00Z").toEpochMilli(), astro.getJSONObject("lunar").getLong("moonriseMs"));
        assertTrue(astro.getJSONObject("lunar").get("phase") == org.json.JSONObject.NULL);
    }

    @Test
    public void preservesValidEventsThatFallOutsideTheirForecastInterval() throws Exception {
        String astro = "{\"astronomicalDusk\":\"2024-08-11T22:04Z\","
            + "\"solarMidnight\":\"2024-08-10T23:58Z\",\"moonUnderfoot\":\"2024-08-11T12:19Z\"}";
        JSObject mapped = QWeatherAstronomy.mapResponse(response("[" + dayWithAstro(
            "2024-08-10T22:00Z", "2024-08-11T22:00Z", astro) + "]"), 39.92, 116.41, "fresh", NOW);
        assertNotNull(mapped);
        JSONObject day = mapped.getJSONArray("days").getJSONObject(0);
        assertEquals(Instant.parse("2024-08-11T22:04:00Z").toEpochMilli(),
            day.getJSONObject("solar").getLong("astronomicalDuskMs"));
        assertEquals(Instant.parse("2024-08-10T23:58:00Z").toEpochMilli(),
            day.getJSONObject("solar").getLong("solarMidnightMs"));
        assertEquals(Instant.parse("2024-08-11T12:19:00Z").toEpochMilli(),
            day.getJSONObject("lunar").getLong("moonUnderfootMs"));
    }

    @Test
    public void rejectsMissingOffsetAndInvalidDayBoundsWithoutLeakingBody() {
        assertNull(QWeatherAstronomy.parseRfc3339("2026-01-01T10:00:00"));
        assertNull(QWeatherAstronomy.parseRfc3339("2026-02-30T10:00:00Z"));
        assertNull(QWeatherAstronomy.mapResponse(response("[" + day("2026-01-02T00:00Z", "2026-01-01T00:00Z", "full-moon") + "]"),
            0, 0, "fresh", NOW));
        assertNull(QWeatherAstronomy.mapResponse("sensitive provider response", 0, 0, "fresh", NOW));
    }

    @Test
    public void cacheRequiresTtlAndAtLeastFortyEightHoursOfCoverageAndCanBeCleared() throws Exception {
        QWeatherAstronomy.Cache cache = new QWeatherAstronomy.Cache();
        String twoDays = "[" + day("2026-01-01T00:00Z", "2026-01-02T00:00Z", "full-moon") + ","
            + day("2026-01-02T00:00Z", "2026-01-03T00:00Z", "waning-gibbous") + ","
            + day("2026-01-03T00:00Z", "2026-01-04T00:00Z", "last-quarter") + "]";
        JSObject schedule = QWeatherAstronomy.mapResponse(response(twoDays), 39.9201, 116.4101, "fresh", NOW);
        assertNotNull(schedule);
        cache.put(schedule);
        assertNotNull(cache.get(39.92, 116.41, NOW + Duration.ofHours(1).toMillis()));
        assertNull(cache.get(39.92, 116.41, NOW + Duration.ofHours(12).toMillis()));
        assertNull(cache.get(40.1, 116.41, NOW + Duration.ofHours(1).toMillis()));
        cache.clear();
        assertNull(cache.get(39.92, 116.41, NOW + Duration.ofHours(1).toMillis()));
    }

    @Test
    public void cacheRequiresCurrentContiguousHalfOpenCoverageInsteadOfTheFurthestEnd() throws Exception {
        QWeatherAstronomy.Cache cache = new QWeatherAstronomy.Cache();
        String continuous = "[" + day("2026-01-01T00:00Z", "2026-01-02T00:00Z", "full-moon") + ","
            + day("2026-01-02T00:00Z", "2026-01-03T00:00Z", "waning-gibbous") + ","
            + day("2026-01-03T00:00Z", "2026-01-04T00:00Z", "last-quarter") + "]";
        JSObject continuousSchedule = QWeatherAstronomy.mapResponse(response(continuous), 39.92, 116.41, "fresh", NOW);
        assertNotNull(continuousSchedule);
        assertTrue(QWeatherAstronomy.Cache.hasContinuousCoverage(continuousSchedule, NOW));
        cache.put(continuousSchedule);
        assertNotNull(cache.get(39.92, 116.41, NOW));

        long boundary = NOW + Duration.ofDays(1).toMillis();
        assertTrue(QWeatherAstronomy.Cache.hasContinuousCoverage(continuousSchedule, boundary));
        JSObject boundarySchedule = QWeatherAstronomy.mapResponse(response(continuous), 39.92, 116.41, "fresh", boundary);
        QWeatherAstronomy.Cache boundaryCache = new QWeatherAstronomy.Cache();
        boundaryCache.put(boundarySchedule);
        assertNotNull(boundaryCache.get(39.92, 116.41, boundary));

        String gap = "[" + day("2026-01-01T00:00Z", "2026-01-02T00:00Z", "full-moon") + ","
            + day("2026-01-02T01:00Z", "2026-01-04T00:00Z", "last-quarter") + "]";
        JSObject gapSchedule = QWeatherAstronomy.mapResponse(response(gap), 39.92, 116.41, "fresh", NOW);
        assertNotNull(gapSchedule);
        assertTrue(!QWeatherAstronomy.Cache.hasContinuousCoverage(gapSchedule, NOW));
        cache.put(gapSchedule);
        assertNull(cache.get(39.92, 116.41, NOW));

        String futureOnly = "[" + day("2026-01-02T00:00Z", "2026-01-03T00:00Z", "full-moon") + ","
            + day("2026-01-03T00:00Z", "2026-01-04T00:00Z", "waning-gibbous") + ","
            + day("2026-01-04T00:00Z", "2026-01-05T00:00Z", "last-quarter") + "]";
        JSObject futureSchedule = QWeatherAstronomy.mapResponse(response(futureOnly), 39.92, 116.41, "fresh", NOW);
        assertNotNull(futureSchedule);
        assertTrue(!QWeatherAstronomy.Cache.hasContinuousCoverage(futureSchedule, NOW));

        String shortCoverage = "[" + day("2026-01-01T00:00Z", "2026-01-02T00:00Z", "full-moon") + "]";
        JSObject shortSchedule = QWeatherAstronomy.mapResponse(response(shortCoverage), 39.92, 116.41, "fresh", NOW);
        assertNotNull(shortSchedule);
        assertTrue(!QWeatherAstronomy.Cache.hasContinuousCoverage(shortSchedule, NOW));
        cache.put(shortSchedule);
        assertNull(cache.get(39.92, 116.41, NOW + Duration.ofHours(1).toMillis()));
    }

    private static long intervalLength(JSObject value) throws Exception {
        JSONObject day = value.getJSONArray("days").getJSONObject(0);
        return day.getLong("intervalEndMs") - day.getLong("intervalStartMs");
    }

    private static String response(String days) {
        return "{\"metadata\":{\"attributions\":[\"QWeather attribution\"]},\"days\":" + days + "}";
    }

    private static String day(String start, String end, String phase) {
        return dayWithAstro(start, end, "{\"sunrise\":\"2026-01-01T06:00:00Z\",\"sunset\":\"2026-01-01T18:00:00Z\","
            + "\"moonrise\":\"2026-01-01T20:00:00+00:00\",\"moonPhase\":\"" + phase + "\"}");
    }

    private static String dayWithAstro(String start, String end, String astro) {
        return "{\"forecastStartTime\":\"" + start + "\",\"forecastEndTime\":\"" + end + "\",\"astro\":" + astro + "}";
    }
}
