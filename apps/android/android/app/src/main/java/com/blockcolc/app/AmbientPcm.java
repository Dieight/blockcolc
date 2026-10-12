package com.blockcolc.app;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;

/** Strict reader for our bundled PCM assets, never for user-imported codecs. */
final class AmbientPcm {
    final int sampleRate, channels, frames;
    final byte[] samples;
    private AmbientPcm(int rate,int channels,byte[] samples){this.sampleRate=rate;this.channels=channels;this.samples=samples;this.frames=samples.length/(channels*2);}
    static AmbientPcm parse(byte[] wav)throws IOException{
        if(wav.length<44||wav.length>8*1024*1024)throw new IOException("Invalid PCM size");
        ByteBuffer b=ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);
        if(b.getInt(0)!=0x46464952||b.getInt(8)!=0x45564157)throw new IOException("Not WAV");
        int rate=0,channels=0,start=-1,length=0;
        for(int offset=12;offset+8<=wav.length;){
            int kind=b.getInt(offset),size=b.getInt(offset+4),content=offset+8;
            if(size<0||size>wav.length-content)throw new IOException("Truncated WAV chunk");
            if(kind==0x20746d66){
                if(size<16||b.getShort(content)!=1||b.getShort(content+14)!=16)throw new IOException("Expected PCM16");
                channels=b.getShort(content+2);rate=b.getInt(content+4);
            }else if(kind==0x61746164){start=content;length=size;}
            offset=content+size+(size&1);
        }
        if((channels!=1&&channels!=2)||rate<8000||rate>48000||start<0||length<=0||length%(channels*2)!=0)throw new IOException("Invalid PCM format");
        return new AmbientPcm(rate,channels,Arrays.copyOfRange(wav,start,start+length));
    }
}
