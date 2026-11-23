package com.blockcolc.preview.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.offset
import com.blockcolc.preview.R
import kotlinx.coroutines.launch
import kotlin.math.cos
import kotlin.math.sin

@Composable fun PixelGlyph(name:String,modifier:Modifier=Modifier,color:Color=LocalContentColor.current){
    val rows=LocalNativeUi.current.resources.icons.getValue(name)
    Canvas(modifier.size(24.dp)){
        val unit=nativePixelCell(minOf(size.width,size.height)/12f)
        val left=nativePixelOrigin(size.width,unit*12);val top=nativePixelOrigin(size.height,unit*12)
        for(y in 0..11)for(x in 0..11)if(rows[y][x]=='1')drawRect(color,Offset(left+x*unit,top+y*unit),Size(unit,unit))
    }
}

/** Pixel art needs whole device pixels per cell: a fractional cell (20dp is
 * 4.58px per cell at 2.75x) antialiases its edges and makes columns uneven.
 * Use the largest whole cell that fits the glyph's allotted bounds. */
internal fun nativePixelCell(exact:Float):Float=if(exact>=1f)kotlin.math.floor(exact)else exact
internal fun nativePixelOrigin(extent:Float,used:Float):Float=kotlin.math.round((extent-used)/2f)

@Composable fun NativeBrand(modifier:Modifier=Modifier){
    val motion=LocalNativeUi.current.reduceMotion;val scale=remember{Animatable(1f)};val scope=rememberCoroutineScope()
    Image(painterResource(R.drawable.native_brand),null,modifier.sizeIn(minWidth=44.dp,minHeight=44.dp).clickable(
        interactionSource=remember{MutableInteractionSource()},indication=null,onClickLabel="blockcolc"){
        scope.launch{scale.snapTo(1f);if(!motion){scale.animateTo(.80f,tween(80));scale.animateTo(1.13f,tween(110));scale.animateTo(1f,spring(.45f,450f))}}
    }.semantics{contentDescription="blockcolc"}.padding(6.dp).graphicsLayer{scaleY=scale.value;scaleX=2f-scale.value;translationY=(1f-scale.value)*-12f})
}

@Composable fun NativeSection(title:String,modifier:Modifier=Modifier,content:@Composable ColumnScope.()->Unit){
    Column(modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(10.dp)){
        NativeText(title,NativeTextRole.SECTION,Modifier.padding(horizontal=4.dp))
        Box(Modifier.fillMaxWidth().border(1.dp,MaterialTheme.colorScheme.outlineVariant).background(MaterialTheme.colorScheme.surface).padding(1.dp)){Column(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=8.dp),content=content)}
    }
}

@Composable fun NativeSeparator(){HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)}

internal val NativeSettingActionGap = 2.dp
internal val NativeSettingsRowHeight = 60.dp
internal val NativeOptionSpacing = 8.dp

