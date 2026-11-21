package com.blockcolc.world.filament

import com.google.android.filament.Engine
import com.google.android.filament.Fence

/** Render-thread only. Filament's normal frame admission is used until a
 * touch changes the camera. Any additional submissions have a GPU fence. */
internal class WorldFrameQueue(private val engine: Engine) {
    private val pending = ArrayDeque<Fence>(3)
    private var available = true

    val canContinueDrag: Boolean get() = available

    fun hasSpace(): Boolean {
        while (pending.isNotEmpty()) {
            when (pending.first().wait(Fence.Mode.DONT_FLUSH, 0)) {
                Fence.FenceStatus.CONDITION_SATISFIED -> engine.destroyFence(pending.removeFirst())
                Fence.FenceStatus.TIMEOUT_EXPIRED -> break
                Fence.FenceStatus.ERROR -> {
                    available = false
                    clear()
                }
            }
        }
        return pending.size < 3
    }

    fun submitted() {
        if (!available) return
        pending.addLast(engine.createFence())
        engine.flush()
    }

    fun clear() {
        while (pending.isNotEmpty()) engine.destroyFence(pending.removeFirst())
    }
}
