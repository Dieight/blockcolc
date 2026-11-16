package com.blockcolc.world.generation

import java.math.BigDecimal
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt

internal object SourceNumbers {
    fun trim(value:String)=value.trim{c->c in '\u0009'..'\u000d'||c==' '||c=='\u00a0'||c=='\u1680'||c in '\u2000'..'\u200a'||c=='\u2028'||c=='\u2029'||c=='\u202f'||c=='\u205f'||c=='\u3000'||c=='\ufeff'}
    fun fnv32(value:String):Long{var hash=0x811c9dc5.toInt();for(char in value)hash=(hash xor char.code)*0x01000193;return hash.toLong() and 0xffff_ffffL}
    /** Preserve the source engine's scaled two-component accumulation. JVM
     * Math.hypot can differ by one ulp; sorting equidistant scenery candidates
     * with it can move an entire landmark rather than just a numeric epsilon. */
    fun hypot(x:Double,z:Double):Double {
        val a=abs(x);val b=abs(z)
        if(a.isInfinite()||b.isInfinite())return Double.POSITIVE_INFINITY
        val scale=max(a,b);if(scale==0.0)return 0.0
        val u=a/scale;val v=b/scale
        return sqrt(u*u+v*v)*scale
    }
    /** Source deterministic decoration hashes use JS number strings, not the
     * JVM's 1.0 / 1.0E-4 spellings. Coordinates and pose values are finite. */
    fun text(value:Double):String{
        require(value.isFinite());if(value==0.0)return "0"
        val magnitude=abs(value)
        // Most spatial/hash coordinates are small whole numbers. Avoid
        // allocating a BigDecimal per comparator/query without changing the
        // source spelling (only use exact JS safe integers on this path).
        if(magnitude<=9007199254740991.0){val whole=value.toLong();if(whole.toDouble()==value)return whole.toString()}
        if(magnitude>=1e-6&&magnitude<1e21)return BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
        val raw=value.toString().lowercase();val parts=raw.split('e')
        if(parts.size==1)return raw.removeSuffix(".0")
        val exponent=parts[1].toInt()
        return parts[0].removeSuffix(".0")+"e"+(if(exponent>=0)"+"else "")+exponent
    }
    fun quoted(value:String):String=buildString{appendQuoted(this,value)}
    fun appendQuoted(out:StringBuilder,value:String)=with(out){
        append('"');var index=0
        fun escaped(char:Char){append("\\u");append(char.code.toString(16).padStart(4,'0'))}
        while(index<value.length){val char=value[index++]
            when(char){
                '"','\\'->{append('\\');append(char)}
                '\b'->append("\\b");'\u000c'->append("\\f");'\n'->append("\\n");'\r'->append("\\r");'\t'->append("\\t")
                in '\u0000'..'\u001f'->escaped(char)
                in '\ud800'..'\udbff'->{if(index<value.length&&value[index] in '\udc00'..'\udfff'){append(char);append(value[index++])}else escaped(char)}
                in '\udc00'..'\udfff'->escaped(char)
                else->append(char)
            }
        }
        append('"')
    }
}
