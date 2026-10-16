# Chrome 网上应用店上架资料 · 0.2.0

状态：待发布候选。以下文案对应当前轮盘版本；提交前完成 `RELEASE_REVIEW.md` 中的人工验收。没有在本次工作中提交或发布。

> **收费口径（2026-09-30 已统一）**：14 天全功能试用，从首次成功动作开始计时；之后一次性购买，非订阅；价格待定，公布前文案不写金额。唯一的开发者服务器是授权服务，不含浏览数据。网站首页三语 FAQ、`llms.txt`、README 与隐私页保持同一说法；JSON-LD 的 `offers` 暂时删除，定价后再补。

## 字段来源

| 商店字段 | 来源 | 说明 |
| --- | --- | --- |
| 名称（标题） | manifest `__MSG_name__` | 构建时由 `src/locales/{zh,ja,en}/common.js` 的 `manifest.name` 生成 `_locales/{zh_CN,ja,en}/messages.json`。商店按用户语言显示，**不能在后台单独修改**，要改就改词典 |
| 短描述（摘要） | manifest `__MSG_description__` | 同上，来自 `manifest.description`，上限 132 字符 |
| 默认语言 | manifest `default_locale: "en"` | 其他语言的用户看到英文 |
| 长描述 | 后台“商品详情”，按语言分别填写 | 在后台切换语言后粘贴下文对应版本 |
| 截图、宣传图 | 后台，按语言可分别上传 | 未上传某语言的图时回退默认语言的图；商店截图没有说明文字字段，下文“截图说明”用于图中文字或替代文本 |
| 类别、官网、支持网址、隐私政策网址 | 后台，不分语言 | 类别：生产工具（Productivity）。官网 `https://hiraishin.44san.com/`；隐私政策 `https://hiraishin.44san.com/privacy`（英文，页内可切换中文 / 日文） |
| 单一用途、权限理由、隐私表单 | 后台“隐私”页，不分语言 | 见文末，供审核阅读 |

当前 manifest 文案字数（按 Unicode 字符计，均为 BMP 字符）：

| 语言 | 名称 | 字数（≤ 45） | 短描述字数（≤ 132） |
| --- | --- | --- | --- |
| 简体中文 `zh_CN` | 飛雷神 Hiraishin | 13 | 61 |
| 日本語 `ja` | 飛雷神 Hiraishin | 13 | 84 |
| English `en` | Hiraishin | 9 | 118 |

界面与网站语言：简体中文、日语、英语。默认跟随浏览器语言，设置页可切换。

---

## 简体中文

**名称**（manifest）：飛雷神 Hiraishin

**短描述**（manifest）：按住 Option / Alt 甩动轮盘，快速切换、整理和复制标签页，把选中文字发送到 ChatGPT / Claude。

### 长描述（可直接粘贴）

用轮盘快速操作浏览器。

按住 Option（Windows / Linux 为 Alt），甩动鼠标选择动作，松开执行。只按住不动不会弹出；停在圆心松手不执行，Esc 或右键取消。也可以点击工具栏图标，直接点击轮盘上的动作。

你的方向，你的动作
• 4 / 6 / 8 / 12 等分，每个分区可放入动作或留空。
• 工具栏与网页轮盘共用配置。
• 批量关闭右侧标签页会先显示数量，由你再次确认。

穿梭、整理、复制
• 在标签页切换轨迹中后退、前进，或切回上一标签。这不是网页地址的浏览后退。
• 移动标签到左侧、右侧、最左、最右或新窗口，保留相应分组。
• 复制标签页；复制一个或多个标签的链接，支持纯文本和 Markdown。

把选区发送给 AI
• 选中文字，通过轮盘、快捷键或右键菜单发送到 ChatGPT / Claude。
• 优先使用当前窗口最左侧的匹配对话页，没有则新建。
• 输入框已有草稿时暂停，不覆盖；失败的选区可在工具栏的待处理选区中重试填入、复制或清除。
• 可选发送后回到来源页面；支持自定义目标，自定义网站需要兼容的页面结构和正确的配置。

