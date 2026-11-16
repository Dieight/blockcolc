package com.blockcolc.preview

import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

internal object NativeWorldTestAwait {
    fun delivery(queue:LinkedBlockingQueue<Runnable>,label:String):Runnable = queue.poll(30,TimeUnit.SECONDS)?:throw AssertionError(buildString {
        append(label);append(" did not deliver within 30 seconds\n")
        for((thread,frames)in Thread.getAllStackTraces())if(thread.name.startsWith("blockcolc-")) {
            append(thread.name);append(" ");append(thread.state);append('\n')
            for(frame in frames){append("  ");append(frame);append('\n')}
        }
    })
}
