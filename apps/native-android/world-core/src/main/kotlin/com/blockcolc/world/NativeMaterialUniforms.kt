package com.blockcolc.world

/** Shared mat4 layout: sky gradient / celestial position keep xyz columns;
 * unused w channels carry direct colour policy and exposure. No new material
 * parameter, source geometry identity or per-frame upload is introduced. */
object NativeMaterialUniforms {
    fun pack(role:NativeSkyRole?,sky:NativeSkyState?,exposure:Float,direct:Boolean,toneMapped:Boolean):FloatArray {
        require(exposure.isFinite()&&exposure in .01f..100f)
        val data=FloatArray(16)
        if(role==NativeSkyRole.DOME){val gradient=checkNotNull(sky).gradient
            for((column,color)in listOf(gradient.horizon,gradient.zenith,gradient.lower).withIndex()){
                data[column*4]=color.red;data[column*4+1]=color.green;data[column*4+2]=color.blue
            };data[3]=1f
        }else if(role!=null)data[3]=2f
        val direction=when(role){NativeSkyRole.SUN->checkNotNull(sky).sunDirection;NativeSkyRole.MOON->checkNotNull(sky).moonDirection;else->null}
        val radius=NativeSky.RADIUS*NativeSky.CELESTIAL_RATIO
        data[12]=((direction?.x?:0.0)*radius).toFloat();data[13]=((direction?.y?:0.0)*radius).toFloat();data[14]=((direction?.z?:0.0)*radius).toFloat()
        data[7]=exposure;data[11]=if(!direct)0f else if(toneMapped)1f else 2f
        return data
    }
}