权限与边界
• 网页轮盘和网页快捷键需要你主动允许网页访问；Chrome 内部页面等受限页面不适用。
• AI 填入与发送需要目标网站权限和已登录账号，页面结构变化可能影响适配。
• 20 个浏览器命令可在 Chrome 快捷键管理中绑定；网页快捷键可使用 Ctrl+- 等组合。原生快捷键触发的关闭操作立即执行，轮盘入口会再次确认。
• 界面支持简体中文、日语和英语。
• 所有功能免费试用 14 天，从第一次成功执行动作开始计时；之后一次性购买，不是订阅。

想要什么功能
告诉我们：https://koe.44san.com/hiraishin?lang=zh 。新的动作大多来自用户的需求。

数据与隐私
设置和标签轨迹保存在本机。扩展不收集浏览数据，没有统计或广告；唯一的开发者服务器是授权服务，只用于购买、激活和校验授权，请求中不含浏览数据。只有你主动填入或发送时，文字才交给你选择的目标网站。待处理选区临时保存在浏览器会话中，最多 30 分钟供恢复。第三方网站的数据使用由其隐私政策和你的账号设置决定。

### 截图说明

| 文件 | 状态 | 图中文字 / 替代文本 |
| --- | --- | --- |
| `store-assets/01-wheel-settings.png`（1280×800） | 已有，中文界面 | 自由配置轮盘：4 / 6 / 8 / 12 等分，每一瓣放入你的动作 |
| 网页轮盘（1280×800） | 待拍 | 按住 Option / Alt 甩动，松开即执行 |
| 关闭右侧标签页确认（1280×800） | 待拍 | 批量关闭右侧标签页前，先显示数量并确认 |
| `store-assets/promo-440x280.png` | 已有，中文 | 飛雷神 · 一甩即达。按住 Option / Alt，甩动选择 |

---

## 日本語

**名称**（manifest）：飛雷神 Hiraishin

**短い説明**（manifest）：Option / Alt を押しながらマウスを振ってホイールを開き、タブの切り替え・整理・コピー、選択テキストの ChatGPT / Claude への送信をすばやく。

### 詳細な説明（そのまま貼り付け可）

ホイールでブラウザをすばやく操作。

Option（Windows / Linux では Alt）を押しながらマウスを振ってアクションを選び、離すと実行します。キーを押したまま動かさなければ何も表示されず、中心で離しても実行されません。Esc キーか右クリックでキャンセルできます。ツールバーのアイコンをクリックして、ホイール上のアクションを直接クリックすることもできます。

方向もアクションも自分で決める
• 4 / 6 / 8 / 12 分割から選べ、各セクターにアクションを入れるか空けておけます。
• ツールバーのホイールとページ内ホイールは同じ設定を共有します。
• 右側のタブをまとめて閉じるときは、閉じる数を表示して、もう一度確認してから実行します。

移動・整理・複製
• タブの切り替え履歴をたどって戻る・進む、または直前のタブに切り替えます。ページ内の「戻る」とは別のものです。
• タブを左、右、先頭、末尾、新しいウィンドウへ移動し、タブグループも維持します。
• タブを複製し、1 つまたは複数のタブのリンクをプレーンテキストまたは Markdown でコピーします。

選択テキストを AI に送信
• テキストを選択し、ホイール、ショートカット、または右クリックメニューから ChatGPT / Claude に送信します。
• 現在のウィンドウで一番左にある該当のチャットタブを使い、なければ新しく開きます。
• 入力欄に下書きがあるときは止まり、上書きしません。失敗した選択テキストは、ツールバーの「保留中の選択テキスト」から再入力、コピー、削除ができます。
• 送信後に元のページへ戻ることもできます。カスタム送信先にも対応していますが、カスタムサイトには互換性のあるページ構造と正しい設定が必要です。

権限と制限
• ページ内ホイールとページ内ショートカットを使うには、サイトへのアクセスを許可する必要があります。Chrome の内部ページなど、制限されたページでは使えません。
• AI への入力と送信には、送信先サイトへのアクセス許可とログイン済みのアカウントが必要です。サイトのページ構造が変わると、うまく動かなくなることがあります。
• 20 個のブラウザコマンドは Chrome のショートカット設定で割り当てられます。ページ内ショートカットでは Ctrl+- などの組み合わせも使えます。ネイティブショートカットで実行したタブを閉じる操作はすぐに実行され、ホイールからの場合は確認があります。
• 画面は日本語・英語・簡体字中国語に対応しています。
• すべての機能を 14 日間無料でお試しいただけます（初めて操作が成功したときから開始）。その後は一度の購入で使い続けられます。サブスクリプションではありません。

