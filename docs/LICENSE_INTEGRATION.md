# 飞雷神接入 Menkyo 授权：实施方案

> 更新：2026-09-29。状态：**已确认，实施中**。取代 [PAYMENT_PLAN.md](PAYMENT_PLAN.md) 中的动态 Checkout、订单、安装绑定、邮箱验证和管理端设计；服务端设计以 Menkyo 仓库的 `ARCHITECTURE.md` 为准。

## 1. 目标与不做的事

在飞雷神里接入 Menkyo 的授权码模型：本地试用 → 一次性购买 → 领取授权码 → 本地验签缓存 → 低频刷新。**限制直接开启**（见 §7）。**发布约束**：开启限制的版本必须在 Menkyo 正式环境与 Stripe 正式收款可用之后才能发布，否则用户试用到期后无处购买。

不做：账号、邮箱、设备绑定、使用统计上传、服务端试用计时。Menkyo 不接收网页 URL、选中文字或操作次数。

## 2. 用户流程

| 场景 | 流程 |
| --- | --- |
| 试用 | 首次**成功且有效**的动作开始本地计时（与 `usage.js` 的"发起即计数"口径不同）。只打开轮盘、取消、失败、无效果不计时 |
| 购买 | 设置页「购买」→ 后台调 `POST /purchase` → 保存领取凭据（`storage.local` + `storage.sync`）→ 打开返回的 Stripe 链接 |
| 语言 | 做飞雷神国际化时，`start-purchase` 调 Menkyo `/purchase` 时带上界面语言 `locale`（`zh` / `ja` / `en`），Stripe 结账页和付款完成页会随之切换；不带则按浏览器语言 |
| 付款完成页 | Stripe 付款后跳转到 Menkyo 的 `/thanks/hiraishin`，付款后 1 小时内直接显示授权码（复制 / 下载备份）；设置页的自动领取不变 |
| 领取 | 付款要花用户一两分钟，期间设置页在后台，不检查。用户切回设置页（获得焦点或变为可见）时立即 `collect`；停留在页面上时每 20 秒一次，距最近一次切回超过 10 分钟后停止。另有「我已付款，重新检查」按钮；领到后展示授权码（复制 / 下载备份）并自动激活 |
| 激活 / 恢复 | 设置页输入授权码 → `claim` → 本地验签后缓存 token。国内渠道的码走同一个输入框 |
| 刷新 | `chrome.alarms` 每天一次，首次触发加随机偏移错峰；失败按 1h → 2h → 4h … 封顶 24h 退避。日常动作零网络 |
| 到期 | 暂停新的动作执行，发一条通知（点击打开设置页，已有逻辑）。设置、购买、激活、待处理选区的查看/复制/清除全部保留，不删任何数据 |

## 3. 授权状态

新增 `src/license.js`（注入 `api`、`fetch`、`now`，可在 Node 中用 fake-chrome 测试）。`storage.local.license`：

```text
{ version: 1,
  trialStartedAt,          // 首次成功动作的时间
  credential,              // 领取凭据，领到授权码后删除
  licenseKey,              // 用户的授权码（设置页可再次查看）
  token, tokenExp,         // Menkyo 签发的 JWS 与其到期时间
  lastRefreshAt, nextRefreshAt, failures,
  revoked }                // 仅在服务端明确回答"已撤销"时为 true
```

使用资格 `entitled()` 的判定顺序：

1. `token` 签名有效（内嵌 Menkyo 公钥，ES256 / ECDSA P-256）且 `bk === 'hiraishin'`，并且未过期 → **已购买**。
2. token 已过期，但最近的刷新失败是**网络或服务故障**，且仍在离线宽限期内 → 仍视为已购买。
3. 服务端明确返回 `license_revoked` → **已撤销**，清除 token（保留授权码以便用户查看、联系客服）。
4. 没有有效 token：试用未开始或未满期 → **试用中**；否则 → **已到期**。

网络错误永远不会把已购买变成未购买，只有服务端的明确撤销才会。

## 4. 统一的授权检查点

`controller.js` 新增一个 `requireEntitlement()`，在**所有会真正执行操作的路径**入口调用。除 `runAction` 外，下列路径都绕过它直接执行，必须逐一覆盖：

