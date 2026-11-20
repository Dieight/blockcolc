package com.blockcolc.preview

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import com.blockcolc.preview.migration.LegacyUpgradeInstaller
import com.blockcolc.preview.migration.LegacyUpgradeFailure
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.util.Locale

class MainActivity : ComponentActivity() {
    private var runtime by mutableStateOf<PreviewRuntime?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            var retry by remember { mutableIntStateOf(0) }
            var failed by remember { mutableStateOf(false) }
            LaunchedEffect(retry) {
                try {
                    LegacyUpgradeInstaller.prepare(applicationContext)
                    val opened = PreviewRuntime.get(applicationContext)
                    runtime = opened
                    opened.start()
                    if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) opened.foreground(true)
                } catch (error: Exception) {
                    currentCoroutineContext().ensureActive()
                    val stage = (error as? LegacyUpgradeFailure)?.stage ?: "open-workspace"
                    android.util.Log.w("BlockcolcUpgrade", "Workspace preparation failed ($stage)")
                    failed = true
                }
            }
            val opened = runtime
            if (opened != null) NativeApp(opened) else {
                val zh = Locale.getDefault().language == "zh"
                MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                    Surface(Modifier.fillMaxSize()) {
                        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
                            horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(if (failed) {
                                if (zh) "工作区暂时无法打开，原有记录仍保留。" else "Could not open the workspace. Your previous records are preserved."
                            } else {
                                if (zh) "正在打开工作区…" else "Opening workspace…"
                            })
                            if (failed) Button(onClick = { failed = false; retry++ }) { Text(if (zh) "重试" else "Retry") }
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        runtime?.foreground(true)
    }

    override fun onStop() {
        runtime?.activityStopped(this)
        super.onStop()
    }
}
