# PRM v2 Design — 深度优化与国内化

**日期:** 2026-06-15
**作者:** Sisyphus (代笔)
**状态:** 调研完成，v2 设计草案，待明天确认后实现
**前置文档:** [v1 设计](./2026-06-14-prm-design.md) — v1 已实现并合并到 main

---

## 1. 背景与现状

v1 已经把核心功能跑通：联系人 / 标签 / 日程 / 互动 / 需求 / NL 搜索 / 提醒 / 生日 / 收件箱 / 浏览器通知 / 关系强度 / 快速记录 / 头像。

但 v1 是**通用版**的 CRM/PKM，对国内用户而言还有几个关键缺失：

- **微信生态完全没接** — 中国人日常 95% 社交发生在微信/企业微信/QQ，v1 完全没利用
- **名片的录入仍是手输** — 现实场景拿到一张纸质名片是常态
- **没有「关系深度」建模** — 只知道"联系过几次"，不知道"这是 5 年的老朋友"还是"上周刚加的新客户"
- **没有礼物/红包等中式礼仪** — 端午节送礼、婚礼红包、小孩满月乔迁等
- **没有「群/圈子」概念** — 微信群是真实存在的关系容器，v1 完全没建模
- **没有内容轨迹** — 公众号文章、朋友圈、知乎回答，这些"关于这个人的事"全丢在外面
- **隐私与同步策略偏理想化** — v1 假设单机本地，但中国用户更习惯"多端同步+多设备访问"

---

## 2. 国内场景与痛点

### 2.1 微信生态导入（最高优先）

**痛点:** 微信里可能有 500-2000 个联系人，但 PRM 里几乎全空。

**可能的方案（按可行性排序）:**

| 方案 | 难度 | 自动化程度 | 数据完整度 |
|---|---|---|---|
| 微信通讯录导出 vcf → 批量导入 | 低 | 全自动 | 中（只有微信号 + 昵称） |
| 名片 OCR 拍照 | 中 | 半自动 | 高 |
| PC 微信聊天记录 backup 解析 | 中 | 半自动 | 高（含时间线） |
| 截屏聊天记录 → OCR | 中 | 半自动 | 中 |
| 「我的名片」二维码交换 | 低 | 全自动 | 高 |
| 半自动 + AI 补全（OpenAI 推断职位/公司） | 高 | 半自动 | 高 |

**v2 取舍:** v2 先做 **vcf 导入** + **名片 OCR** + **二维码交换** 三件套，足够解决 80% 场景。

### 2.2 名片识别 OCR

**目标:** 拍一张名片 → 1 秒内创建联系人，自动填好 姓名/电话/邮箱/公司/职位。

**技术选型:**
- **PaddleOCR (百度开源)** — 中文识别率最高，可本地部署，无云端依赖
- **Tesseract.js** — 跨平台，可纯前端，但中文识别率差
- **云服务**（百度/腾讯/阿里 OCR）— 准确率高，但要付钱 + 数据外传

**v2 取舍:** 默认 **PaddleOCR**（本地），可选云服务（设置里开关）。

**UX 流程:**
1. 「+ 联系人」旁边加「📷 拍名片」
2. 拍照 → 前端做透视矫正 + 裁剪
3. 调 OCR API（本地或云）→ 拿到结构化字段
4. 弹出确认页，用户修改 + 选标签 → 提交

### 2.3 群与关系网络（社交图谱）

**痛点:** 我和 100 个人是微信好友，但其实我们常在 5 个群里互动，应该用「群」来表达圈子。

**v2 模型:** 新增 `Group`（群/圈子）+ `ContactGroup`（成员关系）。派生能力：
- 「共同群」: 张三和我都在 [创业群, 老乡群, 读书会]
- 「活跃群友」: 群里最近说话的人 → 推荐加深关系
- 「二度人脉」v3 再做

**v2 取舍:** 只做群管理 + 共同群显示。

### 2.4 关系深度建模

v1 已经有「fresh / warm / stale / cold」基于「最后联系时间」。

