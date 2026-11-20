package com.blockcolc.presentation

import java.util.Collections

enum class RoomMount { FLOOR, WALL, DESK, SHELF }
data class RoomSize(val width:Double,val height:Double,val depth:Double){
    init{require(listOf(width,height,depth).all{it.isFinite()&&it>0})}
    fun fits(other:RoomSize)=width<=other.width&&height<=other.height&&depth<=other.depth
}
data class RoomItem(val id:String,val achievementId:String,val title:String,val englishTitle:String,val mount:RoomMount,val size:RoomSize,val preferredSlot:String)
data class RoomSlot(val id:String,val mount:RoomMount,val x:Double,val y:Double,val z:Double,val capacity:RoomSize,val requiresPlacedItem:String?=null,val quarterTurns:Int=0)
data class OwnedRoomItem(val item:RoomItem,val unlockedAt:String?)
data class PlacedRoomItem(val slot:RoomSlot,val owned:OwnedRoomItem)

/** Furniture is a projection of retained achievement facts. There is no second
 * reward counter, granting command, database or dependency on popup receipts. */
class RoomPresentation internal constructor(owned:List<OwnedRoomItem>,placed:List<PlacedRoomItem>,unplaced:List<OwnedRoomItem>,ignored:Set<String>){
    val owned:List<OwnedRoomItem> = Collections.unmodifiableList(owned.toList())
    val placed:List<PlacedRoomItem> = Collections.unmodifiableList(placed.toList())
    val unplaced:List<OwnedRoomItem> = Collections.unmodifiableList(unplaced.toList())
    val ignoredSlots:Set<String> = Collections.unmodifiableSet(LinkedHashSet(ignored))
}