欲しい機能を伝える
https://koe.44san.com/hiraishin?lang=ja からお知らせください。新しい動作の多くはユーザーの要望から生まれています。

データとプライバシー
設定とタブ履歴は端末内に保存されます。閲覧データは収集せず、分析や広告もありません。開発者のサーバーはライセンスサービスのみで、ライセンスの購入・有効化・確認にだけ使われ、閲覧データは含まれません。選択テキストは、あなたが入力や送信を実行したときにだけ、選んだ送信先サイトに渡されます。保留中の選択テキストは、復元のためにブラウザのセッション内に最大 30 分間だけ一時保存されます。第三者のサイトでのデータの利用は、そのサイトのプライバシーポリシーとアカウントの設定によります。

### スクリーンショットの説明

| ファイル | 状態 | 画像内の文言 / 代替テキスト |
| --- | --- | --- |
| 設定ページ（1280×800） | 日本語 UI で撮り直し | ホイールを自由に設定：4 / 6 / 8 / 12 分割、各セクターに好きなアクションを |
| ページ内ホイール（1280×800） | 未撮影 | Option / Alt を押しながら振って、離すと実行 |
| 右側のタブを閉じる確認（1280×800） | 未撮影 | 右側のタブを閉じる前に、閉じる数を表示して確認 |
| プロモーション タイル（440×280） | 日本語版を作成 | 飛雷神 · ひと振りで届く。Option / Alt を押して振って選ぶ |

---

## English

**Name** (manifest): Hiraishin

**Summary** (manifest): Hold Option / Alt and flick for a radial menu: switch, tidy and copy tabs, and send selected text to ChatGPT / Claude.

### Description (ready to paste)

Drive your browser fast with a wheel.

Hold Option (Alt on Windows / Linux), flick the mouse toward an action and release to run it. Just holding the key shows nothing, releasing in the center does nothing, and Esc or right-click cancels. You can also click the toolbar icon and click an action on the wheel.

Your directions, your actions
• Split the wheel into 4 / 6 / 8 / 12 sectors; put an action in each one or leave it empty.
• The toolbar wheel and the in-page wheel share one configuration.
• Closing tabs to the right in bulk shows the count first and waits for you to confirm.

Navigate, arrange, duplicate
• Go back and forward through your tab-switching trail, or switch to the previous tab. This is not the page's own Back navigation.
• Move tabs left, right, to the start, to the end or to a new window, keeping their groups.
• Duplicate tabs, and copy the links of one or more tabs as plain text or Markdown.

Send selections to AI
• Select text and send it to ChatGPT / Claude from the wheel, a shortcut or the right-click menu.
• Uses the leftmost matching chat tab in the current window, or opens a new one.
• If the input box already has a draft, it pauses instead of overwriting it; failed selections can be filled again, copied or cleared from Pending selections in the toolbar popup.
• Optionally return to the source page after sending. Custom targets are supported; custom websites need a compatible page structure and correct configuration.

Permissions and limits
• The in-page wheel and in-page shortcuts require you to allow site access; they don't work on restricted pages such as Chrome's internal pages.
• Filling and sending to AI require access to the target website and a signed-in account; changes to the website's page structure may affect compatibility.
• 20 browser commands can be bound in Chrome's keyboard shortcut settings; in-page shortcuts can use combinations such as Ctrl+-. Close actions triggered by native shortcuts run immediately, while the wheel asks you to confirm.
• Interface in English, Simplified Chinese and Japanese.
• Every feature is free to try for 14 days, starting the first time an action runs successfully; after that, a one-time purchase. No subscription.

Request a feature
Tell us at https://koe.44san.com/hiraishin?lang=en — most new actions start as user requests.

Data and privacy
Settings and the tab trail are stored on your device. The extension collects no browsing data and has no analytics or ads. Its only developer server is the license service, used to buy, activate and verify a license, and those requests contain no browsing data; text goes to the target website you chose only when you explicitly fill or send it. Pending selections are kept temporarily in the browser session for up to 30 minutes so you can recover them. How third-party websites use your data is governed by their privacy policies and your account settings.