@Composable fun NativeDisclosure(title:String,description:String?=null,expanded:Boolean,onExpandedChange:(Boolean)->Unit,valueLabel:String?=null,leading:(@Composable ()->Unit)?=null,rowHeight:androidx.compose.ui.unit.Dp=NativeSettingsRowHeight,titleStyle:androidx.compose.ui.text.TextStyle=MaterialTheme.typography.bodyLarge,indicator:(@Composable ()->Unit)?=null,valueStyle:androidx.compose.ui.text.TextStyle=MaterialTheme.typography.bodyLarge,rowPadding:androidx.compose.ui.unit.Dp=NativeOptionSpacing,contentSpacing:androidx.compose.ui.unit.Dp=NativeOptionSpacing,indicatorSize:androidx.compose.ui.unit.Dp=24.dp,trailing:(@Composable ()->Unit)?=null,descriptionStyle:androidx.compose.ui.text.TextStyle=MaterialTheme.typography.bodySmall,enabled:Boolean=true,showTrailing:Boolean=true,contentBottomSpacing:androidx.compose.ui.unit.Dp=0.dp,content:@Composable ColumnScope.()->Unit){
    val ui=LocalNativeUi.current;var turns by remember{mutableIntStateOf(if(expanded)1 else 0)}
    val interaction=remember{MutableInteractionSource()}
    var previous by remember{mutableStateOf(expanded)}
    LaunchedEffect(expanded){if(previous!=expanded){turns++;previous=expanded}}
    val angle by animateFloatAsState(turns*180f,tween(if(ui.reduceMotion)0 else 165),label="disclosure")
    BoxWithConstraints(Modifier.fillMaxWidth()){
      val density=LocalDensity.current;val measure=rememberTextMeasurer()
      val stackValue=valueLabel!=null&&measure.measure(valueLabel,valueStyle,softWrap=false,maxLines=1).size.width>with(density){maxWidth.toPx()}*.4f
      Column(Modifier.fillMaxWidth()){
        Row(Modifier.fillMaxWidth().heightIn(min=rowHeight).clickable(enabled=enabled,role=Role.Button,interactionSource=interaction,indication=null){onExpandedChange(!expanded)}
            .nativePressMotion(interaction,enabled)
            .semantics{stateDescription=ui.text(if(expanded)"收起" else "展开")}.padding(vertical=rowPadding),verticalAlignment=Alignment.CenterVertically){
            if(leading!=null){leading();Spacer(Modifier.width(10.dp))}
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                Text(title,style=titleStyle);if(description!=null)Text(description,style=descriptionStyle)
                if(stackValue&&valueLabel!=null)Text(valueLabel,style=valueStyle)
            }
            if(trailing!=null)Row(
                // The toolbar's space belongs to the header in both states.
                // Unplaced children have no drawing or hit targets.
                modifier=Modifier.layout{measurable,constraints->
                    val child=measurable.measure(constraints)
                    layout(child.width,child.height){if(showTrailing)child.placeRelative(0,0)}
                }.then(if(showTrailing)Modifier else Modifier.clearAndSetSemantics{}),
                horizontalArrangement=Arrangement.spacedBy(NativeSettingActionGap),
                verticalAlignment=Alignment.CenterVertically,
            ){trailing()}
            if(valueLabel!=null&&!stackValue)Text(valueLabel,Modifier.padding(horizontal=8.dp),style=valueStyle)
            if(trailing!=null&&valueLabel==null)Spacer(Modifier.width(NativeSettingActionGap))
            if(indicator!=null)indicator()else PixelGlyph("chevron",Modifier.size(indicatorSize).graphicsLayer{rotationZ=angle})
        }
        NativeExpandedOptions(expanded,contentSpacing,contentBottomSpacing,content)
      }
    }
}

@Composable internal fun NativeExpandedOptions(expanded:Boolean,spacing:androidx.compose.ui.unit.Dp=0.dp,bottomSpacing:androidx.compose.ui.unit.Dp=0.dp,content:@Composable ColumnScope.()->Unit){
    val reduce=LocalNativeUi.current.reduceMotion
    val visibility=remember{MutableTransitionState(expanded)}
    LaunchedEffect(expanded){visibility.targetState=expanded}
    AnimatedVisibility(visibility,modifier=Modifier.graphicsLayer{clip=!visibility.isIdle||!visibility.currentState},
        enter=expandVertically(tween(if(reduce)0 else 200),expandFrom=Alignment.Top,clip=false),
        exit=shrinkVertically(tween(if(reduce)0 else 180),shrinkTowards=Alignment.Top,clip=false)){
        // Only an occupied subtree earns the inset. At rest a physical
        // slider can draw beyond its own row.
        Column(Modifier.fillMaxWidth().layout{measurable,constraints->
            val gap=NativeOptionSpacing.roundToPx()
            val totalGap=gap+bottomSpacing.roundToPx()
            val child=measurable.measure(constraints.offset(vertical=-totalGap))
            val hasContent=child.height>0
            layout(child.width,child.height+if(hasContent)totalGap else 0){child.placeRelative(0,if(hasContent)gap else 0)}
        },verticalArrangement=Arrangement.spacedBy(spacing),content=content)
    }
}

