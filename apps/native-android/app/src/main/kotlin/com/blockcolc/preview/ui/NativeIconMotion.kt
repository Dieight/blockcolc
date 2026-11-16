package com.blockcolc.preview.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp
import com.blockcolc.presentation.PixelTransform
import kotlin.math.tan

/** The animated state is read by layer/draw blocks, keeping frame updates out
 * of page composition and world generation. A hidden page cancels its motion. */
@Composable internal fun NativeMotionGlyph(name:String,serial:Int,modifier:Modifier=Modifier,color:Color=LocalContentColor.current){
    val ui=LocalNativeUi.current;val active=LocalNativePageActive.current&&!ui.reduceMotion
    val icon=ui.resources.iconMotion[name]
    val time=remember{Animatable(900f)}
    LaunchedEffect(serial,active){if(serial==0||!active)time.snapTo(900f)else{time.snapTo(0f);time.animateTo(900f,tween(900,easing=LinearEasing))}}
    if(icon==null){PixelGlyph(name,modifier,color);return}
    val paths=remember(icon){icon.layers.map{PathParser().parsePathString(it.path).toPath()}}
    val paper=androidx.compose.material3.MaterialTheme.colorScheme.background
    Box(modifier.size(24.dp)){
        icon.layers.forEachIndexed{index,layer->val spec=icon.motions[layer.part]
            Canvas(Modifier.fillMaxSize().graphicsLayer{
                val state=if(time.value>=900f||spec==null)PixelTransform()else spec.at(time.value)
                transformOrigin=TransformOrigin(((spec?.originX?:icon.minX+icon.width/2)-icon.minX)/icon.width,((spec?.originY?:icon.minY+icon.height/2)-icon.minY)/icon.height)
                translationX=state.x*size.width/icon.width;translationY=state.y*size.height/icon.height
                scaleX=state.scaleX;scaleY=state.scaleY;rotationZ=state.rotation;rotationX=state.rotationX;alpha=state.opacity
                cameraDistance=state.perspective*size.width/icon.width
            }){
                val unit=minOf(size.width/icon.width,size.height/icon.height)
                drawContext.canvas.save();drawContext.canvas.scale(unit,unit)
                drawContext.canvas.translate(-icon.minX,-icon.minY)
                val state=if(time.value>=900f||spec==null)PixelTransform()else spec.at(time.value)
                if(state.skewX!=0f){val x=spec?.originX?:0f;val y=spec?.originY?:0f;drawContext.canvas.translate(x,y);drawContext.canvas.skew(tan(state.skewX*Math.PI/180).toFloat(),0f);drawContext.canvas.translate(-x,-y)}
                drawPath(paths[index],if(layer.background)paper else color)
                drawContext.canvas.restore()
            }
        }
    }
}
