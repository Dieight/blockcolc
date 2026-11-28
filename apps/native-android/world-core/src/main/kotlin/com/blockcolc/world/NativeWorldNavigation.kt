package com.blockcolc.world

import com.blockcolc.world.generation.BlockPoint
import java.util.Collections
import kotlin.math.*

/** Display identity only. Selecting a pivot does not select an active task. */
data class NativeOrbitTarget(val id:String,val position:BlockPoint,val width:Double,val depth:Double,val height:Double) {
    init {require(id.isNotBlank()&&id.length<=1024);require(listOf(width,depth,height).all{it.isFinite()&&it>0})}
    internal val radius get()=maxOf(8.0,width*.78,depth*.78)
    internal val center get()=BlockPoint(position.x,max(1.5,(position.y+max(5.0,height)/2)*.68),position.z)
    internal val framingRadius get()=sqrt(8*radius*radius+(max(5.0,height)+2).pow(2))/2
}

data class NativeOrbitFrame(val target:BlockPoint,val eye:BlockPoint,val distance:Double,val fitted:Double,val minimum:Double,val maximum:Double,
    val pitch:Double,val azimuth:Double,val fov:Double,val selected:String?)

/** Render-thread camera state. The source renderer's focused and settlement
 * fits are separate; closing a memory surface never calls either reset. */