@Composable fun NativeToggle(title:String,description:String?=null,value:Boolean,enabled:Boolean=true,trailing:(@Composable ()->Unit)?=null,onChange:(Boolean)->Unit){
    val interaction=remember{MutableInteractionSource()}
    val pressed by interaction.collectIsPressedAsState()
    val ui=LocalNativeUi.current;val colors=MaterialTheme.colorScheme
    val position by animateFloatAsState(if(value)1f else 0f,tween(if(ui.reduceMotion)0 else 180),label="pixel-switch")
    val track by animateColorAsState(if(value&&enabled)colors.primary else colors.surfaceVariant,tween(if(ui.reduceMotion)0 else 180),label="switch-fill")
    Row(Modifier.fillMaxWidth().heightIn(min=NativeSettingsRowHeight).toggleable(value=value,enabled=enabled,role=Role.Switch,
        interactionSource=interaction,indication=null,onValueChange=onChange).padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
        Column(Modifier.weight(1f).padding(end=12.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){Text(title,style=MaterialTheme.typography.bodyLarge);if(description!=null)Text(description,style=MaterialTheme.typography.bodySmall)}
        if(trailing!=null)Row(
            Modifier.padding(end=NativeSettingActionGap),
            horizontalArrangement=Arrangement.spacedBy(NativeSettingActionGap),
            verticalAlignment=Alignment.CenterVertically,
        ){trailing()}
        Canvas(Modifier.size(48.dp,28.dp)){
            val unit=nativePixelCell(minOf(size.width/22f,size.height/14f));val left=nativePixelOrigin(size.width,22*unit);val top=nativePixelOrigin(size.height,12*unit)
            val outline=if(enabled)if(value)colors.primary else colors.outline else colors.outlineVariant
            fun shape(x:Float,y:Float,w:Float,h:Float,color:Color){
                drawRect(color,Offset(x+unit,y),Size(w-2*unit,h))
                drawRect(color,Offset(x,y+unit),Size(w,h-2*unit))
            }
            shape(left,top,22*unit,12*unit,outline)
            shape(left+unit,top+unit,20*unit,10*unit,track)
            val thumb=if(enabled)if(value)colors.onPrimary else colors.onSurface else colors.outline
            val x=left+(2+10*position)*unit;val y=top+(if(pressed&&enabled&&!ui.reduceMotion)2.5f else 2f)*unit
            shape(x,y,8*unit,8*unit,thumb)
            if(value)drawRect(if(enabled)colors.primary else track,Offset(x+2*unit,y+3*unit),Size(4*unit,2*unit))
        }
    }
}

/** Native composition and selection stay in the same TextFieldValue; saved
 * snapshots do not replace a focused draft or treat candidate Enter as submit. */
@Composable fun NativeNumber(title:String,value:Int,range:IntRange,enabled:Boolean=true,onCommit:(Int)->Unit){
    var focused by remember{mutableStateOf(false)};var input by remember{mutableStateOf(TextFieldValue(value.toString()))};var attempted by remember{mutableStateOf(false)};var dirty by remember{mutableStateOf(false)}
    val parsed=input.text.toIntOrNull();val invalid=attempted&&(parsed==null||parsed !in range)
    LaunchedEffect(value,focused){
        if(input.composition==null&&input.text.toIntOrNull()==value){dirty=false;attempted=false}
        if(!focused&&!dirty){input=TextFieldValue(value.toString());attempted=false}
    }
    fun commit(){if(input.composition!=null)return;attempted=true;input.text.toIntOrNull()?.takeIf{it in range}?.let{if(it!=value)onCommit(it)else dirty=false}}
    Row(Modifier.fillMaxWidth().heightIn(min=NativeSettingsRowHeight).padding(vertical=NativeOptionSpacing),verticalAlignment=Alignment.CenterVertically){
        Text(title,Modifier.weight(1f).padding(end=12.dp),style=MaterialTheme.typography.bodyLarge)
        BasicTextField(input,{input=it;attempted=false;dirty=true},enabled=enabled,singleLine=true,
            textStyle=MaterialTheme.typography.bodyLarge.copy(color=MaterialTheme.colorScheme.onSurface,textAlign=androidx.compose.ui.text.style.TextAlign.End),
            keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number,imeAction=ImeAction.Done),keyboardActions=KeyboardActions(onDone={commit()}),
            modifier=Modifier.widthIn(min=64.dp,max=112.dp).heightIn(min=44.dp).onFocusChanged{state->val was=focused;focused=state.isFocused;if(was&&!focused)commit()}
                .background(if(focused)MaterialTheme.colorScheme.surfaceVariant else Color.Transparent).padding(8.dp).semantics{contentDescription=title;if(invalid)error("${range.first}–${range.last}")})
    }
}

