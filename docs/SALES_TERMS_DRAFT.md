# Hiraishin 销售与退款条款（三语草案）

起草日期：2026-11-04。**尚未生效，不作为已向顾客作出的承诺。** 本文件留在开发文档中，未加入网站或购买入口。

## 推荐方案与待确认信息

建议采用：**付款后 14 天内，不满意可申请全额退款**。这是一项拟议的自愿退款承诺，与已经实现的 14 天免费试用分别计算；不把 Stripe 的 60 天争议退款处理范围写成“60 天无理由退款”。

| 信息 | 当前依据 / 状态 |
| --- | --- |
| 对外品牌 | 44san。见 Menkyo 的 `STATUS.md` 与 2026-11-04 品牌记录 |
| 实际销售方 | 待核对 Stripe 收款主体的法定姓名 / 公司登记名称；不能仅用作者署名 taterboom 替代 |
| 经营所在国家 / 地区、个人 / 公司 | 已询问；不从日文站或时区推断 |
| 自愿退款政策 | 建议付款后 14 天内全额退款，待接受后才能生效 |
| 产品联系入口 | 现有 `https://koe.44san.com/hiraishin?lang=zh`；日英分别使用 `ja` / `en` |
| 付款角色 | 仓库记录为 Stripe Managed Payments 已启用；本轮正式 Payment Link 的只读 API 核对未完成。上线前确认具体链接启用状态及付款页条款 |
| 价格 | Menkyo 的 2026-11-04 进度记录为 USD 9.90 / JPY 1,400，首发 USD 6.00 / JPY 900，优惠截止 2027-01-31 23:59 JST。下方按此起草，发布前与正式付款页核对，不引用旧方案中的价格 |
| 价格税费口径 | 待核对 USD / JPY 标价是否含税、适用税费及结账总额；发布时在价格表明确注明含税或未含税，不能仅依赖付款页补充 |

Stripe Managed Payments 的当前条款区分 merchant of record 与 seller of record：交易处理不能替代实际销售方的产品责任及必要披露。若经营者在日本，还需落实特商法信息的公开方式；不要虚构姓名、地址或电话，也不要自动把 Stripe 的地址用作自己的经营地址。

下方的方括号均为**开发文档里的待补字段**，不得原样发布。正式生效日期及经营者披露落实后，再同步三语网站、扩展购买入口和 Stripe 付款页。

---

## 简体中文：购买、授权与退款

生效日期：[正式发布时填写]。本条款适用于生效后购买的 Hiraishin 使用授权，不减少你已享有的法定权利。

### 1. 销售方与联系方式

Hiraishin 由 [实际销售方的法定姓名 / 公司登记名称] 以 **44san** 品牌提供。产品、授权交付和使用支持由销售方负责；Google 不是销售方，也不处理本产品的付款或退款。

