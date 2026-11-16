package com.blockcolc.preview

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import com.blockcolc.domain.DomainEngine
import com.blockcolc.domain.DomainTime
import com.blockcolc.storage.PlanMode
import com.blockcolc.world.filament.NativeWorldView
import org.json.JSONObject
import java.util.UUID
import kotlinx.coroutines.delay

private val green = Color(0xff2d604b)
private val paper = Color(0xffedf1ee)
@Composable fun PreviewApp(runtime: PreviewRuntime, fixture: String, benchmarkRun: String?, own: (NativeWorldView) -> Unit,skipWorld:Boolean=false) {
    var snapshot by remember { mutableStateOf(runtime.latest) }
    DisposableEffect(runtime) { val stop = runtime.subscribe { snapshot = it }; onDispose { stop() } }
    val s = snapshot; val context = LocalContext.current
    var page by remember { mutableStateOf(0) }; var minimal by remember { mutableStateOf(false) }
    var world by remember { mutableStateOf<NativeWorldView?>(null) }; var worldReady by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("正在准备世界") }
    var selectedTask by remember { mutableStateOf<String?>(null) }
    var rounds by remember { mutableStateOf(1) }; var focus by remember { mutableStateOf(25) }; var rest by remember { mutableStateOf(5) }
    var automatic by remember { mutableStateOf(false) }; var mode by remember { mutableStateOf(PlanMode.ROUNDS) }
    var percent by remember { mutableStateOf(25f) }; var allocated by remember { mutableStateOf(1) }
    var targetProject by remember { mutableStateOf<String?>(null) }; var targetTask by remember { mutableStateOf<String?>(null) }
    var newTitle by remember { mutableStateOf("") }; var note by remember { mutableStateOf("") }
    var restoreRoot by remember { mutableStateOf<String?>(null) }
    var clock by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(s.ticket) { while (true) { clock = System.currentTimeMillis(); delay(250) } } // UI projection only.
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(runtime::import) }
    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { it?.let(runtime::export) }
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { runtime.start() }
    val active = s.projects.firstOrNull { it.id == s.activeProject }
    LaunchedEffect(s.ready){if(s.ready){withFrameNanos{};P2Trace.event("ui-committed-frame")}}
    val visibleWorld=page==0||minimal||s.phase in setOf("FOCUS","REST","REPORT")
    DisposableEffect(world,visibleWorld){if(visibleWorld)world?.resume()else world?.pause();onDispose{}}
    LaunchedEffect(worldReady, s.progress, s.revision) { if(worldReady) s.progress?.let { world?.construction(it,s.revision) } }
    val ended = s.phase == "REPORT"
    LaunchedEffect(s.phase) {
        if (ended) { targetProject = active?.id; targetTask = active?.tasks?.firstOrNull()?.id; percent = (active?.tasks?.firstOrNull()?.progress ?: 0) / 100f; allocated = maxOf(1, s.round) }
    }
    MaterialTheme(colorScheme = lightColorScheme(primary = green, background = paper, surface = paper, onPrimary = Color.White)) {
        s.importSummary?.let{summary->AlertDialog(onDismissRequest={runtime.confirmImport(false)},title={Text("确认导入备份")},text={Text(summary)},confirmButton={TextButton(onClick={runtime.confirmImport(true)}){Text("确认替换")}},dismissButton={TextButton(onClick={runtime.confirmImport(false)}){Text("取消")}})}
        restoreRoot?.let{root->AlertDialog(onDismissRequest={restoreRoot=null},title={Text("恢复这份记录？")},text={Text("当前记录先保留为操作回滚点；旧自动续轮授权将撤销。")},confirmButton={TextButton(onClick={restoreRoot=null;runtime.restore(root)}){Text("恢复")}},dismissButton={TextButton(onClick={restoreRoot=null}){Text("取消")}})}
        BoxWithConstraints(Modifier.fillMaxSize().background(paper).windowInsetsPadding(WindowInsets.safeDrawing)) {
            val screenHeight = maxHeight
            val immersive = minimal || s.phase in setOf("FOCUS", "REST", "REPORT")
            val height = if (immersive) maxHeight else maxHeight * .38f
            if (s.ready&&!skipWorld) AndroidView(factory = { ctx ->
                NativeWorldView(ctx, fixture, false, true, true, true, false, true, true, true, true, false, false, null, benchmarkRun, false, false, initialConstruction=s.progress) { value ->
                    status = value
                    if (value.startsWith("P1 submitted") || value.startsWith("P1 orbit completed")) {
                        worldReady = true
                        P2Trace.event("world-submitted")
                        android.util.Log.i("BlockcolcP2", "world-submitted:${android.os.SystemClock.elapsedRealtimeNanos()}")
                    }
                }.also { world = it; own(it); it.resume() }
            }, modifier = Modifier.fillMaxWidth().height(if (page == 0 || immersive) height else 1.dp).alpha(if (page == 0 || immersive) 1f else 0f), onRelease = { view -> view.close(); world = null })
            // Page changes never recreate the active world. The host above stays
            // attached; controls are composited over it rather than parenting it.
            if (!s.ready) Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
                Text(if (s.error == null) "正在读取本机记录" else "本地记录需要恢复", style = MaterialTheme.typography.titleLarge)
                Text(s.error ?: "原生预览 · 独立数据", Modifier.padding(vertical = 12.dp))
                if (s.error != null) Button(onClick = { importer.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) }) { Text("选择备份恢复") }
                if (s.message != null) Text(s.message)
            } else {
                if (page == 0 || immersive) Column(Modifier.fillMaxWidth().align(Alignment.TopCenter).padding(16.dp)) {
                    Text("方块钟 · 原生预览", color = green, style = MaterialTheme.typography.titleMedium)
                    if (!worldReady) Text(status, style = MaterialTheme.typography.labelSmall)
                }
                Column(Modifier.fillMaxWidth().align(Alignment.BottomCenter)) {
                    if (page == 0 || immersive) Surface(color = paper.copy(alpha = .90f), modifier = Modifier.fillMaxWidth(), shape = androidx.compose.ui.graphics.RectangleShape) {
                        Column(Modifier.fillMaxWidth().heightIn(max = screenHeight * .58f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (s.phase == "FOCUS" || s.phase == "REST") {
                                val left = maxOf(0, (s.ticket?.let { DomainTime.millis(it.end) } ?: clock) - clock)
                                Text("${left / 60000}:${(left / 1000 % 60).toString().padStart(2, '0')}", style = MaterialTheme.typography.displayMedium, fontFamily = FontFamily.Monospace)
                                Text(s.heading); if (s.detail.isNotEmpty()) Text(s.detail)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(onClick = { runtime.manual(true) }, enabled = !s.busy) { Text("提前完成本轮") }
                                    TextButton(onClick = { runtime.manual(false) }, enabled = !s.busy) { Text("中止本轮") }
                                }
                                if (s.rounds > 1&&s.planMode!=PlanMode.ROUNDS) TextButton(onClick = { runtime.manual(false, true) }, enabled = !s.busy) { Text("取消本次计划（其他原因）") }
                            } else if (ended) {
                                Text("汇报本次推进", style = MaterialTheme.typography.titleLarge)
                                Text("已完成 ${s.round} 轮 · 进度与轮次一起保存")
                                val targets = s.projects.filter { it.status in setOf("active", "paused")&&(s.planMode!=PlanMode.ROUNDS||it.id==s.activeProject) }
                                for (p in targets) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    RadioButton(selected = targetProject == p.id, onClick = { targetProject = p.id; targetTask = p.tasks.firstOrNull()?.id; percent = (p.tasks.firstOrNull()?.progress ?: 0) / 100f })
                                    Text(p.title)
                                }
                                val selected = targets.firstOrNull { it.id == targetProject }
                                if (selected?.kind != "habit") {
                                    for (task in selected?.tasks.orEmpty()) Row(verticalAlignment = Alignment.CenterVertically) {
                                        RadioButton(selected = targetTask == task.id, onClick = { targetTask = task.id; percent = task.progress / 100f }); Text(task.title)
                                    }
                                    Text("推进到 ${percent.toInt()}%")
                                    Slider(value = percent, onValueChange = { percent = it }, valueRange = 0f..100f, steps = 99)
                                }
                                Stepper("计入轮次", allocated, 0, maxOf(1, s.round)) { allocated = it }
                                Button(onClick = { runtime.report(percent.toInt() * 100, targetProject ?: active!!.id, targetTask, allocated) }, enabled = !s.busy && targetProject != null, modifier = Modifier.fillMaxWidth()) { Text(if (s.busy) "正在送达…" else "一次提交本次推进") }
                            } else {
                                Text(if (s.phase == "READY") s.heading else active?.title ?: "选一件事，开始建造", style = MaterialTheme.typography.titleLarge)
                                if (s.phase == "READY") Text("${s.round}/${s.rounds} 轮已完成 · 等你确认后开始")
                                for (task in active?.tasks.orEmpty().filter { it.progress < 10000 }) Row(verticalAlignment = Alignment.CenterVertically) { RadioButton(selected = selectedTask == task.id || selectedTask == null && task == active?.tasks?.firstOrNull(), onClick = { selectedTask = task.id }); Text(task.title) }
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    for ((value, title) in listOf(PlanMode.ROUNDS to "按轮次", PlanMode.MARATHON to "按结束时间")) FilterChip(selected = mode == value, onClick = { mode = value }, label = { Text(title) })
                                    TextButton(onClick = { minimal = !minimal }) { Text(if (minimal) "返回完整" else "极简") }
                                }
                                Stepper("专注（分钟）", focus, 1, 180) { focus = it }
                                Stepper("休息（分钟）", rest, 0, 60) { rest = it }
                                Stepper("计划轮次", rounds, 1, 24) { rounds = it }
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Text("自动连续专注", Modifier.weight(1f)); Switch(automatic, { automatic = it },modifier=Modifier.semantics{contentDescription="自动连续专注"}) }
                                Button(onClick = { runtime.focus(if (minimal) PlanMode.MINIMAL else mode, rounds, focus, rest, automatic, selectedTask,
                                    if (mode == PlanMode.MARATHON) System.currentTimeMillis() + (rounds * focus + maxOf(0, rounds - 1) * rest) * 60000L else null) }, enabled = !s.busy && active != null, modifier = Modifier.fillMaxWidth()) { Text(if (s.busy) "正在保存…" else "开始专注") }
                                if (s.projects.isEmpty()) OutlinedButton(onClick = runtime::example, enabled = !s.busy) { Text("载入隔离的 25 栋对照数据") }
                            }
                            if (s.message != null) Text(s.message)
                        }
                    } else Column(Modifier.fillMaxWidth().height(screenHeight - 64.dp).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(listOf("计时", "任务", "统计", "设置")[page], style = MaterialTheme.typography.headlineSmall, color = green)
                        when (page) {
                            1 -> {
                                Text("任务与施工", style = MaterialTheme.typography.titleMedium)
                                for (p in s.projects.filter { it.status in setOf("active", "paused") }) OutlinedButton(onClick = { runtime.command(DomainEngine.command("SwitchActiveProject", "projectId" to p.id)); selectedTask = null; page = 0 }, enabled = !s.busy && s.phase == "IDLE", modifier = Modifier.fillMaxWidth()) { Text(p.title + " · ${p.progress / 100}%") }
                                OutlinedTextField(newTitle, { newTitle = it }, label = { Text("任务名称") }, modifier = Modifier.fillMaxWidth())
                                Row { Button(onClick = { runtime.create(newTitle, false); newTitle = "" }, enabled = !s.busy && newTitle.isNotBlank()) { Text("创建大任务") }; TextButton(onClick = { runtime.create(newTitle, true); newTitle = "" }, enabled = !s.busy && newTitle.isNotBlank()) { Text("创建习惯") } }
                                HorizontalDivider(); Text("简易便签")
                                for (n in s.notes) Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(n.completed, { runtime.command(DomainEngine.command("SetQuickNoteCompleted", "noteId" to n.id, "completed" to it)) }); Text(n.text) }
                                OutlinedTextField(note, { note = it }, label = { Text("写一条便签") }, modifier = Modifier.fillMaxWidth())
                                TextButton(onClick = { runtime.command(DomainEngine.command("AddQuickNote", "noteId" to UUID.randomUUID().toString(), "text" to note)); note = "" }, enabled = note.isNotBlank() && !s.busy) { Text("添加") }
                            }
                            2 -> {
                                Text("${s.millis / 60000} min", style = MaterialTheme.typography.displayMedium); Text("${s.completed} 有效完成轮次")
                                HorizontalDivider(); Text("时间花在哪里", style = MaterialTheme.typography.titleMedium)
                                for (a in s.allocations) { Text(a.title); Text("${a.duration / 60000} min · ${a.duration / 1000 % 60} s") }
                                Text("纪念建筑", style = MaterialTheme.typography.titleMedium)
                                for (p in s.projects.filter { it.status == "monument" }) Text(p.title)
                            }
                            3 -> {
                                Text("完整记录与原有正式备份互通；预览仍使用独立数据库。")
                                Text(runtime.platform.capabilities())
                                if (!runtime.platform.notificationAllowed()) TextButton(onClick = { if (Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS) else if(Build.VERSION.SDK_INT>=26)context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))else context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+context.packageName))) }) { Text("开启通知") }
                                if (!runtime.platform.exactAllowed() && Build.VERSION.SDK_INT >= 31) TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, android.net.Uri.parse("package:" + context.packageName))) }) { Text("允许精确提醒") }
                                HorizontalDivider(); Text("本地备份", style = MaterialTheme.typography.titleMedium)
                                Button(onClick = { exporter.launch("blockcolc-native-backup.json") }, enabled = !s.busy) { Text("导出完整备份") }
                                OutlinedButton(onClick = { importer.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) }, enabled = !s.busy) { Text("导入备份（保留操作回滚点）") }
                                TextButton(onClick = runtime::start) { Text("刷新可恢复备份") }
                                for (root in s.roots) OutlinedButton(onClick = { restoreRoot=root.id }, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) { Text("${if (root.kind == "daily") "每日合并" else "操作回滚"} · ${root.createdAt}") }
                                Text("P2 业务闭环 · P1 活动世界；其余完整页面与系统能力不在此阶段冒充完成。", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        if (s.message != null) Text(s.message)
                    }
                    if (!immersive) Row(Modifier.fillMaxWidth().height(64.dp).background(paper), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                        listOf("计时", "任务", "统计", "设置").forEachIndexed { index, title -> TextButton(onClick = { page = index }) { Text(title, color = if (page == index) green else Color.Black) } }
                    }
                }
                if (immersive && s.phase in setOf("IDLE", "READY")) TextButton(onClick = { minimal = false }, modifier = Modifier.align(Alignment.TopEnd)) { Text("返回完整") }
            }
        }
    }
}
@Composable private fun Stepper(title: String, value: Int, min: Int, max: Int, change: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f)); TextButton(onClick = { change(value - 1) }, enabled = value > min) { Text("−") }; Text("$value", fontFamily = FontFamily.Monospace); TextButton(onClick = { change(value + 1) }, enabled = value < max) { Text("+") }
    }
}
