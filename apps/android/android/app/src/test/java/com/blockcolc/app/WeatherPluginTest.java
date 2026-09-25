package com.blockcolc.app;

import com.getcapacitor.JSObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.zip.GZIPOutputStream;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;

public class WeatherPluginTest {
    @Test
    public void validatesOnlyQWeatherApiHostnames() {
        assertTrue(WeatherPlugin.isValidQWeatherHost("api-123.qweatherapi.com"));
        assertTrue(WeatherPlugin.isValidQWeatherHost("a.region-2.qweatherapi.com"));
        assertFalse(WeatherPlugin.isValidQWeatherHost("qweatherapi.com"));
        assertFalse(WeatherPlugin.isValidQWeatherHost("api.qweatherapi.com.attacker.invalid"));
        assertFalse(WeatherPlugin.isValidQWeatherHost("https://api.qweatherapi.com"));
        assertFalse(WeatherPlugin.isValidQWeatherHost("*.qweatherapi.com"));
        assertFalse(WeatherPlugin.isValidQWeatherHost("-bad.qweatherapi.com"));
    }

    @Test
    public void acceptsOnlyThirtyTwoHexCharacterApiKeys() {
        assertTrue(WeatherPlugin.isValidApiKey("0123456789abcdef0123456789abcdef"));
        assertTrue(WeatherPlugin.isValidApiKey("0123456789ABCDEF0123456789ABCDEF"));
        assertFalse(WeatherPlugin.isValidApiKey("0123456789abcdef0123456789abcde"));
        assertFalse(WeatherPlugin.isValidApiKey("0123456789abcdef0123456789abcdef0"));
        assertFalse(WeatherPlugin.isValidApiKey("0123456789abcdef0123456789abcdeg"));
    }

