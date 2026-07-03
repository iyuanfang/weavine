# Weavine · Personal Relationship Manager

Offline-first 人脉管理桌面应用。Tauri v2 (Rust) + Vite/React SPA + rusqlite (本地 SQLite)。无外部数据库依赖，单一二进制即可运行。

## Quick start (dev)

```bash
pnpm install
pnpm tauri dev          # 全栈开发：自动启动 Vite + Rust + 桌面窗口
```

首次启动会自动创建 `dev.db` 并执行 `src-tauri/src/migration.rs` 中的 `SCHEMA_SQL` 完成建表。Windows / macOS / Linux 行为一致。

## 配置

无外部配置。数据库路径、端口、缓存目录均在本地：

- 数据库：`%APPDATA%/com.weavine.prm/dev.db`（Windows）/ `~/Library/Application Support/com.weavine.prm/dev.db`（macOS）/ `~/.local/share/com.weavine.prm/dev.db`（Linux）
- HTTP 端口：默认 3299，可在 `tauri.conf.json` 中调整
- Web Push（可选）：`npx web-push generate-vapid-keys` 生成 VAPID 密钥，填入对应环境变量

## 桌面打包

```bash
./scripts/dev.sh bundler       # 本地 .deb 包（Linux）
./scripts/dev.sh release       # 完整 .deb + .AppImage
pnpm tauri build               # 跨平台正式包
```

## Schema 变更

所有表结构在 `src-tauri/src/migration.rs` 中以 `SCHEMA_SQL` 常量维护（`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`，幂等）。修改后只需重新启动应用即可生效。

## 数据隔离

所有业务表都带 `ownerId` 外键到本地用户记录。Service 层查询自动按 `ownerId` 过滤。本应用为单用户离线设计，无多租户场景。

## Tests

```bash
pnpm --dir apps/web-spa typecheck   # 前端类型检查
cargo check --manifest-path src-tauri/Cargo.toml   # Rust 类型检查
cargo run --example smoke --manifest-path src-tauri/Cargo.toml   # DB schema smoke test
```

## See also

- `docs/superpowers/specs/2026-06-14-prm-design.md` — 初版单人设计 spec
- `docs/superpowers/specs/2026-06-17-prm-timeline-redesign.md` — 时间轴 redesign
- `docs/mobile-limitations.md` — 移动端 (Android/iOS) 限制说明
- `scripts/dev.sh help` — 日常开发命令
