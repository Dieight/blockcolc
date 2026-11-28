package com.blockcolc.preview.ui

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.provider.Settings
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/** Whisper-quiet procedural sonification cues matching the Gallery demo's
 * tick, bounce, and building-completion chime. Respects device ringer mode
 * and system sound-effects settings, and never requests audio focus. */
internal object NativeTactileAudio {
    private const val SAMPLE_RATE = 22_050
    private val worker = Executors.newSingleThreadExecutor { r ->
        Thread(r, "blockcolc-tactile-sfx").apply { isDaemon = true }
    }

    private fun allowed(context: Context): Boolean = runCatching {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return false
        if (am.ringerMode != AudioManager.RINGER_MODE_NORMAL) return false
        Settings.System.getInt(context.contentResolver, Settings.System.SOUND_EFFECTS_ENABLED, 1) != 0
    }.getOrDefault(false)

    fun tick(context: Context, freqHz: Float = 1180f) {
        if (!allowed(context)) return
        val appCtx = context.applicationContext
        worker.execute { playPcm(appCtx, synthSweep(freqHz, freqHz * 0.42f, 22, 0.09f, triangle = true)) }
    }

    fun bounce(context: Context, amplitude: Float = 0.7f) {
        if (!allowed(context)) return
        val amp = amplitude.coerceIn(0.15f, 1f)
        val appCtx = context.applicationContext
        worker.execute { playPcm(appCtx, synthSweep(320f + amp * 130f, 165f, 44, 0.12f * amp, triangle = false)) }
    }

    fun chime(context: Context) {
        if (!allowed(context)) return
        val appCtx = context.applicationContext
        worker.execute { playPcm(appCtx, synthChime()) }
    }

    private fun synthSweep(startHz: Float, endHz: Float, durationMs: Int, gain: Float, triangle: Boolean): ShortArray {
        val count = (SAMPLE_RATE * durationMs / 1000).coerceAtLeast(64)
        val out = ShortArray(count)
        var phase = 0.0
        for (i in 0 until count) {
            val t = i.toFloat() / count.toFloat()
            val freq = startHz * Math.pow((endHz / startHz).toDouble(), t.toDouble()).toFloat()
            phase += 2.0 * PI * freq / SAMPLE_RATE
            val env = exp(-5.2 * t) * (if (i < 24) i / 24.0 else 1.0)
            val wave = if (triangle) {
                val p = (phase / (2.0 * PI)) % 1.0
                (4.0 * kotlin.math.abs(p - 0.5) - 1.0)
            } else {
                sin(phase)
            }
            out[i] = (wave * env * gain * Short.MAX_VALUE).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return out
    }

    private fun synthChime(): ShortArray {
        val notes = floatArrayOf(392f, 523.25f, 659.25f)
        val totalMs = 920
        val count = SAMPLE_RATE * totalMs / 1000
        val mix = DoubleArray(count)
        notes.forEachIndexed { idx, hz ->
            val start = idx * (SAMPLE_RATE * 58 / 1000)
            val noteGain = 0.14 / (idx + 1)
            for (i in start until count) {
                val sec = (i - start).toDouble() / SAMPLE_RATE
                val attack = (sec / 0.018).coerceAtMost(1.0)
                val decay = exp(-3.4 * sec)
                mix[i] += sin(2.0 * PI * hz * sec) * attack * decay * noteGain
            }
        }
        return ShortArray(count) { i ->
            (mix[i] * Short.MAX_VALUE).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
    }

    private fun playPcm(context: Context, samples: ShortArray) {
        runCatching {
            if (!allowed(context)) return
            val bytes = samples.size * 2
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            val format = AudioFormat.Builder()
                .setSampleRate(SAMPLE_RATE)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build()
            val track = AudioTrack.Builder()
                .setAudioAttributes(attrs)
                .setAudioFormat(format)
                .setBufferSizeInBytes(bytes)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build()
            try {
                track.write(samples, 0, samples.size)
                track.play()
                val durationMs = (samples.size * 1000L / SAMPLE_RATE) + 35L
                Thread.sleep(durationMs)
            } finally {
                runCatching { track.stop() }
                runCatching { track.release() }
            }
        }
    }
}
