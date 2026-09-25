# V27 全量剩余工作接力入口

> **最新接续入口：2.0.0/32，极简开始按钮方案已获用户确认。** 见 [V27-MINIMAL-START-BUTTON.md](V27-MINIMAL-START-BUTTON.md)，下一位直接实施这一局部材料修复。Web types/117单测、独立源码E2E17pass/1既有skip已复测；按钮尚未改、无APK安装。下文29版本与DF-A2输入问题是旧检查点，后续UI已改为步进器；全量工程/真机/发布队列仍未自动关闭。

历史检查点：2026-09-07。当前顺序已由 2026-09-19 决定替代：其他未完项暂停并统一见 `docs/TODO.md`，优先同应用私有同步版与好友服务器；不再开发独立伴侣。当前方案见 `BLOCKCOLC-RELAY-PLAN.md` 顶部。下文保留旧接力证据，不作为当前待办入口。

## 0. 接手前五分钟

1. 读 `Tomato Clock.md`、本文件、`V27-DF-AUDIT.md` 顶部；原生/状态读 `ARCHITECTURE.md`，视觉读 `DESIGN.md`。按产品 skill 执行。
2. 实际主树是 `C:/Codex/tomato-clock`，大量用户/UI/core 未提交改动；旧 UI 树 `C:/Codex/blockcolc-ui-v27` 不是最新实现。不要整树覆盖、reset、用 HEAD 测试冒充 dirty tree 测试。
3. 当前 `version.json` 已核验 `2.0.0 / 29`，不是 27。新候选先核对设备已装版本与签名，不盲目降级或再次加版本。
4. 核对源码指纹、正在运行的任务、ADB，再决定复用哪些证据。最新审计产物 `apps/web/artifacts/df-ui-audit-20260907-a2/`；只在源码完全相同、相同测试边界时复用。
5. 不公开私有伴侣源码/APK/凭据。发布主应用、Git tag/GitHub Release 与用户最终验收仍需对应授权；部署私人服务器已授权，Docker 安装也已单独授权。

## 1. 当前已实测，不等同全量发布完成

- DF-A2：Web typecheck exit 0；Web 118/118 单测 exit 0；版本一致性 `2.0.0 (29)` exit 0。
- 实际 Vite 源码、独立42931端口、mobile-chromium/1 worker：settings-layout、minimal-achievement-entry、v21-marathon，12 passed/1既有 skipped，2.3分钟，exit 0；不是 production/full release gate。
- 五视口（360×800、412×915、915×412、768×1024、1440×900）×浅深：92 PASS/0 FAIL；九个 UI 文件前后 SHA-256 相同，pageerror=0。
- 360/412 ×100%/200% 根字号：七天按钮全部≥44×44，单行、无祖先裁切、实际中心命中；360 容器 clientWidth=scrollWidth=314，最小按钮44.84375。
- 普通马拉松清空/连续21、极简空稿禁用、关闭完整性隐藏两行且15秒值恢复、退出键盘路径、空闲/运行锚点及操作带高度通过。详细范围/新发现以 DF-A2 报告为准。
- 当前复查 ADB 无设备；本次没有主应用 APK 构建/安装。UI agent 的构筑不能自动算作包含本轮尚未验证原生桥代码。
- 伴侣前一次基础：application 62/62；私人服务13/13；本轮新 ApplicationService/TS接线类型检查和旧62测试通过，但新观察者/原生/Kotlin专测尚缺。下文明确区分草稿和已验证。

## 2. V27 全部需求的剩余队列

