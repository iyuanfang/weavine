# Weavine Tauri 迁移设计文档

> 日期: 2026-06-28
> 状态: 待审核

---

## 1. 概述

Weavine (Personal Relationship Manager) 当前是 Next.js + Electron + Prisma/SQLite 三件套。迁移到 Tauri v2 的目标：

- **包体缩小 95%**: Electron ~100-200MB → Tauri ~5-10MB
- **手机端支持**: iOS + Android
- **Web 版保留**: 自托管
- **本地优先**: 桌面/手机默认纯本地，Web 版必须登录

### 约束

| 项目 | 决定 |
|------|------|
| 桌面框架 | Tauri v2 (替换 Electron) |
| 手机框架 | Tauri v2 (iOS + Android) |
| Web 部署 | 自托管 Docker/VPS |
| Web 后端 | Next.js API routes (现有代码复用) |
| 认证 | 先邮箱密码，后续加 OAuth |
| 数据层 | Tauri: Rust + rusqlite ; Web: Prisma + PostgreSQL |
| 同步 | 可选（Phase 3+），E2E 加密 |

---

## 2. 目标架构

```
┌──────────────────────────────────────────────────────────────────┐
│                     React 前端（完全复用）                          │
│  src/app/*/page.tsx  src/components/*  src/lib/*  src/hooks/*     │
└──────────────────────┬───────────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │  dataAccess 抽象层        │
          │  src/lib/data-access.ts   │
          └──────┬──────────┬───────┘
                 │          │
          ┌──────┴──┐  ┌───┴────────────┐
          │ Desktop │  │    Web          │
          │ Mobile  │  │ (Browser)       │
          └───┬─────┘  └───┬────────────┘
              │            │
         ┌────┴────┐  ┌────┴─────────────┐
         │ Rust     │  │ Next.js Server    │
         │Commands  │  │ (Server Actions   │
         │          │  │  + API Routes)     │
         └────┬─────┘  └────┬──────────────┘
              │             │
         ┌────┴────┐   ┌────┴──────┐
         │ SQLite  │   │PostgreSQL │
         │ (本地)   │   │ (服务器)   │
         └─────────┘   └───────────┘
```

### 数据访问抽象层（核心改造）

**关键约束**: Next.js 静态导出不支持 server actions。所有 `'use server'` 的 `actions.ts` 文件不能在 Tauri 端使用。

**方案**: 数据访问分三层：

```typescript
// 层级 1: 组件层 — 只调 dataAccess，不关心后端
// src/app/contacts/page.tsx
import { dataAccess } from '@/lib/data-access'

const contacts = await dataAccess.contact.list({ tagId: 'xxx' })
await dataAccess.contact.create({ nickname: '张三' })

// 层级 2: 抽象层 — 路由到 Desktop 或 Web 实现
// src/lib/data-access.ts
import { isDesktop } from '@/lib/env'

export const dataAccess = isDesktop
  ? await import('./desktop-api').then(m => m.desktopApi)
  : await import('./web-api').then(m => m.webApi)

// 层级 3a: Desktop 实现 — invoke() 调用 Rust
// src/lib/desktop-api.ts
import { invoke } from '@tauri-apps/api/core'

export const desktopApi = {
  contact: {
    list: (params) => invoke('list_contacts', { params }),
    create: (data) => invoke('create_contact', { data }),
    update: (id, data) => invoke('update_contact', { id, data }),
    delete: (id) => invoke('delete_contact', { id }),
  },
  interaction: { /* ... */ },
  event: { /* ... */ },
  action: { /* ... */ },
  reminder: { /* ... */ },
  tag: { /* ... */ },
  settings: { /* ... */ },
}

// 层级 3b: Web 实现 — 调 server actions 或 fetch
// src/lib/web-api.ts
import { createContact, listContacts } from '@/app/contacts/actions'
// 复用现有 server actions
export const webApi = {
  contact: {
    list: (params) => listContacts(params),
    create: (data) => createContact(data),
    // ...
  },
  // ...
}
```

**组件改造原则**: 现有组件如果直接 import server actions，改为 import `dataAccess`。
- 如 `import { createContact } from './actions'` → `import { dataAccess } from '@/lib/data-access'` + `dataAccess.contact.create()`
- 纯 UI 组件不受影响

### 前端代码复用

所有以下文件在 Tauri 和 Web 间完全共享：

