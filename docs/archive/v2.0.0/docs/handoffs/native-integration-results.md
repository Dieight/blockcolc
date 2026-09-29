# Native integrated relay — local handoff

日期：2026-09-19

## 范围

本切片只处理 Android 原生集成和构筑隔离。标准版与私有同步版继续共用
`com.blockcolc.app` applicationId；没有改 Web、共享投影、服务器或部署工具，
没有构建签名 APK、安装设备或连接真实服务器。

## 已实现

- 主仓库保留一个无副作用的 `FocusExport` Capacitor stub：
  `availability()` 固定返回 `{available:false}`，`publish()` 直接完成；标准版不创建
  投影缓存、不注册 ContentProvider、不含伴侣包名/签名桥。
- 删除旧跨 APK `FocusExportCache`/`FocusExportProvider` 路径；`MainActivity` 仍注册
  稳定的 `FocusExport` 类名，私有 source overlay 会替换同包同名实现。
- `apps/android/android/app/build.gradle` 只在非空
  `-PblockcolcPrivateRelayDir=<private android-integration directory>` 时读取私有
  `relay.properties`、排除公共 stub、接入私有 Java/manifest，并注入私有 BuildConfig。
  空值（包括主构建脚本显式传入的 `-PblockcolcPrivateRelayDir=`）始终是标准版。
- 私有 manifest 通过 AGP variant source overlay 加到公共主 manifest；没有用私有文件替换
  公共 manifest，因此 MainActivity、FileProvider、现有权限和其他主应用声明仍共同保留。
- manifest metadata `com.blockcolc.PRIVATE_RELAY` 是标准版 `false`、私有版 `true`。
  私有 service/boot receiver 和 `RECEIVE_BOOT_COMPLETED` 只来自私有 manifest；标准
  manifest 不引用不存在的私有组件。applicationId、签名配置和版本事实未分叉。
- 私有实现位于 `C:/Codex/blockcolc-relay-private/android-integration/`：
  `FocusExportPlugin`、`PrivateRelayCache`、`PrivateRelaySync`、JobScheduler service
  和 boot receiver。配置样例是 `relay.properties.example`；真实文件只应是私有本机
  未跟踪文件：

  ```properties
  relay.origin=https://<private-origin>
  relay.uploadToken=<独立上传 bearer，至少 32 字符>
  relay.enrolledDate=YYYY-MM-DD
  ```

  不读取或注入 viewer/session/SSH secret。
- 缓存使用 `noBackupFilesDir/blockcolc-private-relay/latest.json` 的 `AtomicFile`，
  每次覆盖一个最新 live snapshot 和完整日数组；不形成历史任务名队列。上传日数组
  时按服务的最多 366 天及 128 KiB request body 分页，未沿用旧的 366 天截断。
- `replacement=true` 会生成新 source epoch，并在同一覆盖式缓存中保存旧 epoch；串行上传
  先完成一次 `/api/upload/epoch` 显式 reset，再发 days/live，避免服务的 epoch pinning
  把恢复数据误判为 409。reset 成功标记与 days/live 上传标记同样只保存技术状态。
- 上传在同一进程单线程执行；HTTPS 禁止重定向，连接/读取有界，可由 JobService
  `onStopJob` 取消并断开当前连接。网络失败交给 JobScheduler backoff；401/403/409
  及其他永久 4xx 写入当前 revision 的技术阻断标记，不循环重试。无请求体、任务名、
  bearer 或异常细节日志。

## 本地验证

以下命令均在 `apps/android/android` 执行，并以 Android Studio JBR 21 作为命令作用域
`JAVA_HOME`。系统默认 Java 25 会使 Gradle 8.11.1 在 build script 解析阶段报
`Unsupported class file major version 69`，该失败不是 Java 编译结果。

- 标准构筑：
  `-PblockcolcPrivateRelayDir= :app:compileDebugJavaWithJavac` —— exit 0。
- 合成私有配置（`relay.example.invalid`，非真实凭据/端点）：
  `-PblockcolcPrivateRelayDir=C:\Codex\blockcolc-relay-private\android-integration :app:compileDebugJavaWithJavac` —— exit 0。
- 标准 debug lint（空 property）—— exit 0。
- 私有 debug lint（同一合成配置）—— exit 0。
- 修正 replacement epoch reset 后重新执行私有 compile + lint（同一合成配置）—— exit 0。
- 合并 manifest 检查：标准 marker=false 且没有私有 service/receiver；私有 marker=true，
  service/receiver 与 `RECEIVE_BOOT_COMPLETED` 存在；标准编译类目录只保留公共 stub，
  私有编译包含 uploader/cache/config 类。
- 合成 `relay.properties` 已在验证后删除；没有真实 relay 请求、部署、签名 release、
  SHA-256 APK 边界比较、安装或 OnePlus 生命周期/网络测试。

## 待后续门禁

仍需主代理在私有受保护配置下完成正式私有 verification/release 流程，并单独审计
APK marker、applicationId/签名、SHA-256 和服务器端 401/409/重试/分页实链路；设备
后台、Doze、进程回收、取消和数据保留也未在本切片实测。公共 release 仍应使用空
`-PblockcolcPrivateRelayDir=`，私有 APK 归档在私有目录，不能走公共发布/安装脚本。
