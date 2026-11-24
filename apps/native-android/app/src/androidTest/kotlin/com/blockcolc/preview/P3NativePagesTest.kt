package com.blockcolc.preview

import com.blockcolc.preview.ui.CountdownPreference

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextRange
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import com.blockcolc.domain.*
import com.blockcolc.focus.*
import com.blockcolc.storage.*
import com.blockcolc.storage.android.AndroidStateDatabase
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicReference
import com.blockcolc.world.filament.NativeWorldView

/** Real Compose pages and Android actor/SQLite, with separate test facts and
 * separate preferences. No formal App, existing preview facts or policy edits. */
@OptIn(ExperimentalTestApi::class)
class P3NativePagesTest {
    @get:Rule(order=0) val waiting=P3UiWaitDiagnostics()
    @get:Rule(order=1) val compose=createComposeRule()
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private val runtime get()=PreviewRuntime.get(context)
    private fun screen(label:String){
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"local"
        require(group.matches(Regex("[a-z0-9-]{1,60}")))
        val output=File(context.filesDir,"p3-pages-$group-$label-${UUID.randomUUID()}.png")
        // Functional assertions above use actual facts/semantics. Screenshots
        // are not latency samples: wait for idle and an extra display settle,
        // otherwise UiAutomation can return the previous submitted frame.
        compose.waitForIdle()
        val device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        device.waitForIdle(1000);android.os.SystemClock.sleep(120)
        check(device.takeScreenshot(output))
    }
    private fun filesIdentity():List<String> = listOf(File(context.filesDir,"achievement-display-receipts.json"),File(context.filesDir,"achievement-display-receipts.json.bak"),File(context.filesDir,"achievement-display-receipts.json.new"),File(context.filesDir,"achievement-attention.json"),File(context.filesDir,"achievement-attention.json.bak"),File(context.filesDir,"achievement-attention.json.new"),File(context.filesDir,"client-preferences.json"),File(context.applicationInfo.dataDir,"shared_prefs/native-ui.xml")).map{f->
        if(!f.exists())"absent"else MessageDigest.getInstance("SHA-256").digest(f.readBytes()).joinToString(""){"%02x".format(it.toInt() and 255)}
    }
    private fun initial():DomainDocument{
        var state=DomainEngine.initial("UTC")
        val now=System.currentTimeMillis()
        for(command in listOf(
            DomainEngine.command("CreateHabitProject","projectId" to "habit","title" to "Daily habit","blueprintId" to "builtin-timber-house","targetRounds" to 10),
            DomainEngine.command("CreateProject","projectId" to "work","title" to "写作工程","blueprintId" to "builtin-small-workshop","subtasks" to JSONArray()
                .put(JSONObject().put("id","first").put("title","第一章")).put(JSONObject().put("id","second").put("title","第二章"))))) {
            val result=DomainEngine.execute(state,command,now);check(result.ok){result.error!!};state=result.state
        }
        return state
    }
    private fun taskMutationJournal(kind:String,initial:DomainDocument){
        val final=runtime.testRead().get(30,TimeUnit.SECONDS)
        val journal=JSONObject().put("completed",true).put("initial",initial.canonical).put("final",final.domain.canonical)
            .put("commands",JSONArray(runtime.testRecording().get(30,TimeUnit.SECONDS)))
            .put("attribution",FocusProjection.attribution(final.domain)).put("caseLabel",InstrumentationRegistry.getArguments().getString("p3Group"))
        File(context.filesDir,"p3-task-$kind.json").writeText(journal.toString())
    }
    private fun settledPhysicalClick(node:SemanticsNodeInteraction,label:String){
        node.performScrollTo()
        var previous="";var since=android.os.SystemClock.uptimeMillis()
        compose.waitUntil(5000){
            val bounds=node.fetchSemanticsNode().boundsInRoot
            val ime=java.util.concurrent.atomic.AtomicInteger()
            InstrumentationRegistry.getInstrumentation().runOnMainSync{
                val activity=androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).single()
                ime.set(androidx.core.view.ViewCompat.getRootWindowInsets(activity.window.decorView)?.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime())?.bottom?:0)
            }
            val signature="$bounds/${ime.get()}";val now=android.os.SystemClock.uptimeMillis()
            if(signature!=previous){previous=signature;since=now}
            if(bounds.width<=20||bounds.height<=20){
                // IME showing can shrink the viewport after the first scroll.
                // Reposition the intended control; never retry the click.
                node.performScrollTo();since=now;false
            }else now-since>=150
        }
        node.assertIsDisplayed()
        android.util.Log.i("BlockcolcEditor","test-physical-$label settled=$previous")
        node.performClick()
    }
    @Test fun anExplicitTaskSaveCommitsVisibleImeCompositionAtTheMiddleCursor()=run{
        nav("任务");compose.onNodeWithText("新增任务").performScrollTo().performClick()
        val field=compose.onNodeWithContentDescription("任务名称")
        field.performClick().performTextReplacement("前后");field.performTextInputSelection(TextRange(1))
        val marker="test-begin:"+UUID.randomUUID();android.util.Log.i("BlockcolcEditor",marker)
        InstrumentationRegistry.getInstrumentation().runOnMainSync{
            val activity=androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).single()
            val queue=java.util.ArrayDeque<android.view.View>();queue.add(activity.window.decorView)
            var connection:android.view.inputmethod.InputConnection?=null
            while(queue.isNotEmpty()&&connection==null){
                val view=queue.removeFirst()
                if(view.onCheckIsTextEditor())connection=view.onCreateInputConnection(android.view.inputmethod.EditorInfo())
                if(view is android.view.ViewGroup)for(i in 0 until view.childCount)queue.add(view.getChildAt(i))
            }
            val editor=checkNotNull(connection);check(editor.setSelection(1,1));check(editor.setComposingText("中",1))
        }
        compose.waitForIdle();field.assertTextContains("前中后")
        compose.onNodeWithText("开始建造").performScrollTo().performSemanticsAction(SemanticsActions.OnClick){it()}
        compose.waitUntil(20000){!runtime.latest.busy&&runtime.latest.projects.any{it.title=="前中后"}}
        val device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val log=device.executeShellCommand("logcat -d -s BlockcolcEditor:I")
        assertTrue("The test must save a genuinely composing editor",log.substringAfter(marker,"").contains("explicit-create-composition"))
    }
    @Test fun taskCreationRenameReorderRemovalAndDeletionUseRealControlsAndCreateRollback()=run{
        val before=runtime.testRead().get(30,TimeUnit.SECONDS).domain
        runtime.testRecording(true).get(30,TimeUnit.SECONDS)
        nav("任务");compose.onNodeWithText("新增任务").performScrollTo().performClick()
        compose.onNodeWithContentDescription("任务名称").performTextReplacement("验收工坊")
        settledPhysicalClick(compose.onNodeWithText("开始建造"),"create-project")
        compose.waitUntil(20000){!runtime.latest.busy&&runtime.latest.projects.any{it.title=="验收工坊"}}
        compose.waitUntilDoesNotExist(hasContentDescription("任务名称"),10000)
        val id=runtime.latest.projects.single{it.title=="验收工坊"}.id
        assertEquals(id,runtime.latest.activeProject)
        fun project()=runtime.latest.projects.single{it.id==id}
        compose.onNodeWithContentDescription("编辑施工清单").performScrollTo().performClick()
        compose.onAllNodesWithContentDescription("重命名")[0].performScrollTo().performClick()
        compose.onNodeWithContentDescription("名称").performTextReplacement("重新整理目标")
        compose.onNodeWithText("保存").performScrollTo().performClick()
        compose.waitUntil(15000){!runtime.latest.busy&&project().tasks.first().title=="重新整理目标"}
        compose.waitUntilDoesNotExist(isDialog(),10000)
        compose.onAllNodesWithContentDescription("下移")[0].performScrollTo().performClick()
        compose.waitUntil(15000){!runtime.latest.busy&&project().tasks.map{it.title}==listOf("完成核心工作","重新整理目标","检查并收尾")}
        compose.onNodeWithText("新增小任务").performScrollTo().performClick()
        compose.onNodeWithContentDescription("名称").performTextReplacement("核对结果")
        compose.onNodeWithText("保存").performScrollTo().performClick()
        compose.waitUntil(15000){!runtime.latest.busy&&project().tasks.size==4}
        compose.waitUntilDoesNotExist(isDialog(),10000)
        compose.onAllNodesWithContentDescription("删除小任务")[3].performScrollTo().performClick()
        compose.waitUntil(15000){!runtime.latest.busy&&project().tasks.size==3}
        assertTrue(project().tasks.none{it.title=="核对结果"})
        fun verifiedRoots():List<BackupRoot>{
            val request=UUID.randomUUID().toString();runtime.refreshBackups(request)
            compose.waitUntil(20000){runtime.latest.receipts.any{it.id==request}}
            assertTrue(runtime.latest.receipts.single{it.id==request}.saved)
            assertTrue(runtime.latest.backupListingReady)
            return runtime.latest.roots
        }
        val roots=verifiedRoots().map{it.id}.toSet()
        compose.onNodeWithText("删除当前任务").performScrollTo().performClick()
        compose.onNodeWithText("确认删除").performScrollTo().performClick()
        compose.waitUntil(20000){!runtime.latest.busy&&runtime.latest.projects.none{it.id==id&&it.status!="deleted"}}
        compose.waitUntilDoesNotExist(isDialog(),10000)
        assertNotEquals(id,runtime.latest.activeProject)
        assertTrue(verifiedRoots().any{it.id !in roots&&it.reason=="before-delete"&&it.source==id})
        compose.onNodeWithText("验收工坊").assertDoesNotExist()
        taskMutationJournal("ordinary-management",before);screen("ordinary-task-management")
    }
    @Test fun habitCreationAndTaskOverviewSwitchesKeepTheSelectedProjectIdentity()=run{
        val before=runtime.testRead().get(30,TimeUnit.SECONDS).domain
        runtime.testRecording(true).get(30,TimeUnit.SECONDS)
        nav("任务");compose.onNodeWithText("新增任务").performScrollTo().performClick()
        compose.onNodeWithText("习惯任务").performScrollTo().performClick()
        compose.onNodeWithContentDescription("任务名称").performTextReplacement("每天读一页")
        settledPhysicalClick(compose.onNodeWithText("开始建造"),"create-habit")
        compose.waitUntil(20000){!runtime.latest.busy&&runtime.latest.projects.any{it.title=="每天读一页"}}
        compose.waitUntilDoesNotExist(hasContentDescription("任务名称"),10000)
        val created=runtime.latest.projects.single{it.title=="每天读一页"}
        assertEquals("habit",created.kind);assertEquals(created.id,runtime.latest.activeProject)
        compose.onNodeWithText("任务总览与管理").performScrollTo().performClick()
        compose.onAllNodesWithText("切换").assertCountEquals(2)
        compose.onAllNodesWithText("切换")[1].performScrollTo().performClick()
        compose.waitUntil(15000){!runtime.latest.busy&&runtime.latest.activeProject=="work"}
        compose.onNodeWithText("写作工程").performScrollTo().assertIsDisplayed()
        // The overview remains open; its last habit is the newly created one.
        compose.onAllNodesWithText("切换").assertCountEquals(2)
        compose.onAllNodesWithText("切换")[1].performScrollTo().performClick()
        compose.waitUntil(15000){!runtime.latest.busy&&runtime.latest.activeProject==created.id}
        compose.onNodeWithContentDescription("习惯周期进度").performScrollTo().assertIsDisplayed()
        taskMutationJournal("habit-selection",before);screen("habit-task-management")
    }
    @Test fun progressedTaskKeepsItsLockedStructureWhileTitlesAndOrderRemainEditable()=run(partlyBuilt()){
        val before=runtime.testRead().get(30,TimeUnit.SECONDS).domain
        runtime.testRecording(true).get(30,TimeUnit.SECONDS)
        nav("任务")
        compose.onNodeWithText("写作工程").performScrollTo().performTouchInput{doubleClick()}
        compose.onNodeWithContentDescription("名称").performTextReplacement("写作工程改名")
        compose.onNodeWithText("保存").performScrollTo().performClick()
        compose.waitUntil(15000){!runtime.latest.busy&&runtime.latest.projects.single{it.id=="work"}.title=="写作工程改名"}
        compose.waitUntilDoesNotExist(isDialog(),10000)
        compose.onNodeWithContentDescription("编辑施工清单").performScrollTo().performClick()
        compose.onNodeWithText("已有进度后不能增删，可继续改名和排序。").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("新增小任务").assertDoesNotExist()
        compose.onAllNodesWithContentDescription("删除小任务").assertCountEquals(0)
        compose.onAllNodesWithContentDescription("下移")[0].performScrollTo().performClick()
        compose.waitUntil(15000){!runtime.latest.busy&&runtime.latest.projects.single{it.id=="work"}.tasks.first().id=="second"}
        val final=runtime.testRead().get(30,TimeUnit.SECONDS).domain
        assertEquals(before.focusControlJson().getJSONArray("focusHistory").toString(),final.focusControlJson().getJSONArray("focusHistory").toString())
        taskMutationJournal("locked-structure",before);screen("locked-task-management")
    }
    private fun resourceGallery():DomainDocument{
        val blueprint=JSONObject().put("schemaVersion",1).put("id","resource-gallery").put("title","Resource gallery")
            .put("bounds",JSONObject().put("minX",0).put("maxX",6).put("minY",0).put("maxY",0).put("minZ",0).put("maxZ",6))
            .put("voxels",JSONArray((0..8).map{i->JSONObject().put("x",i%3*3).put("y",0).put("z",i/3*3).put("materialId","stone")
                .put("stage","foundation").put("buildOrder",0).put("sourceBlockId","minecraft:gallery$i")}))
        val result=DomainEngine.execute(DomainEngine.initial("UTC"),DomainEngine.command("CreateProject","projectId" to "gallery","title" to "Gallery",
            "blueprintId" to "resource-gallery","importedBlueprint" to blueprint,"subtasks" to JSONArray().put(JSONObject().put("id","task").put("title","Task"))),System.currentTimeMillis())
        check(result.ok){result.error!!};return result.state
    }
    @Test @androidx.test.filters.SdkSuppress(minSdkVersion=29) @android.annotation.TargetApi(29)
    fun resourcePickerImportAndSelectionWaitForTheVisibleWorldAndDeletionRestoresOriginals(){
        val instrumentation=InstrumentationRegistry.getInstrumentation();val controller=AtomicReference<com.blockcolc.preview.resources.NativeResourceController>()
        instrumentation.runOnMainSync{controller.set(com.blockcolc.preview.resources.NativeResourceController.get(context))}
        fun library()=controller.get().snapshot()
        instrumentation.runOnMainSync{controller.get().refresh()};compose.waitUntil(10000){library().ready&&!library().busy};assertNull(library().error)
        val folder=File(context.filesDir,"native-resource-packs");val existed=folder.exists();val files=folder.list()?.toSet().orEmpty()
        val indices=listOf("index.json","index.json.bak","index.json.new").associateWith{name->File(folder,name).takeIf(File::isFile)?.readBytes()}
        val originalIds=library().metadata!!.items.map{it.id}.toSet()
        val ref=JSONObject(javaClass.getResource("/native-resource-geometry-oracle.json")!!.readText()).getJSONArray("cases")
        val row=(0 until ref.length()).map{ref.getJSONObject(it)}.first{it.getString("name")=="render-gallery"}
        val materialQueries=row.getJSONArray("queries")
        val expectedMaterialClasses=(0 until materialQueries.length()).flatMap{i->
            val parts=materialQueries.getJSONObject(i).getJSONObject("expected").optJSONArray("parts")
            if(parts==null)emptyList()else(0 until parts.length()).map{k->parts.getJSONObject(k).let{it.getInt("page") to it.getString("alphaMode")}}
        }.distinct().size
        assertEquals(2,expectedMaterialClasses)
        val sourceFiles=LinkedHashMap<String,ByteArray>()
        java.util.zip.ZipInputStream(android.util.Base64.decode(row.getString("zip"),android.util.Base64.DEFAULT).inputStream()).use{zip->while(true){val e=zip.nextEntry?:break;sourceFiles[e.name]=zip.readBytes()}}
        val stem="blockcolc-p3-"+UUID.randomUUID().toString().take(12)
        sourceFiles["pack.mcmeta"]=JSONObject().put("pack",JSONObject().put("pack_format",97).put("description",stem)).toString().toByteArray()
        val bytes=java.io.ByteArrayOutputStream();java.util.zip.ZipOutputStream(bytes).use{zip->for((name,data)in sourceFiles){zip.putNextEntry(java.util.zip.ZipEntry(name));zip.write(data);zip.closeEntry()}}
        val source=bytes.toByteArray();val id=MessageDigest.getInstance("SHA-256").digest(source).joinToString(""){"%02x".format(it.toInt()and 255)}
        assertFalse(id in originalIds)
        val resolver=context.contentResolver;var uri:android.net.Uri?=null;var failure:Throwable?=null;var restored=false;var imported=false;var adopted=false;var cancelled=false;var removed=false
        var adoptedMaterials=0;var externalRemoved=false
        var initialFrame:JSONObject?=null;var adoptedFrame:JSONObject?=null;var removedFrame:JSONObject?=null
        try{
            instrumentation.runOnMainSync{controller.get().original()};compose.waitUntil(10000){!library().busy&&library().metadata?.activeId==null&&library().metadata?.baseId==null}
            uri=checkNotNull(resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,android.content.ContentValues().apply{
                put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME,"$stem.zip");put(android.provider.MediaStore.MediaColumns.MIME_TYPE,"application/zip")
                put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,"Download/");put(android.provider.MediaStore.MediaColumns.IS_PENDING,1)}))
            checkNotNull(resolver.openOutputStream(uri!!,"w")).use{it.write(source)}
            assertEquals(1,resolver.update(uri!!,android.content.ContentValues().apply{put(android.provider.MediaStore.MediaColumns.IS_PENDING,0)},null,null))
            run(resourceGallery()){
                var world:NativeWorldView?=null
                compose.waitUntil(80000){renderedWorld()?.also{world=it}!=null}
                fun visibleFrame(materials:Int,afterGpu:Long):JSONObject{
                    var last=JSONObject()
                    compose.waitUntil(60000){
                        last=worldDiagnostic(world!!)
                        !last.getBoolean("failed")&&last.getBoolean("active")&&last.getBoolean("surfaceShown")&&last.getBoolean("swapReady")&&
                            last.getLong("gpuReadyFrames")>afterGpu&&last.isNull("pendingPresentation")&&
                            last.getJSONObject("resources").getInt("atlasMaterials")==materials&&
                            compose.onAllNodesWithText("正在建造世界").fetchSemanticsNodes().isEmpty()
                    }
                    return last
                }
                val old=visibleFrame(0,-1);initialFrame=old;screen("resource-picker-original")
                nav("设置");compose.onNodeWithText("方块材质包").performScrollTo().performClick()
                compose.onNodeWithContentDescription("导入材质包").performScrollTo().performClick()
                val device=androidx.test.uiautomator.UiDevice.getInstance(instrumentation)
                assertTrue(device.wait(androidx.test.uiautomator.Until.gone(androidx.test.uiautomator.By.pkg(context.packageName)),10000));device.pressBack()
                assertTrue(device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.pkg(context.packageName)),10000))
                compose.waitForIdle();assertEquals(originalIds,library().metadata!!.items.map{it.id}.toSet());cancelled=true
                compose.onNodeWithContentDescription("导入材质包").performScrollTo().performClick()
                val pickerRow=device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.textContains(stem)),10000)
                assertNotNull("The document picker did not expose the owned ZIP fixture",pickerRow);pickerRow.click()
                if(!device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.pkg(context.packageName)),1500)){
                    val confirm=device.findObject(androidx.test.uiautomator.By.text(java.util.regex.Pattern.compile("确定|完成|选择|Select|Done|OK")));assertNotNull(confirm);confirm.click()}
                assertTrue(device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.pkg(context.packageName)),10000))
                compose.waitUntil(25000){!library().busy&&library().metadata?.items?.any{it.id==id}==true};assertNull(library().error);imported=true
                assertNull(library().metadata!!.activeId) // An explicit original choice survives import.
                compose.onNode(hasText("使用") and hasAnyAncestor(hasTestTag("resource-pack-$id"))).performScrollTo().performClick()
                compose.waitUntil(10000){!library().busy&&library().metadata?.activeId==id};assertNull(library().error)
                assertEquals("Settings must not rebuild the hidden world",0,worldDiagnostic(world!!).getJSONObject("resources").getInt("atlasMaterials"))
                nav("计时")
                adoptedFrame=visibleFrame(expectedMaterialClasses,old.getLong("gpuReadyFrames"))
                adoptedMaterials=adoptedFrame!!.getJSONObject("resources").getInt("atlasMaterials")
                assertNull(library().worldError);adopted=true;screen("resource-picker-adopted")
                nav("设置")
                if(compose.onAllNodesWithTag("resource-pack-$id").fetchSemanticsNodes().isEmpty())compose.onNodeWithText("方块材质包").performScrollTo().performClick()
                compose.onNode(hasContentDescription("删除资源包") and hasAnyAncestor(hasTestTag("resource-pack-$id"))).performScrollTo().performClick()
                compose.onNodeWithText("删除资源包").performScrollTo().performClick()
                compose.waitUntil(15000){!library().busy&&library().metadata?.items?.none{it.id==id}==true};assertNull(library().error);removed=true
                nav("计时");removedFrame=visibleFrame(0,adoptedFrame!!.getLong("gpuReadyFrames"));screen("resource-picker-removed")
            }
        }catch(error:Throwable){failure=error;throw error}
        finally{
            try{
                compose.waitUntil(30000){!library().busy}
                for((name,data)in indices){val target=File(folder,name);if(data==null)target.delete()else target.writeBytes(data)}
                for(file in folder.listFiles().orEmpty().filter{it.name !in files}){require(file.canonicalFile.parentFile==folder.canonicalFile&&file.isFile);check(file.delete())}
                if(!existed)folder.delete()
                instrumentation.runOnMainSync{controller.get().refresh()};compose.waitUntil(10000){!library().busy}
                restored=indices.all{(name,data)->val f=File(folder,name);if(data==null)!f.exists()else f.isFile&&f.readBytes().contentEquals(data)}&&files==folder.list()?.toSet().orEmpty()
                assertTrue("Resource original index/files must be restored",restored);assertEquals(originalIds,library().metadata!!.items.map{it.id}.toSet())
            }catch(cleanup:Throwable){if(failure!=null)failure.addSuppressed(cleanup)else throw cleanup}
            finally{
                uri?.let{resolver.delete(it,null,null);externalRemoved=resolver.query(it,arrayOf(android.provider.MediaStore.MediaColumns._ID),null,null,null)?.use{cursor->!cursor.moveToFirst()}?:true}
                val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
                File(context.filesDir,"p3-world-resource-picker-import.json").writeText(JSONObject().put("schema",1).put("caseLabel",group).put("cancelledWithoutMutation",cancelled)
                    .put("imported",imported).put("adoptedInVisibleWorld",adopted).put("adoptedMaterialClasses",adoptedMaterials).put("removedViaUi",removed)
                    .put("originalResourceIndexAndFilesRestored",restored).put("ownedExternalDocumentRemoved",externalRemoved)
                    .put("initialFrame",initialFrame).put("adoptedFrame",adoptedFrame).put("removedFrame",removedFrame).put("completed",failure==null).toString())
                assertTrue("Owned document fixture must be removed",externalRemoved)
            }
        }
    }
    private fun run(initialDocument:DomainDocument=initial(),firstUse:Boolean=false,fontScale:Float?=null,realTimeStartup:Boolean=true,
        configure:(com.blockcolc.presentation.ClientPreferences)->com.blockcolc.presentation.ClientPreferences={it},block:(String)->Unit){
        val originalFiles=AtomicReference<List<String>>()
        val name=runtime.testDatabase(true,beforeSwitch={originalFiles.set(filesIdentity())}).get(30,TimeUnit.SECONDS)
        val before=checkNotNull(originalFiles.get())
        var preferences=false
        var show by mutableStateOf(true);var mounted=false
        try{
            runtime.testClientPreferences(true).get(30,TimeUnit.SECONDS);preferences=true
            if(firstUse)runtime.testFirstUse(true,true).get(30,TimeUnit.SECONDS)
            runtime.testOperation{c->c.importBackup("p3-pages",BackupCodec.read(BackupCodec.write(initialDocument,DomainTime.format(System.currentTimeMillis()))),System.currentTimeMillis())}.get(30,TimeUnit.SECONDS)
            val desiredPreferences=AtomicReference<com.blockcolc.presentation.ClientPreferences>()
            runtime.updatePreferences{configure(it.copy(quickNotesEnabled=true,focusMinutes=1,breakMinutes=0,themeMode="dark")).also(desiredPreferences::set)}
            compose.waitUntil(10000){desiredPreferences.get()?.let{runtime.latest.preferences==it&&!runtime.latest.preferencesSaving}==true}
            InstrumentationRegistry.getArguments().getString("p3ExpectedOrientation")?.let{expected->
                val orientation=when(expected){
                    "portrait"->android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                    "landscape"->android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                    "reverse-landscape"->android.content.pm.ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE
                    else->error("Unknown test orientation: $expected")
                }
                val configuration=if(expected=="portrait")android.content.res.Configuration.ORIENTATION_PORTRAIT else android.content.res.Configuration.ORIENTATION_LANDSCAPE
                // Select the test Activity's orientation before setting its
                // Compose content. ActivityScenario may recreate the host;
                // its provider resolves the replacement at setContent time.
                val instrumentation=InstrumentationRegistry.getInstrumentation()
                fun host()=androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance()
                    .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).singleOrNull{it.javaClass.name=="androidx.activity.ComponentActivity"}
                instrumentation.runOnMainSync{checkNotNull(host()).requestedOrientation=orientation}
                compose.waitUntil(15000){
                    var correct=false
                    instrumentation.runOnMainSync{correct=host()?.resources?.configuration?.orientation==configuration}
                    correct
                }
            }
            if(realTimeStartup)compose.mainClock.autoAdvance=false
            compose.setContent{if(show){
                val actual=LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(actual.density,fontScale?:actual.fontScale)){NativeApp(runtime)}
            }};mounted=true
            compose.waitUntil(10000){runtime.latest.ready}
            if(realTimeStartup){
                // Native generation/presentation runs on real worker / GPU time.
                // Do not race an infinite loading timeline forward by years
                // while waiting for a large world's first presentation.
                compose.waitUntil(180000){compose.mainClock.advanceTimeByFrame();android.os.SystemClock.sleep(10);compose.onAllNodesWithTag("workspace-ready").fetchSemanticsNodes().isNotEmpty()}
                compose.mainClock.autoAdvance=true;compose.waitForIdle()
            }else compose.waitUntil(60000){compose.onAllNodesWithTag("workspace-ready").fetchSemanticsNodes().isNotEmpty()}
            InstrumentationRegistry.getArguments().getString("p3ExpectedOrientation")?.let{expected->
                val root=compose.onRoot().fetchSemanticsNode().boundsInRoot
                val device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"local"
                require(group.matches(Regex("[a-z0-9-]{1,60}")))
                File(context.filesDir,"p3-ui-window-$group.json").writeText(JSONObject().put("expected",expected).put("rootWidthPx",root.width)
                    .put("rootHeightPx",root.height).put("displayWidthPx",device.displayWidth).put("displayHeightPx",device.displayHeight)
                    .put("rotation",device.displayRotation).put("fontScale",fontScale?:context.resources.configuration.fontScale).toString())
                assertEquals("Check the measured Compose window, not the saved rotation option",expected!="portrait",root.width>root.height)
                assertEquals("The physical display must agree with the app window",expected!="portrait",device.displayWidth>device.displayHeight)
            }
            try{block(name)}catch(error:Throwable){runCatching{screen("failure")};throw error}
        }finally{
            // Remove UI before resetting the actor's storage context.
            try{
                if(realTimeStartup)compose.mainClock.autoAdvance=true
                if(mounted){InstrumentationRegistry.getInstrumentation().runOnMainSync{show=false};compose.waitForIdle()}
            }finally{
                try{if(preferences)runtime.testClientPreferences(false).get(30,TimeUnit.SECONDS)}
                finally{runtime.testDatabase(false).get(30,TimeUnit.SECONDS)}
            }
            assertEquals("Original preference/first-use files must remain byte-identical",before,filesIdentity())
        }
    }
    private fun nav(label:String){compose.onNodeWithContentDescription(label).performClick();compose.waitForIdle()}
    private fun renderedWorld():NativeWorldView? {
        val value=AtomicReference<NativeWorldView?>()
        InstrumentationRegistry.getInstrumentation().runOnMainSync{
            fun find(view:android.view.View):NativeWorldView? {
                if(view is NativeWorldView)return view
                if(view is android.view.ViewGroup)for(i in 0 until view.childCount)find(view.getChildAt(i))?.let{return it}
                return null
            }
            val activities=androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED)
            for(activity in activities)find(activity.window.decorView)?.let{value.set(it)}
        }
        return value.get()
    }
    private fun worldDiagnostic(world:NativeWorldView,includeResources:Boolean=true):JSONObject {
        val value=AtomicReference<JSONObject>();val done=CountDownLatch(1)
        world.generatedDiagnostics(includeResources){value.set(it);done.countDown()}
        assertTrue(done.await(10,TimeUnit.SECONDS));return checkNotNull(value.get())
    }
    @Test fun ordinaryWorkspaceKeepsItsCameraAfterHomeAndBothResets()=workspaceHomeAndResets(false)
    @Test fun minimalWorkspaceKeepsItsCameraAfterHomeAndBothResets()=workspaceHomeAndResets(true)
    private fun workspaceHomeAndResets(minimal:Boolean){
        val report=JSONArray()
        val selected=DomainEngine.execute(initial(),DomainEngine.command("ConfigureWorldEnvironment","environmentStyle" to "ocean-island"),System.currentTimeMillis())
        check(selected.ok){selected.error!!}
        run(selected.state,configure={it.copy(minimalMode=minimal)}){
            fun frame(accepted:(JSONObject)->Boolean={true}):JSONObject {
                var result=JSONObject()
                compose.waitUntil(90000){val world=renderedWorld();if(world==null)false else{
                    result=worldDiagnostic(world,false)
                    result.optBoolean("active")&&result.optBoolean("surfaceShown")&&result.optBoolean("swapReady")&&
                        result.optLong("gpuReadyFrames")>0&&result.optLong("revision")==runtime.latest.revision&&
                        result.isNull("pendingPresentation")&&!result.optBoolean("fencePending")&&!result.getJSONObject("navigation").optBoolean("opening")&&accepted(result)
                }}
                return result
            }
            fun sameCamera(before:JSONObject,after:JSONObject){
                val a=before.getJSONObject("camera");val b=after.getJSONObject("camera")
                for(key in listOf("distance","fittedDistance","pitch","azimuth","fov"))assertEquals(key,a.getDouble(key),b.getDouble(key),1e-8)
                for(key in listOf("width","height"))assertEquals(key,a.getInt(key),b.getInt(key))
                for(i in 0..2)assertEquals("target[$i]",a.getJSONArray("target").getDouble(i),b.getJSONArray("target").getDouble(i),1e-8)
                for(key in listOf("presentationHeight","presentationTop"))assertEquals(key,before.getInt(key),after.getInt(key))
                assertEquals(before.getJSONObject("navigation").optString("selected"),after.getJSONObject("navigation").optString("selected"))
            }
            InstrumentationRegistry.getInstrumentation().runOnMainSync{runtime.foreground(true)}
            runtime.testRead().get(30,TimeUnit.SECONDS)
            val before=frame();val component=AtomicReference<android.content.ComponentName>()
            InstrumentationRegistry.getInstrumentation().runOnMainSync{
                component.set(androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance()
                    .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).single().componentName)
            }
            val device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            InstrumentationRegistry.getInstrumentation().runOnMainSync{runtime.foreground(false)}
            device.pressHome();device.waitForIdle(1000)
            context.startActivity(android.content.Intent().setComponent(component.get()).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP))
            InstrumentationRegistry.getInstrumentation().runOnMainSync{runtime.foreground(true)}
            runtime.testRead().get(30,TimeUnit.SECONDS)
            val returned=frame();sameCamera(before,returned)
            fun worldAction(label:String){
                if(compose.onAllNodesWithContentDescription(label).fetchSemanticsNodes().isEmpty()){
                    compose.onNodeWithContentDescription("显示世界操作").performClick();android.os.SystemClock.sleep(450)
                }
                compose.onNodeWithContentDescription(label).performClick()
            }
            val expectedReset=JSONObject(before.toString())
            val fitted=before.getJSONObject("camera").getDouble("fittedDistance")
            val limits=before.getJSONObject("navigation")
            val resetDistance=fitted.coerceIn(limits.getDouble("minimum"),limits.getDouble("maximum"))
            expectedReset.getJSONObject("camera").put("distance",resetDistance)
            worldAction("重置视角")
            val reset=frame{kotlin.math.abs(it.getJSONObject("camera").getDouble("distance")-resetDistance)<1e-8}
            sameCamera(expectedReset,reset)
            if(!reset.getJSONObject("navigation").isNull("selected"))worldAction("重置地图")
            var mapped=frame()
            compose.waitUntil(10000){mapped=frame();mapped.getJSONObject("navigation").isNull("selected")}
            InstrumentationRegistry.getInstrumentation().runOnMainSync{runtime.foreground(false)}
            device.pressHome();device.waitForIdle(1000)
            context.startActivity(android.content.Intent().setComponent(component.get()).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP))
            InstrumentationRegistry.getInstrumentation().runOnMainSync{runtime.foreground(true)}
            runtime.testRead().get(30,TimeUnit.SECONDS)
            val mappedReturn=frame();sameCamera(mapped,mappedReturn)
            report.put(JSONObject().put("minimal",minimal).put("before",before).put("returned",returned).put("reset",reset).put("map",mapped).put("mapReturned",mappedReturn))
        }
        File(context.filesDir,"p3-world-home-resume-${if(minimal)"minimal"else"ordinary"}.json").writeText(JSONObject().put("caseLabel",InstrumentationRegistry.getArguments().getString("p3Group")).put("cases",report).put("completed",true).toString())
    }
    private fun partlyBuilt():DomainDocument {
        var state=initial();val now=System.currentTimeMillis();val session="weathering-fixture"
        for((at,command)in listOf(
            now to DomainEngine.command("SwitchActiveProject","projectId" to "work"),
            now to DomainEngine.command("StartFocus","sessionId" to session,"subtaskId" to "first","plannedDurationMs" to 1000),
            now+1000 to DomainEngine.command("CompleteFocus"),
            now+1000 to DomainEngine.command("ReportSubtaskProgress","reportId" to "weathering-report","subtaskId" to "first",
                "focusSessionIds" to JSONArray(listOf(session)),"progressBasisPoints" to 8000),
            now+1000 to DomainEngine.command("StartFocus","sessionId" to "$session-second","subtaskId" to "second","plannedDurationMs" to 1000),
            now+2000 to DomainEngine.command("CompleteFocus"),
            now+2000 to DomainEngine.command("ReportSubtaskProgress","reportId" to "weathering-second-report","subtaskId" to "second",
                "focusSessionIds" to JSONArray(listOf("$session-second")),"progressBasisPoints" to 8000))){
            val result=DomainEngine.execute(state,command,at);check(result.ok){result.error!!};state=result.state
        }
        return state
    }
    private fun memoryWorld():DomainDocument {
        var state=partlyBuilt();var at=System.currentTimeMillis()+3000
        fun apply(type:String,vararg fields:Pair<String,Any?>){val result=DomainEngine.execute(state,DomainEngine.command(type,*fields),at++);check(result.ok){"$type: ${result.error}"};state=result.state}
        apply("CreateProject","projectId" to "museum","title" to "完成工程","blueprintId" to "builtin-timber-house","subtasks" to JSONArray().put(JSONObject().put("id","museum-task").put("title","建成")))
        apply("SwitchActiveProject","projectId" to "museum")
        apply("StartFocus","sessionId" to "museum-session","subtaskId" to "museum-task","plannedDurationMs" to 1)
        apply("CompleteFocus")
        apply("ReportSubtaskProgress","reportId" to "museum-report","subtaskId" to "museum-task","focusSessionIds" to JSONArray(listOf("museum-session")),"progressBasisPoints" to 10000)
        apply("SwitchActiveProject","projectId" to "habit")
        repeat(10){apply("StartFocus","sessionId" to "habit-memory-$it","subtaskId" to JSONObject.NULL,"plannedDurationMs" to 1);apply("CompleteFocus")}
        apply("CreateProject","projectId" to "secondary","title" to "第二工程","blueprintId" to "builtin-timber-house","subtasks" to JSONArray().put(JSONObject().put("id","secondary-task").put("title","建造")))
        apply("SwitchActiveProject","projectId" to "work")
        val date=java.time.LocalDate.now(java.time.ZoneOffset.UTC)
        apply("ConfigureBirthday","enabled" to true,"month" to date.monthValue,"day" to date.dayOfMonth)
        apply("ObserveBirthday")
        return state
    }
    @Test fun worldHitMemoryArchivesRewardsAndBothResetsShareTheResidentCamera()=run(memoryWorld()){
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"local"
        compose.waitUntil(60000){renderedWorld()!=null};val world=checkNotNull(renderedWorld())
        compose.waitUntil(60000){compose.onAllNodesWithText("正在建造世界").fetchSemanticsNodes().isEmpty()}
        compose.waitUntil(10000){!worldDiagnostic(world).isNull("navigation")}
        // Opening movement invalidates in-flight picks by design. Prepare a
        // settled map view before measuring actual touch/pivot interactions.
        compose.waitUntil(90000){val frame=worldDiagnostic(world,false)
            frame.optLong("gpuReadyFrames")>0&&!frame.optBoolean("fencePending")&&
                frame.isNull("pendingPresentation")&&!frame.getJSONObject("navigation").optBoolean("opening")}
        val initialFrames=worldDiagnostic(world,false).getLong("frames")
        compose.onNodeWithContentDescription("重置地图").performClick()
        compose.waitUntil(10000){val frame=worldDiagnostic(world,false)
            frame.getJSONObject("navigation").isNull("selected")&&frame.getLong("frames")>initialFrames}
        val business=checkNotNull(runtime.committedWorld).document.sha256;val before=worldDiagnostic(world)
        val device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        fun tap(id:String,requireExact:Boolean=true):String{
            val facts=worldDiagnostic(world);val rows=facts.getJSONObject("navigation").getJSONArray("targets")
            val target=(0 until rows.length()).map{rows.getJSONObject(it)}.single{it.getString("id")==id}
            val location=IntArray(2);InstrumentationRegistry.getInstrumentation().runOnMainSync{world.getLocationOnScreen(location)}
            val x=target.getDouble("x");val y=target.getDouble("y")
            assertTrue("Projected target must be inside the actual SurfaceView",x in 1.0..facts.getInt("surfaceWidth")-1.0&&y in 1.0..facts.getInt("surfaceHeight")-1.0)
            assertTrue("Tap must belong to the visible world projection",y>=facts.getInt("presentationTop")&&y<facts.getInt("presentationTop")+facts.getInt("presentationHeight"))
            val beforeCount=facts.getJSONObject("navigation").getLong("pickCount")
            check(device.click(location[0]+x.toInt(),location[1]+y.toInt()))
            compose.waitUntil(10000){worldDiagnostic(world).getJSONObject("navigation").getLong("pickCount")>beforeCount}
            val actual=worldDiagnostic(world).getJSONObject("navigation").getString("lastPickId")
            assertTrue("The real tap must hit a displayed building/reward",(0 until rows.length()).any{rows.getJSONObject(it).getString("id")==actual})
            if(requireExact)assertEquals(id,actual)
            compose.waitUntil(10000){worldDiagnostic(world).getJSONObject("navigation").optString("selected")==actual}
            return actual
        }
        fun choose(title:String){
            val actions=compose.onNodeWithContentDescription("聚落世界").fetchSemanticsNode().config[SemanticsActions.CustomActions]
            compose.runOnIdle{assertTrue(actions.single{it.label=="查看 $title"}.action())}
            compose.waitForIdle()
        }
        val firstHit=tap("work",requireExact=false)
        choose("写作工程")
        compose.onNodeWithContentDescription("关闭建筑记忆").assertIsDisplayed();screen("building-memory")
        val selected=worldDiagnostic(world)
        val location=IntArray(2);InstrumentationRegistry.getInstrumentation().runOnMainSync{world.getLocationOnScreen(location)}
        // The resident SurfaceView spans the window; only its projection window
        // is touchable above the normal-mode memory panel.
        val w=selected.getInt("surfaceWidth");val h=selected.getInt("presentationHeight")
        val top=selected.getInt("presentationTop")
        assertTrue(h>0)
        check(device.swipe(location[0]+w/4,location[1]+top+h*3/4,location[0]+w/2,location[1]+top+h*2/3,12))
        compose.waitUntil(10000){kotlin.math.abs(worldDiagnostic(world).getJSONObject("camera").getDouble("azimuth")-selected.getJSONObject("camera").getDouble("azimuth"))>.01}
        val rotated=worldDiagnostic(world);assertEquals("work",rotated.getJSONObject("navigation").getString("selected"))
        val surface=device.findObject(androidx.test.uiautomator.UiSelector().className("android.view.SurfaceView"))
        fun point(x:Int)=android.graphics.Point(location[0]+x,location[1]+top+h*2/3)
        check(surface.performTwoPointerGesture(point(w*3/8),point(w*5/8),point(w/8),point(w*7/8),12))
        compose.waitUntil(10000){val d=worldDiagnostic(world);kotlin.math.abs(d.getJSONObject("camera").getDouble("distance")-d.getJSONObject("navigation").getDouble("minimum"))<1e-6}
        val near=worldDiagnostic(world)
        check(surface.performTwoPointerGesture(point(w/8),point(w*7/8),point(w/2-1),point(w/2+1),12))
        compose.waitUntil(10000){val d=worldDiagnostic(world);kotlin.math.abs(d.getJSONObject("camera").getDouble("distance")-d.getJSONObject("navigation").getDouble("maximum"))<1e-6}
        val far=worldDiagnostic(world)
        assertEquals(selected.getJSONObject("navigation").getLong("pickCount"),far.getJSONObject("navigation").getLong("pickCount"))
        compose.onNodeWithContentDescription("关闭建筑记忆").performClick();compose.waitForIdle()
        val closed=worldDiagnostic(world);assertEquals(far.getJSONObject("camera").toString(),closed.getJSONObject("camera").toString())
        compose.onNodeWithContentDescription("重置视角").performClick();compose.waitForIdle()
        val reset=worldDiagnostic(world);assertEquals("work",reset.getJSONObject("navigation").getString("selected"))
        compose.onNodeWithContentDescription("重置地图").performClick();compose.waitForIdle()
        val map=worldDiagnostic(world);assertTrue(map.getJSONObject("navigation").isNull("selected"))
        assertEquals(before.getJSONObject("camera").getJSONArray("target").toString(),map.getJSONObject("camera").getJSONArray("target").toString())
        assertEquals(38*Math.PI/180,map.getJSONObject("camera").getDouble("pitch"),1e-9)
        assertEquals(business,checkNotNull(runtime.committedWorld).document.sha256)
        val habit=checkNotNull(runtime.latest.workspace).memories.archives.single{it.cycleNumber!=null}
        val habitTitle="${habit.title} · 第 ${habit.cycleNumber} 座"
        choose(habitTitle);compose.onAllNodesWithText("继续这个任务").assertCountEquals(0);screen("habit-memory")
        compose.onNodeWithContentDescription("关闭建筑记忆").performClick();nav("统计")
        compose.onNodeWithText("纪念建筑").performScrollTo().performClick()
        compose.onNodeWithText(habitTitle).performScrollTo().performClick()
        compose.onNode(hasText("10 轮") and hasAnySibling(hasText("完成轮次"))).performScrollTo().assertIsDisplayed();screen("habit-archive")
        nav("计时");choose("生日蛋糕")
        val reward=checkNotNull(runtime.latest.workspace).memories.rewards.single{it.kind==com.blockcolc.presentation.WorldAssetKind.BIRTHDAY}
        compose.onNodeWithText(reward.date.replace('-','.')+" 获得的建造奖励").assertIsDisplayed();tap(reward.id);screen("reward-memory")
        val rewardFrame=worldDiagnostic(world)
        assertEquals("blockcolc-native-pick",rewardFrame.getJSONObject("navigation").getString("pickThread"))
        assertFalse(rewardFrame.getJSONObject("navigation").getBoolean("pickPending"))
        compose.onNodeWithContentDescription("重置地图").performClick();compose.waitForIdle()
        assertEquals(business,checkNotNull(runtime.committedWorld).document.sha256)
        val stable=worldDiagnostic(world)
        assertEquals(before.getLong("presentationIdentity"),stable.getLong("presentationIdentity"))
        assertEquals(before.getJSONObject("ownerIdentities").getString("world"),stable.getJSONObject("ownerIdentities").getString("world"))
        choose("第二工程");compose.onNodeWithText("继续这个任务").performClick()
        compose.waitUntil(15000){runtime.latest.activeProject=="secondary"&&!runtime.latest.busy}
        compose.onAllNodesWithContentDescription("关闭建筑记忆").assertCountEquals(0)
        compose.waitUntil(30000){worldDiagnostic(world).getLong("presentationIdentity")!=stable.getLong("presentationIdentity")}
        val continued=worldDiagnostic(world);assertEquals("secondary",continued.getJSONObject("navigation").getString("selected"));assertSame(world,renderedWorld())
        File(context.filesDir,"p3-world-host-interaction.json").writeText(JSONObject().put("schema",1).put("caseLabel",group).put("before",before).put("selected",selected)
            .put("firstHit",firstHit).put("rotated",rotated).put("near",near).put("far",far).put("closed",closed).put("reset",reset).put("map",map).put("reward",rewardFrame).put("stable",stable).put("continued",continued).put("businessBefore",business)
            .put("businessAfterExplicitContinue",checkNotNull(runtime.committedWorld).document.sha256).put("scope","Actual Android taps, memory/archives/reward surfaces, pivot/reset and explicit continuation. Device identity, visual/source parity and phone performance use their separate evidence.").toString())
    }
    @Test fun outlinePreferencesWaitForTheWorldAndReplaceOnlyAffectedBuildingOwners()=run(partlyBuilt()){
        compose.waitUntil(60000){renderedWorld()!=null};val world=checkNotNull(renderedWorld())
        compose.waitUntil(60000){compose.onAllNodesWithText("正在建造世界").fetchSemanticsNodes().isEmpty()}
        val business=checkNotNull(runtime.committedWorld).document.sha256;val before=worldDiagnostic(world)
        fun choose(label:String,value:String,previous:JSONObject):JSONObject{
            nav("设置")
            if(compose.onAllNodesWithText("施工轮廓").fetchSemanticsNodes().isEmpty())compose.onNodeWithText("世界").performScrollTo().performClick()
            compose.onNodeWithText(label).performScrollTo().performClick()
            compose.waitUntil(10000){!runtime.latest.preferencesSaving&&runtime.latest.preferences.constructionOutlineVisibility==value}
            val hidden=worldDiagnostic(world)
            assertEquals(previous.getJSONObject("ownerIdentities").toString(),hidden.getJSONObject("ownerIdentities").toString())
            nav("计时")
            compose.waitUntil(30000){val next=worldDiagnostic(world)
                next.getLong("presentationIdentity")!=previous.getLong("presentationIdentity")&&next.getLong("gpuReadyFrames")>previous.getLong("gpuReadyFrames")&&next.isNull("pendingPresentation")}
            return worldDiagnostic(world)
        }
        val all=choose("全部","all",before);screen("world-outline-all")
        assertEquals(before.getJSONObject("ownerIdentities").getString("building:work"),all.getJSONObject("ownerIdentities").getString("building:work"))
        assertNotEquals(before.getJSONObject("ownerIdentities").getString("building:habit"),all.getJSONObject("ownerIdentities").getString("building:habit"))
        val off=choose("关闭","off",all);screen("world-outline-off")
        val current=choose("当前","current",off);screen("world-outline-current")
        assertEquals(off.getJSONObject("ownerIdentities").getString("building:habit"),current.getJSONObject("ownerIdentities").getString("building:habit"))
        fun count(value:JSONObject,owner:String):Int{val rows=value.getJSONObject("resources").getJSONObject("owners").getJSONArray(owner)
            return (0 until rows.length()).sumOf{rows.getJSONObject(it).getInt("instances")}}
        assertTrue(count(all,"building:habit")>count(off,"building:habit"));assertTrue(count(all,"building:work")>count(off,"building:work"))
        assertEquals(count(before,"building:work"),count(current,"building:work"))
        assertEquals(business,checkNotNull(runtime.committedWorld).document.sha256)
        for(next in listOf(all,off,current)){
            assertFalse(next.getBoolean("failed"));assertEquals(before.getJSONObject("camera").toString(),next.getJSONObject("camera").toString())
            assertEquals(before.getJSONObject("resources").getJSONObject("owners").get("world").toString(),next.getJSONObject("resources").getJSONObject("owners").get("world").toString())
        }
        val label=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
        File(context.filesDir,"p3-world-host-outlines.json").writeText(JSONObject().put("schema",1).put("caseLabel",label).put("before",before)
            .put("all",all).put("off",off).put("current",current).put("businessUnchanged",true).put("deferredUntilWorld",true)
            .put("scope","Actual outline preference controls, hidden-world deferral and stable unaffected building/terrain owners; full appearance remains separate.").toString())
    }
    @Test fun debugConditionRestoresBuildingPacketsWithoutChangingTheBusinessDocumentOrTerrain()=run(partlyBuilt()){
        compose.waitUntil(60000){renderedWorld()!=null};val world=checkNotNull(renderedWorld())
        compose.waitUntil(60000){compose.onAllNodesWithText("正在建造世界").fetchSemanticsNodes().isEmpty()}
        val business=checkNotNull(runtime.committedWorld).document.sha256;val before=worldDiagnostic(world)
        val work="building:work";val baseline=before.getJSONObject("ownerIdentities")
        nav("设置");compose.onNodeWithText("画面调试").performScrollTo().performClick()
        compose.onNodeWithText("腐败").performScrollTo().performClick()
        compose.onNodeWithContentDescription("世界调试腐败程度").performScrollTo().performSemanticsAction(SemanticsActions.SetProgress){it(100f)}
        nav("计时")
        compose.waitUntil(30000){val value=worldDiagnostic(world)
            value.getJSONObject("ownerIdentities").getString(work)!=baseline.getString(work)&&value.getLong("gpuReadyFrames")>before.getLong("gpuReadyFrames")&&value.isNull("pendingPresentation")}
        val damaged=worldDiagnostic(world);screen("world-debug-decay")
        nav("设置");compose.onNodeWithText("画面调试").performScrollTo().performClick();nav("计时")
        compose.waitUntil(30000){val value=worldDiagnostic(world)
            value.getJSONObject("ownerIdentities").getString(work)!=damaged.getJSONObject("ownerIdentities").getString(work)&&value.getLong("gpuReadyFrames")>damaged.getLong("gpuReadyFrames")&&value.isNull("pendingPresentation")}
        val restored=worldDiagnostic(world);screen("world-debug-decay-restored")
        fun buildingShape(value:JSONObject):List<String>{val packets=value.getJSONObject("resources").getJSONObject("owners").getJSONArray(work)
            return (0 until packets.length()).map{index->val packet=packets.getJSONObject(index)
                "${packet.getString("geometry")}|${packet.getString("texture")}|${packet.getInt("instances")}"}}
        assertEquals(buildingShape(before),buildingShape(restored))
        assertEquals(business,checkNotNull(runtime.committedWorld).document.sha256)
        for(value in listOf(damaged,restored)){
            assertFalse(value.getBoolean("failed"));assertEquals(0L,value.getLong("environmentFailures"))
            assertEquals(before.getJSONObject("camera").toString(),value.getJSONObject("camera").toString())
            assertEquals(before.getJSONObject("resources").getJSONObject("owners").get("world").toString(),value.getJSONObject("resources").getJSONObject("owners").get("world").toString())
            assertEquals(before.getLong("revision"),value.getLong("revision"))
        }
        val label=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
        File(context.filesDir,"p3-world-host-decay-debug.json").writeText(JSONObject().put("schema",1).put("caseLabel",label)
            .put("before",before).put("damaged",damaged).put("restored",restored).put("businessUnchanged",true)
            .put("scope","Actual native weathering control, building packet replacement/restoration, retained terrain/camera and unchanged committed business document; vine/outline and full appearance acceptance remain separate.").toString())
    }
    @Test fun generatedWorldBecomesReadyAndSurvivesNavigationAndThemeWithoutGpuRebuild()=run{
        compose.waitUntil(60000){renderedWorld()!=null}
        val world=checkNotNull(renderedWorld())
        try{compose.waitUntil(60000){compose.onAllNodesWithText("正在建造世界").fetchSemanticsNodes().isEmpty()}}
        catch(error:Throwable){
            val diagnostic=worldDiagnostic(world);diagnostic.remove("resources")
            throw AssertionError("Default world did not become visible: $diagnostic",error)
        }
        compose.waitUntil(10000){worldDiagnostic(world,false).getLong("environmentUpdates")>0}
        val before=worldDiagnostic(world)
        assertFalse(before.getBoolean("failed"));assertTrue(before.getLong("gpuReadyFrames")>0)
        compose.onNodeWithContentDescription("聚落世界").assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription,"世界已就绪"))
        assertEquals("native-generated",before.getString("sourceKind"))
        val waitingAt=android.os.SystemClock.elapsedRealtime()
        compose.waitUntil(70000){
            val current=worldDiagnostic(world,false)
            current.getLong("environmentUpdates")>before.getLong("environmentUpdates")&&current.optJSONObject("navigation")?.optBoolean("opening")==false
        }
        val timed=worldDiagnostic(world)
        assertEquals(0L,timed.getLong("environmentFailures"))
        for(key in listOf("owners","geometries","textures"))assertEquals(key,before.getJSONObject("resources").getJSONObject(key).toString(),timed.getJSONObject("resources").getJSONObject(key).toString())
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
        java.io.File(context.filesDir,"p3-world-host-environment.json").writeText(JSONObject().put("schema",1).put("caseLabel",group)
            .put("firstUpdates",before.getLong("environmentUpdates")).put("timedUpdates",timed.getLong("environmentUpdates"))
            .put("waitMs",android.os.SystemClock.elapsedRealtime()-waitingAt).put("failures",timed.getLong("environmentFailures"))
            .put("resourceIdentitiesUnchanged",true).put("scope","Actual visible host first-frame and minute refresh; not a startup/performance sample").toString())
        nav("设置");runtime.updatePreferences{it.copy(themeMode="light")}
        compose.waitUntil(10000){runtime.latest.preferences.themeMode=="light"&&!runtime.latest.preferencesSaving}
        val leaving=worldDiagnostic(world)
        InstrumentationRegistry.getInstrumentation().runOnMainSync{
            assertEquals(android.view.View.VISIBLE,world.visibility)
            assertFalse(world.isEnabled)
            val now=android.os.SystemClock.uptimeMillis()
            val event=android.view.MotionEvent.obtain(now,now,android.view.MotionEvent.ACTION_DOWN,100f,100f,0)
            try{assertFalse(world.onTouchEvent(event))}finally{event.recycle()}
        }
        nav("计时")
        // A retained scene on the same live Surface does not need another
        // scene-adoption receipt. It must still submit a new visible frame;
        // a different Surface ticket additionally needs its own GPU receipt.
        compose.waitUntil(60000){val current=worldDiagnostic(world)
            current.getBoolean("active")&&current.getBoolean("surfaceShown")&&current.getBoolean("swapReady")&&current.getLong("frames")>leaving.getLong("frames")&&
                (current.optLong("surfaceTicket",-1)==before.optLong("surfaceTicket",-2)||current.getLong("gpuReadyFrames")>before.getLong("gpuReadyFrames"))}
        compose.waitUntil(60000){compose.onAllNodesWithText("正在建造世界").fetchSemanticsNodes().isEmpty()}
        assertSame(world,renderedWorld());val after=worldDiagnostic(world)
        assertFalse(after.getBoolean("failed"))
        assertEquals("Page navigation must retain its Surface lease",before.getLong("surfaceTicket"),after.getLong("surfaceTicket"))
        assertEquals(before.getLong("windowDetaches"),after.getLong("windowDetaches"))
        assertEquals(before.getLong("windowChanges"),after.getLong("windowChanges"))
        assertTrue(world.isEnabled)
        assertEquals(before.getLong("presentationIdentity"),after.getLong("presentationIdentity"))
        assertEquals(timed.getJSONObject("camera").toString(),after.getJSONObject("camera").toString())
        for(key in listOf("owners","geometries","textures"))assertEquals(key,before.getJSONObject("resources").getJSONObject(key).toString(),after.getJSONObject("resources").getJSONObject(key).toString())
        val environmentFile=java.io.File(context.filesDir,"p3-world-host-environment.json")
        environmentFile.writeText(JSONObject(environmentFile.readText()).put("frameCountBeforeReturn",leaving.getLong("frames")).put("frameCountAfterReturn",after.getLong("frames"))
            .put("samePresentationAfterReturn",true).put("sameWindowAfterReturn",after.optLong("surfaceTicket",-1)==before.optLong("surfaceTicket",-2))
            .put("gpuReadyBeforeReturn",before.getLong("gpuReadyFrames")).put("gpuReadyAfterReturn",after.getLong("gpuReadyFrames")).toString())
        screen("generated-world-ready")
        // Inject only the renderer's public status delivery, not a device/driver
        // failure. Retry must create a new lease; the retired callback cannot
        // subsequently break that replacement.
        @Suppress("UNCHECKED_CAST")
        val retiredStatus=NativeWorldView::class.java.getDeclaredField("status").let{field->field.isAccessible=true;field.get(world) as (String)->Unit}
        InstrumentationRegistry.getInstrumentation().runOnMainSync{retiredStatus("NATIVE_UPDATE_ERROR")}
        compose.onNodeWithText("世界暂未准备好").assertExists()
        compose.onNodeWithContentDescription("聚落世界").assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription,"正在建造世界"))
        compose.onNodeWithText("重试").performClick()
        compose.onNodeWithTag("workspace-ready").assertExists()
        compose.waitUntil(60000){renderedWorld()?.let{it!==world}==true}
        compose.waitUntil(60000){compose.onAllNodesWithText("正在建造世界").fetchSemanticsNodes().isEmpty()}
        val recovered=checkNotNull(renderedWorld())
        val readyState=SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription,"世界已就绪")
        compose.waitUntil(30000){
            val current=worldDiagnostic(recovered,false)
            current.getLong("gpuReadyFrames")>0&&current.optJSONObject("navigation")?.optBoolean("opening")==false&&
                compose.onAllNodes(hasContentDescription("聚落世界") and readyState).fetchSemanticsNodes().size==1
        }
        val recovery=worldDiagnostic(recovered)
        assertTrue(recovery.getLong("gpuReadyFrames")>0);assertFalse(recovery.getBoolean("failed"))
        compose.onNodeWithContentDescription("聚落世界").assert(readyState)
        assertEquals(timed.getJSONObject("camera").toString(),recovery.getJSONObject("camera").toString())
        InstrumentationRegistry.getInstrumentation().runOnMainSync{retiredStatus("ERROR: retired test callback")}
        compose.waitForIdle();compose.onNodeWithText("世界暂未准备好").assertDoesNotExist()
        screen("generated-world-recovered")
    }
    @Test fun worldColourPreferenceUpdatesTheStableHostWithoutWorldPreparation()=run{
        compose.waitUntil(60000){renderedWorld()!=null}
        val world=checkNotNull(renderedWorld())
        compose.waitUntil(60000){compose.onAllNodesWithText("正在建造世界").fetchSemanticsNodes().isEmpty()}
        compose.waitUntil(10000){worldDiagnostic(world).getLong("environmentUpdates")>0}
        val before=worldDiagnostic(world)
        fun change(saturation:Int,brightness:Int,contrast:Int){
            runtime.updatePreferences{it.copy(worldColorAdjustment=com.blockcolc.presentation.WorldColor(saturation,brightness,contrast))}
            compose.waitUntil(10000){!runtime.latest.preferencesSaving&&runtime.latest.preferences.worldColorAdjustment.saturation==saturation}
            compose.waitUntil(10000){worldDiagnostic(world).getJSONObject("colorPipeline").getJSONObject("config").getInt("saturation")==saturation}
        }
        change(50,110,120);val first=worldDiagnostic(world);screen("world-colour-first")
        nav("设置");change(150,90,85);nav("计时")
        compose.waitUntil(60000){compose.onAllNodesWithText("正在建造世界").fetchSemanticsNodes().isEmpty()}
        assertSame(world,renderedWorld());val resumed=worldDiagnostic(world);screen("world-colour-resumed")
        for(next in listOf(first,resumed)){
            assertFalse(next.getBoolean("failed"));assertEquals(before.getLong("presentationIdentity"),next.getLong("presentationIdentity"))
            assertEquals(before.getJSONObject("camera").toString(),next.getJSONObject("camera").toString())
            for(key in listOf("owners","geometries","textures"))assertEquals(key,before.getJSONObject("resources").getJSONObject(key).toString(),next.getJSONObject("resources").getJSONObject(key).toString())
            assertEquals(before.getJSONObject("colorPipeline").getInt("targetsCreated"),next.getJSONObject("colorPipeline").getInt("targetsCreated"))
            assertEquals(before.getJSONObject("colorPipeline").getJSONObject("config").getInt("sourceTexture"),next.getJSONObject("colorPipeline").getJSONObject("config").getInt("sourceTexture"))
        }
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
        File(context.filesDir,"p3-world-host-color.json").writeText(JSONObject().put("schema",1).put("caseLabel",group).put("before",before).put("first",first).put("resumed",resumed)
            .put("scope","Real preference subscription and stable Compose world host; no UI button or performance approval").toString())
    }
    @Test fun paperQualityFromSettingsReachesBothTimerModesWithSameFrameGlass()=run(configure={
        it.copy(lightingQuality="performance",minimalMode=false,focusGlassTransparency=100)
    }){
        nav("设置")
        val paper=compose.onNodeWithText("纸雕").performScrollTo()
        val smooth=compose.onNodeWithText("流畅")
        assertTrue(paper.fetchSemanticsNode().boundsInRoot.left<smooth.fetchSemanticsNode().boundsInRoot.left)
        compose.onNodeWithText("极简模式").performScrollTo().performClick()
        compose.waitUntil(10000){!runtime.latest.preferencesSaving&&runtime.latest.preferences.minimalMode}
        paper.performScrollTo().performClick()
        // Return before waiting for a disk receipt or for the world to finish.
        compose.onNodeWithContentDescription("计时").performClick()
        compose.waitUntil(10000){!runtime.latest.preferencesSaving&&runtime.latest.preferences.lightingQuality=="paper"}
        compose.onNodeWithTag("formal-normal-workbench").assertIsDisplayed()
        fun ready():JSONObject {
            var selected=JSONObject()
            compose.waitUntil(90000){renderedWorld()?.let{world->
                selected=worldDiagnostic(world,false)
                selected.optLong("gpuReadyFrames")>0&&selected.isNull("pendingPresentation")&&!selected.optBoolean("failed")&&
                    selected.optJSONObject("colorPipeline")?.optJSONObject("config")?.optInt("sampleCount")==1
            }==true}
            return selected
        }
        val ordinary=ready()
        val world=checkNotNull(renderedWorld())
        compose.waitUntilDoesNotExist(hasText("准备世界…"),20000)
        screen("paper-ordinary")
        compose.onNodeWithText("极简").performClick()
        compose.waitUntilDoesNotExist(hasTestTag("mode-transition"),20000)
        compose.onNodeWithTag("formal-minimal-panel").assertIsDisplayed()
        compose.waitUntil(15000){
            worldDiagnostic(world,false).getJSONObject("colorPipeline").optInt("glassRegions")>0
        }
        val minimal=ready()
        assertEquals("same-frame-gpu",minimal.getJSONObject("colorPipeline").getString("glassSampling"))
        assertEquals(ordinary.getLong("presentationIdentity"),minimal.getLong("presentationIdentity"))
        screen("paper-minimal")
        compose.onNodeWithTag("formal-minimal-panel").performTouchInput{doubleClick(Offset(width*.5f,height*.94f))}
        compose.onNodeWithText("返回普通模式").performClick()
        compose.waitUntilDoesNotExist(hasTestTag("mode-transition"),20000)
        compose.onNodeWithTag("formal-normal-workbench").assertIsDisplayed()
        assertSame(world,renderedWorld())
        assertEquals(ordinary.getLong("presentationIdentity"),ready().getLong("presentationIdentity"))
        compose.waitUntilDoesNotExist(hasText("准备世界…"),20000)
    }
    @Test fun pixelQualityKeepsThePaperSceneAcrossSettingsAndImmersiveModes()=run(configure={
        it.copy(lightingQuality="paper",minimalMode=false,focusGlassTransparency=100,themeMode="light")
    }){
        fun ready(pixel:Boolean,glass:Boolean=false):JSONObject {
            var state=JSONObject()
            compose.waitUntil(90000){renderedWorld()?.let{world->
                state=worldDiagnostic(world,false)
                val pipeline=state.optJSONObject("colorPipeline")
                state.optLong("gpuReadyFrames")>0&&!state.optBoolean("failed")&&state.isNull("pendingPresentation")&&
                    !state.optBoolean("fencePending")&&state.optJSONObject("navigation")?.optBoolean("opening")==false&&
                    pipeline!=null&&pipeline.optJSONObject("config")?.optBoolean("pixel")==pixel&&(!glass||pipeline.optInt("glassRegions")>0)
            }==true}
            return state
        }
        // Wait for the host to adopt the initial frame, including any cold
        // startup world updates, before measuring a display-only change.
        compose.waitUntilAtLeastOneExists(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"世界已就绪"),90000)
        val paper=ready(false).getLong("presentationIdentity")
        val world=checkNotNull(renderedWorld())
        fun quality(label:String,value:String){
            nav("设置");compose.onNodeWithText(label).performScrollTo().performClick();nav("计时")
            compose.waitUntil(10000){!runtime.latest.preferencesSaving&&runtime.latest.preferences.lightingQuality==value}
        }
        quality("像素","pixel")
        val pixels=ready(true)
        assertSame(world,renderedWorld());assertEquals(paper,pixels.getLong("presentationIdentity"))
        screen("pixel-ordinary")
        runtime.updatePreferences{it.copy(minimalMode=true)}
        compose.waitUntil(10000){runtime.latest.preferences.minimalMode&&!runtime.latest.preferencesSaving}
        compose.onNodeWithText("极简").performClick()
        compose.waitUntilDoesNotExist(hasTestTag("mode-transition"),20000)
        compose.onNodeWithTag("formal-minimal-panel").assertIsDisplayed()
        assertEquals(paper,ready(true,glass=true).getLong("presentationIdentity"))
        screen("pixel-minimal")
        compose.onNodeWithTag("formal-minimal-panel").performTouchInput{doubleClick(Offset(width*.5f,height*.94f))}
        compose.onNodeWithText("返回普通模式").performClick()
        compose.waitUntilDoesNotExist(hasTestTag("mode-transition"),20000)
        quality("纸雕","paper")
        assertEquals(paper,ready(false).getLong("presentationIdentity"))
        quality("像素","pixel")
        assertEquals(paper,ready(true).getLong("presentationIdentity"))
        compose.onNodeWithText("开始 1 轮").performClick()
        compose.waitUntil(10000){runtime.latest.phase=="FOCUS"}
        compose.onNodeWithTag("formal-focus-time").assertIsDisplayed()
        ready(true,glass=true)
        screen("pixel-focus")
    }
    @Test fun returningToTimerAfterASettlementChangePresentsTheNewWorld()=run(configure={it.copy(lightingQuality="performance")}){
        val initialEnvironment=runtime.latest.workspace?.settings?.environment
        val target=if(initialEnvironment=="mosaic-coast") "山谷" else "海岸"
        val expected=if(initialEnvironment=="mosaic-coast") "natural-valley" else "mosaic-coast"
        val worldReady=SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"世界已就绪")
        compose.waitUntilAtLeastOneExists(worldReady,60000)
        nav("设置")
        compose.onNodeWithText(target).performScrollTo().performClick()
        val timerTab=compose.onNodeWithContentDescription("计时")
        compose.waitUntil(10000){runCatching{timerTab.assertIsEnabled()}.isSuccess}
        timerTab.performClick()
        compose.waitUntil(60000){runtime.latest.workspace?.settings?.environment==expected}
        compose.waitUntilAtLeastOneExists(worldReady,90000)
        compose.onNodeWithTag("formal-normal-workbench").assertIsDisplayed()
        screen("settlement-after-quick-return")
    }
    @Test fun debugWeatherAndClockRestoreNormalFactsWithoutReplacingStaticWorldOwners()=run{
        compose.waitUntil(60000){renderedWorld()!=null}
        val world=checkNotNull(renderedWorld())
        compose.waitUntil(60000){compose.onAllNodesWithText("正在建造世界").fetchSemanticsNodes().isEmpty()}
        compose.waitUntil(15000){
            val frame=worldDiagnostic(world,false)
            val navigation=frame.optJSONObject("navigation")
            frame.getLong("environmentUpdates")>0&&navigation?.optString("selected")=="work"&&!navigation.getBoolean("opening")
        }
        val owner=AtomicReference<com.blockcolc.preview.environment.NativeEnvironmentSession>()
        InstrumentationRegistry.getInstrumentation().runOnMainSync{owner.set(com.blockcolc.preview.environment.NativeEnvironmentSession.get(context,runtime,com.blockcolc.audio.NativeAudioController.get(context)))}
        fun facts():com.blockcolc.world.NativeAtmosphereFacts?{val result=AtomicReference<com.blockcolc.world.NativeAtmosphereFacts?>()
            InstrumentationRegistry.getInstrumentation().runOnMainSync{result.set(owner.get().latest)};return result.get()}
        fun wire(value:com.blockcolc.world.NativeAtmosphereFacts)=JSONObject().put("time",value.time).put("visualTime",value.visualTime)
            .put("minutes",value.inputs.timeMinutes?:JSONObject.NULL).put("weather",value.weather.kind.wire).put("thunderstorm",value.weather.thunderstorm)
        val original=checkNotNull(facts());assertNull(original.inputs.timeMinutes)
        val before=worldDiagnostic(world)
        nav("设置")
        compose.onNodeWithText("画面调试").performScrollTo().performClick()
        compose.onNodeWithText("雷雨").performScrollTo().performClick()
        compose.onNodeWithText("指定时间").performScrollTo().performClick()
        compose.onNodeWithContentDescription("世界调试时间").performScrollTo().performSemanticsAction(SemanticsActions.SetProgress){it(180f)}
        compose.waitUntil(10000){facts()?.inputs?.timeMinutes==900&&facts()?.weather?.thunderstorm==true}
        val debugFacts=checkNotNull(facts());assertEquals(original.inputs.coordinates,debugFacts.inputs.coordinates)
        nav("计时")
        compose.waitUntil(30000){val value=worldDiagnostic(world);value.getLong("environmentUpdates")>before.getLong("environmentUpdates")&&value.getLong("frames")>before.getLong("frames")}
        compose.waitUntil(25000){val resources=worldDiagnostic(world).getJSONObject("resources")
            resources.getLong("lightningStrikeCount")>=2&&resources.getBoolean("lightningActive")}
        val storm=worldDiagnostic(world);screen("world-debug-storm")
        val stormResources=storm.getJSONObject("resources")
        assertEquals(1,stormResources.getInt("lightningPackets"))
        assertTrue(stormResources.getInt("lightningInstanceUploads")>=2)
        assertTrue(stormResources.getBoolean("lightningActive"))
        val flash=stormResources.getJSONObject("stormFlash")
        assertTrue(flash.getInt("entity")!=0);assertTrue(flash.getInt("cloudBindings")>0)
        assertTrue(flash.getDouble("intensityCandela")>0);assertTrue(flash.getDouble("peakCandela")>2)
        assertEquals(28.0,flash.getDouble("actualRange"),1e-5)
        // The pinned native implementation returns the stored point-light
        // candela value; its Java getter's lumen Javadoc is misleading.
        assertEquals(flash.getDouble("intensityCandela"),flash.getDouble("actualIntensityCandela"),1e-5)
        assertNotEquals(before.getString("cloudOwnerIdentity"),storm.getString("cloudOwnerIdentity"))
        assertNotEquals(before.getString("precipitationOwnerIdentity"),storm.getString("precipitationOwnerIdentity"))
        nav("设置");compose.onNodeWithText("画面调试").performScrollTo().performClick()
        compose.waitUntil(10000){facts()?.inputs==original.inputs}
        val normalFacts=checkNotNull(facts());assertEquals(normalFacts.time,normalFacts.visualTime)
        nav("计时")
        compose.waitUntil(30000){val value=worldDiagnostic(world);value.getLong("environmentUpdates")>storm.getLong("environmentUpdates")&&value.getLong("frames")>storm.getLong("frames")}
        compose.waitUntil(10000){!worldDiagnostic(world).getJSONObject("resources").getBoolean("lightningActive")}
        val normal=worldDiagnostic(world);screen("world-debug-normal")
        val normalStrikes=normal.getJSONObject("resources").getLong("lightningStrikeCount")
        val normalFlash=normal.getJSONObject("resources").getJSONObject("stormFlash")
        assertEquals(flash.getInt("entity"),normalFlash.getInt("entity"))
        assertEquals(0.0,normalFlash.getDouble("actualIntensityCandela"),0.0)
        android.os.SystemClock.sleep(1800)
        assertEquals(normalStrikes,worldDiagnostic(world).getJSONObject("resources").getLong("lightningStrikeCount"))
        val owners=before.getJSONObject("resources").getJSONObject("owners")
        val static=owners.keys().asSequence().filter{it=="world"||it.startsWith("building:")||it.startsWith("reward:")}.toList()
        assertTrue(static.size>=3)
        for(next in listOf(storm,normal)){
            assertFalse(next.getBoolean("failed"));assertEquals(0L,next.getLong("environmentFailures"))
            assertEquals(before.getLong("presentationIdentity"),next.getLong("presentationIdentity"))
            assertEquals(before.getJSONObject("camera").toString(),next.getJSONObject("camera").toString())
            for(key in static)assertEquals(key,owners.get(key).toString(),next.getJSONObject("resources").getJSONObject("owners").get(key).toString())
        }
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
        File(context.filesDir,"p3-world-host-debug.json").writeText(JSONObject().put("schema",1).put("caseLabel",group)
            .put("before",before).put("storm",storm).put("normal",normal).put("initialFacts",wire(original))
            .put("debugFacts",wire(debugFacts)).put("restoredFacts",wire(normalFacts)).put("staticOwnerCount",static.size)
            .put("lightningStrikesObserved",stormResources.getLong("lightningStrikeCount"))
            .put("lightningClearedAfterDebug",true)
            .put("scope","Actual native debug controls, scheduled bolt rendering, finite point-light binding and retained world; full illumination appearance, corruption, visual polish and service success are separate.").toString())
    }
    @Test fun cancellingTheRealAudioDocumentPickerKeepsTheLibrarySelectionAndSavedFacts()=run{
        val audio=AtomicReference<com.blockcolc.audio.NativeAudioController>()
        InstrumentationRegistry.getInstrumentation().runOnMainSync{audio.set(com.blockcolc.audio.NativeAudioController.get(context))}
        fun library():com.blockcolc.audio.AudioLibraryState{val result=AtomicReference<com.blockcolc.audio.AudioLibraryState>()
            InstrumentationRegistry.getInstrumentation().runOnMainSync{result.set(audio.get().snapshot())};return result.get()}
        compose.waitUntil(10000){!library().busy};assertNull(library().error)
        val before=library().items.map{it.id}.sorted();var pickerPackage:String?=null;var failure:Throwable?=null
        try{
            runtime.updatePreferences{it.copy(ambience=it.ambience.copy(enabled=true,volume=0,rainEnabled=false))}
            compose.waitUntil(10000){!runtime.latest.preferencesSaving&&runtime.latest.preferences.ambience.enabled&&runtime.latest.preferences.ambience.volume==0}
            val primary=runtime.latest.preferences.ambience.primary
            nav("设置");compose.onNodeWithText("白噪音").performScrollTo().performClick()
            compose.onNodeWithText("导入音频").performScrollTo().performClick()
            val device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            val deadline=android.os.SystemClock.elapsedRealtime()+15000
            while(device.currentPackageName==context.packageName&&android.os.SystemClock.elapsedRealtime()<deadline)android.os.SystemClock.sleep(100)
            pickerPackage=device.currentPackageName
            assertNotNull("The system document picker did not become visible",pickerPackage)
            assertNotEquals(context.packageName,pickerPackage)
            assertTrue(device.pressBack())
            assertTrue("Cancelling the picker did not restore the native page",device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.pkg(context.packageName)),10000))
            compose.waitForIdle();compose.onNodeWithText("导入音频").assertIsDisplayed().assertIsEnabled()
            compose.waitUntil(10000){!library().busy}
            assertNull(library().error);assertEquals(before,library().items.map{it.id}.sorted())
            assertEquals(primary,runtime.latest.preferences.ambience.primary);assertEquals(0,runtime.latest.preferences.ambience.volume)
            screen("audio-picker-cancel")
        }catch(error:Throwable){failure=error;throw error}
        finally{
            try{
                runtime.updatePreferences{it.copy(ambience=com.blockcolc.presentation.Ambience(volume=0))}
                compose.waitUntil(10000){!runtime.latest.preferencesSaving&&!runtime.latest.preferences.ambience.enabled&&!com.blockcolc.audio.AmbientAudioHost.snapshot().active}
            }catch(cleanup:Throwable){if(failure!=null)failure.addSuppressed(cleanup)else throw cleanup}
            val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
            File(context.filesDir,"p3-world-audio-picker.json").writeText(JSONObject().put("schema",1).put("caseLabel",group)
                .put("pickerPackage",pickerPackage?:JSONObject.NULL).put("libraryEntriesBefore",before.size).put("libraryEntriesAfter",library().items.size)
                .put("mainVolume",0).put("mediaStopped",!com.blockcolc.audio.AmbientAudioHost.snapshot().active)
                .put("completed",failure==null).put("scope","Actual Android OpenDocument cancellation through the native App; no document selected or imported.").toString())
        }
    }
    @Test @androidx.test.filters.SdkSuppress(minSdkVersion=29) @android.annotation.TargetApi(29)
    fun realAudioPickerImportPlaysTheOwnedFileAndDeletionWaitsForSavedPreferences()=run{
        val resolver=context.contentResolver
        val audio=AtomicReference<com.blockcolc.audio.NativeAudioController>()
        InstrumentationRegistry.getInstrumentation().runOnMainSync{audio.set(com.blockcolc.audio.NativeAudioController.get(context))}
        fun library()=audio.get().snapshot()
        compose.waitUntil(10000){!library().busy};assertNull(library().error)
        val originalItems=library().items.map{it.id}.toSet();assertTrue("Leave room for one isolated picker input",originalItems.size<8)
        val indexNames=listOf("ambient-library.json","ambient-library.json.bak","ambient-library.json.new")
        val index=indexNames.associateWith{File(context.filesDir,it).takeIf(File::isFile)?.readBytes()}
        val folder=File(context.filesDir,"ambient-imports");val existed=folder.exists();val originals=folder.list()?.toSet().orEmpty()
        val playbackPrefs=context.getSharedPreferences("blockcolc_ambient_playback",0);val oldPlayback=playbackPrefs.all.toMap()
        val stem="blockcolc-p3-"+UUID.randomUUID().toString().take(12);val title="$stem.wav"
        val pcm=java.nio.ByteBuffer.allocate(32044).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        pcm.put("RIFF".toByteArray()).putInt(32036).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1)
            .putInt(8000).putInt(16000).putShort(2).putShort(16).put("data".toByteArray()).putInt(32000)
        // Unique silent fixture, never a recording from the user's library.
        pcm.putLong(32036,UUID.randomUUID().leastSignificantBits)
        val source=pcm.array();val sourceId=MessageDigest.getInstance("SHA-256").digest(source).joinToString(""){"%02x".format(it.toInt()and 255)}
        assertFalse(sourceId in originalItems||sourceId in originals)
        var owned:android.net.Uri?=null;var failure:Throwable?=null;var imported=false;var played=false;var deleted=false;var externalRemoved=false;var restored=false
        try{
            val values=android.content.ContentValues().apply{
                put(android.provider.MediaStore.Audio.Media.DISPLAY_NAME,title);put(android.provider.MediaStore.Audio.Media.MIME_TYPE,"audio/wav")
                put(android.provider.MediaStore.Audio.Media.RELATIVE_PATH,android.os.Environment.DIRECTORY_MUSIC+"/blockcolc-preview-test")
                put(android.provider.MediaStore.Audio.Media.IS_PENDING,1);put(android.provider.MediaStore.Audio.Media.IS_MUSIC,1)
            }
            owned=checkNotNull(resolver.insert(android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,values))
            checkNotNull(resolver.openOutputStream(owned!!,"w")).use{it.write(source)}
            assertEquals(1,resolver.update(owned!!,android.content.ContentValues().apply{put(android.provider.MediaStore.Audio.Media.IS_PENDING,0)},null,null))
            runtime.updatePreferences{it.copy(ambience=it.ambience.copy(enabled=true,volume=0,rainEnabled=false))}
            compose.waitUntil(10000){!runtime.latest.preferencesSaving&&runtime.latest.preferences.ambience.enabled&&runtime.latest.preferences.ambience.volume==0}
            nav("设置");compose.onNodeWithText("白噪音").performScrollTo().performClick()
            compose.onNodeWithText("导入音频").performScrollTo().performClick()
            val device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            val row=device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.textContains(stem)),10000)
            assertNotNull("The picker did not expose the owned media fixture",row);row.click()
            if(!device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.pkg(context.packageName)),1500)){
                val confirm=device.findObject(androidx.test.uiautomator.By.text(java.util.regex.Pattern.compile("确定|完成|选择|Select|Done|OK")))
                assertNotNull("The picker selection did not return or expose a confirm action",confirm);confirm.click()
            }
            assertTrue(device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.pkg(context.packageName)),10000))
            compose.waitUntil(25000){!library().busy&&library().items.any{it.id==sourceId}}
            assertNull(library().error);val item=library().items.single{it.id==sourceId};assertEquals(32044L,item.bytes);assertTrue(item.durationMs in 1900..2100);imported=true
            compose.waitUntil(10000){!runtime.latest.preferencesSaving&&runtime.latest.preferences.ambience.primary==sourceId}
            compose.waitUntil(10000){val state=com.blockcolc.audio.AmbientAudioHost.snapshot();state.primary==sourceId&&state.mainReady};played=true
            assertEquals(0,runtime.latest.preferences.ambience.volume)
            compose.onNodeWithContentDescription("删除音频：$title").performScrollTo().performClick()
            compose.onNodeWithText("删除").performScrollTo().performClick()
            compose.waitUntil(15000){!library().busy&&library().items.none{it.id==sourceId}&&!runtime.latest.preferencesSaving}
            assertNull(library().error);assertFalse(runtime.latest.preferences.ambience.enabled);assertEquals("forest-birds",runtime.latest.preferences.ambience.primary)
            assertFalse(File(folder,sourceId).exists());assertEquals(originalItems,library().items.map{it.id}.toSet());deleted=true
            screen("audio-picker-import-deleted")
        }catch(error:Throwable){failure=error;throw error}
        finally{
            try{
                runtime.updatePreferences{it.copy(ambience=com.blockcolc.presentation.Ambience(volume=0))}
                compose.waitUntil(30000){!runtime.latest.preferencesSaving&&!runtime.latest.preferences.ambience.enabled&&!library().busy&&!com.blockcolc.audio.AmbientAudioHost.snapshot().active}
                for((name,bytes)in index){val file=File(context.filesDir,name);if(bytes==null)file.delete()else file.writeBytes(bytes)}
                folder.listFiles()?.filter{it.name !in originals}?.forEach{assertTrue(it.isFile);assertTrue(it.delete())};if(!existed)folder.delete()
                InstrumentationRegistry.getInstrumentation().runOnMainSync{
                    val edit=playbackPrefs.edit().clear();for((key,value)in oldPlayback)when(value){
                        is Boolean->edit.putBoolean(key,value);is String->edit.putString(key,value);is Int->edit.putInt(key,value)
                        is Long->edit.putLong(key,value);is Float->edit.putFloat(key,value);is Set<*>->edit.putStringSet(key,value.filterIsInstance<String>().toSet())
                        else->error("Unknown existing playback preference")
                    };assertTrue(edit.commit())
                }
                val sameIndex=index.all{(name,bytes)->val file=File(context.filesDir,name);if(bytes==null)!file.exists()else file.isFile&&file.readBytes().contentEquals(bytes)}
                restored=sameIndex&&originals==folder.list()?.toSet().orEmpty()&&oldPlayback==playbackPrefs.all
                assertTrue("Original audio metadata, files and playback preference must be restored",restored)
            }catch(cleanup:Throwable){if(failure!=null)failure.addSuppressed(cleanup)else throw cleanup}
            finally{
                owned?.let{uri->resolver.delete(uri,null,null);externalRemoved=resolver.query(uri,arrayOf(android.provider.MediaStore.MediaColumns._ID),null,null,null)?.use{!it.moveToFirst()}?:true}
                val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"standalone"
                File(context.filesDir,"p3-world-audio-picker-import.json").writeText(JSONObject().put("schema",1).put("caseLabel",group).put("sourceSha256",sourceId)
                    .put("sourceBytes",source.size).put("imported",imported).put("decoderReady",played).put("deletedAfterSavedPreference",deleted)
                    .put("originalAudioMetadataAndFilesRestored",restored).put("ownedExternalMediaRemoved",externalRemoved).put("volume",0)
                    .put("completed",failure==null).put("scope","Actual system selection, copied import, native decoder and UI deletion; synthetic owned WAV only.").toString())
                assertTrue("The owned public-media row must be removed",externalRemoved)
            }
        }
    }
    @Test fun middleChineseInsertionCompletionAndFailedRenameKeepTheActualDraft()=run{name->
        nav("任务")
        val field=compose.onNodeWithContentDescription("写一条便签")
        field.performScrollTo().performTextInput("中间中文")
        field.performTextInputSelection(TextRange(2));field.performTextInput("插入")
        field.assertTextEquals("中间插入中文")
        compose.onNodeWithContentDescription("添加便签").performScrollTo().performClick()
        compose.waitUntil(10000){runtime.latest.notes.size==1}
        assertEquals("中间插入中文",runtime.latest.notes.single().text)
        compose.onNodeWithContentDescription("完成便签").performScrollTo().performClick()
        compose.waitUntil(10000){runtime.latest.notes.single().completed}
        compose.mainClock.advanceTimeBy(220);compose.waitForIdle()
        compose.onNode(hasText("已完成便签",substring=true) and hasClickAction()).performScrollTo().performClick()
        compose.onNodeWithContentDescription("恢复便签").performScrollTo().performClick()
        compose.waitUntil(10000){!runtime.latest.notes.single().completed}
        compose.onNodeWithContentDescription("编辑便签").performScrollTo().performTouchInput{doubleClick()}
        compose.onNodeWithContentDescription("修改便签").performTextReplacement("草稿保留")
        AndroidStateDatabase(context,name).use{db->db.transaction{it.execute("CREATE TRIGGER p3_fail_note BEFORE UPDATE ON domain_records WHEN NEW.section='quickNotes' BEGIN SELECT RAISE(FAIL,'p3 injected note save failure'); END")}}
        val priorIds=runtime.latest.receipts.map{it.id}.toSet()
        compose.onNodeWithContentDescription("保存便签").performClick()
        compose.waitUntil(10000){runtime.latest.receipts.any{!it.saved&&it.id !in priorIds}}
        compose.waitForIdle()
        compose.onNodeWithText("保存失败，请重试。").assertIsDisplayed()
        compose.onNodeWithContentDescription("修改便签").assertTextEquals("草稿保留")
        screen("note-failed-draft")
        val device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        if(android.os.Build.VERSION.SDK_INT>=34)InstrumentationRegistry.getInstrumentation().uiAutomation.clearCache()
        var visibleSave=device.findObject(androidx.test.uiautomator.By.desc("保存便签"))?:error("Inline retry action is absent from the device window")
        while(!visibleSave.isClickable&&visibleSave.parent!=null)visibleSave=visibleSave.parent
        assertTrue("The retry action must expose a clickable accessibility target",visibleSave.isClickable)
        val saveNode=compose.onNodeWithContentDescription("保存便签").fetchSemanticsNode()
        assertTrue("The complete inline retry target must remain visible with the keyboard",visibleSave.visibleBounds.height()>=saveNode.size.height-1)
        compose.onNode(isDialog()).assertDoesNotExist()
        assertEquals("中间插入中文",runtime.latest.notes.single().text)
        AndroidStateDatabase(context,name).use{db->db.transaction{it.execute("DROP TRIGGER p3_fail_note")}}
        compose.onNodeWithContentDescription("保存便签").performClick()
        compose.waitUntil(10000){runtime.latest.notes.single().text=="草稿保留"}
        compose.waitForIdle();compose.mainClock.advanceTimeBy(240);compose.waitForIdle()
        compose.onNodeWithContentDescription("修改便签").assertDoesNotExist()
        compose.onNodeWithText("添加便签").assertDoesNotExist()
        screen("formal-notes-task")
        nav("设置");compose.onNodeWithText("极简模式").performScrollTo().performClick()
        compose.waitUntil(10000){runtime.latest.preferences.minimalMode&&!runtime.latest.preferencesSaving}
        nav("计时");compose.onNodeWithTag("formal-normal-workbench").assertIsDisplayed();compose.onNodeWithText("极简").performClick();compose.waitUntilDoesNotExist(hasTestTag("mode-transition"),15000);compose.waitUntilAtLeastOneExists(hasTestTag("minimal-info-pager"),15000)
        compose.onNodeWithTag("minimal-info-pager").performTouchInput{swipeRight()}
        compose.onNodeWithContentDescription("写一条便签").assertIsDisplayed()
        val workspace=checkNotNull(runtime.latest.workspace)
        com.blockcolc.presentation.HolidayEmblems.at(workspace.today,0,workspace.settings.birthday).firstOrNull()?.let{entry->
            val resources=com.blockcolc.presentation.UiResources.load()
            val label=resources.text("zh-CN",entry.name)+" · "+resources.text("zh-CN",entry.emblem)
            val count=compose.onNodeWithTag("quick-note-count").fetchSemanticsNode().boundsInRoot
            val emblem=compose.onNodeWithContentDescription(label).fetchSemanticsNode().boundsInRoot
            assertTrue("Occasion decorations must not cover the note count",count.right<emblem.left)
        };screen("formal-notes-minimal")
        compose.onNodeWithTag("minimal-info-pager").performTouchInput{swipeLeft()}
        compose.onNodeWithContentDescription("写一条便签").assertIsNotDisplayed()
        compose.onNodeWithContentDescription("结束时间，上下滑动或按方向键调整").assertIsDisplayed()

    }
    /** The host taps the real OEM keyboard and its Chinese candidate strip.
     * Text-input semantics only prepare the initial text/caret; they do not
     * insert either tested candidate. Files are a bounded test-only handshake. */
    @Test fun realOemChineseCandidatesStayAtTheMiddleCursorInNewAndEditedNotes()=run{
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:error("OEM keyboard case needs a unique group")
        require(group.matches(Regex("[a-z0-9-]{1,60}")))
        val ime=android.provider.Settings.Secure.getString(context.contentResolver,android.provider.Settings.Secure.DEFAULT_INPUT_METHOD)
        require(!ime.isNullOrBlank())
        val files=mutableListOf<File>();val stages=JSONArray()
        fun candidate(stage:Int,field:SemanticsNodeInteraction,position:Int,expected:String){
            field.performScrollTo().performClick();field.performTextInputSelection(TextRange(position));compose.waitForIdle()
            val ready=File(context.filesDir,"p3-oem-$group-$stage-ready.json");val done=File(context.filesDir,"p3-oem-$group-$stage-done")
            require(!ready.exists()&&!done.exists());files+=ready;files+=done
            ready.writeText(JSONObject().put("stage",stage).put("ime",ime).put("expected",expected).put("hostMustTapActualKeyboard",true).toString())
            compose.waitUntil(180000){done.isFile}
            field.assertTextEquals(expected)
            stages.put(JSONObject().put("stage",stage).put("expected",expected).put("candidateCommittedAtRequestedCaret",true))
        }
        try{
            nav("任务")
            val input=compose.onNodeWithContentDescription("写一条便签")
            input.performScrollTo().performTextInput("中间中文")
            candidate(1,input,2,"中间插入中文")
            compose.onNodeWithContentDescription("添加便签").performScrollTo().performClick()
            compose.waitUntil(10000){runtime.latest.notes.singleOrNull()?.text=="中间插入中文"}
            compose.onNodeWithContentDescription("编辑便签").performTouchInput{doubleClick()}
            candidate(2,compose.onNodeWithContentDescription("修改便签"),4,"中间插入测试中文")
            compose.onNodeWithContentDescription("保存便签").performClick()
            compose.waitUntil(10000){runtime.latest.notes.single().text=="中间插入测试中文"}
            screen("oem-chinese-middle-commit")
            File(context.filesDir,"p3-oem-$group-result.json").writeText(JSONObject().put("ime",ime).put("stages",stages).put("savedExactText",true).toString())
        }finally{files.forEach{it.delete()}}
    }
    @Test fun confirmedTwoRoundPlanStaysPreparedThenStartsWithTheSameDenominator()=run{
        compose.onNodeWithText("01:00").assertIsDisplayed()
        compose.onNodeWithText("调整").performScrollTo().performClick()
        val layouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
        compose.onNode(hasText("调整") and hasAnyAncestor(isDialog())).performSemanticsAction(SemanticsActions.GetTextLayoutResult){action->assertTrue(action(layouts))}
        assertEquals("Glass dialogs use legible white ink in dark mode",androidx.compose.ui.graphics.Color.White,layouts.single().layoutInput.style.color)
        compose.onNodeWithContentDescription("增加轮数").performScrollTo().performClick()
        compose.onNodeWithText("确认计划").performScrollTo().performClick()
        compose.waitUntil(10000){runtime.latest.planId!=null&&!runtime.latest.busy}
        val confirmed=runtime.testRead().get(30,TimeUnit.SECONDS)
        assertEquals(2,confirmed.recovery.plan!!.totalRounds);assertTrue(confirmed.domain.json().isNull("activeFocusSession"))
        screen("prepared-two-rounds")
        compose.onNodeWithText("开始 2 轮").assertIsDisplayed().performClick()
        compose.waitUntil(10000){runtime.latest.phase=="FOCUS"}
        assertEquals(2,runtime.latest.timer!!.totalRounds)
        compose.waitUntilAtLeastOneExists(hasContentDescription("专注操作区"),10000)
        compose.onNodeWithText("结束本次专注").assertDoesNotExist()
        val endActions=compose.onNodeWithContentDescription("专注操作区").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsActions.CustomActions]
        compose.runOnIdle{assertTrue(endActions.single{it.label=="显示结束操作"}.action())}
        compose.onNodeWithText("结束本次专注").assertIsDisplayed().performClick()
        compose.waitUntilAtLeastOneExists(hasText("中断本轮"),10000)
        compose.onNodeWithText("中断本轮").performScrollTo().performClick()
        compose.onNodeWithText("不记录").performScrollTo().performClick()
        compose.waitUntil(10000){runtime.latest.timer?.surface==com.blockcolc.presentation.TimerSurface.WAITING}
        assertEquals(2,runtime.latest.timer!!.totalRounds)
        assertTrue(runtime.testRead().get(30,TimeUnit.SECONDS).domain.json().isNull("activeFocusSession"))
    }
    @Test fun separatedPlanSelectionPreservesTheDraftAndDeadlineConfirmationDoesNotNeedASubtask()=run{
        val before=runtime.testRead().get(30,TimeUnit.SECONDS).domain.sha256
        compose.onNodeWithText("调整").performScrollTo().performClick()
        compose.onNodeWithContentDescription("减少轮数").assertIsNotEnabled()
        repeat(4){compose.onNodeWithContentDescription("增加轮数").performScrollTo().performClick()}
        val count=compose.onNode(hasText("5") and hasAnyAncestor(isDialog())).assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        val minus=compose.onNodeWithContentDescription("减少轮数").fetchSemanticsNode().boundsInRoot
        val plus=compose.onNodeWithContentDescription("增加轮数").fetchSemanticsNode().boundsInRoot
        assertEquals((minus.center.x+plus.center.x)/2,count.center.x,1f)
        compose.onNodeWithContentDescription("减少轮数").performClick()
        compose.onNode(hasText("4") and hasAnyAncestor(isDialog())).assertExists()
        compose.onNodeWithContentDescription("增加轮数").performClick()
        compose.onNodeWithContentDescription("选择小任务").performScrollTo().performClick()
        compose.onNodeWithText("本次专注").assertIsDisplayed();screen("separate-task-selector")
        compose.onNodeWithText("第二章").performScrollTo().performClick()
        compose.onNode(hasText("第二章") and hasAnyAncestor(isDialog())).assertIsDisplayed()
        compose.onNode(hasText("5") and hasAnyAncestor(isDialog())).performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription("选择小任务").performScrollTo().performClick()
        compose.onNodeWithText("Daily habit").performScrollTo().performClick()
        compose.onNode(hasText("Daily habit") and hasAnyAncestor(isDialog())).assertIsDisplayed()
        screen("separate-plan-habit-draft")
        assertEquals(before,runtime.testRead().get(30,TimeUnit.SECONDS).domain.sha256)
        assertNull(runtime.latest.planId)
        compose.onNodeWithContentDescription("返回").performClick();compose.waitUntilDoesNotExist(isDialog(),10000)
        assertEquals(before,runtime.testRead().get(30,TimeUnit.SECONDS).domain.sha256)
        compose.onNodeWithText("调整").performScrollTo().performClick()
        compose.onNodeWithText("按结束时间").performScrollTo().performClick()
        compose.onNodeWithContentDescription("选择小任务").assertDoesNotExist()
        compose.onNodeWithContentDescription("结束时间，上下滑动或按方向键调整").performScrollTo().performSemanticsAction(SemanticsActions.SetProgress){assertTrue(it(3f))}
        screen("separate-deadline-original-picker")
        compose.onNodeWithText("确认计划").performScrollTo().performClick()
        compose.waitUntil(10000){runtime.latest.planId!=null&&!runtime.latest.busy}
        val confirmed=runtime.testRead().get(30,TimeUnit.SECONDS)
        assertEquals(PlanMode.MARATHON,confirmed.recovery.plan!!.mode);assertEquals("first",confirmed.recovery.plan!!.subtaskId)
        assertTrue(confirmed.domain.json().isNull("activeFocusSession"))
    }
    private fun consistentUiReview(language:String,theme:String,font:String,scale:Float)=run(formalCollectionInitial(),fontScale=scale,
        configure={it.copy(language=language,themeMode=theme,fontStyle=font)}){
        fun caption(key:String,vararg values:Any?)=com.blockcolc.presentation.UiResources.load().text(language,key,*values)
        if(InstrumentationRegistry.getArguments().getString("p3ExpectedOrientation") in setOf("landscape","reverse-landscape")){
            val root=compose.onRoot().fetchSemanticsNode().boundsInRoot
            val panel=compose.onNodeWithTag("formal-normal-workbench").fetchSemanticsNode().boundsInRoot
            assertTrue("Landscape timer docks beside the world",panel.left>root.width*.45f)
            compose.onNodeWithText(caption("开始 1 轮")).assertIsDisplayed()
            screen("review-wide-timer")
        }
        nav(caption("任务"));screen("review-$language-$font-tasks")
        compose.onNodeWithText(caption("今日目标")).assertIsDisplayed()
        compose.onNodeWithContentDescription(caption("调整")).performScrollTo().performClick()
        compose.onNodeWithText(caption("目标轮次")).performScrollTo().assertIsDisplayed();screen("review-goal-sheet")
        compose.onNodeWithContentDescription(caption("返回")).performClick();compose.waitUntilDoesNotExist(isDialog(),10000)
        nav(caption("统计"))
        compose.waitUntilAtLeastOneExists(hasText(caption("全部关闭")),10000)
        compose.onNodeWithText(caption("全部关闭")).performScrollTo().performClick();compose.waitUntilDoesNotExist(isDialog(),10000)
        compose.onNodeWithContentDescription(caption("专注日历")).performScrollTo().assertIsDisplayed();screen("review-statistics-calendar")
        compose.onNodeWithText(caption("时间花在了哪里")).performScrollTo().assertIsDisplayed();screen("review-statistics-clusters")
        compose.onNodeWithContentDescription(caption("{0}说明",caption("时间花在了哪里"))).performClick()
        compose.onNodeWithText(caption("每个像素约占 1%；文字为实际投入。")).assertIsDisplayed()
        androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        compose.onNodeWithText(caption("纪念建筑")).performScrollTo().performClick()
        compose.onNode(hasText("写作工程") and hasClickAction()).performScrollTo().performClick()
        compose.onNodeWithText(caption("旗下小任务投入")).performScrollTo().assertIsDisplayed();screen("review-statistics-memory")
        compose.onNodeWithText(caption("成就")).performScrollTo().performClick()
        compose.onNodeWithText(caption("第一块基石")).performScrollTo().assertIsDisplayed();screen("review-statistics-achievement")
        nav(caption("设置"));screen("review-settings")
        compose.onNodeWithText(caption("普通任务")).performScrollTo().performClick()
        compose.onNodeWithContentDescription(caption("专注时长（分钟）")).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(caption("生日祝福")).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(caption("本地备份")).performScrollTo().performClick()
        compose.onNodeWithText(caption("导入与导出")).performScrollTo().performClick()
        compose.onNodeWithText(caption("导入备份")).performScrollTo().assertIsDisplayed();screen("review-backup-actions")
        compose.onNodeWithText(caption("关于")).performScrollTo().performClick()
        compose.onNodeWithText(caption("手动检查更新")).performScrollTo().assertIsDisplayed();screen("review-about-sheet")
        compose.onNodeWithContentDescription(caption("返回")).performClick();compose.waitUntilDoesNotExist(isDialog(),10000)
        nav(caption("计时"));compose.onNodeWithText(caption("调整")).performScrollTo().performClick()
        compose.onNodeWithText(caption("确认计划")).performScrollTo().assertIsDisplayed();screen("review-plan-sheet")
        compose.onNodeWithContentDescription(caption("返回")).performClick();compose.waitUntilDoesNotExist(isDialog(),10000)
        nav(caption("任务"));compose.onNodeWithText(caption("新增任务")).performScrollTo().performClick()
        compose.onNodeWithText(caption("开始建造")).performScrollTo().assertIsDisplayed();screen("review-create-task")
        compose.onNodeWithText(caption("取消")).performScrollTo().performClick()
        assertNull(runtime.latest.planId)
    }
    @Test fun approvedUiUsesConsistentControlsAndReachableSheets()=consistentUiReview("zh-CN","dark","pixel",1f)
    @Test fun approvedUiKeepsLargeEnglishTextAndActionsReadable()=consistentUiReview("en","light","mixed",2f)

    @Test fun endingAnExtendedSessionKeepsItsOwnControlsWhileTheSheetCloses()=run{
        runtime.testOperation{focus->
            focus.begin("begin-overtime-sheet",PlanRequest("overtime-sheet","work","first",PlanMode.ROUNDS,1,5_000,0,
                extendAfterPlan=true),false,System.currentTimeMillis())
        }.get(30,TimeUnit.SECONDS)
        compose.waitUntil(10000){runtime.latest.timer?.extensionStartedAt!=null}
        val exit=compose.onNodeWithContentDescription("专注操作区")
        compose.waitUntilAtLeastOneExists(hasContentDescription("专注操作区"),10000)
        val actions=exit.fetchSemanticsNode().config[SemanticsActions.CustomActions]
        compose.runOnIdle{assertTrue(actions.single{it.label=="显示结束操作"}.action())}
        compose.onNodeWithText("结束本次专注").performSemanticsAction(SemanticsActions.OnClick){it()}
        val finish=compose.onNodeWithText("结束并完成本次专注")
        finish.assertIsDisplayed()
        try{
            compose.mainClock.autoAdvance=false
            finish.performSemanticsAction(SemanticsActions.OnClick){it()}
            compose.waitUntil(10000){
                compose.mainClock.advanceTimeByFrame()
                compose.onNodeWithText("中断本轮").assertDoesNotExist()
                runtime.latest.timer?.extensionStartedAt==null||runtime.latest.phase=="REPORT"
            }
            repeat(24){
                compose.mainClock.advanceTimeByFrame()
                compose.onNodeWithText("中断本轮").assertDoesNotExist()
            }
        }finally{compose.mainClock.autoAdvance=true}
        finish.assertDoesNotExist()
    }

    @Test fun countdownDatesFitTogetherAndAfterSavingShowTheEventAndRemainingDays(){
        val storage=CountdownPreference(context)
        val previous=storage.value
        val today=java.time.LocalDate.now()
        val target=today.plusDays(3)
        storage.save(null)
        try{run{
            nav("设置")
            compose.onNodeWithTag("setting-日期倒计时").performScrollTo()
            compose.onNodeWithText("日期倒计时").performClick()
            compose.onNode(hasContentDescription("事件名称") and hasSetTextAction()).performScrollTo().performTextInput("Beta countdown")
            compose.onNodeWithText("目标日期").performScrollTo().performClick()
            val dateField={label:String->compose.onNode(hasContentDescription(label) and hasSetTextAction() and hasAnyAncestor(isDialog()))}
            for(label in listOf("年份","月份","日期（日）"))dateField(label).assertIsDisplayed()
            dateField("年份").performTextReplacement(target.year.toString())
            dateField("月份").performTextReplacement(target.monthValue.toString())
            dateField("日期（日）").performTextReplacement(target.dayOfMonth.toString())
            compose.onNode(hasText("还有 3 天") and hasAnyAncestor(isDialog())).assertIsDisplayed()
            compose.onNode(hasText("保存") and hasAnyAncestor(isDialog())).performScrollTo().performClick()
            compose.onNodeWithText("Beta countdown").performScrollTo().assertIsDisplayed()
            compose.onAllNodesWithText("还有 3 天").assertCountEquals(2)
            screen("countdown-saved")
            nav("计时")
            compose.onNodeWithText("Beta countdown").assertIsDisplayed()
            compose.onNodeWithText("还有 3 天").assertIsDisplayed()
            screen("countdown-timer")
        }}finally{storage.save(previous)}
    }

    private fun integrityStopReturnsToInitialTimer(mode: PlanMode) = run(configure = { it.copy(minimalMode = mode == PlanMode.MINIMAL) }) {
        val now = System.currentTimeMillis()
        runtime.testOperation { c ->
            c.command("integrity-policy", DomainEngine.command("ConfigureFocusIntegrity", "enabled" to true,
                "maxEffectiveExcursions" to 2, "excursionThresholdSeconds" to 2), now)
            c.begin("integrity-start", PlanRequest("integrity-plan", "work", if (mode == PlanMode.MINIMAL) null else "first",
                mode, 3, 120_000, 5000), true, now)
        }.get(30, TimeUnit.SECONDS)
        compose.waitUntilAtLeastOneExists(hasText("有效离开 0/2 次"), 15_000)
        compose.waitUntilDoesNotExist(hasTestTag("mode-transition"), 10_000)
        val clockBounds = compose.onNodeWithTag("formal-focus-time").fetchSemanticsNode().boundsInRoot

        fun oneDeparture(index: Int) {
            val left = System.currentTimeMillis()
            runtime.testOperation { c ->
                c.lifecycle("integrity-leave-$index", false, "app-switch", left)
            }.get(30, TimeUnit.SECONDS)
            android.os.SystemClock.sleep(2200)
            runtime.testOperation { c ->
                c.lifecycle("integrity-return-$index", true, "app-switch", System.currentTimeMillis())
            }.get(30, TimeUnit.SECONDS)
        }
        oneDeparture(1)
        compose.waitUntilAtLeastOneExists(hasText("有效离开 1/2 次"), 10_000)
        assertEquals(clockBounds, compose.onNodeWithTag("formal-focus-time").fetchSemanticsNode().boundsInRoot)
        oneDeparture(2)
        compose.waitUntilAtLeastOneExists(hasText("已达离开次数上限，计划结束"), 15_000)
        compose.onNodeWithText("有效离开 2/2 次").assertIsDisplayed()
        compose.onNodeWithText("剩余专注总时间").assertDoesNotExist()
        assertNull(runtime.latest.planId)
        if (mode == PlanMode.MINIMAL) compose.onNodeWithTag("minimal-info-pager").assertIsDisplayed()
        else compose.onNodeWithText("调整").assertIsDisplayed()
    }

    @Test fun focusIntegrityReturnsOrdinaryToItsWorkbench() = integrityStopReturnsToInitialTimer(PlanMode.ROUNDS)
    @Test fun focusIntegrityReturnsMinimalToItsIdleClock() = integrityStopReturnsToInitialTimer(PlanMode.MINIMAL)

    private fun completeTwoRoundUiFlow(mode:PlanMode,habit:Boolean=false)=run(configure={it.copy(minimalMode=mode==PlanMode.MINIMAL)}){
        compose.waitUntil(60000){renderedWorld()?.let{worldDiagnostic(it).optLong("gpuReadyFrames")>0}==true}
        val project=if(habit)"habit"else"work"
        val now=System.currentTimeMillis()
        runtime.testOperation{c->c.confirm("flow-confirm",PlanRequest("flow-plan",project,
            if(habit||mode==PlanMode.MINIMAL)null else"first",mode,2,8000,8000),now)}.get(30,TimeUnit.SECONDS)
        if(mode==PlanMode.MINIMAL){
            compose.waitUntilAtLeastOneExists(hasTestTag("formal-focus-time"),10000)
            compose.onNodeWithTag("formal-focus-time").performTouchInput{doubleClick()}
        }else{
            val startLabel=if(mode==PlanMode.ROUNDS)"开始 2 轮"else"开始专注"
            compose.waitUntilAtLeastOneExists(hasText(startLabel),10000)
            compose.onNodeWithText(startLabel).assertIsDisplayed().performClick()
        }
        compose.waitUntil(10000){runtime.latest.phase=="FOCUS"}
        assertEquals(2,runtime.latest.timer!!.totalRounds)
        compose.waitUntilDoesNotExist(hasTestTag("mode-transition"),10000)
        screen("flow-${mode.name.lowercase()}-${if(habit)"habit"else"task"}-first-focus")
        if(mode==PlanMode.ROUNDS&&!habit){
            compose.waitUntil(15000){runtime.latest.phase=="REPORT"}
            compose.waitUntilAtLeastOneExists(hasText("保持 0%"),10000)
            compose.onNodeWithText("保持 0%").performScrollTo().performClick()
        }
        compose.waitUntil(15000){runtime.latest.phase=="REST"}
        compose.waitUntilAtLeastOneExists(hasText("休息中"),10000)
        compose.onNodeWithText("休息中").assertIsDisplayed()
        screen("flow-${mode.name.lowercase()}-${if(habit)"habit"else"task"}-rest")
        compose.waitUntil(15000){runtime.latest.timer?.surface==com.blockcolc.presentation.TimerSurface.WAITING}
        assertEquals(2,runtime.latest.timer!!.totalRounds)
        assertEquals(1,runtime.latest.timer!!.completedRounds)
        compose.waitUntilAtLeastOneExists(hasText("剩余专注总时间"),10000)
        compose.onNodeWithText("取消本次计划").assertDoesNotExist()
        assertTrue(runtime.testRead().get(30,TimeUnit.SECONDS).domain.json().isNull("activeFocusSession"))
        screen("flow-${mode.name.lowercase()}-${if(habit)"habit"else"task"}-waiting")
        compose.onNodeWithText("00:08").assertIsDisplayed().performTouchInput{doubleClick()}
        compose.waitUntil(10000){runtime.latest.phase=="FOCUS"}
        assertEquals(2,runtime.latest.timer!!.totalRounds)
        assertEquals(1,runtime.latest.timer!!.completedRounds)
        screen("flow-${mode.name.lowercase()}-${if(habit)"habit"else"task"}-final-focus")
        if(mode==PlanMode.ROUNDS&&habit){
            compose.waitUntil(15000){runtime.latest.planId==null&&!runtime.latest.busy}
        }else{
            compose.waitUntil(15000){runtime.latest.phase=="REPORT"}
            if(mode==PlanMode.ROUNDS){
                compose.waitUntilAtLeastOneExists(hasText("保持 0%"),10000)
                compose.onNodeWithText("保持 0%").performScrollTo().performClick()
            }else{
                assertEquals(2,runtime.latest.reportPool!!.totalRounds)
                // Both pooled modes use the same immersive allocation surface.
                compose.waitUntilAtLeastOneExists(hasText("Daily habit"),10000)
                compose.onNodeWithText("Daily habit").performScrollTo().performClick()
                compose.onNodeWithContentDescription("增加轮数").performScrollTo().performClick()
                compose.onNode(hasText("写作工程") and hasClickAction()).performScrollTo().performClick()
                compose.onAllNodesWithText("保持 0%").onFirst().performScrollTo().performClick()
                compose.onAllNodesWithContentDescription("增加轮数").onLast().performScrollTo().performClick()
                compose.onNodeWithText("已分配 2 / 2 轮").performScrollTo().assertIsDisplayed()
                screen("flow-${mode.name.lowercase()}-report")
                compose.onNodeWithText("一次提交本次推进").performScrollTo().performClick()
            }
            compose.waitUntil(15000){runtime.latest.planId==null&&!runtime.latest.busy}
            compose.waitUntilAtLeastOneExists(hasText("材料已送达！"),10000)
        }
        val saved=runtime.testRead().get(30,TimeUnit.SECONDS).domain.json()
        val history=saved.getJSONArray("focusHistory")
        assertEquals(2,history.length())
        repeat(2){assertEquals("completed",history.getJSONObject(it).getString("status"))}
        assertTrue(saved.isNull("activeFocusSession"))
        val reports=saved.getJSONArray("progressReports")
        val projects=saved.getJSONArray("projects")
        val habitFacts=(0 until projects.length()).map{projects.getJSONObject(it)}.single{it.getString("id")=="habit"}.getJSONObject("habit")
        val habitRounds=habitFacts.getJSONArray("completedFocusSessionIds").length()
        val taskRounds=(0 until reports.length()).sumOf{reports.getJSONObject(it).getJSONArray("focusSessionIds").length()}
        assertEquals(2,habitRounds+taskRounds)
        assertEquals(if(habit)2 else if(mode==PlanMode.ROUNDS)0 else 1,habitRounds)
        File(context.filesDir,"p3-world-flow-${mode.name.lowercase()}-${if(habit)"habit"else"task"}.json").writeText(JSONObject()
            .put("schema",1).put("caseLabel",InstrumentationRegistry.getArguments().getString("p3Group")?:"local")
            .put("mode",mode.name).put("habit",habit).put("history",history).put("habitRounds",habitRounds).put("taskRounds",taskRounds).toString())
    }
    @Test fun ordinaryTwoRoundUiRetainsReportsRestAndFinalRound()=completeTwoRoundUiFlow(PlanMode.ROUNDS)
    @Test fun habitTwoRoundUiRetainsAutomaticAttributionAndFinalRound()=completeTwoRoundUiFlow(PlanMode.ROUNDS,true)
    @Test fun minimalTwoRoundUiKeepsItsImmersiveReportAndSeparateAllocations()=completeTwoRoundUiFlow(PlanMode.MINIMAL)
    @Test fun marathonTwoRoundUiKeepsItsImmersiveReportAndSeparateAllocations()=completeTwoRoundUiFlow(PlanMode.MARATHON)
    @Test fun heatmapSelectsDatesThroughBothTouchDragAndAccessibility()=run{
        nav("统计")
        compose.onNodeWithContentDescription("专注日历").performScrollTo().performTouchInput{
            down(Offset(width*.1f,height*.2f));moveTo(Offset(width*.7f,height*.7f));up()
        }
        val range=compose.onNodeWithContentDescription("专注日历").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.StateDescription]
        assertTrue(range.contains("—"))
        compose.onNodeWithContentDescription("专注日历").performSemanticsAction(SemanticsActions.SetProgress){action->assertTrue(action(170f))}
        val day=compose.onNodeWithContentDescription("专注日历").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.StateDescription]
        assertFalse(day.contains("—"))
        screen("heatmap")
    }
    @Test fun blueprintLibraryPreviewsCloseWithoutReopeningAndRewardMysteriesDoNotExposeTheirModel()=run{
        compose.waitUntilAtLeastOneExists(hasContentDescription("设置"),60000)
        nav("设置")
        compose.onNodeWithText("蓝图库").performScrollTo().performClick()
        compose.onNodeWithText("原生图纸").performScrollTo().performClick()
        val row=hasTestTag("blueprint-library-builtin-small-workshop")
        compose.onNode(row).performScrollTo()
        compose.onNode(hasAnyAncestor(row) and hasClickAction()).performClick()
        compose.waitUntilAtLeastOneExists(hasContentDescription("重置预览视角"),60000)
        compose.onNodeWithContentDescription("重置预览视角").assertIsDisplayed()
        compose.onNodeWithTag("fixed-sheet-clear").assertIsDisplayed()
        screen("blueprint-ready")
        compose.onNodeWithContentDescription("返回").performClick()
        compose.waitUntilDoesNotExist(isDialog(),15000)
        compose.onNodeWithContentDescription("重置预览视角").assertDoesNotExist()
        compose.onNode(row).assertExists()
        compose.onNodeWithText("节日奖励").performScrollTo().performClick()
        compose.onAllNodesWithText("待发现").onFirst().performScrollTo().performClick()
        compose.onNodeWithContentDescription("尚未发现的节日建筑").assertIsDisplayed()
        compose.onNodeWithContentDescription("重置预览视角").assertDoesNotExist()
        screen("blueprint-mystery")
        compose.onNodeWithContentDescription("返回").performClick()
        compose.waitUntilDoesNotExist(isDialog(),15000)
        // Let the ordinary collapse/exit animation finish: it must not reopen.
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithContentDescription("尚未发现的节日建筑").assertDoesNotExist()
        compose.onNodeWithText("节日奖励").assertExists()
    }
    @Test fun settingsLanguageFontAndGlassSliderUseTheSavedPreference()=run{
        nav("设置")
        compose.onNodeWithText("English").performScrollTo().performClick()
        compose.waitUntil(10000){runtime.latest.preferences.language=="en"&&!runtime.latest.preferencesSaving}
        compose.onNodeWithText("System font").performScrollTo().performClick()
        compose.waitUntil(10000){runtime.latest.preferences.fontStyle=="system"&&!runtime.latest.preferencesSaving}
        compose.onNodeWithText("Light").performScrollTo().performClick()
        compose.waitUntil(10000){runtime.latest.preferences.themeMode=="light"&&!runtime.latest.preferencesSaving}
        compose.onNodeWithText("About").performScrollTo().performClick()
        val layouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
        compose.onNode(hasText("About") and hasAnyAncestor(isDialog())).performSemanticsAction(SemanticsActions.GetTextLayoutResult){assertTrue(it(layouts))}
        assertEquals("Manual light theme also applies to glass ink",androidx.compose.ui.graphics.Color.Black,layouts.single().layoutInput.style.color)
        screen("about-light")
        compose.onNodeWithContentDescription("Back").performClick()
        compose.waitUntilDoesNotExist(isDialog())
        compose.onNodeWithText("Dark").performScrollTo().performClick()
        compose.waitUntil(10000){runtime.latest.preferences.themeMode=="dark"&&!runtime.latest.preferencesSaving}
        compose.onNodeWithText("Focus glass").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Focus glass").performScrollTo().performTouchInput{click(Offset(width*.3f,height/2f))}
        compose.waitUntil(10000){runtime.latest.preferences.focusGlassTransparency<100&&!runtime.latest.preferencesSaving}
        assertTrue(runtime.latest.preferences.focusGlassTransparency in 20..40)
        screen("settings-en")
        nav("Tasks")
        compose.onNodeWithContentDescription("Write a note").performScrollTo().assertIsDisplayed()
    }
    @Test fun newlyEarnedAchievementWaitsForTheSavedReportAndDoesNotRepeatOnStatistics()=run{
        val now=System.currentTimeMillis()
        runtime.testOperation{c->c.begin("achievement-flow",PlanRequest("achievement-plan","work","first",PlanMode.ROUNDS,1,3000,0),false,now)}.get(30,TimeUnit.SECONDS)
        compose.waitUntil(10000){runtime.latest.phase=="FOCUS"}
        compose.onNodeWithText("新的成就").assertDoesNotExist()
        compose.waitUntil(15000){runtime.latest.phase=="REPORT"}
        assertTrue(runtime.latest.achievementAttention.contains("focus-first"))
        compose.onNodeWithText("新的成就").assertDoesNotExist()
        compose.onNodeWithText("保持 0%").performScrollTo().performClick()
        compose.waitUntil(15000){runtime.latest.planId==null&&!runtime.latest.busy}
        compose.waitUntil(15000){compose.onAllNodesWithText("新的成就").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("材料已送达！").assertDoesNotExist()
        compose.onNodeWithText("解锁摆设：床").assertExists()
        screen("achievement-after-report")
        compose.onNodeWithText("全部关闭").performScrollTo().performClick()
        compose.waitUntilDoesNotExist(isDialog(),15000)
        val saved=AtomicReference<Set<String>?>();val read=CountDownLatch(1)
        runtime.readAchievementReceipts{value,failed->saved.set(if(failed)null else value);read.countDown()}
        assertTrue(read.await(10,TimeUnit.SECONDS));assertTrue(saved.get()?.contains("focus-first")==true)
        nav("统计");compose.onNodeWithText("新的成就").assertDoesNotExist()
        val history=runtime.testRead().get(30,TimeUnit.SECONDS).domain.json().getJSONArray("focusHistory")
        assertEquals(1,history.length());assertEquals("completed",history.getJSONObject(0).getString("status"))
    }
    private fun singleTaskDocument():DomainDocument{
        val result=DomainEngine.execute(initial(),DomainEngine.command("RemoveSubtask","subtaskId" to "second"),System.currentTimeMillis())
        assertTrue(result.error,result.ok);return result.state
    }
    private fun completeProjectThroughReport(minimal:Boolean)=run(initialDocument=singleTaskDocument(),configure={it.copy(minimalMode=minimal)}){
        val mode=if(minimal)PlanMode.MINIMAL else PlanMode.ROUNDS
        runtime.testOperation{c->c.begin("completion-flow",PlanRequest("completion-plan","work",if(minimal)null else "first",mode,1,3000,0),false,System.currentTimeMillis())}.get(30,TimeUnit.SECONDS)
        compose.waitUntil(15000){runtime.latest.phase=="REPORT"}
        compose.waitUntilAtLeastOneExists(hasText("写作工程"),15000)
        if(minimal)compose.onNode(hasText("写作工程") and hasClickAction()).performScrollTo().performClick()
        compose.onNodeWithText("完成小任务").performScrollTo().performClick()
        if(minimal){
            compose.onNodeWithContentDescription("增加轮数").performScrollTo().performClick()
            compose.onNodeWithText("一次提交本次推进").performScrollTo().performClick()
        }
        compose.waitUntil(30000){runtime.latest.planId==null&&!runtime.latest.busy}
        compose.waitUntilAtLeastOneExists(hasText("主体建筑完成"),30000)
        compose.onNodeWithText("新的成就").assertDoesNotExist()
        if(android.os.Build.VERSION.SDK_INT>=29){
            fun focusedStatusBarVisible():Boolean? {
                val answer=AtomicReference<Boolean?>()
                InstrumentationRegistry.getInstrumentation().runOnMainSync{
                    val focused=android.view.inspector.WindowInspector.getGlobalWindowViews().lastOrNull{it.hasWindowFocus()}
                    answer.set(focused?.let{androidx.core.view.ViewCompat.getRootWindowInsets(it)?.isVisible(androidx.core.view.WindowInsetsCompat.Type.statusBars())})
                }
                return answer.get()
            }
            // The sheet is a separate Window; checking only Activity flags
            // misses bars that reappear over an immersive completion sheet.
            compose.waitUntil(10000){focusedStatusBarVisible()==!minimal}
        }
        val saved=runtime.testRead().get(30,TimeUnit.SECONDS).domain.json()
        val project=saved.getJSONArray("projects").let{a->(0 until a.length()).map{a.getJSONObject(it)}}.single{it.getString("id")=="work"}
        assertEquals("monument",project.getString("status"));assertTrue(saved.isNull("activeProjectId"))
        screen(if(minimal)"minimal-project-complete"else"ordinary-project-complete")
        compose.onNodeWithText(if(minimal)"留在此刻"else"回到聚落").performClick()
        compose.waitUntilAtLeastOneExists(hasText("新的成就"),15000)
        compose.onNodeWithText("全部关闭").performScrollTo().performClick()
        compose.waitUntilDoesNotExist(isDialog(),15000)
        if(minimal){
            compose.onNodeWithText("返回普通模式").assertExists()
            compose.onNodeWithText("其他任务").assertDoesNotExist()
        }else{
            compose.onNodeWithText("其他任务").performScrollTo().assertIsDisplayed()
            compose.onNode(hasText("Daily habit") and hasClickAction()).performScrollTo().performClick()
            compose.waitUntil(15000){runtime.latest.phase=="FOCUS"}
            assertEquals("habit",runtime.latest.activeProject)
        }
    }
    @Test fun minimalProjectCompletionStaysImmersiveAndNeverOpensOtherTasks()=completeProjectThroughReport(true)
    @Test fun ordinaryProjectCompletionOffersScrollableOtherTasksWithAnInlineStart()=completeProjectThroughReport(false)

    private fun withOwnedDocument(extension:String,mime:String,bytes:ByteArray,block:(String)->Unit){
        withStreamedOwnedDocument(extension,mime,{it.write(bytes)},block)
    }
    private fun withStreamedOwnedDocument(extension:String,mime:String,write:(java.io.OutputStream)->Unit,block:(String)->Unit){
        val resolver=context.contentResolver;val stem="blockcolc-p3-owned-${UUID.randomUUID()}"
        val uri=checkNotNull(resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,android.content.ContentValues().apply{
            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME,"$stem.$extension");put(android.provider.MediaStore.MediaColumns.MIME_TYPE,mime)
            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,"Download/");put(android.provider.MediaStore.MediaColumns.IS_PENDING,1)}))
        try{
            resolver.openOutputStream(uri,"w")!!.use(write)
            assertEquals(1,resolver.update(uri,android.content.ContentValues().apply{put(android.provider.MediaStore.MediaColumns.IS_PENDING,0)},null,null))
            block(stem)
        }finally{
            resolver.delete(uri,null,null)
            assertTrue("Only the test's external document is removed",resolver.query(uri,arrayOf(android.provider.MediaStore.MediaColumns._ID),null,null,null)?.use{!it.moveToFirst()}?:true)
        }
    }
    private fun chooseOwnedDocument(stem:String){
        val device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        fun documentRow(timeout:Long):androidx.test.uiautomator.UiObject2? =
            device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.descContains(stem).clazz(android.widget.TextView::class.java)),timeout)
                ?:device.findObject(androidx.test.uiautomator.By.textContains(stem).clazz(android.widget.TextView::class.java))
        fun clickFresh(selector:androidx.test.uiautomator.BySelector):Boolean {
            repeat(3){
                val node=device.wait(androidx.test.uiautomator.Until.findObject(selector),1500)?:return false
                try{node.click();return true}catch(_:androidx.test.uiautomator.StaleObjectException){device.waitForIdle(1000)}
            }
            return false
        }
        // ColorOS wraps and ellipsizes the visible filename but preserves its
        // full name in the row's accessibility description. Match that owned
        // name, never the search field or an arbitrary first result.
        var row=documentRow(1500)
        // Unknown extensions are absent from ColorOS's Recent index. Navigate
        // the actual Files/storage/Download hierarchy instead of assuming it.
        for(label in listOf("文件|Files","手机存储|内部存储|本机|Internal storage|Phone storage","Download|Downloads|下载|下载内容")){
            if(row!=null)break
            val entry=device.findObject(androidx.test.uiautomator.By.text(java.util.regex.Pattern.compile(label)))
            if(entry!=null){entry.click();device.waitForIdle(1000);row=documentRow(1500)}
        }
        if(row==null){
            val roots=device.findObject(androidx.test.uiautomator.By.desc(java.util.regex.Pattern.compile("显示根目录|打开导航抽屉|Show roots|Open navigation drawer")))
            if(roots!=null){
                roots.click()
                val downloads=device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.text(java.util.regex.Pattern.compile("下载|下载内容|Downloads|Download"))),2000)
                if(downloads!=null)clickFresh(androidx.test.uiautomator.By.text(java.util.regex.Pattern.compile("下载|下载内容|Downloads|Download")))
                row=documentRow(2000)
            }
        }
        if(row==null){
            val search=device.findObject(androidx.test.uiautomator.By.desc(java.util.regex.Pattern.compile("搜索|Search")))
            if(search!=null){search.click();val input=device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.clazz(java.util.regex.Pattern.compile("android.widget.(EditText|AutoCompleteTextView)"))),3000)
                input?.text=stem;row=documentRow(5000)}
        }
        if(row==null)device.dumpWindowHierarchy(File(context.filesDir,"p3-picker-failure.xml"))
        assertNotNull("System picker must expose the owned document",row)
        var clicked=false
        for(attempt in 0..2){
            try{val fresh=documentRow(1500);if(fresh!=null){fresh.click();clicked=true;break}}
            catch(_:androidx.test.uiautomator.StaleObjectException){device.waitForIdle(1000)}
        }
        assertTrue("Select the owned document after the provider refresh",clicked)
        if(!device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.pkg(context.packageName)),1500)){
            val confirm=device.findObject(androidx.test.uiautomator.By.text(java.util.regex.Pattern.compile("确定|完成|选择|Select|Done|OK")))
            assertNotNull(confirm);confirm.click()
        }
        assertTrue(device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.pkg(context.packageName)),10000))
    }
    @androidx.test.filters.SdkSuppress(minSdkVersion=29)
    @Test fun firstUseCanRestoreAnActualBackupThroughTheDocumentPickerWithoutCreatingAnything(){
        val imported=initial();val backup=BackupCodec.write(imported,DomainTime.format(System.currentTimeMillis())).toByteArray()
        withOwnedDocument("json","application/json",backup){stem->run(initialDocument=DomainEngine.initial("UTC"),firstUse=true){
            compose.onNodeWithText("新手教程").assertDoesNotExist()
            compose.onNodeWithText("恢复备份").performScrollTo().performClick();chooseOwnedDocument(stem)
            compose.waitUntil(15000){runtime.latest.importSummary!=null&&!runtime.latest.busy}
            compose.onNodeWithText("确认恢复").performScrollTo().performClick()
            compose.waitUntil(20000){!runtime.latest.setupRequired&&runtime.latest.importSummary==null&&!runtime.latest.busy}
            assertEquals(setOf("work","habit"),runtime.latest.projects.map{it.id}.toSet())
            compose.onNodeWithText("开始建造你的世界").assertDoesNotExist()
            finishFirstTutorial()
            compose.waitUntilDoesNotExist(isDialog(),15000)
            compose.onNodeWithTag("fixed-sheet-glass").assertDoesNotExist()
            nav("任务");compose.onNodeWithTag("native-page-tasks").assertExists()
            screen("first-use-restored-backup")
        }}
    }
    @Test @androidx.test.filters.SdkSuppress(minSdkVersion=29)
    fun capturedBackupConfirmationSurvivesUnrelatedStateAdoption(){
        val args=InstrumentationRegistry.getArguments()
        org.junit.Assume.assumeTrue("A private source archive is required",args.containsKey("p3CapacityCapture"))
        val filename=checkNotNull(args.getString("p3CapacityCapture"))
        require(filename.matches(Regex("p3-startup-capture-[a-f0-9-]{36}\\.json")))
        val source=File(context.filesDir,filename);require(source.isFile&&source.length()>10L*1024*1024)
        val report=JSONObject().put("wireBytes",source.length()).put("completed",false)
        try{withStreamedOwnedDocument("json","application/json",{out->source.inputStream().use{it.copyTo(out,65536)}}){stem->
            run(initialDocument=DomainEngine.initial("UTC"),firstUse=true){
                compose.waitUntilAtLeastOneExists(hasText("恢复备份"),10000);compose.mainClock.autoAdvance=false
                try{
                    compose.onNodeWithText("恢复备份").performScrollTo().performClick();chooseOwnedDocument(stem)
                    compose.waitUntil(120000){compose.mainClock.advanceTimeByFrame();android.os.SystemClock.sleep(10)
                        check(runtime.latest.busy||runtime.latest.message==null){"Source archive read failed"}
                        runtime.latest.importSummary!=null&&!runtime.latest.busy}
                    val prompt=checkNotNull(runtime.latest.importSummary)
                    val before=runtime.testRead().get(30,TimeUnit.SECONDS).domain.sha256
                    report.put("parsed",true)
                    // Normal foreground/permission/saved-state reconciliation
                    // all adopt a fresh domain projection. None can dismiss a
                    // pending user confirmation or take ownership of its file.
                    runtime.testReproject().get(30,TimeUnit.SECONDS)
                    report.put("confirmationRetained",runtime.latest.importSummary==prompt)
                    report.put("domainUnchanged",runtime.testRead().get(30,TimeUnit.SECONDS).domain.sha256==before)
                    assertEquals("An unrelated state refresh dismissed a valid backup confirmation",prompt,runtime.latest.importSummary)
                    assertEquals(before,runtime.testRead().get(30,TimeUnit.SECONDS).domain.sha256)
                    compose.mainClock.advanceTimeBy(500)
                    compose.onNodeWithText("确认恢复").assertExists()
                    report.put("completed",true)
                }finally{runtime.confirmImport(false);runtime.testReproject().get(30,TimeUnit.SECONDS)}
            }
        }}finally{File(context.filesDir,"p3-backup-confirmation-state.json").writeText(report.toString())}
    }
    @Test @androidx.test.filters.SdkSuppress(minSdkVersion=29)
    fun rejectedBackupHasAVisiblePersistentFailureUntilDismissed(){
        withOwnedDocument("json","application/json","{}".toByteArray()){stem->
            run(initialDocument=DomainEngine.initial("UTC"),firstUse=true){
                compose.waitUntilAtLeastOneExists(hasText("恢复备份"),10000)
                try{
                    compose.onNodeWithText("恢复备份").performScrollTo().performClick();chooseOwnedDocument(stem)
                    compose.waitUntil(15000){runtime.latest.backupImportIssue!=null&&!runtime.latest.busy}
                    val issue=runtime.latest.backupImportIssue
                    val before=runtime.testRead().get(30,TimeUnit.SECONDS).domain.sha256
                    runtime.testReproject().get(30,TimeUnit.SECONDS)
                    assertEquals(issue,runtime.latest.backupImportIssue)
                    compose.onNodeWithText("导入未完成").assertIsDisplayed()
                    compose.onNodeWithText("本次导入未替换当前记录。").assertIsDisplayed()
                    compose.onNodeWithText("重新选择文件").assertIsDisplayed()
                    assertEquals(before,runtime.testRead().get(30,TimeUnit.SECONDS).domain.sha256)
                    compose.onNodeWithContentDescription("返回").performClick()
                    compose.waitUntil(10000){runtime.latest.backupImportIssue==null}
                    compose.onNodeWithText("恢复备份").assertExists()
                }finally{runtime.confirmImport(false);runtime.testReproject().get(30,TimeUnit.SECONDS)}
            }
        }
    }
    @Test @androidx.test.filters.SdkSuppress(minSdkVersion=29)
    fun capturedLargeBackupRestoresThroughTheActualFirstUsePickerAndClosesItsSheet(){
        val args=InstrumentationRegistry.getArguments()
        org.junit.Assume.assumeTrue("This local archive is not a bundled test asset",args.containsKey("p3CapacityCapture"))
        val filename=checkNotNull(args.getString("p3CapacityCapture"))
        val expectedProjects=args.getString("p3ExpectedProjects")?.toInt()?:23
        val expectedHistory=args.getString("p3ExpectedHistory")?.toInt()?:442
        require(filename.matches(Regex("p3-startup-capture-[a-f0-9-]{36}\\.json")))
        val source=File(context.filesDir,filename);require(source.isFile&&source.length()>10L*1024*1024)
        val originals=File(context.filesDir,"import-originals");val existed=originals.exists();val before=originals.list()?.toSet().orEmpty()
        val evidence=JSONObject().put("completed",false).put("wireBytes",source.length())
        try{withStreamedOwnedDocument("json","application/json",{out->source.inputStream().use{it.copyTo(out,65536)}}){stem->
            run(initialDocument=DomainEngine.initial("UTC"),firstUse=true,configure={it.copy()}){
                // A large world's real worker must not race a test clock
                // through years of loading frames while Espresso seeks idle.
                compose.waitUntilAtLeastOneExists(hasText("恢复备份"),10000)
                compose.mainClock.autoAdvance=false
                evidence.put("stage","picker")
                compose.onNodeWithText("恢复备份").performScrollTo().performClick();chooseOwnedDocument(stem)
                evidence.put("stage","read")
                compose.waitUntil(120000){
                    compose.mainClock.advanceTimeByFrame();android.os.SystemClock.sleep(10)
                    check(runtime.latest.busy||runtime.latest.message==null){"The large backup read failed: ${runtime.latest.message}"}
                    runtime.latest.importSummary!=null&&!runtime.latest.busy
                }
                evidence.put("stage","confirm")
                compose.waitUntil(15000){compose.mainClock.advanceTimeByFrame();android.os.SystemClock.sleep(10);compose.onAllNodesWithText("确认恢复").fetchSemanticsNodes().isNotEmpty()}
                compose.mainClock.advanceTimeBy(500)
                compose.onNodeWithText("确认恢复").performScrollTo().performClick()
                compose.waitUntil(120000){compose.mainClock.advanceTimeByFrame();android.os.SystemClock.sleep(10);!runtime.latest.setupRequired&&runtime.latest.importSummary==null&&!runtime.latest.busy&&runtime.latest.ready}
                assertEquals(expectedProjects,runtime.latest.projects.size)
                evidence.put("stage","sheet-exit")
                compose.mainClock.autoAdvance=true
                finishFirstTutorial()
                compose.waitUntil(15000){compose.mainClock.advanceTimeByFrame();android.os.SystemClock.sleep(10);compose.onAllNodes(isDialog()).fetchSemanticsNodes().isEmpty()}
                compose.onNodeWithTag("fixed-sheet-glass").assertDoesNotExist()
                evidence.put("domainRestored",true).put("importSheetClosed",true).put("stage","imported-world")
                // Domain adoption precedes the new world's initial frame. The
                // loading cover deliberately hides navigation until that
                // separate readiness boundary (or its recoverable error).
                compose.waitUntil(180000){compose.mainClock.advanceTimeByFrame();android.os.SystemClock.sleep(10);compose.onAllNodesWithTag("workspace-ready").fetchSemanticsNodes().isNotEmpty()}
                evidence.put("worldAvailable",renderedWorld()?.let{worldDiagnostic(it,false).optLong("gpuReadyFrames")>0}==true)
                compose.onNodeWithContentDescription("任务").performClick();compose.mainClock.advanceTimeBy(600)
                compose.onNodeWithTag("native-page-tasks").assertExists();evidence.put("stage","tasks-usable")
                val stored=runtime.testRead().get(60,TimeUnit.SECONDS)
                val metadata=stored.domain.projectionJson();assertEquals(expectedHistory,metadata.getJSONArray("focusHistory").length())
                evidence.put("projects",expectedProjects).put("history",expectedHistory).put("completed",true)
                screen("large-first-use-restored-backup")
            }
        }}catch(error:Throwable){evidence.put("failure",error.toString());throw error}
        finally{
            evidence.put("lastReady",runtime.latest.ready).put("lastBusy",runtime.latest.busy).put("lastSetupRequired",runtime.latest.setupRequired)
            for(file in originals.listFiles().orEmpty().filter{it.name !in before}){
                require(file.isFile&&file.canonicalFile.parentFile==originals.canonicalFile&&file.name.matches(Regex("[a-f0-9]{64}\\.json")))
                check(file.delete())
            }
            if(!existed&&originals.exists())check(originals.delete())
            File(context.filesDir,"p3-capacity-ui.json").writeText(evidence.toString())
        }
    }
    @Test fun birthdayDateSavingAndOffOnRoundTripsNeverLeaveTheSaveActionPending()=run{
        nav("设置")
        compose.onNodeWithText("生日祝福").performScrollTo().performClick()
        fun toggle()=compose.onNodeWithText("启用生日祝福").performScrollTo().performClick()
        fun saved(enabled:Boolean){compose.waitUntil(15000){runtime.latest.workspace?.settings?.birthday?.enabled==enabled&&!runtime.latest.busy}}
        val dialogSave=compose.onNode(hasText("保存") and hasAnyAncestor(isDialog()))
        if(runtime.latest.workspace?.settings?.birthday?.month==null){
            // A first birthday opens the shared date sheet; nothing is saved until Save.
            toggle();dialogSave.assertIsEnabled()
            assertEquals(false,runtime.latest.workspace?.settings?.birthday?.enabled)
            val revision=runtime.latest.revision
            dialogSave.performTouchInput{click();click()};saved(true)
            compose.waitUntil(15000){compose.onAllNodes(isDialog()).fetchSemanticsNodes().isEmpty()}
            assertEquals(revision+1,runtime.testRead().get(30,TimeUnit.SECONDS).token.revision)
        }else{toggle();saved(true)}
        compose.onNodeWithTag("birthday-date").performScrollTo().assertIsDisplayed()
            .assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.StateDescription))
        toggle();saved(false)
        compose.onNodeWithTag("birthday-date").assertDoesNotExist()
        // With a saved date the switch alone restores it; no sheet is needed.
        toggle();saved(true)
        assertTrue(compose.onAllNodes(isDialog()).fetchSemanticsNodes().isEmpty())
        compose.onNodeWithTag("birthday-date").performScrollTo().performClick()
        compose.onNode(hasContentDescription("日期（日）") and hasSetTextAction() and hasAnyAncestor(isDialog())).performTextReplacement("12")
        dialogSave.performClick()
        compose.waitUntil(15000){runtime.latest.workspace?.settings?.birthday?.day==12&&!runtime.latest.busy}
        compose.onNodeWithText("启用生日祝福").assertIsEnabled()
        screen("birthday-saved-again")
    }
    @androidx.test.filters.SdkSuppress(minSdkVersion=29)
    @Test fun litematicPickerShowsTheRealPreviewAndSavedSignedAxesReopenCorrectly(){
        val bytes=ownedLitematicFixture()
        val expected=com.blockcolc.world.importing.NativeLitematic.parse(java.io.ByteArrayInputStream(bytes))
        withOwnedDocument("litematic","application/octet-stream",bytes){stem->run{
            nav("设置");compose.onNodeWithText("蓝图库").performScrollTo().performClick()
            compose.onNodeWithContentDescription("导入 .litematic").performScrollTo().performClick();chooseOwnedDocument(stem)
            compose.waitUntilAtLeastOneExists(hasText("保存到建筑蓝图库"),15000)
            compose.onNodeWithContentDescription("Owned reversed blueprint完整建筑预览，可拖动旋转").assertExists()
            compose.waitUntilAtLeastOneExists(hasContentDescription("重置预览视角"),60000)
            compose.onNodeWithContentDescription("重置预览视角").assertIsDisplayed()
            screen("litematic-before-save")
            compose.onNodeWithText("保存到建筑蓝图库").performScrollTo().performClick()
            compose.waitUntil(15000){!runtime.latest.busy&&runtime.latest.blueprints.items.any{it.id==expected.id}}
            compose.waitUntilDoesNotExist(isDialog(),15000)
            val saved=runtime.latest.blueprints.items.single{it.id==expected.id}
            assertEquals(StrictJson.render(JSONObject(expected.canonical)),StrictJson.render(JSONObject(saved.canonical)));assertEquals("user",saved.category)
            compose.onNodeWithText("自添加图纸").performScrollTo().performClick()
            compose.onNodeWithText("Owned reversed blueprint").performScrollTo().performClick()
            compose.onNodeWithContentDescription("Owned reversed blueprint完整建筑预览，可拖动旋转").assertExists()
            compose.waitUntilAtLeastOneExists(hasContentDescription("重置预览视角"),60000)
            compose.onNodeWithContentDescription("重置预览视角").assertIsDisplayed()
            screen("litematic-reopened")
            compose.onNodeWithContentDescription("返回").performClick();compose.waitUntilDoesNotExist(isDialog(),15000)
        }}
    }
    @Test fun minimalHourlyPanelUsesOccupiedTimeAndItsPagerReturnsBothWays()=run(configure={it.copy(minimalMode=true)}){
        compose.onNodeWithText("返回普通模式").assertExists()
        compose.onNodeWithTag("minimal-info-pager").performTouchInput{swipeLeft()}
        compose.waitUntilAtLeastOneExists(hasTestTag("minimal-today-timeline"),10000)
        compose.onNodeWithTag("minimal-today-timeline").assertExists()
        assertEquals(0L,runtime.latest.workspace!!.todayTimeline!!.totalMs)
        screen("minimal-hourly-panel")
        compose.onNodeWithTag("minimal-today-timeline").performTouchInput{swipeRight()}
        compose.onNodeWithText("返回普通模式").assertExists()
        compose.onNodeWithTag("minimal-today-timeline").assertIsNotDisplayed()
    }
    @Test fun twentyFiveSourceBuildingsUseTheActualWorkspaceAndKeepTheLastWorldDuringEnvironmentReplacement(){
        val source=DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()})
        val changed=DomainEngine.execute(source,DomainEngine.command("ConfigureWorldEnvironment","environmentStyle" to "mosaic-coast"),System.currentTimeMillis())
        assertTrue(changed.error,changed.ok)
        run(initialDocument=changed.state,configure={it.copy()}){
            val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"local"
            var host:NativeWorldView?=null;var last=JSONObject()
            fun frame(environment:String,after:Long=-1,previousIdentity:Long=-1):JSONObject{
                var requested:Pair<NativeWorldView,AtomicReference<JSONObject?>>?=null
                try{compose.waitUntil(180000){
                    check(compose.onAllNodesWithText("世界暂未准备好").fetchSemanticsNodes().isEmpty()){"World preparation failed: $environment"}
                    val view=renderedWorld()?:return@waitUntil false
                    host=view
                    if(requested?.first!==view){
                        val next=AtomicReference<JSONObject?>()
                        requested=view to next
                        view.generatedDiagnostics(false){next.set(it)}
                    }
                    last=requested!!.second.getAndSet(null)?:return@waitUntil false
                    requested=null
                    check(!last.getBoolean("failed")){"World rendering failed: $environment"}
                    last.getBoolean("active")&&last.getBoolean("surfaceShown")&&last.getBoolean("swapReady")&&
                        last.getLong("gpuReadyFrames")>after&&last.getLong("presentationIdentity")!=previousIdentity&&last.isNull("pendingPresentation")&&runtime.latest.workspace?.settings?.environment==environment&&
                        compose.onAllNodesWithText("正在建造世界").fetchSemanticsNodes().isEmpty()
                }}catch(error:Throwable){
                    val threads=Thread.getAllStackTraces().entries.filter{it.key.name.startsWith("blockcolc-world")||it.key.name=="main"}.take(8)
                    File(context.filesDir,"p3-world-large-workspace-failure.json").writeText(JSONObject().put("schema",1).put("caseLabel",group)
                        .put("environment",environment).put("failure",error.javaClass.simpleName).put("lastWorld",last)
                        .put("threads",JSONArray(threads.map{(thread,frames)->JSONObject().put("name",thread.name).put("state",thread.state.name).put("frames",JSONArray(frames.take(60).map{it.toString()}))})).toString())
                    throw error
                }
                assertEquals(25,runtime.latest.projects.size)
                return last
            }
            val coast=frame("mosaic-coast");screen("large-workspace-coast")
            nav("设置");compose.onNodeWithText("山谷").performScrollTo().performClick()
            compose.waitUntil(15000){!runtime.latest.busy&&runtime.latest.workspace?.settings?.environment=="natural-valley"}
            assertSame(host,renderedWorld())
            nav("计时");val valley=frame("natural-valley",coast.getLong("gpuReadyFrames"),coast.getLong("presentationIdentity"));screen("large-workspace-valley")
            assertNotEquals(coast.getJSONObject("ownerIdentities").getString("world"),valley.getJSONObject("ownerIdentities").getString("world"))
            nav("设置");compose.onNodeWithText("海岸").performScrollTo().performClick()
            compose.waitUntil(15000){!runtime.latest.busy&&runtime.latest.workspace?.settings?.environment=="mosaic-coast"}
            nav("计时");val returned=frame("mosaic-coast",valley.getLong("gpuReadyFrames"),valley.getLong("presentationIdentity"));screen("large-workspace-returned")
            File(context.filesDir,"p3-world-large-workspace.json").writeText(JSONObject().put("schema",1).put("caseLabel",group).put("projects",25)
                .put("coast",coast).put("valley",valley).put("returned",returned).toString())
        }
    }
    @Test fun currentUniversalWorldReportCostsAndPresentedFrames(){
        val args=InstrumentationRegistry.getArguments()
        val environment=args.getString("p3Environment")?:"ocean-island"
        require(environment in listOf("ocean-island","mosaic-coast"))
        val groups=(args.getString("p3Groups")?:"5").toInt();require(groups in listOf(1,5))
        val externalDisplay=args.getString("p3DisplaySource")=="surface-frame-trace"
        val captureFailureHeap=args.getString("p3CaptureFailureHeap")=="1"
        val maximumTemperature=args.getString("p3MaxBatteryDeciC")?.toInt()?.also{require(it in 300..500)}
        val source=DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()})
        val selected=DomainEngine.execute(source,DomainEngine.command("ConfigureWorldEnvironment","environmentStyle" to environment),System.currentTimeMillis())
        assertTrue(selected.error,selected.ok)
        val cases=JSONArray()
        val report=JSONObject().put("completed",false).put("environment",environment).put("cases",cases)
            .put("scope","Actual full NativeApp, actor/SQLite and universal generated world with 25 source buildings, original materials and normal device viewport. External Surface frame traces measure the first queued frame after the new world's GPU fence as a conservative displayed upper bound, not its exact first displayed frame. No prepared P2 workshop cache. Historical P2 used MC and fixed 720x960, so no direct speedup ratio is claimed.")
            .put("displaySource",if(externalDisplay)"surface-frame-trace-host-validation-required"else"legacy-surface-latency")
            .put("sourceFixtureSha256",source.sha256)
        val thermalSamples=JSONArray();report.put("thermalSamples",thermalSamples)
        fun thermalBoundary(group:Int,phase:String){
            val maximum=maximumTemperature?:return
            val battery=context.registerReceiver(null,android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))
            val temperature=battery?.getIntExtra(android.os.BatteryManager.EXTRA_TEMPERATURE,-1)?:-1
            thermalSamples.put(JSONObject().put("group",group).put("phase",phase).put("temperatureDeciC",temperature)
                .put("maximumExclusiveDeciC",maximum).put("atBootNs",android.os.SystemClock.elapsedRealtimeNanos().toString()))
            check(temperature in 1 until maximum){"Performance sample outside verified thermal range: $temperature / $maximum deci-C"}
        }
        fun shell(command:String)=android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)).bufferedReader().use{it.readText()}
        fun actualPresent(submitted:Long):Long {
            val match=Regex("(?:[a-f0-9]+ )?(SurfaceView\\[com\\.blockcolc\\.preview/[^\\]]+\\]\\(BLAST\\)#\\d+)")
                .findAll(shell("dumpsys SurfaceFlinger --list")).lastOrNull()?:error("No current world Surface layer")
            val layers=listOf(match.groupValues[1],match.value).distinct();require(layers.none{it.contains('\'')})
            val responses=JSONObject()
            val deadline=android.os.SystemClock.elapsedRealtime()+3000
            while(android.os.SystemClock.elapsedRealtime()<deadline){
                for(layer in layers){
                    val raw=shell("dumpsys SurfaceFlinger --latency '$layer'");responses.put(layer,raw)
                    val frames=raw.lineSequence().mapNotNull{line->
                        val parts=line.trim().split(Regex("\\s+"));if(parts.size!=3)null else{
                            val actual=parts[1].toLongOrNull();val ready=parts[2].toLongOrNull()
                            actual?.takeIf{it>=submitted&&it<Long.MAX_VALUE&&ready!=null&&ready>0&&ready<Long.MAX_VALUE}
                        }
                    }.toList()
                    if(frames.isNotEmpty())return frames.min()
                }
                android.os.SystemClock.sleep(60)
            }
            report.put("displayProbe",JSONObject().put("submittedNs",submitted.toString()).put("layers",JSONArray(layers)).put("responses",responses))
            error("No actual display fence for the current submitted world; GPU completion is not substituted")
        }
        if(captureFailureHeap)com.blockcolc.world.filament.NativeWorldFailureEvidence.arm(context,args.getString("p3Group")?:java.util.UUID.randomUUID().toString())
        try{run(selected.state,configure={it.copy(minimalMode=false)}){
            var world:NativeWorldView?=null
            fun frame(revision:Long,afterGpu:Long=-1):JSONObject{
                var value=JSONObject()
                var request:Pair<NativeWorldView,AtomicReference<JSONObject?>>?=null
                try{
                compose.waitUntil(180000){
                    val current=renderedWorld()
                    if(current==null)false else{
                        world=current
                        // Large-scene adoption can occupy the render queue for
                        // more than the ordinary diagnostic reader's ten seconds.
                        // Keep one asynchronous request in flight; the existing
                        // end-to-end deadline still includes all adoption work.
                        if(request?.first!==current){
                            val next=AtomicReference<JSONObject?>()
                            request=current to next
                            current.generatedDiagnostics(false){next.set(it)}
                        }
                        val received=request!!.second.getAndSet(null)
                        if(received==null)return@waitUntil false
                        value=received;request=null
                        check(!value.optBoolean("failed")){"The generated world failed"}
                        check(compose.onAllNodesWithText("世界暂未准备好").fetchSemanticsNodes().isEmpty()){"CPU world preparation failed; see diagnostic stage receipt and logcat"}
                        value.optLong("revision",-1)==revision&&value.optLong("gpuReadyFrames",-1)>afterGpu&&value.optBoolean("active")&&
                            value.optBoolean("surfaceShown")&&value.optBoolean("swapReady")&&value.isNull("pendingPresentation")&&!value.optBoolean("fencePending")&&
                            value.optString("diagnosticGpuCompleteNs","0").toLong()>=value.optString("diagnosticSubmittedNs","1").toLong()
                    }
                }
                }catch(error:Throwable){report.put("worldFailure",value).put("diagnosticStagesAtFailure",NativeStartupTrace.since(0));throw error}
                return value
            }
            repeat(groups){group->
                thermalBoundary(group,"before")
                if(group>0)runtime.testOperation{c->c.importBackup("full-world-seed-$group",BackupCodec.read(BackupCodec.write(selected.state,DomainTime.format(System.currentTimeMillis()))),System.currentTimeMillis())}.get(60,TimeUnit.SECONDS)
                // Finish normal bundled-reward registration before capturing
                // the exact starting document and clearing the command journal.
                runtime.testOperation{Operation(it.load())}.get(60,TimeUnit.SECONDS)
                val initial=runtime.testRead().get(60,TimeUnit.SECONDS)
                val baseline=frame(initial.token.revision)
                var beforeReport=baseline
                runtime.testRecording(true).get(30,TimeUnit.SECONDS)
                val sample=JSONObject().put("group",group).put("initial",initial.domain.canonical).put("operations",JSONArray()).put("completed",false)
                cases.put(sample)
                val operations=sample.getJSONArray("operations");val at=System.currentTimeMillis()+3600000
                listOf("start","early","start","early","start","early","report").forEachIndexed{seq,action->
                    val traceCursor=NativeStartupTrace.cursor()
                    val input=System.nanoTime();val timing=P2OperationCost();val now=at+seq*1000
                    val result=runtime.testMeasuredOperation(timing){c->when(action){
                        "start"->{if(c.load().recovery.plan==null)c.confirm("confirm",PlanRequest("cost-plan","complex-0",null,PlanMode.MINIMAL,3,60000,0),now);c.start("start-$seq",false,now)}
                        "early"->c.manual("early-$seq",true,false,"other",null,now)
                        else->c.report("report",JSONArray().put(JSONObject().put("reportId","cost-report").put("projectId","complex-0").put("subtaskId","read").put("progressBasisPoints",5000).put("rounds",3)),JSONArray(),now)
                    }}.get(60,TimeUnit.SECONDS)
                    val operation=JSONObject().put("action",action).put("sequence",seq).put("inputNs",input.toString()).put("savedNs",System.nanoTime().toString()).put("timing",timing.json())
                    operations.put(operation)
                    val shown=frame(result.state.token.revision,if(action=="report")baseline.getLong("gpuReadyFrames")else -1)
                    operation.put("diagnosticStages",NativeStartupTrace.since(traceCursor))
                    if(action=="report"){
                        val submitted=shown.getString("diagnosticSubmittedNs").toLong();assertTrue(submitted>=input)
                        operation.put("worldSubmittedNs",submitted.toString());sample.put("world",shown)
                        if(externalDisplay){
                            // Trace time is CLOCK_BOOTTIME, while nanoTime is
                            // monotonic. Bracket their conversion; the host
                            // validates an actual PresentFenceSignaled event
                            // for the same Surface/frame, never a GPU callback.
                            val before=System.nanoTime();val boot=android.os.SystemClock.elapsedRealtimeNanos();val after=System.nanoTime()
                            operation.put("clockOffsetNs",(boot-(before+(after-before)/2)).toString()).put("clockUncertaintyNs",(after-before).toString())
                            val completed=shown.getString("diagnosticGpuCompleteNs").toLong();assertTrue(completed>=submitted)
                            operation.put("worldGpuCompleteNs",completed.toString())
                            sample.put("displayValidationPending",true)
                        }else{
                            val presented=actualPresent(submitted)
                            operation.put("actualPresentedNs",presented.toString())
                            sample.put("reportInputToPresentMs",(presented-input)/1e6)
                        }
                        sample.put("final",result.state.domain.canonical)
                            .put("attribution",FocusProjection.attribution(result.state.domain)).put("world",shown)
                        // Earlier completed rounds may legitimately grant the
                        // first holiday reward and extend the terrain. Compare
                        // this report with its immediate prior scene, not the
                        // scene before the entire three-round plan.
                        sample.put("beforeReportWorld",beforeReport)
                        val prior=beforeReport.getJSONObject("ownerIdentities");val current=shown.getJSONObject("ownerIdentities")
                        for(owner in prior.keys())if(owner=="world"||owner.startsWith("building:")&&owner!="building:complex-0")assertEquals(owner,prior.get(owner),current.get(owner))
                        assertNotEquals(prior.get("building:complex-0"),current.get("building:complex-0"))
                    }else beforeReport=shown
                }
                thermalBoundary(group,"after")
                sample.put("commands",JSONArray(runtime.testRecording().get(30,TimeUnit.SECONDS))).put("completed",true)
                screen("universal-report-$group")
            }
        };report.put("completed",true)}finally{
            com.blockcolc.world.filament.NativeWorldFailureEvidence.reset()
            File(context.filesDir,"p3-world-report-cost-$environment.json").writeText(report.toString())
        }
    }
    private fun finishFirstTutorial(){
        compose.waitUntilAtLeastOneExists(hasText("新手教程") and hasAnyAncestor(isDialog()),15000)
        compose.onNode(hasText("新手教程") and hasAnyAncestor(isDialog())).assertIsDisplayed()
        repeat(8){index->
            if(index==2){
                compose.onNodeWithContentDescription("专注操作区").performScrollTo().performTouchInput{doubleClick()}
                compose.onNodeWithText("结束本次专注").performScrollTo().performSemanticsAction(SemanticsActions.OnClick){it()}
                compose.waitUntilAtLeastOneExists(hasText("已学会唤出结束入口"),3000)
                compose.onNodeWithText("已学会唤出结束入口").performScrollTo().assertIsDisplayed()
                assertNull(runtime.latest.planId)
            }
            if(index==4){
                compose.onNode(hasContentDescription("重置视角") and hasAnyAncestor(isDialog())).performScrollTo().performClick()
                compose.onNodeWithText("视角已复位，仍围绕所选建筑").performScrollTo().assertIsDisplayed()
                compose.onNode(hasContentDescription("重置地图") and hasAnyAncestor(isDialog())).performClick()
                compose.onNodeWithText("已返回整个聚落的总览").performScrollTo().assertIsDisplayed()
            }
            compose.onNodeWithText("下一页").performScrollTo().performClick()
        }
        compose.onNodeWithText("开始使用").performScrollTo().performClick()
        compose.waitUntil(10000){!runtime.latest.tutorialPending}
    }
    @Test fun firstUseRequiresSetupBeforeTeachingTheWorkbench()=run(DomainEngine.initial("UTC"),firstUse=true){
        compose.onNodeWithText("新手教程").assertDoesNotExist()
        listOf("创建大型任务","创建习惯任务","恢复备份","登录账户并恢复云端").forEach{compose.onNodeWithText(it).assertIsDisplayed()}
        androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        compose.onNodeWithText("开始建造你的世界").assertIsDisplayed()
        compose.onNodeWithText("创建习惯任务").performClick()
        compose.onNodeWithContentDescription("任务名称").performScrollTo().performTextReplacement("窗前的习惯")
        compose.onNodeWithText("开始建造").performScrollTo().performClick()
        compose.waitUntil(15000){!runtime.latest.busy&&runtime.latest.projects.size==1&&!runtime.latest.setupRequired}
        assertEquals("habit",runtime.latest.projects.single().kind)
        assertEquals("窗前的习惯",runtime.latest.projects.single().title)
        compose.onNodeWithText("开始建造你的世界").assertDoesNotExist()
        finishFirstTutorial()
        assertNull(runtime.latest.planId)
        screen("first-use-completed")
    }
    @Test fun anExistingWorkspaceCanFinishTheTutorialWithoutBeingForcedToCreateAgain()=run(firstUse=true){
        finishFirstTutorial()
        compose.onNodeWithText("开始建造你的世界").assertDoesNotExist()
        compose.waitUntil(60000){compose.onAllNodesWithTag("workspace-ready").fetchSemanticsNodes().isNotEmpty()}
        assertFalse(runtime.latest.setupRequired)
        assertEquals(setOf("work","habit"),runtime.latest.projects.map{it.id}.toSet())
        nav("任务");compose.onNodeWithTag("native-page-tasks").assertExists()
        screen("existing-workspace-tutorial")
    }
    private fun largeFontPages(language:String,theme:String)=run(fontScale=2f,configure={it.copy(language=language,fontStyle="mixed",themeMode=theme)}){
        fun caption(key:String)=com.blockcolc.presentation.UiResources.load().text(language,key)
        for(tab in listOf("timer","tasks","statistics","settings")){
            val layouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
            compose.onNodeWithTag("navigation-label-$tab",useUnmergedTree=true).performSemanticsAction(SemanticsActions.GetTextLayoutResult){assertTrue(it(layouts))}
            assertEquals("Navigation labels must not create orphan lines",1,layouts.single().lineCount)
        }
        screen("large-font-$language-timer")
        nav(caption("任务"));screen("large-font-$language-tasks")
        nav(caption("统计"));screen("large-font-$language-statistics")
        nav(caption("设置"))
        compose.onNodeWithTag("settings-search").performScrollTo().performTextInput(caption("字体"))
        compose.onNodeWithTag("settings-result-字体").performClick()
        compose.waitUntil(10000){runCatching{compose.onNodeWithText(caption("混合字体")).assertIsDisplayed()}.isSuccess}
        compose.onNodeWithText(caption("系统字体")).assertIsDisplayed()
        screen("large-font-$language-settings")
        assertEquals("mixed",runtime.latest.preferences.fontStyle)
        assertEquals(language,runtime.latest.preferences.language)
    }
    @Test fun mixedChineseAtTwoHundredPercentKeepsAllFourPagesAndSettingsJumpUsable()=largeFontPages("zh-CN","dark")
    @Test fun mixedEnglishAtTwoHundredPercentKeepsAllFourPagesAndSettingsJumpUsable()=largeFontPages("en","light")
    @Test fun correctedSettingsRowsFitWeekdaysAndKeepInlineActionsAndAudioExitStable()=run(configure={it.copy(ambience=it.ambience.copy(volume=0))}){
        nav("设置")
        compose.onNodeWithTag("setting-计划专注日").performScrollTo()
        val row=compose.onNodeWithTag("setting-计划专注日").fetchSemanticsNode().boundsInRoot
        for(day in listOf("周日","周一","周二","周三","周四","周五","周六")){
            val item=compose.onNodeWithText(day);item.assertIsDisplayed();val bounds=item.fetchSemanticsNode().boundsInRoot
            assertTrue("All seven weekdays fit the same setting row",bounds.left>=row.left&&bounds.right<=row.right)
        };screen("settings-weekdays")
        compose.onNodeWithTag("setting-世界色彩").performScrollTo()
        val collapsedColour=compose.onNodeWithText("世界色彩").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithContentDescription("恢复默认").assertDoesNotExist()
        compose.onNodeWithText("世界色彩").performClick()
        val colour=compose.onNodeWithText("世界色彩").fetchSemanticsNode().boundsInRoot
        val reset=compose.onNodeWithContentDescription("恢复默认").fetchSemanticsNode().boundsInRoot
        assertEquals(collapsedColour.center.y,colour.center.y,1f)
        assertEquals(colour.center.y,reset.center.y,context.resources.displayMetrics.density*8)
        for(label in listOf("饱和度","亮度","对比度"))compose.onNodeWithContentDescription(label).assertExists()
        screen("settings-world-colour")
        compose.onNodeWithText("新手教程").performScrollTo();screen("settings-advanced-footer")
        compose.onNodeWithText("关于").performScrollTo().performClick();compose.onNodeWithContentDescription("blockcolc").assertIsDisplayed()
        val brand=compose.onNodeWithContentDescription("blockcolc").fetchSemanticsNode().boundsInRoot
        val name=compose.onNodeWithText("方块钟 · blockcolc").fetchSemanticsNode().boundsInRoot
        assertTrue("Brand icon belongs to the same heading row",brand.top<name.bottom&&brand.bottom>name.top)
        screen("about-heading");compose.onNodeWithContentDescription("返回").performClick();compose.waitUntilDoesNotExist(isDialog(),10000)
        compose.onNodeWithText("白噪音").performScrollTo().performClick()
        for(label in listOf("自然白噪音","随天气播放雨声")){
            compose.onNodeWithText(label).performScrollTo().performClick();compose.waitUntil(10000){!runtime.latest.preferencesSaving}
            compose.onNodeWithText(label).performScrollTo().performClick();compose.waitUntil(10000){!runtime.latest.preferencesSaving}
            compose.mainClock.advanceTimeBy(240);compose.waitForIdle()
        }
        compose.onNodeWithText("白噪音音量").assertDoesNotExist();compose.onNodeWithText("清晨林中鸟鸣").assertDoesNotExist();screen("audio-switches-closed")
    }
    @Test fun endTimePlanHidesTaskPickerAndMinimalPreferenceOnlyAddsAnEntrance()=run{
        nav("设置");compose.onNodeWithText("极简模式").performScrollTo().performClick()
        compose.waitUntil(10000){runtime.latest.preferences.minimalMode&&!runtime.latest.preferencesSaving}
        nav("计时");compose.onNodeWithTag("formal-normal-workbench").assertIsDisplayed()
        compose.onNodeWithText("调整").performClick();compose.onNodeWithText("按结束时间").performClick()
        compose.onNodeWithText("本次专注").assertDoesNotExist();compose.onNode(hasText("第一章") and hasAnyAncestor(isDialog())).assertDoesNotExist();screen("end-time-no-task-picker")
        compose.onNodeWithContentDescription("返回").performClick();compose.waitUntilDoesNotExist(isDialog(),10000)
        compose.onNodeWithTag("formal-normal-workbench").assertIsDisplayed()
        nav("任务");nav("设置");nav("计时");compose.onNodeWithTag("formal-normal-workbench").assertIsDisplayed()
        val oldPresentation=worldDiagnostic(checkNotNull(renderedWorld())).getLong("presentationIdentity")
        runtime.start();compose.waitUntil(15000){runtime.latest.ready&&!runtime.latest.busy};compose.onNodeWithTag("formal-normal-workbench").assertIsDisplayed()
        compose.waitUntil(60000){renderedWorld()?.let{worldDiagnostic(it).let{d->d.getLong("generation")==runtime.latest.generation&&d.getLong("presentationIdentity")!=oldPresentation&&d.isNull("pendingPresentation")&&d.getLong("gpuReadyFrames")>0}}==true}
        val world=checkNotNull(renderedWorld());val before=worldDiagnostic(world)
        compose.onNodeWithText("极简").performClick();compose.waitUntilDoesNotExist(hasTestTag("mode-transition"),15000)
        compose.onNodeWithText("正在准备视图").assertDoesNotExist();compose.onNodeWithTag("formal-minimal-panel").assertIsDisplayed()
        compose.onNodeWithTag("formal-minimal-panel").performTouchInput{doubleClick(Offset(width*.5f,height*.94f))}
        compose.onNodeWithText("返回普通模式").performClick();compose.waitUntilDoesNotExist(hasTestTag("mode-transition"),15000)
        compose.onNodeWithTag("formal-normal-workbench").assertIsDisplayed()
        assertSame(world,renderedWorld());val after=worldDiagnostic(world)
        assertEquals(before.getLong("presentationIdentity"),after.getLong("presentationIdentity"))
        assertEquals(before.getJSONObject("ownerIdentities").toString(),after.getJSONObject("ownerIdentities").toString())
        assertEquals(before.getJSONObject("camera").toString(),after.getJSONObject("camera").toString())
        screen("mode-returned-without-rebuild")
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"local"
        File(context.filesDir,"p3-world-mode-transition.json").writeText(JSONObject().put("schema",1).put("caseLabel",group).put("before",before).put("after",after)
            .put("minimalSettingOnlyAddsEntrance",true).put("endTimeHasNoTaskPicker",true).put("cameraAndOwnersUnchanged",true).toString())
    }
    private fun habitTaskDocument(awaiting:Boolean):DomainDocument {
        var state=initial();var at=System.currentTimeMillis()-3000
        fun step(command:JSONObject){val result=DomainEngine.execute(state,command,at++);check(result.ok){result.error.orEmpty()};state=result.state}
        if(awaiting){
            step(DomainEngine.command("CreateHabitProject","projectId" to "single-habit","title" to "每日阅读","blueprintId" to "builtin-small-workshop","targetRounds" to 10))
            step(DomainEngine.command("SwitchActiveProject","projectId" to "single-habit"))
            repeat(10){round->
                step(DomainEngine.command("StartFocus","sessionId" to "habit104-complete-$round","subtaskId" to JSONObject.NULL,"plannedDurationMs" to 1))
                step(DomainEngine.command("CompleteFocus"))
            }
        }else step(DomainEngine.command("SwitchActiveProject","projectId" to "habit"))
        return state
    }
    @Test fun currentHabitHasOneProgressAndSelectingItNeverAddsASubtaskMarker()=run(habitTaskDocument(false)){
        nav("任务")
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo)).assertCountEquals(2)
        compose.onNodeWithContentDescription("习惯周期进度").assertExists()
        compose.onNodeWithText("已完成建筑").performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription("当前蓝图说明").performScrollTo().performClick()
        compose.onNodeWithText("本周期内锁定").assertIsDisplayed();screen("habit104-current-task")
        androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        nav("计时");compose.onNodeWithText("调整").performClick()
        val habit=compose.onNode(hasText("Daily habit") and hasClickAction() and hasAnyAncestor(isDialog()))
        habit.performScrollTo().assertIsSelected()
        fun noSubtaskMarker(){assertTrue("A selected habit keeps its check without a subtask's bright left stripe",habit.captureToImage().toPixelMap()[1,1].luminance()<.5f)}
        noSubtaskMarker()
        compose.onNode(hasText("写作工程") and hasClickAction() and hasAnyAncestor(isDialog())).performScrollTo().performClick()
        habit.performScrollTo().assertIsSelected();noSubtaskMarker();screen("habit104-selected-after-expansion")
        val task=compose.onNode(hasText("第一章") and hasClickAction() and hasAnyAncestor(isDialog()))
        task.performScrollTo().performClick();task.assertIsSelected()
        assertTrue("The ordinary subtask retains its own selected stripe",task.captureToImage().toPixelMap()[1,1].luminance()>.5f)
        compose.onNodeWithContentDescription("返回").performClick();compose.waitUntilDoesNotExist(isDialog(),10000)
        assertNull(runtime.latest.planId);assertEquals("habit",runtime.latest.activeProject)
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"local"
        File(context.filesDir,"p3-world-habit104-current.json").writeText(JSONObject().put("schema",1).put("caseLabel",group).put("singleCycleProgress",true).put("habitHasNoSubtaskStripe",true).put("taskKeepsStripe",true).put("draftDidNotSwitchLiveProject",true).toString())
    }
    @Test fun completedHabitShowsTheFinishedCycleAndWaitsForTheNextBlueprint()=run(habitTaskDocument(true)){
        nav("任务")
        val progress=compose.onNodeWithContentDescription("习惯周期进度")
        progress.performScrollTo().assertRangeInfoEquals(androidx.compose.ui.semantics.ProgressBarRangeInfo(10f,0f..10f))
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo)).assertCountEquals(2)
        compose.onNodeWithText("等待下一座建筑").assertIsDisplayed();compose.onNodeWithText("待选择").assertIsDisplayed()
        compose.onNodeWithText("1 座").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("前往计时页选择").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("选择下一栋建筑").performScrollTo().assertIsDisplayed();screen("habit104-awaiting-blueprint")
        assertNull(runtime.latest.planId)
        assertTrue(runtime.latest.workspace!!.projects.single{it.id=="single-habit"}.awaitingBuilding)
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"local"
        File(context.filesDir,"p3-world-habit104-awaiting.json").writeText(JSONObject().put("schema",1).put("caseLabel",group).put("singleFinishedCycleProgress",true).put("archivedBuildingCount",1).put("awaitingBlueprint",true).toString())
    }
    @Test fun waterAcrossAllFourSettlementsSurvivesRotationWithoutOverlappingTiles()=run(DomainDocument.parse(context.assets.open("p2-fixture-domain.json").bufferedReader().use{it.readText()}),realTimeStartup=true){
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"local"
        val captures=JSONArray()
        var recordedStage="";var recordedAt=0L
        fun evidence(stage:String,last:JSONObject?=null){
            val now=android.os.SystemClock.uptimeMillis()
            if(stage==recordedStage&&now-recordedAt<500)return
            recordedStage=stage;recordedAt=now
            File(context.filesDir,"p3-world-water-surfaces.json").writeText(JSONObject().put("schema",1).put("caseLabel",group).put("stage",stage).put("captures",captures).put("last",last?:JSONObject.NULL).toString())
        }
        for((environment,label)in listOf("ocean-island" to "海岛","natural-valley" to "山谷","mosaic-coast" to "海岸","classic-island" to "空岛")){
            val previous=worldDiagnostic(checkNotNull(renderedWorld()),false);val changed=runtime.latest.workspace?.settings?.environment!=environment
            nav("设置");compose.onNodeWithText(label).performScrollTo().performClick()
            compose.waitUntil(15000){!runtime.latest.busy&&runtime.latest.workspace?.settings?.environment==environment}
            nav("计时")
            var worldFrame=previous
            compose.waitUntil(180000){
                val current=renderedWorld()
                if(current==null)false else{
                    worldFrame=worldDiagnostic(current,false);evidence("await-$environment",worldFrame)
                    !worldFrame.getBoolean("failed")&&worldFrame.isNull("pendingPresentation")&&(!changed||worldFrame.getLong("presentationIdentity")!=previous.getLong("presentationIdentity"))&&
                        worldFrame.getLong("gpuReadyFrames")>0&&compose.onAllNodesWithText("正在建造世界").fetchSemanticsNodes().isEmpty()
                }
            }
            val world=checkNotNull(renderedWorld());val initial=worldDiagnostic(world,false)
            val device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            val location=IntArray(2);InstrumentationRegistry.getInstrumentation().runOnMainSync{world.getLocationOnScreen(location)}
            val w=initial.getInt("surfaceWidth");val h=initial.getInt("presentationHeight")
            val surface=device.findObject(androidx.test.uiautomator.UiSelector().className("android.view.SurfaceView"))
            val top=initial.getInt("presentationTop")
            device.waitForIdle(1000);screen("water-$environment-ready")
            // Scene fences do not imply that the page's horizontal transition
            // has settled. Resolve coordinates after that transition, instead
            // of injecting gestures at its now-stale offscreen position.
            compose.mainClock.advanceTimeBy(320);compose.waitForIdle()
            compose.waitUntil(10000){InstrumentationRegistry.getInstrumentation().runOnMainSync{world.getLocationOnScreen(location)};location[0]>=0&&location[0]+w<=device.displayWidth}
            android.util.Log.i("BlockcolcWater","environment=$environment location=${location.toList()} width=$w height=$h top=$top")
            check(device.swipe(location[0]+(w*.72).toInt(),location[1]+top+(h*.45).toInt(),location[0]+(w*.3).toInt(),location[1]+top+(h*.45).toInt(),24))
            compose.waitUntil(10000){val d=worldDiagnostic(world,false);evidence("initial-rotate-$environment",d);kotlin.math.abs(d.getJSONObject("camera").getDouble("azimuth")-initial.getJSONObject("camera").getDouble("azimuth"))>.01}
            fun point(x:Int)=android.graphics.Point(location[0]+x,location[1]+top+h*2/3)
            check(surface.performTwoPointerGesture(point(w/8),point(w*7/8),point(w*3/8),point(w*5/8),20))
            compose.waitUntil(10000){val d=worldDiagnostic(world,false);evidence("zoom-$environment",d);kotlin.math.abs(d.getJSONObject("camera").getDouble("distance")-d.getJSONObject("navigation").getDouble("maximum"))<1e-6}
            val zoomed=worldDiagnostic(world,false);screen("water-$environment-before")
            check(device.swipe(location[0]+(w*.72).toInt(),location[1]+(h*.45).toInt(),location[0]+(w*.3).toInt(),location[1]+(h*.45).toInt(),24))
            compose.waitUntil(10000){kotlin.math.abs(worldDiagnostic(world,false).getJSONObject("camera").getDouble("azimuth")-zoomed.getJSONObject("camera").getDouble("azimuth"))>.01}
            compose.waitForIdle();val after=worldDiagnostic(world,false)
            assertFalse(after.getBoolean("failed"));assertEquals(initial.getJSONObject("ownerIdentities").toString(),after.getJSONObject("ownerIdentities").toString())
            assertNotEquals(zoomed.getJSONObject("camera").getDouble("azimuth"),after.getJSONObject("camera").getDouble("azimuth"))
            screen("water-$environment-rotated")
            captures.put(JSONObject().put("environment",environment).put("before",zoomed).put("after",after));evidence("complete-$environment",after)
        }
        assertEquals(4,captures.length())
    }
    @Test fun settingsSearchReachesControlsWithoutTreeOrChangingValuesOrFacts()=run{
        nav("设置")
        val original=runtime.testRead().get(30,TimeUnit.SECONDS).domain.sha256
        val preferences=runtime.latest.preferences
        val search=compose.onNodeWithTag("settings-search").performScrollTo()
        val label=compose.onNodeWithText("搜索设置",useUnmergedTree=true)
        fun labelInset()=label.fetchSemanticsNode().boundsInRoot.top-search.fetchSemanticsNode().boundsInRoot.top
        val restingInset=labelInset()
        search.performClick()
        compose.waitUntil(10000){runCatching{labelInset()<restingInset-8f}.getOrDefault(false)}
        search.performTextInput("字体")
        label.assertIsDisplayed()
        compose.onNodeWithTag("settings-result-字体").assertTextContains("外观与阅读").performClick()
        compose.waitUntil(10000){runCatching{compose.onNodeWithText("混合字体").assertIsDisplayed()}.isSuccess}
        compose.onNodeWithText("混合字体").assertIsDisplayed()
        compose.onNodeWithText("设置目录").assertDoesNotExist()
        compose.onNodeWithTag("settings-search").performScrollTo().performTextReplacement("蓝图库")
        compose.onNodeWithTag("settings-result-蓝图库").performClick()
        compose.waitUntil(10000){runCatching{compose.onNodeWithText("原生图纸").assertIsDisplayed()}.isSuccess}
        compose.onNodeWithText("原生图纸").assertIsDisplayed()
        assertEquals(preferences,runtime.latest.preferences)
        assertEquals(original,runtime.testRead().get(30,TimeUnit.SECONDS).domain.sha256)
        screen("settings-library-jump")
    }
    @Test fun studyUsesResidentWorldAndAutomaticallyPlacesEachEarnedItemOnce()=run(partlyBuilt()){
        compose.waitUntil(60000){renderedWorld()?.let{worldDiagnostic(it)}?.let{value->
            val navigation=value.optJSONObject("navigation")
            value.optLong("gpuReadyFrames")>0&&navigation!=null&&!navigation.optBoolean("opening")&&!navigation.isNull("selected")
        }==true}
        val world=checkNotNull(renderedWorld());val before=worldDiagnostic(world)
        fun worldHud(label:String){
            if(compose.onAllNodesWithContentDescription(label).fetchSemanticsNodes().isEmpty()){
                compose.onNodeWithContentDescription("显示世界操作").performClick()
                compose.waitUntilAtLeastOneExists(hasContentDescription(label),10000)
                // The HUD suppresses the tap that revealed it and immediate follow-up input.
                android.os.SystemClock.sleep(420)
            }
            compose.onNodeWithContentDescription(label).performClick()
        }
        worldHud("室内视角")
        compose.waitUntil(15000){worldDiagnostic(world).getJSONObject("interior").let{it.optBoolean("active")&&it.optLong("presentedSequence")>0&&it.optLong("presentedSequence")==it.optLong("sequence")}}
        val indoors=worldDiagnostic(world);val eye=indoors.getJSONObject("navigation").getJSONArray("eye").toString()
        assertEquals(before.getJSONObject("ownerIdentities").getString("world"),indoors.getJSONObject("ownerIdentities").getString("world"))
        assertTrue(indoors.getJSONObject("interior").getJSONArray("items").toString().contains("bed"))
        screen("study-window")
        val location=IntArray(2);var width=0;var height=0
        InstrumentationRegistry.getInstrumentation().runOnMainSync{world.getLocationOnScreen(location);width=world.width;height=world.height}
        val visible=indoors.optInt("presentationHeight",height)
        val device=androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val startCamera=worldDiagnostic(world).getJSONObject("camera")
        val startYaw=startCamera.getDouble("azimuth");val startPitch=startCamera.getDouble("pitch")
        val density=context.resources.displayMetrics.density
        fun orient(yaw:Double,pitch:Double){
            repeat(12){
                val prior=worldDiagnostic(world);val camera=prior.getJSONObject("camera")
                val ax=yaw-camera.getDouble("azimuth");val ay=pitch-camera.getDouble("pitch")
                if(kotlin.math.abs(ax)<.08&&kotlin.math.abs(ay)<.08)return
                // The renderer reports azimuth as PI/2 - navigation.azimuth.
                val dx=(-ax/.006*density).coerceIn(-width*.65,width*.65).toInt()
                val dy=(ay/.0045*density).coerceIn(-visible*.35,visible*.35).toInt()
                check(device.swipe(location[0]+width/2-dx/2,location[1]+visible/2-dy/2,location[0]+width/2+dx/2,location[1]+visible/2+dy/2,12))
                // gpuReadyFrames counts adopted scenes, not camera frames.
                compose.waitUntil(10000){val next=worldDiagnostic(world);val c=next.getJSONObject("camera");next.optLong("frames")>prior.optLong("frames")&&
                    (kotlin.math.abs(c.getDouble("azimuth")-camera.getDouble("azimuth"))>.002||kotlin.math.abs(c.getDouble("pitch")-camera.getDouble("pitch"))>.002)}
                val submitted=worldDiagnostic(world).getLong("frames")
                compose.waitUntil(10000){worldDiagnostic(world).getLong("frames")>submitted+1}
            }
            val camera=worldDiagnostic(world).getJSONObject("camera")
            assertEquals(yaw,camera.getDouble("azimuth"),.08);assertEquals(pitch,camera.getDouble("pitch"),.08)
        }
        repeat(4){turn->
            orient(startYaw+(turn+1)*Math.PI/2,startPitch)
            if(turn==1){
                orient(startYaw+Math.PI,20*Math.PI/180);screen("study-bed")
                orient(startYaw+Math.PI,-25*Math.PI/180);screen("study-ceiling")
                orient(startYaw+Math.PI,startPitch)
            }
            screen("study-side-${turn+1}")
        }
        assertEquals(eye,worldDiagnostic(world).getJSONObject("navigation").getJSONArray("eye").toString())
        screen("study-room")
        compose.onNodeWithContentDescription("书房摆设").assertDoesNotExist()
        worldHud("返回聚落")
        compose.waitUntil(10000){worldDiagnostic(world).getJSONObject("interior").let{
            !it.getBoolean("active")&&it.getLong("presentedSequence")==it.getLong("sequence")
        }}
        val after=worldDiagnostic(world)
        assertEquals(before.getJSONObject("camera").toString(),after.getJSONObject("camera").toString())
        assertEquals(before.getJSONObject("ownerIdentities").getString("world"),after.getJSONObject("ownerIdentities").getString("world"))
        worldHud("室内视角")
        compose.waitUntil(15000){worldDiagnostic(world).getJSONObject("interior").getBoolean("active")}
        nav("任务");compose.onAllNodesWithText("查看建筑").onFirst().performScrollTo().performClick()
        compose.waitUntil(15000){!worldDiagnostic(world).getJSONObject("interior").getBoolean("active")}
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle,"建筑记忆")).assertExists()
        val group=InstrumentationRegistry.getArguments().getString("p3Group")?:"local"
        File(context.filesDir,"p3-world-study.json").writeText(JSONObject().put("schema",1).put("caseLabel",group).put("before",before).put("inside",indoors).put("after",after).toString())
    }
    @Test fun savedNoteIsNotRetriedWhenOnlyTheBackupListProjectionFails()=run{name->
        nav("任务")
        // Diagnostic contexts deliberately disable scheduled daily work. Create
        // the root through the real storage API before injecting its corruption.
        AndroidStateDatabase(context,name).use{db->
            val storage=NativeStateStore(db)
            storage.captureDaily(checkNotNull(storage.load()).token,DomainTime.format(System.currentTimeMillis()))
        }
        val original=AndroidStateDatabase(context,name).use{db->db.transaction{sql->
            val row=sql.query("SELECT id,manifest_sha FROM backup_roots WHERE kind='daily'").single()
            sql.execute("UPDATE backup_roots SET manifest_sha=? WHERE id=?",listOf("0".repeat(64),row[0]))
            row
        }}
        val field=compose.onNodeWithContentDescription("写一条便签")
        field.performScrollTo().performTextInput("只保存一次")
        val before=runtime.latest.receipts.map{it.id}.toSet()
        compose.onNodeWithContentDescription("添加便签").performScrollTo().performClick()
        compose.waitUntil(10000){runtime.latest.refreshRequired}
        assertTrue(runtime.latest.receipts.any{it.id !in before&&it.saved&&it.reason=="DISPLAY_UNAVAILABLE"})
        val actual=runtime.testRead().get(30,TimeUnit.SECONDS).domain.json().getJSONArray("quickNotes")
        assertEquals(1,actual.length());assertEquals("只保存一次",actual.getJSONObject(0).getString("text"))
        compose.onNodeWithText("记录已保存，页面暂未更新。").assertIsDisplayed()
        AndroidStateDatabase(context,name).use{db->db.transaction{it.execute("UPDATE backup_roots SET manifest_sha=? WHERE id=?",listOf(original[1],original[0]))}}
        compose.onNodeWithText("重试显示").performClick()
        compose.waitUntil(10000){!runtime.latest.refreshRequired&&!runtime.latest.busy}
        compose.onNodeWithText("只保存一次").performScrollTo().assertIsDisplayed()
        assertEquals(1,runtime.latest.notes.size)
        screen("saved-display-recovery")
    }
    private fun formalUiInitial():DomainDocument {
        val source=DomainEngine.initial("Asia/Shanghai")
        val result=DomainEngine.execute(source,DomainEngine.command("CreateProject","projectId" to "formal-ui-work","title" to "我的第一座工坊","blueprintId" to "builtin-small-workshop",
            "subtasks" to JSONArray().put(JSONObject().put("id","goal").put("title","确定目标")).put(JSONObject().put("id","work").put("title","完成核心工作")).put(JSONObject().put("id","check").put("title","检查并收尾"))),System.currentTimeMillis())
        check(result.ok){result.error.orEmpty()};return result.state
    }
    @Test fun startStaysVisibleOnTheCompactWorkbench()=run(formalUiInitial()){
        val start=compose.onNodeWithText("开始 1 轮").assertIsDisplayed()
        val panel=compose.onNodeWithTag("formal-normal-workbench").fetchSemanticsNode().boundsInRoot
        assertTrue("Start must fit inside the workbench",start.fetchSemanticsNode().boundsInRoot.bottom<=panel.bottom)
        screen("compact-timer")
        start.performClick()
        compose.waitUntil(10000){runtime.latest.phase=="FOCUS"}
    }

    @Test fun formalWorkbenchPagesAndMinimalControlsMatchSourceGeometry()=run(formalUiInitial(),configure={it.copy(themeMode="light",fontStyle="pixel",focusMinutes=25,breakMinutes=5,quickNotesEnabled=false)}){
        compose.onNodeWithText("我的第一座工坊").assertIsDisplayed()
        compose.onNodeWithText(" · 第 1 / 3 项").assertIsDisplayed();compose.onNodeWithText("确定目标").assertIsDisplayed()
        compose.onNodeWithText("1 轮 · 预计",substring=true).assertIsDisplayed();compose.onNodeWithText("总计",substring=true).assertDoesNotExist()
        compose.onNodeWithText("每轮时长").assertIsDisplayed();compose.onNodeWithText("开始 1 轮").assertIsDisplayed()
        val density=context.resources.displayMetrics.density
        val clock=compose.onNodeWithText("25:00").fetchSemanticsNode().boundsInRoot
        val panel=compose.onNodeWithTag("formal-normal-workbench").fetchSemanticsNode().boundsInRoot
        val layouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
        compose.onNodeWithText("25:00").performSemanticsAction(SemanticsActions.GetTextLayoutResult){it(layouts)}
        assertEquals(48f,layouts.single().layoutInput.style.fontSize.value,.01f)
        assertEquals(panel.center.x,clock.center.x,1f)
        assertEquals(20f*density,compose.onNodeWithText("我的第一座工坊").fetchSemanticsNode().boundsInRoot.left,1.5f)
        screen("formal-timer")
        nav("任务")
        compose.onNodeWithText("当前大任务").assertDoesNotExist();compose.onNodeWithText("施工清单").assertDoesNotExist()
        compose.onNodeWithText("我的第一座工坊").assertIsDisplayed();compose.onNodeWithContentDescription("编辑施工清单").assertIsDisplayed()
        compose.onNodeWithText("已完成 0 / 3 项").assertIsDisplayed();compose.onNodeWithText("管理任务").assertDoesNotExist()
        screen("formal-tasks")
        nav("统计")
        compose.onNodeWithText("专注热力图").assertIsDisplayed()
        compose.onNodeWithText("今天的投入").assertIsDisplayed();compose.onNodeWithText("有效完成轮次 / 目标完成轮次").assertIsDisplayed()
        compose.onNodeWithContentDescription("专注日历").assertIsDisplayed();screen("formal-statistics")
        nav("设置");compose.onNodeWithText("设置目录").assertDoesNotExist();screen("formal-settings")
        nav("计时")
        runtime.updatePreferences{it.copy(minimalMode=true,focusGlassTransparency=100)}
        compose.waitUntil(10000){runtime.latest.preferences.minimalMode&&!runtime.latest.preferencesSaving}
        compose.onNodeWithTag("formal-normal-workbench").assertIsDisplayed();compose.onNodeWithText("极简").performClick()
        compose.waitUntilDoesNotExist(hasTestTag("mode-transition"),15000)
        compose.waitUntil(15000){runCatching{compose.onNodeWithTag("formal-minimal-panel").assertIsDisplayed()}.isSuccess}
        val glass=compose.onNodeWithTag("formal-minimal-panel").fetchSemanticsNode().boundsInRoot
        val available=context.resources.displayMetrics.heightPixels/density
        assertEquals((available*.34f).coerceIn(266f,304f).coerceAtMost(available*.85f)*density,glass.height,2f)
        compose.onNodeWithText("返回普通模式").assertDoesNotExist();screen("formal-minimal-idle")
        // Core controls are intentionally usable before any world View exists.
        // Observe the actual scene, not the time spent visiting the other tabs.
        compose.waitUntil(90000){renderedWorld()?.let{world->
            val frame=worldDiagnostic(world,false)
            frame.optLong("gpuReadyFrames")>0&&!frame.optBoolean("fencePending")&&frame.isNull("pendingPresentation")
        }==true}
        val world=checkNotNull(renderedWorld())
        compose.waitUntil(10000){worldDiagnostic(world).getJSONObject("colorPipeline").optInt("glassRegions")==1}
        compose.onNodeWithTag("formal-minimal-panel").performTouchInput{doubleClick(Offset(width*.5f,height*.94f))}
        compose.onNodeWithText("返回普通模式").assertIsDisplayed();screen("formal-minimal-revealed")
        compose.onNodeWithTag("minimal-info-pager").performTouchInput{swipeLeft()}
        compose.onNodeWithTag("minimal-today-timeline").assertIsDisplayed();screen("formal-minimal-today")
        compose.onNodeWithTag("minimal-info-pager").performTouchInput{swipeRight()}
        compose.onNodeWithText("返回普通模式").performClick()
        compose.waitUntilDoesNotExist(hasTestTag("mode-transition"),15000)
        compose.waitUntil(15000){runCatching{compose.onNodeWithTag("formal-normal-workbench").assertIsDisplayed()}.isSuccess}
        compose.onNodeWithText("调整").performClick();compose.waitUntilAtLeastOneExists(isDialog(),10000)
        compose.waitUntil(10000){worldDiagnostic(world).getJSONObject("colorPipeline").optInt("glassRegions")==0}
        screen("formal-adjustment")
    }
    @Test fun bothLanguagesFinishBothModeTransitionsAndRestoreTheSameWorldWindow()=run{
        compose.waitUntil(60000){renderedWorld()!=null&&runCatching{worldDiagnostic(checkNotNull(renderedWorld())).getLong("gpuReadyFrames")>0}.getOrDefault(false)}
        val world=checkNotNull(renderedWorld());val results=JSONArray()
        for(language in listOf("zh-CN","en")){
            runtime.updatePreferences{it.copy(language=language,minimalMode=true,focusGlassTransparency=84)}
            compose.waitUntil(10000){runtime.latest.preferences.language==language&&!runtime.latest.preferencesSaving}
            val text=checkNotNull(runtime.latest.uiResources)
            val normal=compose.onNodeWithTag("formal-normal-workbench").fetchSemanticsNode().boundsInRoot
            val before=worldDiagnostic(world)
            compose.onNodeWithText(text.text(language,"极简")).performClick()
            compose.waitUntilDoesNotExist(hasTestTag("mode-transition"),15000)
            compose.onNodeWithTag("formal-minimal-panel").assertIsDisplayed()
            assertSame(world,renderedWorld())
            compose.waitUntil(10000){worldDiagnostic(world).getJSONObject("colorPipeline").optInt("glassRegions")==1}
            compose.onNodeWithTag("formal-minimal-panel").performTouchInput{doubleClick(Offset(width*.5f,height*.94f))}
            compose.onNodeWithText(text.text(language,"返回普通模式")).performClick()
            compose.waitUntilDoesNotExist(hasTestTag("mode-transition"),15000)
            compose.onNodeWithTag("formal-normal-workbench").assertIsDisplayed();assertSame(world,renderedWorld())
            val restored=compose.onNodeWithTag("formal-normal-workbench").fetchSemanticsNode().boundsInRoot
            assertEquals(normal.top,restored.top,2f);assertEquals(normal.height,restored.height,2f)
            val after=worldDiagnostic(world)
            assertFalse(after.getBoolean("failed"));assertEquals(before.getInt("presentationHeight"),after.getInt("presentationHeight"))
            for(key in listOf("owners","geometries","textures"))assertEquals(key,before.getJSONObject("resources").getJSONObject(key).toString(),after.getJSONObject("resources").getJSONObject(key).toString())
            assertTrue(runtime.testRead().get(30,TimeUnit.SECONDS).domain.focusControlJson().isNull("activeFocusSession"))
            screen("mode-window-$language")
            results.put(JSONObject().put("language",language).put("projectionHeightBefore",before.getInt("presentationHeight"))
                .put("projectionHeightAfter",after.getInt("presentationHeight")).put("worldInstanceRetained",true).put("transitionGone",true))
        }
        File(context.filesDir,"p3-world-mode-window-roundtrip.json").writeText(JSONObject().put("schema",1)
            .put("caseLabel",InstrumentationRegistry.getArguments().getString("p3Group")).put("languages",results).toString())
    }
    private fun formalCollectionInitial():DomainDocument {
        var state=DomainEngine.initial("Asia/Shanghai");var at=System.currentTimeMillis()-30*60000L;var sequence=0
        fun step(command:JSONObject){val result=DomainEngine.execute(state,command,at);check(result.ok){result.error.orEmpty()};state=result.state;at+=10}
        step(DomainEngine.command("CreateProject","projectId" to "completed-work","title" to "写作工程","blueprintId" to "builtin-small-workshop","subtasks" to JSONArray().put(JSONObject().put("id","outline").put("title","提纲")).put(JSONObject().put("id","draft").put("title","正文"))))
        step(DomainEngine.command("CreateHabitProject","projectId" to "completed-habit","title" to "每日阅读","blueprintId" to "builtin-small-workshop","targetRounds" to 10))
        fun focus(project:String,task:String?,marathon:Boolean=false){
            step(DomainEngine.command("SwitchActiveProject","projectId" to project))
            val id="collection-focus-${++sequence}"
            val start=DomainEngine.command("StartFocus","sessionId" to id,"subtaskId" to (task?:JSONObject.NULL),"plannedDurationMs" to 60000)
            if(marathon)start.put("marathon",true).put("deferredSettlement",true)
            step(start);at+=60000;step(DomainEngine.command("CompleteFocus"))
            if(task!=null)step(DomainEngine.command("ReportSubtaskProgress","reportId" to "collection-report-$sequence","subtaskId" to task,"focusSessionIds" to JSONArray(listOf(id)),"progressBasisPoints" to 10000))
            if(marathon)step(DomainEngine.command("ReportMarathonFocus","focusSessionIds" to JSONArray(listOf(id)),"entries" to JSONArray(),"habitAllocations" to JSONArray()))
        }
        focus("completed-work","outline");focus("completed-work","draft")
        repeat(10){focus("completed-habit",null)}
        step(DomainEngine.command("CreateProject","projectId" to "next-work","title" to "下一座工坊","blueprintId" to "builtin-small-workshop","subtasks" to JSONArray().put(JSONObject().put("id","next-task").put("title","新的计划"))))
        focus("next-work",null,true)
        return state
    }
    @Test fun formalCollectionsAndCreationUseTheOriginalPageLayouts()=run(formalCollectionInitial(),configure={it.copy(themeMode="light",fontStyle="pixel",focusMinutes=25,quickNotesEnabled=false)}){
        nav("统计")
        compose.waitUntilAtLeastOneExists(hasText("全部关闭"),10000)
        compose.onNodeWithText("全部关闭").performScrollTo().performClick()
        compose.waitUntilDoesNotExist(isDialog(),10000)
        compose.onNodeWithText("纪念建筑").performScrollTo().performClick()
        compose.onNode(hasText("写作工程") and hasClickAction()).performScrollTo().performClick()
        compose.onNodeWithText("旗下小任务投入").performScrollTo().assertIsDisplayed();screen("formal-monument-details")
        compose.onNodeWithText("未分配的投入").performScrollTo().assertIsDisplayed();screen("formal-unallocated")
        compose.onNodeWithText("成就").performScrollTo().performClick()
        compose.onNodeWithText("从第一天起的专注与建造记录。").assertDoesNotExist();screen("formal-achievements")
        compose.onNodeWithText("第一块基石").performScrollTo().assertIsDisplayed();screen("formal-achievement-rows")
        nav("任务");compose.onNodeWithText("新增任务").performScrollTo().performClick()
        compose.waitUntilAtLeastOneExists(hasContentDescription("任务名称"),10000)
        compose.onNode(isDialog()).assertDoesNotExist()
        compose.onNodeWithText("普通大型任务").assertIsDisplayed();compose.onNodeWithText("拆成小任务").assertIsDisplayed()
        compose.onNodeWithContentDescription("任务名称").assertTextEquals("我的第一座工坊");screen("formal-create-task")
        compose.onNode(hasContentDescription("完整建筑预览，可拖动旋转",substring=true)).performScrollTo()
        compose.waitUntilAtLeastOneExists(hasContentDescription("重置预览视角"),30000)
        compose.onNodeWithContentDescription("重置预览视角").assertIsDisplayed();screen("formal-create-preview")
        compose.onNodeWithText("开始建造").performScrollTo().assertIsDisplayed();screen("formal-create-footer")
        compose.onNodeWithText("习惯任务").performScrollTo().performClick()
        compose.onNodeWithText("每座建筑").performScrollTo().assertIsDisplayed();screen("formal-create-habit")
        compose.onNodeWithText("取消").performScrollTo().performClick()
        assertNull(runtime.latest.planId)
        assertEquals(3,runtime.latest.projects.size)
    }
    @Test fun formalLoadingArtworkKeepsItsPhaseAcrossRealLoadingStages(){
        val resources=com.blockcolc.presentation.UiResources.load()
        var selected by mutableStateOf(com.blockcolc.preview.ui.NativeLoadingChoice(tomato=false,house=0))
        var stage by mutableStateOf("正在读取本机记录")
        compose.setContent{com.blockcolc.preview.ui.NativeTheme(com.blockcolc.presentation.ClientPreferences(themeMode="light",fontStyle="pixel"),resources){
            com.blockcolc.preview.ui.NativePageActivation(false,com.blockcolc.preview.ui.LocalNativeLoading provides selected){
                com.blockcolc.preview.ui.NativeLoadingScene(stage,androidx.compose.ui.Modifier.fillMaxSize(),stageKind=if(stage=="正在读取本机记录")"storage"else"scene")
            }
        }}
        for(tomato in listOf(false,true)){
            val lease=Any()
            compose.runOnIdle{
                selected=com.blockcolc.preview.ui.NativeLoadingChoice(tomato=tomato,house=0)
                selected.attach(lease,0)
            }
            for(phase in listOf(0f,1.2f,3.4f,5.6f,7.2f)){
                compose.runOnIdle{selected.sample(lease,(phase*1e9f).toLong())}
                screen("formal-loading-${if(tomato)"tomato"else"house"}-${(phase*10).toInt()}")
            }
        }
        val before=compose.onNodeWithTag("formal-loading-art",useUnmergedTree=true).captureToImage().toPixelMap()
        compose.runOnIdle{stage="正在建造世界"}
        val after=compose.onNodeWithTag("formal-loading-art",useUnmergedTree=true).captureToImage().toPixelMap()
        assertEquals(before.width,after.width);assertEquals(before.height,after.height)
        for(y in 0 until before.height step 3)for(x in 0 until before.width step 3)assertEquals(before[x,y],after[x,y])
        assertEquals(7.2f,selected.phase,.001f)
    }
    @Test fun hiddenSheetAlwaysReleasesItsWindowEvenIfTheParentCloseIsDelayed(){
        val resources=com.blockcolc.presentation.UiResources.load()
        var model by mutableStateOf<String?>(null);var closes by mutableIntStateOf(0)
        compose.setContent{com.blockcolc.preview.ui.NativeTheme(com.blockcolc.presentation.ClientPreferences(themeMode="dark"),resources){
            Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.White))
            com.blockcolc.preview.ui.NativeSheet(model,{"测试弹页"},{closes++}){
                androidx.compose.foundation.layout.Box(Modifier.fillMaxWidth().height(300.dp).testTag("sheet-swipe-area"))
            }
        }}
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        fun backdropBrightness():Int{
            compose.waitForIdle()
            val frame=checkNotNull(automation.takeScreenshot())
            return try{android.graphics.Color.red(frame.getPixel(frame.width/2,frame.height/5))}finally{frame.recycle()}
        }
        val unobscured=backdropBrightness()
        compose.runOnIdle{model="first"}
        compose.waitUntilAtLeastOneExists(isDialog(),10000)
        // Dialog semantics precede the physical window's opening frame.
        compose.mainClock.advanceTimeBy(500)
        var open=unobscured
        var settledSamples=0
        compose.waitUntil(3000){
            val brightness=backdropBrightness()
            settledSamples=if(brightness<unobscured-15&&kotlin.math.abs(brightness-open)<=2)settledSamples+1 else 0
            open=brightness
            settledSamples>=2
        }
        val drag=compose.onNodeWithTag("sheet-swipe-area")
        val originalTop=drag.fetchSemanticsNode().boundsInWindow.top
        drag.performTouchInput{
            down(Offset(centerX,10f))
            moveBy(Offset(0f,height*.4f),120)
        }
        // Wait for the compositor to present the held drag before sampling it.
        var moving=open
        try{
            compose.waitUntil(1500){
                moving=backdropBrightness()
                moving>open+12&&moving<unobscured-5
            }
        }catch(error:androidx.compose.ui.test.ComposeTimeoutException){
            val movedTop=drag.fetchSemanticsNode().boundsInWindow.top
            throw AssertionError("Sheet drag moved from $originalTop to $movedTop. Screen red: clear=$unobscured, open=$open, held=$moving",error)
        }
        drag.performTouchInput{moveBy(Offset(0f,height*.45f),80);up()}
        compose.waitUntilDoesNotExist(isDialog(),10000)
        // The dialog semantics disappear before SurfaceFlinger presents the next frame.
        compose.waitUntil(500){backdropBrightness()>=unobscured-1}
        assertEquals(1,closes);assertEquals("first",model)
        compose.runOnIdle{model=null};compose.waitForIdle();compose.runOnIdle{model="second"}
        compose.waitUntilAtLeastOneExists(isDialog(),10000)
        compose.onNodeWithContentDescription("返回").performClick()
        compose.waitUntilDoesNotExist(isDialog(),10000)
        assertEquals(2,closes)
    }
    @Test fun physicalSliderAimAndLandingKeepOneValueUntilTheSaveReceipt(){
        val resources=com.blockcolc.presentation.UiResources.load()
        val density=context.resources.displayMetrics.density
        var value by mutableIntStateOf(50);var saving by mutableStateOf(false);var error by mutableStateOf<String?>(null)
        var submitted:Int?=null
        compose.setContent{com.blockcolc.preview.ui.NativeTheme(com.blockcolc.presentation.ClientPreferences(themeMode="light"),resources){
            androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.White).padding(horizontal=20.dp),verticalArrangement=Arrangement.Center){
                com.blockcolc.preview.ui.NativeToggle("测试开关",null,true,true){}
                com.blockcolc.preview.ui.NativeSettingSlider("液态玻璃",value,0,100,true,saving,error){submitted=it;saving=true}
            }
        }}
        compose.onNodeWithText("液态玻璃").performClick();compose.waitForIdle()
        val slider=compose.onNodeWithContentDescription("液态玻璃")
        for(pullY in listOf(-48f,48f)){
            compose.runOnIdle{value=50;submitted=null;saving=false;error=null}
            val bounds=slider.fetchSemanticsNode().boundsInRoot
            val usable=(bounds.width/density-24).toDouble()
            val flight=com.blockcolc.presentation.SliderPhysics.flight(usable/2,-34.0,pullY.toDouble(),usable)
            val expected=com.blockcolc.presentation.SliderPhysics.landingValueAt(flight.landing,usable,0,100,5,flight.vx)
            assertNotEquals(50,expected)
            slider.performTouchInput{down(center);moveTo(Offset(center.x-34*density,center.y+pullY*density))}
            compose.onNodeWithText("预计 $expected%").assertIsDisplayed()
            val image=slider.captureToImage().toPixelMap()
            val x=((12+flight.landing)*density).toInt().coerceIn(1,image.width-2)
            val y=(image.height/2-5*density).toInt().coerceIn(1,image.height-2)
            val target=image[x,y]
            assertTrue("Expected landing marker must end at the trajectory, not the snapped percentage",target.green>target.red+.015f)
            screen(if(pullY<0)"slider-aim-up"else"slider-aim-down")
            compose.mainClock.autoAdvance=false
            try{
                slider.performTouchInput{up()}
                repeat(200){
                    compose.mainClock.advanceTimeBy(16)
                    if(submitted!=null){assertEquals(expected,submitted);compose.onNodeWithText("$expected%").assertIsDisplayed();compose.onNodeWithText("50%").assertDoesNotExist()}
                }
                assertEquals(expected,submitted)
                compose.onNodeWithText("测试开关").assertIsEnabled()
                compose.runOnIdle{value=expected;saving=false};compose.mainClock.advanceTimeBy(32)
                compose.onNodeWithText("$expected%").assertIsDisplayed()
            }finally{compose.mainClock.autoAdvance=true}
        }
        val durable=value
        slider.performSemanticsAction(SemanticsActions.SetProgress){assertTrue(it(25f))}
        compose.onNodeWithText("25%").assertIsDisplayed()
        compose.runOnIdle{saving=false;error="test save failed"}
        compose.waitForIdle();compose.onNodeWithText("$durable%").assertIsDisplayed()
    }
    @Test fun disclosuresClipFirstFramesAndEmptyListsDoNotAddHeight(){
        val resources=com.blockcolc.presentation.UiResources.load()
        var open by mutableStateOf(false);var empty by mutableStateOf(false)
        val magenta=androidx.compose.ui.graphics.Color(0xffed2299)
        compose.setContent{com.blockcolc.preview.ui.NativeTheme(com.blockcolc.presentation.ClientPreferences(themeMode="light"),resources){
            androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.White)){
                androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.testTag("animated-disclosure")){
                    com.blockcolc.preview.ui.NativeDisclosure("内容",null,open,{open=it},
                        trailing={com.blockcolc.preview.ui.NativeIconAction("操作","reset",{})},showTrailing=open,contentBottomSpacing=8.dp){
                        androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.fillMaxWidth().height(96.dp).background(magenta))
                    }
                }
                com.blockcolc.preview.ui.NativeDisclosure("空列表",null,empty,{empty=it}){}
                androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.fillMaxWidth().height(64.dp).background(androidx.compose.ui.graphics.Color.Blue).testTag("after-empty"))
            }
        }}
        val baseline=compose.onNodeWithTag("after-empty").fetchSemanticsNode().boundsInRoot.top
        val header=compose.onNodeWithText("内容",useUnmergedTree=true)
        val headingTop=header.fetchSemanticsNode().boundsInRoot.top
        compose.onNodeWithContentDescription("操作").assertIsNotDisplayed()
        compose.mainClock.autoAdvance=false
        try{
            compose.onNodeWithText("空列表").performClick();compose.mainClock.advanceTimeBy(260)
            assertEquals(baseline,compose.onNodeWithTag("after-empty").fetchSemanticsNode().boundsInRoot.top,.5f)
            compose.onNodeWithText("内容").performClick()
            repeat(5){
                compose.mainClock.advanceTimeBy(24)
                val bounds=compose.onNodeWithTag("animated-disclosure").fetchSemanticsNode().boundsInRoot
                val pixels=compose.onRoot().captureToImage().toPixelMap()
                val bottom=(bounds.bottom+2).toInt().coerceAtMost(pixels.height)
                for(y in bottom until minOf(pixels.height,bottom+70) step 3)for(x in 4 until pixels.width-4 step 17)assertNotEquals("Expanded content leaked below its animated clip",magenta,pixels[x,y])
            }
            compose.mainClock.advanceTimeBy(200)
            assertEquals(headingTop,header.fetchSemanticsNode().boundsInRoot.top,.5f)
            compose.onNodeWithContentDescription("操作").assertIsDisplayed()
            compose.onNodeWithText("内容").performClick()
            compose.mainClock.advanceTimeBy(230)
            assertEquals(baseline,compose.onNodeWithTag("after-empty").fetchSemanticsNode().boundsInRoot.top,.5f)
            compose.onNodeWithContentDescription("操作").assertIsNotDisplayed()
        }finally{compose.mainClock.autoAdvance=true}
    }

}
