package com.blockcolc.preview.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.launch

internal val LocalNativeSettingsActions=staticCompositionLocalOf{false}

@Composable internal fun Modifier.nativePressMotion(interaction:MutableInteractionSource,enabled:Boolean=true):Modifier {
    val pressed by interaction.collectIsPressedAsState()
    val reduce=LocalNativeUi.current.reduceMotion
    val progress=animateFloatAsState(if(pressed&&enabled&&!reduce)1f else 0f,
        tween(if(reduce)0 else if(pressed)65 else 120,easing=FastOutSlowInEasing),label="press-motion")
    return graphicsLayer{
        translationY=1.dp.toPx()*progress.value
    }
}

@Composable fun NativeAction(label:String,onClick:()->Unit,modifier:Modifier=Modifier,pending:Boolean=false,enabled:Boolean=true,icon:String="check",primary:Boolean=true,danger:Boolean=false,tag:String?=null,leading:(@Composable ()->Unit)?=null){
    val colors=MaterialTheme.colorScheme
    val reduce=LocalNativeUi.current.reduceMotion
    val interaction=remember{MutableInteractionSource()}
    val pressed by interaction.collectIsPressedAsState()
    val settings=LocalNativeSettingsActions.current
    var motion by remember{mutableIntStateOf(0)}
    val sweep=remember{Animatable(0f)}
    val scope=rememberCoroutineScope()
    val showSweep=primary&&!danger&&enabled
    LaunchedEffect(pressed,showSweep,reduce){
        if(!showSweep)sweep.snapTo(0f)
        else if(pressed){
            if(reduce)sweep.snapTo(1f)
            else sweep.animateTo(1f,tween(280,easing=CubicBezierEasing(0.16f,1f,0.3f,1f)))
        }else if(sweep.value>0f&&motion==0){
            if(reduce)sweep.snapTo(0f)
            else sweep.animateTo(0f,tween(260,easing=FastOutSlowInEasing))
        }
    }
    LaunchedEffect(motion){
        if(motion>0&&showSweep&&!reduce){
            sweep.animateTo(1f,tween(240,easing=CubicBezierEasing(0.16f,1f,0.3f,1f)))
            kotlinx.coroutines.delay(140)
            if(!pressed)sweep.animateTo(0f,tween(300,easing=FastOutSlowInEasing))
        }
    }
    val baseInk=if(primary)if(danger)colors.onError else colors.inverseOnSurface else if(danger)colors.error else colors.onSurface
    val ink=if(showSweep&&sweep.value>0.42f)colors.onPrimary else baseInk
    val background=if(primary)if(danger)colors.error else colors.inverseSurface else androidx.compose.ui.graphics.Color.Transparent
    val sweepColor=colors.primary
    Box(
        modifier
            .heightIn(min=if(tag!=null)50.dp else 48.dp)
            .clickable(interactionSource=interaction,indication=null,enabled=enabled&&!pending,role=Role.Button,onClick={
                motion++
                onClick()
            })
            .graphicsLayer{
                if(pressed&&enabled&&!pending&&!reduce){scaleX=0.988f;scaleY=0.988f}
            }
            .then(if(!primary)Modifier.border(1.dp,if(danger)colors.error else colors.outline)else Modifier)
            .background(if(enabled)background else colors.surfaceVariant)
            .semantics{if(pending)stateDescription=label},
    ){
        if(showSweep&&sweep.value>0.001f){
            Canvas(Modifier.matchParentSize()){
                drawRect(sweepColor,Offset.Zero,Size(size.width*sweep.value,size.height))
            }
        }
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min=if(tag!=null)50.dp else 48.dp)
                .padding(horizontal=if(settings)12.dp else 18.dp,vertical=if(settings)8.dp else 12.dp),
            horizontalArrangement=if(tag!=null)Arrangement.SpaceBetween else Arrangement.spacedBy(8.dp,Alignment.CenterHorizontally),
            verticalAlignment=Alignment.CenterVertically,
        ){
            CompositionLocalProvider(LocalContentColor provides if(enabled)ink else colors.onSurfaceVariant){
                Row(
                    Modifier.weight(1f,fill=tag!=null),
                    horizontalArrangement=if(tag!=null)Arrangement.spacedBy(8.dp,Alignment.Start)else Arrangement.spacedBy(8.dp,Alignment.CenterHorizontally),
                    verticalAlignment=Alignment.CenterVertically,
                ){
                    if(pending&&icon=="reset")NativeRefreshingGlyph()
                    else if(pending)NativeBusy(Modifier.size(20.dp))
                    else if(leading!=null)leading()
                    else if(icon.isNotEmpty())NativeMotionGlyph(icon,motion,Modifier.size(18.dp))
                    Text(label,Modifier.weight(1f,fill=false),style=if(settings)MaterialTheme.typography.bodyMedium else MaterialTheme.typography.labelLarge)
                }
                if(tag!=null){
                    Text(tag,style=MaterialTheme.typography.labelSmall,color=(if(enabled)ink else colors.onSurfaceVariant).copy(alpha=0.74f),maxLines=1)
                }
            }
        }
    }
}

