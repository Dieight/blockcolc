package com.blockcolc.domain

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatterBuilder
import java.util.Locale

internal object JsonChecks {
    /** Successful immutable scalar/grammar results only, with fixed bounds.
     * No JSON object or validation outcome for a whole document is cached. */
    private class BoundedValues<T>(private val maxLength:Int) {
        private val values=object:LinkedHashMap<String,T>(32,.75f,true){override fun removeEldestEntry(eldest:MutableMap.MutableEntry<String,T>)=size>256}
        @Synchronized fun get(key:String):T?=values[key]
        @Synchronized fun put(key:String,value:T){if(key.length<=maxLength)values[key]=value}
    }
    private val grammar=BoundedValues<Set<String>>(1024)
    private val instants=BoundedValues<Long>(32)
    private val dates=BoundedValues<Boolean>(10)
    private val clockZones=BoundedValues<ClockZone>(128)
    const val SAFE = 9007199254740991L
    val nil: Any = JSONObject.NULL
    fun obj(v: Any, p: String): JSONObject {
        requireInput(v is JSONObject, p, "Expected object"); return v as JSONObject
    }
    fun shape(v: Any, p: String, required: String, optional: String = ""): JSONObject =
        shape(v,required.words(),optional.words()){p}
    internal inline fun shape(v:Any,required:Set<String>,optional:Set<String>,path:()->String):JSONObject {
        if(v !is JSONObject)throw StateInputException("INVALID_DOMAIN_STATE",path(),"Expected object")
        var found=0
        val fields=v.keys()
        while(fields.hasNext()){
            val name=fields.next()
            if(name in required)found++
            else if(name !in optional)throw StateInputException("INVALID_DOMAIN_STATE","${path()}.$name","Unknown field")
        }
        if(found<required.size)for(name in required)if(!v.has(name))
            throw StateInputException("INVALID_DOMAIN_STATE","${path()}.$name","Missing field")
        return v
    }
    fun arr(v: Any, p: String): List<Any> {
        requireInput(v is JSONArray, p, "Expected array"); v as JSONArray
        return (0 until v.length()).map { v.get(it) }
    }
    fun objects(v: Any, p: String) = arr(v, p).mapIndexed { i, x -> obj(x, "$p[$i]") }
    fun string(v: Any, p: String): String {
        requireInput(v is String, p, "Expected string"); return v as String
    }
    fun text(v: Any, p: String): String = nonBlank(v){p}
    internal inline fun nonBlank(v:Any,path:()->String):String {
        if(v !is String)throw StateInputException("INVALID_DOMAIN_STATE",path(),"Expected string")
        if(v.none{c->!jsWhitespace(c)})throw StateInputException("INVALID_DOMAIN_STATE",path(),"Expected non-blank string")
        return v
    }
    // ECMAScript String.trim, including BOM but not U+0085 / U+180e.
    fun jsWhitespace(c: Char) = c in "\t\n\u000b\u000c\r \u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff" || c in '\u2000'..'\u200a'
    fun trim(s: String) = s.trim(::jsWhitespace)
    fun nullable(v: Any, p: String): String? = if (v == nil) null else text(v, p)
    fun bool(v: Any, p: String): Boolean { requireInput(v is Boolean, p, "Expected boolean"); return v as Boolean }
    fun int(v: Any, p: String, min: Long = 0, max: Long = SAFE): Long = integer(v,min,max){p}
    internal inline fun integer(v:Any,min:Long=0,max:Long=SAFE,path:()->String):Long {
        if(v !is Number)throw StateInputException("INVALID_DOMAIN_STATE",path(),"Expected safe integer")
        val n=v.toDouble()
        if(!(n.isFinite()&&n==kotlin.math.floor(n)&&n>=min.toDouble()&&n<=max.toDouble()))throw StateInputException("INVALID_DOMAIN_STATE",path(),"Integer out of range")
        return n.toLong()
    }
    fun finite(v: Any, p: String, min: Double, max: Double): Double {
        requireInput(v is Number && v.toDouble().isFinite() && v.toDouble() in min..max, p, "Finite number out of range")
        return (v as Number).toDouble()
    }
    fun choice(v: Any, p: String, allowed: String): String = string(v, p).also { requireInput(it in allowed.words(), p, "Invalid choice") }
    private val instantFormat = DateTimeFormatterBuilder().appendInstant(3).toFormatter(Locale.ROOT)
    fun instant(v: Any, p: String): String = string(v, p).also { raw ->
        if(instants.get(raw)!=null)return@also
        // Stored history nearly always uses this exact wire grammar. One
        // Gregorian date validation is enough; no parse/format round trip.
        canonicalMillis(raw)?.let { instants.put(raw,it);return@also }
        val parsed = try { Instant.parse(raw) } catch (e: Exception) { throw StateInputException("INVALID_DOMAIN_STATE", p, "Invalid instant") }
        val ms = try { parsed.toEpochMilli() } catch (e: ArithmeticException) { throw StateInputException("INVALID_DOMAIN_STATE", p, "Invalid instant") }
        var canonical = instantFormat.format(parsed)
        val year = parsed.atZone(ZoneId.of("UTC")).year
        if (year > 9999) canonical = "+" + year.toString().padStart(6, '0') + canonical.substring(canonical.indexOf('-'))
        if (year < 0) canonical = "-" + (-year).toString().padStart(6, '0') + canonical.substring(canonical.indexOf('-', 1))
        requireInput(kotlin.math.abs(ms) <= 8640000000000000L && raw == canonical, p, "Expected canonical ISO instant")
        instants.put(raw,ms)
    }
    private fun canonicalMillis(raw:String):Long? {
        if(raw.length!=24||raw[4]!='-'||raw[7]!='-'||raw[10]!='T'||raw[13]!=':'||raw[16]!=':'||raw[19]!='.'||raw[23]!='Z')return null
        fun number(start:Int,end:Int):Int {
            var result=0
            for(i in start until end){val digit=raw[i]-'0';if(digit !in 0..9)return -1;result=result*10+digit}
            return result
        }
        val year=number(0,4);val month=number(5,7);val day=number(8,10)
        val hour=number(11,13);val minute=number(14,16);val second=number(17,19);val millis=number(20,23)
        if(year<0||month !in 1..12||day !in 1..31||hour !in 0..23||minute !in 0..59||second !in 0..59||millis<0)return null
        val date=try{LocalDate.of(year,month,day)}catch(_:java.time.DateTimeException){return null}
        return date.toEpochDay()*86_400_000L+hour*3_600_000L+minute*60_000L+second*1000L+millis
    }
    fun millis(v: String) = instants.get(v) ?: Instant.parse(v).toEpochMilli()
    private val datePattern=Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}")
    fun date(v: Any, p: String): String = string(v, p).also { raw ->
        if(dates.get(raw)==true)return@also
        requireInput(datePattern.matches(raw), p, "Expected YYYY-MM-DD")
        val parsed = try { LocalDate.parse(raw) } catch (e: Exception) { throw StateInputException("INVALID_DOMAIN_STATE", p, "Invalid date") }
        requireInput(parsed.year >= 100 && parsed.toString() == raw, p, "Invalid date")
        dates.put(raw,true)
    }
    private val zones by lazy { ZoneId.getAvailableZoneIds().associateBy { it.lowercase(Locale.ROOT) } }
    private val aliases = mapOf("gmt+0" to "UTC", "gmt-0" to "UTC", "cst" to "America/Chicago", "est" to "America/Panama", "mst" to "America/Phoenix", "hst" to "Pacific/Honolulu", "pst" to "America/Los_Angeles", "roc" to "Asia/Taipei")
    private val offsetPattern = Regex("([+-])([0-9]{2})(?::?([0-9]{2}))?")
    private fun offsetMinutes(s: String, p: String): Int? {
        val match = offsetPattern.matchEntire(s) ?: return null
        val h = match.groupValues[2].toInt(); val m = match.groupValues[3].takeIf { it.isNotEmpty() }?.toInt() ?: 0
        requireInput(h <= 23 && m <= 59, p, "Invalid timezone offset")
        return (if (match.groupValues[1] == "-") -1 else 1) * (h * 60 + m)
    }
    private sealed interface ClockZone {
        data class Offset(val minutes:Int):ClockZone
        data class Region(val id:ZoneId):ClockZone
    }
    private fun clockZone(s:String,p:String):ClockZone = clockZones.get(s) ?: run {
        val offset=offsetMinutes(s,p)
        val zone=if(offset!=null)ClockZone.Offset(offset)else ClockZone.Region(zoneId(s,p))
        clockZones.put(s,zone);zone
    }
    fun zone(v: Any, p: String): String = string(v, p).also { clockZone(it,p) }
    private fun zoneId(s: String, p: String): ZoneId {
        val lower = s.lowercase(Locale.ROOT); val id = aliases[lower] ?: zones[lower]
        requireInput(id != null, p, "Expected IANA timezone"); return ZoneId.of(id!!)
    }
    fun localDateTime(at:Instant,zone:String):java.time.LocalDateTime = when(val resolved=clockZone(zone,"$.timeZoneAtStart")){
        is ClockZone.Region->at.atZone(resolved.id).toLocalDateTime()
        is ClockZone.Offset->at.plusSeconds(resolved.minutes*60L).atOffset(java.time.ZoneOffset.UTC).toLocalDateTime()
    }
    fun localDate(s: String, zone: String): String {
        // Validation has usually just proved this exact instant. Reuse the
        // checked epoch; the fallback retains sub-millisecond parsing.
        val at=instants.get(s)?.let(Instant::ofEpochMilli)?:Instant.parse(s)
        val date=localDateTime(at,zone).toLocalDate()
        // Intl's numeric Gregorian year is not padded and uses the positive era year.
        val year = if (date.year <= 0) 1 - date.year else date.year
        return "$year-${date.monthValue.toString().padStart(2, '0')}-${date.dayOfMonth.toString().padStart(2, '0')}"
    }
    fun unique(v: List<Any?>, p: String) = requireInput(v.toSet().size == v.size, p, "Expected unique values")
    fun String.words(): Set<String> = grammar.get(this) ?: java.util.Collections.unmodifiableSet(split(' ').filter { it.isNotEmpty() }.toSet()).also{grammar.put(this,it)}
    fun JSONObject.list(name: String) = arr(get(name), name)
}
