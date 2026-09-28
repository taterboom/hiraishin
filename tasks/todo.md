# Hiraishin 首发实现（依据 docs/PRODUCT_TECH_SPEC.md v0.3）

## 步骤 0：适配可行性验证
- [x] 无法在本环境登录 ChatGPT / Claude；适配器按已知 DOM 编写并标注“待真实页面核对”（README 注明）；通用适配器已用本地 fixture 页面在真实 Chrome 中验证填入 / 提交 / 草稿 / 返回

## 步骤 A：统一动作与入口
- [x] src/keys.js 组合键解析、规范化、原生可用性判断
- [x] src/actions.js 动作注册表（含自定义目标的动态动作）
- [x] src/settings.js 设置默认值、v1→v2 迁移
- [x] src/shortcuts.js 网页快捷键：有效 keymap、内容脚本注册、即时注入、原生回读
- [x] src/page-shortcuts.js 通用 keymap 监听
- [x] manifest.json：23 个命令、权限、options_ui、Chrome 121
- [x] options.html/js/css 设置中心：常用动作、快捷键录入、目标管理、行为开关
- [x] popup：常用动作、动作搜索、历史、MRU、待处理选区、状态
- [x] 右键菜单

## 步骤 B：Tab 能力整合
- [x] src/tab-ops.js：上一 Tab、MRU、左右首尾移动、指定位置、移到新窗口（含分组 / 固定）、复制、复制链接
- [x] offscreen 剪贴板

## 步骤 C：目标直达
- [x] src/targets.js：内置目标、匹配、当前窗口最左侧、查找或新建、去重

## 步骤 D：选区传送
- [x] src/selection.js 读取真实选区（activeTab + scripting，selectionText 回退）
- [x] src/page-adapter.js ChatGPT / Claude / 通用适配
- [x] src/transfer.js 任务编排、草稿、超时、回执、返回、失败保留 + alarms
- [x] src/notify.js 通知
- [x] src/page-selection-button.js 浮动按钮

## 步骤 E：验收
- [x] 测试：keys、actions/manifest 一致性、settings 迁移、tab-ops、targets、shortcuts、transfer
- [x] scripts/check.mjs 扩展 + JSDoc checkJs
- [x] README 更新
- [x] npm test / npm run check / npm run package 通过

## Review
- 单元测试 77 项通过（`npm test`），`npm run check` 含 JSDoc checkJs 通过，`npm run package` 产出 dist/hiraishin-0.2.0.zip。
- 真实 Chrome for Testing 冒烟（scratchpad/smoke/run.mjs，headless=new + CDP）：历史、上一 Tab、复制、移动、新窗口分组、关闭右侧、自定义目标填入 / 发送 / 草稿 / 返回 / 重试、网页快捷键注册与按键、面板与设置页渲染均通过；后台 / 面板 / 设置页无异常。
- 子代理代码审查提出 10 项，已修复：任务异常收尾、适配器重注入、面板发起的传送失败通知、设置变更串行化、发送按钮启用等待、macOS v1 迁移、done 任务清理、默认目标校验、复制互斥、iframe 站点判定、选区被拦截的独立状态。
- 未完成：步骤 0 对真实 ChatGPT / Claude 页面的核对需要登录环境，README 已注明；`clipboardWrite` 权限因离屏复制被拒而补充。


# 第二轮：用户第一批反馈（2026-09-16）

- [x] 记录反馈到 tasks/lessons.md 与记忆
- [x] 方案 v0.4：R24 React + TS 构建、R25 架构文档、第 14 节传播与被发现、第 15 节商业化、R26/R27
- [x] 构建链：esbuild（scripts/build.mjs）、tsconfig.ui.json、npm run build / dev；dist/hiraishin 为加载目录
- [x] 面板与设置页迁移为 React 19 + TypeScript（ui/popup、ui/options、ui/shared 类型化消息客户端）
- [x] 权益分层 src/entitlements.js + settings.plan + save-settings 闸门 + 设置页提示
- [x] docs/ARCHITECTURE.md
- [x] site/：index.html（JSON-LD SoftwareApplication / FAQPage / HowTo）、llms.txt、robots.txt、sitemap.xml、actions.json（构建生成）
- [x] docs/STORE_LISTING.md
- [x] README：首屏定位句与关键词、FAQ、构建流程
- [x] check / package / smoke 适配构建；smoke 选择器适配 React

