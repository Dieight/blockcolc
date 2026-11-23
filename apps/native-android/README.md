# blockcolc 原生 Android 工程

这个工程提供方块钟的原生 Android 应用。业务、SQLite 存储、Compose 界面和 Filament 世界渲染在同一应用内运行。迁移分阶段记录在[总规划](../../docs/research/3.0.0-native-migration-plan.md)。

3.0.0 正式版及公开 Beta 使用同一包名与证书。覆盖升级、性能和兼容性见 [3.0.0 交付记录](../../docs/versions/V112.md)及 [P4 验收记录](../../docs/versions/3.0.0-p4.md)。测试版发布见 [Beta 通道](#beta-通道)。

## 本地构建

使用仓库的 Gradle wrapper，以 `apps/native-android` 为工程目录，传入本机 Filament 1.56.0 的 `-PmatcPath=<matc.exe>`。`:app:assembleDebug` 用于开发，`:app:recordUserPreview` 用于记录签名的隔离包。隔离包使用 `com.blockcolc.preview`，支持导入 JSON 备份。

公开构筑使用含可选账户功能的同一客户端。P1/P2 的固定世界和施工输入供诊断构筑使用。用户候选的包内素材、诊断排除和签名由各自的构建核验任务检查。

模块：`world-core` 持有世界输入与更新契约，`world-filament` 拥有渲染线程和 GPU 生命周期，`app` 提供原生预览宿主。`domain-core` 持有完整存档与业务命令，`state-store` 负责逐项 SQL、CAS、内容备份及恢复控制，`state-store-android` 只适配系统 SQLite，`focus-core` 协调计时计划。Activity、闹钟、服务和恢复共用 `PreviewRuntime` 的单一 IO 执行入口；落盘成功后再通知页面、系统和建筑，不复制旧样机的整份原子 JSON 存档。

通知、精确提醒及计时前台服务按系统入口请求权限，后台运行仍受厂商电池策略影响。登录后连接[账户服务](../../services/cloud/README.md)。正式身份的旧版数据迁移与回退见 [验证策略](../../docs/TESTING.md#首次正式原生升级与回退)。

## P0 固定项

- `tools/freeze-inputs.mjs <新目录>` 记录暂定生产源码及内置资产摘要，不读取用户数据库、外部 MC JAR、天气配置或私有模块。最终发布基线仍待用户接受 v2.9.0；不能把这里的源码摘要当 APK 摘要。
- SDK 35、AGP 8.7.2、Kotlin 2.0.21、JDK 17 字节码先与现有可复现构建兼容。最低系统仍为 API 23，不缩小正式支持范围。
- P1 先固定 Filament 1.56.0 进行受控对照，不认定它是最终发布依赖。已检查缓存 AAR 声明最低 API 21，arm64 JNI 的三个 ELF LOAD 段均为 16KiB 对齐；最终 APK 的 zip 对齐、其他 ABI、GPU 驱动及实际 16KiB 设备仍需后续验证。
- 生产生成器输出引擎无关的几何／材质／实例描述，不输出展开 GLB。静态批次按空间、材质、遮挡标记和来源所有者划分；局部更新按所有者替换，不使整个世界失效。
- 地形与静态几何的导出不等于已把生成器迁成 Kotlin；P1 输入用于验证资源表示与绘制。动物／降水代表运行已接通，未覆盖的完整运行范围仍单列，不算整套世界生成或冷启动收益。

## 构建与证据

暂复用仓库现有 Gradle wrapper 的固定发行版，以本目录为独立 `-p` 工程，不使用 Capacitor 的项目设置。运行时用现有 Android Studio JBR，`ANDROID_HOME` 指向本机 SDK。

构建入口：`apps/android/android/gradlew.bat -p apps/native-android :world-core:test :app:assembleDebug -PworldInputs=<绝对输入目录> -PmatcPath=<1.56.0 matc.exe>`。输入须有成功导出的最终 manifest；缺输入、编译器或仍在导出时就失败，不补假世界。工具纯测试为 `node --test apps/native-android/tools/world-packets.test.mjs apps/native-android/tools/environment-frame.test.mjs apps/native-android/tools/sky-source.test.mjs`。

已审过的当前输入默认可运行：`adb shell am start -n com.blockcolc.preview/.MainActivity --es fixture ocean`，场景也可选 `coast`；使用四聚落输入时另有 `valley`、`floating`。未知 shader、模型或活动属性仍默认拒绝，只有显式 `projectionOnly=true` 可用于非等价的几何诊断。`runtime=false` 冻结云、夜空、降水及动物行为；预览准备时间不能与正式 App 冷启动比较。

`tools/export-world.mjs <新目录> [day|night|rain|snow] [original|mc263] [main|all] [客户端JAR的明确路径]` 默认保持海岛／海岸两场景，`all` 补山谷／空岛。MC 只通过正式有界解析器读取本地资源，记录摘要，不把客户端 JAR 放进预览；参考端使用同摘要的规范化资源文件，不以原创材质代替。末尾加 `--inventory-only` 只做生产场景盘点；该结果不能用于 native 构建。完整导出、预算和程序读取通过仍不是 P1 自动验收。

`world-core:auditFrozenInputs -Pp1AuditInput=<完整冻结输入> -Pp1AuditReport=<新JSON路径>` 使用实际 Kotlin 协议、程序和预算读取器做离线预检。未知程序／活动属性保留为缺口并失败；即使通过，也不是 GPU、画面或设备性能验收。山谷瀑布采用确切源片段和独立 250ms 逐帧时间上限，空岛使用完整球面的夜空变体；共享时钟现为两个 RGBA32F texel，旧云／雨雪时钟含义不变。

当前导出 `exportSchema=10`：保留原始树林缓冲、两档装饰 LOD、天空／天体、点绘制范围、相机体积、雨雪完整容量和动物全体初态；跳过独立深度副本。BCP 布局 5 的辅助 texel 分别保存流体、云、降水或动物实例槽，布局 1—4 仍可读。高度采样为有摘要的 R32F 文件，不量化为 PNG；动物碰撞另存有摘要、有界的 BCA1 二进制。schema 7—9 的旧输入仍可读。已知休眠的外部材质属性只在选中顶点程序确实不读取时列为 inactive；未知或被读取的属性仍是缺口。

MC 图集的静态 UV／裁切／旋转／染色按可复用外观预求值，不按体素展开几何；`atlas-static-v1` 顶点标记必须和确切审过的图集程序对应。局部遮蔽、材质响应、流体高度和动画仍走已有实例行与 shader。动画查表保留非预乘 RGBA 字节；每页独立的时间表、页身份与 frames／blend 角色参与资源键，不因初始像素相同误合并。上传使用固定 staging 缓冲，背压时不堆队列。总实例按既有 64 MiB GPU 行预算计费，每源批次仍限 30 万；几何、纹理、载荷预算不变。

`verify-atlas-shaders.mjs <新目录> <完整MC输入目录>` 在真实 WebGL2 transform feedback 中比较实际源顶点程序与预求值后的原生材质，含六面、裁切／旋转、染色／遮蔽、流体与动画查表；与 Kotlin 的实际 TS 时间表 oracle 分开验证。不代替设备 BRDF、过滤、画面与完整内存对照。

当前光照路径还要求 `environment.schema=1`，记录源场景实际光源、半球光、曝光、雾、阴影及后处理参数；旧几何输入仍保留，但不再给它补写死的白天光照。面向／边缘着色只应用于 `reviewed-surface-programs.json` 审过的确切源码、defines、类型和缓存键，未迁移的同程序操作单列；这不是整段程序已支持。

普通源 bloom 路径使用线性 RGBA8 附件、半尺寸亮区与两次模糊，再执行 Three 的 ACES fit 和 sRGB 编码；HDR 色卡单独用 RGBA16F。半球光转换为含 Lambert 系数的两带 SH，正交阴影偏移转换为世界单位。水面／反射、源线性雾、天空／天体、云 Lambert 与平移按具体程序适配。实际源月亮的月相主体未注入，原生不擅自补遮罩，保留方形 Sprite。线性雾依赖固定版本的内部照明入口，升级需重编译复验，无方向光的该路径暂拒绝。Filament 的阴影过滤与 Three PCFSoft 不是同一实现，局部公式通过不代表逐像素等价。

相机按源包围体计算 near／far 和天空尺度，不按旧 near 简单缩放；源天空不再被引擎内置背景覆盖。装饰按源 30／42 CSS 像素迟滞切换已有批次，云与夜空共用时钟纹理。资源预算在分配前检查，明确区分输入 GPU 估算、渲染目标、驱动和进程内存。

`OwnerResources` 拥有一次世界代次内的批次，`ResourcePool` 按内容共享 GPU 几何／图像。局部更新先暂存、后切场景、最后释放；旧世界／旧 revision 在分配前拒绝。所有操作在同一渲染线程，不把暂存失败或退休清理失败当成可重放的成功。深度比较要按 Filament 的 reverse-Z 转换，不能直接复制源枚举名。

`tools/verify-owner-device.mjs <adb> <serial> <已安装同摘要APK> <新目录> [main|all]` 检查空闲、摘要、可见时钟与资源稳定，走两／四场景的失败暂存、单栋替换、旧更新拒绝、旋转和 Back 释放。脚本只操作预览包，结束后停止它，不改系统策略；截图仍须审看。`tools/capture-foundation.mjs <新目录> <冻结输入目录> [设备报告目录]` 归档同摘要 APK、包内输入、编译器与当前 JVM 结果，不代表 P1 自动通过。

`tools/verify-surface-shaders.mjs <新目录>` 将源 patch 与适配后的 GLSL 放进真实浮点 WebGL 目标，核对 441 组公式；不代表 Filament 整景验收。`verify-surface-device.mjs` 使用上述设备四参数，核对两场景面向着色／阴影的单变量开关及局部替换。`verify-color-device.mjs <adb> <serial> <同摘要APK> <冻结输入目录> <新目录>` 则将 64 块 HDR 色卡实际经过原生渲染目标和终端 shader，与当前 Three shader 比较，查重复编码、矩阵／曝光或方向错误。`colorProbe` 默认关闭，只用于这一隔离预览。

`verify-reference-device.mjs <adb> <serial> <同摘要APK> <新目录> [day|night|rain|snow] [default|sky|moon] [main|all]` 用同包的本地 WebView 运行当前生产 renderer。参考端读取合成资产里的冻结镜头，避免 CSS 重新拟合引入偏差；不接正式数据库。`sky` 检查地平线／裁面，`moon` 检查天体近景，不是正式缩放规格。原生对应截图用 `verify-surface-device.mjs` 的同名末参数。

`verify-weather-shaders.mjs <新目录>` 真实执行当前源与适配顶点 shader，核对高度、飘动、尺度与相机原点。`verify-weather-device.mjs <adb> <serial> <同摘要APK> <新目录> rain|snow` 检查同机冻结画面、覆盖／数量、仅降水运动、旋转缩放和释放；再用 owner 工具复验局部替换。雨雪每帧只改共享时钟，镜头变化才改覆盖参数；整批未启用实例脱离场景，最后一批至多额外折叠 1023 个实例，不因数量变化重建世界。未知 sampler 或缺少完整种子即拒绝。

`tools/verify-animal-device.mjs <adb> <serial> <同摘要APK> <新目录>` 以海岛鸟、海岸陆地／鱼／鸟核对同输入的近景、实际行为、实例上传和退出释放。参考端先在实际源 habitat 验证冻结初态再采用，避免另选出生位置；近景跟随是诊断，不用来测性能。姿态上传每批固定三个 staging buffer，驱动释放后才复用；无空闲缓冲时跳过旧姿态，不堆无限队列。owner 检查同时核对失败暂存不改碰撞、成功单次 revision 和过期拒绝。

`measure-orbit-device.mjs <adb> <serial> <同摘要APK> <新目录> [day|night|rain|snow] [static|dynamic] [1|2|3]` 采集暖机后三维旋转的精确 SurfaceFlinger 实际呈现，保留原始栅栏、画面和内存文本。默认仍是旧静态负控制；动态模式检查动物、降水和画质状态。Web 参考只走生产调度器，提交帧数不当作屏幕 FPS。内存按 ActivityManager 的 packageList 归属计入宿主和隔离 WebView 进程，不依名称猜子进程；Android 可得 PSS／Graphics 不等于精确独立显存。此项不是正式 App 冷启动或 P1 自动通过。

退出期间进程退休与活动采样分别处理：活动快照身份／字段必须完整，退出时无法形成完整快照就记录不可用，不用零替代。`verify-reentry-device.mjs <adb> <serial> <同摘要APK> <新目录>` 在同一宿主 PID 连续进出四次，补局部更新和每次资源释放，不是长期内存泄漏证明。`audit-p1-stage.mjs <新JSON路径>` 只汇总本轮冻结证据与明确的审图／阶段判断，不运行设备测试、不安装、不发布，也不自动开始 P2。

实施进度、命令与未过关事项集中在[开发记录](../../docs/versions/3.0.0-development.md)，原始输入与报告在 `artifacts/experiments/v3.0.0/`；旧 `spikes/native-*` 及其报告保留，只迁入已审查的代码。

## P2 数据层定点

`apps/android/android/gradlew.bat -p apps/native-android :domain-core:test :state-store:test :state-store-android:assembleDebug :state-store-android:lintDebug :state-store-android:assembleDebugAndroidTest` 不需要世界输入，也不构建正式／私人 App。JVM 存储测试使用真实 SQLite，Android 测试 APK 仅编译不表示已在手机通过；安装／实机另按授权进行。

正式 TS Oracle 在测试前由当前 `packages/domain/src` 生成。测试核对源码、生成器和历法依赖指纹，并比较完整规范化状态、事件、失败码和统计归属。SQL 表和恢复事务在 [Android SQLite 适配层](state-store-android)和[状态存储模块](state-store)。存储支持封套 1／2、每日一个合并根和最近两个操作回滚根。导入与恢复提高替换代次并撤销旧自动授权，损坏的原库保留供恢复。

大文本超出 Android CursorWindow 时，在同一事务内改用标量读取；正常小行仍走原批量路径。小存档仅在真实行证明完全相同时复用校验，大存档不保留多份证明。17 MiB 设备往返已通过，但 100 MiB 文件／512 MiB 展开是格式预算，不是所有设备的内存保证；完整容量上界仍需候选阶段验证。

刚保存的不可变文档只在真实 COMMIT 成功后建立预期行证明；回读仍比较全部实际记录、资产和本地控制，不只信任 revision。成本报告把事实事务确认、业务返回、宿主投影和测试诊断分开；旧 `savedNs` 不是两端相同的保存边界。

### P2 构建与设备入口

集成构建使用 `:domain-core:test :state-store:test :focus-core:test :world-core:test :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug`，并传 `-PworldInputs=<完整 P1 输入>`、`-PconstructionInputs=<完整 P2 施工输入>`、`-PmatcPath=<编译器>`。当前施工缓存仅覆盖海岛／海岸第一座工坊的全部 948 阈值，不是通用原生生成器；准备时间、体积和后续范围保留在阶段记录。缺失／未完成输入仍拒绝构建。

日常闭环入口为 `MainActivity --ez business true --es fixture ocean`；普通 P1 诊断入口不变。预览界面只够验证本阶段写入、专注、汇报、统计及备份，不是最终正式 UI。

以下工具均要求确切已安装 APK 摘要和新输出目录，只操作预览包。先取得实机授权；系统权限／电池的临时更改和全机深度空闲另按授权处理。

- `verify-p2-foreground-device.mjs <adb> <serial> <app.apk> <test.apk> <新目录>`：五项 Android 检查、实际界面开始／提交、活动世界和正式 TS 重放。
- `verify-p2-capacity-device.mjs` 使用相同五参数：大数据往返、上界拒绝、幂等及大单行；不是最大合法存档的堆内存保证。
- `verify-p2-crash-device.mjs` 使用相同五参数：实际 COMMIT 前杀进程、新 PID 恢复和同请求重试。中途的故意崩溃不是一次成功 JUnit。
- `verify-p2-background-device.mjs <adb> <serial> <app.apk> <新目录> [restricted|granted|exact-only] [short|extended-home|lock-auto|lock-zero-rest|deep-idle]`：绝对时间事实、旧通知和真实库恢复。三种能力条件分别要求通知／精确提醒均关闭、均可用、仅精确提醒可用，不能混作同一对照；电池策略另行实读。`deep-idle` 会影响全机，仅已有明确授权时使用；脚本结束实际解除模拟，不绕过锁屏。
- `measure-p2-integrated-device.mjs <adb> <serial> <app.apk> <新目录> [1|5] [ocean|coast|both]`：同包 Compose 控件、正式 TS／Three 与原生执行器／Filament。完整动物就绪后收呈现；一组只算预检查。初始造数与缓存预热不同，不据此验收整套 App 启动。
- `measure-p2-submission-device.mjs <adb> <serial> <app.apk> <test.apk> <新目录>`：同一真实执行器／SQLite 的五组提交阶段采样，含七次操作及正式 TS 重放，结束恢复原库。没有世界和 Compose 竞争，只用于解析／校验／记录准备优化；包含与独占阶段耗时分别统计，不能相加重复记账，也不替代活动世界反馈或整套启动验收。
- `audit-p2-stage.mjs <新检查点目录>`：冻结原有功能／世界检查点，保留旧宿主时间点的局限，不用于关闭后续存储测量补正。
- `audit-p2-correction.mjs <新检查点目录>`：核对新事务确认测点、受影响的设备返验、恢复和完整五组对照，冻结确切源码、APK 与旧证据的复用范围。两个审计工具都不运行实验或自动开始 P3；审图记录须由实际检查填写，文件非空或脚本退出 0 不代替审看。

手机交回时确认原库指针、通知、精确提醒及原电池策略均已恢复；不得仅因点按成功就标恢复完成。完整流程仍按仓库 [TESTING](../../docs/TESTING.md)执行，不把这组定点称为发布全量。

## Beta 通道

用正式签名构建。原生 Gradle 构建参数为 `-PnativeUpgradeCandidate=true -PnativeBetaNumber=N -PnativeBetaVersionCode=CODE`，目标为 `:app:recordUpgradeCandidate`，同样需要指定 Filament 编译器。给下一条版本线构建 Beta 时，加 `-PnativeBetaTargetVersion=X.Y.Z`。此任务先验证包内身份、正式签名和 16 KiB 对齐，再记录源码与产物摘要。

提交、推送、打标签和发布见 [Beta 发布](../../docs/TESTING.md#beta-发布)。正式包用 `-PnativeReleaseVersionCode=CODE` 代替两个 Beta 参数。根据已发布和已交付的同包名 APK 确定构建号，其中包括已发布的 Beta。自动与手动检查共用所选通道，手动安装 Beta 后默认跟随 Beta 通道，已有通道设置会保留。下载后核对发布资产的 SHA-256，安装前核对包名、版本和签名。 [GitHub Releases API](https://docs.github.com/en/rest/releases/releases)
