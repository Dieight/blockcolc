package com.blockcolc.preview.blueprints

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.viewinterop.AndroidView
import com.blockcolc.preview.resources.*
import com.blockcolc.preview.ui.*
import com.blockcolc.preview.world.AndroidSignRasterizer
import com.blockcolc.world.*
import com.blockcolc.world.filament.NativeWorldView
import com.blockcolc.world.generation.*
import com.blockcolc.world.resource.ResourceLibraryLease
import org.json.JSONObject
import java.util.concurrent.*

@Composable fun NativeBlueprintPreview(source:NativeBlueprintItem,modifier:Modifier=Modifier){
    val ui=LocalNativeUi.current;val context=LocalContext.current
    val dark=MaterialTheme.colorScheme.background.luminance()<.5f
    val resources=remember(context){NativeResourceController.get(context)}
    var selection by remember(resources){mutableStateOf(resources.snapshot().selection)}
    DisposableEffect(resources){val unsubscribe=resources.subscribe{selection=it.selection};onDispose{unsubscribe()}}
    LaunchedEffect(resources){if(!resources.snapshot().ready)resources.refresh()}
    val owner=remember(context,source,dark,ui.reduceMotion,selection){NativeBlueprintPreviewOwner(context,source,dark,ui.reduceMotion,selection)}
    var measuredSize by remember{mutableStateOf(IntSize.Zero)}
    LaunchedEffect(owner,measuredSize){owner.resize(measuredSize.width,measuredSize.height)}
    val lifecycle=remember(context){generateSequence(context){(it as? android.content.ContextWrapper)?.baseContext}.filterIsInstance<androidx.lifecycle.LifecycleOwner>().firstOrNull()?.lifecycle}
    DisposableEffect(owner,lifecycle){
        owner.foreground(lifecycle?.currentState?.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)?:true)
        val observer=androidx.lifecycle.LifecycleEventObserver{_,event->if(event==androidx.lifecycle.Lifecycle.Event.ON_START)owner.foreground(true)else if(event==androidx.lifecycle.Lifecycle.Event.ON_STOP)owner.foreground(false)}
        lifecycle?.addObserver(observer);onDispose{lifecycle?.removeObserver(observer);owner.close()}
    }
    Box(modifier.fillMaxWidth().height(280.dp).background(MaterialTheme.colorScheme.background).onSizeChanged{measuredSize=it}
        .semantics{contentDescription=ui.text("{0}完整建筑预览，可拖动旋转",if(source.localized)ui.text(source.displayName)else source.displayName)}){
        owner.scene?.let{scene->key(owner.version){AndroidView(factory={owner.createView(it,scene)},modifier=Modifier.fillMaxSize())}}
        if(owner.loading||owner.failed)Column(Modifier.align(Alignment.Center),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)){
            if(owner.failed){Text(ui.text("蓝图预览暂不可用"));NativeAction(ui.text("重试"),owner::retry,primary=false,icon="reset")}
            else {NativeBusy();Text(ui.text("正在准备建筑预览"),style=MaterialTheme.typography.bodySmall)}
        }
        if(!owner.loading&&!owner.failed)NativeIconAction(ui.text("重置预览视角"),"reset",owner::reset,modifier=Modifier.align(Alignment.TopEnd))
    }
}

/** Immutable CPU inputs are prepared off-main; each mounted preview owns one
 * Surface/engine. Every delivery is fenced, and closing releases its view and
 * archive lease even when a prior request is still completing. */
internal class NativeBlueprintPreviewOwner(private val context:Context,private val source:NativeBlueprintItem,private val dark:Boolean,
    private val reduceMotion:Boolean,private val selection:ResourceWorldSelection?):AutoCloseable {
    private val main=Handler(Looper.getMainLooper())
    private val worker=Executors.newSingleThreadExecutor{Thread(it,"blockcolc-blueprint-preview")}
    private val compiler=NativeBlueprintPreviewScene(AndroidSignRasterizer())
    private var future:Future<*>?=null
    private var lease:ResourceLibraryLease?=null
    private var view:NativeWorldView?=null
    @Volatile private var closed=false
    @Volatile private var epoch=0L
    private var active=false;private var width=0;private var height=0
    var scene by mutableStateOf<NativeGeneratedScene?>(null);private set
    var version by mutableLongStateOf(0);private set
    var loading by mutableStateOf(true);private set
    var failed by mutableStateOf(false);private set
    fun foreground(value:Boolean){if(closed)return;active=value;if(value){view?.resume();if(scene==null&&future==null)prepare()}else view?.pause()}
    fun resize(w:Int,h:Int){if(w==width&&h==height)return;width=w;height=h;if(w>0&&h>0&&active)prepare()}
    fun retry(){if(closed)return;prepare()}
    private fun prepare(){
        if(closed||!active||width<=0||height<=0||selection==null)return
        require(!source.locked){"Locked rewards cannot resolve geometry"}
        val token=++epoch;future?.cancel(true);view?.close();view=null;scene=null;loading=true;failed=false
        val aspect=width.toDouble()/height
        future=worker.submit{
            val cancelled={closed||epoch!=token||Thread.currentThread().isInterrupted}
            try{
                lease?.close();lease=null;compiler.clear()
                val json=source.previewCanonical()?.let(::JSONObject)?:BuiltinBlueprintCatalog.load().content(source.id).json()
                val blueprint=BlueprintSnapshot.read(json,source.category in setOf("daily","holiday","birthday"))
                val pack=if(selection.unavailable)error("Resource selection is unavailable")else if(selection.activeId==null&&selection.baseId==null)null else {
                    val opened=NativeResourceController.get(context).openForWorld(selection,cancelled);lease=opened
                    val stack=checkNotNull(opened.stack);val ids=NativeBlueprintPreviewScene.textureIds(blueprint,stack,cancelled)
                    NativeResourceWorldAssets.prepare(stack,ids,cancelled=cancelled)
                }
                val prepared=compiler.prepare(blueprint,dark,aspect,pack,cancelled)
                if(cancelled())throw CancellationException()
                main.post{if(!closed&&epoch==token){scene=prepared;version++;future=null}}
            }catch(_:CancellationException){/* stale CPU results never enter a view */}
            catch(_:Exception){main.post{if(!closed&&epoch==token){future=null;loading=false;failed=true}}}
            finally{lease?.close();lease=null}
        }
    }
    fun createView(context:Context,prepared:NativeGeneratedScene):NativeWorldView {
        check(!closed&&scene===prepared&&view==null);val token=epoch
        val next=NativeWorldView.preview(context,prepared,reduceMotion,onFrame={_,_,identity->
            main.post{if(!closed&&epoch==token&&prepared.presentationIdentity==identity){loading=false;failed=false}}
        },status={status->if(status.startsWith("ERROR:")||status=="NATIVE_UPDATE_ERROR")main.post{if(!closed&&epoch==token){loading=false;failed=true}}})
        view=next;if(active)next.resume()else next.pause();return next
    }
    fun reset(){view?.navigate(null,true)}
    override fun close(){if(closed)return;closed=true;epoch++;future?.cancel(true);future=null;scene=null;view?.close();view=null
        worker.execute{lease?.close();lease=null;compiler.clear()};worker.shutdown()}
}
