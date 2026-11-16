package com.blockcolc.domain

import com.nlf.calendar.Lunar
import java.time.LocalDate

/** Same catalog, three-day windows and calculation family as the formal TS domain. */
object HolidayDates {
    val ids = "new-year spring-festival valentine lantern women nowruz songkran labour africa children dragon-boat us-independence france mid-autumn oktoberfest china-national halloween day-of-dead christmas carnival".split(' ').toSet()
    private val fixed = mapOf("new-year" to "01-01", "valentine" to "02-14", "women" to "03-08", "nowruz" to "03-21", "songkran" to "04-13", "labour" to "05-01", "africa" to "05-25", "children" to "06-01", "us-independence" to "07-04", "france" to "07-14", "china-national" to "10-01", "halloween" to "10-31", "day-of-dead" to "11-01", "christmas" to "12-25")
    private val calculated=object:LinkedHashMap<Pair<String,Int>,LocalDate>(64,.75f,true){override fun removeEldestEntry(eldest:MutableMap.MutableEntry<Pair<String,Int>,LocalDate>)=size>256}
    fun date(id: String, year: Int): LocalDate {
        requireInput(id in ids && year in 100..9999, "$.holidayRewards", "Invalid holiday/year")
        val key=id to year
        synchronized(calculated){calculated[key]?.let{return it}}
        val result=PipelineCost.section("calendar.holiday-date"){calculate(id,year)}
        synchronized(calculated){calculated[key]=result};return result
    }
    // LocalDate is immutable; a hit skips only deterministic catalog/lunar
    // arithmetic, not reward eligibility, ownership, timing or uniqueness.
    private fun calculate(id:String,year:Int):LocalDate {
        fixed[id]?.let { return LocalDate.parse(year.toString().padStart(4, '0') + "-" + it) }
        val lunar = when (id) { "spring-festival" -> 1 to 1; "lantern" -> 1 to 15; "dragon-boat" -> 5 to 5; "mid-autumn" -> 8 to 15; else -> null }
        if (lunar != null) {
            val solar = Lunar.fromYmd(year, lunar.first, lunar.second).solar
            return LocalDate.of(solar.year, solar.month, solar.day)
        }
        if (id == "oktoberfest") {
            val start = LocalDate.of(year, 9, 16); return start.plusDays(((6 - start.dayOfWeek.value % 7 + 7) % 7).toLong())
        }
        val a = year % 19; val b = year / 100; val c = year % 100; val d = b / 4; val e = b % 4
        val f = (b + 8) / 25; val g = (b - f + 1) / 3; val h = (19 * a + b - d - g + 15) % 30
        val i = c / 4; val k = c % 4; val l = (32 + 2 * e + 2 * i - h - k) % 7; val m = (a + 11 * h + 22 * l) / 451
        val v = h + l - 7 * m + 114
        return LocalDate.of(year, v / 31, v % 31 + 1).minusDays(47)
    }
    fun contains(id: String, year: Int, iso: String): Boolean {
        val current = LocalDate.parse(iso)
        // Formal holidaysOnDate cannot build its full catalog below 1000 (an unpadded
        // Oktoberfest intermediate), including year 1000's preceding-year lookup.
        // Do not silently accept historical rewards the existing parser rejects.
        if (current.year <= 1000) return false
        // holidaysOnDate consults only this Gregorian year and the preceding year.
        if (year != current.year && year != current.year - 1) return false
        val first = date(id, year); return current >= first && current <= first.plusDays(2)
    }
    fun onDate(iso: String): List<Pair<String, Int>> {
        val current = LocalDate.parse(DomainTime.date(iso))
        requireInput(current.year > 1000, "$.date", "Formal holiday catalog unavailable for this historical year")
        return listOf(current.year - 1, current.year).flatMap { year -> ids.map { it to year } }
            .filter { (id, year) -> contains(id, year, iso) }
            .sortedWith(compareBy<Pair<String, Int>> { date(it.first, it.second) }.thenBy { ids.indexOf(it.first) })
    }
}
