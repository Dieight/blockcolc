package com.blockcolc.world.generation

import java.math.BigDecimal
import java.math.RoundingMode
import java.util.Collections
import java.util.Locale
import kotlin.math.*

sealed interface OriginalBlockState {
    data object Absent:OriginalBlockState
    data object Invalid:OriginalBlockState
    class Values(properties:Map<String,String>):OriginalBlockState {
        val properties:Map<String,String> = Collections.unmodifiableMap(LinkedHashMap(properties))
    }
}

enum class OriginalShapeFallback(val wireValue:String) {
    MISSING("missing-source"),NAMESPACE("unknown-namespace"),UNSUPPORTED("unsupported-block"),STATE("invalid-state"),BUDGET("budget-exceeded")
}

private val fullOriginalCell=BlockBox(BlockPoint(-.5,-.5,-.5),BlockPoint(.5,.5,.5))
private fun shapeBounds(boxes:List<BlockBox>):BlockBox {
    if(boxes.isEmpty())return fullOriginalCell
    fun low(axis:Int):Double {var n=Double.POSITIVE_INFINITY;for(b in boxes)n=min(n,b.min[axis]);return n}
    fun high(axis:Int):Double {var n=Double.NEGATIVE_INFINITY;for(b in boxes)n=max(n,b.max[axis]);return n}
    return BlockBox(BlockPoint(low(0),low(1),low(2)),BlockPoint(high(0),high(1),high(2)))
}

class OriginalShapeComponent internal constructor(val key:String,val topologyKey:String,boxes:List<BlockBox>,val transform:BlockTransform=BlockTransform.IDENTITY) {
    val boxes:List<BlockBox> = Collections.unmodifiableList(boxes.toList())
    val bounds=shapeBounds(this.boxes.map(transform::box))
}

class OriginalBlockShape internal constructor(val sourceBlockId:String?,val family:OriginalShapeFamily?,val reason:OriginalShapeFallback?,val topologyKey:String,
    boxes:List<BlockBox>,components:List<OriginalShapeComponent>?=null) {
    val boxes:List<BlockBox> = Collections.unmodifiableList(boxes.toList())
    val components:List<OriginalShapeComponent>?=components?.let{Collections.unmodifiableList(it.toList())}
    val bounds=shapeBounds(this.boxes)
    val volume=BigDecimal(this.boxes.sumOf{(it.max.x-it.min.x)*(it.max.y-it.min.y)*(it.max.z-it.min.z)}).setScale(6,RoundingMode.HALF_UP).toDouble()
    init {require((family==null)==(reason!=null))}
    fun renderComponents():List<OriginalShapeComponent> = if(family==null)emptyList()else components?:listOf(OriginalShapeComponent(family.wireValue,topologyKey,boxes))
}

/** The formal original-material fallback, expressed as native algorithms.
 * Exact registry membership precedes state validation; suffix guesses are not
 * enough to claim support for an imported/unknown block. No model enumeration
 * is embedded. Component geometry and state-dependent transforms stay apart. */