v2 增加维度：
- **关系类型** (relation_kind): 家人/亲属/朋友/同事/同学/客户/合作伙伴/导师/网友
- **认识时长** (acquaintanceAt): 真实地认识多少年
- **联系频率** (cadence): 高频/月度/季度/年度/偶尔
- **重要性** (importance 1-5): 用户主观打分
- **信任度** (trust 1-5): 用户主观打分
- **共同点** (sharedInterests): 自由标签

UI 用 SVG 手写雷达图，5 个维度可视化。

### 2.5 礼物/红包/中式礼仪

**v2 新增 `GiftEvent` 模型** — 类型/方向/金额/场合/日期/关联联系人。

**派生能力:**
- 「张三 5 年内收了我 ¥3600 礼物」
- 「今年已经送出 ¥4200，预算 ¥5000」
- 「李四上次送的是茶叶，要不要回个水果？」
- 节日提醒：「3 天后端午节，需要给 VIP 客户准备礼物」

### 2.6 内容轨迹

**v2 新增 `ContentTrail` 模型** — 来源/URL/标题/分享人/反应/分享日期/标签。

v2 重点做 RSS 订阅 + 手动添加链接，朋友圈/微博导入留 v3。

### 2.7 隐私与同步

**多档策略:**
- **单机模式** (v1 默认): 纯本地 SQLite
- **自托管同步**: WebDAV / S3 兼容 / Cloudflare R2 (低费用)
- **可选云端**: 自己部署 Next.js + Postgres，多用户
- **P2P 同步**: v3

**v2 取舍:** v2 做「WebDAV 同步」最简单（Nextcloud / iCloud Drive / 坚果云都支持）。

---

## 3. 竞品对标

> 来自 librarian 调研

### 3.1 国内 B 端 CRM

#### 纷享销客

| 功能 | 解决什么 |
|---|---|
| **客户树** (基于工商数据的股权穿透) | 集团客户的母子公司层级，销售可看出子公司覆盖空白 |
| **权力地图** (决策链鱼骨图) | 大单成交要知道谁拍板，标注立场 + 影响力 |
| **MCR 三层关系模型** (关键/普遍/组织) | 把"关系"分层管理，每层设独立指标 |
| **风险洞察** (工商+司法监控) | 客户出事了第一时间知道 |
| **铁三角协同** (AR+SR+FR 角色) | 大客户多角色协同 + 共享工作台 |

#### 六度人和 EC (腾讯战略投资)

| 功能 | 解决什么 |
|---|---|
| **智能名片** (微信生态数字化) | 纸质名片无法追踪 + 不可更新 |
| **H5 微营销** (拖拽生成 + 内嵌表单) | 销售能自己做营销页 |
| **AI 销售顾问 (SIXBOT)** | 实时话术推荐 + 商机打分 |
| **客户回捞** (沉默线索激活) | 死线索自动二次激活 |
| **全渠道同步** (QQ/微信/电话/拜访) | 跟进记录自动沉淀，不需手录 |

#### 微伴助手 (企业微信 SCRM)

| 功能 | 解决什么 |
|---|---|
| **AI 自动打标签** (聊天语义+行为) | 手动打标效率低，关键字规则太粗 |
| **多维客户画像** (来源+互动+订单+咨询) | 企微原生只记基础标签 |
| **一客一码** (渠道活码) | 区分获客来源，统计渠道 ROI |
| **离职客户继承** | 销售离职带走客户是最大资产流失 |

### 3.2 国内 C 端 PKM/人脉

#### 脉脉 (1.1 亿用户)

| 功能 | 解决什么 |
|---|---|
| **五同关系** (同事/同学/同乡/同校/共同朋友) | LinkedIn 式陌生人社交在中国水土不服，五同降低信任门槛 |
| **三度人脉** (付费) | 打破人脉圈层壁垒 |
| **同事圈** (匿名) | 职场内部信息差 |

#### flomo (浮墨笔记)

| 功能 | 解决什么 |
|---|---|
| **多级标签** (`#标签/子标签/...`) | 文件夹只能单层，标签太多难管 |
| **AI 相关笔记** (语义推荐) | 笔记间是孤岛，AI 找关联 |
| **AI 记忆档案** | 让 AI 助手成为"了解你的思考伙伴" |