@Composable internal fun NativeRefreshingGlyph(){
    if(LocalNativeUi.current.reduceMotion){PixelGlyph("reset",Modifier.size(20.dp));return}
    val transition=rememberInfiniteTransition(label="refresh")
    val rotation=transition.animateFloat(0f,360f,infiniteRepeatable(tween(900,easing=LinearEasing)),label="rotation")
    PixelGlyph("reset",Modifier.size(20.dp).graphicsLayer{rotationZ=rotation.value})
}

@Composable internal fun NativeInlineAction(
    title:String,onClick:()->Unit,icon:String,action:String?=null,
    enabled:Boolean=true,pending:Boolean=false,checked:Boolean?=null,
    description:(@Composable ColumnScope.()->Unit)?=null,
){
    val ui=LocalNativeUi.current
    val colors=MaterialTheme.colorScheme
    val interaction=remember{MutableInteractionSource()}
    var motion by remember{mutableIntStateOf(0)}
    val actionColor=if(enabled||pending)colors.primary else colors.onSurfaceVariant
    Row(
        Modifier.fillMaxWidth().heightIn(min=NativeSettingsRowHeight)
            .clickable(enabled=enabled&&!pending,role=Role.Button,interactionSource=interaction,indication=null){
                motion++;onClick()
            }.semantics{
                if(pending)stateDescription=ui.text("处理中")
                if(checked!=null)selected=checked
            }.nativePressMotion(interaction,enabled&&!pending).padding(vertical=8.dp),
        verticalAlignment=Alignment.CenterVertically,
        horizontalArrangement=Arrangement.spacedBy(12.dp),
    ){
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
            Text(title,style=MaterialTheme.typography.bodyLarge)
            description?.invoke(this)
        }
        Row(
            verticalAlignment=Alignment.CenterVertically,
            horizontalArrangement=Arrangement.spacedBy(NativeSettingActionGap),
        ){
            if(action!=null)Text(action,color=actionColor,style=MaterialTheme.typography.bodyMedium)
            CompositionLocalProvider(LocalContentColor provides actionColor){
                when{
                    pending&&icon=="reset"->NativeRefreshingGlyph()
                    pending->NativeBusy(Modifier.size(20.dp))
                    else->NativeMotionGlyph(icon,motion,Modifier.size(20.dp))
                }
            }
        }
    }
}

@Composable fun NativeIconAction(title:String,icon:String,onClick:()->Unit,modifier:Modifier=Modifier,enabled:Boolean=true,pending:Boolean=false){
    var motion by remember{mutableIntStateOf(0)}
    val interaction=remember{MutableInteractionSource()}
    val target=if(LocalNativeSettingsActions.current)48.dp else 44.dp
    Box(modifier.sizeIn(minWidth=target,minHeight=target).clickable(enabled=enabled&&!pending,role=Role.Button,interactionSource=interaction,indication=null){
        motion++;onClick()
    }.semantics{contentDescription=title;if(pending)stateDescription=title}.nativePressMotion(interaction,enabled&&!pending).padding(10.dp),contentAlignment=Alignment.Center){
        val tint=if(enabled)LocalContentColor.current else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha=.45f)
        CompositionLocalProvider(LocalContentColor provides tint){if(pending&&icon=="reset")NativeRefreshingGlyph()else if(pending)NativeBusy(Modifier.size(20.dp))else NativeMotionGlyph(icon,motion,Modifier.size(20.dp),tint)}
    }
}

