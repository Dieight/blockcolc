package com.blockcolc.domain

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.IdentityHashMap

class CanonicalRenderingTest {
    @Test fun fastTokenTraversalKeepsNumericBitsAndReportsTheFirstInvalidDepth(){
        val numbers=listOf("0","-0","512","-129","999999999999999","-99999999999999","9007199254740991",
            "123456789012345678901234567890","1e-324","1.5e-3","-0.0","-0e12")
        for(wire in numbers){
            val number=StrictJson.parse(wire) as Number
            assertEquals(wire,wire.toDouble().toRawBits(),number.toDouble().toRawBits())
        }
        val nested="[".repeat(97)+"0"+"]".repeat(97)
        val budget=assertThrows(StateInputException::class.java){StrictJson.parse(nested)}
        assertEquals("LIMIT_EXCEEDED",budget.code)
        assertEquals("@97",budget.path)
        for(wire in listOf("-","-01","1.","1e+","1e400","1\u000b")){
            assertEquals("INVALID_JSON",assertThrows(StateInputException::class.java){StrictJson.parse(wire)}.code)
        }
    }
    @Test fun scannerOnlyCertifiesExactCanonicalSpellingsAndStillRejectsInvalidWire(){
        for(wire in listOf("{}","[]","{\"a\":-12,\"b\":[0,512,999999999999999,true,null,\"汉字😀\"]}")){
            val parsed=StrictJson.parseCanonicalInput(wire)
            assertTrue(wire,parsed.reusable);assertEquals(wire,StrictJson.render(parsed.value))
        }
        for(wire in listOf(" {}","{}\n","[ 0]","{\"b\":0,\"a\":1}","[-0]","[1.0]","[1e0]","[1000000000000000]","[\"\\u0061\"]","[\"a\\nb\"]","[\"\\/\"]")){
            assertFalse(wire,StrictJson.parseCanonicalInput(wire).reusable)
        }
        for(wire in listOf("{\"a\":1,\"a\":2}","{\"a\":1,\"b\":2,\"a\":3}","{\"a\":{\"b\":0,\"a\":1},\"a\":2}","[01]","[1,]","[\"\ud800\"]","{}x")){
            assertThrows(wire,StateInputException::class.java){StrictJson.parseCanonicalInput(wire)}
        }
    }
    @Test fun repeatedEscapedStringsAndUnicodeKeepTheExactCanonicalWire(){
        val word="汉字😀\n\"\\\u0001"
        val row=JSONObject().put("b",word).put("a",word)
        val expected="{\"a\":\"汉字😀\\n\\\"\\\\\\u0001\",\"b\":\"汉字😀\\n\\\"\\\\\\u0001\"}"
        assertEquals(expected,StrictJson.render(row))
        val many=JSONArray();repeat(1000){many.put(row)}
        assertEquals((0 until 1000).joinToString(",","[","]"){expected},StrictJson.render(many))
        assertThrows(StateInputException::class.java){StrictJson.render(JSONArray().put("same").put("same").put("bad\ud800"))}
    }
    @Test fun sharedTrackedBodiesRetainCompleteCopiesAndCurrentSpansAcrossRenders(){
        val shared=JSONObject().put("title","玻璃窗😀").put("voxels",JSONArray().put(JSONObject().put("x",1).put("y",2).put("z",3)))
        val bodies=IdentityHashMap<JSONObject,StrictJson.ObjectSpan>();val span=StrictJson.ObjectSpan();bodies[shared]=span
        val exact=StrictJson.render(shared);val input=JSONArray().put(shared).put(shared)
        repeat(2){val text=StrictJson.renderTracked(input,bodies)
            assertEquals("[$exact,$exact]",text);assertEquals(exact,text.substring(span.start,span.end))
            assertEquals(2,(StrictJson.parse(text) as JSONArray).length())
        }
    }
    @Test fun byteBoundsAndBothRawAndEscapedSurrogateChecksSurviveTheFastSizeGate(){
        for(value in listOf("ascii","汉字","😀","😀\n汉字","x".repeat(4096))){
            val wire=StrictJson.render(value);val bytes=wire.toByteArray(Charsets.UTF_8).size
            assertEquals(value,StrictJson.parse(wire,bytes))
            assertEquals(value,StrictJson.parse(wire,100000))
            val error=assertThrows(StateInputException::class.java){StrictJson.parse(wire,bytes-1)}
            assertEquals("LIMIT_EXCEEDED",error.code)
        }
        val broken=listOf("\"\ud800\"","\"\udc00\"","\"x\ud800x\"","\"\ud800\\udc00\"","\"\\ud800\udc00\"","\"\\ud800x\"","[\ud800]","true\udc00")
        for(wire in broken){val error=assertThrows(StateInputException::class.java){StrictJson.parse(wire,100000)};assertEquals("INVALID_JSON",error.code)}
        assertEquals("😀",StrictJson.parse("\"\\ud83d\\ude00\"",100000))
    }
}