### 3.3 海外个人 CRM 借鉴

#### Dex (当前最热门)

| 功能 | 解决什么 |
|---|---|
| **AI Assist** (Shift+A 生成开场白) | "上次聊了什么？现在怎么开口？" |
| **SMS/WhatsApp 交互** | 记录触点的摩擦接近零 |
| **每日摘要** (早晨推送) | 强制每天 30 秒维护关系 |
| **语音笔记 + AI Cleanup** | 记录成本降到零 |
| **LinkedIn Job Change Alert** | 升职跳槽是 reconnect 黄金时机 |

#### Clay (enrich 标杆)

| 功能 | 解决什么 |
|---|---|
| **Waterfall Enrichment** (10+ 数据源瀑布) | 单一数据源覆盖不够 |
| **Claygent** (AI 智能体搜网络) | "这人最近上了什么播客？" 等软信息 |
| **AI 列 / AI 打分** | 非技术用户做智能打分 |

#### Monaru (已关停但理念值得借鉴)

| 功能 | 解决什么 |
|---|---|
| **人工电话访谈冷启动** | 个人 CRM 最大障碍是"填表太累" |
| **礼物/活动智能推荐** | "你妈妈喜欢北欧小说，推荐 Jo Nesbo 新书" |
| **社交偏好设置** | 匹配个人舒适度的活动推荐 |

### 3.4 对 PRM v2 的关键启示

1. **微信生态是必选项** — 国内联系人信息 80% 在微信里。PRM v2 必须有手动导入/分享名片解析路径
2. **关系图谱 > 联系人列表** — 纷享销客的权力地图、脉脉的五同关系、Dex 的网络地图，都是把扁平列表变有结构的关系网络
3. **AI 不是噱头是刚需** — "记住过去对话 → 推荐下一步行动" 链条上 AI 确实有价值
4. **零摩擦输入是留存关键** — Dex 的 SMS/语音交互，EC 的全渠道自动同步，越低摩擦数据质量越好
5. **关系优先级 (Monaru 理念)** — 不是所有联系人同等重要。家人 > 密友 > 前同事 > 一面之缘，触达频率应分层

---

## 4. v2 设计原则

1. **本地优先，云端可选** — v1 路线不动，加 WebDAV 同步
2. **国内场景优先** — 微信生态 + 中式礼仪优先于海外功能
3. **降低录入成本** — OCR、二维码、vcf 导入，零键盘录入 ≥ 50% 联系人
4. **关系而非交易** — 深度建模比广度重要，5 个深度朋友好过 500 个点赞之交
5. **隐私可信** — 数据本地化，可选加密
6. **不接微信 API（合规）** — 不抓取微信内容，遵守平台规则

---

## 5. v2 功能清单（按价值 × 可行性排序）

### 🔥 P0 — 必做，v2 主菜

| 编号 | 功能 | 价值 | 复杂度 | 估时 |
|---|---|---|---|---|
| 5.1 | vcf 批量导入 + 名片 OCR | 极高 | 中 | 2 天 |
| 5.2 | 群/圈子（Group）管理 + 共同群 | 高 | 中 | 1.5 天 |
| 5.3 | 礼物/红包（GiftEvent）记录 | 高 | 中 | 1 天 |
| 5.4 | 关系深度建模（多维度 + 雷达图） | 高 | 中 | 1.5 天 |

### 🟡 P1 — 强烈建议

| 编号 | 功能 | 价值 | 复杂度 | 估时 |
|---|---|---|---|---|
| 5.5 | 内容轨迹（ContentTrail） | 中 | 中 | 1 天 |
| 5.6 | WebDAV 同步（多端） | 高 | 高 | 2 天 |
| 5.7 | 我的名片 + 二维码交换 | 中 | 低 | 0.5 天 |

### 🟢 P2 — 锦上添花

