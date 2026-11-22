package com.blockcolc.preview.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.blockcolc.preview.*
import com.blockcolc.cloud.AccountPreferenceOutbox
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicReference

@Composable internal fun cloudText(zh:String,en:String)=if(LocalNativeUi.current.language=="en")en else zh
@Composable internal fun CloudField(label:String,value:String,onChange:(String)->Unit,secret:Boolean=false,enabled:Boolean=true){
    var visible by remember{mutableStateOf(false)}
    LaunchedEffect(value.isEmpty()){if(value.isEmpty())visible=false}
    Column(Modifier.fillMaxWidth().padding(vertical=8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text(label,style=MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
            BasicTextField(value,onChange,Modifier.weight(1f).heightIn(min=40.dp).semantics{contentDescription=label},enabled=enabled,singleLine=true,
                textStyle=MaterialTheme.typography.bodyLarge.copy(color=MaterialTheme.colorScheme.onSurface),
                visualTransformation=if(secret&&!visible)PasswordVisualTransformation()else VisualTransformation.None,
                keyboardOptions=KeyboardOptions(keyboardType=if(secret)KeyboardType.Password else KeyboardType.Text))
            if(secret)NativeIconAction(if(visible)cloudText("隐藏密码","Hide password")else cloudText("显示密码","Show password"),if(visible)"eyeopen"else"eyeclosed",{visible=!visible},enabled=enabled)
        }
        NativeSeparator()
    }
}
@Composable private fun CloudGroup(title:String,explanation:String?=null,content:@Composable ColumnScope.()->Unit){
    var expanded by rememberSaveable(title){mutableStateOf(false)}
    NativeDisclosure(title,expanded=expanded,onExpandedChange={expanded=it},contentSpacing=0.dp,
        trailing=explanation?.let{hint->@Composable {NativeInfoAction(title,hint)}},content=content)
}
@Composable internal fun CloudError(code:String?){if(code==null)return
    val english=LocalNativeUi.current.language=="en"
    val message=when(code){
        "LOGIN_FAILED"->if(english)"Username or password is incorrect."else"用户名或密码不正确。"
        "PASSWORD_LENGTH"->if(english)"Use a password of 10–256 characters."else"密码需要 10–256 个字符。"
        "CURRENT_PASSWORD_INVALID"->if(english)"The current password is incorrect."else"当前密码不正确。"
        "PASSWORD_UNCHANGED"->if(english)"Choose a different password."else"请使用不同的新密码。"
        "PASSWORD_MISMATCH"->if(english)"The new passwords do not match."else"两次输入的新密码不一致。"
        "UNAUTHORIZED"->if(english)"Sign in again to continue."else"登录已失效，请重新登录。"
        "USERNAME_FORMAT"->if(english)"Use 3–32 letters, numbers or underscores."else"用户名使用 3–32 位字母、数字或下划线。"
        "USERNAME_TAKEN"->if(english)"This username is already taken."else"这个用户名已被使用。"
        "SYNC_CONFLICT","DOMAIN_CONFLICT","PLAN_CONFLICT"->if(english)"Both devices changed the same record. Your local data is retained; choose which workspace to use."else"两台设备修改了同一条记录。本机内容已保留，请选择要使用的工作区。"
        "WORKSPACE_REPLACED"->if(english)"Cloud history was replaced. Choose before syncing this device."else"云端记录已被替换，请先选择本机的同步方式。"
        "EXECUTION_CHANGED","EXECUTING_ELSEWHERE"->if(english)"Another device controls this plan. Refresh or take over."else"计划由另一台设备执行，请刷新或主动接管。"
        "FRIEND_NOT_FOUND"->if(english)"Friend not found or friends are disabled."else"没有找到好友，或对方未开启好友功能。"
        "LOCAL_CHANGED"->if(english)"Local changes were kept; syncing will retry."else"本机新改动已保留，将重新同步。"
        "REQUEST_TIMEOUT"->if(english)"The cloud request timed out. Sync again to check its result."else"云端请求超时，请重新同步核对结果。"
        "TLS_UNAVAILABLE"->if(english)"Unable to verify the cloud connection. Check the device date and time."else"无法验证云端连接，请检查设备日期和时间。"
        "CLOUD_EMPTY"->if(english)"The cloud workspace is empty. Your local records are kept."else"云端暂无记录，本机内容已保留。"
        "CLOUD_DEVICE_MEMORY_LIMIT"->if(english)"This device ran out of memory while syncing."else"同步时设备可用内存不足。"
        "CLOUD_ASSET_DIGEST","CLOUD_RESPONSE_TOO_LARGE"->if(english)"The cloud data did not pass verification."else"云端数据未通过校验。"
        else->if(english)"Sync is unavailable. Local focus and data remain usable; try again later."else"同步暂不可用，本地专注和记录仍可使用，请稍后重试。"
    }
    Text(message,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
}

@Composable private fun CloudWorkspaceFeedback(view:CloudView){
    val receipt=view.receipt
    val label=when(receipt?.result){
        CloudResult.WORKING->when(receipt.action){
            CloudAction.MERGE->cloudText("正在合并…","Merging…")
            CloudAction.USE_CLOUD,CloudAction.REPLACE_CLOUD->cloudText("正在替换工作区…","Replacing workspace…")
            else->cloudText("正在处理…","Working…")
        }
        CloudResult.COMPLETE->when(receipt.action){
            CloudAction.SYNC->cloudText("同步完成","Sync complete")
            CloudAction.MERGE->cloudText("合并并同步完成","Merged and synced")
            CloudAction.USE_CLOUD->cloudText("已使用云端内容","Cloud workspace applied")
            CloudAction.REPLACE_CLOUD->cloudText("已用本机内容替换云端","Cloud workspace replaced")
            CloudAction.TAKEOVER->cloudText("已接管计划","Plan taken over")
            CloudAction.BACKUP->cloudText("云端备份已保存","Cloud backup saved")
            CloudAction.RESTORE->cloudText("云端备份已恢复","Cloud backup restored")
            CloudAction.REVOKE_DEVICE->cloudText("设备已移除","Device removed")
        }
        CloudResult.NEEDS_CHOICE->cloudText("同步暂停，请选择处理方式","Sync paused. Choose how to continue.")
        CloudResult.RETRY_PENDING->cloudText("本机有新改动，稍后继续同步","Local changes pending. Sync will retry.")
        CloudResult.FAILED->null
        null->when{
            view.choiceRequired->cloudText("等待选择同步方式","Choose how to sync")
            view.busy->cloudText("正在连接云端…","Connecting to cloud…")
            view.error!=null->null
            view.accountPending->cloudText("账户设置已保存，等待同步","Account settings saved; sync pending")
            view.lastSync!=null->cloudText("已同步","Synced")
            else->cloudText("尚未同步","Not synced yet")
        }
    }
    Column(Modifier.fillMaxWidth().semantics{liveRegion=LiveRegionMode.Polite}){
        if(label!=null)Text(label,style=MaterialTheme.typography.bodySmall)
        CloudError(receipt?.error)
        if(view.error!=receipt?.error)CloudError(view.error)
    }
}

@Composable internal fun NativeCloudSettings(view:CloudView,onOpen:()->Unit){
    NativeSettingLink(if(view.account==null)cloudText("登录或创建账户","Sign in or create account")else cloudText("管理账户","Manage account"),onOpen,
        description=if(view.account==null)cloudText("可选开启，离线照常使用","Optional; works offline")else view.account.optString("username"))
}

@Composable private fun NativeCloudPolicySheet(open:Boolean,onClose:()->Unit){
    val english=LocalNativeUi.current.language=="en"
    val context=LocalContext.current
    val uri=LocalUriHandler.current
    val heading=cloudText("云服务条款与隐私说明","Cloud terms & privacy")
    NativeSheet(Unit.takeIf{open},{heading},onClose,initiallyExpanded=true){
        val file=if(english)"en" else "zh-CN"
        var parts by remember(context,file){mutableStateOf<List<String>?>(null)}
        LaunchedEffect(context,file){
            parts=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){
                runCatching{context.assets.open("cloud-policy/$file.md").bufferedReader().use{it.readText()}
                    .trim().split(Regex("\\r?\\n\\r?\\n")).drop(1)}.getOrElse{emptyList()}
            }
        }
        val content=parts
        when{
            content==null->NativeBusy(Modifier.size(20.dp))
            content.isEmpty()->Text(cloudText("暂时无法读取说明","Notice unavailable"))
            else->for(part in content){
                if(part.startsWith("## "))Text(part.removePrefix("## "),style=MaterialTheme.typography.titleMedium)
                else Text(part,style=MaterialTheme.typography.bodyMedium)
            }
        }
        NativeSettingLink(cloudText("联系项目维护者","Contact the maintainers"),{
            runCatching{uri.openUri("https://github.com/Dieight/blockcolc")}
        })
    }
}

@Composable internal fun NativeCloudPanels(controller:NativeCloudController,view:CloudView,accountOpen:Boolean,friendsOpen:Boolean,onCloseAccount:()->Unit,onCloseFriends:()->Unit){
    val english=LocalNativeUi.current.language=="en"
    val focus=LocalFocusManager.current
    val keyboard=LocalSoftwareKeyboardController.current
    fun tr(zh:String,en:String)=if(english)en else zh
    var username by rememberSaveable{mutableStateOf("")};var password by remember{mutableStateOf("")};var registration by rememberSaveable{mutableStateOf(false)}
    var restoreConfirm by remember{mutableStateOf(false)};var logoutConfirm by remember{mutableStateOf(false)}
    var passwordOpen by remember{mutableStateOf(false)}
    var passwordPending by remember{mutableStateOf(false)}
    var policyOpen by rememberSaveable{mutableStateOf(false)}
    val clipboard=LocalClipboardManager.current
    val commitAccount=remember{AtomicReference<()->Unit>({})}
    NativeSheet(Unit.takeIf{accountOpen},{tr("账户与云同步","Account & cloud")},onCloseAccount,
        onHidden={commitAccount.getAndSet({}).invoke()},initiallyExpanded=true,
        contentSpacing=if(view.account==null)12.dp else 0.dp){
        if(view.account==null){
            SideEffect{commitAccount.set({})}
            Text(tr("不登录也能完整使用方块钟。登录后同步记录和偏好，导入的材质包、音频留在本机。","All features work without an account. Sync records and preferences; imported textures and audio stay on this device."),style=MaterialTheme.typography.bodySmall)
            NativeSegments(listOf("login" to tr("登录","Sign in"),"register" to tr("注册","Register")),if(registration)"register"else"login",{registration=it=="register"},!view.busy)
            CloudField(tr("用户名","Username"),username,{username=it})
            CloudField(tr("密码（至少 10 位）","Password (at least 10 characters)"),password,{password=it},true)
            NativeAction(if(registration)tr("创建账户","Create account")else tr("登录并同步","Sign in & sync"),{controller.login(username,password,registration);password=""},Modifier.fillMaxWidth(),pending=view.busy,enabled=view.ready&&username.isNotBlank()&&password.length>=10)
            if(view.error=="LOCAL_CREDENTIALS_UNAVAILABLE")NativeAction(tr("退出本机账户","Sign out on this device"),controller::logout,Modifier.fillMaxWidth(),primary=false)
        }else{
            val account=view.account
            NativeInlineAction(account.optString("username"),controller::refresh,"reset",tr("立即同步","Sync now"),
                pending=view.working(CloudAction.SYNC),enabled=!view.busy,description={CloudWorkspaceFeedback(view)})
            NativeSeparator()
            NativeSettingLink(tr("修改密码","Change password"),{passwordOpen=true})
            if(view.choiceRequired){
                Text(tr("本机与云端都有内容，请选择一次。替换前保留本机回滚点；相同记录的冲突不会擅自覆盖。","Both workspaces have content. Choose once. A local rollback is kept before replacement; conflicting records are not overwritten."),style=MaterialTheme.typography.bodySmall)
                val choices=listOf(
                    Triple("merge",CloudAction.MERGE,tr("合并独立改动","Merge independent changes")),
                    Triple("cloud",CloudAction.USE_CLOUD,tr("使用云端内容","Use cloud workspace")),
                    Triple("local",CloudAction.REPLACE_CLOUD,tr("以本机替换云端","Replace cloud with this device"))
                )
                for((strategy,action,label)in choices){
                    val working=view.working(action)
                    NativeInlineAction(label,{controller.choose(strategy)},"check",enabled=!view.busy,pending=working)
                }
            }
            NativeSeparator()
            CloudGroup(tr("执行设备","Execution device"),tr("一台执行，其他设备可接管","One executor; other devices can take over")){
                if(!view.owned)NativeInlineAction(tr("本机仅查看","View only"),controller::takeover,"play",
                    tr("接管","Take over"),enabled=!view.busy,pending=view.working(CloudAction.TAKEOVER))
                view.devices.forEachIndexed{index,device->
                    if(index>0||!view.owned)NativeSeparator()
                    Row(Modifier.fillMaxWidth().heightIn(min=NativeSettingsRowHeight),
                        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(NativeSettingActionGap)){
                        Text(device.optString("name"),Modifier.weight(1f),style=MaterialTheme.typography.bodyLarge)
                        if(device.optBoolean("current"))Text(tr("本机","This device"),style=MaterialTheme.typography.bodySmall)
                        else NativeIconAction(tr("移除设备","Revoke device"),"close",{controller.revokeDevice(device.getString("id"))},enabled=!view.busy)
                    }
                }
            }
            NativeSeparator()
            CloudGroup(tr("云端备份","Cloud backup"),tr("每日合并，只保留一份","One merged daily recovery snapshot")){
                NativeInlineAction(view.backup?.optString("date")?:tr("尚无云端备份","No cloud backup yet"),
                    controller::captureBackup,"chest",tr("立即备份","Back up now"),enabled=!view.busy,pending=view.working(CloudAction.BACKUP))
                if(view.backup!=null){
                    NativeSeparator()
                    NativeInlineAction(tr("恢复云端备份","Restore cloud backup"),{restoreConfirm=true},"chest",
                        enabled=!view.busy,pending=view.working(CloudAction.RESTORE))
                }
            }
            NativeSeparator()
            if(account.has("friendsEnabled")&&account.has("sharing")){
                val accountId=account.getString("id")
                var base by rememberSaveable(accountId){mutableStateOf(AccountPreferenceOutbox.editable(account).toString())}
                var chosen by rememberSaveable(accountId){mutableStateOf(base)}
                SideEffect{commitAccount.set{
                    val change=AccountPreferenceOutbox.difference(JSONObject(base),JSONObject(chosen))
                    if(change.length()>0){controller.account(change,accountId);base=chosen}
                }}
                val local=JSONObject(chosen)
                val enabled=local.getBoolean("friendsEnabled")&&local.getJSONObject("sharing").optBoolean("status")
                CloudGroup(tr("好友功能","Friends")){
                    NativeToggle(tr("专注状态","Focus status"),value=enabled){active->
                        local.put("friendsEnabled",active).getJSONObject("sharing").put("status",active)
                        chosen=local.toString()
                    }
                    NativeSeparator()
                    CloudSharing(local.getJSONObject("sharing"),enabled,includeStatus=false){chosen=JSONObject(chosen).put("sharing",it).toString()}
                    if(enabled)Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween){
                        Text(account.optString("friendCode"),Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)
                        NativeIconAction(tr("复制好友码","Copy friend code"),"chest",{clipboard.setText(AnnotatedString(account.optString("friendCode")))})
                    }
                }
            }else if(view.busy)Text(tr("正在读取账户设置","Loading account settings"),style=MaterialTheme.typography.bodySmall)
            NativeSeparator()
            NativeInlineAction(tr("退出登录","Sign out"),{logoutConfirm=true},"close",enabled=!view.busy)
        }
        if(view.account==null)CloudError(view.error)
        if(view.account!=null)NativeSeparator()
        NativeSettingLink(tr("云服务条款与隐私说明","Cloud terms & privacy"),{policyOpen=true})
    }
    NativeCloudPolicySheet(accountOpen&&policyOpen,{policyOpen=false})
    val passwordAccount=view.account?.optString("id")?.takeIf{accountOpen&&passwordOpen&&it.isNotEmpty()}
    NativeSheet(passwordAccount,{tr("修改密码","Change password")},{passwordOpen=false},
        dismissible=!passwordPending){accountId->
        var current by remember{mutableStateOf("")}
        var next by remember{mutableStateOf("")}
        var confirmation by remember{mutableStateOf("")}
        var passwordError by remember{mutableStateOf<String?>(null)}
        var saved by remember{mutableStateOf(false)}
        CloudField(tr("当前密码","Current password"),current,{current=it;saved=false;passwordError=null},true,!passwordPending)
        CloudField(tr("新密码（10–256 位）","New password (10–256 characters)"),next,{next=it;saved=false;passwordError=null},true,!passwordPending)
        CloudField(tr("确认新密码","Confirm new password"),confirmation,{confirmation=it;saved=false;passwordError=null},true,!passwordPending)
        Text(tr("修改后，其他设备和浏览器需要重新登录。","Other devices and browsers will need to sign in again."),
            style=MaterialTheme.typography.bodySmall)
        NativeAction(tr("保存新密码","Save new password"),{
            if(passwordPending)return@NativeAction
            when{
                next!=confirmation->passwordError="PASSWORD_MISMATCH"
                current==next->passwordError="PASSWORD_UNCHANGED"
                else->{
                    focus.clearFocus();keyboard?.hide();passwordError=null;passwordPending=true
                    controller.changePassword(accountId,current,next){error->
                        passwordPending=false;passwordError=error
                        if(error==null){current="";next="";confirmation="";saved=true}
                    }
                }
            }
        },Modifier.fillMaxWidth(),pending=passwordPending,enabled=current.isNotEmpty()&&next.length in 10..256&&confirmation.isNotEmpty())
        if(saved)Text(tr("密码已更新。","Password updated."),style=MaterialTheme.typography.bodySmall)
        CloudError(passwordError)
    }
    NativeSheet(Unit.takeIf{friendsOpen},{tr("好友","Friends")},onCloseFriends,initiallyExpanded=true){
        when{
            view.account==null->Text(tr("请先在设置中登录并开启好友功能。","Sign in and enable friends in Settings first."))
            !view.account.optBoolean("friendsEnabled")||view.account.optJSONObject("sharing")?.optBoolean("status")==false->NativeAction(tr("开启好友功能","Enable friends"),{
                val sharing=JSONObject(view.account.optJSONObject("sharing")?.toString()?:"{}").put("status",true)
                controller.account(JSONObject().put("friendsEnabled",true).put("sharing",sharing))
            },Modifier.fillMaxWidth(),pending=view.busy)
            else->NativeFriendsPanel(controller,view)
        }
        CloudError(view.friendsError?:view.error)
    }
    NativeSheet(Unit.takeIf{restoreConfirm},{tr("恢复云端备份？","Restore cloud backup?")},{restoreConfirm=false}){
        Text(tr("本机当前内容会先保留回滚点。其他设备需重新选择同步方式。","A local rollback is kept first. Other devices must choose how to sync again."))
        NativeAction(tr("确认恢复","Restore"),{commitAccount.get().invoke();restoreConfirm=false;controller.restoreBackup()},Modifier.fillMaxWidth())
    }
    NativeSheet(Unit.takeIf{logoutConfirm},{tr("退出登录？","Sign out?")},{logoutConfirm=false}){
        Text(tr("本机内容保留，停止云同步与好友状态上传。","Local data stays. Cloud sync and friend updates stop."))
        NativeAction(tr("退出登录","Sign out"),{commitAccount.get().invoke();logoutConfirm=false;controller.logout()},Modifier.fillMaxWidth())
    }
}

@Composable internal fun CloudSharing(value:JSONObject,enabled:Boolean,includeStatus:Boolean=true,onChange:(JSONObject)->Unit){
    val labels=listOf("status" to cloudText("专注状态","Focus status"),"name" to cloudText("当前任务","Current task"),"time" to cloudText("开始与结束时间","Start and end times"),"daily" to cloudText("每日专注时长","Daily focus time"))
    for((key,label)in labels)if(includeStatus||key!="status")NativeToggle(label,value=value.optBoolean(key),enabled=enabled){checked->
        onChange(JSONObject(value.toString()).put(key,checked))
    }
}