## Review（第二轮）
- npm test 79 通过；npm run check（构建 + 两套 tsc）通过；npm run smoke 29 项通过；npm run package 产出 0.2.0 zip。
- 未做：GitHub Pages 发布与 Web Store 上架是账号侧操作；Pro 支付未接入（按方案首发不启用）。


# 第三轮：用户第二批反馈（界面，2026-09-18）

- [x] 面板：搜索收进“动作”标题右侧放大镜，点击展开；搜索时切列表布局
- [x] 面板：动作改为三列九宫格方块，带图标与按压塌陷效果（ui/popup/icons.tsx）
- [x] 面板：删除“收好工作区”独立区块，关闭右侧作为普通动作留在方块区
- [x] 面板：历史与最近使用副标题写明区别（轨迹带游标 vs 去重按最近激活）
- [x] 设置页：导航改为左侧粘性侧栏，IntersectionObserver 跟踪当前区块
- [x] 设置页：每行只留一个可点键位按钮，悬停出现清除叉号（去掉修改/录入/清除三个文字按钮）
- [x] R28：发送为主入口，右键菜单只列“发送到 X”（不能发送的目标才列填入）
- [x] 冲突识别：原生默认键未生效提示、保留组合预警（src/keys.js reservedReason）、试按区
- [x] 文档：方案 v0.5（6.6 节三层冲突识别 + 验收项）、架构说明界面层与扩展点、README FAQ（历史 vs MRU、冲突识别、offscreen 用途）

## Review（第三轮）
- npm test 80 通过；npm run check 通过；npm run smoke 32 项通过（新增方块布局、收起式搜索、侧边导航、单键位目标、试按区保留组合四项断言）。
- 询问已答：offscreen 用于后台复制剪贴板；冲突识别三层能力与边界见方案 6.6。


# 第四轮：用户第三批反馈（面板视觉，2026-09-18）

- [x] 动作面板改为整块容器：一圈圆角描边，内部格子贴合，分隔线由容器背景透过 1px grid gap 形成
- [x] 按下效果改为格子内陷（背景加深 + 内阴影），不再位移，贴合布局下不适合位移
- [x] 删除标签历史区重复的前进 / 后退按钮，只保留轨迹列表
- [x] 删除最近使用区块，并清理后端死代码：PanelState.mru、activate-tab 消息、tabOps.mruList、api.activateTab、相关 CSS
- [x] 方案 v0.6（R29、F02 收窄、F15 收纳 MRU、新增三条验收）、架构说明、README 同步

## Review（第四轮）
- npm test 80 通过；npm run check 通过；npm run smoke 33 项通过（新增断言：面板为单块描边容器、格子无自身圆角与描边、1px gap 分隔、无最近使用与重复导航区块）。


# 第五轮：用户第四批反馈（面板细节，2026-09-18）

- [x] 设置图标由圆形加放射线（易读成日光 / 深色模式）改为滑块图标
- [x] 搜索改为 iOS 式原地展开：圆形放大镜在同一行横向展开为胶囊输入框并覆盖标题，标题淡出，失焦或 Esc 收回
- [x] 每个格子保留一行按键位置：已绑定显示按键芯片，未绑定显示虚线空位
- [x] 方案 v0.7（R30 与三条验收）、架构说明同步
- [x] 冒烟新增两项断言：胶囊在同一行内展开且标题淡出、虚线空位为 dashed 且无文本

