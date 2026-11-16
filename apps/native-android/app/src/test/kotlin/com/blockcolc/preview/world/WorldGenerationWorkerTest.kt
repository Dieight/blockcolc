package com.blockcolc.preview.world

import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class WorldGenerationWorkerTest {
    @Test fun selectedResourcesPrepareOnTheWorldWorkerAndCloseThereExactlyOnce(){
        val queue=java.util.concurrent.LinkedBlockingQueue<Runnable>();val seen=java.util.concurrent.CopyOnWriteArrayList<String>();val closed=java.util.concurrent.atomic.AtomicInteger()
        val choice=com.blockcolc.preview.resources.ResourceWorldSelection("a".repeat(64))
        val worker=WorldGenerationWorker({queue.add(it)},null,resourcePreparation={selection,cancelled->
            assertEquals(choice,selection);assertFalse(cancelled());seen+=Thread.currentThread().name;null
        },closeResourcePreparation={seen+=Thread.currentThread().name;closed.incrementAndGet()})
        val ready=java.util.concurrent.atomic.AtomicReference<PreparedWorldRequest>();val failed=java.util.concurrent.atomic.AtomicReference<Exception>()
        try{
            worker.request(WorldRequestIdentity("resource-test.db",0,0),com.blockcolc.domain.DomainEngine.initial("UTC"),WorldTerrainOptions(
                rendering=com.blockcolc.preview.world.WorldRenderOptions(1792929600000,"UTC"),resourceSelection=choice),ready::set,failed::set)
            next(queue).run()
            assertNull(failed.get());assertNotNull(ready.get()?.frame);assertEquals(listOf("blockcolc-world-generation"),seen.toList())
        }finally{worker.close();assertTrue(worker.awaitTermination(10,java.util.concurrent.TimeUnit.SECONDS))}
        assertEquals(1,closed.get());assertEquals(listOf("blockcolc-world-generation","blockcolc-world-generation"),seen.toList())
    }
    private fun identity(revision:Long)=WorldRequestIdentity("isolated",0,revision)
    private fun next(queue:LinkedBlockingQueue<Runnable>)=queue.poll(15,TimeUnit.SECONDS)?:throw AssertionError("World callback did not arrive")
    @Test fun aWorkerCapacityErrorProducesAFailureCallbackInsteadOfLeavingTheLoaderWaiting(){
        val queue=LinkedBlockingQueue<Runnable>();val failures=ArrayList<Exception>()
        val memory=OutOfMemoryError("synthetic capacity boundary")
        val worker=WorldGenerationWorker({queue.add(it)},builderFactory={throw memory})
        try{
            worker.request(identity(1),DomainEngine.initial("UTC"),{throw AssertionError("No candidate was prepared")},failures::add)
            next(queue).run();assertEquals(1,failures.size);assertSame(memory,failures.single().cause)
        }finally{worker.close();assertTrue(worker.awaitTermination(15,TimeUnit.SECONDS))}
    }

    @Test fun debugOptionsSupersedeAnIdenticalBusinessRevisionAndRestoreActualConditions(){
        val queue=LinkedBlockingQueue<Runnable>();val worker=WorldGenerationWorker({queue.add(it)});val ready=ArrayList<PreparedWorldRequest>()
        try{
            val created=DomainEngine.execute(DomainEngine.initial("UTC"),DomainEngine.command("CreateHabitProject","projectId" to "h","title" to "H",
                "blueprintId" to "builtin-timber-house","targetRounds" to 10),DomainTime.millis("2026-10-25T08:00:00.000Z"))
            check(created.ok);val document=created.state;val identity=identity(1)
            worker.request(identity,document,WorldTerrainOptions(),ready::add){throw AssertionError(it)};val stale=next(queue)
            worker.request(identity,document,WorldTerrainOptions(buildingCondition=0),ready::add){throw AssertionError(it)};val damaged=next(queue)
            stale.run();assertTrue(ready.isEmpty());damaged.run()
            assertEquals(1,ready.size);val before=ready.single();assertEquals(document.sha256,before.sourceSha)
            assertEquals(10000,before.plan.buildings.single().fact.condition);assertEquals(1.0,before.plan.buildings.single().recipe.weathering,0.0)
            worker.request(identity,document,WorldTerrainOptions(),ready::add){throw AssertionError(it)};next(queue).run()
            val after=ready.last();assertEquals(document.sha256,after.sourceSha);assertEquals(before.identity,after.identity)
            assertEquals(0.0,after.plan.buildings.single().recipe.weathering,0.0)
            assertSame(before.terrainWorld.terrain,after.terrainWorld.terrain)
        }finally{worker.close();assertTrue(worker.awaitTermination(15,TimeUnit.SECONDS))}
    }

    @Test fun callbacksAlreadyWaitingForUiDeliveryCannotAdoptAnOlderWorldOrSurviveClosure() {
        val queue=LinkedBlockingQueue<Runnable>();val ready=ArrayList<PreparedWorldRequest>()
        val worker=WorldGenerationWorker({queue.add(it)})
        try {
            val document=DomainEngine.initial("UTC")
            worker.request(identity(1),document,ready::add){throw AssertionError(it)}
            val stale=next(queue)
            worker.request(identity(2),document,ready::add){throw AssertionError(it)}
            val current=next(queue)
            stale.run();assertTrue(ready.isEmpty())
            current.run();assertEquals(listOf(identity(2)),ready.map{it.identity})
            assertEquals(document.sha256,ready.single().sourceSha)
            assertTrue(ready.single().terrainWorld.terrain.cellCount>1000)
            assertSame(ready.single().plan,ready.single().terrainWorld.input)
            worker.request(identity(3),document,ready::add){throw AssertionError(it)}
            val closing=next(queue);worker.close();closing.run()
            assertEquals(1,ready.size)
            assertThrows(IllegalStateException::class.java){worker.request(identity(4),document,ready::add){}}
        } finally {worker.close();assertTrue(worker.awaitTermination(15,TimeUnit.SECONDS))}
    }

    @Test fun runningWorkCancelsCooperativelyAndCurrentFailureDoesNotDeliverOverTheLastResult() {
        val queue=LinkedBlockingQueue<Runnable>();val entered=CountDownLatch(1);val release=CountDownLatch(1)
        val calls=AtomicInteger();val fail=AtomicBoolean();val ready=ArrayList<PreparedWorldRequest>();val errors=ArrayList<Exception>()
        val worker=WorldGenerationWorker({queue.add(it)}) {
            val real=NativeBlueprintSources()
            WorldPlanBuilder(BlueprintSources { reference,reward,_ ->
                if(calls.getAndIncrement()==0){entered.countDown();check(release.await(15,TimeUnit.SECONDS))}
                if(fail.get())throw IllegalArgumentException("Source unavailable")
                real.resolve(reference,reward)
            })
        }
        try {
            val creation=DomainEngine.execute(DomainEngine.initial("UTC"),DomainEngine.command("CreateProject","projectId" to "p","title" to "P","blueprintId" to "unlisted",
                "subtasks" to JSONArray().put(JSONObject().put("id","t").put("title","T"))),DomainTime.millis("2026-10-25T08:00:00.000Z"))
            assertTrue(creation.ok)
            worker.request(identity(1),creation.state,ready::add,errors::add)
            assertTrue(entered.await(15,TimeUnit.SECONDS))
            worker.request(identity(2),creation.state,ready::add,errors::add)
            release.countDown();next(queue).run()
            assertEquals(listOf(identity(2)),ready.map{it.identity});assertTrue(errors.isEmpty());assertTrue(queue.isEmpty())
            val retained=ready.single()
            fail.set(true);worker.request(identity(3),creation.state,ready::add,errors::add);next(queue).run()
            assertSame(retained,ready.single());assertEquals(1,errors.size)
            fail.set(false);worker.request(identity(4),creation.state,ready::add,errors::add)
            val cancelled=next(queue);worker.cancelPending();cancelled.run()
            assertSame(retained,ready.single());assertEquals(1,ready.size)
        } finally {release.countDown();worker.close();assertTrue(worker.awaitTermination(15,TimeUnit.SECONDS))}
    }
}
