package com.blockcolc.domain

/** Lowercase digest encoding without creating a Formatter for every byte. */
object DigestHex {
    fun encode(bytes:ByteArray):String {
        val digits="0123456789abcdef";val result=CharArray(bytes.size*2)
        for(i in bytes.indices){val value=bytes[i].toInt() and 255;result[i*2]=digits[value ushr 4];result[i*2+1]=digits[value and 15]}
        return String(result)
    }
}