| 队列/负责人 | 当前事实 | 下一步与结束条件 |
| --- | --- | --- |
| DF-A2 / UI+审计 | 前轮五项的主路径已修，新增边界检查见审计顶部 | 修剩余明确问题；UI提交实际目录/哈希/exit/报告，核心独立复审；不得改测试为不符合需求的行为 |
| DF-UI-01～09 / UI | 七日、条件数值行、清空、计时锚点已实测；其余不是全量完成 | OnePlus按住开关/无蓝底/旋钮居中；真实长蓝图名两行/字号；标题旁入口44px与长名；双击/硬件返回/减少动态；启动只回滚动画、不撤回预加载；开始按钮主题色玻璃最终视觉确认 |
| DF-CORE-01 / core | schema12阈值1..60/default3、严格大于、保留关闭值已有领域/存储证据 | 最新树跑迁移/备份/失败回滚；真机阈值内外、锁屏/系统豁免/到点优先。不再重新设计字段 |
| MINI-27-01 / UI+core | 入口、偏好、恢复优先、deferred统一结算均已接线；本轮真实入口E2E通过 | 真机空闲启动→取消/提交→休息/继续→临时退出重入→后台/重载→最终汇报；普通/习惯宿主、丢计划/删宿主/无分配目标、写入失败；完整流程通过才整项关闭 |
| ACHIEVEMENT-27-01 / UI+core | 8项目录、只读缓存、统计与合并提示已接线 | 最新树确认首次/导入/回滚静默、真实完成只提示一次、与五秒警示/仪式互斥；unknown时间仍可unlocked，成就不反写进度/schema |
| RECOVERY-27-01 / core | 回执/提示链已有代码和定向E2E，旧用户真机反馈不可被自动化覆盖 | OnePlus复现一次离开→准确计数→既有五秒世界提示；重复事件不补弹、超限active=null；无真机证据不得标全部完成 |
| UI-27-01～04 / UI | 设置分组/返回层/toast动作/建筑语义和动画已有实现 | 走全返回栈、业务警告去设置、普通/极简建筑标签、深浅/减少动态；DF需求覆盖旧圆形/允许换行与新铺设动画要求 |
| UI-27-05～08 / UI | 组件与tokens有部分实现；缺当前主树 `V27-UI-RESULTS.md` | 页面对照表覆盖设置/任务创建/统计/计时/计划汇报/建筑记忆；删除真正被替代规则；5视口浅深/IME/焦点/200%/安全区证据；交完整RESULTS，不凭极简窄验收关闭所有页面 |
| ARCH-27-01 / core | 偏好/纯投影已提取，其余是方案 | 严格依 `V27-CORE-REFACTOR-PLAN.md` R0→R1→R2→R3→R4→R5；逐片验证与删除旧实现，不全重写底层 |
| PERF-27-01 / core | 尚无本轮可信A/B改善结论 | R6仅测后按收益实施；同设备/数据交错A/B：启动、全部页面就绪、首帧、热切页、世界重建、交互帧、内存、后台工作。不能首次点击延迟初始化 |
| ASSET-27-01 / core+UI | 现有母版/生成工具可复用，流水线未全验收 | 明确母版→派生→许可→哈希；原生通知图标、蓝图稳定标识不改；真实fixture校验且不提交用户/第三方原始资产 |
| TEST-27-01 / core | 分层发布套件存在，最慢项优化未完成 | `docs/TESTING.md` 与release suites分类检查；优化重复准备不减断言，不把不同源码/失败运行片段合成全通过；超时拆spec定位而非只看计数 |
| DOC-27-01 / 集成 | 本入口纠正状态，但现行文档仍有历史冲突 | 将确认事实直接更新产品/架构/设计；版本工作包历史保留并标覆盖；UI填写RESULTS、core填写CORE-RESULTS，不能只维护交接而永久保留错误“尚未接线” |
| ORIGINOS-27-01 / core/用户外部前置 | 研究完成，无已验证厂商适配 | 读 `docs/research/ORIGINOS-LIVE-ACTIVITY.md`；确认机型/OS/获准计时场景/能力参数/设备；缺准入或设备保留标准Android回退。不得伪装外卖等场景、擅申权限或承诺原子岛 |
| V27发布/真机 / 集成+用户 | 测试版本2.0.0/29，未证明正式发布门禁完成 | 见第4节。用户授权测试包不是线上发布/代签用户验收 |

## 3. 核心重构执行摘要（详细算法与失败路径看原计划）

R0：冻结已验收UI源码，记录入口/领域/存储/通知/生命周期/页面驻留基线。R1：纯展示状态、特征测试，不改timer真相。R2：唯一round-plan store及hook，先写存储再更新可见值；异常与跨宿主/恢复测试齐；这一步还应解决伴侣所需的持久化breakStartedAt。R3a：命令结果/警告/成就/仪式优先级；R3b：一次性生命周期回执，先复现再修队列外before/after潜在竞态。R4：逐个迁移confirm/start/finishBreak/skip/interruption/early/cancel/report，不改变普通习惯与deferred语义。R5：壳层与渲染宿主，单一所有权，证明旧WorldScreen等不可达后才删。R6：测量后才缩小更新成本。