| 类别 | 文件 | 备注 |
|------|------|------|
| 页面 | 21 个 page.tsx | 完全不变 |
| 组件 | src/components/* | 完全不变 |
| 工具库 | src/lib/* (nl-parser, date-parser, etc.) | 完全不变 |
| Hook | React Query hooks | 只改 dataSource 指向 |

---

## 3. 分阶段路线图

Phase 顺序有依赖关系，建议按序执行。

```
Phase 1 ──── Phase 2 ──── Phase 3 ──── Phase 4 ──── Phase 5
  Tauri          Web         同步         Web版       手机
  桌面端         上线        用户系统      完善        适配
```

### Phase 1: Tauri 桌面端（替换 Electron）

**目标**: 用 Tauri 跑起现有 Next.js 前端，本地 SQLite 可用

```
React 前端 (静态导出) → Tauri Webview
                          ↓
                   Rust Commands ←→ SQLite
```

**工作内容**:

1. **项目结构改造**
   - 新增 `src-tauri/` 目录 (Rust)
   - 新增 `src/lib/data-access.ts` 抽象层
   - 新增 `src/lib/env.ts` (isDesktop 判断)

2. **Next.js 改为 dual-mode 构建**
   - `IS_DESKTOP=true` → `output: 'export'` (静态导出)
     - 移除所有 server actions 调用，替换为 dataAccess 抽象层
     - 静态导出不支持 `cookies()/headers()/next-auth` — 这些在 desktop 模式不引用
   - `IS_DESKTOP=false` → 正常 Next.js server (Web 版不变)

3. **Rust 端实现基础 CRUD**
   - 用 `rusqlite` 或 `sea-orm` 操作 SQLite
   - 实现 Tauri commands: contact / interaction / event / action / reminder / tag / setting
   - 复用现有 Prisma schema 作为数据库表结构

4. **前端的 dataAccess 集成**
   - desktop: `invoke('create_contact', {...})`
   - web: `serverAction.createContact(data)`

5. **验证**
   - Desktop 端所有 CRUD 操作正常工作
   - NL 快速输入创建正常
   - 搜索正常
   - `pnpm build` 通过

**预计文件改动**:
```
新增:
  src-tauri/Cargo.toml
  src-tauri/src/main.rs
  src-tauri/src/commands/*.rs
  src-tauri/src/db.rs
  src-tauri/tauri.conf.json
  src-tauri/capabilities/default.json
  src/lib/data-access.ts
  src/lib/env.ts
  src/lib/desktop-api.ts
  src/lib/web-api.ts

修改 (核心 — 组件引用从 server action 改为 dataAccess):
  src/lib/prisma.ts              → 标记为 web-only
  src/app/contacts/actions.ts    → 拆分为 web-api 调用的 server action
  src/app/interactions/actions.ts
  src/app/events/*/actions.ts
  src/app/actions/actions.ts
  src/app/tags/actions.ts
  src/app/settings/actions.ts
  src/app/calendar/actions.ts
  src/app/quick-log/actions.ts
  src/app/(auth)/actions.ts
  各 page.tsx 中直接 import actions.ts 的地方  → 改为 import dataAccess

  next.config.mjs                          → 添加 output: 'export' 分支
  package.json                             → 替换 electron 脚本为 tauri 脚本
  .gitignore                               → 添加 src-tauri/target/

删除:
  electron/main.cjs
  electron/preload.cjs
  electron-builder.yml
  scripts/postbuild-desktop.mjs
```

---

### Phase 2: Web 版上线（自托管）

**目标**: 将现有的 Web 版部署到用户自己的服务器，登录可用

```
VPS/Docker
  ┌────────────────────────────┐
  │ nginx → Next.js (port 3100) │
  │          ↓                   │
  │     Prisma → PostgreSQL      │
  └────────────────────────────┘
```

**工作内容**:

1. **Docker 化**
   - 编写 `Dockerfile` (Node.js + Next.js standalone)
   - 编写 `docker-compose.yml` (next + postgres)
   - 数据库初始化脚本

2. **认证部署**
   - 邮箱密码注册/登录流程
   - Session/cookie 管理
   - Auth.js 配置验证

3. **域名 + HTTPS**
   - nginx 反代配置
   - Let's Encrypt (certbot) 自动化

4. **验证**
   - 浏览器打开 Web 版，注册账号
   - 所有功能正常
   - 安全性：HTTPS、CORS、rate limit

**预计文件**:
```
新增:
  Dockerfile
  docker-compose.yml
  .env.example
  nginx/nginx.conf

修改:
  少量 auth 配置微调
