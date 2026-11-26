package com.blockcolc.preview

internal const val CLOUD_SYNC_INTERVAL_MS = 10_000L

internal data class CloudSyncRetry(
    val failures: Int = 0,
    val lastError: String? = null,
    val ignored: Boolean = false,
    val nextAt: Long? = null,
    val inFlight: Boolean = false,
) {
    val visibleError: String? get() = lastError.takeIf { failures >= 3 && !ignored }

    fun failed(code: String) = copy(failures = (failures + 1).coerceAtMost(3), lastError = code)

    fun secondsUntilRetry(now: Long): Long? = nextAt?.let { ((it - now).coerceAtLeast(0L) + 999) / 1000 }
}
