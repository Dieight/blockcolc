package com.blockcolc.preview.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
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
@Composable private fun CloudGroup(title:String,description:String,content:@Composable ColumnScope.()->Unit){
    var expanded by rememberSaveable(title){mutableStateOf(false)}
    NativeDisclosure(title,description,expanded,{expanded=it},rowHeight=60.dp,contentSpacing=0.dp,content=content)
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
        else->if(english)"Sync is unavailable. Local focus and data remain usable; try again later."else"同步暂不可用，本地专注和记录仍可使用，请稍后重试。"
    }
    Text(message,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
}

@Composable internal fun NativeCloudSettings(view:CloudView,onOpen:()->Unit){
    NativeSettingLink(if(view.account==null)cloudText("登录或创建账户","Sign in or create account")else cloudText("管理账户","Manage account"),onOpen)
    Text(if(view.account==null)cloudText("可选开启，离线照常使用","Optional; works offline")else view.account.optString("username"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
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
    val clipboard=LocalClipboardManager.current
    val commitAccount=remember{AtomicReference<()->Unit>({})}
    NativeSheet(Unit.takeIf{accountOpen},{tr("账户与云同步","Account & cloud")},onCloseAccount,onHidden={commitAccount.getAndSet({}).invoke()},initiallyExpanded=true){
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
            Text(account.optString("username"),style=MaterialTheme.typography.titleMedium)
            Text(if(view.accountPending)tr("账户设置已保存，等待同步","Account settings saved; sync pending")else if(view.lastSync==null)tr("正在连接云端","Connecting to cloud")else tr("本机优先保存，联网自动同步","Saved locally first; synced when connected"),style=MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)){
                NativeAction(tr("立即同步","Sync now"),controller::refresh,Modifier.weight(1f),pending=view.busy,primary=false,icon="reset")
                NativeAction(tr("退出登录","Sign out"),{logoutConfirm=true},Modifier.weight(1f),enabled=!view.busy,primary=false)
            }
            NativeSettingLink(tr("修改密码","Change password")){passwordOpen=true}
            if(view.choiceRequired){
                Text(tr("本机与云端都有内容，请选择一次。替换前保留本机回滚点；相同记录的冲突不会擅自覆盖。","Both workspaces have content. Choose once. A local rollback is kept before replacement; conflicting records are not overwritten."),style=MaterialTheme.typography.bodySmall)
                NativeAction(tr("合并独立改动","Merge independent changes"),{controller.choose("merge")},Modifier.fillMaxWidth(),enabled=!view.busy,primary=false)
                NativeAction(tr("使用云端内容","Use cloud workspace"),{controller.choose("cloud")},Modifier.fillMaxWidth(),enabled=!view.busy,primary=false)
                NativeAction(tr("以本机替换云端","Replace cloud with this device"),{controller.choose("local")},Modifier.fillMaxWidth(),enabled=!view.busy,primary=false)
            }
            NativeSeparator()
            CloudGroup(tr("执行设备","Execution device"),tr("一台执行，其他设备可接管","One executor; other devices can take over")){
                Text(if(view.owned)tr("由本机执行","This device executes the plan")else tr("本机仅查看，接管后才能操作专注","View only; take over to control focus"))
                if(!view.owned)NativeAction(tr("接管当前计划","Take over plan"),controller::takeover,Modifier.fillMaxWidth(),enabled=!view.busy)
                view.devices.forEach{device->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    Text(device.optString("name"),Modifier.weight(1f))
                    if(device.optBoolean("current"))Text(tr("本机","This device"))else NativeIconAction(tr("移除设备","Revoke device"),"close",{controller.revokeDevice(device.getString("id"))},enabled=!view.busy)
                }}
            }
            NativeSeparator()
            CloudGroup(tr("云端备份","Cloud backup"),tr("每日合并，只保留一份","One merged daily recovery snapshot")){
                Text(view.backup?.optString("date")?:tr("尚无云端备份","No cloud backup yet"),style=MaterialTheme.typography.bodySmall)
                NativeAction(tr("备份当前内容","Back up now"),controller::captureBackup,Modifier.fillMaxWidth(),enabled=!view.busy,primary=false,icon="chest")
                NativeAction(tr("恢复云端备份","Restore cloud backup"),{restoreConfirm=true},Modifier.fillMaxWidth(),enabled=!view.busy&&view.backup!=null,primary=false)
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
                NativeToggle(tr("好友功能","Friends"),tr("由你决定每项可见内容","You control each shared field"),local.getBoolean("friendsEnabled"),true){chosen=JSONObject(chosen).put("friendsEnabled",it).toString()}
                if(local.getBoolean("friendsEnabled")){
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(account.optString("friendCode"),Modifier.weight(1f));NativeIconAction(tr("复制好友码","Copy friend code"),"chest",{clipboard.setText(AnnotatedString(account.optString("friendCode")))})}
                    CloudSharing(local.getJSONObject("sharing"),true){chosen=JSONObject(chosen).put("sharing",it).toString()}
                }
            }else Text(tr("正在读取账户设置","Loading account settings"),style=MaterialTheme.typography.bodySmall)
        }
        CloudError(view.error)
    }
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
            !view.account.optBoolean("friendsEnabled")->NativeAction(tr("开启好友功能","Enable friends"),{controller.account(JSONObject().put("friendsEnabled",true))},Modifier.fillMaxWidth(),pending=view.busy)
            else->NativeFriendsPanel(controller,view)
        }
        CloudError(view.error)
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

@Composable internal fun CloudSharing(value:JSONObject,enabled:Boolean,onChange:(JSONObject)->Unit){
    val labels=listOf("status" to cloudText("专注状态","Focus status"),"name" to cloudText("当前任务","Current task"),"time" to cloudText("开始与结束时间","Start and end times"),"daily" to cloudText("每日专注时长","Daily focus time"))
    for((key,label)in labels)NativeToggle(label,"",value.optBoolean(key),enabled){checked->
        onChange(JSONObject().also{out->labels.forEach{(k,_)->out.put(k,if(k==key)checked else value.optBoolean(k))}})
    }
}
