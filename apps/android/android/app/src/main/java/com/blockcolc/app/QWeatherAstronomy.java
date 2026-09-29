package com.blockcolc.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.GregorianCalendar;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.Date;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Bounded QWeather event-calendar decoder and in-memory cache. */
final class QWeatherAstronomy {
    static final int MAX_DAYS = 7;
    static final long CACHE_TTL_MS = 12L * 60L * 60L * 1000L;
    static final long MIN_COVERAGE_MS = 48L * 60L * 60L * 1000L;
    private static final int MAX_ATTRIBUTIONS = 10;
    private static final int MAX_ATTRIBUTION_LENGTH = 2_048;
    private static final Pattern RFC3339_OFFSET = Pattern.compile(
        "^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,9}))?)?(Z|([+-])(\\d{2}):(\\d{2}))$"
    );
    private static final String[] SOLAR_EVENTS = {
        "astronomicalDawn", "nauticalDawn", "civilDawn", "sunrise", "solarNoon", "sunset",
        "civilDusk", "nauticalDusk", "astronomicalDusk", "solarMidnight"
    };
    private static final String[] LUNAR_EVENTS = {"moonrise", "moonset", "moonTransit", "moonUnderfoot"};
    private static final String[] MOON_PHASES = {
        "new-moon", "waxing-crescent", "first-quarter", "waxing-gibbous",
        "full-moon", "waning-gibbous", "last-quarter", "waning-crescent"
    };

    private QWeatherAstronomy() {}

    /** Returns null only when the response cannot provide any usable dated interval. */
    static JSObject mapResponse(String body, double latitude, double longitude, String locationSource, long fetchedAtMs) {
        if (!isUsableCoordinates(latitude, longitude)
            || !("fresh".equals(locationSource) || "cached".equals(locationSource))
            || fetchedAtMs < 0) return null;
        try {
            JSONObject response = new JSONObject(body);
            JSONObject metadata = response.optJSONObject("metadata");
            JSONArray providerAttributions = metadata == null ? null : metadata.optJSONArray("attributions");
            JSONArray providerDays = response.optJSONArray("days");
            if (providerAttributions == null || providerDays == null) return null;

            JSArray attributions = new JSArray();
            for (int index = 0; index < providerAttributions.length() && index < MAX_ATTRIBUTIONS; index++) {
                Object item = providerAttributions.opt(index);
                if (!(item instanceof String)) continue;
                String attribution = ((String) item).trim();
                if (!attribution.isEmpty() && attribution.length() <= MAX_ATTRIBUTION_LENGTH) attributions.put(attribution);
            }
            if (attributions.length() == 0) return null;

            List<DatedDay> parsed = new ArrayList<>();
            for (int index = 0; index < providerDays.length() && parsed.size() < MAX_DAYS; index++) {
                JSONObject providerDay = providerDays.optJSONObject(index);
                if (providerDay == null) continue;
                Long start = parseRfc3339(providerDay.optString("forecastStartTime", null));
                Long end = parseRfc3339(providerDay.optString("forecastEndTime", null));
                if (start == null || end == null || start >= end || end - start > 48L * 60L * 60L * 1000L) continue;
                parsed.add(new DatedDay(start, end, mapAstro(providerDay.optJSONObject("astro"))));
            }
            if (parsed.isEmpty()) return null;
            Collections.sort(parsed, (left, right) -> Long.compare(left.startMs, right.startMs));
            for (int index = 1; index < parsed.size(); index++) {
                if (parsed.get(index - 1).endMs > parsed.get(index).startMs) return null;
            }
            JSArray days = new JSArray();
            for (DatedDay day : parsed) days.put(day.toJson());

            JSObject coordinate = new JSObject();
            coordinate.put("latitude", latitude);
            coordinate.put("longitude", longitude);
            JSObject result = new JSObject();
            result.put("status", "ok");
            result.put("coordinate", coordinate);
            result.put("locationSource", locationSource);
            result.put("fetchedAtMs", fetchedAtMs);
            result.put("days", days);
            result.put("attributions", attributions);
            return result;
        } catch (JSONException | RuntimeException ignored) {
            // Provider response content is deliberately never surfaced or retained.
            return null;
        }
    }

    private static JSObject mapAstro(JSONObject astro) {
        JSObject solar = new JSObject();
        for (String event : SOLAR_EVENTS) putNullable(solar, toEventField(event), parseRfc3339(astro == null ? null : astro.optString(event, null)));
        JSObject lunar = new JSObject();
        for (String event : LUNAR_EVENTS) putNullable(lunar, toEventField(event), parseRfc3339(astro == null ? null : astro.optString(event, null)));
        String phase = astro == null ? null : astro.optString("moonPhase", null);
        putNullable(lunar, "phase", phase != null && Arrays.asList(MOON_PHASES).contains(phase) ? phase : null);
        JSObject result = new JSObject();
        result.put("solar", solar);
        result.put("lunar", lunar);
        return result;
    }

    private static String toEventField(String providerName) {
        return providerName + "Ms";
    }

    private static void putNullable(JSObject target, String key, Object value) {
        target.put(key, value == null ? JSONObject.NULL : value);
    }