/** Holds the outgoing model until the exit finishes. No ancestor of the
 * world or page is transformed, and all exits share the same dismissal. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun <T:Any> NativeSheet(model:T?,title:(T)->String,onClose:()->Unit,dismissible:Boolean=true,onHidden:()->Unit={},heading:(@Composable RowScope.(T)->Unit)?=null,blurBackground:Boolean=true,initiallyExpanded:Boolean=false,contentSpacing:Dp=12.dp,contentScroll:ScrollState?=null,content:@Composable ColumnScope.(T)->Unit){
    val ui=LocalNativeUi.current
    val pageActive=LocalNativePageActive.current
    val drafts=rememberSaveableStateHolder()
    var shown by remember{mutableStateOf(model)}
    var dismissed by remember{mutableStateOf<T?>(null)}
    var closing by remember{mutableStateOf(false)}
    val draftKey=remember(shown){java.util.UUID.randomUUID().toString()}
    DisposableEffect(draftKey){onDispose{drafts.removeState(draftKey)}}
    val currentModel by rememberUpdatedState(model)
    val canDismiss by rememberUpdatedState(dismissible)
    val closeCallback by rememberUpdatedState(onClose)
    val hiddenCallback by rememberUpdatedState(onHidden)
    val scope=rememberCoroutineScope()
    val confirmChange:(SheetValue)->Boolean={it!=SheetValue.Hidden||canDismiss||currentModel==null}
    val openOnMount=remember{initiallyExpanded&&model!=null}
    val sheetState=if(openOnMount){
        val density=androidx.compose.ui.platform.LocalDensity.current
        remember(density){SheetState(skipPartiallyExpanded=true,density=density,initialValue=SheetValue.Expanded,confirmValueChange=confirmChange)}
    }else rememberModalBottomSheetState(skipPartiallyExpanded=true,confirmValueChange=confirmChange)
    LaunchedEffect(model,pageActive){
        if(model==null){
            dismissed=null
            if(shown!=null){closing=true;try{if(pageActive&&sheetState.isVisible)sheetState.hide()}finally{shown=null;closing=false;hiddenCallback()}}
        }else if(model!=dismissed&&!closing)shown=model
    }
    fun close(){
        if(!canDismiss||closing)return
        closing=true;val outgoing=shown
        scope.launch{
            try{if(sheetState.isVisible)sheetState.hide()}finally{
                if(shown==outgoing){dismissed=outgoing;shown=null;hiddenCallback()}
                closing=false;closeCallback()
            }
        }
    }
    val held=shown?:return
    // A Dialog is an independent window: not placing a page is insufficient.
    // Retain its model and saveable form state; hiding is not user dismissal.
    if(!pageActive)return
    val colors=MaterialTheme.colorScheme
    // Compose UI 1.7.5's generic full-width Dialog fixes its height from
    // screenHeightDp. On the measured edge-to-edge OnePlus window this placed
    // a 2779px child at y=140, below the physical display. Material's sheet
    // owns a MATCH_PARENT window and derives IME/safe-area bounds there; never
    // compensate for a misplaced window with per-page or device px offsets.
    ModalBottomSheet(onDismissRequest={close()},sheetState=sheetState,
        sheetMaxWidth=Dp.Unspecified,shape=RectangleShape,dragHandle=null,
        containerColor=androidx.compose.ui.graphics.Color.Transparent,contentColor=colors.onSurface,
        // The window drawable uses the sheet's physical travel for both
        // shade and blur, including a drag or a nested dialog's dismissal.
        scrimColor=androidx.compose.ui.graphics.Color.Transparent,
        contentWindowInsets={WindowInsets.safeDrawing},
        properties=ModalBottomSheetProperties(shouldDismissOnBackPress=dismissible)){
        NativeWindowAppearance()
        drafts.SaveableStateProvider(draftKey){NativeFixedSheetGlass(Modifier.fillMaxWidth(),blurBackground){Column(Modifier.fillMaxWidth().padding(start=20.dp,end=20.dp,top=22.dp,bottom=20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){if(heading==null)Text(title(held),Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)else heading(held)
                NativeIconAction(ui.text("返回"),"close",::close,enabled=dismissible&&!closing)}
            Column(Modifier.fillMaxWidth().weight(1f,fill=false).verticalScroll(contentScroll?:rememberScrollState()),verticalArrangement=Arrangement.spacedBy(contentSpacing)){content(held)}
        }}}
    }
}

@Composable fun PixelProgress(value:Int,modifier:Modifier=Modifier,max:Int=10000){
    val foreground=MaterialTheme.colorScheme.primary;val background=MaterialTheme.colorScheme.outlineVariant
    Canvas(modifier.fillMaxWidth().height(12.dp).semantics{progressBarRangeInfo=ProgressBarRangeInfo(value.toFloat().coerceIn(0f,max.coerceAtLeast(1).toFloat()),0f..max.coerceAtLeast(1).toFloat())}){
        val n=24;val gap=2.dp.toPx();val width=maxOf(1f,(size.width-(n-1)*gap)/n);val filled=if(max<=0)0 else kotlin.math.ceil(value.toDouble()/max*n).toInt().coerceIn(0,n)
        repeat(n){drawRect(if(it<filled)foreground else background,Offset(it*(width+gap),0f),Size(width,size.height))}
    }
}

@Composable fun NativeHeading(title:String,subtitle:String?=null,modifier:Modifier=Modifier){
    Column(modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(5.dp)){NativeText(title,NativeTextRole.TITLE);if(!subtitle.isNullOrBlank())NativeText(subtitle,NativeTextRole.BODY,color=MaterialTheme.colorScheme.onSurfaceVariant)}
}

@Composable internal fun NativePageTitle(title:String,actions:@Composable RowScope.()->Unit={}){
    Row(Modifier.fillMaxWidth().heightIn(min=44.dp),verticalAlignment=Alignment.CenterVertically){
        NativeHeading(title,modifier=Modifier.weight(1f))
        actions()
    }
}
