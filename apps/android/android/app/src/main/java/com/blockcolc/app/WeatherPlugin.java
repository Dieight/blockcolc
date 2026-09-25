package com.blockcolc.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import androidx.annotation.RequiresApi;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

@CapacitorPlugin(
    name = "QWeatherNative",
    permissions = {
        @Permission(
            alias = "weatherLocation",
            strings = {
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_FINE_LOCATION
            }
        )
    }
)
public class WeatherPlugin extends Plugin {
    private static final int CONNECT_TIMEOUT_MS = 8_000;
    private static final int READ_TIMEOUT_MS = 10_000;
    private static final int LOCATION_TIMEOUT_MS = 15_000;
    private static final int MAX_COMPRESSED_RESPONSE_BYTES = 64 * 1024;
    private static final int MAX_DECOMPRESSED_RESPONSE_BYTES = 64 * 1024;
    private static final int MAX_ATTRIBUTIONS = 10;
    private static final int MAX_ATTRIBUTION_LENGTH = 2_048;
    private static final String LOCATION_CACHE_FILE = "qweather-last-location-v1";
    private static final Pattern QWEATHER_HOST = Pattern.compile(
        "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+qweatherapi\\.com$",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern API_KEY = Pattern.compile("^[0-9a-f]{32}$", Pattern.CASE_INSENSITIVE);
    private static final String[] PRECIPITATION_TYPES = {"rain", "snow", "ice", "mixed", "none", "unknown"};

    private final AtomicLong requestGeneration = new AtomicLong(0);
    private final Object requestLock = new Object();
    private volatile LocationRequestState activeLocationRequest;
    private volatile HttpURLConnection activeConnection;
    private volatile PluginCall permissionRequestCall;
    private volatile long permissionRequestGeneration;

    @PluginMethod
    public void getCurrentWeather(PluginCall call) {
        long generation;
        synchronized (requestLock) {
            generation = requestGeneration.incrementAndGet();
        }
        if (!BuildConfig.BLOCKCOLC_QWEATHER_CONFIGURED
            || !isValidQWeatherHost(BuildConfig.BLOCKCOLC_QWEATHER_HOST)
            || !isValidApiKey(BuildConfig.BLOCKCOLC_QWEATHER_API_KEY)) {
            resolveFailure(call, "unavailable", "not_configured");
            return;
        }

        if (!hasLocationPermission()) {
            try {
                permissionRequestCall = call;
                permissionRequestGeneration = generation;
                requestPermissionForAlias("weatherLocation", call, "locationPermissionResult");
            } catch (RuntimeException ignored) {
                resolveFailure(call, "error", "permission_unavailable");
            }
            return;
        }
        requestCurrentLocation(call, generation);
    }

    /** Called only when the user turns reality weather off. */
    @PluginMethod
    public void clearLocationCache(PluginCall call) {
        LocationRequestState locationRequest;
        HttpURLConnection connection;
        Context context = getContext();
        boolean cacheCleared = true;
        synchronized (requestLock) {
            long cancelledGeneration = requestGeneration.incrementAndGet();
            locationRequest = activeLocationRequest;
            connection = activeConnection;
            activeConnection = null;
            if (context != null) {
                File cachedLocation = new File(context.getNoBackupFilesDir(), LOCATION_CACHE_FILE);
                if (cachedLocation.exists() && !cachedLocation.delete()) {
                    cacheCleared = false;
                }
            }
            if (locationRequest != null && locationRequest.generation < cancelledGeneration) {
                activeLocationRequest = null;
            }
        }
        if (locationRequest != null) cancelLocationRequest(locationRequest);
        if (connection != null) connection.disconnect();
        permissionRequestCall = null;
        if (!cacheCleared) {
            resolveFailure(call, "error", "cache_clear_failed");
            return;
        }
        JSObject result = new JSObject();
        result.put("status", "ok");
        call.resolve(result);
    }

    @PermissionCallback
    private void locationPermissionResult(PluginCall call) {
        if (call == null) return;
        long generation = permissionRequestGeneration;
        if (permissionRequestCall != call || generation != requestGeneration.get()) {
            resolveFailure(call, "unavailable", "request_cancelled");
            return;
        }
        permissionRequestCall = null;
        if (!hasLocationPermission()) {
            resolveFailure(call, "permission_denied", "location_permission_denied");
            return;
        }
        requestCurrentLocation(call, generation);
    }

    private boolean hasLocationPermission() {
        Context context = getContext();
        if (context == null) return false;
        return context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasFineLocationPermission() {
        Context context = getContext();
        return context != null
            && context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressLint("MissingPermission")
    private void requestCurrentLocation(PluginCall call, long generation) {
        if (!isRequestCurrent(generation)) {
            resolveFailure(call, "unavailable", "request_cancelled");
            return;
        }
        Context context = getContext();
        LocationManager locationManager = context == null
            ? null
            : (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) {
            tryCachedLocationOrResolve(call, generation, "location_unavailable");
            return;
        }

        List<String> providers = enabledProviders(locationManager);
        if (providers.isEmpty()) {
            tryCachedLocationOrResolve(call, generation, "location_unavailable");
            return;
        }

        Handler mainHandler = new Handler(Looper.getMainLooper());
        LocationRequestState state = new LocationRequestState(
            call, locationManager, mainHandler, generation, readCachedCoordinates()
        );
        synchronized (requestLock) {
            if (requestGeneration.get() != generation) {
                resolveFailure(call, "unavailable", "request_cancelled");
                return;
            }
            activeLocationRequest = state;
        }
        state.timeout = () -> finishLocationRequest(state, null, "location_timeout");
        mainHandler.postDelayed(state.timeout, LOCATION_TIMEOUT_MS);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            requestModernLocation(state, providers);
        } else {
            requestLegacyLocation(state, providers);
        }
    }

    private List<String> enabledProviders(LocationManager locationManager) {
        List<String> providers = new ArrayList<>();
        if (hasLocationPermission()) addEnabledProvider(locationManager, providers, LocationManager.NETWORK_PROVIDER);
        if (hasFineLocationPermission()) addEnabledProvider(locationManager, providers, LocationManager.GPS_PROVIDER);
        return providers;
    }

    private static void addEnabledProvider(LocationManager locationManager, List<String> providers, String provider) {
        try {
            if (locationManager.isProviderEnabled(provider)) providers.add(provider);
        } catch (RuntimeException ignored) {
            // An unavailable OEM provider is handled as a normal local fallback.
        }
    }

    @SuppressLint("MissingPermission")
    @RequiresApi(Build.VERSION_CODES.R)
    private void requestModernLocation(LocationRequestState state, List<String> providers) {
        state.pendingProviders.set(providers.size());
        Executor mainExecutor = command -> state.mainHandler.post(command);
        for (String provider : providers) {
            CancellationSignal cancellation = new CancellationSignal();
            state.cancellations.add(cancellation);
            try {
                state.locationManager.getCurrentLocation(provider, cancellation, mainExecutor, location -> {
                    if (!isRequestCurrent(state.generation)) {
                        finishLocationRequest(state, null, "request_cancelled");
                        return;
                    }
                    if (isUsableLocation(location)) {
                        finishLocationRequest(state, location, null);
                    } else if (state.pendingProviders.decrementAndGet() == 0) {
                        finishLocationRequest(state, null, "location_unavailable");
                    }
                });
            } catch (RuntimeException ignored) {
                if (state.pendingProviders.decrementAndGet() == 0) {
                    finishLocationRequest(state, null, "location_unavailable");
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    private void requestLegacyLocation(LocationRequestState state, List<String> providers) {
        state.pendingProviders.set(providers.size());
        state.legacyListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                if (!isRequestCurrent(state.generation)) {
                    finishLocationRequest(state, null, "request_cancelled");
                    return;
                }
                if (isUsableLocation(location)) finishLocationRequest(state, location, null);
            }

            @Override
            public void onProviderEnabled(String provider) {}

            @Override
            public void onProviderDisabled(String provider) {}
        };

        for (String provider : providers) {
            try {
                state.locationManager.requestSingleUpdate(provider, state.legacyListener, state.mainHandler.getLooper());
            } catch (RuntimeException ignored) {
                if (state.pendingProviders.decrementAndGet() == 0) {
                    finishLocationRequest(state, null, "location_unavailable");
                }
            }
        }
    }

    private void finishLocationRequest(LocationRequestState state, Location location, String failureReason) {
        if (!state.finished.compareAndSet(false, true)) return;
        if (activeLocationRequest == state) activeLocationRequest = null;
        state.mainHandler.removeCallbacks(state.timeout);
        stopLocationUpdates(state);

        if (!isRequestCurrent(state.generation)) {
            resolveFailure(state.call, "unavailable", "request_cancelled");
            return;
        }

        if (location == null) {
            if (!hasLocationPermission()) {
                resolveFailure(state.call, "permission_denied", "location_permission_denied");
                return;
            }
            if (shouldUseCachedCoordinates(true, state.cachedCoordinates)) {
                fetchCurrentWeather(state.call, state.cachedCoordinates, true, state.generation);
            } else {
                resolveFailure(state.call, "unavailable", failureReason == null ? "location_unavailable" : failureReason);
            }
            return;
        }
        cacheCoordinates(location.getLatitude(), location.getLongitude(), state.generation);
        try {
            Coordinates coordinates = new Coordinates(location.getLatitude(), location.getLongitude());
            bridge.execute(() -> fetchCurrentWeather(state.call, coordinates, false, state.generation));
        } catch (RuntimeException ignored) {
            resolveFailure(state.call, "error", "request_failed");
        }
    }

    private void tryCachedLocationOrResolve(PluginCall call, long generation, String failureReason) {
        if (!isRequestCurrent(generation)) {
            resolveFailure(call, "unavailable", "request_cancelled");
            return;
        }
        if (!hasLocationPermission()) {
            resolveFailure(call, "permission_denied", "location_permission_denied");
            return;
        }
        Coordinates cachedCoordinates = readCachedCoordinates();
        if (shouldUseCachedCoordinates(hasLocationPermission(), cachedCoordinates)) {
            fetchCurrentWeather(call, cachedCoordinates, true, generation);
        } else {
            resolveFailure(call, "unavailable", failureReason);
        }
    }

    private void fetchCurrentWeather(PluginCall call, Coordinates coordinates, boolean usedCachedLocation, long generation) {
        if (!isRequestCurrent(generation)) {
            resolveFailure(call, "unavailable", "request_cancelled");
            return;
        }
        if (!isUsableCoordinates(coordinates.latitude, coordinates.longitude)) {
            resolveFailure(call, "unavailable", "location_unavailable");
            return;
        }

        String packageName = getContext() == null ? "" : getContext().getPackageName();
        String certificateSha1 = currentSigningCertificateSha1();
        if (packageName.isEmpty() || certificateSha1 == null) {
            resolveFailure(call, "error", "signing_identity_unavailable");
            return;
        }

        HttpURLConnection connection = null;
        try {
            String path = String.format(
                Locale.US,
                "https://%s/weather/v1/current/%s/%s?lang=zh",
                BuildConfig.BLOCKCOLC_QWEATHER_HOST,
                formatCoordinate(coordinates.latitude),
                formatCoordinate(coordinates.longitude)
            );
            connection = (HttpURLConnection) new URL(path).openConnection();
            if (!isRequestCurrent(generation)) {
                resolveFailure(call, "unavailable", "request_cancelled");
                return;
            }
            synchronized (requestLock) {
                if (requestGeneration.get() != generation) {
                    connection.disconnect();
                    resolveFailure(call, "unavailable", "request_cancelled");
                    return;
                }
                activeConnection = connection;
            }
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Accept-Encoding", "gzip");
            connection.setRequestProperty("X-QW-Api-Key", BuildConfig.BLOCKCOLC_QWEATHER_API_KEY);
            connection.setRequestProperty("X-Android-Package-Name", packageName);
            connection.setRequestProperty("X-Android-Cert", certificateSha1);

            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) {
                String errorBody = readErrorResponse(connection);
                resolveFailure(call, "error", mapHttpFailure(responseCode, errorBody));
                return;
            }

            String body = decodeWeatherResponse(
                connection.getInputStream(), connection.getContentEncoding()
            );
            JSObject result = mapResponse(body);
            if (result == null) {
                resolveFailure(call, "error", "invalid_response");
            } else {
                result.put("locationSource", usedCachedLocation ? "cached" : "fresh");
                call.resolve(result);
            }
        } catch (ResponseTooLargeException ignored) {
            resolveFailure(call, "error", "response_too_large");
        } catch (UnsupportedResponseEncodingException ignored) {
            resolveFailure(call, "error", "unsupported_response_encoding");
        } catch (UnknownHostException | ConnectException ignored) {
            resolveFailure(call, "error", "network_unavailable");
        } catch (SocketTimeoutException ignored) {
            resolveFailure(call, "error", "request_timeout");
        } catch (Exception ignored) {
            // Never expose the URL, headers, credentials, response body, or exception text.
            resolveFailure(call, "error", isRequestCurrent(generation) ? "request_failed" : "request_cancelled");
        } finally {
            if (connection != null) {
                connection.disconnect();
                if (activeConnection == connection) activeConnection = null;
            }
        }
    }

    private static String readErrorResponse(HttpURLConnection connection) {
        InputStream errorStream = connection.getErrorStream();
        if (errorStream == null) return "";
        try {
            return decodeWeatherResponse(errorStream, connection.getContentEncoding());
        } catch (IOException ignored) {
            return "";
        }
    }

    static String decodeWeatherResponse(InputStream input, String contentEncoding) throws IOException {
        InputStream limitedInput = new CompressedByteLimitInputStream(input, MAX_COMPRESSED_RESPONSE_BYTES);
        InputStream decoded;
        String encoding = contentEncoding == null ? "identity" : contentEncoding.trim();
        if (encoding.isEmpty() || encoding.equalsIgnoreCase("identity")) {
            decoded = limitedInput;
        } else if (encoding.equalsIgnoreCase("gzip")) {
            try {
                decoded = new GZIPInputStream(limitedInput);
            } catch (IOException error) {
                try { limitedInput.close(); } catch (IOException ignored) {}
                throw error;
            }
        } else {
            try { limitedInput.close(); } catch (IOException ignored) {}
            throw new UnsupportedResponseEncodingException();
        }
        try (InputStream stream = decoded; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8_192];
            int total = 0;
            int count;
            while ((count = stream.read(buffer)) != -1) {
                total += count;
                if (total > MAX_DECOMPRESSED_RESPONSE_BYTES) throw new ResponseTooLargeException();
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static final class CompressedByteLimitInputStream extends FilterInputStream {
        private final long maximumBytes;
        private long bytesRead;

        CompressedByteLimitInputStream(InputStream input, long maximumBytes) {
            super(input);
            this.maximumBytes = maximumBytes;
        }

        @Override
        public int read() throws IOException {
            if (bytesRead >= maximumBytes) {
                int extra = super.read();
                if (extra < 0) return -1;
                throw new ResponseTooLargeException();
            }
            int value = super.read();
            if (value >= 0) bytesRead++;
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (length == 0) return 0;
            long remainingWithProbe = maximumBytes - bytesRead + 1;
            int allowed = (int) Math.min((long) length, Math.max(1L, remainingWithProbe));
            int count = super.read(buffer, offset, allowed);
            if (count < 0) return -1;
            bytesRead += count;
            if (bytesRead > maximumBytes) throw new ResponseTooLargeException();
            return count;
        }
    }

    private static final class ResponseTooLargeException extends IOException {}

    private static final class UnsupportedResponseEncodingException extends IOException {}

    static String mapHttpFailure(int responseCode, String errorBody) {
        String providerType = providerErrorType(errorBody);
        switch (providerType) {
            case "unauthorized": return "authentication_failed";
            case "security-restriction": return "security_restriction";
            case "invalid-host": return "invalid_host";
            case "no-credit": return "quota_exhausted";
            case "overdue": return "billing_issue";
            case "account-suspension": return "account_suspended";
            case "deprecated": return "api_deprecated";
            case "forbidden": return "access_denied";
            case "too-many-requests":
            case "over-monthly-limit": return "rate_limited";
            case "invalid-parameters":
            case "missing-parameters":
            case "no-such-location": return "request_invalid";
            case "not-found": return "api_path_not_found";
            case "data-not-available": return "provider_unavailable";
            default: break;
        }
        if (responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) return "authentication_failed";
        if (responseCode == HttpURLConnection.HTTP_FORBIDDEN) return "access_denied";
        if (responseCode == HttpURLConnection.HTTP_NOT_FOUND) return "api_path_not_found";
        if (responseCode == 405 || responseCode == 400) return "request_invalid";
        if (responseCode == 429) return "rate_limited";
        if (responseCode >= 500) return "provider_unavailable";
        if (responseCode >= 400) return "request_invalid";
        return "request_failed";
    }

    private static String providerErrorType(String errorBody) {
        if (errorBody == null || errorBody.isEmpty()) return "";
        try {
            JSONObject response = new JSONObject(errorBody);
            JSONObject error = response.optJSONObject("error");
            String type = error == null ? "" : error.optString("type", "");
            int fragmentStart = type.lastIndexOf('#');
            if (fragmentStart >= 0 && fragmentStart < type.length() - 1) {
                return type.substring(fragmentStart + 1).trim().toLowerCase(Locale.ROOT);
            }
            int pathStart = type.lastIndexOf('/');
            if (pathStart >= 0 && pathStart < type.length() - 1) {
                return type.substring(pathStart + 1).trim().toLowerCase(Locale.ROOT);
            }
        } catch (JSONException | RuntimeException ignored) {
            // Do not expose or retain provider response text.
        }
        return "";
    }

    static boolean shouldUseCachedCoordinates(boolean locationPermissionGranted, Coordinates cachedCoordinates) {
        return locationPermissionGranted && cachedCoordinates != null
            && isUsableCoordinates(cachedCoordinates.latitude, cachedCoordinates.longitude);
    }

    static String encodeCachedCoordinates(double latitude, double longitude) {
        if (!isUsableCoordinates(latitude, longitude)) throw new IllegalArgumentException("Location is out of range");
        return formatCoordinate(latitude) + "," + formatCoordinate(longitude);
    }

    static Coordinates parseCachedCoordinates(String value) {
        if (value == null) return null;
        String[] parts = value.trim().split(",", -1);
        if (parts.length != 2) return null;
        try {
            double latitude = Double.parseDouble(parts[0]);
            double longitude = Double.parseDouble(parts[1]);
            return isUsableCoordinates(latitude, longitude) ? new Coordinates(latitude, longitude) : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private void cacheCoordinates(double latitude, double longitude, long generation) {
        Context context = getContext();
        if (context == null || !isUsableCoordinates(latitude, longitude)) return;
        File cacheFile = new File(context.getNoBackupFilesDir(), LOCATION_CACHE_FILE);
        byte[] content = encodeCachedCoordinates(latitude, longitude).getBytes(StandardCharsets.UTF_8);
        synchronized (requestLock) {
            if (requestGeneration.get() != generation) return;
            try (FileOutputStream output = new FileOutputStream(cacheFile, false)) {
                output.write(content);
                output.getFD().sync();
            } catch (IOException ignored) {
                // The current request can still use the fresh coordinates in memory.
            }
        }
    }

    private Coordinates readCachedCoordinates() {
        Context context = getContext();
        if (context == null) return null;
        File cacheFile = new File(context.getNoBackupFilesDir(), LOCATION_CACHE_FILE);
        if (!cacheFile.isFile() || cacheFile.length() > 64) return null;
        byte[] buffer = new byte[64];
        try (FileInputStream input = new FileInputStream(cacheFile)) {
            int length = input.read(buffer);
            if (length <= 0 || input.read() != -1) return null;
            return parseCachedCoordinates(new String(buffer, 0, length, StandardCharsets.UTF_8));
        } catch (IOException ignored) {
            return null;
        }
    }

    private boolean isRequestCurrent(long generation) {
        return requestGeneration.get() == generation;
    }

    private void cancelLocationRequest(LocationRequestState state) {
        if (!state.finished.compareAndSet(false, true)) return;
        state.mainHandler.removeCallbacks(state.timeout);
        stopLocationUpdates(state);
        if (activeLocationRequest == state) activeLocationRequest = null;
        resolveFailure(state.call, "unavailable", "request_cancelled");
    }

    private static void stopLocationUpdates(LocationRequestState state) {
        if (state.legacyListener != null) {
            try {
                state.locationManager.removeUpdates(state.legacyListener);
            } catch (RuntimeException ignored) {
                // The one-shot listener has already completed or expired.
            }
        }
        for (CancellationSignal cancellation : state.cancellations) cancellation.cancel();
    }

    static JSObject mapResponse(String responseBody) {
        try {
            JSONObject response = new JSONObject(responseBody);
            JSONObject metadata = response.optJSONObject("metadata");
            JSONArray providerAttributions = metadata == null ? null : metadata.optJSONArray("attributions");
            JSONObject current = response.optJSONObject("current");
            // The v1 endpoint returns current conditions at the top level. Accept a
            // nested `current` object as a compatibility fallback for wrapped proxies.
            if (current == null) current = response;
            if (providerAttributions == null || current == null) return null;

            JSArray attributions = new JSArray();
            for (int index = 0; index < providerAttributions.length() && index < MAX_ATTRIBUTIONS; index++) {
                Object value = providerAttributions.opt(index);
                if (!(value instanceof String)) continue;
                String attribution = ((String) value).trim();
                if (!attribution.isEmpty() && attribution.length() <= MAX_ATTRIBUTION_LENGTH) attributions.put(attribution);
            }
            if (attributions.length() == 0) return null;

            JSONObject condition = current.optJSONObject("condition");
            if (condition == null) return null;
            String conditionText = condition.optString("text", "").trim();
            String conditionCode = condition.optString("code", "").trim();
            if (conditionText.isEmpty() || conditionText.length() > 120 || conditionCode.isEmpty() || conditionCode.length() > 16) {
                return null;
            }

            Double cloudCover = finiteNumber(current, "cloudCover");

            JSObject currentResult = new JSObject();
            currentResult.put("conditionText", conditionText);
            currentResult.put("conditionCode", conditionCode);
            if (cloudCover != null && cloudCover >= 0.0 && cloudCover <= 1.0) {
                currentResult.put("cloudCover", cloudCover);
            }

            JSONObject temperature = current.optJSONObject("temperature");
            Double temperatureValue = temperature == null ? null : finiteNumber(temperature, "value");
            if (temperatureValue != null) {
                String temperatureUnit = temperature.optString("unit", "").trim();
                if (temperatureUnit.equals("°C") || temperatureUnit.equalsIgnoreCase("C")) {
                    currentResult.put("temperatureC", temperatureValue);
                } else if (temperatureUnit.equals("°F") || temperatureUnit.equalsIgnoreCase("F")) {
                    currentResult.put("temperatureC", (temperatureValue - 32.0) * 5.0 / 9.0);
                }
            }

            Double humidity = finiteNumber(current, "humidity");
            if (humidity != null && humidity >= 0.0 && humidity <= 1.0) currentResult.put("humidity", humidity);

            JSONObject wind = current.optJSONObject("wind");
            JSONObject windSpeed = wind == null ? null : wind.optJSONObject("speed");
            Double windValue = windSpeed == null ? null : finiteNumber(windSpeed, "value");
            String windUnit = windSpeed == null ? "" : windSpeed.optString("unit", "").trim();
            if (windValue != null && windValue >= 0.0 && !windUnit.isEmpty() && windUnit.length() <= 16) {
                JSObject mappedWind = new JSObject();
                mappedWind.put("value", windValue);
                mappedWind.put("unit", windUnit);
                currentResult.put("windSpeed", mappedWind);
            }

            JSONObject precipitation = current.optJSONObject("precipitation");
            String precipitationType = precipitation == null ? "unknown" : precipitation.optString("type", "unknown").trim().toLowerCase(Locale.ROOT);
            if (!isPrecipitationType(precipitationType)) precipitationType = "unknown";
            currentResult.put("precipitationType", precipitationType);

            JSONObject intensity = precipitation == null ? null : precipitation.optJSONObject("intensity");
            Double intensityValue = intensity == null ? null : finiteNumber(intensity, "value");
            String intensityUnit = intensity == null ? "" : intensity.optString("unit", "").trim();
            if (intensityValue != null && intensityValue >= 0.0 && !intensityUnit.isEmpty() && intensityUnit.length() <= 16) {
                JSObject mappedIntensity = new JSObject();
                mappedIntensity.put("value", intensityValue);
                mappedIntensity.put("unit", intensityUnit);
                currentResult.put("precipitationIntensity", mappedIntensity);
            }

            JSObject result = new JSObject();
            result.put("status", "ok");
            result.put("current", currentResult);
            result.put("attributions", attributions);
            String observedAt = current.optString("obsTime", current.optString("observedTime", "")).trim();
            if (!observedAt.isEmpty() && observedAt.length() <= 64) result.put("observedAt", observedAt);
            return result;
        } catch (JSONException | RuntimeException ignored) {
            return null;
        }
    }

    private static Double finiteNumber(JSONObject object, String key) {
        Object raw = object.opt(key);
        if (!(raw instanceof Number)) return null;
        double value = ((Number) raw).doubleValue();
        return Double.isFinite(value) ? value : null;
    }

    private static boolean isPrecipitationType(String type) {
        for (String supported : PRECIPITATION_TYPES) {
            if (supported.equals(type)) return true;
        }
        return false;
    }

    private static boolean isUsableLocation(Location location) {
        if (location == null) return false;
        return isUsableCoordinates(location.getLatitude(), location.getLongitude());
    }

    private static boolean isUsableCoordinates(double latitude, double longitude) {
        return Double.isFinite(latitude) && Double.isFinite(longitude)
            && latitude >= -90.0 && latitude <= 90.0
            && longitude >= -180.0 && longitude <= 180.0;
    }

    private String currentSigningCertificateSha1() {
        Context context = getContext();
        if (context == null) return null;
        try {
            PackageManager packageManager = context.getPackageManager();
            Signature[] signers;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageInfo packageInfo = packageManager.getPackageInfo(
                    context.getPackageName(),
                    PackageManager.GET_SIGNING_CERTIFICATES
                );
                SigningInfo signingInfo = packageInfo.signingInfo;
                if (signingInfo == null) return null;
                signers = signingInfo.getApkContentsSigners();
            } else {
                @SuppressWarnings("deprecation")
                PackageInfo packageInfo = packageManager.getPackageInfo(
                    context.getPackageName(),
                    PackageManager.GET_SIGNATURES
                );
                signers = packageInfo.signatures;
            }
            if (signers == null || signers.length != 1) return null;
            byte[] digest = MessageDigest.getInstance("SHA-1").digest(signers[0].toByteArray());
            return formatSha1Fingerprint(digest);
        } catch (PackageManager.NameNotFoundException | NoSuchAlgorithmException | RuntimeException ignored) {
            return null;
        }
    }

    static boolean isValidQWeatherHost(String host) {
        return host != null && QWEATHER_HOST.matcher(host).matches();
    }

    static boolean isValidApiKey(String key) {
        return key != null && API_KEY.matcher(key).matches();
    }

    static String formatCoordinate(double coordinate) {
        if (!Double.isFinite(coordinate) || coordinate < -180.0 || coordinate > 180.0) {
            throw new IllegalArgumentException("Coordinate is out of range");
        }
        return String.format(Locale.US, "%.2f", coordinate);
    }

    static String formatSha1Fingerprint(byte[] digest) {
        if (digest == null || digest.length != 20) throw new IllegalArgumentException("SHA-1 digest must be 20 bytes");
        StringBuilder result = new StringBuilder(59);
        for (int index = 0; index < digest.length; index++) {
            if (index > 0) result.append(':');
            int value = digest[index] & 0xff;
            result.append(Character.toUpperCase(Character.forDigit((value >>> 4) & 0x0f, 16)));
            result.append(Character.toUpperCase(Character.forDigit(value & 0x0f, 16)));
        }
        return result.toString();
    }

    private static void resolveFailure(PluginCall call, String status, String reason) {
        JSObject result = new JSObject();
        result.put("status", status);
        result.put("reason", reason);
        call.resolve(result);
    }

    private static final class LocationRequestState {
        final PluginCall call;
        final LocationManager locationManager;
        final Handler mainHandler;
        final long generation;
        final Coordinates cachedCoordinates;
        final AtomicBoolean finished = new AtomicBoolean(false);
        final AtomicInteger pendingProviders = new AtomicInteger(0);
        final List<CancellationSignal> cancellations = new ArrayList<>();
        Runnable timeout;
        LocationListener legacyListener;

        LocationRequestState(PluginCall call, LocationManager locationManager, Handler mainHandler,
                             long generation, Coordinates cachedCoordinates) {
            this.call = call;
            this.locationManager = locationManager;
            this.mainHandler = mainHandler;
            this.generation = generation;
            this.cachedCoordinates = cachedCoordinates;
        }
    }

    static final class Coordinates {
        final double latitude;
        final double longitude;

        Coordinates(double latitude, double longitude) {
            this.latitude = latitude;
            this.longitude = longitude;
        }
    }
}