```

---

### Phase 3: 同步用户系统

**目标**: 为同步功能建立用户体系，桌面/手机可登录绑定

```
Tauri App            Web Server (Next.js)
  │                        │
  │  POST /auth/register   │
  │───────────────────────►│
  │  { email, password }   │
  │◄───────────────────────│
  │  { token, userId }     │
  │                        │
  │  POST /sync/push       │
  │  { encrypted_data }    │
  │───────────────────────►│
  │◄───────────────────────│
  │  { version, status }   │
```

**工作内容**:

1. **Tauri 端添加登录能力**
   - Webview 内嵌登录页面 (或系统浏览器 OAuth)
   - 安全存储 token (keychain/credential manager)
   - `isLoggedIn` 状态管理

2. **API routes 完善**
   - 注册/登录/登出/重置密码
   - Token 刷新

3. **用户绑定**
   - 桌面本地用户 ↔ 云端用户的身份关联
   - 数据归属划分

**预计改动**:
```
新增:
  src/app/api/auth/register/route.ts
  src/app/api/auth/login/route.ts
  
Tauri 端:
  src/lib/auth-client.ts
```

---

### Phase 4: 同步引擎 (Post-Phase 3)

**目标**: 桌面/手机 ↔ Web 双向同步

```
Tauri App                    Web Server
  │                              │
  │  ── sync/pull ─────────────► │
  │◄── { changes, version } ──── │
  │                              │
  │  本地 merge + 冲突解决        │
  │                              │
  │  ── sync/push ─────────────► │
  │    { changes, version }      │
```

**同步策略**: 基于版本号 + last-write-wins（简单够用）
**加密**: 可选 E2E（用用户密码派生密钥，加密每一条记录再上传）

**工作量预估**: 较大，涉及 Rust + Next.js 两端同步协议实现

---

### Phase 5: Tauri 手机端

**目标**: iOS + Android 打包发布

**工作内容**:
1. 安装 Android SDK + Xcode
2. Tauri 手机端配置
3. 触屏适配（如果有 UI 需要调整的地方）
4. 发布到 App Store / Google Play

**技术挑战**: iOS 需要 Mac 编译；Android 需要 SDK 配置。

---

## 4. 数据迁移策略

| 迁移 | 方法 |
|------|------|
| Prisma SQLite → Rust SQLite | 表结构一致（复用 Prisma schema），直接读取现有 dev.db |
| Electron 用户 → Tauri 用户 | 数据文件路径不同，需自动扫描 + 复制 |
| 本地 → 云端 | 同步引擎负责（full-sync 模式首次） |

---

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Rust 开发效率低于 JS | 高 | 中 | 先用 rusqlite 直接写 SQL，避免 ORM 学习曲线 |
| Tauri 手机端 DX 不成熟 | 中 | 中 | Phase 5 排最后，等社区更成熟后再做 |
| 同步冲突处理复杂 | 中 | 高 | MVP 用 last-write-wins，复杂 CRDT 后续加 |
| Next.js 静态导出限制 | 低 | 高 | 当前无 `getServerSideProps`，基本无影响 |

---

## 6. 文件清单（完整）

### Phase 1 新增文件

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── capabilities/
│   └── default.json
├── build.rs
├── icons/                    # 应用图标
└── src/
    ├── main.rs               # 入口
    ├── db.rs                 # SQLite 连接 + 初始化
    ├── models.rs             # 数据模型
    └── commands/
        ├── mod.rs
        ├── contact.rs
        ├── interaction.rs
        ├── event.rs
        ├── action.rs
        ├── reminder.rs
        ├── tag.rs
        └── setting.rs
```

```
src/lib/
├── env.ts                    # isDesktop, isWeb 判断
├── data-access.ts            # 抽象层入口
├── desktop-api.ts            # invoke() 包装
└── web-api.ts                # server action / fetch 包装
```

### Phase 2 新增文件

```
Dockerfile
docker-compose.yml
.env.example
nginx/
└── nginx.conf
```

### 删除文件

```
electron/main.cjs
electron/preload.cjs
electron-builder.yml
scripts/postbuild-desktop.mjs
```

---

## 7. 技术选型细节

| 模块 | 技术栈 | 理由 |
|------|--------|------|
| Rust SQLite | `rusqlite` | 轻量、零依赖、直接写 SQL，无需学习 ORM |
| 序列化 | `serde` + `serde_json` | Rust 标准，与 TypeScript 对应 |
| Tauri 命令 | `#[tauri::command]` | Tauri 原生模式 |
| 前端通信 | `@tauri-apps/api` (invoke) | 标准方式 |
| 构建 | `next build && next export` | 静态导出 |
| Docker 基础镜像 | `node:20-alpine` | 小体积 |
| 数据库迁移 (Rust) | 手动 SQL 脚本 | 简单够用 |
