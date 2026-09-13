# 为什么选 Tauri 而不是 Electron？—— 一个 6.9 MB 的桌面应用是怎么做到的

> 我们做了一款开源的 PRM 工具叫 Weavine，最近加上了 CSV / vCard 批量导入和联系人排序分页
> 微信 ID: weavine-prm · v0.2.29 · 2026-07

---

## 一个常见的问题

每次有人看到 Weavine 的下载页，都会问同一个问题：

"6.9 MB 的 DMG？一个桌面应用？确定不是个网页快捷方式？"

确定。这是一个完整的桌面应用——React 前端 + Rust 后端 + SQLite 本地数据库 + 可选的多端同步服务。它能离线打开、能管理几百个联系人、能按标签筛选、能搜索、能导入导出。

但它的安装包只有 6.9 MB（macOS）、7.9 MB（Windows）、6.9 MB（Linux）。

**对比一下：一个空白的 Electron 应用，打包出来至少 150 MB。**

这差距是怎么来的？答案就在标题里：**Weavine 用 Tauri，不用 Electron。**

---

## 为什么 Electron 那么大？

Electron 本质上是一个"浏览器套壳"。它把整个 Chromium 渲染引擎 + Node.js 运行时打包进你的应用。不管你的应用代码有多小——哪怕只有一个 `console.log`——你都得带着一整份 Chromium（~120 MB）和 Node.js（~30 MB）。

也就是说，Electron 的每个用户设备上，都跑着一份几乎完整的浏览器，只为渲染一个窗口。

**这带来的问题不只是包体积：**

- **内存占用高**：Chromium 本身就要吃掉 200-400 MB 内存，哪怕你的应用只有一个输入框
- **启动慢**：加载 Chromium 的进程初始化、V8 引擎预热，冷启动通常 1-3 秒
- **更新频繁**：Chromium 的安全补丁月月有，你得跟着发新版本
- **系统集成差**：Electron 用自己的一套文件对话框、通知栏、菜单栏，和系统原生体验有隔阂

不是说 Electron 不能用——VS Code、Slack、Discord 都用 Electron 做得很好。但它们的场景是"重度编辑器 / 聊天工具"，功能复杂到需要 Chromium 的渲染能力。

**Weavine 的场景不同。** 它是一个人脉管理工具——表格、表单、列表、搜索。这些 UI 不需要 Chromium 的 GPU 合成、不需要 V8 的 JIT 预热、不需要 Service Worker 的离线缓存（因为本地数据就在 SQLite 里）。

---

## Tauri 的方案：用系统的，不包的

Tauri 的思路和 Electron 完全相反：

**Electron 的哲学**：我给你打包一个 Chromium，你永远不用担心用户的浏览器不兼容。

**Tauri 的哲学**：用户的系统已经有 WebView（macOS 的 WKWebView、Windows 的 WebView2、Linux 的 WebKitGTK），我直接用系统的——不打包，不算体积。

对比一下两套架构：

| 维度 | Electron | Tauri |
| --- | --- | --- |
| 渲染引擎 | 自带 Chromium (~120 MB) | 调用系统 WebView（0 MB 额外） |
| 后端语言 | Node.js (JavaScript) | Rust（编译为原生二进制） |
| 安装包体积 | 150-300 MB | 6-10 MB |
| 内存占用 | ~200-500 MB 起 | ~60-150 MB |
| 冷启动时间 | 1-3 秒 | < 0.5 秒 |
| 系统集成 | 自实现（不完美） | 原生（菜单栏、通知、托盘） |
| 安全性 | 有 Node.js 沙箱逃逸历史 | Rust 编译时内存安全，攻击面小 |
| 生态 | 成熟，插件多 | 较新，但核心功能够用 |

**Tauri 的"代价"是什么？** 你需要用 Rust 写后端逻辑。Rust 的学习曲线比 JavaScript 陡——这是事实。但 Weavine 的技术选型从一开始就接受了这个代价，原因很简单：

**人脉管理工具处理的是你的客户数据、联系人信息、互动记录。这些数据应该由一门编译时保证内存安全的语言来管理。** 用 Rust 写数据库操作，可以让出一类内存相关的 bug（use-after-free、buffer overflow），这对一个"数据不能丢"的应用来说，不是锦上添花，是底线要求。

---

## 6.9 MB 是怎么拆出来的？

Weavine v0.2.29 的 macOS DMG 打开后，里面是这样的：

```
Weavine.app/
├── Contents/
│   ├── MacOS/weavine          # Rust 二进制   ~15 MB（strip 后）
│   └── Resources/
│       ├── index.html + JS    # React 前端    ~1 MB（gzip 后）
│       └── icons               # 应用图标     ~0.1 MB
```

**没有 Chromium。没有 Node.js。没有 V8 快照。没有额外的运行时。**

整个应用的核心数据层（SQLite 读写、联系人搜索、标签管理、同步引擎）全部在 Rust 的 `weavine` 二进制里。前端 React 代码只负责渲染和交互——它调用 Tauri 的 IPC 桥去请求数据，不直接操作数据库。