## Review（第五轮）
- npm test 80 通过；npm run check 通过；npm run smoke 34 项通过。
- [x] 视觉规则：删除设置页侧栏「圆角 + 单边 border」的选中态，改为纯背景填充；在 scripts/check.mjs 加入自动校验并做过反向验证（故意写回该样式会 check 失败）
- [x] 清理 popup.css 中随区块删除而失效的 .cleanup-section、.settings 规则
- [x] 虚线空位实测后收窄：原 26x16 比按键芯片 22.9x16 更宽，改为 20x16 并调浅描边；冒烟改为实测两者尺寸并断言空位不大于芯片
- [x] 虚线空位再次收小：等高的空心描边仍显重，改为占位 16px 但只画 20x10 的矩形；共享规则的 min-height 会覆盖 height，已把空位拆出单独定义
- [x] 虚线空位定为 20x14（与芯片 22.9x16 同长宽比，小一号），并新增 npm run shot 按 3 倍截图复核视觉细节
- [x] 按下反馈重做：去掉 inset 模糊阴影，改为底色加深 + 1px 上边缘实线 + 内容下移 1px
- [x] 测试手段升级：用 CDP CSS.forcePseudoState 强制真实 :active 来测量与截图，生产 CSS 不再需要测试专用类；screenshot 支持 SHOT_ACTIVE / SHOT_PRE
- [x] 冒烟加入 popup 就绪校验（扩展页面可能因竞态落到 neterror 页，现在会重载重试）
- [x] 修复冒烟抖动：无头页面不推进 CSS 过渡（读到的是过渡起点中间值），改为注入 transition:none 后断言目标值；点击改用 Input.dispatchMouseEvent 派发真实输入；按下态的目标格子按「第一个可用」定位而非固定下标。连跑四次全部 35 项通过。

# 第六轮：用户第五批反馈（2026-09-18）

- [x] 浏览器快捷键与网页快捷键键位盒子高度不一致（19 / 21）：两条近似 CSS 规则合并为一条并写死 20px 高
- [x] 浏览器快捷键「未绑定」点击无反应：该列改为可点击按钮，直达 Chrome 快捷键页并提示要设置哪个动作
- [x] 删除快捷键表的「状态」列：多数状态从前两列即可看出；仅保留键位看不出的问题并就地提示
- [x] R32 填入不再独立提供：内置目标只保留前往 / 发送，原生命令 23 → 20；填入仅保留在「目标无法发送」与「草稿后重试」两处
- [x] R34 常用动作按分类分组（穿梭 / 整理 / 复制 / 带走 / AI 目标），并显示已选数量
- [x] 方案 v0.8、架构说明、README、附录 A 同步；冒烟新增 fill-only 目标覆盖追加草稿路径

## Review（第六轮）
- npm test 80 通过；npm run check 通过；npm run smoke 37 项通过。

# 第七轮：用户第六批反馈（2026-09-22）

- [x] R35 常用动作在分组内改为单列（原来 auto-fill 会排成三列）
- [x] R36 选区浮动组件：两个文字按钮（还带主次配色）改为单个 24px 小胶囊，图标加文字，只有一个动作、一种底色；实测 134x24
- [x] R37 ChatGPT 排首位并作为默认目标：BUILTIN_TARGETS 顺序即默认顺序，默认值、命令清单顺序、右键菜单、浮动组件默认目标随之变化
- [x] manifest 命令顺序重新生成；方案 v0.9、架构说明、README 同步
- [x] 冒烟新增两项：默认目标可指向自定义目标、浮动组件为单个小胶囊且在封闭 Shadow DOM 中

## Review（第七轮）
- npm test 80 通过；npm run check 通过；npm run smoke 39 项通过。

# 第八轮：用户第七批反馈（2026-09-22）

- [x] R38 动作面板由三列 78px 正方形改为两列 38px 紧凑行：16 个动作从 6 行约 470px 降到 8 行约 300px，不换行、无空格子
- [x] 面板专用短标签（actions.js 的 short 字段）：面板里「当前 Tab」是废话；完整名称仍用于设置页、搜索与快捷键表
- [x] 面板动作按注册表顺序排列，自然按分类聚集，不再受勾选顺序影响
- [x] 发现并修复样式表重复规则：popup.css 里整块 tile 规则有两份，后一份静默覆盖了我的改动；连带清理 .text-button 等历次追加的重复
- [x] scripts/check.mjs 新增重复选择器校验，按 @media 作用域区分，并做过反向验证
- [x] screenshot 脚本新增 SHOT_RELOAD，便于先写设置再截图
- [x] 方案 v0.10、架构说明同步；冒烟断言改为「所有行等高、两列、空位两维都小于芯片」

