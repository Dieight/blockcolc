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

@Composable fun NativeAction(label:String,onClick:()->Unit,modifier:Modifier=Modifier,pending:Boolean=false,enabled:Boolean=true,icon:String="check",primary:Boolean=true,danger:Boolean=false,leading:(@Composable ()->Unit)?=null){
    val colors=MaterialTheme.colorScheme
    val ink=if(primary)if(danger)colors.onError else colors.onPrimary else if(danger)colors.error else colors.onSurface
    val background=if(primary)if(danger)colors.error else colors.primary else colors.surface
    val interaction=remember{MutableInteractionSource()}
    val pressed by interaction.collectIsPressedAsState()
    val reduce=LocalNativeUi.current.reduceMotion
    val settings=LocalNativeSettingsActions.current
    var motion by remember{mutableIntStateOf(0)}
    val shift by animateFloatAsState(if(pressed&&enabled&&!pending)1f else 0f,tween(if(reduce)0 else 70),label="button-press")
    Row(modifier.heightIn(min=48.dp).graphicsLayer{translationY=if(reduce)0f else shift*density}.then(if(!primary)Modifier.border(1.dp,if(danger)colors.error else colors.outline)else Modifier).background(if(enabled)background else colors.surfaceVariant).clickable(interactionSource=interaction,indication=null,
        enabled=enabled&&!pending,role=Role.Button,onClick={motion++;onClick()}).semantics{if(pending)stateDescription=label}
        .padding(horizontal=if(settings)12.dp else 16.dp,vertical=if(settings)8.dp else 12.dp),
        horizontalArrangement=Arrangement.spacedBy(8.dp,Alignment.CenterHorizontally),verticalAlignment=Alignment.CenterVertically){
        CompositionLocalProvider(LocalContentColor provides if(enabled)ink else colors.onSurfaceVariant){
            if(pending&&icon=="reset")NativeRefreshingGlyph()else if(pending)NativeBusy(Modifier.size(20.dp))else if(leading!=null)leading()else if(icon.isNotEmpty())NativeMotionGlyph(icon,motion,Modifier.size(20.dp))
            Text(label,Modifier.weight(1f,fill=false),style=if(settings)MaterialTheme.typography.bodyMedium else MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable private fun NativeRefreshingGlyph(){
    if(LocalNativeUi.current.reduceMotion){PixelGlyph("reset",Modifier.size(20.dp));return}
    val transition=rememberInfiniteTransition(label="refresh")
    val rotation=transition.animateFloat(0f,360f,infiniteRepeatable(tween(900,easing=LinearEasing)),label="rotation")
    PixelGlyph("reset",Modifier.size(20.dp).graphicsLayer{rotationZ=rotation.value})
}

@Composable internal fun NativeInlineAction(
    title:String,onClick:()->Unit,icon:String,action:String?=null,
    enabled:Boolean=true,pending:Boolean=false,checked:Boolean?=null,
){
    val ui=LocalNativeUi.current
    val colors=MaterialTheme.colorScheme
    val interaction=remember{MutableInteractionSource()}
    val pressed by interaction.collectIsPressedAsState()
    var motion by remember{mutableIntStateOf(0)}
    val actionColor=if(enabled||pending)colors.primary else colors.onSurfaceVariant
    Row(
        Modifier.fillMaxWidth().heightIn(min=48.dp)
            .clickable(enabled=enabled&&!pending,role=Role.Button,interactionSource=interaction,indication=null){
                motion++;onClick()
            }.semantics{
                if(pending)stateDescription=ui.text("处理中")
                if(checked!=null)selected=checked
            }.padding(vertical=8.dp),
        verticalAlignment=Alignment.CenterVertically,
        horizontalArrangement=Arrangement.spacedBy(12.dp),
    ){
        Text(title,Modifier.weight(1f),style=MaterialTheme.typography.bodyLarge)
        Row(
            Modifier.graphicsLayer{translationY=if(pressed&&!ui.reduceMotion)1.dp.toPx() else 0f},
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
    val ui=LocalNativeUi.current;var motion by remember{mutableIntStateOf(0)}
    val interaction=remember{MutableInteractionSource()};val pressed by interaction.collectIsPressedAsState()
    val target=if(LocalNativeSettingsActions.current)48.dp else 44.dp
    Box(modifier.sizeIn(minWidth=target,minHeight=target).clickable(enabled=enabled&&!pending,role=Role.Button,interactionSource=interaction,indication=null){
        motion++;onClick()
    }.semantics{contentDescription=title;if(pending)stateDescription=title}.padding(10.dp),contentAlignment=Alignment.Center){
        val tint=if(enabled)LocalContentColor.current else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha=.45f)
        CompositionLocalProvider(LocalContentColor provides tint){if(pending&&icon=="reset")NativeRefreshingGlyph()else if(pending)NativeBusy(Modifier.size(20.dp))else NativeMotionGlyph(icon,motion,Modifier.size(20.dp).graphicsLayer{translationY=if(pressed&&!ui.reduceMotion)1.dp.toPx() else 0f},tint)}
    }
}

/** Holds the outgoing model until the exit finishes. No ancestor of the
 * world or page is transformed, and all exits share the same dismissal. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun <T:Any> NativeSheet(model:T?,title:(T)->String,onClose:()->Unit,dismissible:Boolean=true,onHidden:()->Unit={},heading:(@Composable RowScope.(T)->Unit)?=null,blurBackground:Boolean=true,initiallyExpanded:Boolean=false,content:@Composable ColumnScope.(T)->Unit){
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
            if(shown!=null){closing=true;try{if(pageActive)sheetState.hide()}finally{shown=null;closing=false;hiddenCallback()}}
        }else if(model!=dismissed&&!closing)shown=model
    }
    fun close(){
        if(!canDismiss||closing)return
        closing=true;val outgoing=shown
        scope.launch{
            try{sheetState.hide()}finally{
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
        scrimColor=androidx.compose.ui.graphics.Color.Black.copy(alpha=.28f),
        contentWindowInsets={WindowInsets.safeDrawing},
        properties=ModalBottomSheetProperties(shouldDismissOnBackPress=dismissible)){
        NativeWindowAppearance()
        drafts.SaveableStateProvider(draftKey){NativeFixedSheetGlass(Modifier.fillMaxWidth(),blurBackground){Column(Modifier.fillMaxWidth().padding(start=20.dp,end=20.dp,top=22.dp,bottom=20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){if(heading==null)Text(title(held),Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)else heading(held)
                NativeIconAction(ui.text("返回"),"close",::close,enabled=dismissible&&!closing)}
            Column(Modifier.fillMaxWidth().weight(1f,fill=false).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){content(held)}
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
