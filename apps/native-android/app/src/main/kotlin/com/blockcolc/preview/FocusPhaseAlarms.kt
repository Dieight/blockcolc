package com.blockcolc.preview

import android.content.Context
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import com.blockcolc.focus.TimedPhase
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

internal enum class PhaseAlarmMode(val vibrate: Boolean = false, val ring: Boolean = false) {
    OFF, VIBRATION(vibrate = true), SOUND(ring = true), BOTH(vibrate = true, ring = true)
}

internal class FocusPhaseAlarmSettings(context: Context) {
    private val prefs = context.getSharedPreferences("focus-phase-alarms", Context.MODE_PRIVATE)

    fun mode(phase: TimedPhase): PhaseAlarmMode {
        val saved = prefs.getString(phase.name, null)
        return PhaseAlarmMode.entries.firstOrNull { it.name == saved } ?: PhaseAlarmMode.OFF
    }

    fun setMode(phase: TimedPhase, mode: PhaseAlarmMode) {
        prefs.edit().putString(phase.name, mode.name).apply()
    }
}

/** Delivers a short signal after the timer writer has committed the deadline. */
internal class FocusPhaseAlarms(private val context: Context) {
    private val settings = FocusPhaseAlarmSettings(context)
    private val worker by lazy {
        Executors.newSingleThreadScheduledExecutor { Thread(it, "blockcolc-phase-alarm") }
    }
    private val audio = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .apply { if (Build.VERSION.SDK_INT >= 29) setHapticChannelsMuted(true) }.build()
    private var ringtone: Ringtone? = null
    private var stop: ScheduledFuture<*>? = null

    fun deliver(phase: TimedPhase) {
        val mode = settings.mode(phase)
        if (mode == PhaseAlarmMode.OFF) return
        worker.execute {
            stop?.cancel(false)
            stopRingtone()
            if (mode.vibrate) runCatching { vibrate() }
                .onFailure { Log.w("BlockcolcPhaseAlarm", "Vibration unavailable", it) }
            if (mode.ring) runCatching { ring() }
                .onFailure { Log.w("BlockcolcPhaseAlarm", "Alarm sound unavailable", it) }
        }
    }

    private fun ring() {
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        val sound = RingtoneManager.getRingtone(context, uri) ?: return
        sound.audioAttributes = audio
        if (Build.VERSION.SDK_INT >= 28) sound.isLooping = false
        ringtone = sound
        stop = worker.schedule(::stopRingtone, 5, TimeUnit.SECONDS)
        sound.play()
    }

    private fun stopRingtone() {
        val sound = ringtone
        ringtone = null
        if (sound != null) runCatching { sound.stop() }
            .onFailure { Log.w("BlockcolcPhaseAlarm", "Could not stop alarm sound", it) }
    }

    @Suppress("DEPRECATION")
    private fun vibrate() {
        val vibrator = if (Build.VERSION.SDK_INT >= 31) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else context.getSystemService(Vibrator::class.java)
        if (vibrator?.hasVibrator() != true) return
        val pattern = longArrayOf(0, 240, 140, 320)
        when {
            Build.VERSION.SDK_INT >= 33 -> vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1),
                VibrationAttributes.Builder().setUsage(VibrationAttributes.USAGE_ALARM).build())
            Build.VERSION.SDK_INT >= 26 -> vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1), audio)
            else -> vibrator.vibrate(pattern, -1, audio)
        }
    }
}