| 编号 | 功能 | 价值 | 复杂度 | 估时 |
|---|---|---|---|---|
| 5.8 | RSS 订阅 → 自动关联到联系人 | 中 | 中 | 1 天 |
| 5.9 | 节日模板（端午/中秋/春节）批量提醒 | 中 | 低 | 0.5 天 |
| 5.10 | 关系时间线（重要日期自动生成） | 低 | 中 | 1 天 |

### ⚪ v3 留白

- 朋友圈/微博/知乎导入（合规风险大）
- 二度人脉可视化（数据不足）
- 端到端加密同步（性能 + 复杂度）
- AI 推断联系人信息（要接 LLM，成本高）

---

## 6. 数据模型变更

### 新增表

```prisma
// 群/圈子
model Group {
  id        String   @id @default(cuid())
  name      String
  type      String   @default("custom") // wechat/qq/custom/team/family/interest
  notes     String?
  createdAt DateTime @default(now())
  members   ContactGroup[]
  @@index([name])
}

model ContactGroup {
  contactId String
  groupId   String
  joinedAt  DateTime?
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  group     Group   @relation(fields: [groupId], references: [id], onDelete: Cascade)
  @@id([contactId, groupId])
  @@index([groupId])
}

// 礼物/红包
model GiftEvent {
  id          String   @id @default(cuid())
  contactId   String
  contact     Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)
  kind        String   // gift/redpacket/cash/meal/help/other
  direction   String   // given/received
  amount      Float?
  currency    String   @default("CNY")
  occasion    String   // festival/wedding/funeral/birthday/baby/housewarming/promotion/other
  occurredAt  DateTime
  notes       String?
  createdAt   DateTime @default(now())
  @@index([contactId, occurredAt])
  @@index([occasion])
}

// 内容痕迹
model ContentTrail {
  id          String   @id @default(cuid())
  contactId   String?
  contact     Contact? @relation(fields: [contactId], references: [id], onDelete: SetNull)
  source      String   // wechat_moments/wechat_article/weibo/zhihu/twitter/rss/link/other
  url         String
  title       String
  reaction    String   @default("none") // liked/commented/saved/read/none
  sharedAt    DateTime?
  notes       String?
  createdAt   DateTime @default(now())
  @@index([contactId])
  @@index([sharedAt])
}

// 二维码交换 token
model ShareToken {
  id        String   @id @default(cuid())
  contactId String
  contact   Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())
  @@index([contactId])
  @@index([expiresAt])
}
```

### Contact 表新增字段

```prisma
model Contact {
  // ... v1 字段 ...
  relationKind     String?  // family/relative/friend/colleague/classmate/client/partner/mentor/online/other
  acquaintanceAt   DateTime? // 真实认识日期
  importance       Int      @default(3)   // 1-5
  trust            Int      @default(3)   // 1-5
  leverage         Int      @default(0)   // 0-5, 影响力
  cadence          String?  // high/monthly/quarterly/yearly/rare
  sharedInterests  String?  // 自由标签 JSON: ["AI", "跑步", "古典乐"]
  wechatId         String?  // 微信 ID/微信号
  wechatQr         String?  // 微信二维码图路径
  vcf              String?  // 原始 vcf 数据备份

  groups       ContactGroup[]
  gifts        GiftEvent[]
  contents     ContentTrail[]
  shareTokens  ShareToken[]
}
```

---

## 7. UI/UX 改造

### 7.1 联系人详情页升级

```
[avatar 80px]  张三
               Acme · CEO · 北京
               [VIP 客户] [微信: zhangsan]
               ─────────────────────────
               📊 关系仪表盘
               重要 4/5  信任 4/5  频率 月度  认识 5 年
               ─────────────────────────
               🎁 礼物往来  共 12 次，¥3600 出 / ¥800 入
               👥 共同群  创业群 · 老乡群 · 读书会
               📰 朋友圈  3 条新内容
               ─────────────────────────
               互动时间线 (v1)
               即将到来的事件 (v1)
               相关需求 (v1)
               内容轨迹 (新)
```

### 7.2 仪表盘改造

