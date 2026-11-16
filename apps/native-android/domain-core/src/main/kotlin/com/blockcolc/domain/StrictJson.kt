package com.blockcolc.domain

import org.erdtman.jcs.NumberToJSON
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest

class StateInputException(val code: String, val path: String, detail: String) : IllegalArgumentException("$path: $detail")
internal fun requireInput(ok: Boolean, path: String, detail: String, code: String = "INVALID_DOMAIN_STATE") {
    if (!ok) throw StateInputException(code, path, detail)
}

/** Strict wire gate. Limits are byte budgets, not the old experiment's 8/32 MiB limits. */
object StrictJson {
    internal class ObjectSpan {var start=-1;var end=-1}
    const val FILE_LIMIT = 100 * 1024 * 1024
    const val EXPANDED_LIMIT = 512 * 1024 * 1024
    private val smallNumbers:Array<Number> = Array(641){(it-128).toDouble()}
    fun decode(bytes: ByteArray, limit: Int = FILE_LIMIT): String {
        requireInput(bytes.size <= limit, "$", "JSON byte budget exceeded", "LIMIT_EXCEEDED")
        return try {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
        } catch (e: java.nio.charset.CharacterCodingException) {
            throw StateInputException("INVALID_JSON", "$", "Invalid UTF-8")
        }
    }
    fun parse(text: String, limit: Int = FILE_LIMIT): Any = PipelineCost.section("json.parse") {
        // Valid UTF-16 uses at most three UTF-8 bytes per code unit. Most
        // bounded inputs need no separate whole-text size scan. The string
        // scanner below validates raw surrogate pairs while already reading.
        requireInput(text.length.toLong()*3<=limit.toLong()||utf8Size(text)<=limit, "$", "JSON byte budget exceeded", "LIMIT_EXCEEDED")
        Gate(text, limit).run()
    }
    internal data class CanonicalInput(val value:Any,val reusable:Boolean)
    internal data class BlueprintHeader(val fields:JSONObject,val voxelCount:Int)
    internal class PlainBlueprintVoxel {
        var buildOrder=0L
        var material=""
        var stage=""
        var sourceBlockId:String?=null
        var emissiveKind:String?=null
        var emissiveLevel:Long?=null
        var x=0L
        var y=0L
        var z=0L
    }
    private val blueprintHeaderKeys=listOf("bounds","id","schemaVersion","title")
    /** A deliberately narrow proof, produced by the strict scanner itself.
     * Whitespace, escapes, non-integer numeric spellings and unsorted keys
     * fall back to the ordinary canonical writer; they remain valid inputs. */
    internal fun parseCanonicalInput(text:String):CanonicalInput = PipelineCost.section("json.parse") {
        requireInput(text.length.toLong()*3<=EXPANDED_LIMIT||utf8Size(text)<=EXPANDED_LIMIT,"$","JSON byte budget exceeded","LIMIT_EXCEEDED")
        val gate=Gate(text,EXPANDED_LIMIT,true)
        CanonicalInput(gate.run(),gate.canonical)
    }
    /** Canonical blueprint cells have a fixed field order. Cells with extra
     * data still use the general scanner and the same traversal budget. */
    internal fun scanCanonicalBlueprint(text:String,checkHeader:(JSONObject)->Unit,checkVoxel:(Any,Int)->Boolean,
        checkPlain:(PlainBlueprintVoxel,Int)->Unit,validStateProperty:(String,String)->Boolean):BlueprintHeader? {
        requireInput(text.length.toLong()*3<=EXPANDED_LIMIT||utf8Size(text)<=EXPANDED_LIMIT,"$","JSON byte budget exceeded","LIMIT_EXCEEDED")
        return Gate(text,EXPANDED_LIMIT,true).scanBlueprint(checkHeader,checkVoxel,checkPlain,validStateProperty)
    }
    // Count without allocating a second full byte array. Reject lone UTF-16 surrogates too.
    fun utf8Size(text: String): Long {
        var size = 0L; var i = 0
        while (i < text.length) {
            val c = text[i++]
            size += when {
                c.code < 0x80 -> 1
                c.code < 0x800 -> 2
                c.isHighSurrogate() -> {
                    requireInput(i < text.length && text[i++].isLowSurrogate(), "$", "Lone surrogate", "INVALID_JSON"); 4
                }
                c.isLowSurrogate() -> throw StateInputException("INVALID_JSON", "$", "Lone surrogate")
                else -> 3
            }
        }
        return size
    }
    fun render(value: Any): String = renderTracked(value,null)
    internal fun renderTracked(value:Any,spans:java.util.IdentityHashMap<JSONObject,ObjectSpan>?,rootFields:MutableMap<String,ObjectSpan>?=null,capacityHint:Int=16,
                               canonicalBodies:java.util.IdentityHashMap<JSONObject,String>?=null,bodySegments:MutableList<String>?=null):String=PipelineCost.section("json.render") {
        val hint=capacityHint.coerceIn(16,16*1024*1024)
        // A large capacity hint is an estimate, not a prevalidated length.
        // One page of slack avoids doubling the entire buffer at its tail;
        // tiny JSON values keep their existing small allocation.
        val capacity=when{
            bodySegments!=null->minOf(hint,128*1024)
            hint>=256*1024->((hint+4095)and -4096).coerceAtMost(16*1024*1024)
            else->hint
        }
        val out = StringBuilder(capacity)
        var prefixLength=0
        fun position()=Math.addExact(prefixLength,out.length)
        fun appendBody(wire:String){
            if(bodySegments==null||wire.length<8192){out.append(wire);return}
            PipelineCost.section("json.retain-blueprint"){
                if(out.isNotEmpty())bodySegments.add(out.toString())
                prefixLength=Math.addExact(position(),wire.length)
                out.setLength(0)
                bodySegments.add(wire)
            }
        }
        spans?.values?.forEach{it.start=-1;it.end=-1}
        val quoted=HashMap<String,String>()
        fun quote(s: String) {
            quoted[s]?.let{out.append(it);return}
            val start=out.length
            utf8Size(s)
            out.append('"')
            for (c in s) when (c) {
                '"' -> out.append("\\\""); '\\' -> out.append("\\\\"); '\b' -> out.append("\\b")
                '\u000c' -> out.append("\\f"); '\n' -> out.append("\\n"); '\r' -> out.append("\\r"); '\t' -> out.append("\\t")
                else -> if (c < ' ') out.append("\\u00").append("0123456789abcdef"[c.code shr 4]).append("0123456789abcdef"[c.code and 15]) else out.append(c)
            }
            out.append('"')
            if(s.length<=96&&quoted.size<256)quoted[s]=out.substring(start,out.length)
        }
        fun emit(v: Any) {
            when (v) {
                JSONObject.NULL -> out.append("null")
                is JSONObject -> {
                    val span=spans?.get(v);val start=if(span!=null)position()else -1
                    // Repeated immutable blueprint bodies share an owned
                    // object. Their first exact serialization is reusable;
                    // every owner still gets the complete body in its wire.
                    if(span!=null&&span.start>=0){
                        if(bodySegments!=null)appendBody(checkNotNull(canonicalBodies?.get(v)))
                        else out.append(out,span.start,span.end)
                        return
                    }
                    canonicalBodies?.get(v)?.let{wire->
                        PipelineCost.section("json.reuse-blueprint"){appendBody(wire)}
                        if(span!=null){span.start=start;span.end=position()}
                        return
                    }
                    out.append('{')
                    val iterator=v.keys();var ordered=true;var previous:String?=null
                    while(iterator.hasNext()){
                        val key=iterator.next();if(previous!=null&&previous>key){ordered=false;break}
                        previous=key
                    }
                    // Stored canonical objects already enumerate in key
                    // order on Android. Avoid one list/backing array per
                    // voxel, while retaining sorting for all other inputs.
                    val keys=if(ordered)v.keys()else{
                        val sorted=ArrayList<String>(v.length());val source=v.keys()
                        while(source.hasNext())sorted.add(source.next())
                        sorted.sort();sorted.iterator()
                    }
                    var count=0
                    while(keys.hasNext()){val k=keys.next()
                        if (count++ > 0) out.append(','); quote(k); out.append(':')
                        val field=if(v===value&&rootFields!=null)ObjectSpan().also{it.start=position();rootFields[k]=it}else null
                        emit(v.get(k));if(field!=null)field.end=position()
                    }
                    out.append('}')
                    if(span!=null&&span.start<0){span.start=start;span.end=position()}
                }
                is JSONArray -> {
                    out.append('['); for (i in 0 until v.length()) { if (i > 0) out.append(','); emit(v.get(i)) }; out.append(']')
                }
                is String -> quote(v)
                is Boolean -> out.append(v)
                is Number -> {
                    val n = v.toDouble(); requireInput(n.isFinite(), "$", "Non-finite number", "INVALID_JSON")
                    if (n == kotlin.math.floor(n) && kotlin.math.abs(n) <= 9007199254740991.0) out.append(n.toLong())
                    else out.append(NumberToJSON.serializeNumber(n))
                }
                else -> throw StateInputException("INVALID_JSON", "$", "Unknown JSON value")
            }
        }
        emit(value); out.toString()
    }
    /** Encoded size without first allocating an archive-sized UTF-8 byte array/string. */
    fun measure(value: Any): Long {
        val memo = java.util.IdentityHashMap<Any, Long>()
        fun quoted(s: String): Long = utf8Size(s) + 2 + s.sumOf { c -> when (c) {
            '"', '\\', '\b', '\u000c', '\n', '\r', '\t' -> 1L
            else -> if (c < ' ') 5L else 0L
        } }
        fun count(v: Any, depth: Int): Long {
            requireInput(depth <= 96, "$", "JSON traversal depth exceeded", "LIMIT_EXCEEDED")
            memo[v]?.let { return it }
            val size = when (v) {
                JSONObject.NULL -> 4L
                is String -> quoted(v)
                is Boolean -> if (v) 4L else 5L
                is Number -> render(v).length.toLong()
                is JSONArray -> 2L + maxOf(0, v.length() - 1) + (0 until v.length()).sumOf { count(v.get(it), depth + 1) }
                is JSONObject -> { val keys = v.keys().asSequence().toList(); 2L + maxOf(0, keys.size - 1) + keys.sumOf { quoted(it) + 1L + count(v.get(it), depth + 1) } }
                else -> throw StateInputException("INVALID_JSON", "$", "Unknown JSON value")
            }
            if ((v is JSONObject || v is JSONArray) && memo.size < 2048) memo[v] = size
            return size
        }
        return count(value, 0)
    }
    fun sha(text: String): String = PipelineCost.section("json.sha") { DigestHex.encode(MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))) }
    fun copy(value: Any): Any = PipelineCost.section("json.copy") { copyTree(value) }
    private fun copyTree(value: Any): Any = when (value) {
        is JSONObject -> JSONObject().also { copy -> value.keys().forEach { k -> copy.put(k, copyTree(value.get(k))) } }
        is JSONArray -> JSONArray().also { copy -> for (i in 0 until value.length()) copy.put(copyTree(value.get(i))) }
        // JSONObject also accepts mutable Number implementations (AtomicLong,
        // user subclasses). Retained snapshots must not borrow those aliases.
        // The strict wire parser uses binary64 numbers as well.
        is Number -> value.toDouble()
        else -> value
    }
    private class Gate(val input: String, val limit: Int,private val checkCanonical:Boolean=false) {
        var at = 0; var nodes = 0
        var canonical=checkCanonical;private set
        // Per decode only: repeated voxel keys/material names share immutable
        // strings. Bounded size/probing also keeps hostile unique inputs cheap.
        private val strings=if(input.length>=512)arrayOfNulls<String>(512)else null
        private var stringCount=0
        private var previousStateStart=-1
        private var previousStateLength=0
        private var previousStateNodes=0
        private fun span(begin:Int,end:Int,hash:Int):String {
            val length=end-begin
            if(length<=96&&strings!=null){
                var slot=hash and 511
                repeat(8){
                    val known=strings[slot]
                    if(known==null){
                        val value=input.substring(begin,end)
                        if(stringCount<256){strings[slot]=value;stringCount++}
                        return value
                    }
                    if(known.length==length&&input.regionMatches(begin,known,0,length))return known
                    slot=(slot+1)and 511
                }
            }
            return input.substring(begin,end)
        }
        fun fail(detail: String): Nothing = throw StateInputException("INVALID_JSON", "@$at", detail)
        fun ws() {
            while(at<input.length)when(input[at]){
                ' ','\r','\n','\t'->{canonical=false;at++}
                else->return
            }
        }
        fun take(c: Char): Boolean {
            if (at < input.length && input[at] == c) { at++; return true }
            ws()
            if (at < input.length && input[at] == c) { at++; return true }
            return false
        }
        fun expect(c: Char) { if (!take(c)) fail("Expected $c") }
        fun run(): Any { val result = value(0); ws(); if (at != input.length) fail("Trailing content"); return result }
        fun scanBlueprint(checkHeader:(JSONObject)->Unit,checkVoxel:(Any,Int)->Boolean,
            checkPlain:(PlainBlueprintVoxel,Int)->Unit,validStateProperty:(String,String)->Boolean):BlueprintHeader? {
            if(!take('{')||!canonical)return null
            countNode(0)
            fun key(name:String)=at<input.length&&input[at]=='"'&&string()==name&&take(':')&&canonical
            val header=JSONObject()
            for(name in blueprintHeaderKeys){
                if(!key(name))return null
                header.put(name,value(1))
                if(!take(',')||!canonical)return null
            }
            if(!key("voxels")||!take('[')||!canonical)return null
            countNode(1)
            checkHeader(header)
            var count=0
            if(!take(']')){
                val plain=PlainBlueprintVoxel()
                do{
                    if(!canonical)return null
                    val start=at;val startNodes=nodes
                    if(readPlainVoxel(plain,validStateProperty))checkPlain(plain,count)
                    else {
                        at=start;nodes=startNodes;canonical=true
                        val voxel=value(2)
                        if(!canonical||!checkVoxel(voxel,count))return null
                    }
                    count++
                }while(take(','))
                if(!take(']'))return null
            }
            if(!take('}')||at!=input.length||!canonical)return null
            return BlueprintHeader(header,count)
        }
        private fun fixed(token:String):Boolean {
            if(!input.startsWith(token,at))return false
            at+=token.length
            return true
        }
        private fun plainString(depth:Int,previous:String?=null):String? {
            if(at>=input.length||input[at]!='"')return null
            countNode(depth)
            // An exact unescaped spelling from this scanner still owns the
            // same token. Check the closing quote to exclude a longer prefix.
            if(previous!=null&&previous.length in 1..96){
                val end=at+1+previous.length
                if(end<input.length&&input[end]=='"'&&input.regionMatches(at+1,previous,0,previous.length)){
                    at=end+1
                    return previous
                }
            }
            val text=string()
            return if(canonical)text else null
        }
        private fun plainInteger():Long {
            countNode(3)
            val negative=fixed("-")
            if(at>=input.length||input[at] !in '0'..'9')return Long.MIN_VALUE
            if(input[at]=='0'){
                at++
                return if(negative)Long.MIN_VALUE else 0L
            }
            val start=at
            val maximumDigits=if(negative)14 else 15
            var magnitude=0L
            while(at<input.length&&input[at] in '0'..'9'){
                // Keep the same short integer subset as the canonical lexer.
                if(at-start>=maximumDigits)return Long.MIN_VALUE
                magnitude=magnitude*10+(input[at++]-'0')
            }
            return if(negative)-magnitude else magnitude
        }
        private fun plainState(validProperty:(String,String)->Boolean):Boolean {
            val start=at
            if(previousStateStart>=0&&input.regionMatches(start,input,previousStateStart,previousStateLength)){
                countNode(4,previousStateNodes)
                at+=previousStateLength
                return true
            }
            val before=nodes
            if(!fixed("{"))return false
            countNode(3)
            var previous:String?=null
            var count=0
            do{
                if(++count>32||at>=input.length||input[at]!='"')return false
                val key=string()
                if(!canonical||previous!=null&&previous>=key||!fixed(":"))return false
                val property=plainString(4)?:return false
                if(!validProperty(key,property))return false
                previous=key
            }while(fixed(","))
            if(!fixed("}"))return false
            previousStateStart=start
            previousStateLength=at-start
            previousStateNodes=nodes-before
            return true
        }
        private fun readPlainVoxel(voxel:PlainBlueprintVoxel,validStateProperty:(String,String)->Boolean):Boolean {
            if(!fixed("{\"buildOrder\":"))return false
            countNode(2)
            voxel.buildOrder=plainInteger()
            if(voxel.buildOrder==Long.MIN_VALUE||!fixed(","))return false
            voxel.emissiveKind=if(fixed("\"emissiveKind\":")){
                val kind=plainString(3,voxel.emissiveKind)?:return false
                if(!fixed(","))return false
                kind
            }else null
            voxel.emissiveLevel=null
            if(fixed("\"emissiveLevel\":")){
                val level=plainInteger()
                if(level==Long.MIN_VALUE||!fixed(","))return false
                voxel.emissiveLevel=level
            }
            if(!fixed("\"materialId\":"))return false
            voxel.material=plainString(3,voxel.material)?:return false
            if(!fixed(","))return false
            voxel.sourceBlockId=if(fixed("\"sourceBlockId\":")){
                val id=plainString(3,voxel.sourceBlockId)?:return false
                if(!fixed(","))return false
                id
            }else null
            if(fixed("\"sourceBlockState\":")&&(!plainState(validStateProperty)||!fixed(",")))return false
            if(!fixed("\"stage\":"))return false
            voxel.stage=plainString(3,voxel.stage)?:return false
            if(!fixed(",\"x\":"))return false
            voxel.x=plainInteger()
            if(voxel.x==Long.MIN_VALUE||!fixed(",\"y\":"))return false
            voxel.y=plainInteger()
            if(voxel.y==Long.MIN_VALUE||!fixed(",\"z\":"))return false
            voxel.z=plainInteger()
            return voxel.z!=Long.MIN_VALUE&&fixed("}")
        }
        private fun countNode(depth:Int,count:Int=1){
            // At least one input byte per node; finite depth prevents stack exhaustion.
            nodes+=count
            if(depth>96||nodes>limit)
                throw StateInputException("LIMIT_EXCEEDED","@$at","JSON traversal budget exceeded")
        }
        fun value(depth: Int): Any {
            countNode(depth)
            ws(); if (at >= input.length) fail("Unexpected end")
            return when (input[at]) {
                '{' -> {
                    at++; val result = JSONObject()
                    if (take('}')) return result
                    var previous:String?=null
                    do { ws(); if (at >= input.length || input[at] != '"') fail("Expected key")
                        val k = string()
                        if(canonical){
                            // Sorted keys can only repeat their predecessor.
                            // If ordering breaks, use the full duplicate check
                            // for this key and the rest of the input.
                            val order=previous?.compareTo(k)?:-1
                            if(order==0)fail("Duplicate key")
                            if(order>0){
                                canonical=false
                                if(result.has(k))fail("Duplicate key")
                            }
                        }else if(result.has(k))fail("Duplicate key")
                        previous=k
                        expect(':'); result.put(k, value(depth + 1))
                    } while (take(',')); expect('}'); result
                }
                '[' -> { at++; val result = JSONArray(); if (take(']')) return result
                    do { result.put(value(depth + 1)) } while (take(',')); expect(']'); result }
                '"' -> string()
                't' -> { literal("true"); true }; 'f' -> { literal("false"); false }; 'n' -> { literal("null"); JSONObject.NULL }
                else -> number()
            }
        }
        fun literal(s: String) { if (!input.startsWith(s, at)) fail("Invalid literal"); at += s.length }
        fun number(): Number {
            val start=at
            val negative=input[at]=='-'
            if(negative)at++
            if (at >= input.length) fail("Missing number")
            var magnitude=0L
            if(input[at]=='0')at++ else {
                if(input[at] !in '1'..'9')fail("Invalid number")
                // Only short, whole numbers use this accumulator. Longer
                // forms go through the same binary64 parser as before.
                do {
                    magnitude=magnitude*10+(input[at]-'0')
                    at++
                }while(at<input.length&&input[at] in '0'..'9')
            }
            val integerEnd=at
            if (at < input.length && input[at] == '.') { at++; val n = at; while (at < input.length && input[at] in '0'..'9') at++; if (n == at) fail("Missing fraction") }
            if (at < input.length && input[at] in "eE") { at++; if (at < input.length && input[at] in "+-") at++; val n = at; while (at < input.length && input[at] in '0'..'9') at++; if (n == at) fail("Missing exponent") }
            if(at==integerEnd&&at-start<=15){
                if(negative&&magnitude==0L){canonical=false;return -0.0}
                val signed=if(negative)-magnitude else magnitude
                if(signed in -128L..512L)return smallNumbers[signed.toInt()+128]
                return signed.toDouble()
            }
            // The scanner above has already enforced JSON's numeric grammar.
            // Kotlin's nullable conversion rechecks it with an ICU regex for
            // every voxel coordinate on Android. Keep the same binary64 and
            // finite-value checks without that second grammar pass.
            canonical=false
            val number = try { java.lang.Double.parseDouble(input.substring(start, at)) }
                catch (_: NumberFormatException) { fail("Non-finite number") }
            return number.takeIf { it.isFinite() } ?: fail("Non-finite number")
        }
        fun string(): String {
            // Both callers already checked the opening quote at this index.
            val begin=++at;var end=at;var hash=0
            while(end<input.length){
                val c=input[end]
                if(c=='"'){at=end+1;return span(begin,end,hash)}
                if(c=='\\'){canonical=false;break}
                if(c<' ')fail("Control character")
                if(c in '\ud800'..'\udfff'){
                    if(!c.isHighSurrogate()||end+1>=input.length||!input[end+1].isLowSurrogate())fail("Lone surrogate")
                    hash=31*hash+c.code;hash=31*hash+input[end+1].code;end+=2;continue
                }
                hash=31*hash+c.code;end++
            }
            // Validate raw source pairs separately from decoded escapes:
            // an escaped high half cannot legalize a raw lone low half.
            val out = StringBuilder(); var closed = false
            while (at < input.length) {
                var c = input[at++]; if (c == '"') { closed = true; break }; if (c < ' ') fail("Control character")
                if (c == '\\') {
                    if (at >= input.length) fail("Missing escape")
                    c = when (val e = input[at++]) {
                        '"', '\\', '/' -> e; 'b' -> '\b'; 'f' -> '\u000c'; 'n' -> '\n'; 'r' -> '\r'; 't' -> '\t'
                        'u' -> { if (at + 4 > input.length) fail("Missing Unicode escape")
                            val hex = input.substring(at, at + 4); if (!hex.all { it in "0123456789abcdefABCDEF" }) fail("Invalid escape"); at += 4; hex.toInt(16).toChar() }
                        else -> fail("Invalid escape")
                    }
                }else if(c in '\ud800'..'\udfff'){
                    if(!c.isHighSurrogate()||at>=input.length||!input[at].isLowSurrogate())fail("Lone surrogate")
                    out.append(c);out.append(input[at++]);continue
                }
                out.append(c)
            }
            if (!closed) fail("Unterminated string")
            return out.toString().also { utf8Size(it) }
        }
    }
}
