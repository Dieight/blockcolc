package com.blockcolc.preview

import android.content.Context
import android.opengl.GLES30
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import android.os.SystemClock
import android.view.MotionEvent
import android.view.ViewConfiguration
import com.blockcolc.world.NativeSceneCamera
import com.blockcolc.world.NativeWorldNavigation
import com.blockcolc.preview.world.PaperWorldMesh
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.PI
import kotlin.math.hypot
import kotlin.math.tan

/** Native prototype for the demo's flat face pigments, with hardware depth
 * testing in place of sorting and painting every polygon on each gesture. */
internal class P4PaperWorldView(
    context: Context,
    camera: NativeSceneCamera,
    mesh: PaperWorldMesh.Mesh,
    floating: Boolean,
    onDrawn: (Long) -> Unit,
) : GLSurfaceView(context) {
    private val orbit = NativeWorldNavigation(camera, emptyList(), camera.aspect)
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private var downX = 0f
    private var lastX = 0f
    private var lastY = 0f
    private var moving = false
    private var pinch = 0.0

    init {
        setEGLContextClientVersion(3)
        setEGLConfigChooser(8, 8, 8, 8, 24, 0)
        setRenderer(FlatRenderer(mesh, orbit, floating, onDrawn))
        renderMode = RENDERMODE_WHEN_DIRTY
    }

    fun zoom(delta: Double) {
        queueEvent { orbit.pinch(1.0, delta) }
        requestRender()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val density = resources.displayMetrics.density.toDouble()
        fun separation() = hypot((event.getX(0) - event.getX(1)).toDouble(), (event.getY(0) - event.getY(1)).toDouble())
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.x
                lastX = event.x
                lastY = event.y
                moving = false
                pinch = 0.0
            }
            MotionEvent.ACTION_POINTER_DOWN -> if (event.pointerCount == 2) pinch = separation()
            MotionEvent.ACTION_MOVE -> if (event.pointerCount == 2) {
                val before = pinch
                val after = separation()
                pinch = after
                if (before > 0 && after > 0) zoom(after / before)
            } else if (pinch == 0.0) {
                val dx = (event.x - lastX) / density
                val dy = (event.y - lastY) / density
                moving = moving || kotlin.math.abs(event.x - downX) > slop
                if (moving) {
                    queueEvent { orbit.drag(dx, dy) }
                    requestRender()
                }
                lastX = event.x
                lastY = event.y
            }
            MotionEvent.ACTION_UP -> if (!moving && pinch == 0.0) performClick()
            MotionEvent.ACTION_CANCEL -> moving = false
        }
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    private class FlatRenderer(
        private var source: PaperWorldMesh.Mesh?,
        private val orbit: NativeWorldNavigation,
        private val floating: Boolean,
        private val onDrawn: (Long) -> Unit,
    ) : Renderer {
        private data class Batch(val vbo: Int, val indices: Int)
        private val projection = FloatArray(16)
        private val view = FloatArray(16)
        private val combined = FloatArray(16)
        private var land = emptyList<Batch>()
        private var water = emptyList<Batch>()
        private var program = 0
        private var uniform = 0
        private var indexBuffer = 0
        private var vao = 0
        private var first = true
        private var aspect = .75

        override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
            val mesh = checkNotNull(source) { "The test surface must not be recreated after upload" }
            val vertex = shader(GLES30.GL_VERTEX_SHADER, VERTEX)
            val fragment = shader(GLES30.GL_FRAGMENT_SHADER, FRAGMENT)
            program = GLES30.glCreateProgram()
            GLES30.glAttachShader(program, vertex)
            GLES30.glAttachShader(program, fragment)
            GLES30.glLinkProgram(program)
            val status = IntArray(1)
            GLES30.glGetProgramiv(program, GLES30.GL_LINK_STATUS, status, 0)
            check(status[0] == GLES30.GL_TRUE) { GLES30.glGetProgramInfoLog(program) }
            GLES30.glDeleteShader(vertex)
            GLES30.glDeleteShader(fragment)
            uniform = GLES30.glGetUniformLocation(program, "projectionView")
            GLES30.glGenVertexArrays(1, status, 0)
            vao = status[0]
            GLES30.glBindVertexArray(vao)
            val indices = ByteBuffer.allocateDirect(PaperWorldMesh.QUADS_PER_CHUNK * 12)
                .order(ByteOrder.nativeOrder()).asShortBuffer()
            for (i in 0 until PaperWorldMesh.QUADS_PER_CHUNK) {
                val start = i * 4
                indices.put(start.toShort()).put((start + 1).toShort()).put((start + 2).toShort())
                indices.put(start.toShort()).put((start + 2).toShort()).put((start + 3).toShort())
            }
            indices.flip()
            GLES30.glGenBuffers(1, status, 0)
            indexBuffer = status[0]
            GLES30.glBindBuffer(GLES30.GL_ELEMENT_ARRAY_BUFFER, indexBuffer)
            GLES30.glBufferData(GLES30.GL_ELEMENT_ARRAY_BUFFER, indices.remaining() * 2, indices, GLES30.GL_STATIC_DRAW)
            fun upload(chunks: List<ByteBuffer>) = chunks.map { bytes ->
                GLES30.glGenBuffers(1, status, 0)
                GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, status[0])
                GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, bytes.remaining(), bytes, GLES30.GL_STATIC_DRAW)
                Batch(status[0], bytes.remaining() / (PaperWorldMesh.STRIDE * 4) * 6)
            }
            land = upload(mesh.land)
            water = upload(mesh.water)
            source = null
            GLES30.glEnable(GLES30.GL_DEPTH_TEST)
            GLES30.glDepthFunc(GLES30.GL_LEQUAL)
            GLES30.glDisable(GLES30.GL_CULL_FACE)
            if (floating) GLES30.glClearColor(.68f, .78f, .83f, 1f)
            else GLES30.glClearColor(.40f, .64f, .63f, 1f)
            check(GLES30.glGetError() == GLES30.GL_NO_ERROR) { "Paper model upload failed" }
        }

        override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
            aspect = width.toDouble() / height.coerceAtLeast(1)
            orbit.resize(aspect)
            GLES30.glViewport(0, 0, width, height)
        }

        override fun onDrawFrame(gl: GL10?) {
            val frame = orbit.frame
            // Match the perspective comparator at the plane of its pivot.
            // The paper projection then keeps the same scale at every depth.
            val halfHeight = (frame.distance * tan(frame.fov * PI / 360.0)).toFloat()
            val halfWidth = (halfHeight * aspect).toFloat()
            Matrix.orthoM(projection, 0, -halfWidth, halfWidth, -halfHeight, halfHeight, .1f,
                (frame.distance + frame.fitted * 3).toFloat())
            Matrix.setLookAtM(view, 0, frame.eye.x.toFloat(), frame.eye.y.toFloat(), frame.eye.z.toFloat(),
                frame.target.x.toFloat(), frame.target.y.toFloat(), frame.target.z.toFloat(), 0f, 1f, 0f)
            Matrix.multiplyMM(combined, 0, projection, 0, view, 0)
            GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT or GLES30.GL_DEPTH_BUFFER_BIT)
            GLES30.glUseProgram(program)
            GLES30.glUniformMatrix4fv(uniform, 1, false, combined, 0)
            GLES30.glBindVertexArray(vao)
            fun draw(batches: List<Batch>) {
                for (batch in batches) {
                    GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, batch.vbo)
                    GLES30.glEnableVertexAttribArray(0)
                    GLES30.glVertexAttribPointer(0, 3, GLES30.GL_FLOAT, false, PaperWorldMesh.STRIDE, 0)
                    GLES30.glEnableVertexAttribArray(1)
                    GLES30.glVertexAttribPointer(1, 4, GLES30.GL_UNSIGNED_BYTE, true, PaperWorldMesh.STRIDE, 12)
                    GLES30.glDrawElements(GLES30.GL_TRIANGLES, batch.indices, GLES30.GL_UNSIGNED_SHORT, 0)
                }
            }
            draw(land)
            if (water.isNotEmpty()) {
                GLES30.glEnable(GLES30.GL_BLEND)
                GLES30.glBlendFunc(GLES30.GL_SRC_ALPHA, GLES30.GL_ONE_MINUS_SRC_ALPHA)
                GLES30.glDepthMask(false)
                draw(water)
                GLES30.glDepthMask(true)
                GLES30.glDisable(GLES30.GL_BLEND)
            }
            if (first) {
                GLES30.glFinish()
                check(GLES30.glGetError() == GLES30.GL_NO_ERROR) { "First paper frame failed" }
                first = false
                onDrawn(SystemClock.elapsedRealtimeNanos())
            }
        }

        private fun shader(type: Int, source: String): Int {
            val shader = GLES30.glCreateShader(type)
            GLES30.glShaderSource(shader, source)
            GLES30.glCompileShader(shader)
            val status = IntArray(1)
            GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, status, 0)
            check(status[0] == GLES30.GL_TRUE) { GLES30.glGetShaderInfoLog(shader) }
            return shader
        }
    }

    private companion object {
        const val VERTEX = """#version 300 es
            layout(location=0) in vec3 position;
            layout(location=1) in vec4 pigment;
            uniform mat4 projectionView;
            out vec4 faceColor;
            void main() {
                faceColor = pigment;
                gl_Position = projectionView * vec4(position, 1.0);
            }
        """
        const val FRAGMENT = """#version 300 es
            precision mediump float;
            in vec4 faceColor;
            out vec4 pixel;
            void main() { pixel = faceColor; }
        """
    }
}