```
[顶部 stat cards 不变]
─────────────────────────
🎯 今日必看
  - 端午节: 3 天后, 提醒给 VIP 客户准备礼物
  - 李四: 已 45 天未联系（重要 5/5）
  - 王五: 明天生日
─────────────────────────
需要回访 (v1)
最近节日 (新)
─────────────────────────
本月礼物预算  ¥3000 / ¥5000 (60%)
─────────────────────────
即将到来的事件 (v1)
```

### 7.3 新增导航

```
顶部: 联系人 | 日程 | 需求 | 群 | 礼物 | 内容 | 搜索 | 收件箱
```

### 7.4 移动端响应式

v1 是桌面端为主，v2 需做基础响应式 (Tailwind 断点 + 移动端 nav drawer)。

---

## 8. 技术架构变更

### 8.1 OCR 集成

- 默认 PaddleOCR 走本地 Node 子进程 (`paddleocr-cli` 或 `python3 paddleocr`)
- 备选云服务（设置里切换 + API key）
- 前端拍照 → 压缩 → 调 API → 展示结果

### 8.2 WebDAV 同步

- 用 `webdav` npm 包
- 同步策略: **单向 + 冲突检测** (v2 不做双向合并，太复杂)
- 流程: 本地变更 → 写 .sync-journal.json → push to WebDAV → pull remote → 冲突弹窗
- 加密: 可选 AES-256 (用 Web Crypto API)

### 8.3 雷达图

- 纯 SVG 手写，不引外部库
- 5 个维度 (重要/信任/频率/认识时长/影响力)

### 8.4 节日日历

- 维护一个 `holidays.json`: 农历节日 + 阳历节日 + 自定义节日
- 农历转换: 用 `lunar-javascript` 或 `tyme4js` 库
- 关联到「需要送礼的 VIP 列表」

---

## 9. 实施分阶段

### Phase 9 — 录入加速（v2.0）
1. vcf 批量导入（含字段映射）
2. 名片 OCR（PaddleOCR 集成 + 确认页）
3. 我的名片 + 二维码交换
4. Contact 表新增 relation 字段

### Phase 10 — 关系深度（v2.1）
1. Group/ContactGroup 模型 + UI
2. 关系深度评分公式 + 雷达图 SVG 组件
3. 共同群派生
4. 雷达图编辑界面

### Phase 11 — 中式礼仪（v2.2）
1. GiftEvent 模型 + CRUD
2. 节日日历 (holidays.json + 农历)
3. 「本月礼物预算」仪表盘
4. 节日批量提醒 cron

### Phase 12 — 内容与同步（v2.3）
1. ContentTrail 模型 + UI
2. RSS 订阅 + 关联联系人
3. WebDAV 单向同步
4. 移动端响应式

---

## 10. 开放问题（明天讨论）

1. **OCR 默认走本地还是云？** — 我倾向本地 PaddleOCR（隐私好），但本地安装麻烦，云服务体验好。要不要给个首次运行引导？
2. **微信联系人导入的合规性？** — vcf 导出是微信本身的功能，应该 OK；但「自动监听聊天记录」绝对不做。
3. **关系深度评分公式** — 我给的是示例 (importance*0.3+trust*0.3+...)，需要用户确认权重。
4. **WebDAV 同步做不做双向？** — 双向合并复杂度爆炸，v2 只做 push-only 还是 push+pull？
5. **群数据怎么录入？** — 手动逐个加？还是粘贴群成员名单批量加？
6. **礼物预算怎么定？** — 按月？按季度？按关系等级分层？
7. **是否引入 AI 助手？** — "帮我找出适合介绍给张三的人" 这种 LLM 调用要不要做？成本多少？

---

## 11. 参考资料

- 纷享销客: https://www.fxiaoke.com/
- 六度人和 EC: https://www.scrm.com/
- 微伴助手: https://weibanzhushou.com/
- 脉脉: https://maimai.cn/
- flomo: https://flomoapp.com/
- Dex: https://getdex.com/
- Clay: https://www.clay.com/
- welink (关系图谱): https://github.com/runzhliu/welink
- PaddleOCR.js: https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js
- RapidOCR: https://github.com/RapidAI/RapidOCR
- lunisolar (农历): https://gitee.com/www.wh.json.com/lunisolar
- chinese-days (节假日): https://github.com/vsme/chinese-days
- WeTrace (微信导出): https://github.com/afumu/wetrace
- wx-dump-4 (微信解密): https://github.com/baiyajin/wx-dump-4
- mprss (公众号 RSS): https://github.com/wechat-article/mprss
- Monaru 设计: https://thehustle.co/monaru-dex-personal-relationship-management