## Review（第八轮）
- npm test 80 通过；npm run check 通过；npm run smoke 39 项通过。

# 第九轮：用户第八批反馈（2026-09-22）

- [x] 回退 R38：动作面板恢复三列方块、完整标签、原有顺序；短标签字段删除（保留样式表去重与 check 校验，那是无关的修复）
- [x] R39 每个 AI 目标独立标记：targetMark() 算字母（ChatGPT→CG、Claude→CL）与域名哈希色相，叠加模式徽标区分前往 / 发送；试过 Chrome _favicon 但未访问过的站点会退化成同一个地球图标，故放弃并撤回 favicon 权限
- [x] 徽标由右下移到右上外侧，避免遮住第二个字母
- [x] R40 设置页合并：「常用动作」并入「快捷键」表，改名「动作」，新增固定列与行内图标，侧栏四项减为三项；「移到指定位置」的快捷键列文案改为「仅面板」
- [x] 图标与标记样式抽到 ui/shared/action-mark.css，面板与设置页共用
- [x] 方案 v0.11、架构说明同步；单元测试 81 项、冒烟 40 项（新增目标标记唯一性与合并表断言）

## Review（第九轮）
- npm test 81 通过；npm run check 通过；npm run smoke 40 项通过。

# 第十轮：用户第九至十一批反馈（2026-09-22）

- [x] 目标标记去掉背景色与按域名配色，只留字母 + 模式徽标（R42）
- [x] 搜索按钮与设置按钮尺寸统一为 30x30、圆角 8px、字形 16px，并加冒烟断言锁定
- [x] R41 设置页只剩动作表：删除侧边导航与两个区块，AI 目标与发送行为合并进弹窗，入口在 AI 分组行右侧
- [x] 修两处同类布局 bug：`display: flex` 加在 th / td 上导致 colSpan 失效与同行底边错位，改为内部套容器
- [x] 冒烟新增断言：分组行横跨全表（>95% 宽）、同一行所有单元格底边齐平，并做反向验证（重新加上 flex 会失败）
- [x] check 拦下我新写的 `.group-row th` 重复规则，已合并

## Review（第十轮）
- npm test 81 通过；npm run check 通过；npm run smoke 42 项通过；反向测试确认新断言有效。

## 第十一轮 · 网页内动作面板（R43 / F17）

- [x] 设置项 `overlay: { enabled, holdCode, holdMs }`，校验与 v1 迁移
- [x] `ui/overlay/` 独立 bundle：长按召出、鼠标滑选、松开或左键执行、右键 / Esc 取消
- [x] 封闭 Shadow DOM、零尺寸宿主、`unavailableReason` 与面板共用
- [x] `overlay-state` / `overlay-action` 消息边界：只回面板要画的东西，需要输入的动作被拒绝
- [x] 动态注册 + 注入已打开页面（每页 3 秒上限）
- [x] 设置页开关；默认关闭
- [x] 冒烟断言 5 项：召出 / 滑选高亮 / 松开执行 / 右键取消 / 输入框聚焦时不武装
- [x] 文档同步：spec R43 + F17 + 版本记录、ARCHITECTURE、README、lessons

## Review（第十一轮）
- npm test 81 通过；npm run check 通过；npm run smoke 45 项全部通过（0 失败）。
- 冒烟测试的长时间卡死定位为无头渲染进程在收到输入事件后停止响应 DevTools 协议，与产品代码无关（把 `show()` 清空后仍然复现）。已改为默认有头运行，`HEADLESS=1` 强制无头。
- 顺带修复：测试消息不再经由 popup 页转发（后台化的扩展页会停止执行并连累同进程的其他扩展页）；每个协议调用加超时、整轮加看门狗。
- 顺带改进：浮层的 mousemove 监听改为 passive，宿主元素由铺满视口改为零尺寸锚点。

