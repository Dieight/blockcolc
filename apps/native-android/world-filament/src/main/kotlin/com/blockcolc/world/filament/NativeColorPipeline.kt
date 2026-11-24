package com.blockcolc.world.filament

import android.content.res.AssetManager
import com.blockcolc.world.ResourcePool
import com.blockcolc.world.SourcePost
import com.blockcolc.world.SourceWorldColor
import com.blockcolc.world.NativeGlassRegion
import com.google.android.filament.*
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder

interface PreparedColorConfiguration {
    fun commit()
    fun rollback()
    fun finish():Int
    fun discard()
}

/** Source linear scene -> half-size bright/H/V blur -> source ACES/sRGB, or
 * directly encoded per-material colour transported through the scene target.
 * Target storage is staged independently of live View bindings. Configuration
 * changes that only affect colour/strength reuse the existing attachments. */
class NativeColorPipeline(private val engine:Engine,private val assets:AssetManager,
    private val world:com.google.android.filament.View,private val camera:Camera,
    exposure:Float,private val probe:Boolean,post:SourcePost,private val displayDensity:Float=1f) {
    private data class Pass(val scene:Scene,val view:com.google.android.filament.View,val instance:MaterialInstance,val entity:Int)
    private data class Attachment(val target:RenderTarget,val color:Texture,val depth:Texture?)
    private data class Shape(val width:Int,val height:Int,val bloom:Boolean,val hdr:Boolean,val glass:Boolean,val outputWidth:Int,val outputHeight:Int,val pixel:Boolean=false)
    private data class Targets(val attachments:List<Attachment>)
    private data class Configuration(val post:SourcePost,val shape:Shape,val targets:Targets)
    private val materials=mutableMapOf<String,Material>()
    private val passes=mutableListOf<Pass>()
    private lateinit var vertex:VertexBuffer
    private lateinit var index:IndexBuffer
    private lateinit var terminal:Pass
    private lateinit var probePass:Pass
    private lateinit var bright:Pass
    private lateinit var horizontal:Pass
    private lateinit var vertical:Pass
    private lateinit var glassHorizontal:Pass
    private lateinit var glassCompose:Pass
    private var regions:List<NativeGlassRegion> = emptyList()
    private var targetsCreated=0;private var targetsDestroyed=0
    private var injectedTargetLimit:Int?=null
    private val pool=ResourcePool<Shape,Targets>{destroy(it)}
    private val state=RenderTargetState<Pair<SourcePost,Shape>,Configuration>(
        {input->Configuration(input.first,input.second,pool.acquire(input.second){allocate(input.second)})},
        ::bind,{value->pool.release(value.shape)})
    var closed=false;private set
    private val current get()=checkNotNull(state.current)
    val configuration:SourcePost get()=current.post
    val sceneWidth get()=current.shape.width
    val sceneHeight get()=current.shape.height
    val bloomEnabled get()=current.shape.bloom
    val attachmentFormat get()=if(current.shape.hdr)"RGBA16F"else"RGBA8"
    private val linear=TextureSampler(TextureSampler.MinFilter.LINEAR,TextureSampler.MagFilter.LINEAR,TextureSampler.WrapMode.CLAMP_TO_EDGE)
    // Pixel style enlarges the scene without smoothing; glass blur stays linear.
    private val nearest=TextureSampler(TextureSampler.MinFilter.NEAREST,TextureSampler.MagFilter.NEAREST,TextureSampler.WrapMode.CLAMP_TO_EDGE)
    private var pixelated=false
    private fun program(name:String)=materials.getOrPut(name){
        val bytes=assets.open("$name.filamat").use{it.readBytes()}
        val buffer=ByteBuffer.allocateDirect(bytes.size).put(bytes);buffer.flip()
        Material.Builder().payload(buffer,buffer.remaining()).build(engine)
    }
    private fun pass(name:String):Pass {
        val material=program(name).createInstance();var scene:Scene?=null;var view:com.google.android.filament.View?=null;var entity=0
        try{
            scene=engine.createScene();view=engine.createView();entity=EntityManager.get().create()
            RenderableManager.Builder(1).geometry(0,RenderableManager.PrimitiveType.TRIANGLES,vertex,index).material(0,material)
                .boundingBox(Box(floatArrayOf(0f,0f,0f),floatArrayOf(4f,4f,1f)))
                .culling(false).castShadows(false).receiveShadows(false).build(engine,entity)
            scene.addEntity(entity);view.scene=scene;view.camera=camera;view.setPostProcessingEnabled(false)
            view.setShadowingEnabled(false);view.antiAliasing=com.google.android.filament.View.AntiAliasing.NONE
            return Pass(scene,view,material,entity).also{passes+=it}
        }catch(error:Throwable){
            view?.let{engine.destroyView(it)};if(entity!=0){engine.destroyEntity(entity);EntityManager.get().destroy(entity)}
            scene?.let{engine.destroyScene(it)};engine.destroyMaterialInstance(material);throw error
        }
    }
    init {
        try{
            require(exposure.isFinite()&&exposure in .01f..100f)
            val points=floatArrayOf(-1f,-1f,0f,0f,0f,3f,-1f,0f,2f,0f,-1f,3f,0f,0f,2f)
            val vertices=ByteBuffer.allocateDirect(points.size*4).order(ByteOrder.nativeOrder())
            for(point in points)vertices.putFloat(point);vertices.flip()
            vertex=VertexBuffer.Builder().vertexCount(3).bufferCount(1)
                .attribute(VertexBuffer.VertexAttribute.POSITION,0,VertexBuffer.AttributeType.FLOAT3,0,20)
                .attribute(VertexBuffer.VertexAttribute.UV0,0,VertexBuffer.AttributeType.FLOAT2,12,20).build(engine)
            vertex.setBufferAt(engine,0,vertices)
            index=IndexBuffer.Builder().indexCount(3).bufferType(IndexBuffer.Builder.IndexType.USHORT).build(engine)
            val indices=ByteBuffer.allocateDirect(6).order(ByteOrder.nativeOrder()).putShort(0).putShort(1).putShort(2);indices.flip();index.setBuffer(engine,indices)
            terminal=pass("terminal-color");probePass=pass("color-probe");bright=pass("bloom-bright")
            horizontal=pass("bloom-blur");vertical=pass("bloom-blur")
            glassHorizontal=pass("glass-blur");glassCompose=pass("glass-compose")
            terminal.instance.setParameter("exposure",exposure)
            world.setPostProcessingEnabled(false)
            prepareConfiguration(post,720,960).also{it.commit();it.finish()}
        }catch(error:Throwable){try{close()}catch(cleanup:Throwable){error.addSuppressed(cleanup)};throw error}
    }
    private fun attachment(w:Int,h:Int,depth:Boolean,hdr:Boolean):Attachment {
        var color:Texture?=null;var z:Texture?=null
        try{
            color=Texture.Builder().width(w).height(h).levels(1).sampler(Texture.Sampler.SAMPLER_2D)
                .format(if(hdr)Texture.InternalFormat.RGBA16F else Texture.InternalFormat.RGBA8)
                .usage(Texture.Usage.COLOR_ATTACHMENT or Texture.Usage.SAMPLEABLE).build(engine)
            if(depth)z=Texture.Builder().width(w).height(h).levels(1).sampler(Texture.Sampler.SAMPLER_2D)
                .format(Texture.InternalFormat.DEPTH24).usage(Texture.Usage.DEPTH_ATTACHMENT).build(engine)
            val builder=RenderTarget.Builder().texture(RenderTarget.AttachmentPoint.COLOR,color)
            if(z!=null)builder.texture(RenderTarget.AttachmentPoint.DEPTH,z)
            return Attachment(builder.build(engine),color,z).also{targetsCreated++}
        }catch(error:Throwable){z?.let{engine.destroyTexture(it)};color?.let{engine.destroyTexture(it)};throw error}
    }
    private fun destroy(targets:Targets){
        var failure:Throwable?=null
        fun cleanup(block:()->Unit){try{block()}catch(error:Throwable){if(failure==null)failure=error else failure!!.addSuppressed(error)}}
        for(a in targets.attachments.asReversed()){
            cleanup{engine.destroyRenderTarget(a.target)};cleanup{engine.destroyTexture(a.color)};a.depth?.let{cleanup{engine.destroyTexture(it)}};targetsDestroyed++
        }
        failure?.let{throw it}
    }
    private fun allocate(shape:Shape):Targets {
        val all=mutableListOf<Attachment>()
        fun add(w:Int,h:Int,depth:Boolean,hdr:Boolean){
            all+=attachment(w,h,depth,hdr)
            if(injectedTargetLimit==all.size)error("Injected staged color-target failure")
        }
        try{
            add(shape.width,shape.height,true,shape.hdr)
            if(shape.bloom)repeat(3){add((shape.width+1)/2,(shape.height+1)/2,false,false)}
            if(shape.glass){add(shape.width,shape.height,false,false);add((shape.width+1)/2,(shape.height+1)/2,false,false)}
            return Targets(all.toList())
        }catch(error:Throwable){try{destroy(Targets(all))}catch(cleanup:Throwable){error.addSuppressed(cleanup)};throw error}
    }
    private fun bind(value:Configuration?){
        world.renderTarget=null;for(pass in passes)pass.view.renderTarget=null
        if(value==null)return
        val shape=value.shape;val post=value.post;val source=value.targets.attachments[0]
        world.renderTarget=source.target;world.viewport=Viewport(0,0,shape.width,shape.height)
        world.setSampleCount(post.sceneSamples)
        probePass.view.renderTarget=source.target;probePass.view.viewport=Viewport(0,0,shape.width,shape.height)
        terminal.view.viewport=Viewport(0,0,if(shape.glass)shape.width else shape.outputWidth,if(shape.glass)shape.height else shape.outputHeight)
        val upscale=if(shape.pixel)nearest else linear
        terminal.instance.setParameter("source",source.color,upscale)
        terminal.instance.setParameter("bloomStrength",if(shape.bloom)post.strength else 0f)
        terminal.instance.setParameter("sourceEncoded",post.direct&&!probe)
        val c=post.worldColor
        terminal.instance.setParameter("worldColor",c.saturation/100f,c.brightness/100f,c.contrast/100f)
        terminal.instance.setParameter("gradeEnabled",!c.neutral)
        bright.instance.setParameter("threshold",post.threshold);bright.instance.setParameter("knee",post.knee)
        if(shape.bloom){
            val w=(shape.width+1)/2;val h=(shape.height+1)/2;val a=value.targets.attachments
            for(pass in listOf(bright,horizontal,vertical))pass.view.viewport=Viewport(0,0,w,h)
            bright.view.renderTarget=a[1].target;horizontal.view.renderTarget=a[2].target;vertical.view.renderTarget=a[3].target
            bright.instance.setParameter("source",source.color,linear)
            horizontal.instance.setParameter("source",a[1].color,linear);horizontal.instance.setParameter("stepUv",1f/w,0f)
            vertical.instance.setParameter("source",a[2].color,linear);vertical.instance.setParameter("stepUv",0f,1f/h)
            terminal.instance.setParameter("bloom",a[3].color,linear)
        }else {
            terminal.instance.setParameter("bloom",source.color,linear)
            // Filament commits dirty MaterialInstances even when their pass
            // is idle. None may retain a retired bloom attachment's handle.
            for(pass in listOf(bright,horizontal,vertical))pass.instance.setParameter("source",source.color,linear)
            horizontal.instance.setParameter("stepUv",0f,0f);vertical.instance.setParameter("stepUv",0f,0f)
        }
        val first=if(shape.bloom)4 else 1
        val a=value.targets.attachments
        val encoded=if(shape.glass)a[first].color else source.color
        glassHorizontal.instance.setParameter("source",encoded,linear)
        glassCompose.instance.setParameter("source",encoded,upscale)
        glassCompose.instance.setParameter("blurred",if(shape.glass)a[first+1].color else source.color,linear)
        glassHorizontal.instance.setParameter("axis",1f,0f)
        glassCompose.instance.setParameter("axis",0f,1f)
        if(shape.glass){
            terminal.view.renderTarget=a[first].target
            glassHorizontal.view.renderTarget=a[first+1].target
            glassHorizontal.view.viewport=Viewport(0,0,(shape.width+1)/2,(shape.height+1)/2)
            glassCompose.view.viewport=Viewport(0,0,shape.outputWidth,shape.outputHeight)
        }
        bindGlassRegions()
    }
    fun prepareConfiguration(post:SourcePost,newWidth:Int=current.shape.outputWidth,newHeight:Int=current.shape.outputHeight,failAfterTargets:Int?=null):PreparedColorConfiguration {
        check(!closed);require(newWidth in 1..4096&&newHeight in 1..4096);require(failAfterTargets==null||failAfterTargets in 1..4)
        val pixel=pixelated&&!probe
        val size=if(pixel)SceneRenderSize.forPixels(newWidth,newHeight,displayDensity)
            else SceneRenderSize.forDisplay(newWidth,newHeight,displayDensity,if(post.bloom)2f else 1.5f,probe)
        val shape=Shape(size.width,size.height,post.bloom&&!probe,probe||!post.bloom&&!post.direct,regions.isNotEmpty()&&!probe,newWidth,newHeight,pixel)
        injectedTargetLimit=failAfterTargets
        val prepared=try{state.prepare(post to shape)}finally{injectedTargetLimit=null}
        return object:PreparedColorConfiguration {
            override fun commit()=prepared.commit()
            override fun rollback()=prepared.rollback()
            override fun finish()=prepared.finish()
            override fun discard()=prepared.discard()
        }
    }
    fun resize(newWidth:Int,newHeight:Int){
        check(!closed);if(newWidth==current.shape.outputWidth&&newHeight==current.shape.outputHeight)return
        prepareConfiguration(current.post,newWidth,newHeight).also{it.commit();it.finish()}
    }
    /** Render-only style switch: scene size and upscale sampling change; the
     * geometry, camera and colour path stay the same. */
    fun pixelated(value:Boolean){
        check(!closed);if(value==pixelated)return
        val old=pixelated;pixelated=value
        try{prepareConfiguration(current.post).also{it.commit();it.finish()}}catch(error:Throwable){pixelated=old;throw error}
    }
    fun worldColor(value:SourceWorldColor){
        check(!closed);if(value==current.post.worldColor)return
        prepareConfiguration(current.post.copy(worldColor=value)).also{it.commit();it.finish()}
    }
    fun draw(renderer:Renderer){
        check(!closed);renderer.render(if(probe)probePass.view else world)
        if(bloomEnabled){renderer.render(bright.view);renderer.render(horizontal.view);renderer.render(vertical.view)}
        renderer.render(terminal.view)
        if(current.shape.glass){renderer.render(glassHorizontal.view);renderer.render(glassCompose.view)}
    }
    /** UI only registers geometry. Sampling, scattering and composition all run
     * inside this frame, on the same renderer and camera as the visible world. */
    fun glassRegions(value:List<NativeGlassRegion>){
        check(!closed);require(value.size<=4)
        if(value==regions)return
        val old=regions;regions=value.toList()
        try {
            if(current.shape.glass!=(regions.isNotEmpty()&&!probe))prepareConfiguration(current.post).also{it.commit();it.finish()}
            else bindGlassRegions()
        }catch(error:Throwable){regions=old;throw error}
    }
    private fun bindGlassRegions(){
        if(!::glassCompose.isInitialized)return
        val ceilings=FloatArray(4){1f}
        val floors=FloatArray(4)
        for(i in 0..3){val region=regions.getOrNull(i);ceilings[i]=region?.ceiling?:1f;floors[i]=region?.floor?:0f
            for(pass in listOf(glassHorizontal,glassCompose)){
                pass.instance.setParameter("rect$i",region?.left?:-2f,region?.bottom?:-2f,region?.right?:-1f,region?.top?:-1f)
                pass.instance.setParameter("style$i",region?.blurX?:0f,region?.blurY?:0f,region?.saturation?:1f,region?.brightness?:1f)
            }
        }
        for(pass in listOf(glassHorizontal,glassCompose)){
            pass.instance.setParameter("ceilings",ceilings[0],ceilings[1],ceilings[2],ceilings[3])
            pass.instance.setParameter("floors",floors[0],floors[1],floors[2],floors[3])
        }
    }
    fun exposure(value:Float){check(!closed);require(value.isFinite()&&value in .01f..100f);terminal.instance.setParameter("exposure",value)}
    fun diagnostics():JSONObject=JSONObject().put("closed",closed).put("targetsCreated",targetsCreated).put("targetsDestroyed",targetsDestroyed)
        .put("liveTargets",targetsCreated-targetsDestroyed).put("glassRegions",regions.size).put("glassSampling","same-frame-gpu").put("config",state.current?.let{value->JSONObject().put("width",value.shape.width).put("height",value.shape.height)
            .put("outputWidth",value.shape.outputWidth).put("outputHeight",value.shape.outputHeight)
            .put("bloom",value.shape.bloom).put("hdr",value.shape.hdr).put("pixel",value.shape.pixel).put("sampleCount",value.post.sceneSamples)
            .put("direct",value.post.direct&&!probe)
            .put("strength",value.post.strength.toDouble()).put("sourceTexture",System.identityHashCode(value.targets.attachments[0].color))
            .put("saturation",value.post.worldColor.saturation).put("brightness",value.post.worldColor.brightness).put("contrast",value.post.worldColor.contrast)})
    fun close(){
        if(closed)return;closed=true
        var failure:Throwable?=null
        fun cleanup(block:()->Unit){try{block()}catch(error:Throwable){if(failure==null)failure=error else failure!!.addSuppressed(error)}}
        cleanup{world.renderTarget=null};for(p in passes)cleanup{p.view.renderTarget=null}
        // Destroy sampler-owning instances before their target textures.
        for(p in passes){cleanup{engine.destroyView(p.view)};cleanup{engine.destroyEntity(p.entity)};cleanup{EntityManager.get().destroy(p.entity)}
            cleanup{engine.destroyMaterialInstance(p.instance)};cleanup{engine.destroyScene(p.scene)}}
        passes.clear();cleanup{check(state.close()==0){"Color-target retirement failed"}}
        for(m in materials.values)cleanup{engine.destroyMaterial(m)};materials.clear()
        if(::vertex.isInitialized)cleanup{engine.destroyVertexBuffer(vertex)};if(::index.isInitialized)cleanup{engine.destroyIndexBuffer(index)}
        failure?.let{throw it}
    }
}
