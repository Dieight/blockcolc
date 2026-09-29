# 2.0.0 手动探针与展示样例（仅历史）

2026-09-27 从 apps/web/tools、apps/web 的临时样例及根 tools 归档 26 个文件。
移动后逐文件比对 SHA-256，原文和原路径层级保留。
这些文件没有 npm/workflow 调用；有能力断言的回归 spec、diagnostics 配置、共享 fixture、compare-shot 通用工具仍在当前目录。

这里不是新的 runner 或产品入口。部分相对 imports、旧服务器端口和历史截图路径依赖旧布局，不能直接运行。
若某段探针确有复用价值，先在当前 tools 中建立能力命名入口和有效断言，再引用现行代码。
不要把历史 probe 的截图成功当成当前候选验收。