class OriginalBlockShapes(private val registry:OriginalShapeRegistry=OriginalShapeRegistry.bundled) {
    private val directions=listOf("north","east","south","west")
    private val booleans=setOf("true","false")
    private fun words(value:String)=value.split(' ').toSet()
    private val required=mapOf(
        OriginalShapeFamily.CARPET to emptySet(),OriginalShapeFamily.PALE_MOSS to words("bottom east north south west"),
        OriginalShapeFamily.LEVER to words("face facing powered"),OriginalShapeFamily.LANTERN to words("hanging waterlogged"),
        OriginalShapeFamily.CANDLE to words("candles lit waterlogged"),OriginalShapeFamily.BED to words("facing occupied part"),
        OriginalShapeFamily.SIGN to words("rotation waterlogged"),OriginalShapeFamily.WALL_SIGN to words("facing waterlogged"),
        OriginalShapeFamily.HANGING_SIGN to words("attached rotation waterlogged"),OriginalShapeFamily.WALL_HANGING_SIGN to words("facing waterlogged"),
        OriginalShapeFamily.STAIRS to words("facing half shape"),OriginalShapeFamily.SLAB to words("type"),OriginalShapeFamily.FENCE to directions.toSet(),
        OriginalShapeFamily.WALL to words("up north east south west"),OriginalShapeFamily.PANE to directions.toSet(),OriginalShapeFamily.IRON_BARS to directions.toSet(),
        OriginalShapeFamily.DOOR to words("facing open hinge half"),OriginalShapeFamily.TRAPDOOR to words("facing open half"),OriginalShapeFamily.LADDER to words("facing"),
        OriginalShapeFamily.FENCE_GATE to words("facing in_wall open powered"),OriginalShapeFamily.BUTTON to words("face facing powered"),
        OriginalShapeFamily.PRESSURE_PLATE to words("powered"),OriginalShapeFamily.WEIGHTED_PLATE to words("power"))
    private val optional=mapOf(
        OriginalShapeFamily.STAIRS to words("waterlogged"),OriginalShapeFamily.SLAB to words("waterlogged"),OriginalShapeFamily.FENCE to words("waterlogged"),
        OriginalShapeFamily.WALL to words("waterlogged"),OriginalShapeFamily.PANE to words("waterlogged"),OriginalShapeFamily.IRON_BARS to words("waterlogged"),
        OriginalShapeFamily.DOOR to words("powered"),OriginalShapeFamily.TRAPDOOR to words("powered waterlogged"),OriginalShapeFamily.LADDER to words("waterlogged"))
    private val strict=OriginalShapeFamily.entries.toSet()-setOf(OriginalShapeFamily.STAIRS,OriginalShapeFamily.SLAB,OriginalShapeFamily.FENCE,OriginalShapeFamily.WALL,
        OriginalShapeFamily.PANE,OriginalShapeFamily.IRON_BARS,OriginalShapeFamily.DOOR,OriginalShapeFamily.TRAPDOOR,OriginalShapeFamily.LADDER)
    private fun lower(s:String)=s.lowercase(Locale.ROOT)
    private fun normalizedId(source:String?):String? {
        val raw=source?.let(SourceNumbers::trim)?.let(::lower)?.takeIf{it.isNotEmpty()}?:return null
        return if(':' in raw)raw else "minecraft:$raw"
    }
    fun isCandidate(sourceBlockId:String?):Boolean {
        val id=normalizedId(sourceBlockId)?:return false
        return id.startsWith("minecraft:")&&registry.family(id.removePrefix("minecraft:"))!=null
    }
    fun plan(voxel:RenderVoxel)=plan(voxel.sourceBlockId,voxel.sourceBlockState?.let{OriginalBlockState.Values(it)}?:OriginalBlockState.Absent)
    fun plan(sourceBlockId:String?,raw:OriginalBlockState=OriginalBlockState.Absent):OriginalBlockShape {
        val id=normalizedId(sourceBlockId)?:return fallback(null,OriginalShapeFallback.MISSING)
        if(!id.startsWith("minecraft:"))return fallback(id,OriginalShapeFallback.NAMESPACE)
        val path=id.removePrefix("minecraft:");val family=registry.family(path)?:return fallback(id,OriginalShapeFallback.UNSUPPORTED)
        val input=(raw as? OriginalBlockState.Values)?.properties
        if(input==null&&!(family==OriginalShapeFamily.CARPET&&raw==OriginalBlockState.Absent))return fallback(id,OriginalShapeFallback.STATE)
        if(family in strict&&input!=null&&input.any{(k,v)->k!=lower(k)||v!=lower(v)})return fallback(id,OriginalShapeFallback.STATE)
        val state=LinkedHashMap<String,String>()
        for((k,v)in input.orEmpty().entries.map{lower(it.key) to lower(it.value)}.sortedBy{it.first})state[k]=v
        if(!valid(family,state))return fallback(id,OriginalShapeFallback.STATE)
        val components=components(family,path,state)
        val boxes=components?.flatMap{c->c.boxes.map(c.transform::box)}?:boxes(family,state)
        val topology=if(components!=null)"${family.wireValue}:components"else"${family.wireValue}:${normalizedState(family,state)}"
        return OriginalBlockShape(id,family,null,topology,boxes,components)
    }
    internal fun fallback(id:String?,reason:OriginalShapeFallback)=OriginalBlockShape(id,null,reason,"cube:fallback",listOf(fullOriginalCell))
    private fun valid(f:OriginalShapeFamily,s:Map<String,String>):Boolean {
        val need=required.getValue(f);val extra=optional[f].orEmpty()
        if(s.keys.any{it !in need&&it !in extra}||need.any{it !in s}||extra.any{it in s&&s[it] !in booleans})return false
        if("facing" in s&&s["facing"] !in directions)return false
        fun one(key:String,vararg values:String)=s[key] in values
        fun bool(key:String)=s[key] in booleans
        return when(f) {
            OriginalShapeFamily.CARPET->s.isEmpty()
            OriginalShapeFamily.PALE_MOSS->bool("bottom")&&directions.all{s[it] in setOf("none","low","tall")}
            OriginalShapeFamily.STAIRS->one("half","bottom","top")&&one("shape","straight","inner_left","inner_right","outer_left","outer_right")
            OriginalShapeFamily.SLAB->one("type","bottom","top","double")
            OriginalShapeFamily.WALL->bool("up")&&directions.all{s[it] in setOf("none","low","tall")}
            OriginalShapeFamily.FENCE,OriginalShapeFamily.PANE,OriginalShapeFamily.IRON_BARS->directions.all{bool(it)}
            OriginalShapeFamily.DOOR->bool("open")&&one("hinge","left","right")&&one("half","upper","lower")
            OriginalShapeFamily.TRAPDOOR->bool("open")&&one("half","top","bottom")
            OriginalShapeFamily.LADDER->true
            OriginalShapeFamily.FENCE_GATE->bool("in_wall")&&bool("open")&&bool("powered")
            OriginalShapeFamily.BUTTON,OriginalShapeFamily.LEVER->one("face","floor","wall","ceiling")&&bool("powered")
            OriginalShapeFamily.LANTERN->bool("hanging")&&bool("waterlogged")
            OriginalShapeFamily.CANDLE->s.getValue("candles").matches(Regex("[1-4]"))&&bool("lit")&&bool("waterlogged")
            OriginalShapeFamily.BED->bool("occupied")&&one("part","head","foot")
            OriginalShapeFamily.SIGN,OriginalShapeFamily.HANGING_SIGN->bool("waterlogged")&&s.getValue("rotation").matches(Regex("(?:[0-9]|1[0-5])"))&&(f!=OriginalShapeFamily.HANGING_SIGN||bool("attached"))
            OriginalShapeFamily.WALL_SIGN,OriginalShapeFamily.WALL_HANGING_SIGN->bool("waterlogged")
            OriginalShapeFamily.PRESSURE_PLATE->bool("powered")
            OriginalShapeFamily.WEIGHTED_PLATE->s.getValue("power").matches(Regex("(?:0|[1-9]|1[0-5])"))
        }
    }
    private fun normalizedState(f:OriginalShapeFamily,s:Map<String,String>):String {
        fun connections()=directions.joinToString(","){"$it=${s[it]}"}
        return when(f) {
            OriginalShapeFamily.STAIRS->"${s["facing"]}|${s["half"]}|${s["shape"]}"
            OriginalShapeFamily.SLAB->s.getValue("type")
            OriginalShapeFamily.DOOR->"${s["facing"]}|${s["open"]}|${if(s["open"]=="true")s["hinge"]else"closed"}|${s["half"]}"
            OriginalShapeFamily.TRAPDOOR->if(s["open"]=="true")"${s["facing"]}|open|${s["half"]}"else"closed|${s["half"]}"
            OriginalShapeFamily.LADDER->s.getValue("facing")
            OriginalShapeFamily.FENCE_GATE->"${s["facing"]}|${s["open"]}|${s["in_wall"]}"
            OriginalShapeFamily.BUTTON->"${s["face"]}|${s["facing"]}|${s["powered"]}"
            OriginalShapeFamily.PRESSURE_PLATE->s.getValue("powered")
            OriginalShapeFamily.WEIGHTED_PLATE->if(s["power"]=="0")"unpressed"else"pressed"
            OriginalShapeFamily.WALL->"up=${s["up"]}|${connections()}"
            else->connections()
        }
    }
    private fun b(x0:Number,y0:Number,z0:Number,x1:Number,y1:Number,z1:Number)=BlockBox(BlockPoint(x0.toDouble()/16-.5,y0.toDouble()/16-.5,z0.toDouble()/16-.5),BlockPoint(x1.toDouble()/16-.5,y1.toDouble()/16-.5,z1.toDouble()/16-.5))
    private fun rotate(box:BlockBox,facing:String):BlockBox {
        val turns=directions.indexOf(facing);val points=ArrayList<BlockPoint>(8)
        for(x in listOf(box.min.x,box.max.x))for(y in listOf(box.min.y,box.max.y))for(z in listOf(box.min.z,box.max.z)) {
            var xx=x;var zz=z;repeat(turns){val previous=xx;xx= -zz;zz=previous};points+=BlockPoint(xx,y,zz)
        }
        fun low(axis:Int):Double {var n=Double.POSITIVE_INFINITY;for(p in points)n=min(n,p[axis]);return n}
        fun high(axis:Int):Double {var n=Double.NEGATIVE_INFINITY;for(p in points)n=max(n,p[axis]);return n}
        return BlockBox(BlockPoint(low(0),low(1),low(2)),BlockPoint(high(0),high(1),high(2)))
    }
    private fun stairs(s:Map<String,String>):List<BlockBox> {
        val facing=s.getValue("facing");val bottom=s["half"]=="bottom";val shape=s.getValue("shape")
        val result=arrayListOf(if(bottom)b(0,0,0,16,8,16)else b(0,8,0,16,16,16))
        val high=if(facing=="north"||facing=="west")0 else 1;val rowX=facing=="west"||facing=="east"
        val sign=if(facing=="north"||facing=="west")-1 else 1;val left=if(facing=="north"||facing=="east")-1 else 1
        val cells=ArrayList<Pair<Int,Int>>()
        if(!shape.startsWith("outer")){cells+=high to 0;cells+=high to 1}
        if(shape.startsWith("inner"))cells+=(1-high) to if(shape.endsWith("left")== (left<0))0 else 1
        else if(shape.startsWith("outer"))cells+=high to if(shape.endsWith("left")== (left<0))0 else 1
        for((row,column)in cells) {
            val along=if(row==high)if(sign<0)0 else 8 else if(sign<0)8 else 0;val across=if(column==0)0 else 8
            val x=if(rowX)along else across;val z=if(rowX)across else along
            result+=if(bottom)b(x,8,z,x+8,16,z+8)else b(x,0,z,x+8,8,z+8)
        };return result
    }
    private fun cross(s:Map<String,String>,width:Int,height:Int,y0:Int,y1:Int):List<BlockBox> {
        val inset=(16-width)/2;val result=arrayListOf(b(inset,0,inset,inset+width,height,inset+width))
        for(side in directions)if(s[side]=="true")result+=when(side){
            "north"->b(inset,y0,0,inset+width,y1,inset);"south"->b(inset,y0,inset+width,inset+width,y1,16)
            "west"->b(0,y0,inset,inset,y1,inset+width);else->b(inset+width,y0,inset,16,y1,inset+width)
        };return result
    }
    private fun wall(s:Map<String,String>):List<BlockBox> {
        val connected=directions.filter{s[it]!="none"};val height=if(s["up"]=="true"||connected.any{s[it]=="tall"})16 else 12
        val result=arrayListOf(b(4,0,4,12,height,12))
        for(side in connected) {val top=if(s[side]=="tall")16 else 12
            result+=when(side){"north"->b(5,0,0,11,top,4);"south"->b(5,0,12,11,top,16);"west"->b(0,0,5,4,top,11);else->b(12,0,5,16,top,11)}
        };return result
    }
    private fun gate(s:Map<String,String>):List<BlockBox> {
        val top=if(s["in_wall"]=="true")12 else 16;val boxes=ArrayList<BlockBox>()
        if(s["open"]=="false") {
            for((x0,x1)in listOf(0 to 2,6 to 7,9 to 10,14 to 16))boxes+=b(x0,0,7,x1,top,9)
            for((x0,x1)in listOf(2 to 6,10 to 14)){boxes+=b(x0,2,7,x1,4,9);boxes+=b(x0,top-2,7,x1,top,9)}
        }else for((x0,x1)in listOf(0 to 2,14 to 16)) {
            boxes+=b(x0,0,0,x1,top,2);boxes+=b(x0,0,6,x1,top,8);boxes+=b(x0,2,2,x1,4,6);boxes+=b(x0,top-2,2,x1,top,6)
        }
        return boxes.map{rotate(it,s.getValue("facing"))}
    }
    private fun boxes(f:OriginalShapeFamily,s:Map<String,String>):List<BlockBox> = when(f) {
        OriginalShapeFamily.CARPET->listOf(b(.25,.03125,.25,15.75,1.03125,15.75))
        OriginalShapeFamily.STAIRS->stairs(s)
        OriginalShapeFamily.SLAB->listOf(when(s["type"]){"bottom"->b(0,0,0,16,8,16);"top"->b(0,8,0,16,16,16);else->fullOriginalCell})
        OriginalShapeFamily.FENCE->cross(s,4,14,4,11)
        OriginalShapeFamily.WALL->wall(s)
        OriginalShapeFamily.PANE->cross(s,2,16,0,16)
        OriginalShapeFamily.IRON_BARS->cross(s,4,16,0,16)
        OriginalShapeFamily.DOOR->listOf(rotate(if(s["open"]=="false")b(0,0,0,16,16,2)else if(s["hinge"]=="left")b(0,0,0,2,16,16)else b(14,0,0,16,16,16),s.getValue("facing")))
        OriginalShapeFamily.TRAPDOOR->if(s["open"]=="false"){val y=if(s["half"]=="bottom")0 else 14;listOf(b(0,y,0,16,y+2,16))}else listOf(rotate(b(0,0,0,16,16,2),s.getValue("facing")))
        OriginalShapeFamily.LADDER->listOf(rotate(b(2,0,0,14,16,2),s.getValue("facing")))
        OriginalShapeFamily.FENCE_GATE->gate(s)
        OriginalShapeFamily.BUTTON->{val height=if(s["powered"]=="true")2 else 3;listOf(rotate(when(s["face"]){"floor"->b(5,0,3,11,height,11);"ceiling"->b(5,16-height,3,11,16,11);else->b(5,5,16-height,11,11,16)},s.getValue("facing")))}
        OriginalShapeFamily.PRESSURE_PLATE,OriginalShapeFamily.WEIGHTED_PLATE->listOf(b(1,0,1,15,if(if(f==OriginalShapeFamily.PRESSURE_PLATE)s["powered"]=="true"else s["power"]!="0")1 else 2,15))
        else->emptyList()
    }
    private fun component(key:String,topology:String,boxes:List<BlockBox>,transform:BlockTransform=BlockTransform.IDENTITY)=OriginalShapeComponent(key,topology,boxes,transform)
    private fun yaw(facing:String)=when(facing){"north"->0.0;"east"->-PI/2;"south"->PI;else->PI/2}
    private fun components(f:OriginalShapeFamily,path:String,s:Map<String,String>):List<OriginalShapeComponent>? {
        if(f==OriginalShapeFamily.CARPET)return listOf(component("carpet","carpet:thin-surface",boxes(f,s)))
        if(f in setOf(OriginalShapeFamily.SIGN,OriginalShapeFamily.WALL_SIGN,OriginalShapeFamily.HANGING_SIGN,OriginalShapeFamily.WALL_HANGING_SIGN)) {
            val standing=f==OriginalShapeFamily.SIGN;val hanging=f==OriginalShapeFamily.HANGING_SIGN||f==OriginalShapeFamily.WALL_HANGING_SIGN
            val wallHanging=f==OriginalShapeFamily.WALL_HANGING_SIGN;val name=f.wireValue
            val board=if(standing)b(0,9.333,7.333,16,17.333,8.667)else if(hanging)b(1,0,7,15,10,9)else b(0,4.333,.333,16,12.333,1.667)
            val support=if(standing)listOf(b(7.333,0,7.333,8.667,9.333,8.667))else if(wallHanging)listOf(b(0,14,6,16,16,10),b(1,10,7.5,2,14,8.5),b(14,10,7.5,15,14,8.5))
                else if(f==OriginalShapeFamily.HANGING_SIGN)if(s["attached"]=="true")listOf(b(2,10,7.6,14,16,8.4))else listOf(b(2,10,7.5,3,16,8.5),b(13,10,7.5,14,16,8.5),b(2,14.5,7.5,5,15.5,8.5),b(11,14.5,7.5,14,15.5,8.5))else emptyList()
            val angle=if(f==OriginalShapeFamily.SIGN||f==OriginalShapeFamily.HANGING_SIGN)s.getValue("rotation").toInt()*PI/8 else when(s["facing"]){"south"->0.0;"north"->PI;"east"->-PI/2;else->PI/2}
            val transform=BlockTransform.rotationY(angle)
            return listOf(component("$name-board","$name:board",listOf(board),transform))+
                if(support.isEmpty())emptyList()else listOf(component("$name-support","$name:support:${s["attached"]?:"fixed"}",support,transform))
        }
        if(f==OriginalShapeFamily.PALE_MOSS) {
            val isolated=s["bottom"]=="false"&&directions.all{s[it]=="none"};val result=ArrayList<OriginalShapeComponent>()
            if(s["bottom"]=="true"||isolated)result+=component("pale-moss-base","pale-moss:base",listOf(b(.25,.03125,.25,15.75,1.03125,15.75)))
            for((index,side)in directions.withIndex()) {
                val height=if(isolated)"tall"else s[side];if(height=="none")continue
                val heights=if(height=="low")listOf(7,9,10,8)else listOf(14,16,15,13)
                val tufts=heights.mapIndexed{tuft,top->b(.5+tuft*4,0,0,3.5+tuft*4,top,.25)}
                result+=component("pale-moss-$side-$height","pale-moss:side:$height",tufts,BlockTransform.rotationY(listOf(0.0,-PI/2,PI,PI/2)[index]))
            };return result
        }
        if(f==OriginalShapeFamily.LEVER) {
            val face=s["face"];val orientation=BlockTransform.rotationY(yaw(s.getValue("facing"))+if(face=="ceiling")PI else 0.0)*BlockTransform.rotationX(when(face){"wall"->-PI/2;"ceiling"->PI;else->0.0})
            val rod=orientation*BlockTransform.translation(0.0,-.375,0.0)*BlockTransform.rotationX(if(s["powered"]=="true")PI/4 else -PI/4)*BlockTransform.translation(0.0,.18,0.0)
            return listOf(component("lever-base","lever:stone-base",listOf(b(5,0,5,11,2,11)),orientation),component("lever-handle","lever:handle",listOf(b(7,5,7,9,11,9)),rod))
        }
        if(f==OriginalShapeFamily.LANTERN) {
            val hanging=s["hanging"]=="true";val low=if(hanging)3 else 0;val high=if(hanging)12 else 9
            val frame=listOf(b(4,low,4,5,high,5),b(11,low,4,12,high,5),b(4,low,11,5,high,12),b(11,low,11,12,high,12),b(4,low,4,12,low+1,12),b(4,high-1,4,12,high,12),if(hanging)b(7,12,7,9,16,9)else b(7,9,7,9,11,9))
            val shade=if(path=="soul_lantern")"soul"else"warm"
            return listOf(component("lantern-frame","lantern:frame:${if(hanging)"hanging"else"standing"}",frame),component("lantern-core-$shade","lantern:core:$shade",listOf(b(5,1,5,11,7,11)),if(hanging)BlockTransform.translation(0.0,3/16.0,0.0)else BlockTransform.IDENTITY))
        }
        if(f==OriginalShapeFamily.CANDLE) {
            val bodies=when(s["candles"]){"1"->listOf(listOf(7,0,7,9,6,9));"2"->listOf(listOf(5,0,7,7,5,9),listOf(9,0,6,11,6,8));"3"->listOf(listOf(7,0,9,9,3,11),listOf(5,0,7,7,5,9),listOf(8,0,6,10,6,8));else->listOf(listOf(6,0,8,8,3,10),listOf(9,0,8,11,5,10),listOf(5,0,5,7,5,7),listOf(8,0,5,10,6,7))}
            val wax=bodies.map{b(it[0],it[1],it[2],it[3],it[4],it[5])}
            val wicks=bodies.map{val x=(it[0]+it[3])/2.0;val z=(it[2]+it[5])/2.0;b(x-.3,it[4],z-.3,x+.3,it[4]+.9,z+.3)}
            return listOf(component("candle-wax","candle:wax:${s["candles"]}",wax),component("candle-wick","candle:wick:${s["candles"]}",wicks))
        }
        if(f==OriginalShapeFamily.BED) {
            val orientation=BlockTransform.rotationY(yaw(s.getValue("facing"))+if(path=="straw_bed")PI else 0.0);val head=s["part"]=="head"
            if(path=="straw_bed")return listOf(component("bed-straw-base","bed:straw-base:${s["part"]}",listOf(if(head)b(0,0,0,16,4,8)else b(0,0,0,16,4,16)),orientation))+
                if(head)listOf(component("bed-straw-pillow","bed:straw-pillow",listOf(b(0,0,8,16,5,16)),orientation))else emptyList()
            val legs=if(head)listOf(b(0,0,0,3,3,3),b(13,0,0,16,3,3))else listOf(b(0,0,13,3,3,16),b(13,0,13,16,3,16))
            return listOf(component("bed-cover","bed:cover",listOf(b(0,3,0,16,9,16)),orientation),component("bed-legs","bed:legs:${s["part"]}",legs,orientation))+
                if(head)listOf(component("bed-pillow","bed:pillow",listOf(b(1,9,1,15,9.5,6)),orientation))else emptyList()
        }
        return null
    }
}
