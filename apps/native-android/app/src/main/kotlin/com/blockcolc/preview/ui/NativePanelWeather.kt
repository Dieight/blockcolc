package com.blockcolc.preview.ui

import androidx.compose.foundation.Canvas
import androidx.compose.animation.core.withInfiniteAnimationFrameNanos
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.*
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import com.blockcolc.presentation.*
import com.blockcolc.world.NativeWeatherKind
import kotlin.math.*

/** Inert decoration beneath text and controls. Its clock is independent of
 * world rotation, and only this bounded draw layer updates at 32 ms intervals. */
@Composable internal fun NativePanelWeather(modifier:Modifier){
    val weather=LocalNativeAtmosphere.current?.weather?:return
    val snow=weather.kind==NativeWeatherKind.SNOW
    if((!snow&&weather.kind!=NativeWeatherKind.RAIN)||PanelWeatherPhysics.intensity(weather.visualPrecipitationIntensity)<=0)return
    val ui=LocalNativeUi.current;val context=LocalContext.current;val density=LocalDensity.current.density
    val simulation=remember(snow,weather.seed,weather.visualPrecipitationIntensity,weather.thunderstorm){
        PanelWeatherSimulation(snow,weather.visualPrecipitationIntensity,weather.seed.toInt(),weather.thunderstorm)
    }
    val lifecycle=remember(context){generateSequence(context){(it as? android.content.ContextWrapper)?.baseContext}
        .filterIsInstance<androidx.lifecycle.LifecycleOwner>().firstOrNull()?.lifecycle}
    var active by remember{mutableStateOf(lifecycle?.currentState?.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)?:true)}
    DisposableEffect(lifecycle){
        val observer=androidx.lifecycle.LifecycleEventObserver{_,event->
            if(event==androidx.lifecycle.Lifecycle.Event.ON_START)active=true
            else if(event==androidx.lifecycle.Lifecycle.Event.ON_STOP)active=false
        }
        lifecycle?.addObserver(observer);onDispose{lifecycle?.removeObserver(observer)}
    }
    val pageActive=LocalNativePageActive.current
    var bounds by remember{mutableStateOf(IntSize.Zero)}
    var frame by remember(simulation){mutableStateOf(PanelWeatherFrame())}
    LaunchedEffect(active,pageActive,ui.reduceMotion,simulation,bounds,density){
        if(!active||!pageActive||bounds.width<=0||bounds.height<=0)return@LaunchedEffect
        val width=bounds.width/density.toDouble();val height=bounds.height/density.toDouble()
        if(ui.reduceMotion){frame=simulation.frame(width,height,still=true);return@LaunchedEffect}
        var last=0L
        while(true){
            withInfiniteAnimationFrameNanos{now->
                val dt=if(last==0L)0.0 else (now-last)/1e9
                frame=simulation.frame(width,height,dt);last=now
            }
            kotlinx.coroutines.delay(32)
        }
    }
    val reducedMotion=ui.reduceMotion;val baseAlpha=if(ui.reduceTransparency).42f else .78f
    Canvas(modifier.onSizeChanged{bounds=it}){
        val width=size.width/density;val height=size.height/density
        withTransform({scale(density,density,pivot=Offset.Zero)}){
            val current=frame
            if(snow){
                current.flakes.forEach{flake->snowflake(flake,baseAlpha*(if(reducedMotion).65f else .76f))}
                snowbank(width,height,weather.precipitationIntensity,baseAlpha)
            }else current.drops.forEach{drop->raindrop(drop,baseAlpha*simulation.rainProfile.opacity.toFloat()*(if(reducedMotion).8f else 1f),reducedMotion,simulation.rainProfile.trailScale)}
            current.lightning?.let{lightning(width,it,current.lightningAgeMs,baseAlpha)}
        }
    }
}

