package com.blockcolc.preview.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.*
import com.blockcolc.presentation.TimeTarget
import kotlin.math.*

/** Formal L14 hundred-field geometry, including largest-remainder allocation,
 * golden-angle points, every-fifth spokes and center links. */
@Composable internal fun NativeAllocationField(rows:List<Pair<TimeTarget,Long>>){
    val ui=LocalNativeUi.current;val colors=MaterialTheme.colorScheme
    val total=rows.sumOf{it.second}.coerceAtLeast(1)
    val units=remember(rows){
        val exact=rows.map{it.second.toDouble()/total*100};val counts=exact.map{floor(it).toInt()}.toMutableList()
        val remaining=100-counts.sum()
        exact.indices.sortedWith(compareByDescending<Int>{exact[it]-counts[it]}.thenBy{it}).take(remaining).forEach{counts[it]++};counts
    }
    val progress=remember(rows){Animatable(if(ui.reduceMotion)1f else 0f)}
    val active=LocalNativePageActive.current
    LaunchedEffect(active,rows,ui.reduceMotion){if(active)progress.animateTo(1f,tween(if(ui.reduceMotion)0 else 1600+rows.size*140,easing=LinearEasing))}
    val palette=if(colors.background.luminance()<.5f)listOf(Color(0xff8aca9e),Color(0xff6eae96),Color(0xffb4d5bf),Color(0xff84a69c),Color(0xffabcab0))
        else listOf(Color(0xff327459),Color(0xff5b8e78),Color(0xff8daf9d),Color(0xff748b80),Color(0xff9ec1ad))
    fun rnd(i:Int,k:Int)=abs(((i*73856093)xor(k*19349663))%1000)/1000f
    val centers=remember(rows){mutableStateMapOf<Int,Offset>()};var field by remember{mutableStateOf<LayoutCoordinates?>(null)}
    val density=LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxWidth()){
        // Keep the hundred-pixel allocation, not a width-scaled text canvas.
        // Narrow or large-text windows use one column; labels stay at 12sp.
        val columns=if(maxWidth<280.dp||density.fontScale>1.3f||rows.size==1)1 else 2
        val cellWidth=if(columns==1)maxWidth else (maxWidth-16.dp)/2
        // Phone-width cards keep the hundred points but spend less height.
        val clusterHeight=if(maxWidth<320.dp)112.dp else 140.dp
        Box(Modifier.fillMaxWidth().onGloballyPositioned{field=it}){
            Canvas(Modifier.matchParentSize()){
                for(i in 1 until rows.size){
                    val from=centers[i-1];val to=centers[i]
                    if(from!=null&&to!=null)drawLine(colors.onSurface.copy(alpha=.14f),from,to,1.dp.toPx())
                }
            }
            Column(Modifier.fillMaxWidth().padding(vertical=12.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
                for(indices in rows.indices.chunked(columns))Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp,Alignment.CenterHorizontally)){
                    for(index in indices)key(rows[index].first.key){
                        val row=rows[index];val label=if(row.first.unknown)ui.text("未分配 / 不可追溯")else row.first.projectTitle
                        Column(Modifier.width(cellWidth),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(4.dp)){
                            androidx.compose.material3.Text(label,style=MaterialTheme.typography.bodySmall,textAlign=TextAlign.Center,maxLines=2,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            Canvas(Modifier.fillMaxWidth().height(clusterHeight).onGloballyPositioned{child->field?.takeIf{it.isAttached}?.let{centers[index]=it.localPositionOf(child,Offset(child.size.width/2f,child.size.height/2f))}}){
                                val scale=minOf(size.width,size.height)/176f;val c=Offset(size.width/2,size.height/2)
                                val ink=if(row.first.unknown)colors.onSurface.copy(alpha=.5f)else palette[index%palette.size]
                                repeat(units[index]){k->
                                    val angle=(k*137.508+index*55)*PI/180;val radius=4+sqrt(k.toDouble())*5.9+rnd(k+1,index+2)*3
                                    val p=c+Offset((radius*cos(angle)).toFloat(),(radius*sin(angle)).toFloat())*scale
                                    val delay=index*.14+k*.012;val elapsed=progress.value*(1.6+rows.size*.14)
                                    val alpha=((elapsed-delay)/.35).toFloat().coerceIn(0f,1f)
                                    if(k%5==0)drawLine(ink.copy(alpha=.2f*alpha),c,p,.6f*scale)
                                    val r=(1.5+rnd(k+2,index+3)*1.7).toFloat()*scale
                                    drawRect(ink.copy(alpha=ink.alpha*alpha),p-Offset(r,r),Size(2*r,2*r))
                                }
                                drawRect(ink,c-Offset(2.4f,2.4f)*scale,Size(4.8f*scale,4.8f*scale))
                            }
                            androidx.compose.material3.Text("${formatDuration(row.second)} · ${units[index]}%",style=MaterialTheme.typography.bodySmall,textAlign=TextAlign.Center)
                        }
                    }
                }
            }
        }
    }
}