---

## 12. 调研落地细节（来自深度调研）

### 12.1 微信生态导入 — 技术路径

**最现实入口 — 微信 8.0+ CSV 导出**
- 微信内置「我 → 设置 → 隐私 → 通讯录黑名单」页面底部有「导出联系人」功能，生成 CSV/vCard
- 微信 CSV 字段顺序固定：备注, 昵称, 微信号, 地区, 标签, 个性签名, 元数据
- 实现方式：前端 PapaParse 解析 + 写死的字段映射表
- 导入流程：去重（按微信号匹配）→ 标注冲突字段让用户选择 → 提示「N 个联系人只有昵称没有手机号，是否后续补充」

**二维码扫码录入 — jsQR / zxing-js**
- 微信名片二维码格式：`wxid_xxx` 或 `https://weixin.qq.com/r/xxxxx`
- 浏览器端纯前端识别，无服务端依赖
- 自己的「电子名片二维码」用 H5 页面生成（不上服务器，只用当前联系人字段渲染）

**聊天记录导入 — v3 再说（合规风险）**
- 用户侧先用 [wx-dump-4](https://github.com/baiyajin/wx-dump-4) 解密
- PRM 做消费层：解析 JSONL/Markdown，NLP 提取人名、项目关键词

### 12.2 OCR 名片 — 三档可选

| 方案 | 体积 | 准确率 | 成本 | 体验 |
|---|---|---|---|---|
| **PaddleOCR.js (WASM)** | 8-12MB | 印刷中文 95%+ | 完全免费 | 首次加载慢，识别 0.5-1s |
| **RapidOCR Web** | 5-8MB (ONNX) | 略低于 PaddleOCR | 完全免费 | 需本地 Python 服务 |
| **百度/腾讯/阿里云** | 0 | 最高 99% | ¥0.002-0.003/次 | 默认关闭，需 API key |

**v2 取舍:** 默认 PaddleOCR.js（本地优先），置信度 <70% 时弹窗提示「可启用云服务」。

### 12.3 群关系 — 借鉴 welink 方案

[welink](https://github.com/runzhliu/welink) 已经做了：
- 共同群聊数（SQL JOIN 2 次）
- Louvain 社区发现（小团体检测）
- 力导向关系图（vis.js / Cytoscape.js / D3-force）
- 群内「隐形 CP」检测（扫描 `lt=49` 引用消息）

**v2 取舍:** v2 做群管理 + 共同群显示，二度/三度图谱留 v3。数据导入用「粘贴群成员名单」+ 手动调整。

### 12.4 农历节日 + 黄历 — 纯前端库

- **[lunisolar](https://gitee.com/www.wh.json.com/lunisolar)** — TypeScript 库，npm install 直接用
  - 支持：八字、宜忌、建除十二神、农历日期转换
  - 体积小，纯本地计算
- **[chinese-days](https://github.com/vsme/chinese-days)** — JSON + iCal 订阅，中国法定节假日 + 节气
- 内置节日清单：春节、元宵、清明、端午、七夕、中元、中秋、重阳、腊八、小年、除夕
- 24 节气提醒：立春/惊蛰/清明/立夏/夏至/立秋/白露/秋分/立冬/冬至 等
- 可选黄历：今日宜「会见客户」「签约」「开业」，忌「动土」「搬家」

### 12.5 礼金系统 — 现有 Interaction 扩展

不需要新表，复用 `Interaction`：
- 新增 `kind` 枚举值：`gift | redpacket | cash | meal | help | other`
- 新增 `amount: Float?`、`currency: String`、`occasion: String`、`direction: 'given' | 'received'`
- 派生：人情账本页面，按人汇总「我给 X 共 ¥3600，X 给 Y 共 ¥800，结余 -¥2800」
- 智能提醒：「下个月小明结婚，去年你送了 ¥2000，建议同档回礼」

### 12.6 互动类型扩展（不需新表）

`Interaction.type` 枚举新增：
- `wechat_like` — 朋友圈点赞
- `wechat_paiyipai` — 拍一拍
- `wechat_redpacket` — 发红包
- `wechat_article` — 转发文章

这些都计入 `lastContactedAt`，让"关系强度"更准确。

### 12.7 隐私与本地化 — 三层防护

**第一层 — 假名/匿名模式**
- 联系人增加 `alias: String?` 字段（已有）
- 锁屏后只显示首字母 + 公司
- 敏感字段（手机号、微信）默认隐藏，点击显示需二次确认
- 导出时可脱敏（`138****1234`）

**第二层 — 数据库加密 (SQLCipher)**
- 可选 AES-256 加密 SQLite 文件
- 启动时输入主密码解锁
- 默认不加密（保持 v1 简单性），设置里开关
- 实现：Prisma + `driverAdapters` + `@prisma/adapter-node-http` + sqlcipher
- 风险：编译复杂，可能影响 Next.js serverless（v2 暂不推荐生产部署用户使用）

**第三层 — 客户资产保护**
- 联系人增加「公司客户 / 个人朋友」标签
- 操作审计日志：`audit_log` 表（action, contactId, timestamp）
- 离职交接模式：批量导出某标签下联系人 + 完整互动历史 → 生成交接包

### 12.8 公众号 RSS — 自建方案

- 用户在设置里订阅公众号（输入 RSS 链接或选择 wewe-rss / mprss 提供的源）
- 系统定时拉取（cron `0 */2 * * *`）
- 文章列表存到 `ContentTrail` 表
- 联系人详情页显示「这位朋友推荐过的文章」

**v2 取舍:** v2 重点做 RSS 消费层，不自建爬虫（合规风险）。

---

## 13. 更新后的优先级（基于调研）

| 编号 | 功能 | 价值 | 复杂度 | 估时 | 来源 |
|---|---|---|---|---|---|
| 5.1 | VCF/CSV 批量导入（微信 8.0+ 字段映射） | 极高 | 低 | 1 天 | 12.1 |
| 5.2 | 名片 OCR（PaddleOCR.js WASM） | 极高 | 中 | 1.5 天 | 12.2 |
| 5.3 | 礼金/红包系统（Interaction 扩展） | 高 | 低 | 0.5 天 | 12.5 |
| 5.4 | 农历节日 + 关系深度×场景建议 | 高 | 中 | 1 天 | 12.4 |
| 5.5 | 群/圈子 + 共同群 | 高 | 中 | 1.5 天 | 12.3 |
| 5.6 | 关系深度建模（多维度 + 雷达图） | 高 | 中 | 1.5 天 | §2.4 |
| 5.7 | 互动类型扩展（微信动作） | 中 | 低 | 0.5 天 | 12.6 |
| 5.8 | 二维码电子名片 | 中 | 低 | 0.5 天 | 12.1 |
| 5.9 | 内容轨迹（ContentTrail） | 中 | 中 | 1 天 | §2.6 |
| 5.10 | WebDAV 同步 | 高 | 高 | 2 天 | §2.7 |
| 5.11 | 匿名/假名模式 | 中 | 低 | 0.5 天 | 12.7 |
| 5.12 | 关系图谱可视化（v3 留白） | 中 | 高 | 2 天 | 12.3 |
| 5.13 | 公众号 RSS | 中 | 中 | 1 天 | 12.8 |
| 5.14 | SQLCipher 加密 | 中 | 高 | 2 天 | 12.7 |
| 5.15 | 微信聊天记录导入 | 中 | 高 | 3 天 | 12.1 v3 |

---

**调研完成。下一步:**
- 明天跟用户过 §13 优先级 → 决定 P0/P1/P2 砍哪些
- 启动 Phase 9 实施（按 §13 排序）