每片交回：范围、源码指纹、成功/失败路径、命令最终exit与报告、剩余问题。不要同时换服务广播、根刷新、世界显示三层然后只跑一个UI截图。

## 4. V27候选与发布顺序

1. 先收DF剩余问题、核心数据风险；确认全部V27需求是完成、明确外部阻塞还是需用户决定延后，不能自行删发布范围。
2. 日常测试包按既有 `tools/Build-Verification-Apk.ps1`；正式候选按 `tools/Prepare-Release.ps1` 冻结源码全量门禁，只构建一次。先读脚本实际参数；不把新原生桥未测树直接覆盖用户已验收包。
3. 版本检查、全仓types/unit、发布套件分类、稳定生产E2E、fixturehash、Android unit/lint、资源/性能与恢复矩阵完成；3D/资源包单worker按配置，不拼接不同树。
4. 设备连接后 `tools/Install-ReleaseCandidate.ps1`，不清数据；每个构建/拷贝/下载/安装边界比较SHA-256以及包名/版本码/签名证书（主应用现行正式证书以工具实读为准）。
5. 真机锁屏、后台、最近任务上滑/进程回收、休息跳过、通知幂等与OnePlus降级如实记录；系统force-stop后必须重开，不宣称常驻。
6. 用户最终验收才运行Accept；用户另行授权发布才Publish。机器可证明的检查完成不等于用户已经接受。

## 5. 私有伴侣与服务器：当前可恢复检查点

独立私有目录：`C:/Codex/blockcolc-relay-private`。其 `AGENTS.md`、`README.md` 以及本体 `BLOCKCOLC-RELAY-PLAN.md` 是任务边界。**无远程仓库、源码/APK不发布，仅用户OnePlus。**网页Brutalism/Swiss独立规范；UI简单展示交UI，core持有协议/安全/计时/原生/核心视觉/审查。此项目不是擅自新增的V27发布必过云功能。

已存在代码：

- 主体 `packages/application/src/focus-export.ts`：五字段及UTC+8日总量纯投影，8测试；正常/提前/中断实际时长，估算不算actual。
- 新增草稿：ApplicationService `subscribeCommitted`；`apps/web/src/focus-export-coordinator.ts` 与bootstrap接线；`packages/platform-capacitor/src/focus-export.ts`；Android `FocusExportCache/Provider/Plugin.java`、manifest与MainActivity注册。无App/Settings生产修改、无主体上传配置。
- 原生意图：仅同签名且exact package `com.blockcolc.companion`，只读固定URI `content://com.blockcolc.app.focus/latest`；本地noBackup AtomicFile缓存只读投影，先写成功再notify；无伴侣不生成导出；替换备份rotate source epoch防止静默覆盖。
- 私服 `src/protocol.ts/store.ts/live-state.ts/server.ts/main.ts`、13测试已存在。SQLite只留每日总量/鉴权及技术meta；名称仅内存。上传Bearer与查看邀请分离，单次邀请换7日HttpOnly cookie，HTTP/SSE基础。
- 伴侣草稿 `companion/`：独立Gradle/AGP8.7.2/Kotlin1.9.24/min26/target35，package `com.blockcolc.companion`，JobScheduler内容触发+15分钟周期+重启重排，TLS上传days后live。极简原生状态壳非完成UI。尚未Kotlin编译、签名构建或真机安装。
- `tools/Invoke-PrivateDeploy.ps1`：受限SSH+固定known_hosts、二进制tar stdin、env/status等；仅执行过status，**没提交env、deploy/restart**。凭据不在仓库，实际临时文件在用户profile `.blockcolc/relay-deployment` 下、ACL仅当前用户。不得打印/复制私钥进文档/镜像。
- 已授权安装WSL Ubuntu-26.04 docker.io，安装exit0（Docker29.1.3依赖），服务可用性/资源限制测试仍未完成。不可把“安装完成”当镜像测试成功。
- 已只读查线上：running，当前 `hz-blockcolc:release-2e0e0a9c1a004b29`，上一 `hz-blockcolc:release-921c642cecb6456f`；公网当前是“服务空间已准备完成，等待发布应用”占位页。**不是本次伴侣服务已上线。**

