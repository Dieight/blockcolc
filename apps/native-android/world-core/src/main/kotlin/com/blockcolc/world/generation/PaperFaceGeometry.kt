package com.blockcolc.world.generation

import com.blockcolc.world.NativePacketBuffers
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Position and linear RGBA are all the paper surface needs. The source owns
 * the bytes until its immutable packet has been assembled. */
class PaperFaceGeometry(input: ByteBuffer) : BlockGeometry {
    companion object {
        const val LAYOUT = "paper-rgba-v1"
        const val STRIDE = 16
    }

    private val data = input.asReadOnlyBuffer().slice().order(ByteOrder.LITTLE_ENDIAN)
    override val vertexCount = data.remaining() / STRIDE
    override val byteSize get() = data.remaining().toLong()
    override val bounds: BlockBox
    override val vertexPreparation get() = LAYOUT

    init {
        require(vertexCount in 4..32768 && vertexCount % 4 == 0 && data.remaining() == vertexCount * STRIDE)
        val low = DoubleArray(3) { Double.POSITIVE_INFINITY }
        val high = DoubleArray(3) { Double.NEGATIVE_INFINITY }
        repeat(vertexCount) { i ->
            for (axis in 0..2) {
                val value = data.getFloat(i * STRIDE + axis * 4).toDouble()
                require(value.isFinite())
                low[axis] = minOf(low[axis], value)
                high[axis] = maxOf(high[axis], value)
            }
        }
        bounds = BlockBox(BlockPoint(low[0],low[1],low[2]),BlockPoint(high[0],high[1],high[2]))
    }

    fun vertices(): ByteBuffer = data.asReadOnlyBuffer().order(ByteOrder.LITTLE_ENDIAN)

    override fun positions() = NativePacketBuffers.floats(vertexCount * 3).apply {
        repeat(vertexCount) { i ->
            for (axis in 0..2) put(data.getFloat(i * STRIDE + axis * 4))
        }
        flip()
    }
    override fun normals() = NativePacketBuffers.floats(vertexCount * 3)
    override fun textureCoordinates() = null
}
