package com.blockcolc.preview

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.blockcolc.cloud.CloudTransport
import com.blockcolc.cloud.CloudSessionStorage
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.unit.dp
import com.blockcolc.presentation.ClientPreferences
import com.blockcolc.presentation.UiResources
import com.blockcolc.preview.ui.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import android.os.Handler
import android.os.Looper
import android.view.Choreographer

/** Actual account form -> TLS API -> native writer, with isolated app data. */
class P3CloudUiTest {
    @get:Rule val compose=createComposeRule()
    @Test fun longPressDragSavesTheAcceptedFriendOrder(){
        var order by mutableStateOf(emptyList<String>())
        var shown by mutableStateOf(true)
        fun friend(id:String,name:String,status:String="accepted")=JSONObject().put("id",id).put("name",name).put("status",status)
        val friends=listOf(friend("a","Alice"),friend("b","Bella"),friend("pending","Pending","pending"))
        val resources=UiResources.load()
        compose.setContent{NativeTheme(ClientPreferences(),resources){
            if(shown)Column{
                NativeOrderedFriendList("account",CloudView(friends=friends,friendOrder=order),{order=it}){item,gesture,dragging->
                    Box(gesture.fillMaxWidth().height(80.dp),contentAlignment=Alignment.Center){
                        Text(if(dragging)"Moving" else item.getString("name"))
                    }
                }
            }
        }}
        val a=compose.onNodeWithText("Alice")
        val b=compose.onNodeWithText("Bella")
        val originalB=b.fetchSemanticsNode().boundsInRoot
        val travel=originalB.center.y-a.fetchSemanticsNode().boundsInRoot.center.y+12
        a.performTouchInput{down(center)}
        val hold=android.view.ViewConfiguration.getLongPressTimeout().toLong()+100
        compose.mainClock.advanceTimeBy(hold)
        val moving=compose.onNodeWithText("Moving")
        compose.waitUntil(3000){compose.onAllNodesWithText("Moving").fetchSemanticsNodes().isNotEmpty()}
        moving.performTouchInput{advanceEventTime(hold);moveBy(Offset(0f,travel))}
        compose.waitUntil(3000){b.fetchSemanticsNode().boundsInRoot.top<originalB.top-originalB.height*.5f}
        assertTrue("The local order commits on release",order.isEmpty())
        moving.performTouchInput{up()}
        compose.waitUntil(3000){order==listOf("b","a")}
        compose.runOnIdle{shown=false}
        compose.runOnIdle{shown=true}
        assertTrue(b.fetchSemanticsNode().boundsInRoot.top<a.fetchSemanticsNode().boundsInRoot.top)
        compose.onNodeWithText("Pending").assertDoesNotExist()
    }

    @Test fun minimalFriendsOnlyShowAcceptedSummariesAndRefreshWhenVisible(){
        val refreshes=AtomicInteger()
        val account=JSONObject().put("id","reader").put("friendsEnabled",true)
        val rows=listOf(
            JSONObject().put("id","shared").put("status","accepted").put("name","Shared friend").put("focusing",true).put("currentName","Reading"),
            JSONObject().put("id","private").put("status","accepted").put("name","Private friend"),
            JSONObject().put("id","pending").put("status","pending").put("name","Pending friend"),
        )
        var visible by mutableStateOf(false)
        val resources=UiResources.load()
        compose.setContent{
            NativeTheme(ClientPreferences(language="en"),resources,reduceMotion=true){
                NativeMinimalFriends(CloudView(account=account,friends=rows),visible){refreshes.incrementAndGet()}
            }
        }
        compose.onNodeWithText("Shared friend").assertIsDisplayed()
        compose.onNodeWithText("Reading").assertIsDisplayed()
        compose.onNodeWithText("Private friend").assertIsDisplayed()
        compose.onNodeWithText("Pending friend").assertDoesNotExist()
        compose.onNodeWithText("Not focusing").assertDoesNotExist()
        assertEquals(0,refreshes.get())
        compose.runOnIdle{visible=true}
        compose.waitUntil(5000){refreshes.get()>0}
        compose.onNodeWithText("Friends").assertIsDisplayed().assert(hasClickAction().not())
        compose.onNodeWithContentDescription("View friends").assertDoesNotExist()
    }