## 第十二轮 · 浮层改用修饰键 + 复用 popup 方格面板（用户反馈）

- [x] 长按键改为修饰键：`holdCode` 支持 `auto` / `Meta` / `Alt` / `Control` / `Shift` 与单键；默认 `auto`（mac → ⌘，其他 → Alt）
- [x] 武装条件修正：允许长按键自身的修饰位，忽略 `repeat`，面板打开后按下其他键即关闭，松开时 `preventDefault`（压住 Windows 上 Alt 唤出 Chrome 菜单）
- [x] 默认长按时长 400 → 500 毫秒（修饰键是组合键的前半段，误触风险更高）
- [x] 设置页增加长按键下拉；文案随平台显示解析后的键名
- [x] 抽出 `ui/shared/ActionTiles.tsx` 与 `ui/shared/action-tiles.css`，popup 与浮层共用同一个方格组件与样式
- [x] 浮层只画固定的动作（与 popup 完全一致），面板中心对准鼠标并在贴边时收进视口
- [x] `overlay-state` 只回固定的动作，按固定顺序
- [x] 冒烟：手势改用修饰键；新增「面板中心对准鼠标」「角落召出不出画」「格子数等于固定动作数」断言
- [x] `npm run check` 的样式校验覆盖 shared 与 overlay 样式表
- [x] 单元测试覆盖新的 `holdCode` 取值与 KeyZ 迁移
- [x] 文档同步：R43 修订、版本记录、ARCHITECTURE、README

## Review（第十二轮）
- npm test 83 通过；npm run check 通过；npm run smoke 47 项全部通过（0 失败），其中浮层 7 项。
- 视觉复核：`SHOT_OVERLAY=<path> npm run smoke` 抓下网页里的面板（3×2 固定动作、中心对准鼠标、指针下的格子已高亮、禁用态置灰、提示行显示 ⌘ Command）；`npm run shot` 确认 popup 抽取共用组件后像素未变。
- 平台事实：Windows 的 Meta 是 Win 键、由系统接管，Alt 单击会唤出 Chrome 菜单，因此 `holdCode` 默认 `auto`，由 `resolveHoldCode` 按平台解析；松开时 `preventDefault` 压住 Alt 菜单。
- 顺带清理：popup.css 里 `.action-grid` / `.action-button` 等上一版布局的死样式已删除；`npm run check` 的样式校验从 2 个样式表扩展到 5 个。

## 第十三轮 · 网页内动作面板改为径向轮盘（用户反馈）

方格面板换成守望先锋式的表情轮：按住 ⌘ / Alt 300ms，以鼠标为圆心弹出轮盘，往某个方位甩即选中该扇区，松开执行；指针停在圆心死区内不算选中，松手什么也不做。

- [x] 设置：`overlay.slots`（独立槽位数组，长度即等分数，可取 4 / 6 / 8 / 12，条目可为空），`holdMs` 默认 300
- [x] 圆心夹进视口，保证每个方向都有至少一个半径的可移动余量；打开后需先移动一次才可能选中（贴边召出时指针本就偏离圆心）
- [x] 轮盘渲染：SVG 环形扇区 + 每瓣图标与短名，圆心显示当前选中项的完整名称或「松开取消」
- [x] 方向判定：`atan2` 以十二点钟为 0、顺时针；死区半径内为未选中；不可用的动作置灰且松手不执行
- [x] `overlay-state` 按槽位顺序返回（含空位），`overlay-action` 只接受槽位中的动作
- [x] 设置页：轮盘配置弹窗（等分数下拉 + 每一瓣一个动作下拉），入口在「网页内动作面板」开关旁
- [x] 冒烟断言重写：弹出、甩向某个方位高亮、松开执行该动作、死区松手不执行、右键取消、输入框内不武装
- [x] 把只剩 popup 使用的 ActionTiles 与其样式移回 `ui/popup/`
- [x] 文档：R45 取代 R44 的面板形态部分，README、ARCHITECTURE、版本记录

## 第十三轮补充 · 轮盘视觉（用户给了设计稿与三条反馈）