## 6. 伴侣/部署剩余步骤（必须按依赖执行）

| 步骤 | 修改/测试重点 | 完成判据 |
| --- | --- | --- |
| S1 合同纠错与main观察者 | 新增observer成功/持久化失败/observer抛错/取消订阅/备份replace测试；禁止把通知权限当休息真相；无伴侣时当前草稿仍clone全state，应先presence gate再投影；避免事件队列无限增长与restore标记丢失 | 所有失败不影响本体，默认用户无额外投影工作，主服务/存储回归通过 |
| S2 休息与日补传 | 当前草稿首次休息用结束减当前偏好，恢复/偏好变化会不准，**不得上线**；在唯一已提交计划存储冻结真实breakStartedAt并迁移旧记录诚实降级；当前仅最近366天窗口，不能丢一年以上未传旧日；补分页/水位/重连修正 | 实时5字段符合合同；跨UTC+8午夜/断网/关机/延迟结算/跨年无伪造零或confirmed；日补传不刷新手机live年龄 |
| S3 原生桥安全 | Java编译/lint/unit；定义权限同时核对发送方/接收方uses-permission；exact UID/package/signature拒绝陌生调用、共享UID、错误URI、projection、写入；noBackup含技术meta及原子崩溃恢复；签名伴侣安装前后/重新安装 | 只有授权正式签名伴侣可读；Shell/异签APK真实拒绝；本体无网络上传/业务授权弹窗 |
| S4 Kotlin可靠同步 | 编译/lint/测试；JobScheduler触发与periodic分离；重排不可取消正在执行任务或重复上传无界；onStop取消在途网络/并发串行；时钟回退/409/401停重试告警、网络恢复重试 | 后台/进程结束/重启/Doze行为真实测量；不每秒唤醒、不绕过省电；只存技术状态，任务名不入伴侣日志 |
| S5 私服安全与持久化 | 同revision不同live payload当前只比capturedAt风险需修（避免持久化任务名/可字典攻击哈希）；精确TTL清空并广播；来源epoch恢复流程；SQLite一致备份/迁移可回滚；反向代理信任与限速、cookie/CSRF/CSP、stream/socket/body上限和慢连接 | 单元+真实HTTP/SSE+数据库扫描+abuse/load；源冲突failclosed，daily不覆盖旧源；运维恢复说明可执行 |
| S6 网页客户端/视觉 | 先core完成SSE重试、不可用才5分钟前台轮询，两者互斥；hidden断开、回来catchup、估算封顶、显示手机年龄；one-use邀请#fragment换cookie后清fragment；UI做五字段与日热力图/unknown不等于0；无React/3D/外字库 | core功能测试；UI五视口/键盘/44px/截图审查，低资源Swiss/Brutalism实际应用页；无任务名称日志/持久化 |
| S7 凭据与候选包 | 随机独立upload/viewer/session密钥只在受保护本机/环境；部署helper目前预期secrets.clixml尚未生成，不能明文Export-Clixml冒充加密；正式同主应用签名伴侣，APK仅个人安全存储 | 私钥不入repo/镜像/APK；APK只可含必要upload能力，绝不含SSH/viewer/session密钥；轮换/反编译风险明示；签名/哈希比较 |
| S8 Docker真实门禁 | 建Node24 Linuxamd64单镜像、非root10001、0.0.0.0:8080、readonly根、/data写、/tmp32MiB、0.5CPU/256MiB/noswap/128pids；运行完整服务HTTP测试及持久重启/负载；docker save未压缩tar | /healthz45秒内2xx；tar≤200MiB、展开≤512MiB/50000项/noVOLUME；镜像与tar哈希及资源实测，峰值/RSS可解释，目标<160MiB非承诺 |
| S9 真实链路与部署 | 合成数据端到端先过；先SSHstatus保留旧版本信息，再env整体替换、deploy SHA256 size二进制stdin；当前域名/限额看用户Downloads部署文档，禁止输出其私钥；线上Nginx SSE >60秒保持验证 | status与公网healthz/鉴权/页面/推送/重连/每日累计可复验；失败恢复上一容器/env，数据不会自动回滚；不得把端点200当全部完成 |
| S10 OnePlus交付 | 设备连接后签名匹配本体含桥版本+伴侣，升级不清主数据；APK构建/拷贝/安装每界比SHA256/包名/版本/签名；测试真实专注/休息/结束/断网补传/后台/锁屏/午夜 | 私人网站收到真实五字段和日总量，身份拒绝也实测；未连接/用户确认/OEM限制显式列出；更新双方文档后交付 |

