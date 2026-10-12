package com.blockcolc.app;
import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.*;
import java.io.IOException;
public class AmbientPcmTest{
    private byte[] wave(){ByteBuffer b=ByteBuffer.allocate(52).order(ByteOrder.LITTLE_ENDIAN);b.putInt(0x46464952).putInt(44).putInt(0x45564157).putInt(0x20746d66).putInt(16).putShort((short)1).putShort((short)1).putInt(22050).putInt(44100).putShort((short)2).putShort((short)16).putInt(0x61746164).putInt(8).putLong(0);return b.array();}
    @Test public void parsesOnlyPcmAndExactFrames()throws Exception{AmbientPcm p=AmbientPcm.parse(wave());assertEquals(22050,p.sampleRate);assertEquals(1,p.channels);assertEquals(4,p.frames);assertEquals(8,p.samples.length);}
    @Test(expected=IOException.class) public void rejectsTruncatedChunk()throws Exception{byte[] w=wave();w[40]=127;AmbientPcm.parse(w);}
    @Test(expected=IOException.class) public void rejectsCompressedCodec()throws Exception{byte[] w=wave();w[20]=3;AmbientPcm.parse(w);}
    @Test(expected=IOException.class) public void rejectsBadChannelCount()throws Exception{byte[] w=wave();w[22]=4;AmbientPcm.parse(w);}
}