- [x] 磨砂玻璃盘（`backdrop-filter`）+ 纯图标扇区，名称只留在圆心
- [x] 缝隙改为固定像素宽度：`seamAngle(r) = asin(缝宽/2/r)`，修掉「靠圆心窄、靠外缘宽」
- [x] 选中态由深色块改为淡色填充（用户反馈「高亮太重」）
- [x] 去掉全部描边与金色指示弧（用户反馈「描边和黄色弧都不好看」）
- [x] 冒烟的二次召唤补上重试，消除偶发失败

## 第十三轮补充二 · 圆心收小 + 触发条件改造（用户反馈）

- [x] 圆心直径 104 → 80px（内半径 56 → 44），死区随之为 44px
- [x] 长按只上膛，鼠标位移 ≥ 6px 才显形，圆心落在起甩位置
- [x] `hide()` 补一次渲染：原本只清内部状态，DOM 里留着上次的选中标记
- [x] 冒烟新增「只按住不动鼠标什么都不出现」断言；召唤改为「按住 + 甩」两段式

## 第十三轮补充三 · Apex 式大圆盘（用户给了设计稿）

- [x] 圆盘放大到 444px，内圈 104px、死区 72px（甩出方向即选中，不必甩到图标上）
- [x] `backdrop-filter` 模糊整块圆盘（含中间的洞），深色环压在模糊之上
- [x] 每瓣一个图标，衬在按分类着色的菱形徽章上；禁用只灰徽章，不改扇区明暗
- [x] 跟随真实指针角度的方向指针（深底浅芯两道描边，任何背景都可见）
- [x] 选中瓣变亮 + 徽章放大加白圈 + 外缘白弧；动作名下挂为小药丸
- [x] 缝隙露出深色环底而不是页面，避免浅色页面上出现白条
- [x] 冒烟改为直接瞄准徽章，不再依赖对圆心位置的假设
- [x] 冒烟启动时拒绝连上遗留的浏览器实例（端口被占时直接报错退出）

## 第十三轮补充四 · 转白天模式（用户四条反馈）

- [x] 去掉方向指针
- [x] 去掉图标的彩色菱形底
- [x] 扇区首尾相接，取消缝隙（`SEAM` 与 `seamAngle` 一并删除）
- [x] 深色环改为浅色：淡色环面 + 更透的中间窗口 + 发丝分隔，选中瓣整片上色

## 第十三轮补充五 · 细节收尾（用户三条反馈）

- [x] 内圈半径 104 → 88（圆心再小一点）
- [x] 动作名从圆盘下方移回圆心（指针已去掉，中间空出来了）
- [x] 内外发丝线 1.5px → 1px
- [x] 冒烟截图改用录屏取帧：`Page.captureScreenshot` 会等窗口的合成器表面，窗口不在最前时永远不返回

## 第十三轮补充六 · 模糊、细线、裸文字（用户三条反馈）

- [x] 环带与圆心的不透明度降下来，模糊真正看得见；测试页加上彩色色块，否则纯白页上无从验证
- [x] 分隔线改为 0.6px 亚像素描边（1px 在高清屏上是两个物理像素）
- [x] 去掉圆心文字的底板；改为让圆心本身成为磨砂面的一部分，深色网页上也读得清
- [x] 冒烟的 `summon` 辅助改为自带重试、每次从「已关闭且已松键」的确定状态出发

## 第十三轮补充七 · 手感与配置面（用户四条反馈）

- [x] 撤回图标的浅色光晕，恢复纯图标
- [x] 死区 72 → 46px，起甩距离更短
- [x] 去掉长按等待：按下即上膛（`holdMs` 默认 0），甩动才显形
- [x] 设置页用同一个轮盘指派各方向的动作；几何从 `Wheel.tsx` 导出，两边共用
- [x] 冒烟新增设置页轮盘断言（点第 3 瓣 → 选中态与下拉同步）

## 第十三轮补充八 · 挖空圆心 + 设置页真复用（用户反馈）