## 7. 部署固定限制与操作安全

- 域名 `https://blockcolc.arcol.site`；Nginx→127.0.0.1:18081→容器8080；单镜像linux/amd64，不能上传源码ZIP/Compose；不得用公有CI上传私有源码构建。
- 256MiB/0.5CPU/128进程、/data独立盘可用约958MiB、/tmp32MiB、共享3Mbps；代理10req/s/IP burst20、10conn、body10MiB、read timeout60秒。SSE25秒comment不是手机同步。
- SSH仅status/logs/env/deploy/restart/stop/start/rollback，无SFTP/shell/任意宿主机权限，不绕过。env整体替换，不能漏配置；回滚容器/env不回滚SQLite，先设计备份/兼容迁移。
- 临时凭据到 **2026-09-14 00:00 UTC+8**；过期只影响后续维护入口，已运行服务继续。额度中断跨过此时间需联系所有者续入口，不能重用过期凭据或尝试绕过。
- 不新建公有repo、不上传私有APK到GitHub、不把个人endpoint/token放本体；默认本地离线用户不受影响。网页鉴权不能因“无业务授权弹窗”被取消。

## 8. 下次应从哪里继续

### 本次交接完成后继续推进的已验证切片

- Docker重试最终成功（覆盖下文初次EOF）：官方Node24-alpine digest e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf，已固定到Dockerfile；test镜像fdf39aac6641。以0.5CPU/256MiB/no-extra-swap/128pids/readonly根/tmp32MiB/network-none运行node真实HTTP loopback测试，13/13、约1.64秒、exit0。这里只证明受限容器内测试通过；尚无runtime持续负载/峰值、/data重启、Nginx、TAR大小或生产部署门禁结果。无需下次重新安装Docker；保留已拉镜像缓存，不盲目清理。

- S1新增5条ApplicationService观察测试：保存成功后通知、保存失败不通知、observer抛错隔离/取消订阅、通知权限拒绝仍有休息信号、导入/回滚/缺失状态恢复换源标记；application67/67与types exit0，Web types再次exit0。没有把S1全部关闭：无伴侣前置gate、事件队列/恢复flag以及S2时间合同仍待修。
- 主manifest显式补READ_FOCUS uses-permission；Gradle `:app:compileDebugJavaWithJavac :app:testDebugUnitTest` BUILD SUCCESSFUL/exit0（24秒，112任务中107复用缓存），FocusExportProvider.class存在，现有Android XML合计17tests/0fail/0error。未新增Provider身份instrumentation测试、未做release lint，不产生可安装候选；这不证明S3安全门禁通过。
- Docker daemon29.1.3/cgroupv2已验证；新增严格.dockerignore及Node24-alpine test/runtime多阶段Dockerfile，无secret/companion入构建context（本次发送41.47kB）。首次拉取4层后在registry-1.docker.io referrers请求EOF，build exit1；独立registry TLS探针也报unexpected EOF。基础镜像/容器资源测试尚未完成；不以此推定私人服务器故障、关闭TLS校验或改用未经核验的第三方镜像。
- DF-A2-01已真实复现于普通/习惯两入口（range.json），仍交UI返修；前轮其余主路径通过，不重开。主App/Settings终检哈希仍与审计一致。审计自建Vite42931已停止。

先读DF-A2最终结论并补明确UI剩余测试；本体重构按第3节独立队列，不抢占未交回UI文件。伴侣从S1/S2开始，当前原生/Kotlin草稿不是可发布物。每完成一步在本节加**实际**验证/退出码/源码指纹，不改写旧13/62测试冒充新增代码覆盖。只在S1～S8关键门禁齐全才做S9，不为赶额度带着已知不准的休息时间上线。