@Composable fun <T> NativeSegments(options:List<Pair<T,String>>,value:T,onChange:(T)->Unit,enabled:Boolean=true,icons:Map<T,String> = emptyMap(),textStyle:androidx.compose.ui.text.TextStyle=MaterialTheme.typography.labelLarge){
    require(options.isNotEmpty());val reduce=LocalNativeUi.current.reduceMotion
    val index=options.indexOfFirst{it.first==value}.coerceAtLeast(0)
    val colors=MaterialTheme.colorScheme
    val density=LocalDensity.current;val measure=rememberTextMeasurer();val style=textStyle
    BoxWithConstraints(Modifier.fillMaxWidth()){
        val available=with(density){maxWidth.roundToPx()}
        val padding=with(density){16.dp.roundToPx()}
        val iconSpace=with(density){24.dp.roundToPx()}
        val widths=options.map{measure.measure(it.second,style,softWrap=false,maxLines=1).size.width+padding+(if(it.first in icons)iconSpace else 0)}
        // Labels that cannot share one row wrap into the fewest balanced rows
        // that keep every label whole (five options become 3 + 2); very
        // large text still ends with one complete option per row.
        val rows=nativeSegmentRows(options.size){perRow->widths.all{it<=available/perRow}}
        val starts=rows.runningFold(0){start,count->start+count}
        val textWidth=(available/rows.max()).minus(padding).minus(if(icons.isEmpty())0 else iconSpace).coerceAtLeast(1)
        val lineHeight=options.maxOf{measure.measure(it.second,style,constraints=Constraints(maxWidth=textWidth)).size.height}
        val rowHeight=maxOf(48.dp,with(density){lineHeight.toDp()}+24.dp)
        val row=starts.indexOfLast{it<=index}.coerceIn(0,rows.lastIndex)
        val selectionX by animateFloatAsState((index-starts[row]).toFloat()/rows[row],tween(if(reduce)0 else 200),label="segmented-x")
        val selectionWidth by animateFloatAsState(1f/rows[row],tween(if(reduce)0 else 200),label="segmented-width")
        val selectionRow by animateFloatAsState(row.toFloat(),tween(if(reduce)0 else 200),label="segmented-row")
        @Composable fun item(id:T,label:String,modifier:Modifier){
            val interaction=remember{MutableInteractionSource()}
            Box(modifier.heightIn(min=rowHeight).selectable(id==value,enabled=enabled,role=Role.Tab,
                interactionSource=interaction,indication=null,onClick={onChange(id)})
                .nativePressMotion(interaction,enabled).padding(horizontal=8.dp,vertical=12.dp),contentAlignment=Alignment.Center){
                Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(7.dp)){
                    icons[id]?.let{PixelGlyph(it,Modifier.size(16.dp),if(id==value)colors.primary else colors.onSurfaceVariant)}
                    Text(label,style=style,color=if(id==value)colors.primary else colors.onSurfaceVariant)
                }
            }
        }
        // One moving selection across rows; rows share one height.
        Box(Modifier.fillMaxWidth()){
        Canvas(Modifier.matchParentSize()){
            val height=size.height/rows.size
            val x=selectionX*size.width;val y=selectionRow*height;val width=selectionWidth*size.width
            drawRect(colors.surfaceVariant,Offset(x,y),Size(width,height))
            drawRect(colors.primary,Offset(x,(y+height-2.dp.toPx()).coerceAtLeast(0f)),Size(width,2.dp.toPx()))
        }
        Column(Modifier.fillMaxWidth().selectableGroup()){
            for((line,count) in rows.withIndex())Row(Modifier.fillMaxWidth()){
                for(option in starts[line] until starts[line]+count){val (id,label)=options[option];item(id,label,Modifier.weight(1f))}
            }
        }
        }
    }
}