- [x] `.glass` 加径向遮罩，把模糊限制在环带上；圆心成为不做处理的洞（用户在三个方案里选了「完全不处理」）
- [x] 设置页改为渲染 `Wheel` 组件本体并复用其样式表，靠 `transform` 缩放兼作固定定位的包含块
- [x] 选中分区走手势用的同一个 `sectorAt`
- [x] 冒烟断言改为驱动真实组件（按角度点击 → 选中态、下拉、圆心名称三处同步）

## Review（第十三轮）
- npm test 84 通过；npm run check 通过；npm run smoke 48 项全部通过（0 失败），轮盘 6 项：弹出、甩向某瓣高亮、死区松手不执行、松开执行选中项、贴角仍留一个半径余量、右键取消、输入框内不武装。
- 视觉复核：`SHOT_OVERLAY=<path> npm run smoke` 抓图确认扇区、图标与短名、圆心死区实体、禁用瓣置灰、淡淡的遮罩。
- 关键实现点：选择只由 `atan2` 的方位决定，距离只判断是否越过死区；圆心夹进视口后会偏离指针，因此打开后必须先移动一次鼠标才可能选中，否则贴边召出会凭空预选一瓣。
- `ActionTiles` 与其样式只剩 popup 使用，已从 `ui/shared/` 移回 `ui/popup/`。

# 第十四轮 · 上线前产品 review（2026-09-25）

流水线：npm test 98 通过、npm run check 通过、npm run smoke 67 通过、npm run package 产出 0.2.0 zip（30 文件，285 KB，无多余文件、无测试钩子）。
注意：同一工作树里有另一个会话在同时编辑（manifest 描述、site/privacy.html、popup 启用提示、smoke 追踪），本轮只输出 review，未改代码。

## P0（提交前必须）
- [ ] 隐私政策公开链接（另一会话已起草 site/privacy.html，仍需部署到可访问的 URL 并写进商店后台）
- [ ] 在真实登录的 ChatGPT / Claude 页面验收发送：探测 / 未登录 / 生成中 / 草稿 / 填入 / 提交（README 自己承认未做）
- [ ] manifest name / description 就是商店标题与摘要：去掉「工具箱」，确定最终标题（另一会话已改描述）
- [ ] 对外文案全部改到当前产品：23→20 命令、删除 MRU / 填入 / 浮动按钮 / 指定位置，补轮盘（STORE_LISTING、site/index.html、llms.txt、README 首句、ARCHITECTURE 55/170/224 行、spec 5.3 / 6.7 / 11 节）
- [ ] 「开源」但没有 LICENSE、没有 git remote、零 commit：加 LICENSE 并首次提交，或删掉「开源」措辞
- [ ] 商店截图按真实 UI 重拍（现在的脚本还在拍历史列表和状态列）

## P1（应修）
- [ ] 发送在未授权时于用户手势内直接 permissions.request（菜单 / 命令 / 轮盘），不要绕四跳到设置页
- [ ] onInstalled 首次安装打开设置页或欢迎卡；通知点击深链到目标弹窗
- [ ] overlay 243 KB 注入 allFrames:true + document_start → allFrames:false、document_idle
- [ ] 传送等待最长 35 秒无进度反馈：加 badge / 提示，并缩短超时
- [ ] 最小 i18n：_locales zh_CN + en 的 name / description / 命令描述
- [ ] 用词统一：Tab / 标签 / 标签页；面板 / 轮盘；「前往 默认目标」多余空格；transfer.js:17 的「改用填入」
- [ ] Free / Pro 徽标与「随 Pro 方案开放」在支付未接入前隐藏（保留 entitlements 闸门）
- [ ] 文档数字：README 死区 46→40、测试 84→98、冒烟 49→67；spec 头部版本 v0.12→v0.19；R44 / R47 / R48 已过时未标注

## P2
- [ ] tabGroups / notifications 改为 optional_permissions 缩短安装警告
- [ ] 多给两个默认键（切回上一 Tab、关闭右侧）
- [ ] 删除 api.ts 里无人调用的 navigate / jump / closeRight 与 controller 对应分支
- [ ] 深色模式
