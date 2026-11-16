package com.blockcolc.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** Wire/time rules shared by commands, backups and the persisted scheduler. */
object DomainTime {
    private val instantFormat=java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter()
    fun instant(value: String): String = JsonChecks.instant(value, "$.instant")
    fun format(epochMs: Long): String {
        val at = Instant.ofEpochMilli(epochMs)
        val year = at.atOffset(ZoneOffset.UTC).year
        var result = instantFormat.format(at)
        if (year > 9999) result = "+" + year.toString().padStart(6, '0') + result.substring(result.indexOf('-'))
        if (year < 0) result = "-" + (-year).toString().padStart(6, '0') + result.substring(result.indexOf('-', 1))
        return instant(result)
    }
    fun millis(value: String): Long = JsonChecks.millis(instant(value))
    fun date(value: String): String = JsonChecks.date(value, "$.date")
    fun zone(value: String): String = JsonChecks.zone(value, "$.timeZone")
    fun localDate(value: String, zone: String): String = JsonChecks.localDate(instant(value), zone(zone))
    fun localDateTime(epochMs:Long,zone:String):java.time.LocalDateTime=JsonChecks.localDateTime(Instant.ofEpochMilli(epochMs),zone(zone))
    fun addDays(date: String, days: Long): String = LocalDate.parse(date(date)).plusDays(days).toString()
}