### Screenshot captions

| File | Status | Text in image / alt text |
| --- | --- | --- |
| Settings page (1280×800) | Retake with English UI | Set up your wheel: 4, 6, 8 or 12 sectors, each with the action you choose |
| In-page wheel (1280×800) | Not yet taken | Hold Option / Alt, flick, release to run |
| Close tabs to the right confirmation (1280×800) | Not yet taken | See how many tabs will close, then confirm |
| Promo tile (440×280) | Make an English version | Hiraishin · One flick away. Hold Option / Alt and flick to choose |

---

## 单一用途（审核说明）

通过可配置轮盘快速执行当前浏览器工作流中的标签与选区动作：切换、整理、复制标签，以及把主动选择的文字交给用户指定的目标网站。快捷键和右键菜单是同一动作集合的辅助入口。

English (for the dashboard): Quickly run tab and selection actions in the current browsing workflow from a configurable wheel: switch, arrange and duplicate tabs, and hand text the user explicitly selects to a target website the user chooses. Shortcuts and the right-click menu are secondary entry points to the same set of actions.

## 权限理由（审核用）

| 权限 | 实际用途 |
| --- | --- |
| tabs | 查询标签标题 / 网址以识别标签、复制链接、匹配目标网站及计算动作可用性 |
| tabGroups | 将标签移至新窗口时保存分组名称、颜色与关系 |
| storage | 本机配置；会话内标签轨迹与短期待处理选区 |
| scripting | 注册网页轮盘 / 快捷键，在触发时读取选区、注入目标适配 |
| activeTab | 用户触发工具栏、原生命令或右键动作时读取当前标签选区 |
| contextMenus | 选中文字后的发送入口 |
| notifications | 操作失败、无可用对象或无法确认结果时提示；不发送营销通知 |
| alarms | 清理过期的待处理选区 |
| offscreen, clipboardWrite | 用户触发时通过离屏页面复制标签链接；不读取剪贴板 |
| 可选 http://*/* 与 https://*/* | 用户授权后的网页轮盘 / 快捷键；对 AI 目标也可单独按域名授权 |

没有远程执行代码、eval 或下载后执行的脚本。业务脚本与 React 均打包在扩展中；访问 AI 页面是用户触发的网页操作，不是加载扩展代码。

## 隐私表单与链接

- 处理的数据包括标签标题 / URL / 切换轨迹，以及用户主动选择的网页文字和目标输入区状态。按商店表单对“浏览活动”“网站内容”等类别的实际定义逐项填写，不能仅因没有自建服务器就宣称完全不处理用户数据。
- 声明不售卖数据、不用于广告或征信；处理只服务上述用户可见功能。文本发送至第三方网站是核心功能的一部分，应披露。
- 隐私页面三种语言：`site/privacy.html`（英文，`https://hiraishin.44san.com/privacy`）、`site/zh/privacy.html`（`/zh/privacy`）、`site/ja/privacy.html`（`/ja/privacy`）；扩展包内同路径也可打开。上架前必须部署为公开 HTTPS 页面，并在商店填写实际可访问的 URL（建议英文根地址）。
- 支持邮箱 / 支持网址、主页、商店 ID 由发布者填写真实值；当前未替你猜测或提交。

## 商店图像与真实页面验收

- 128×128 图标：`icons/128.png`。
- 必需的小宣传图：440×280，见 `store-assets/promo-440x280.png`（目前只有中文版）。
- 截图至少 1 张，1280×800 或 640×400。已准备真实设置页 `store-assets/01-wheel-settings.png`（1280×800，中文界面）；日文、英文界面需在本地化完成后分别重拍，后续可补网页轮盘与危险操作确认截图。勿伪造真实 AI 发送成功图。
- ChatGPT / Claude 登录后的发送效果截图，须在真实账号验收通过后再制作；当前 fixture 验证不能替代此项。

官方核对来源（2026-09-25）：[图像要求](https://developer.chrome.com/docs/webstore/images)、[隐私表单](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)、[用户数据政策](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)。
