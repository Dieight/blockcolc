package com.blockcolc.preview.ui

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import kotlin.math.abs

/** Observe after children: world rotation, time pickers, heatmaps and sliders
 * keep their gestures. Only an unclaimed, horizontal single-finger drag can
 * become page navigation. No consumption of down or vertical scrolling. */
internal fun Modifier.nativePageSwipe(enabled:Boolean,excluded:(Offset)->Boolean,
    onStart:(Float)->Boolean,onDrag:(Float)->Unit,onEnd:(Float)->Unit,onCancel:()->Unit):Modifier=composed {
    val exclude=rememberUpdatedState(excluded);val start=rememberUpdatedState(onStart)
    val drag=rememberUpdatedState(onDrag);val end=rememberUpdatedState(onEnd);val cancel=rememberUpdatedState(onCancel)
    pointerInput(enabled){
        if(!enabled)return@pointerInput
        awaitEachGesture {
            val down=awaitFirstDown(requireUnconsumed=false,pass=PointerEventPass.Main)
            if(exclude.value(down.position))return@awaitEachGesture
            val velocity=VelocityTracker().apply{addPosition(down.uptimeMillis,down.position)}
            var claimed=false;var ended=false
            try {
                while(true){
                    val event=awaitPointerEvent(PointerEventPass.Main)
                    if(event.changes.size!=1)break
                    val change=event.changes.firstOrNull{it.id==down.id}?:break
                    if(change.isConsumed)break
                    velocity.addPosition(change.uptimeMillis,change.position)
                    if(!change.pressed){if(claimed){ended=true;end.value(velocity.calculateVelocity().x)};break}
                    val distance=change.position-down.position
                    if(!claimed){
                        if(abs(distance.y)>viewConfiguration.touchSlop&&abs(distance.y)>=abs(distance.x))break
                        if(abs(distance.x)<viewConfiguration.touchSlop*1.3f)continue
                        if(!start.value(distance.x))break
                        claimed=true
                    }
                    if(change.positionChange()!=Offset.Zero){change.consume();drag.value(distance.x)}
                }
            }finally{if(claimed&&!ended)cancel.value()}
        }
    }
}
