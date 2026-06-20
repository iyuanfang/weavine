# PRM · Personal Relationship Manager

Multi-tenant 人脉管理 Web App。Next.js 14 (App Router) + Prisma + PostgreSQL + Auth.js v5 (邮箱密码登录)。

## Quick start

```bash
pnpm install
# 编辑 .env，填入 DATABASE_URL（PostgreSQL）、AUTH_SECRET
pnpm prisma migrate dev
pnpm dev               # http://localhost:3100
```

首次访问会自动跳转 `/login`。点击「注册新账号」用邮箱创建账号，之后可用邮箱+密码登录。

## 配置

1. `DATABASE_URL` — PostgreSQL 连接字符串（见 `.env.example`）
2. `AUTH_SECRET` — `openssl rand -base64 32` 生成（生产环境必填）
3. `AUTH_URL` — 部署 URL（生产环境必填）
4. Web Push（可选）— `npx web-push generate-vapid-keys`，填入对应的环境变量

## 注册登录

- **注册**：访问 `/sign-up`，输入邮箱+密码（至少 8 位）即可创建账号
- **登录**：访问 `/login`，用邮箱+密码登录
- **退出**：导航栏右上角头像下拉菜单中的「退出」

## 数据库

PostgreSQL 通过 `DATABASE_URL` 连接。`prisma/schema.prisma` 中 `provider = "postgresql"`。

```bash
pnpm prisma migrate dev --name <change>   # 开发环境
pnpm prisma migrate deploy                # 生产环境
```

## 部署

传统 VPS 部署（Node 20+ PostgreSQL）：

```bash
pnpm install --frozen-lockfile
pnpm prisma migrate deploy
pnpm build
pnpm start
```

推荐用 nginx/Caddy 反向代理到 443 端口，并提供 HTTPS（Web Push 在非 localhost 下必须 HTTPS）。

## 多人数据隔离

所有业务表都带 `ownerId`，外键级联到 `User`。`getCurrentUser()` 从 Auth.js session 取当前用户 ID，service 层所有查询都自动按 `ownerId` 过滤。

## 微信登录（预留）

数据库已保留 `wechatUnionId`、`openidWeb`、`openidMini` 字段，前端未启用。如需开启：

1. 在 `auth.config.ts` 添加 WeChat provider（参考 `next-auth/providers/wechat`）
2. 配置 `AUTH_WECHAT_APP_ID` 和 `AUTH_WECHAT_APP_SECRET`
3. 登录页添加微信按钮

## Tests

```bash
pnpm test              # unit + service (Vitest)
pnpm test:e2e          # Playwright (requires dev server)
```

## Web Push setup (optional)

```bash
npx web-push generate-vapid-keys
```

把公钥/私钥分别填到 `NEXT_PUBLIC_VAPID_PUBLIC_KEY` 和 `VAPID_PRIVATE_KEY`。

## See also

- `docs/superpowers/specs/2026-06-14-prm-design.md` — 初版单人设计 spec
- `docs/superpowers/specs/2026-06-17-prm-multi-user-design.md` — 多人架构 spec
- `docs/superpowers/plans/2026-06-17-prm-multi-user-implementation.md` — 实施计划
