package com.blockcolc.presentation

import com.blockcolc.domain.HolidayDates
import java.time.LocalDate

data class HolidayEmblemEntry(val id:String,val name:String,val description:String,val emblem:String)

/** Catalog is the formal holiday display data; calendar windows come from the domain. */
object HolidayEmblems {
    private data class Holiday(val name:String,val description:String,val emblems:List<String>)
    private val catalog=mapOf(
        "new-year" to Holiday("元旦","烟花与礼盒，迎接公历新年的开始。",listOf("烟花","礼盒","星星")),
        "spring-festival" to Holiday("春节","灯笼与爆竹，迎接农历新年与团聚。",listOf("灯笼","结绳","爆竹")),
        "valentine" to Holiday("情人节","玫瑰与信笺，传递爱意和心意。",listOf("心形","玫瑰","信封")),
        "lantern" to Holiday("元宵节","正月十五赏花灯，汤圆寓意团圆。",listOf("灯笼","汤圆")),
        "women" to Holiday("国际妇女节","含羞草与书，纪念女性的贡献与平等权利。",listOf("含羞草","书")),
        "nowruz" to Holiday("诺鲁孜节","伊朗与中亚等地迎新春；嫩芽与镜子象征更新。",listOf("嫩芽","苹果","镜子")),
        "songkran" to Holiday("泰国宋干节","泰国新年以水迎新，花碗盛着清凉祝福。",listOf("水滴","花碗")),
        "labour" to Holiday("劳动节","多国在五月一日纪念劳动者；工具象征创造。",listOf("锤子","齿轮")),
        "africa" to Holiday("非洲日","五月二十五日纪念非洲的团结与多样文化。",listOf("非洲轮廓","绿叶")),
        "children" to Holiday("儿童节","中国及多国在六月一日庆祝；积木与风车寄托童趣。",listOf("风车","积木","气球")),
        "dragon-boat" to Holiday("端午节","农历五月初五，粽子与龙舟是传统节日意象。",listOf("粽子","龙舟")),
        "us-independence" to Holiday("美国独立日","七月四日纪念美国独立；星条旗与烟花是常见庆祝意象。",listOf("星条旗","烟花","星星")),
        "france" to Holiday("法国国庆日","法国七月十四日以三色旗与烟花庆祝国庆。",listOf("三色旗串","烟花")),
        "mid-autumn" to Holiday("中秋节","农历八月十五，月饼与桂花寄托团圆。",listOf("月饼","桂花","玉兔")),
        "oktoberfest" to Holiday("慕尼黑啤酒节","德国慕尼黑的秋季庆典，以卷饼、啤酒花和蓝白棚为意象。",listOf("椒盐卷饼","啤酒花","杯")),
        "china-national" to Holiday("中国国庆节","十月一日纪念中华人民共和国成立；红旗、灯笼与烟花装点庆祝。",listOf("红旗","灯笼","烟花")),
        "halloween" to Holiday("万圣节","十月末的节日庆祝，以南瓜灯、糖果和蝙蝠点缀。",listOf("南瓜灯","糖果","蝙蝠")),
        "day-of-dead" to Holiday("墨西哥亡灵节","主要在十一月一至二日，以花与彩纸追思亲友。",listOf("万寿菊","剪纸彩旗","烛光")),
        "christmas" to Holiday("圣诞节","常青树、礼物与铃铛，是广泛使用的庆祝意象。",listOf("常青树","礼盒","铃铛")),
        "carnival" to Holiday("巴西狂欢节","巴西的年度狂欢庆典，以彩伞与鼓表现音乐和色彩。",listOf("彩色小伞","鼓")),
    )
    fun name(id:String):String? = catalog[id]?.name
    fun at(date:String,slot:Int,birthday:BirthdaySettings?=null):List<HolidayEmblemEntry> {
        require(slot in 0..2)
        val holidays=HolidayDates.onDate(date).flatMap{(id,_)->val holiday=catalog.getValue(id);holiday.emblems.map{HolidayEmblemEntry(id,holiday.name,holiday.description,it)}}
        val result=holidays.getOrNull(slot)?.let{listOf(it)}.orEmpty()
        val day=LocalDate.parse(date)
        val cake=birthday!=null&&birthday.enabled&&birthday.month==day.monthValue&&birthday.day!=null&&day.dayOfMonth==minOf(birthday.day,day.lengthOfMonth())
        return if(slot==0&&cake)result+HolidayEmblemEntry("birthday","生日快乐","今天属于你。小蛋糕留在聚落，祝你新的一岁自在生长。","生日蛋糕") else result
    }
}
