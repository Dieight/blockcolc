package com.blockcolc.world

import com.blockcolc.world.generation.*
import java.nio.FloatBuffer
import java.util.Collections
import kotlin.math.*

/** Display data only. The presentation layer admits earned items and validates
 * their slots before passing this small immutable description to the worker. */
data class NativeInteriorItem(val id:String,val x:Double,val y:Double,val z:Double,val wall:Boolean=false,val quarterTurns:Int=0){
    init{require(id.length in 1..64&&listOf(x,y,z).all{it.isFinite()&&abs(it)<=5}&&quarterTurns in 0..3)}
}
data class NativeInteriorPose(val eye:BlockPoint,val pitch:Double,val fov:Double=55.0,val sceneDistance:Double=1.0)
class NativeInteriorScene(val source:NativePacketSource,val pose:NativeInteriorPose,val items:List<NativeInteriorItem>,val lamp:BlockPoint,val blocks:List<RenderVoxel>){
    init{require(source.owner==PacketOwners.INTERIOR)}
}

/** One bounded owner in the existing engine and scene. No world planning,
 * blueprint decoding, database access, second camera renderer, or screenshot. */
class NativeInteriorCompiler {
    private val materials=NativeOriginalMaterials()
    private val cube=CuboidGeometry.create()
    private val wood=NativeRenderMaterial(color=LinearRgb.fromSrgb(0x785135),texture=materials.pattern(OriginalPattern.PLANKS),
        emission=LinearRgb.fromSrgb(0x48301c),emissionStrength=.24f,fog=false)
    private val trim=wood.copy(color=LinearRgb.fromSrgb(0x3d3025),texture=materials.pattern(OriginalPattern.BARK))
    private val brass=NativeRenderMaterial(color=LinearRgb.fromSrgb(0xa98043),metalness=.45f,roughness=.5f,fog=false)
    private val light=NativeRenderMaterial(color=LinearRgb.fromSrgb(0xffe8ac),emission=LinearRgb.fromSrgb(0xffc56b),emissionStrength=2.5f,fog=false)
    private fun colour(hex:Int,pattern:OriginalPattern=OriginalPattern.SMOOTH)=NativeRenderMaterial(color=LinearRgb.fromSrgb(hex),texture=materials.pattern(pattern),
        emission=LinearRgb.fromSrgb(hex),emissionStrength=.10f,fog=false)
    fun prepare(camera:NativeSceneCamera,targets:List<NativeOrbitTarget>,items:List<NativeInteriorItem>,resources:NativeResourceWorldAssets?=null,cancelled:()->Boolean={false},aspect:Double=camera.aspect):NativeInteriorScene {
        require(items.size<=20&&items.map{it.id}.distinct().size==items.size)
        require(aspect.isFinite()&&aspect>0)
        // Distant rewards need not make the desk retreat from the whole town.
        // Frame the actual buildings using the currently visible window.
        val buildings=targets.filterNot{it.id.startsWith("reward:")}.ifEmpty{targets}
        val minX=buildings.minOfOrNull{it.position.x-it.width/2}?:camera.target.x-12
        val maxX=buildings.maxOfOrNull{it.position.x+it.width/2}?:camera.target.x+12
        val minZ=buildings.minOfOrNull{it.position.z-it.depth/2}?:camera.target.z-12
        val maxZ=buildings.maxOfOrNull{it.position.z+it.depth/2}?:camera.target.z+12
        val top=buildings.maxOfOrNull{it.position.y+it.height}?:8.0
        val target=BlockPoint((minX+maxX)/2,max(2.0,top*.35),(minZ+maxZ)/2)
        val width=max(16.0,maxX-minX);val depth=max(16.0,maxZ-minZ)
        val halfHorizontal=atan(tan(55*PI/360)*aspect).coerceIn(11*PI/180,40*PI/180)
        val distance=max(width/(2*tan(halfHorizontal*.92)),depth*1.1)+depth*.35
        // The eye remains at a natural desk height. A steeper ray hit the
        // opaque window sill, hiding the town behind the desk.
        val pitch=2*PI/180
        val eye=BlockPoint(target.x,target.y+distance*tan(pitch),target.z+distance)
        val origin=BlockPoint(eye.x,eye.y-NativeInteriorBlocks.EYE_HEIGHT,eye.z-NativeInteriorBlocks.VIEW_Z)
        val rows=LinkedHashMap<NativeRenderMaterial,MutableList<BlockTransform>>()
        var objectTransform=BlockTransform.IDENTITY
        fun box(x:Double,y:Double,z:Double,w:Double,h:Double,d:Double,m:NativeRenderMaterial){
            require(w>0&&h>0&&d>0)
            val scale=BlockTransform.fromElements(doubleArrayOf(w,0.0,0.0,0.0,0.0,h,0.0,0.0,0.0,0.0,d,0.0,0.0,0.0,0.0,1.0))
            rows.getOrPut(m){ArrayList()}+=BlockTransform.translation(origin.x,origin.y,origin.z)*objectTransform*BlockTransform.translation(x,y,z)*scale
        }
        val blocks=NativeInteriorBlocks.layout(items)
        val recipe=BuildingPreparation.staticStructure(blocks,"study-blocks-v4",cancelled=cancelled)
        val builder=NativePacketBuilder(PacketOwners.INTERIOR)
        val placement=NativeStructurePlacement(origin);val state=NativeSurfaceState(ambientOcclusion=.3f)
        val compiler=OriginalStructureCompiler()
        if(resources==null)NativeOriginalPackets(materials).append(builder,compiler.compile(recipe,cancelled=cancelled),placement,state,cancelled=cancelled,fog=false)
        else {
            val pack=NativeResourceStructureCompiler(resources.stack,resources.textures,resources.palette,specials=resources.specials)
            val resolved=pack.compile(recipe,cancelled=cancelled)
            NativeResourcePackets(resources.textures).append(builder,PacketOwners.INTERIOR,resolved,placement,state,cancelled=cancelled,fog=false)
            NativeOriginalPackets(materials).append(builder,compiler.compile(recipe,cancelled=cancelled,excludedMembers=resolved.acceptedMembers),placement,state,cancelled=cancelled,fog=false)
        }
        // Small earned ornaments use their own miniature geometry; architectural
        // blocks, window, desk, chair and two-part bed use normal block routing.
        fun books(x:Double,y:Double,z:Double,n:Int=5){
            val colours=listOf(0x587756,0x963f38,0xa99455,0x5c6e91,0xd7c4a0)
            repeat(n){i->box(x-.35+i*.16,y+.24,z,.12,.38+(i%3)*.06,.37,colour(colours[i%5]))}
        }
        fun miniature(x:Double,y:Double,z:Double,town:Boolean){
            box(x,y+.04,z,.72,.08,.65,colour(0x6d8857))
            repeat(if(town)3 else 1){i->val xx=x+(i-1)*.2
                box(xx,y+.22,z+(i%2)*.16,.2,.28,.24,wood);box(xx,y+.39,z+(i%2)*.16,.26,.09,.3,colour(0x98523a))
                box(xx,y+.22,z-.128+(i%2)*.16,.07,.1,.018,light)}
        }
        for(item in items){val x=item.x;val y=item.y;val z=item.z
            objectTransform=BlockTransform.translation(x,y,z)*BlockTransform.rotationY(item.quarterTurns*PI/2)*BlockTransform.translation(-x,-y,-z)
            when(item.id){
                "bed"->Unit // already routed with its two source blocks above
                "bookcase"->{box(x,y+1.6,z+.4,2.7,3.2,.15,wood);for(xx in listOf(-1.35,1.35))box(x+xx,y+1.6,z,.12,3.2,1.0,wood);for(level in 0..3)box(x,y+level,z,2.8,.12,1.0,wood)}
                "plant"->{box(x,y+.16,z,.4,.3,.4,colour(0xa86242));box(x,y+.43,z,.08,.3,.08,colour(0x426b3c));for(i in 0..3)box(x+cos(i*PI/2)*.16,y+.58+(i%2)*.1,z+sin(i*PI/2)*.16,.27,.16,.22,colour(0x608b50))}
                "clock","calendar","map","travel-frame"->{
                    val side=abs(x)>3.5;val w=if(item.id=="map")1.5 else .7;val h=if(item.id=="map")1.0 else .8
                    box(x,y+h/2,z,if(side).08 else w,h,if(side)w else .08,trim)
                    box(x+(if(side)if(x<0).05 else -.05 else 0.0),y+h/2,z+(if(side)0.0 else -.05),if(side).02 else w-.1,h-.1,if(side)w-.1 else .02,colour(if(item.id=="map")0x879c70 else 0xe6ddc0))
                    if(!side)box(x,y+h*.55,z-.07,.08,h*.35,.02,colour(0x344b38))
                }
                "reading-chair","armchair"->for(part in if(item.id=="reading-chair")OriginalChairs.reading else OriginalChairs.upholstered){
                    box(x+part.x,y+part.y,z+part.z,part.width,part.height,part.depth,colour(part.colour,part.pattern))
                }
                "cabinet"->{box(x,y+.5,z,1.5,1.0,1.0,wood);for(xx in listOf(-.37,.37)){box(x+xx,y+.5,z-.52,.68,.9,.06,trim);box(x+xx,y+.5,z-.57,.07,.07,.04,brass)}}
                "floor-lamp"->{box(x,y+.08,z,.5,.15,.5,brass);box(x,y+.9,z,.07,1.65,.07,brass);box(x,y+1.8,z,.5,.35,.5,light)}
                "mug"->{box(x,y+.18,z,.28,.35,.28,colour(0xddddc7));box(x+.19,y+.2,z,.12,.22,.13,brass)}
                "globe"->{box(x,y+.06,z,.45,.1,.4,trim);box(x,y+.22,z,.07,.28,.07,brass);box(x,y+.49,z,.46,.46,.46,colour(0x517f9b));box(x+.08,y+.54,z-.25,.2,.2,.02,colour(0x709257))}
                "record-player"->{box(x,y+.12,z,.8,.22,.58,wood);box(x-.1,y+.26,z,.36,.05,.36,colour(0x28392e));box(x+.22,y+.3,z,.05,.08,.45,brass)}
                "books"->books(x,y,z)
                "goal-trophy"->{box(x,y+.07,z,.4,.14,.4,trim);box(x,y+.27,z,.1,.3,.1,brass);box(x,y+.5,z,.34,.25,.3,brass)}
                "windmill-miniature"->{miniature(x,y,z,false);box(x,y+.51,z-.2,.5,.055,.045,colour(0xe4dbc4));box(x,y+.51,z-.2,.055,.5,.045,colour(0xe4dbc4))}
                "workshop-miniature","settlement-miniature","town-miniature"->miniature(x,y,z,item.id!="workshop-miniature")
                else->error("Unsupported room furnishing ${item.id}")
            }
        }
        for((material,transforms) in rows){val data=FloatArray(transforms.size*16);transforms.forEachIndexed{i,m->repeat(16){data[i*16+it]=m[it].toFloat()}}
            builder.add(cube,material,FloatBuffer.wrap(data),castShadow=!material.transparent,receiveShadow=true,priority=if(material.transparent)5 else 4)}
        return NativeInteriorScene(builder.build(),NativeInteriorPose(eye,pitch,sceneDistance=distance/cos(pitch)),Collections.unmodifiableList(items.toList()),BlockPoint(origin.x+2.35,origin.y+1.4,origin.z-3.35),blocks)
    }
    companion object {private val absent by lazy{NativePacketBuilder(PacketOwners.INTERIOR).build()};fun empty()=absent}
}
