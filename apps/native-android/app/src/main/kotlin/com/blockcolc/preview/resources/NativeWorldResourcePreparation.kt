package com.blockcolc.preview.resources

import com.blockcolc.world.NativeResourceWorldAssets
import com.blockcolc.world.resource.ResourceAtlasLimits
import com.blockcolc.world.resource.ResourceLibraryLease
import java.util.concurrent.CancellationException

/** Entirely generation-thread owned. Never creates GPU objects or writes a
 * preference. A rejected candidate leaves the prior prepared assets usable. */
internal class NativeWorldResourcePreparation(private val controller:NativeResourceController,private val selectedIds:Set<String>?=null):AutoCloseable{
    private var key:ResourceWorldSelection?=null
    private var lease:ResourceLibraryLease?=null
    private var assets:NativeResourceWorldAssets?=null
    fun prepare(selection:ResourceWorldSelection?,cancelled:()->Boolean):NativeResourceWorldAssets?{
        if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Resource preparation superseded")
        if(selection==null||selection.unavailable||selection.activeId==null&&selection.baseId==null){close();key=selection;return null}
        if(key==selection)return assets
        var candidate:ResourceLibraryLease?=null
        try{
            val opened=controller.openForWorld(selection,cancelled);candidate=opened
            val memory=assets?.textures?.atlas?.memoryEstimate
            val reserved=if(memory==null)0 else memory.getValue("estimatedGpuBytes")+memory.getValue("pageRgbaBytes")*2+memory.getValue("mipmapRgbaBytes")+checkNotNull(assets).terrain.estimatedResidentBytes
            val next=NativeResourceWorldAssets.prepare(checkNotNull(opened.stack),selectedIds=selectedIds,limits=ResourceAtlasLimits(reservedAtlasBytes=reserved),cancelled=cancelled)
            if(cancelled()||Thread.currentThread().isInterrupted)throw CancellationException("Resource preparation superseded")
            lease?.close();lease=opened;assets=next;key=selection;if(selectedIds==null)controller.worldReady(selection);return next
        }catch(error:Exception){candidate?.close();if(error !is CancellationException&&selectedIds==null)controller.worldFailure(selection,error);throw error}
    }
    override fun close(){lease?.close();lease=null;assets=null;key=null}
}