/** Option counts per row: the fewest rows whose widest row still fits, with
 * earlier rows taking any remainder (7 options in three rows are 3 + 2 + 2). */
internal fun nativeSegmentRows(count:Int,fits:(perRow:Int)->Boolean):List<Int>{
    require(count>0)
    val rows=(1..count).firstOrNull{fits((count+it-1)/it)}?:count
    return List(rows){line->count/rows+if(line<count%rows)1 else 0}
}

/** In-place status glyph, never an extra icon that changes button geometry. */
@Composable fun NativeBusy(modifier:Modifier=Modifier){
    val color=LocalContentColor.current;val reduce=LocalNativeUi.current.reduceMotion
    val phase:State<Float>?=if(reduce)null else {
        val infinite=rememberInfiniteTransition(label="busy")
        infinite.animateFloat(0f,1f,infiniteRepeatable(tween(900,easing=LinearEasing)),label="busy-phase")
    }
    Canvas(modifier.size(24.dp)){
        val cell=nativePixelCell(minOf(size.width,size.height)/12f);val progress=phase?.value?:0f
        repeat(3){i->val angle=(progress*360+i*120)*Math.PI.toFloat()/180;val cx=size.width/2+cos(angle)*cell*3.5f;val cy=size.height/2+sin(angle)*cell*3.5f
            val x=kotlin.math.round(cx/cell)*cell;val y=kotlin.math.round(cy/cell)*cell
            drawRect(color.copy(alpha=1f-i*.18f),Offset(x-cell,y-cell*.5f),Size(cell*2,cell));drawRect(color.copy(alpha=1f-i*.18f),Offset(x-cell*.5f,y-cell),Size(cell,cell*2))
        }
    }
}

@Composable internal fun NativeSettingLink(title:String,onClick:()->Unit,description:String?=null,value:String?=null,modifier:Modifier=Modifier){
    val interaction=remember{MutableInteractionSource()}
    Row(modifier.fillMaxWidth().heightIn(min=NativeSettingsRowHeight)
        .clickable(role=Role.Button,interactionSource=interaction,indication=null,onClick=onClick).nativePressMotion(interaction)
        .padding(vertical=NativeOptionSpacing),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
            Text(title,style=MaterialTheme.typography.bodyLarge)
            if(description!=null)Text(description,style=MaterialTheme.typography.bodySmall)
        }
        if(value!=null)Text(value,style=MaterialTheme.typography.bodyLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)
        PixelGlyph("chevron",Modifier.size(20.dp).graphicsLayer{rotationZ=-90f},LocalContentColor.current)
    }
}

/** Explanations stay out of the reading flow, but remain available by tap,
 * keyboard activation and accessibility focus; never a hover-only tooltip. */
@Composable internal fun NativeInfoAction(title:String,explanation:String){
    NativeInfoAction(title){
        Text(explanation,Modifier.widthIn(max=300.dp).padding(horizontal=16.dp,vertical=8.dp),style=MaterialTheme.typography.bodySmall)
    }
}

@Composable internal fun NativeInfoAction(title:String,content:@Composable ColumnScope.()->Unit){
    var open by remember{mutableStateOf(false)}
    Box{
        NativeIconAction(LocalNativeUi.current.text("{0}说明",title),"info",{open=!open})
        DropdownMenu(open,{open=false},content=content)
    }
}
