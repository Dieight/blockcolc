package com.blockcolc.preview.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import com.blockcolc.preview.BuildConfig
import com.blockcolc.preview.updates.*
import com.blockcolc.updates.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable fun NativeAboutSheet(open:Boolean,view:UpdateView,updates:NativeUpdateController,onClose:()->Unit){
    val ui=LocalNativeUi.current;val context=LocalContext.current;val uri=LocalUriHandler.current
    var legal by remember{mutableStateOf<NativeLegalEntry?>(null)}
    var legalText by remember{mutableStateOf<String?>(null)}
    var linkFailed by remember{mutableStateOf(false)}
    LaunchedEffect(open){if(open)updates.refresh()else{legal=null;linkFailed=false}}
    LaunchedEffect(legal){legalText=null;val entry=legal
        if(entry!=null)legalText=withContext(Dispatchers.IO){runCatching{context.assets.open(entry.asset).use{input->
            val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
            while(true){val n=input.read(buffer);if(n<0)break;check(out.size()+n<=256*1024);out.write(buffer,0,n)};String(out.toByteArray(),Charsets.UTF_8)}}.getOrNull()?:""}}
    fun link(url:String){try{uri.openUri(url);linkFailed=false}catch(e:Exception){linkFailed=true}}
    fun close(){if(legal!=null){legal=null;linkFailed=false}else{updates.closeAbout();onClose()}}
    NativeSheet(if(open)true else null,{legal?.let{ui.text(it.title)}?:ui.text("关于")},::close){
        val entry=legal
        if(entry!=null){
            NativeAction(ui.text("查看上游来源"),{link(entry.upstream)},Modifier.fillMaxWidth(),primary=false,icon="map")
            if(legalText==null)NativeBusy()else if(legalText!!.isEmpty())Text(ui.text("许可正文暂不可读，请重试。"),color=MaterialTheme.colorScheme.error)
            else SelectionContainer{Text(legalText!!,style=MaterialTheme.typography.bodySmall)}
            NativeAction(ui.text("返回关于"),{legal=null},Modifier.fillMaxWidth(),primary=false,icon="close")
        }else{
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)){NativeBrand();Text(ui.text("方块钟")+" · blockcolc",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium)}
            Text(ui.text("版本 {0} ({1})",BuildConfig.VERSION_NAME,BuildConfig.VERSION_CODE),style=MaterialTheme.typography.bodySmall)
            Text(ui.text("任务、记录与蓝图默认保存在本机。"))
            if(BuildConfig.APPLICATION_ID!="com.blockcolc.app"){
                Text(ui.text("原生预览 · 尚未作为正式版交付"),style=MaterialTheme.typography.bodySmall)
            }
            NativeSeparator()
            NativeAction(ui.text("项目仓库"),{link(UpdatePolicy.REPOSITORY)},Modifier.fillMaxWidth(),primary=false,icon="map")
            NativeAction(ui.text("项目许可 · Apache-2.0"),{legal=NativeLegalCatalog.project},Modifier.fillMaxWidth(),primary=false,icon="tasks")
            NativeSettingGroup("技术、字体与音频许可"){
                for(item in NativeLegalCatalog.entries)NativeAction(ui.text(item.title),{legal=item},Modifier.fillMaxWidth(),primary=false,icon="tasks")
                NativeAction(ui.text("和风天气 · 服务文档"),{link("https://dev.qweather.com/docs/")},Modifier.fillMaxWidth(),primary=false,icon="map")
                NativeAction(ui.text("SQLite · 公有领域"),{link("https://sqlite.org/copyright.html")},Modifier.fillMaxWidth(),primary=false,icon="map")
            }
            Text(ui.text("本应用不是 Minecraft 官方产品，未获 Mojang Studios 或 Microsoft 认可或关联。Minecraft 是其权利人的商标。"),style=MaterialTheme.typography.bodySmall)
            NativeSeparator()
            NativeInlineAction(ui.text("手动检查更新"),updates::check,"reset",pending=view.checking,enabled=!view.operating)
            val status=view.status;val release=view.release;val releaseAsset=release?.asset;val jobAsset=status?.asset;val version=jobAsset?.version?:release?.version.orEmpty()
            val moving=status?.phase in setOf(UpdatePhase.DOWNLOADING,UpdatePhase.PAUSED)
            val problem=view.problem?:status?.problem
            val description=when{
                problem!=null->ui.text(problemKey(problem))
                view.checking->ui.text("正在检查更新")
                release!=null&&status?.channel==UpdateChannel.PRIVATE->ui.text("公开版 {0} 已更新；私人版保留好友同步，不下载公开包。",release.version)
                release!=null&&status?.channel==UpdateChannel.PREVIEW->ui.text("公开版 {0} 已更新；此预览应用只提示，不下载或安装正式包。",release.version)
                view.installRequested->ui.text("请在系统安装页面确认；取消后仍可继续使用。")
                status?.phase==UpdatePhase.READY->ui.text("版本 {0} 已下载并验证，等待安装。",version)
                moving->ui.text(if(status?.phase==UpdatePhase.PAUSED)"等待网络后继续下载 {0}" else "正在下载 {0}",version)
                release!=null&&release.asset==null->ui.text("新版暂未提供可验证的安装包。")
                release!=null->ui.text("发现新版本 {0}。",release.version)
                view.checked&&view.feed==UpdateFeed.BETA->ui.text("测试通道没有较新的版本。")
                view.checked->ui.text("当前已是最新公开版本 {0}。",BuildConfig.PUBLIC_RELEASE_VERSION)
                else->ui.text("等待手动检查更新")
            }
            Text(description,style=MaterialTheme.typography.bodySmall)
            if(moving&&status!=null&&jobAsset!=null){
                PixelProgress((status.received*10000/jobAsset.size).toInt(),Modifier.fillMaxWidth())
                Text("${mib(status.received)} / ${mib(jobAsset.size)} MiB",style=MaterialTheme.typography.bodySmall)
                NativeAction(ui.text("取消下载"),updates::cancel,Modifier.fillMaxWidth(),pending=view.operating,primary=false,icon="close")
            }
            if(status?.channel==UpdateChannel.STANDARD&&!moving){
                if(status.phase==UpdatePhase.READY){
                    NativeAction(ui.text(if(status.canInstall)"安装更新"else"允许安装此来源"),if(status.canInstall)updates::install else updates::authorize,
                        Modifier.fillMaxWidth(),pending=view.operating,icon="check")
                }else if(status.phase==UpdatePhase.FAILED&&jobAsset!=null){
                    NativeAction(ui.text("重新下载"),{updates.retry(jobAsset)},Modifier.fillMaxWidth(),pending=view.operating,icon="reset")
                }else if(releaseAsset!=null){
                    NativeAction(ui.text("确认下载更新"),{updates.confirmDownload(releaseAsset)},Modifier.fillMaxWidth(),pending=view.operating,icon="check")
                }
            }
            if(release!=null)NativeAction(ui.text("查看发布说明"),{link(release.url)},Modifier.fillMaxWidth(),primary=false,icon="map")
        }
        if(linkFailed)Text(ui.text("无法打开链接"),color=MaterialTheme.colorScheme.error)
    }
}

private fun mib(value:Long)=String.format(java.util.Locale.ROOT,"%.1f",value/1048576.0)
private fun problemKey(problem:UpdateProblem)=when(problem){
    UpdateProblem.CHECK->"暂时无法检查更新，请确认网络后重试。"
    UpdateProblem.DESCRIPTOR->"新版暂未提供可验证的安装包。"
    UpdateProblem.CHANNEL->"此通道只提示公开更新。"
    UpdateProblem.NOT_NEWER->"此更新版本不高于当前版本。"
    UpdateProblem.STORAGE->"无法保存或读取下载记录，请重试。"
    UpdateProblem.TRANSFER->"下载未完成，请检查网络和存储后重试。"
    UpdateProblem.INTEGRITY->"更新文件不完整或校验失败，请重新下载。"
    UpdateProblem.IDENTITY->"更新包的应用、版本或通道不匹配。"
    UpdateProblem.SIGNATURE->"更新包签名不匹配。"
    UpdateProblem.PERMISSION->"请先允许方块钟安装此来源的应用。"
    UpdateProblem.INSTALLER->"系统安装器暂不可用，请重试。"
    UpdateProblem.CANCELLED->"更新检查已取消。"
}