    @Test
    public void formatsCoordinatesWithStableInvariantDecimalNotation() {
        assertEquals("39.92", WeatherPlugin.formatCoordinate(39.923));
        assertEquals("-0.01", WeatherPlugin.formatCoordinate(-0.006));
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsOutOfRangeCoordinates() {
        WeatherPlugin.formatCoordinate(181.0);
    }

    @Test
    public void formatsSignerSha1AsUppercaseColonSeparatedFingerprint() {
        byte[] digest = new byte[20];
        for (int index = 0; index < digest.length; index++) digest[index] = (byte) index;
        assertEquals(
            "00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13",
            WeatherPlugin.formatSha1Fingerprint(digest)
        );
    }

    @Test
    public void mapsOfficialTopLevelCurrentWeatherResponse() throws Exception {
        String response = "{"
            + "\"metadata\":{\"attributions\":[\"QWeather\",\"Weather data provider\"]},"
            + "\"condition\":{\"text\":\"Light rain\",\"code\":\"305\"},"
            + "\"temperature\":{\"value\":18.5,\"unit\":\"°C\"},"
            + "\"humidity\":0.72,"
            + "\"wind\":{\"speed\":{\"value\":3.2,\"unit\":\"m/s\"}},"
            + "\"cloudCover\":0.84,"
            + "\"precipitation\":{\"type\":\"rain\",\"intensity\":{\"value\":1.4,\"unit\":\"mm/h\"}},"
            + "\"obsTime\":\"2026-09-23T10:00+08:00\""
            + "}";

        JSObject mapped = WeatherPlugin.mapResponse(response);

        assertNotNull(mapped);
        assertEquals("ok", mapped.getString("status"));
        assertEquals("2026-09-23T10:00+08:00", mapped.getString("observedAt"));
        assertEquals(2, mapped.getJSONArray("attributions").length());
        JSObject current = mapped.getJSObject("current");
        assertNotNull(current);
        assertEquals("305", current.getString("conditionCode"));
        assertEquals("Light rain", current.getString("conditionText"));
        assertEquals(0.84, current.getDouble("cloudCover"), 0.0001);
        assertEquals(18.5, current.getDouble("temperatureC"), 0.0001);
        assertEquals("rain", current.getString("precipitationType"));
        assertEquals(1.4, current.getJSObject("precipitationIntensity").getDouble("value"), 0.0001);
        assertEquals("mm/h", current.getJSObject("precipitationIntensity").getString("unit"));
        assertEquals("m/s", current.getJSObject("windSpeed").getString("unit"));
    }

    @Test
    public void retainsCompatibilityWithNestedCurrentWrapper() throws Exception {
        String response = "{"
            + "\"metadata\":{\"attributions\":[\"QWeather\"]},"
            + "\"current\":{"
            + "\"condition\":{\"text\":\"Clear\",\"code\":\"100\"},"
            + "\"cloudCover\":0.1,"
            + "\"precipitation\":{\"type\":\"none\"}"
            + "}}";

        JSObject mapped = WeatherPlugin.mapResponse(response);

        assertNotNull(mapped);
        assertEquals("Clear", mapped.getJSObject("current").getString("conditionText"));
        assertEquals("none", mapped.getJSObject("current").getString("precipitationType"));
    }

    @Test
    public void mapsTopLevelConditionsWhenCloudCoverAndOtherReadingsAreMissing() throws Exception {
        String response = "{"
            + "\"metadata\":{\"attributions\":[\"QWeather\"]},"
            + "\"condition\":{\"text\":\"Cloudy\",\"code\":\"104\"}"
            + "}";

        JSObject mapped = WeatherPlugin.mapResponse(response);

        assertNotNull(mapped);
        JSObject current = mapped.getJSObject("current");
        assertNotNull(current);
        assertEquals("Cloudy", current.getString("conditionText"));
        assertEquals("104", current.getString("conditionCode"));
        assertEquals("unknown", current.getString("precipitationType"));
        assertFalse(current.has("cloudCover"));
        assertFalse(current.has("temperatureC"));
        assertFalse(current.has("humidity"));
        assertFalse(current.has("windSpeed"));
        assertFalse(current.has("precipitationIntensity"));
    }

    @Test
    public void rejectsTopLevelResponseWithoutRequiredConditionOrAttribution() {
        assertNull(WeatherPlugin.mapResponse(
            "{\"metadata\":{\"attributions\":[\"QWeather\"]}}"
        ));
        assertNull(WeatherPlugin.mapResponse(
            "{\"condition\":{\"text\":\"Cloudy\",\"code\":\"104\"}}"
        ));
    }

    @Test
    public void decodesGzipApiResponseBeforeParsingUtf8Json() throws Exception {
        byte[] body = "{\"status\":\"ok\",\"condition\":\"synthetic\"}".getBytes(StandardCharsets.UTF_8);
        byte[] compressed = gzip(body);

        assertEquals(
            new String(body, StandardCharsets.UTF_8),
            WeatherPlugin.decodeWeatherResponse(new ByteArrayInputStream(compressed), "gzip")
        );
    }

    @Test
    public void boundsBothCompressedAndExpandedWeatherResponses() throws Exception {
        byte[] oversizedPlain = new byte[64 * 1024 + 1];
        Arrays.fill(oversizedPlain, (byte) 'x');
        assertThrows(IOException.class, () -> WeatherPlugin.decodeWeatherResponse(
            new ByteArrayInputStream(oversizedPlain), "identity"
        ));

        byte[] expanded = new byte[128 * 1024];
        Arrays.fill(expanded, (byte) 'x');
        byte[] zipBomb = gzip(expanded);
        assertTrue(zipBomb.length < 64 * 1024);
        assertThrows(IOException.class, () -> WeatherPlugin.decodeWeatherResponse(
            new ByteArrayInputStream(zipBomb), "gzip"
        ));
    }

    @Test
    public void mapsHttpFailuresToSafeActionableReasonsWithoutEchoingProviderText() {
        assertEquals("authentication_failed", WeatherPlugin.mapHttpFailure(
            401, "{\"error\":{\"type\":\"https://dev.qweather.com/docs/resource/error-code/#unauthorized\",\"detail\":\"private detail\"}}"
        ));
        assertEquals("security_restriction", WeatherPlugin.mapHttpFailure(
            403, "{\"error\":{\"type\":\"https://dev.qweather.com/docs/resource/error-code/#security-restriction\",\"detail\":\"private detail\"}}"
        ));
        assertEquals("api_path_not_found", WeatherPlugin.mapHttpFailure(404, ""));
        assertEquals("rate_limited", WeatherPlugin.mapHttpFailure(429, ""));
        assertEquals("provider_unavailable", WeatherPlugin.mapHttpFailure(503, ""));
        assertEquals("access_denied", WeatherPlugin.mapHttpFailure(403, ""));
    }

    @Test
    public void encodesCoordinatesForLocalCacheAndUsesItOnlyWithCurrentPermission() {
        String encoded = WeatherPlugin.encodeCachedCoordinates(39.923, 116.416);
        WeatherPlugin.Coordinates cached = WeatherPlugin.parseCachedCoordinates(encoded);

        assertEquals("39.92,116.42", encoded);
        assertNotNull(cached);
        assertEquals(39.92, cached.latitude, 0.0001);
        assertEquals(116.42, cached.longitude, 0.0001);
        assertTrue(WeatherPlugin.shouldUseCachedCoordinates(true, cached));
        assertFalse(WeatherPlugin.shouldUseCachedCoordinates(false, cached));
        assertFalse(WeatherPlugin.shouldUseCachedCoordinates(true, null));
        assertNull(WeatherPlugin.parseCachedCoordinates("91,181"));
        assertNull(WeatherPlugin.parseCachedCoordinates("not-a-coordinate"));
    }

    private static byte[] gzip(byte[] body) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(output)) {
            gzip.write(body);
        }
        return output.toByteArray();
    }
}
