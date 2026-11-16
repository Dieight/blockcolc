package com.blockcolc.preview

import android.content.Context
import android.util.AtomicFile
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import com.blockcolc.presentation.AchievementReceiptStorage
import com.blockcolc.presentation.CelebrationBurst
import com.blockcolc.presentation.CelebrationQueue
import com.blockcolc.presentation.ProjectCompletion
import java.io.File

/** Main-thread presentation queue, never part of a world input. */
class NativeCelebrations {
    private val queue=CelebrationQueue()
    private val completions=java.util.ArrayDeque<ProjectCompletion>()
    var version by mutableIntStateOf(0);private set
    fun accept(events:List<String>,replayed:Boolean,completion:ProjectCompletion?=null){
        queue.accept(events,replayed)
        if(!replayed&&completion!=null&&completions.none{it.projectId==completion.projectId})completions.addLast(completion)
        version++
    }
    fun completion():ProjectCompletion? {version;return completions.peekFirst()}
    fun closeCompletion(){completions.pollFirst();version++}
    fun preview(goal:Boolean){queue.preview(goal);version++}
    fun peek(worldReady:Boolean=true):CelebrationBurst?=queue.peek(worldReady)
    fun take(worldReady:Boolean=true):CelebrationBurst?=queue.take(worldReady).also{version++}
}

/** Verify AtomicFile's adopted bytes: finishWrite can log some failures. */
internal class AndroidAchievementReceiptStorage(private val file:AtomicFile):AchievementReceiptStorage {
    constructor(context:Context):this(AtomicFile(File(context.filesDir,"achievement-display-receipts.json")))
    constructor(directory:File):this(AtomicFile(File(directory,"achievement-display-receipts.json")))
    companion object {fun attention(directory:File)=AndroidAchievementReceiptStorage(AtomicFile(File(directory,"achievement-attention.json")))}
    override fun read():String? {
        if(!file.baseFile.exists()&&!File(file.baseFile.path+".bak").exists())return null
        return file.openRead().use{input->
            val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(4096)
            while(true){val count=input.read(buffer);if(count<0)break;require(output.size()+count<=65536);output.write(buffer,0,count)}
            val bytes=output.toByteArray()
            com.blockcolc.domain.StrictJson.decode(bytes,65536)
        }
    }
    override fun write(value:String){
        val bytes=value.toByteArray(Charsets.UTF_8);require(bytes.size<=65536)
        val stream=file.startWrite()
        try{stream.write(bytes);stream.fd.sync();file.finishWrite(stream)}catch(error:Exception){file.failWrite(stream);throw error}
        check(file.openRead().use{it.readBytes().contentEquals(bytes)}){"Achievement receipt could not be verified"}
    }
}
