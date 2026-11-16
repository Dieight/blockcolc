package com.blockcolc.preview.world

import com.blockcolc.world.NativePacketAllocator
import com.blockcolc.world.NativePacketBuffers
import java.util.concurrent.Callable
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** A generation job may overlap independent immutable inputs. Every child is
 * joined before the next job or cleanup; cancelling a Future alone would not
 * prove that its compiler had stopped touching its caches. */
internal class WorldPacketPreparation(allocator:NativePacketAllocator?,private val parallel:Boolean):AutoCloseable {
    private val number=AtomicInteger()
    private val executor by lazy{Executors.newFixedThreadPool(2){task->Thread(task,"blockcolc-packet-${number.incrementAndGet()}").apply{isDaemon=true}}}
    private var executorStarted=false
    val allocator=allocator?.let{source->NativePacketAllocator{bytes->synchronized(source){source.allocate(bytes)}}}
    private var closed=false

    internal class Batch(private val owner:WorldPacketPreparation,private val cancelled:()->Boolean,private val enabled:Boolean) {
        private val aborted=AtomicBoolean()
        private val pending=ArrayList<Future<*>>()
        private var interrupted=false
        fun cancelled()=aborted.get()||cancelled.invoke()
        fun <T> submit(work:()->T):()->T {
            val call=Callable{NativePacketBuffers.using(owner.allocator){if(cancelled())throw CancellationException("Packet preparation superseded");work()}}
            if(!enabled){val result=runCatching{call.call()};return{result.getOrThrow()}}
            owner.executorStarted=true
            val future=owner.executor.submit(call);pending+=future
            return {
                try{future.get()}
                catch(error:ExecutionException){throw checkNotNull(error.cause)}
                catch(error:InterruptedException){interrupted=true;aborted.set(true);throw CancellationException("Packet preparation interrupted").also{it.initCause(error)}}
            }
        }
        fun drain(failure:Throwable?) {
            if(failure!=null)aborted.set(true)
            var first:Throwable?=null
            try{for(future in pending){
                while(true){try{future.get();break}
                    catch(_:InterruptedException){interrupted=true;aborted.set(true)}
                    catch(error:ExecutionException){val cause=checkNotNull(error.cause);if(first==null)first=cause;break}}
            }}finally{if(interrupted)Thread.currentThread().interrupt()}
            if(first!=null){if(failure==null)throw first else if(first!==failure)failure.addSuppressed(first)}
        }
    }
    fun <T> batch(cancelled:()->Boolean,enabled:Boolean=true,work:(Batch)->T):T {
        check(!closed)
        val batch=Batch(this,cancelled,parallel&&enabled);var failure:Throwable?=null
        return try{NativePacketBuffers.using(allocator){work(batch)}}catch(error:Throwable){failure=error;throw error}
        finally{batch.drain(failure)}
    }
    override fun close(){if(!closed){closed=true;if(executorStarted)executor.shutdown()}}
}
