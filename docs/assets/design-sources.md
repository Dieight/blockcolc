# blockcolc 设计来源

以下记录早期设计参考，方便查出处。当前要求以 DESIGN.md 为准。

## awesome-design-md

- [仓库](https://github.com/VoltAgent/awesome-design-md)
- 查阅提交：`664b3e78fd1a298ba11973822da988483256d4b4`。
- 参考了文档结构、语义 token、响应式要求和组件状态的记录方式。

## taste-skill

- [仓库](https://github.com/Leonxlnx/taste-skill)
- 查阅提交：`98565e65bc3274ddf6eb0838734341714057178b`。
- 参考了从具体需求出发、按钮可读性、素材选择和响应式检查。

这是来源记录，不是引入对应 skill、第三方执行规则或素材许可。

## v2.4 像素 UI

用户提供并批准作为打磨参考的 2026-10-02 本地 demo：`blockcolc-pixel-ui.html`，会话标识 `01a0fb8c-00ba-7320-bac4-1185af625922`。采用其像素图标与逐格反馈方向，结合现有中文排版、真实世界与液态玻璃；正式组件在工作区实现，构建不读取外部目录。第二轮按用户指定采用 pixel-soft 的方格日历、固定三小时四档和团簇上下标签；示例数据改为真实日期范围统计。

日历比较 F10 Dot Heat、L3 Barcode 和 L9 Almanac：后两种更偏单向记录和逐日密度，不能直接表达已批准的周历选择；保留 F10 的周/日布局，按明确要求改为等大方格和绝对档位，不再用相对峰值点面积。极简今日时间轴比较 F3 Hairline Area、F7 Stacked Rungs 和 L10 Radial Weave：沿用 F3 的时间顺序与轮廓，转换为十五分钟像素阶梯，实际时长单独显示，不把格子说成轮次。配色统一使用应用的绿灰语义色。

## v2.3 专注分配图

采用 `lieflat-charts` 的 L14 Hundred Field（Lupi gallery，A hundred of us, four minds）：用黄金角点簇表示时间占比，保留簇间细线、每第五点的辐线及独立标签。v2.4 将点换成像素，名称在簇上方、实际时长在下方，完整标题及精确占比保留在读屏列表。每像素约占总时长的 1%，按原始毫秒和最大余数法取整，不把像素误称为专注轮次。配色和字体沿用应用。

比较过 F4 Tick Donut 和 L5 Radial Convergence：前者又变回刻度表盘，后者需要逐条记录的连线归属，无法诚实表示旧的未分配时间。L14 更适合这里的任务占比；纪念建筑已有的小任务条形图不在本次替换范围。