    static Long parseRfc3339(String value) {
        if (value == null) return null;
        Matcher match = RFC3339_OFFSET.matcher(value);
        if (!match.matches()) return null;
        try {
            int year = Integer.parseInt(match.group(1));
            int month = Integer.parseInt(match.group(2));
            int day = Integer.parseInt(match.group(3));
            int hour = Integer.parseInt(match.group(4));
            int minute = Integer.parseInt(match.group(5));
            int second = match.group(6) == null ? 0 : Integer.parseInt(match.group(6));
            String fraction = match.group(7);
            int millisecond = fraction == null ? 0 : Integer.parseInt((fraction + "000").substring(0, 3));
            int offsetMinutes = 0;
            if (!"Z".equals(match.group(8))) {
                int offsetHour = Integer.parseInt(match.group(10));
                int offsetMinute = Integer.parseInt(match.group(11));
                if (offsetHour > 23 || offsetMinute > 59) return null;
                offsetMinutes = offsetHour * 60 + offsetMinute;
                if ("-".equals(match.group(9))) offsetMinutes = -offsetMinutes;
            }
            if (hour > 23 || minute > 59 || second > 59) return null;
            GregorianCalendar calendar = new GregorianCalendar(TimeZone.getTimeZone("UTC"), Locale.ROOT);
            calendar.setGregorianChange(new Date(Long.MIN_VALUE));
            calendar.setLenient(false);
            calendar.clear();
            calendar.set(Calendar.YEAR, year);
            calendar.set(Calendar.MONTH, month - 1);
            calendar.set(Calendar.DAY_OF_MONTH, day);
            calendar.set(Calendar.HOUR_OF_DAY, hour);
            calendar.set(Calendar.MINUTE, minute);
            calendar.set(Calendar.SECOND, second);
            calendar.set(Calendar.MILLISECOND, millisecond);
            return calendar.getTimeInMillis() - offsetMinutes * 60_000L;
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    static boolean isUsableCoordinates(double latitude, double longitude) {
        return !Double.isNaN(latitude) && !Double.isInfinite(latitude)
            && !Double.isNaN(longitude) && !Double.isInfinite(longitude)
            && latitude >= -90.0 && latitude <= 90.0
            && longitude >= -180.0 && longitude <= 180.0;
    }

    static final class Cache {
        private JSObject value;
        private double latitude;
        private double longitude;
        private long fetchedAtMs;

        synchronized JSObject get(double requestedLatitude, double requestedLongitude, long nowMs) {
            if (value == null || !sameCoordinate(latitude, requestedLatitude)
                || !sameCoordinate(longitude, requestedLongitude) || nowMs < fetchedAtMs
                || nowMs - fetchedAtMs >= CACHE_TTL_MS || !hasContinuousCoverage(value, nowMs)) return null;
            return copy(value);
        }

        static boolean hasContinuousCoverage(JSObject schedule, long nowMs) {
            JSONArray days = schedule == null ? null : schedule.optJSONArray("days");
            if (days == null || days.length() == 0 || days.length() > MAX_DAYS) return false;
            int index = -1;
            long cursor = Long.MIN_VALUE;
            for (int dayIndex = 0; dayIndex < days.length(); dayIndex++) {
                JSONObject day = days.optJSONObject(dayIndex);
                if (day == null) return false;
                long start = day.optLong("intervalStartMs", Long.MIN_VALUE);
                long end = day.optLong("intervalEndMs", Long.MIN_VALUE);
                if (start >= end) return false;
                if (start <= nowMs && nowMs < end) {
                    index = dayIndex;
                    cursor = end;
                    break;
                }
            }
            if (index < 0) return false;
            long requiredEnd = nowMs + MIN_COVERAGE_MS;
            while (cursor < requiredEnd) {
                index++;
                if (index >= days.length()) return false;
                JSONObject day = days.optJSONObject(index);
                if (day == null || day.optLong("intervalStartMs", Long.MIN_VALUE) != cursor) return false;
                long end = day.optLong("intervalEndMs", Long.MIN_VALUE);
                if (end <= cursor) return false;
                cursor = end;
            }
            return true;
        }

        synchronized void put(JSObject schedule) {
            if (schedule == null || !"ok".equals(schedule.optString("status", ""))) return;
            JSONObject coordinate = schedule.optJSONObject("coordinate");
            JSONArray days = schedule.optJSONArray("days");
            if (coordinate == null || days == null || days.length() == 0 || days.length() > MAX_DAYS) return;
            double nextLatitude = coordinate.optDouble("latitude", Double.NaN);
            double nextLongitude = coordinate.optDouble("longitude", Double.NaN);
            long nextFetchedAt = schedule.optLong("fetchedAtMs", -1L);
            for (int index = 0; index < days.length(); index++) {
                JSONObject day = days.optJSONObject(index);
                if (day == null) return;
            }
            if (!isUsableCoordinates(nextLatitude, nextLongitude) || nextFetchedAt < 0) return;
            latitude = nextLatitude;
            longitude = nextLongitude;
            fetchedAtMs = nextFetchedAt;
            value = copy(schedule);
        }

        synchronized void clear() {
            value = null;
            latitude = 0;
            longitude = 0;
            fetchedAtMs = 0;
        }

        private static boolean sameCoordinate(double left, double right) {
            return String.format(Locale.US, "%.2f", left).equals(String.format(Locale.US, "%.2f", right));
        }

        private static JSObject copy(JSObject object) {
            try {
                return new JSObject(object.toString());
            } catch (JSONException ignored) {
                return new JSObject();
            }
        }
    }

    private static final class DatedDay {
        final long startMs;
        final long endMs;
        final JSObject astro;

        DatedDay(long startMs, long endMs, JSObject astro) {
            this.startMs = startMs;
            this.endMs = endMs;
            this.astro = astro;
        }

        JSObject toJson() {
            JSObject result = new JSObject();
            result.put("intervalStartMs", startMs);
            result.put("intervalEndMs", endMs);
            result.put("solar", astro.optJSONObject("solar"));
            result.put("lunar", astro.optJSONObject("lunar"));
            return result;
        }
    }
}
