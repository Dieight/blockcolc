"""Offline field-recording processing. Originals are never rewritten.

Requires numpy, scipy and imageio-ffmpeg (install into an ignored tools folder).
Only the derived PCM files are runtime dependencies; builds do not run this.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import wave

import numpy as np
from scipy import signal
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
RATE = 32000


def decode(path):
    process = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-i', str(path),
                              '-f', 'f32le', '-ac', '1', '-ar', str(RATE), 'pipe:1'],
                             check=True, capture_output=True)
    return np.frombuffer(process.stdout, dtype='<f4').copy()


def loop_crossfade(samples, seconds=2.5):
    # The last overlap approaches the sample immediately before the first
    # output sample. Equal-power mixing avoids a perceived dip in ambience.
    size = min(round(seconds * RATE), len(samples) // 5)
    result = samples[size:].copy()
    amount = np.linspace(0, 1, size, endpoint=False)
    result[-size:] = result[-size:] * np.cos(amount * np.pi/2) + samples[:size] * np.sin(amount * np.pi/2)
    return result


def band_rms(samples, low, high):
    filtered = signal.sosfilt(signal.butter(3, [low, high], 'bandpass', fs=RATE, output='sos'), samples)
    return float(np.sqrt(np.mean(filtered**2)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inspect', action='store_true')
    args = parser.parse_args()
    source = ROOT / 'artifacts' / 'sounds'
    output = ROOT / 'apps' / 'web' / 'public' / 'audio'
    report_dir = ROOT / 'artifacts' / 'sounds' / 'processed'
    report_dir.mkdir(parents=True, exist_ok=True)
    # Lakeside was retired after listening feedback. Its original and previous
    # derived file are archived; this tool must not put it back in the APK.
    specs = [('morning-birdsong', source / '晨间鸟鸣.mp3', .25, 21.5),
             ('rain', source / 'rain-ezwa-original.ogg', .3, None)]
    report = []
    for name, path, start, end in specs:
        if not path.exists() and args.inspect:
            continue
        original = decode(path)
        if args.inspect:
            # A per-second band table helps locate the late scooter alarm and
            # document the segment excluded, without sending private recordings.
            table = []
            for second in range(int(len(original)/RATE)):
                part = original[second*RATE:(second+1)*RATE]
                table.append([second, *[round(band_rms(part,lo,hi),5) for lo,hi in [(80,500),(500,1800),(1800,4500),(4500,10000)]]])
            print(json.dumps({'name':name,'duration':len(original)/RATE,'bands':table}))
            from PIL import Image, ImageDraw
            freqs,times,values=signal.spectrogram(original,fs=RATE,nperseg=1024,noverlap=768)
            db=20*np.log10(np.maximum(np.sqrt(values[freqs<=8000]),1e-9))
            intensity=np.clip((db+105)/65,0,1)
            colors=np.stack([intensity**.6,intensity**1.6,intensity**3],axis=-1)
            pixels=(colors[::-1]*255).astype('uint8')
            plot=Image.fromarray(pixels).resize((1200,400))
            page=Image.new('RGB',(1240,460),'white');page.paste(plot,(20,20));draw=ImageDraw.Draw(page)
            draw.text((20,430),f'{name}: 0 to {len(original)/RATE:.2f} seconds; 8 kHz top / 0 bottom',fill='black')
            for second in range(0,int(len(original)/RATE),5):
                x=20+round(second/(len(original)/RATE)*1200);draw.text((x,410),str(second),fill='black')
            page.save(report_dir/f'{name}-source-spectrum.png')
            continue
        clip = original[int(start*RATE):int(end*RATE) if end else None]
        processed = signal.sosfiltfilt(signal.butter(2, 150 if name=='rain' else 350, 'highpass', fs=RATE, output='sos'),clip).astype(np.float32)
        low_reduction = 20*np.log10(max(band_rms(processed,80,500),1e-9)/max(band_rms(clip,80,500),1e-9))
        processed = loop_crossfade(processed,2.5 if name!='morning-birdsong' else 1.5)
        # Matched listening level with conservative peak headroom; do not
        # normalize a residual hum back to full volume.
        rms = float(np.sqrt(np.mean(processed**2)))
        gain = min(.055/max(rms,1e-9), .62/max(float(np.max(np.abs(processed))),1e-9))
        pcm = np.round(np.clip(processed*gain,-.98,.98)*32767).astype('<i2')
        destination=output/f'{name}.wav'
        output.mkdir(parents=True,exist_ok=True)
        with wave.open(str(destination),'wb') as stream:
            stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(RATE);stream.writeframes(pcm.tobytes())
        report.append({'name':name,'source':path.name,'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                       'sourceDurationSeconds':len(original)/RATE,'retainedSourceSeconds':[start,end or len(original)/RATE],
                       'loopSeconds':len(pcm)/RATE,'sampleRate':RATE,'channels':1,'bits':16,
                       'lowBandReductionDbBeforeLevelMatch':round(float(low_reduction),2),
                       'rmsDbfs':round(float(20*np.log10(max(np.sqrt(np.mean((pcm.astype(float)/32767)**2)),1e-9))),2),
                       'peak':int(np.max(np.abs(pcm.astype(np.int32)))),'seamStep':int(abs(int(pcm[-1])-int(pcm[0]))),
                       'outputSha256':hashlib.sha256(destination.read_bytes()).hexdigest(),'outputBytes':destination.stat().st_size})
    if not args.inspect:
        (report_dir/'processing-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
        print(json.dumps(report,indent=2,ensure_ascii=False))


if __name__=='__main__':
    main()
