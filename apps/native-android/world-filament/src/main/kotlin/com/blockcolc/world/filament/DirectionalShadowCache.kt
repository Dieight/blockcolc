package com.blockcolc.world.filament

import com.blockcolc.world.NativeSceneCamera
import com.blockcolc.world.SourceLight
import com.blockcolc.world.generation.BlockPoint
import com.google.android.filament.Camera
import com.google.android.filament.Engine
import com.google.android.filament.EntityManager
import com.google.android.filament.MaterialInstance
import com.google.android.filament.RenderTarget
import com.google.android.filament.Renderer
import com.google.android.filament.Scene
import com.google.android.filament.Texture
import com.google.android.filament.TextureSampler
import com.google.android.filament.View
import com.google.android.filament.Viewport
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** Render-thread owned. The light view shares caster entities with the world;
 * the main camera never determines a caster's membership in this view. */
internal class DirectionalShadowCache private constructor(
    private val engine: Engine,
    private val cameraEntity: Int,
    private val camera: Camera,
    private val scene: Scene,
    private val depth: Texture,
    private val target: RenderTarget,
    private val view: View,
) {
    private val sampler = TextureSampler(TextureSampler.MagFilter.NEAREST, TextureSampler.WrapMode.CLAMP_TO_EDGE)
    private val receivers = mutableSetOf<MaterialInstance>()
    private val casters = mutableSetOf<Int>()
    private val liveCasters = mutableSetOf<Int>()
    private val forceDepthWrite = mutableMapOf<Int, MaterialInstance>()
    private var sourceCamera: NativeSceneCamera? = null
    private var sourceLight: SourceLight? = null
    private var projection = DISABLED
    private var dirty = true

    val needsLiveShadows: Boolean get() = liveCasters.isNotEmpty()

    fun addReceiver(material: MaterialInstance) {
        // This sampler is bound once and has its own slot. Filament 1.56 can
        // retain an earlier mutable texture when rebinding a sampler slot.
        material.setParameter("directionalDepth", depth, sampler)
        bindProjection(material)
        receivers.add(material)
    }

    fun removeReceiver(material: MaterialInstance) {
        receivers.remove(material)
    }

    fun setCaster(entity: Int, attached: Boolean, cacheable: Boolean, depthOverride: MaterialInstance?) {
        if (!attached) {
            liveCasters.remove(entity)
            forceDepthWrite.remove(entity)
            if (casters.remove(entity)) {
                scene.removeEntity(entity)
                if (projection !== DISABLED) setLiveCaster(entity, true)
                dirty = true
            }
        } else if (!cacheable) {
            liveCasters.add(entity)
        } else if (casters.add(entity)) {
            scene.addEntity(entity)
            if (depthOverride != null) forceDepthWrite[entity] = depthOverride
            if (projection !== DISABLED) setLiveCaster(entity, false)
            dirty = true
        }
    }

    private fun setLiveCaster(entity: Int, enabled: Boolean) {
        val renderables = engine.renderableManager
        renderables.setCastShadows(renderables.getInstance(entity), enabled)
    }

    /** Call before beginFrame, which commits the receiver uniforms. */
    fun prepare(camera: NativeSceneCamera?, light: SourceLight?): Boolean {
        val sun = light?.takeIf { camera != null && casters.isNotEmpty() && it.intensity > 0f }
        if (sun == null) {
            if (projection !== DISABLED) {
                projection = DISABLED
                for (entity in casters) setLiveCaster(entity, true)
                for (receiver in receivers) bindProjection(receiver)
            }
            sourceLight = null
            return false
        }
        val next = checkNotNull(camera)
        val previous = sourceCamera
        val enabling = projection === DISABLED
        if (enabling || sun.direction != sourceLight?.direction ||
            sun.shadowBiasWorld != sourceLight?.shadowBiasWorld || previous == null ||
            previous.volume != next.volume || previous.target != next.target) {
            projection = fit(next, sun)
            sourceCamera = next
            sourceLight = sun
            if (enabling) for (entity in casters) setLiveCaster(entity, false)
            for (receiver in receivers) bindProjection(receiver)
            dirty = true
        }
        return true
    }

    private fun bindProjection(material: MaterialInstance) =
        material.setParameter("directionalProjection", MaterialInstance.FloatElement.MAT4, projection, 0, 1)

    private fun fit(source: NativeSceneCamera, light: SourceLight): FloatArray {
        fun dot(a: BlockPoint, b: BlockPoint) = a.x * b.x + a.y * b.y + a.z * b.z
        fun cross(a: BlockPoint, b: BlockPoint) =
            BlockPoint(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
        fun unit(point: BlockPoint): BlockPoint {
            val length = sqrt(dot(point, point))
            return BlockPoint(point.x / length, point.y / length, point.z / length)
        }

        val back = unit(BlockPoint(-light.direction[0].toDouble(), -light.direction[1].toDouble(), -light.direction[2].toDouble()))
        val referenceUp = if (abs(back.y) < .98) BlockPoint(0.0, 1.0, 0.0) else BlockPoint(0.0, 0.0, 1.0)
        val right = unit(cross(referenceUp, back))
        val up = cross(back, right)
        val radius = max(56.0, source.volume.framingRadius * 1.45)
        val (low, high) = source.volume.visibility
        val corners = ArrayList<BlockPoint>(8)
        for (x in listOf(min(low[0], source.target.x - radius), max(high[0], source.target.x + radius))) {
            for (y in listOf(low[1], high[1])) {
                for (z in listOf(min(low[2], source.target.z - radius), max(high[2], source.target.z + radius))) {
                    corners += BlockPoint(x, y, z)
                }
            }
        }
        fun range(axis: BlockPoint) =
            (corners.minOf { dot(it, axis) } - 2.0)..(corners.maxOf { dot(it, axis) } + 2.0)
        val horizontal = range(right)
        val vertical = range(up)
        val longitudinal = range(back)
        val span = longitudinal.endInclusive - longitudinal.start
        val eye = longitudinal.endInclusive + 1.0
        camera.lookAt(back.x * eye, back.y * eye, back.z * eye,
            back.x * (eye - 1.0), back.y * (eye - 1.0), back.z * (eye - 1.0), up.x, up.y, up.z)
        camera.setProjection(Camera.Projection.ORTHO, horizontal.start, horizontal.endInclusive,
            vertical.start, vertical.endInclusive, 1.0, span + 1.0)

        val clipFromView = camera.getProjectionMatrix(null)
        val viewFromWorld = camera.getViewMatrix(DoubleArray(16))
        val result = FloatArray(16)
        // Public camera matrices use GL clip coordinates. Sample normalized
        // texture coordinates and Filament's reversed depth in the shader.
        for (column in 0..3) {
            val offset = column * 4
            for (row in 0..2) {
                var coefficient = 0.0
                for (component in 0..3) coefficient += clipFromView[component * 4 + row] * viewFromWorld[offset + component]
                if (row == 2) coefficient = -coefficient
                result[offset + row] = ((coefficient + if (column == 3) 1.0 else 0.0) * .5).toFloat()
            }
        }
        result[3] = (max(.07, light.shadowBiasWorld.toDouble()) / span).toFloat()
        result[7] = (max(horizontal.endInclusive - horizontal.start, vertical.endInclusive - vertical.start) / SIZE).toFloat()
        result[15] = 1f
        return result
    }

    fun draw(renderer: Renderer) {
        if (projection === DISABLED || !dirty) return
        android.os.Trace.beginSection("blockcolc-sun-map")
        try {
            // Filament's shadow pass forces depth writes for explicitly
            // marked casters, even when their color pass disables them.
            for (material in forceDepthWrite.values) material.setDepthWrite(true)
            renderer.render(view)
            dirty = false
        } finally {
            for (material in forceDepthWrite.values) material.setDepthWrite(false)
            android.os.Trace.endSection()
        }
    }

    /** Retire the packets before their shared depth texture. */
    fun close() {
        check(receivers.isEmpty() && casters.isEmpty() && liveCasters.isEmpty())
        view.renderTarget = null
        engine.destroyView(view)
        engine.destroyRenderTarget(target)
        engine.destroyTexture(depth)
        engine.destroyScene(scene)
        engine.destroyCameraComponent(cameraEntity)
        EntityManager.get().destroy(cameraEntity)
    }

    companion object {
        private const val SIZE = 2048
        private val DISABLED = FloatArray(16)

        fun create(engine: Engine): DirectionalShadowCache? {
            if (!Texture.isTextureFormatSupported(engine, Texture.InternalFormat.DEPTH24)) return null
            val entity = EntityManager.get().create()
            var scene: Scene? = null
            var depth: Texture? = null
            var target: RenderTarget? = null
            var view: View? = null
            return try {
                val camera = engine.createCamera(entity)
                scene = engine.createScene()
                depth = Texture.Builder().width(SIZE).height(SIZE).levels(1)
                    .sampler(Texture.Sampler.SAMPLER_2D).format(Texture.InternalFormat.DEPTH24)
                    .usage(Texture.Usage.DEPTH_ATTACHMENT or Texture.Usage.SAMPLEABLE).build(engine)
                target = RenderTarget.Builder().texture(RenderTarget.AttachmentPoint.DEPTH, depth).build(engine)
                view = engine.createView()
                view.setName("blockcolc-sun-depth")
                view.scene = scene
                view.camera = camera
                view.viewport = Viewport(0, 0, SIZE, SIZE)
                view.renderTarget = target
                view.setPostProcessingEnabled(false)
                view.setShadowingEnabled(false)
                view.setSampleCount(1)
                DirectionalShadowCache(engine, entity, camera, scene, depth, target, view)
            } catch (error: IllegalStateException) {
                view?.let(engine::destroyView)
                target?.let(engine::destroyRenderTarget)
                depth?.let(engine::destroyTexture)
                scene?.let(engine::destroyScene)
                engine.destroyCameraComponent(entity)
                EntityManager.get().destroy(entity)
                android.util.Log.w("BlockcolcWorld", "Using Filament directional shadows after target allocation failed", error)
                null
            }
        }
    }
}