| 路径 | 位置 |
| --- | --- |
| 原生快捷键、面板 `run-action`、网页快捷键、网页轮盘普通动作 | `runAction` |
| 右键菜单 | `onMenuClicked` → `runTransfer` |
| 网页轮盘批量关闭：预览 / 确认 | `overlay-action`（close-right）、`overlay-confirm-action` |
| 工具栏轮盘批量关闭：预览 / 确认 | `popup-close-preview`、`popup-close-confirm` |
| 历史导航与跳转 | `navigate`、`jump` 消息 |
| 旧的关闭右侧消息 | `close-right` 消息 |
| 任务重试 | `retry-task` |

预览路径也要检查，否则用户会先看到确认卡片、确认后才被拒。不受限：`get-state`、`get-settings` / `save-settings` / `set-web-binding` / `sync-page`、`get-usage` / `reset-usage`、`list-tasks` / `remove-task`、授权相关消息。

被拒时返回 `{ status: 'license-required', message, notify: true }`，沿用现有的"非面板来源发通知"逻辑；面板里显示同一条消息和「购买 / 激活」入口。计数照旧：被拒的尝试不计入 `usageStats`（没有真正发起执行）。

## 5. 界面

- **设置页**新增「授权」区块：状态（试用剩余天数 / 已购买 / 已到期 / 已撤销）、购买按钮、授权码输入框、领取中的"等待付款确认"提示、已领到的授权码（复制、下载备份）。
- **工具栏轮盘**：只在试用最后几天或已到期时，在轮盘下方显示一行提示和「打开设置」。不在手势中途弹出购买网页。
- 新增消息：`get-license`、`start-purchase`、`collect-license`、`activate-license`、`refresh-license`，同步更新 `ui/shared/types.ts`、`ui/shared/api.ts` 与 `docs/ARCHITECTURE.md` §4。

## 6. 需要同时修改的地方

**Menkyo（服务端）**：为 `/purchase` 和 `/license/*` 加 CORS（处理 `OPTIONS` 预检，返回 `Access-Control-Allow-Origin`）。扩展后台跨域请求需要它；改成在 manifest 声明新的 host 权限会让 Chrome 在升级时停用扩展、等待老用户重新授权，所以不走那条路。这些接口不依赖 cookie，放开来源不扩大权限。

**Menkyo 签名算法改为 ES256**：ECDSA P-256 在 Workers 与各版本 Chrome 的 Web Crypto 中都受支持，飞雷神的 `minimum_chrome_version` 保持 121（Ed25519 需要 Chrome 137）。

**飞雷神 manifest**：不改最低版本，不新增权限（已有 `storage`、`alarms`、`notifications`）。

**文档**：更新 `docs/ARCHITECTURE.md`（新模块、消息、存储键）；`PAYMENT_PLAN.md` 顶部标注已被本文取代；隐私说明补充"购买时会把领取凭据摘要交给 Stripe，授权码只用于验证购买"。

## 7. 已确认的决定（2026-09-29）

1. **限制直接开启**，不设开关常量。
2. **签名改用 ES256**，最低 Chrome 版本保持 121。
3. **参数**：试用 14 天，离线宽限 14 天，每天刷新一次，token 有效期 30 天（服务端）。开启限制后这些就是用户实际遇到的规则；对外文案发布前再核对一次。
4. **老用户**：与新用户同一规则，升级后第一次成功动作开始 14 天试用。

## 8. 测试（只测关键行为）

- **没有漏网入口**：按 §4 的表逐条构造"试用已到期"状态，每一条都被拒，且不执行任何标签操作、不发起传送；试用中和已购买时同样的调用全部放行。
- **试用起点**：只在第一次成功动作时写入；失败、无效果、取消不写；后续成功不重置。
- **离线边界**：网络失败和 5xx 不改变已购买状态、在宽限期内继续可用；服务端 `license_revoked` 才撤销；宽限期过后才进入到期。
- **本地验签**：伪造签名、改动载荷、`bk` 不是 `hiraishin` 都拒绝。
- **领取与激活**：未到账时有界重试并停止；领到授权码后清除领取凭据；授权码格式大小写 / 空格容错。
- **刷新节奏**：成功后下一次约在一天后；连续失败的间隔递增并封顶；不存在持续轮询。

复用 `tests/fake-chrome.js`，`fetch` 通过依赖注入替换。另跑一次 `npm run check` 和冒烟测试；UI 改动截图确认。最后用本地 Menkyo（`wrangler dev`）加 Stripe 测试模式联调一次完整购买（需要 Stripe 测试凭据）。