class NativeWorldNavigation(camera:NativeSceneCamera,targets:List<NativeOrbitTarget>,aspect:Double) {
    private var camera=camera
    private var targets=owned(targets)
    private var aspect=aspect.also{require(it.isFinite()&&it>0)}
    private var selected:String?=null
    private var target=camera.target
    private var fitted=camera.fittedDistance
    private var minimum=1.0;private var maximum=1.0
    private var distance=1.0
    private var pitch=38*PI/180
    private var azimuth=PI/4
    private var interior:NativeInteriorPose?=null
    private var interiorAzimuth=PI/2
    private var interiorPitch=0.0
    private var interiorFov=55.0
    private data class CameraTransition(
        val from:BlockPoint,val to:BlockPoint,
        val fromDistance:Double,val toDistance:Double,
        val fromPitch:Double,val toPitch:Double,
        val fromAzimuth:Double,val toAzimuth:Double,
        val durationNs:Long,val arcLift:Double=0.0,val isOpening:Boolean=false,
        var previous:Long?=null,var elapsed:Long=0,
    )
    private var opening:CameraTransition?=null
    val openingActive:Boolean get()=opening?.isOpening==true
    val transitionActive:Boolean get()=opening!=null
    val indoors:Boolean get()=interior!=null
    val orthographic:Boolean get()=camera.paper&&!indoors
    val orthographicEyeOffset:Double get()=if(orthographic)paperEyeOffset(target,distance)else 0.0
    // Indoor look direction is a unit vector, not the distance to the town.
    // Feeding that unit length to atmospheric fog hid every outdoor building.
    val atmosphericDistance:Double get()=interior?.sceneDistance?:distance
    fun interior(pose:NativeInteriorPose?){
        if(pose==interior)return
        val entering=interior==null&&pose!=null;interior=pose
        if(entering){interiorAzimuth=PI/2;interiorPitch=pose!!.pitch;interiorFov=pose.fov}
    }
    init {fit(true,opening=true)}
    val frame:NativeOrbitFrame get(){
        interior?.let{room->val p=interiorPitch;val a=interiorAzimuth;val e=room.eye
            val look=BlockPoint(e.x-cos(p)*cos(a),e.y-sin(p),e.z-cos(p)*sin(a))
            return NativeOrbitFrame(look,e,1.0,1.0,1.0,1.0,p,a,interiorFov,null)}
        val horizontal=distance*cos(pitch)
        return NativeOrbitFrame(target,BlockPoint(target.x+horizontal*cos(azimuth),target.y+distance*sin(pitch),target.z+horizontal*sin(azimuth)),
            distance,fitted,minimum,maximum,pitch,azimuth,camera.fov,selected)}
    val targetIds:List<String> get()=Collections.unmodifiableList(targets.map{it.id})
    fun adopt(camera:NativeSceneCamera,targets:List<NativeOrbitTarget>,resetSpatial:Boolean){
        this.camera=camera;this.targets=owned(targets)
        if(selected!=null&&targets.none{it.id==selected}){selected=null;fit(true)}
        else if(resetSpatial)fit(true)
    }
    fun resize(aspect:Double){
        require(aspect.isFinite()&&aspect>0);if(this.aspect==aspect)return
        this.aspect=aspect
        val running=opening
        if(running!=null&&running.isOpening&&interior==null){
            // Window insets can change while the opening is already visible.
            // Refit both endpoints, retaining the visible animation time.
            prepareOpening(selected)
            opening?.let{it.previous=running.previous;it.elapsed=running.elapsed;applyOpening(it)}
        }else fit(false)
    }
    fun focus(id:String?):Boolean {
        if(interior!=null)return false
        if(id!=null&&targets.none{it.id==id})return false
        if(id==selected)return true
        opening=null;selected=id;fit(true);return true
    }
    /** Smooth aerial fly-over between buildings in Settlement mode. */
    fun flyTo(id:String?,reduceMotion:Boolean=false):Boolean {
        if(interior!=null)return false
        if(id!=null&&targets.none{it.id==id})return false
        if(id==selected&&opening==null)return true
        val fromTarget=target;val fromDist=distance;val fromPitch=pitch;val fromAzimuth=azimuth
        selected=id;fit(true)
        val toTarget=target;val toDist=distance;val toPitch=pitch;val toAzimuth=azimuth
        val travel=hypot(toTarget.x-fromTarget.x,toTarget.z-fromTarget.z)
        if(reduceMotion||camera.preview||(travel<0.2&&abs(toDist-fromDist)<0.2)){
            opening=null;return true
        }
        val lift=(travel*0.18).coerceIn(1.2,7.5)
        opening=CameraTransition(fromTarget,toTarget,fromDist,toDist,fromPitch,toPitch,fromAzimuth,toAzimuth,720_000_000L,arcLift=lift,isOpening=false)
        target=fromTarget;distance=fromDist
        return true
    }
    /** Subtle museum-turntable arrival glide when switching models in Single-Building mode. */
    fun playSingleArrival(reduceMotion:Boolean=false){
        if(reduceMotion||interior!=null)return
        val toTarget=target;val toDist=distance;val toPitch=pitch;val toAzimuth=azimuth
        val fromTarget=BlockPoint(toTarget.x,toTarget.y-0.55,toTarget.z)
        val fromDist=(toDist*1.12).coerceIn(minimum,maximum)
        val fromPitch=(toPitch+0.07).coerceIn(24*PI/180,64*PI/180)
        val fromAzimuth=toAzimuth-0.24
        opening=CameraTransition(fromTarget,toTarget,fromDist,toDist,fromPitch,toPitch,fromAzimuth,toAzimuth,460_000_000L,arcLift=0.0,isOpening=false)
        target=fromTarget;distance=fromDist;pitch=fromPitch;azimuth=fromAzimuth
    }
    /** Prepare behind the world loader; the first visible frame starts the clock. */
    fun prepareOpening(id:String?,reduceMotion:Boolean=false){
        if(camera.preview||interior!=null)return
        selected=null;fit(true);val from=target;val fromDistance=maximum
        selected=id?.takeIf{value->targets.any{it.id==value}};fit(true)
        val destination=target;val toDistance=if(selected==null)(fitted*.45).coerceIn(minimum,maximum)else distance
        if(reduceMotion){opening=null;distance=toDistance;return}
        opening=CameraTransition(from,destination,fromDistance,toDistance,pitch,pitch,azimuth,azimuth,1_500_000_000L,arcLift=0.0,isOpening=true);target=from;distance=fromDistance
    }
    fun advanceOpening(timestamp:Long):Boolean {
        require(timestamp>=0)
        val value=opening?:return false
        value.previous?.let{value.elapsed=(value.elapsed+(timestamp-it).coerceIn(0,value.durationNs)).coerceAtMost(value.durationNs)}
        value.previous=timestamp;applyOpening(value)
        return true
    }
    fun pauseOpening(){opening?.previous=null}
    private fun applyOpening(value:CameraTransition){
        val p=(value.elapsed/value.durationNs.toDouble()).coerceIn(0.0,1.0)
        val eased=if(value.isOpening)p*p*(3-2*p) else 1.0-(1.0-p).pow(3)
        val lift=if(value.arcLift>0.0)sin(PI*p)*value.arcLift else 0.0
        target=BlockPoint(
            value.from.x+(value.to.x-value.from.x)*eased,
            value.from.y+(value.to.y-value.from.y)*eased+lift,
            value.from.z+(value.to.z-value.from.z)*eased,
        )
        distance=when{p<=0.0->value.fromDistance;p>=1.0->value.toDistance;else->exp(ln(value.fromDistance)+(ln(value.toDistance)-ln(value.fromDistance))*eased)}
        pitch=value.fromPitch+(value.toPitch-value.fromPitch)*eased
        azimuth=value.fromAzimuth+(value.toAzimuth-value.fromAzimuth)*eased
        if(p>=1.0)opening=null
    }
    fun resetView(){opening=null;interior?.let{interiorAzimuth=PI/2;interiorPitch=it.pitch;interiorFov=it.fov;return};pitch=38*PI/180;azimuth=PI/4;fit(true)}
    fun resetMap(){selected=null;resetView()}
    fun drag(dx:Double,dy:Double){require(dx.isFinite()&&dy.isFinite());opening=null;if(interior!=null){interiorAzimuth+=dx*.006;interiorPitch=(interiorPitch+dy*.0045).coerceIn(-65*PI/180,68*PI/180);return};azimuth+=dx*.011;pitch=(pitch+dy*.0045).coerceIn(24*PI/180,64*PI/180)}
    fun pinch(previous:Double,current:Double,centerDelta:Double=0.0){
        require(listOf(previous,current,centerDelta).all{it.isFinite()}&&previous>0&&current>0)
        opening=null
        if(interior!=null){interiorFov=(interiorFov*previous/current).coerceIn(38.0,72.0);return}
        distance=(distance*previous/current).coerceIn(minimum,maximum);pitch=(pitch+centerDelta*.0025).coerceIn(24*PI/180,64*PI/180)
    }
    private fun fit(reset:Boolean,opening:Boolean=false){
        val focus=targets.firstOrNull{it.id==selected}
        val radius=focus?.framingRadius?:camera.volume.framingRadius
        val vertical=camera.fov*PI/180;val horizontal=2*atan(tan(vertical/2)*max(.1,aspect))
        fitted=radius/sin(max(.1,min(vertical,horizontal))/2)*1.04
        target=focus?.center?:camera.target
        minimum=if(focus!=null)fitted*.9 else if(camera.preview)fitted*.65 else min(fitted*.9,max(12.0,fitted*.1))
        maximum=fitted*if(focus==null&&!camera.preview).9 else 1.35
        distance=(if(reset)fitted*if(opening&&!camera.preview).45 else 1.0 else distance).coerceIn(minimum,maximum)
    }
    private fun paperEyeOffset(target:BlockPoint,distance:Double):Double {
        // Moving an orthographic eye along its viewing direction leaves the
        // composition unchanged. Keep every corner of the world in front of
        // it, including nearby terrain revealed by the taller focus window.
        val box=camera.volume.visibility
        val extent=sqrt((0..2).sumOf{axis->
            max(abs(target[axis]-box[0][axis]),abs(target[axis]-box[1][axis])).pow(2)
        })
        return max(0.0,extent+48.0-distance)
    }
    fun ray(x:Double,y:Double,width:Int,height:Int):NativePickRay {
        require(width>0&&height>0&&x.isFinite()&&y.isFinite())
        val f=frame;val forward=unit(sub(f.target,f.eye));val right=unit(cross(forward,BlockPoint(0.0,1.0,0.0)));val up=cross(right,forward)
        val vertical=tan(f.fov*PI/360);val px=(2*x/width-1)*vertical*width/height;val py=(1-2*y/height)*vertical
        if(orthographic){
            val distance=f.distance
            val offset=orthographicEyeOffset
            val origin=BlockPoint(f.eye.x-forward.x*offset+(right.x*px+up.x*py)*distance,
                f.eye.y-forward.y*offset+(right.y*px+up.y*py)*distance,
                f.eye.z-forward.z*offset+(right.z*px+up.z*py)*distance)
            return NativePickRay(origin,forward)
        }
        return NativePickRay(f.eye,unit(BlockPoint(forward.x+right.x*px+up.x*py,forward.y+right.y*px+up.y*py,forward.z+right.z*px+up.z*py)))
    }
    /** Also used by accessibility/diagnostic projection, never by domain logic. */
    fun screen(point:BlockPoint,width:Int,height:Int):Pair<Double,Double>? {
        require(width>0&&height>0)
        val f=frame;val forward=unit(sub(f.target,f.eye));val right=unit(cross(forward,BlockPoint(0.0,1.0,0.0)));val up=cross(right,forward);val delta=sub(point,f.eye)
        val depth=dot(delta,forward)
        if(if(orthographic)depth+orthographicEyeOffset<=0 else depth<=0)return null
        val vertical=tan(f.fov*PI/360)
        val scale=if(orthographic)f.distance else depth
        return (dot(delta,right)/(scale*vertical*width/height)+1)*width/2 to (1-dot(delta,up)/(scale*vertical))*height/2
    }
    companion object {
        private fun owned(targets:List<NativeOrbitTarget>)=Collections.unmodifiableList(targets.toList()).also{require(it.size<=4095&&it.map{t->t.id}.distinct().size==it.size)}
        internal fun sub(a:BlockPoint,b:BlockPoint)=BlockPoint(a.x-b.x,a.y-b.y,a.z-b.z)
        internal fun dot(a:BlockPoint,b:BlockPoint)=a.x*b.x+a.y*b.y+a.z*b.z
        internal fun cross(a:BlockPoint,b:BlockPoint)=BlockPoint(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x)
        internal fun unit(a:BlockPoint):BlockPoint {val n=sqrt(dot(a,a));require(n.isFinite()&&n>0);return BlockPoint(a.x/n,a.y/n,a.z/n)}
    }
}
