package com.blockcolc.preview.ui

import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.blockcolc.weather.*

@Composable fun NativeWeatherSettings(enabled:Boolean,saving:Boolean,view:RealWeatherView,onEnabled:(Boolean)->Unit,onRetry:()->Unit){
    val ui=LocalNativeUi.current;val uri=LocalUriHandler.current
    var linkFailed by remember{mutableStateOf(false)}
    fun open(link:String){runCatching{uri.openUri(link);linkFailed=false}.onFailure{linkFailed=true}}
    val busy=view.weather==WeatherSync.SYNCING||view.astronomy==AstronomySync.SYNCING||view.clearing
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
        Column(Modifier.weight(1f)){NativeToggle(ui.text("同步现实天气"),value=enabled,enabled=!saving){onEnabled(it)}}
        if(enabled)NativeIconAction(ui.text("重新同步"),"reset",onRetry,enabled=!saving,pending=busy)
    }
    if(enabled){
        val condition=view.current?.let{current->if(current.language==ui.language)current.conditionText else
            ui.text(when(WeatherAppearance.from(current)?.kind){"clear"->"晴";"cloudy"->"多云";"rain"->"小雨";"snow"->"小雪";else->"雾"})}
        val weather=when{
            condition!=null->condition+(if(view.location?.source==WeatherLocationSource.CACHED)ui.text(" · 缓存位置")else "")
            view.weather==WeatherSync.SYNCING->ui.text("正在同步现实天气")
            view.weather==WeatherSync.FALLBACK->ui.text("本地天气 · {0}",weatherFailureLabel(view.weatherFailure))
            else->ui.text("等待同步")
        }
        val astronomy=ui.text(when(view.astronomy){AstronomySync.CALENDAR->"日月日历已同步";AstronomySync.EPHEMERIS_ONLY->"日月按所在地计算"
            AstronomySync.SYNCING->"正在获取天文日历";AstronomySync.UNAVAILABLE->"使用本地日月";else->"等待同步"})
        Column(Modifier.fillMaxWidth().padding(bottom=8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
            Text(ui.text("天气：{0}",weather),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurface)
            Text(ui.text("日月：{0}",astronomy),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurface)
        }
        if(view.current!=null||view.calendar!=null){
            Text(ui.text("数据来源："),style=MaterialTheme.typography.bodySmall)
            Text(ui.text("和风天气"),Modifier.clickable(interactionSource=remember{MutableInteractionSource()},indication=null){open("https://www.qweather.com")},
                style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.primary)
            val sources=(view.current?.attributions.orEmpty()+view.calendar?.attributions.orEmpty()).map(String::trim).distinct()
            for((index,text)in sources.withIndex()){
                val link=remember(text){runCatching{Uri.parse(text).takeIf{it.scheme=="https"&&!it.host.isNullOrBlank()}?.toString()}.getOrNull()}
                if(link!=null)Text(ui.text("数据归因 ↗"),Modifier.clickable(interactionSource=remember{MutableInteractionSource()},indication=null){open(link)}
                    .semantics{contentDescription=ui.text("查看天气与天文数据归因 {0}",index+1)},style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.primary)
                else if(text.isNotEmpty()&&!Regex("^[a-z][a-z0-9+.-]*:",RegexOption.IGNORE_CASE).containsMatchIn(text))Text(text,style=MaterialTheme.typography.bodySmall)
            }
        }
    }
    if(linkFailed)Text(ui.text("无法打开链接"),color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
    if(view.clearFailed){Text(ui.text("位置缓存未能清除"),color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
        if(!enabled)NativeAction(ui.text("重试"),onRetry,primary=false,icon="reset",pending=view.clearing)}
}

@Composable private fun weatherFailureLabel(reason:WeatherFailure?):String {
    val key=when(reason){
        WeatherFailure.LOCATION_PERMISSION_DENIED->"需要定位权限"
        WeatherFailure.LOCATION_SERVICES_DISABLED->"请开启系统定位"
        WeatherFailure.LOCATION_UNAVAILABLE->"定位暂不可用"
        WeatherFailure.NOT_CONFIGURED->"此安装包未配置天气"
        WeatherFailure.SIGNING_IDENTITY_UNAVAILABLE->"无法读取应用签名"
        WeatherFailure.AUTHENTICATION_FAILED,WeatherFailure.SECURITY_RESTRICTION,WeatherFailure.ACCESS_DENIED->"应用或 API 限制拒绝请求"
        WeatherFailure.QUOTA_EXHAUSTED,WeatherFailure.BILLING_ISSUE,WeatherFailure.ACCOUNT_SUSPENDED,WeatherFailure.RATE_LIMITED->"天气服务额度或账户受限"
        WeatherFailure.INVALID_HOST,WeatherFailure.API_PATH_NOT_FOUND,WeatherFailure.API_DEPRECATED->"天气接口配置不可用"
        WeatherFailure.NETWORK_UNAVAILABLE->"网络不可用"
        WeatherFailure.REQUEST_TIMEOUT->"天气请求超时"
        WeatherFailure.INVALID_RESPONSE,WeatherFailure.UNSUPPORTED_RESPONSE_ENCODING,WeatherFailure.RESPONSE_TOO_LARGE->"天气数据暂不可用"
        WeatherFailure.UNKNOWN_CONDITION->"天气现象暂未适配"
        WeatherFailure.CACHE_CLEAR_FAILED->"位置缓存未能清除"
        WeatherFailure.REQUEST_CANCELLED->"同步已取消"
        else->"同步暂不可用"
    }
    return LocalNativeUi.current.text(key)
}