object RoomPresentationProjection {
    private fun size(w:Double=1.0,h:Double=1.0,d:Double=1.0)=RoomSize(w,h,d)
    private fun item(id:String,achievement:String,zh:String,en:String,mount:RoomMount,slot:String,w:Double=1.0,h:Double=1.0,d:Double=1.0)=
        RoomItem(id,achievement,zh,en,mount,size(w,h,d),slot)
    val items:List<RoomItem> = Collections.unmodifiableList(listOf(
        item("bed","focus-first","床","Bed",RoomMount.FLOOR,"bed",1.0,.7,2.0),
        item("bookcase","focus-ten","书架","Bookcase",RoomMount.FLOOR,"bookcase",2.7,3.2,1.0),
        item("plant","focus-fifty","盆栽","Potted plant",RoomMount.DESK,"desk-left",.5,.8,.5),
        item("workshop-miniature","focus-hundred","工坊手办","Workshop miniature",RoomMount.SHELF,"shelf-1",.6,.7,.6),
        item("clock","time-hour","挂钟","Wall clock",RoomMount.WALL,"wall-clock",.7,.7,.2),
        item("reading-chair","time-ten-hours","阅读椅","Reading chair",RoomMount.FLOOR,"reading-chair",1.0,1.2,1.0),
        item("globe","time-twenty-five-hours","地球仪","Globe",RoomMount.SHELF,"shelf-2",.6,.8,.6),
        item("settlement-miniature","building-first","聚落手办","Settlement miniature",RoomMount.DESK,"desk-inner-left",.8,.6,.6),
        item("map","building-five","聚落地图","Settlement map",RoomMount.WALL,"wall-map",1.5,1.0,.2),
        item("cabinet","building-ten","收纳柜","Cabinet",RoomMount.FLOOR,"cabinet",1.5,1.0,1.0),
        item("mug","days-seven","杯子","Mug",RoomMount.DESK,"desk-right",.35,.4,.35),
        item("calendar","days-thirty","日历","Calendar",RoomMount.WALL,"wall-calendar",.6,.8,.2),
        item("record-player","focus-two-fifty","唱片机","Record player",RoomMount.SHELF,"shelf-3",.8,.5,.6),
        item("books","focus-five-hundred","藏书","Collected books",RoomMount.SHELF,"shelf-4",.8,.6,.5),
        item("floor-lamp","time-fifty-hours","落地灯","Floor lamp",RoomMount.FLOOR,"floor-lamp",.6,2.0,.6),
        item("armchair","time-hundred-hours","扶手椅","Armchair",RoomMount.FLOOR,"armchair",1.3,1.2,1.3),
        item("town-miniature","building-twenty-five","小镇手办","Town miniature",RoomMount.SHELF,"shelf-5",.8,.7,.6),
        item("travel-frame","days-hundred","旅行相框","Travel picture",RoomMount.WALL,"wall-picture",1.0,.8,.2),
        item("windmill-miniature","habit-buildings-three","风车手办","Windmill miniature",RoomMount.SHELF,"shelf-6",.6,.9,.6),
        item("goal-trophy","goals-seven","目标奖杯","Goal trophy",RoomMount.SHELF,"shelf-7",.5,.8,.5)
    ))
    val slots:List<RoomSlot> = Collections.unmodifiableList(buildList{
        fun floor(id:String,x:Double,z:Double,turn:Int=0)=add(RoomSlot(id,RoomMount.FLOOR,x,0.0,z,size(3.0,3.5,2.0),quarterTurns=turn))
        floor("bed",-3.5,3.0);floor("bookcase",-3.5,.18,3);floor("reading-chair",2.7,-.36,1)
        floor("cabinet",3.1,3.43);floor("floor-lamp",.70,3.50);floor("armchair",-.62,3.02)
        add(RoomSlot("wall-clock",RoomMount.WALL,-4.0,2.4,-2.5,size(2.0,1.5,.3)))
        add(RoomSlot("wall-map",RoomMount.WALL,4.0,2.32,-.36,size(2.0,1.5,.3)))
        add(RoomSlot("wall-calendar",RoomMount.WALL,2.8,2.0,4.0,size(2.0,1.5,.3)))
        add(RoomSlot("wall-picture",RoomMount.WALL,-1.3,2.4,4.0,size(2.0,1.5,.3)))
        for((id,x)in listOf("desk-left" to -2.2,"desk-inner-left" to -1.05,"desk-right" to 1.35))add(RoomSlot(id,RoomMount.DESK,x,1.0,-3.4,size(1.2,1.2,1.0)))
        for(i in 1..7)add(RoomSlot("shelf-$i",RoomMount.SHELF,-3.25,.14+(i-1)/3,.18+((i-1)%3-1)*.85,size(1.0,1.0,.8),"bookcase",3))
    })
    init{
        require(items.map{it.id}.toSet().size==items.size&&slots.map{it.id}.toSet().size==slots.size)
        require(items.map{it.achievementId}.toSet()==AchievementProjection.definitions.map{it.id}.toSet())
        require(items.all{item->slots.any{it.id==item.preferredSlot&&it.mount==item.mount&&item.size.fits(it.capacity)}})
    }
    fun from(achievements:List<AchievementProgress>):RoomPresentation {
        require(achievements.map{it.definition.id}.toSet().size==achievements.size)
        val unlocked=achievements.filter{it.unlocked}.associateBy{it.definition.id}
        val owned=items.mapNotNull{item->unlocked[item.achievementId]?.let{OwnedRoomItem(item,it.unlockedAt)}}
        val byId=owned.associateBy{it.item.id};val bySlot=slots.associateBy{it.id}
        val requested=owned.associate{it.item.preferredSlot to it.item.id}
        val used=LinkedHashSet<String>();val placed=ArrayList<PlacedRoomItem>();val ignored=LinkedHashSet<String>()
        // Supporting furniture is adopted first, regardless of saved map order.
        for((slotId,itemId)in requested.entries.sortedBy{bySlot[it.key]?.requiresPlacedItem!=null}){
            val slot=bySlot[slotId];val value=byId[itemId]
            if(slot==null||value==null||value.item.mount!=slot.mount||!value.item.size.fits(slot.capacity)||itemId in used||
                slot.requiresPlacedItem?.let{it !in used}==true){ignored+=slotId;continue}
            val support=slot.requiresPlacedItem?.let{id->placed.firstOrNull{it.owned.item.id==id}}
            val actual=if(support==null)slot else {
                val home=checkNotNull(bySlot[support.owned.item.preferredSlot])
                slot.copy(x=slot.x+support.slot.x-home.x,y=slot.y+support.slot.y-home.y,z=slot.z+support.slot.z-home.z)
            }
            used+=itemId;placed+=PlacedRoomItem(actual,value)
        }
        return RoomPresentation(owned,placed,owned.filter{it.item.id !in used},ignored)
    }
}
