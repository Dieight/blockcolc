package com.blockcolc.world.resource

import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.concurrent.CancellationException

/** External assets do not use Android's permissive JSONTokener syntax. This
 * boundary has independent depth/node limits and never enters domain storage. */
internal object ResourceJson {
    fun text(bytes:ByteArray):String=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString().removePrefix("\uFEFF")
    fun parse(bytes:ByteArray,cancelled:()->Boolean={false}):Any=Gate(text(bytes),cancelled).run()
    fun objectValue(bytes:ByteArray,cancelled:()->Boolean={false}):JSONObject=parse(bytes,cancelled) as? JSONObject
        ?:throw IllegalArgumentException("Expected a JSON object")
    private class Gate(val input:String,val cancelled:()->Boolean){
        var at=0;var nodes=0
        fun fail():Nothing=throw IllegalArgumentException("Invalid asset JSON at $at")
        fun ws(){while(at<input.length&&input[at] in " \r\n\t")at++}
        fun take(c:Char):Boolean{ws();if(at<input.length&&input[at]==c){at++;return true};return false}
        fun expect(c:Char){if(!take(c))fail()}
        fun run():Any{val v=value(0);ws();if(at!=input.length)fail();return v}
        fun value(depth:Int):Any{
            require(depth<=64&&++nodes<=524288){"Asset JSON traversal budget"}
            if(nodes%256==1)checkpoint(cancelled)
            ws();if(at>=input.length)fail()
            return when(input[at]){
                '{'->{at++;val v=JSONObject();if(take('}'))return v
                    do{ws();if(at>=input.length||input[at]!='"')fail();val key=string();expect(':');v.put(key,value(depth+1))}while(take(','));expect('}');v}
                '['->{at++;val v=JSONArray();if(take(']'))return v
                    do{v.put(value(depth+1))}while(take(','));expect(']');v}
                '"'->string();'t'->{literal("true");true};'f'->{literal("false");false};'n'->{literal("null");JSONObject.NULL}
                else->number()
            }
        }
        fun literal(s:String){if(!input.startsWith(s,at))fail();at+=s.length}
        fun number():Double{
            val start=at;if(at<input.length&&input[at]=='-')at++;if(at>=input.length)fail()
            if(input[at]=='0')at++ else{if(input[at] !in '1'..'9')fail();while(at<input.length&&input[at] in '0'..'9')at++}
            if(at<input.length&&input[at]=='.'){at++;val n=at;while(at<input.length&&input[at] in '0'..'9')at++;if(at==n)fail()}
            if(at<input.length&&input[at] in "eE"){at++;if(at<input.length&&input[at] in "+-")at++;val n=at;while(at<input.length&&input[at] in '0'..'9')at++;if(at==n)fail()}
            return input.substring(start,at).toDoubleOrNull()?.takeIf{it.isFinite()}?:fail()
        }
        fun string():String{
            expect('"');val out=StringBuilder();var closed=false
            while(at<input.length){if(at%8192==0)checkpoint(cancelled);var c=input[at++];if(c=='"'){closed=true;break};if(c<' ')fail()
                if(c=='\\'){if(at>=input.length)fail();c=when(val e=input[at++]){
                    '"','\\','/'->e;'b'->'\b';'f'->'\u000c';'n'->'\n';'r'->'\r';'t'->'\t'
                    'u'->{if(at+4>input.length)fail();val hex=input.substring(at,at+4);if(!hex.all{it in "0123456789abcdefABCDEF"})fail();at+=4;hex.toInt(16).toChar()}
                    else->fail()
                }};out.append(c)
            };if(!closed)fail();return out.toString()
        }
    }
}

internal fun checkpoint(cancelled:()->Boolean){if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Resource preparation superseded")}