private fun DrawScope.raindrop(drop:GlassRaindrop,opacity:Float,still:Boolean,trailScale:Double){
    val grain=if(drop.radius>3.2)3f else 2f
    val x=(floor(drop.x/grain+.5)*grain).toFloat();val y=(floor(drop.y/grain+.5)*grain).toFloat()
    val width=if(drop.radius>2.8)grain*2 else grain
    val trail=if(still)0f else (floor(min(18.0,drop.vy*.55*trailScale)/grain+.5)*grain).toFloat()
    val fade=max(0.0,1-max(0.0,drop.age-14)/8)*(if(still)1.0 else min(1.0,drop.age/.34))*(if(drop.radius<2).58 else 1.0)
    val alpha=(opacity*fade).toFloat()
    fun pixel(color:Color,px:Float,py:Float,w:Float,h:Float)=drawRect(color.copy(alpha=color.alpha*alpha),Offset(px,py),Size(w,h))
    if(trail>0)pixel(Color(0x29427080),x,y-trail,grain,trail)
    pixel(Color(0x7a356175),x-grain,y,width+grain,grain*2)
    pixel(Color(0x7a356175),x,y-grain,width,grain)
    pixel(Color(0x99cbe5f1),x,y,width,grain)
    pixel(Color(0x99cbe5f1),x+grain,y+grain,grain,grain)
    pixel(Color(0xe0f9fdff),x,y,grain,grain)
    if(!still&&drop.age<.32){
        val impact=1-drop.age/.32;val reach=grain*(1+floor((1-impact)*2).toFloat())
        val color=Color(0xffe2f2fa).copy(alpha=(.45*impact).toFloat())
        pixel(color,x-reach,y,grain,grain);pixel(color,x+width+reach,y-grain,grain,grain)
    }
}
private fun DrawScope.snowflake(flake:PanelSnowflake,opacity:Float){
    val foreground=flake.radius>1.5
    val x=floor(flake.x+.5).toFloat();val y=floor(flake.y+.5).toFloat()
    val color=Color(0xfff8fdff).copy(alpha=opacity*(if(foreground).94f else .48f)*.94f)
    if(!foreground){drawRect(color,Offset(x,y),Size(2f,2f));return}
    drawRect(color,Offset(x-2,y),Size(5f,1f));drawRect(color,Offset(x,y-2),Size(1f,5f))
    if(flake.radius>1.9)for(dx in listOf(-1f,1f))for(dy in listOf(-1f,1f))drawRect(color,Offset(x+dx,y+dy),Size(1f,1f))
}
private fun DrawScope.snowbank(width:Float,height:Float,intensity:Double,opacity:Float){
    val depth=PanelWeatherPhysics.snowProfile(intensity).depth*min(1.0,height*.075/20)
    val bottom=floor(height);var x=0f
    while(x<width){
        val variation=(sin(x*.037)+cos(x*.079)+2)/4
        val local=max(1.0,floor(depth*(.78+variation*.22)+.5)).toFloat()
        drawRect(Color(0xfff2f9fc).copy(alpha=opacity*.94f),Offset(x,bottom-local),Size(min(4f,width-x),local))
        drawRect(Color(0xff8aadbe).copy(alpha=opacity*.32f),Offset(x,bottom-1),Size(min(4f,width-x),1f));x+=4
    }
}
private fun DrawScope.lightning(width:Float,strike:PanelLightning,ageMs:Double,baseOpacity:Float){
    val alpha=PanelWeatherPhysics.lightningOpacity(ageMs).toFloat()*baseOpacity
    if(alpha<=0)return
    val x=strike.x.toFloat();val end=strike.endY.toFloat();val scaleX=(width*.1f).coerceIn(18f,40f)
    drawCircle(Brush.radialGradient(listOf(Color(0xffcfe5ff).copy(alpha=alpha*.7f),Color.Transparent),Offset(x,end),62f),62f,Offset(x,end))
    val path=Path().apply{strike.offsets.forEachIndexed{index,offset->
        val px=x+offset.toFloat()*scaleX;val py=end*index/(strike.offsets.size-1)
        if(index==0)moveTo(px,py)else lineTo(px,py)
    }}
    drawPath(path,Color(0xffa5cfff).copy(alpha=alpha*.15f),style=Stroke(if(ageMs<165)13f else 5f))
    drawPath(path,Color(0xff294c6d).copy(alpha=alpha*.76f),style=Stroke(if(ageMs<165)5f else 3f))
    drawPath(path,Color(0xfff7fcff).copy(alpha=alpha*.96f),style=Stroke(if(ageMs<165)2.1f else 1.2f))
}