**这比 Electron 的架构更干净。** 在 Electron 应用里，JavaScript 层经常直接操作数据库（通过 `better-sqlite3` 之类的 Node.js 原生模块），导致前端代码和数据库 schema 耦合。Tauri 的 Rust 层天然是"业务逻辑层"的边界，前端只传命令、拿数据，不关心 SQL。

---

## 两个架构的"手感"差别

如果你从 Electron 切换到 Tauri，最直观的感受是：

**1. 启动像点灯。** Weavine 的冷启动时间在 0.3-0.5 秒之间——点击图标 → 窗口出现 → 数据加载完毕，一个呼吸的功夫。Electron 应用通常需要看到 splash screen 转一圈。

**2. 后台安静。** Weavine 在后台（最小化）时，Rust 后端只做一件事：等待 IPC 调用。没有 Chromium 的 GC 线程、没有 V8 编译缓存、没有 Service Worker 的心跳请求。系统风扇不会因为一个联系人管理工具呼呼转。

**3. 更新无感。** Tauri 的更新机制基于 Rust 的 `tauri-plugin-updater`，下载的是增量 diff。Weavine 从 v0.2.28 升到 v0.2.29，下载量只有几百 KB。Electron 的 `electron-updater` 通常要下载整个 `app.asar`。

**4. 与系统一致。** Weavine 的菜单栏、文件对话框、通知栏用的是系统原生组件，而不是 Electron 模拟的。在 macOS 上，菜单栏快捷键是系统标准的；在 Windows 上，安装包是 MSI 而不是 NSIS 自解压包。

---

## 但 Tauri 不是万能药

这篇文章不是为了说"Tauri 比 Electron 好，大家快迁移"。任何一个技术选型都是 trade-off。

**Tauri 的适用范围：** 你的应用界面是"文档/表单/列表/图表"级别的复杂度，不需要浏览器扩展、不需要 DevTools 远程调试、不需要 Service Worker 做离线缓存（因为本地数据直接用 SQLite 或类似方案）。

**Tauri 不适合的场景：** 你的应用重度依赖 Chromium 的特性（比如 DevTools 扩展、WebRTC 的复杂场景、Service Worker 的 push 通知）、或者你的团队没有人写 Rust、或者你需要在应用里嵌一个完整的浏览器（比如 Electron 的 `webview` 标签）。

**现实是：大部分桌面应用属于前者，不是后者。** 但 Electron 的生态惯性让很多人默认"桌面应用 = Electron"。Tauri 的出现，至少给了我们一个"轻量级"的选择。

---

## 顺便说一句：Weavine 现在能批量导入联系人了

写技术文章归写技术文章，产品更新也得说。

v0.2.29 增加了一个很多人等了很久的功能：**联系人批量导入**。

### 支持两种格式

**CSV（Excel / Numbers / WPS 导出）**：识别中英文表头（昵称/姓名/公司/职位/邮箱/电话/微信/备注/城市），自动匹配列。支持 `,` 和 `""` 引号嵌套，不会因为字段里有逗号就错位。

**vCard（.vcf / .vcard，苹果通讯录 / 微信导出）**：解析 RFC 6350 标准格式，包括 `N`（结构化姓名）、`FN`（显示名）、`ORG`、`TITLE`、`ADR`（提取城市）、`EMAIL`、`TEL`（优先手机号）、`NOTE`、`X-WECHAT` 等扩展属性。

### 导入流程

1. 点击联系人列表页的「导入 CSV / vCard」按钮
2. 选择文件（支持 UTF-8 BOM，Excel 导出的 CSV 直接可用）
3. 自动解析，显示解析到的联系人数量
4. 确认后，并发 5 条逐个创建（`Promise.allSettled`），显示进度条
5. 导入完成，显示成功/失败数

### 数据安全

和 Weavine 的所有功能一样：**导入的数据全程在本地处理**。CSV 文件由浏览器 FileReader 读取，JavaScript 解析，通过 Tauri IPC 传给 Rust 层写入 SQLite。文件不上传、不经过任何服务器、不留临时文件。

---

## 总结

选择 Tauri 不是因为"Electron 不好"，而是因为 **Weavine 的场景不需要 Electron 的重量**。

一个联系人管理工具，核心价值是"数据在你手里，随时能打开，不被打扰"。Tauri 的轻量、快速、原生集成，恰好匹配这个定位。而 Rust 的内存安全保证，让"数据不丢"这件事有了编译时级别的保障。

如果你在做下一个桌面应用，不妨先问自己一个问题：

**你的应用真的需要一个 Chromium 吗？**

如果答案是否定的，Tauri 值得一试。

---

## 附录：Weavine v0.2.29 技术更新

**新增：**
- 联系人批量导入（CSV / vCard），支持中英文表头，自动识别
- 联系人列表排序（最近联系 / 最近添加 / 姓名 A-Z）
- 联系人列表分页（每页 20 条，上限 200）
- 新增 `idx_contact_user_created` 索引优化排序性能

**下载：**
- GitHub: https://github.com/iyuanfang/weavine
- Web 版: https://weavine.financialagent.cc/
- 桌面版: https://github.com/iyuanfang/weavine/releases/tag/v0.2.29

---

*本文基于 Weavine v0.2.29 (2026-07-09)，所有功能以仓库 main 分支为准。*