    @Test fun friendSummariesOpenOnlyTheSelectedSharedHistory(){
        val fetched=AtomicInteger()
        val privateFetches=AtomicInteger()
        val shared=JSONObject().put("name","Shared friend").put("currentName","Reading").put("focusing",true)
            .put("startedAt","2026-11-15T08:55:00.000Z").put("endsAt","2026-11-15T09:35:00.000Z")
            .put("historyRevision","revision-1")
        val hidden=JSONObject().put("name","Private friend")
        val waiting=JSONObject().put("name","Idle friend").put("focusing",false)
        val data=JSONObject("""{"today":"2026-11-15","complete":false,"days":[{"date":"2025-08-11","actualFocusMs":120000},{"date":"2026-11-15","actualFocusMs":60000}]}""")
        val resources=UiResources.load()
        compose.setContent{
            NativeTheme(ClientPreferences(language="en",themeMode="light",fontStyle="mixed"),resources,reduceMotion=true){
                Column{
                    NativeFriendCard(shared,JSONObject(),true,{fetched.incrementAndGet();data},{},{})
                    NativeFriendCard(hidden,JSONObject(),true,{privateFetches.incrementAndGet();data},{},{})
                    NativeFriendCard(waiting,JSONObject(),true,{privateFetches.incrementAndGet();data},{},{})
                }
            }
        }
        compose.onNodeWithText("Shared friend").assertIsDisplayed()
        compose.onNodeWithText("Reading",substring=true).assertIsDisplayed()
        compose.onNodeWithText("Private friend").assertIsDisplayed()
        compose.onNodeWithText("Idle friend").assertIsDisplayed()
        compose.onNodeWithContentDescription("Focus heatmap").assertDoesNotExist()
        assertEquals(0,fetched.get())
        compose.onNodeWithText("Shared friend").performClick()
        compose.waitUntil(5000){compose.onAllNodesWithContentDescription("Focus heatmap").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("Today's focus").assertIsDisplayed()
        compose.onNodeWithText("1 min").assertIsDisplayed()
        compose.onNodeWithText("Total").performClick()
        compose.onNodeWithText("Total focus").assertIsDisplayed()
        compose.onNodeWithText("3 min").assertIsDisplayed()
        compose.onNodeWithText("Today").performClick()
        compose.onNodeWithText("Today's focus").assertIsDisplayed()
        compose.onNodeWithText("2025-08-11 – 2026-11-15").assertIsDisplayed()
        assertEquals(1,fetched.get())
        assertEquals(0,privateFetches.get())
        compose.onNodeWithText("Shared friend").performClick()
        compose.onNodeWithText("Private friend").performClick()
        compose.onNodeWithContentDescription("Focus heatmap").assertDoesNotExist()
        assertEquals(0,privateFetches.get())
    }

    @Test fun accountFormRegistersAndFriendControlsRemainBilingual(){
        val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
        val runtime=PreviewRuntime.get(context);val database=runtime.testDatabase(true,prepareAssets=false).get(30,TimeUnit.SECONDS)
        var preferences=false;var cloudTesting=false;var client:NativeCloudController?=null;var unsubscribe:(()->Unit)?=null
        val directory=File(context.noBackupFilesDir,"cloud-test-"+UUID.randomUUID())
        fun screenshot(name:String){
            compose.waitForIdle()
            // Compose semantics can update before Android has displayed the
            // new language/theme. Wait for real display frames before capture.
            val drawn=CountDownLatch(1)
            Handler(Looper.getMainLooper()).post{Choreographer.getInstance().postFrameCallback{
                Choreographer.getInstance().postFrameCallback{drawn.countDown()}
            }}
            assertTrue(drawn.await(10,TimeUnit.SECONDS))
            assertTrue(UiDevice.getInstance(instrumentation).takeScreenshot(File(context.filesDir,name)))
        }
        try{
            runtime.testClientPreferences(true).get(30,TimeUnit.SECONDS);preferences=true
            runtime.testCloud(true).get(30,TimeUnit.SECONDS);cloudTesting=true
            val proxy=if(InstrumentationRegistry.getArguments().getString("p3CloudTunnel")=="true")Proxy(Proxy.Type.HTTP,InetSocketAddress("127.0.0.1",18888))else null
            val controller=NativeCloudController.isolated(context,runtime,CloudTransport(context,proxy=proxy),directory);client=controller
            var view by mutableStateOf(controller.snapshot());var language by mutableStateOf("en");var accountOpen by mutableStateOf(true);var friendsOpen by mutableStateOf(false)
            unsubscribe=controller.subscribe{view=it};controller.start()
            val resources=UiResources.load()
            compose.setContent{NativeTheme(ClientPreferences(language=language,themeMode=if(language=="en")"light"else"dark",fontStyle="mixed"),resources,reduceMotion=true){
                NativeCloudPanels(controller,view,accountOpen,friendsOpen,{accountOpen=false},{friendsOpen=false})
            }}
            compose.waitUntil(30000){controller.snapshot().ready}
            compose.onNodeWithText("Register").performClick()
            val username="p3ui_"+UUID.randomUUID().toString().replace("-","").take(16)
            compose.onNodeWithContentDescription("Username").performTextInput(username)
            compose.onNodeWithContentDescription("Password (at least 10 characters)").performTextInput(UUID.randomUUID().toString())
            val password=compose.onNodeWithContentDescription("Password (at least 10 characters)")
            password.assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Password))
            compose.onNodeWithContentDescription("Show password").performClick()
            password.assert(SemanticsMatcher("Visible password"){!it.config.contains(SemanticsProperties.Password)})
            compose.onNodeWithContentDescription("Hide password").performClick()
            password.assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Password))
            compose.onNodeWithText("Create account").performScrollTo().performClick()
            compose.waitUntil(180000){controller.snapshot().let{it.lastSync!=null&&!it.busy||it.error!=null}}
            assertNull(controller.snapshot().error)
            File(context.filesDir,"p3-cloud-ui-account.json").writeText(JSONObject().put("syntheticUsername",username).put("syntheticAccount",controller.snapshot().account!!.getString("id")).toString())
            compose.onNodeWithText("Execution device").performScrollTo().performClick()
            compose.onNodeWithText("This device").performScrollTo().assertIsDisplayed()
            assertTrue(controller.snapshot().owned)
            compose.onNodeWithText("Friends").performScrollTo().performClick()
            compose.onNodeWithText("Focus status").performScrollTo().assertIsDisplayed()
            assertFalse("An open form must not send its draft",controller.snapshot().account!!.getBoolean("friendsEnabled"))
            val login=checkNotNull(CloudSessionStorage(context,directory).read())
            val serverAccount=CloudTransport(context,proxy=proxy).request("/v1/account",token=login.token)
            assertFalse("Server preferences changed before leaving the form",serverAccount.getBoolean("friendsEnabled"))
            screenshot("p3-cloud-ui-account-en.png")
            compose.runOnIdle{language="zh-CN"}
            compose.onNodeWithText("好友功能").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("执行设备").performScrollTo().assertIsDisplayed()
            screenshot("p3-cloud-ui-account-zh.png")
            compose.onNodeWithContentDescription("返回").performClick()
            compose.waitUntil(30000){controller.snapshot().let{it.error!=null||!it.accountPending&&it.account?.optBoolean("friendsEnabled")==true&&!it.busy}}
            assertNull(controller.snapshot().error)
            assertTrue(CloudTransport(context,proxy=proxy).request("/v1/account",token=login.token).getBoolean("friendsEnabled"))
            compose.runOnIdle{language="en";accountOpen=true}
            compose.onNodeWithText("Focus status").performScrollTo().assertIsDisplayed()
            compose.onNodeWithContentDescription("Back").performClick()
            compose.runOnIdle{friendsOpen=true}
            compose.onNodeWithText("No friends yet").assertIsDisplayed()
            compose.onNodeWithContentDescription("Add friend code").assertIsDisplayed()
            screenshot("p3-cloud-ui-friends-en.png")
            // Optional deployed public-source check. It uses this synthetic
            // reader account; it never signs in as the imported identity or
            // sends focus data to the external service.
            InstrumentationRegistry.getArguments().getString("p3ExternalFriendCode")?.let{code->
                compose.onNodeWithContentDescription("Add friend code").performTextInput(code)
                compose.onNodeWithText("Send invite").performScrollTo().performClick()
                compose.waitUntil(30000){controller.snapshot().let{it.friends.isNotEmpty()&&!it.busy||it.error!=null}}
                assertNull(controller.snapshot().error)
                val friend=controller.snapshot().friends.single()
                assertTrue(friend.optBoolean("readOnly"));assertEquals("accepted",friend.getString("status"))
                assertTrue(friend.has("historyRevision"))
                assertFalse(friend.has("days"))
                compose.onNodeWithText("Mutsumi Focus").performScrollTo().performClick()
                compose.onNodeWithText("Mutsumi Focus · public, read-only").performScrollTo().assertIsDisplayed()
                compose.onAllNodesWithText("Use defaults").assertCountEquals(0)
                screenshot("p3-cloud-ui-external-en.png")
                compose.runOnIdle{language="zh-CN"}
                compose.onNodeWithText("Mutsumi Focus · 公开只读数据").performScrollTo().assertIsDisplayed()
                compose.onAllNodesWithText("使用默认设置").assertCountEquals(0)
                screenshot("p3-cloud-ui-external-zh.png")
            }
            controller.logout();compose.waitUntil(30000){controller.snapshot().account==null}
        }finally{
            unsubscribe?.invoke();client?.testClose()
            if(cloudTesting)runtime.testCloud(false).get(30,TimeUnit.SECONDS)
            if(preferences)runtime.testClientPreferences(false).get(30,TimeUnit.SECONDS)
            runtime.testDatabase(false,prepareAssets=false).get(30,TimeUnit.SECONDS);context.deleteDatabase(database)
            val presentation=File(context.filesDir,"presentation-$database");if(presentation.isDirectory)presentation.deleteRecursively()
            if(directory.isDirectory){check(directory.parentFile==context.noBackupFilesDir);directory.deleteRecursively()}
            for(name in listOf("cloud-execution-isolated","cloud-device-isolated","cloud-resource-choice-isolated","native-ui-$database"))context.getSharedPreferences(name,0).edit().clear().commit()
        }
    }
}