产品、授权和退款问题可通过[联系表单](https://koe.44san.com/hiraishin?lang=zh)提出。请填写可接收回复的邮箱，并提供订单编号或付款邮箱；不要发送完整银行卡号、安全码或账户密码。

[按经营所在国家 / 地区要求补充经营者信息或有效的请求后披露说明。]

### 2. 产品与价格

你购买的是 Hiraishin Chrome 扩展的使用授权，一次性付款，没有订阅或自动续费。

| 付款币种 | 通常价格 | 首发优惠价格 |
| --- | --- | --- |
| 美元 | US$9.90 | US$6.00 |
| 日元 | ¥1,400 | ¥900 |

首发优惠截至 **2027-01-31 23:59（日本时间）**。你只需支付结账时选择的一个币种。适用的优惠、税费和应付总额会在付款前显示；若付款页与上述金额不一致，请先联系销售方确认。购买通过付款页支持的方式完成，付款时间为你确认并完成购买时。

### 3. 免费试用

所有功能可免费试用 14 天，从首次成功执行有效动作时开始。试用不要求绑定银行卡，到期不会自动扣款。试用结束后，你可以自行决定是否购买。

### 4. 授权交付与恢复

付款确认后，系统立即自动发放授权码，通过付款完成页和扩展设置页交付。若授权码没有显示或扩展没有激活，请联系销售方核对；未交付的退款权利不受下方自愿退款期限限制。

请复制或下载备份授权码。重装扩展或更换电脑时，可以使用授权码恢复购买；请勿公开分享或转售授权码。激活、恢复和定期授权验证需要网络，临时离线时可在缓存授权的有效范围内继续使用。

### 5. 退款

**付款完成后 14 天内，如果你对产品不满意，可以凭购买记录申请全额退款。** 无需证明从未使用产品。请在期限内通过上述联系表单提交申请。

14 天后，未交付、与产品说明严重不符、重复收费、未经授权付款等问题，仍可依据适用法律及付款服务商政策申请处理。此处的自愿退款政策不会限制依法享有的权利，也不会排除 Sold through Link 条款或退款政策给予你的其他权利。

退款通过原付款渠道处理，实际到账时间取决于支付机构和银行。全额退款完成后，该次购买对应的买断授权终止；扩展会在后续授权验证时更新状态。

### 6. 付款服务商与支持

通过 Stripe Managed Payments（Sold through Link）完成的交易，还适用 [Link 消费者条款](https://link.com/terms)及 [Sold through Link 退款政策](https://support.link.com/questions/requesting-a-refund-for-a-sold-through-link-payment)。付款、收据及交易退款问题，也可联系 [Sold through Link 支持](https://support.link.com/topics/sold-through-link)。

### 7. 兼容性与维护

Hiraishin 需要 Chrome 121 或更新版本。网页轮盘不能在 Chrome 内部页面、Chrome 网上应用店等受限页面运行。AI 发送需要你自己的第三方账号和兼容的网页结构；购买不包含 ChatGPT、Claude 等第三方服务的账号、订阅或费用。

第三方网站改版可能影响功能，请先用免费试用确认你的实际使用环境。一次性购买描述付费方式，不构成终身更新、永久在线或所有未来产品均免费的承诺；这不减少适用法律及购买时产品说明赋予你的权利。

---

## 日本語：購入・ライセンス・返金

適用開始日：[公開時に記入]。本条件は、適用開始日以降に購入された Hiraishin の利用ライセンスに適用されます。法令に基づく権利を制限するものではありません。

### 1. 販売者とお問い合わせ

Hiraishin は、[実際の販売者の氏名または法人の正式名称] が **44san** ブランドで提供します。製品、ライセンスの提供および使い方のサポートは販売者が担当します。Google は販売者ではなく、本製品の決済や返金を取り扱いません。

製品、ライセンス、返金については、[お問い合わせフォーム](https://koe.44san.com/hiraishin?lang=ja)をご利用ください。返信を受け取れるメールアドレスと、注文番号または購入時のメールアドレスをご記入ください。カード番号全桁、セキュリティコード、アカウントのパスワードは送信しないでください。

[事業者の所在地に応じて必要な事業者情報、または実際に対応可能な請求後開示の案内を記載します。]

### 2. 製品と価格

購入対象は、Chrome 拡張機能 Hiraishin の利用ライセンスです。買い切りで、定期購入や自動更新による請求はありません。

| 決済通貨 | 通常価格 | リリース記念価格 |
| --- | --- | --- |
| 米ドル | US$9.90 | US$6.00 |
| 日本円 | 1,400 円 | 900 円 |

リリース記念価格は **2027 年 1 月 31 日 23:59（日本時間）**まで適用されます。お支払いは決済時に選択した一つの通貨のみです。適用される割引、税額、お支払い総額は、決済を確定する前に表示されます。決済画面と上記の金額が異なる場合は、購入前に販売者へお問い合わせください。支払方法は決済画面に表示される方法、支払時期は購入を確定し決済を完了する時点です。

### 3. 無料試用

すべての機能を 14 日間無料でお試しいただけます。試用期間は、初めて有効な操作が成功したときから始まります。試用にカードの登録は不要で、試用終了時の自動課金もありません。終了後に購入するかどうかをご自身でお選びいただけます。

### 4. ライセンスの提供と復元

決済の確認後、ライセンスキーを直ちに自動発行し、支払完了ページと拡張機能の設定画面で提供します。キーが表示されない場合や有効化できない場合は、販売者へお問い合わせください。未提供の場合の返金に関する権利は、下記の任意の返金期間によって制限されません。

キーをコピーするか、バックアップをダウンロードして保管してください。拡張機能の再インストール時やパソコンの買い替え時には、キーで購入を復元できます。キーの公開や転売はお控えください。有効化、復元、定期的なライセンス確認にはインターネット接続が必要です。一時的にオフラインの場合は、保存済みライセンスの有効範囲内で引き続きご利用いただけます。

### 5. 返金

**決済完了後 14 日以内に製品にご満足いただけなかった場合は、購入記録を添えて全額返金をお申し込みいただけます。** 未使用であることの証明は不要です。期間内に上記のお問い合わせフォームからお申し込みください。

14 日を過ぎた場合も、製品の未提供、説明との重大な相違、重複請求、不正な決済などについては、適用法令および決済サービスのポリシーに基づき対応します。この任意の返金制度は、法令に基づく権利や、Sold through Link の規約・返金ポリシーに基づくその他の権利を制限しません。

返金は元の支払方法を通じて処理します。着金までの時間は、決済機関や銀行によって異なります。全額返金が完了すると、その購入に対応する買い切りライセンスは終了し、拡張機能は以降のライセンス確認時に状態を更新します。

### 6. 決済サービスとサポート

Stripe Managed Payments（Sold through Link）を利用した取引には、[Link の消費者向け規約](https://link.com/terms)と [Sold through Link の返金ポリシー](https://support.link.com/questions/requesting-a-refund-for-a-sold-through-link-payment)も適用されます。決済、領収書、取引の返金に関するお問い合わせは、[Sold through Link サポート](https://support.link.com/topics/sold-through-link)でも受け付けています。

### 7. 動作環境とメンテナンス

Chrome 121 以降が必要です。ページ内ホイールは、Chrome の内部ページや Chrome ウェブストアなど、制限されたページでは動作しません。AI への送信には、ご自身の外部サービスのアカウントと互換性のあるページ構造が必要です。購入には、ChatGPT、Claude などの外部サービスのアカウント、定期購入、利用料金は含まれません。

外部サイトの変更によって機能が影響を受けることがあるため、無料試用で実際のご利用環境をご確認ください。買い切りとは支払方法を示すもので、生涯にわたる更新、永続的なオンライン提供、将来のすべての製品の無償提供を約束するものではありません。適用法令および購入時の製品説明に基づく権利は制限されません。

---

## English: purchase, license and refunds

Effective date: [complete when publishing]. These terms apply to Hiraishin licenses purchased on or after that date. They do not limit your statutory rights.

### 1. Seller and contact

Hiraishin is provided by [the actual seller's legal name or registered company name] under the **44san** brand. The seller is responsible for the product, license delivery and product support. Google is not the seller and does not handle payments or refunds for this product.

For product, license or refund questions, use the [contact form](https://koe.44san.com/hiraishin?lang=en). Include an email address where we can reply and your order reference or payment email address. Do not send a full card number, security code or account password.

[Add the business disclosures required for the seller's location, or a disclosure-on-request arrangement that the seller can actually fulfil.]

### 2. Product and price

You are purchasing a license to use the Hiraishin Chrome extension. This is a one-time payment, with no subscription or automatic renewal charges.

| Payment currency | Regular price | Launch price |
| --- | --- | --- |
| US dollars | US$9.90 | US$6.00 |
| Japanese yen | ¥1,400 | ¥900 |

The launch offer ends on **January 31, 2027, at 23:59 Japan Standard Time**. You pay in only the currency selected at checkout. Applicable discounts, taxes and the total payable are displayed before you confirm payment. If checkout differs from these prices, contact the seller before purchasing. Payment is made using a method displayed at checkout, when you confirm and complete your purchase.

### 3. Free trial

Every feature is free to try for 14 days, starting with your first successful, effective action. The trial does not require a payment card and does not automatically charge you when it ends. You decide whether to purchase afterwards.

### 4. License delivery and recovery

Once payment is confirmed, the system immediately issues a license key automatically and provides it on the payment-completion page and in the extension's settings. Contact the seller if the key does not appear or activation fails. Your rights concerning non-delivery are not limited by the voluntary refund period below.

Copy the key or download a backup. You can use it to restore your purchase after reinstalling the extension or changing computers. Please do not publish or resell your key. Activation, recovery and periodic license verification require an internet connection. During temporary offline use, you can continue within the validity of your cached license.

### 5. Refunds

**If you are not satisfied with the product, you may request a full refund within 14 days after payment is completed, using your purchase record.** You do not need to prove that the product was unused. Submit your request through the contact form above within that period.

After 14 days, issues such as non-delivery, a material difference from the product description, duplicate charges or unauthorized payments may still be addressed under applicable law and the payment provider's policies. This voluntary policy does not limit statutory rights or other rights under the Sold through Link terms or refund policy.

Refunds are processed through the original payment method. The time until funds arrive depends on the payment provider and bank. Once a full refund is completed, the purchased license for that transaction ends; the extension updates its status during subsequent license verification.

### 6. Payment service and support

Transactions through Stripe Managed Payments (Sold through Link) are also subject to the [Link consumer terms](https://link.com/terms) and [Sold through Link refund policy](https://support.link.com/questions/requesting-a-refund-for-a-sold-through-link-payment). For payment, receipt and transaction-refund questions, you can also contact [Sold through Link support](https://support.link.com/topics/sold-through-link).

### 7. Compatibility and maintenance

Chrome 121 or later is required. The in-page wheel cannot run on restricted pages such as Chrome's internal pages or the Chrome Web Store. Sending to AI requires your own third-party account and a compatible website structure. Your purchase does not include accounts, subscriptions or fees for ChatGPT, Claude or other third-party services.

Third-party website changes can affect compatibility, so use the free trial to check your actual workflow. A one-time purchase describes the payment model; it does not promise lifetime updates, perpetual online availability or free access to every future product. This does not reduce your rights under applicable law or the product description at purchase.

---

## 发布前只剩的实际信息与操作

1. 确认收款主体的个人 / 公司类型及登记国家 / 地区，再落实实际销售方名称与必要的经营者披露。日本经营者若采用请求后披露，必须有真实信息、有效联系入口及买家作出购买决定前及时书面 / 邮件回复的流程；本文件没有自动承诺该流程。
2. 接受或调整建议的 **付款后 14 天全额退款** 政策，再填正式生效日期。不能把本文草案当作已经获批的退款承诺，也不能追溯减少老买家的权利。
3. 核对正式付款页的价格、含税口径、优惠期限、Managed Payments 状态、支持联系方式和消费者条款，并在三语价格表注明含税或未含税；未核实的内容不要直接发布。14 天后及法定 / Link 范围内的退款仍需正常处理；不要把 14 天写成所有退款权利的绝对截止日。
4. 将核定内容发布到三语网站并从首页、扩展购买按钮附近链接；核对 Stripe 的公开业务资料、条款 / 退款政策展示、Link 退款升级通知的接收设置。此任务未修改 Stripe 设置，也未提交付款。

## 核对依据

- 产品事实：`src/license.js`、`ui/options/LicenseSection.tsx`、`docs/LICENSE_INTEGRATION.md`；Menkyo 的 `config/businesses.json`、`src/businesses.ts`、`STATUS.md`。
- [Chrome 商店的付款要求](https://developer.chrome.com/docs/webstore/program-policies/accepting-payment)：付费说明、销售条款、退款与卖方信息。
- [Stripe Managed Payments 当前服务条款](https://stripe.com/legal/ssa-service-terms#stripe-managed-payments)：卖方身份、退款及职责分配。
- [Managed Payments 交易支持与退款](https://support.stripe.com/questions/managed-payments-transaction-support-refunds-and-order-management)：可由开发者处理退款，Stripe 也可按政策介入；60 天不是普遍无理由保证。
- [Link 消费者条款](https://link.com/terms)与 [Sold through Link 退款政策](https://support.link.com/questions/requesting-a-refund-for-a-sold-through-link-payment)：适用的消费者权利及退款情形。
- [日本消费者厅通信销售指南](https://www.no-trouble.caa.go.jp/what/mailorder/)及 [广告披露 Q&A](https://www.no-trouble.caa.go.jp/qa/advertising.html)：如实际经营情况适用，落实销售方、价格、付款、交付、退款与经营者信息。
- [Managed Payments 税务覆盖范围](https://docs.stripe.com/payments/managed-payments/tax-compliance)：不将所有地区的税务义务一概写成由 Stripe 承担；日本经营者的日本境内交易需要单独核对。
