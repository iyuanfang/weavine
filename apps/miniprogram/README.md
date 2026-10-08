# 织遇分享小程序

渲染分享的日程邀请与笔记，是 `www.weavine.com/s/<token>` H5 分享页的原生形态。
与 H5 共用同一套公开 API，无登录、无注册。

## 目录

```
apps/miniprogram/
├── project.config.json   # 微信开发者工具配置（appid 当前为游客占位）
├── app.json / app.js     # 小程序入口（单页：pages/share/share）
└── pages/share/          # 分享详情 + 日程 RSVP
```

## 上线前要做的三件事

1. **填 AppID**：`project.config.json` 的 `appid` 从 `touristappid` 换成正式小程序 AppID
   （注册路径：认证服务号后台 → 复用资质快速注册小程序，免认证费）
2. **配 request 合法域名**：小程序后台 → 开发管理 → 服务器域名，把
   `https://www.weavine.com` 加入 request 合法域名
3. **配置分享进入路径**：小程序管理后台 → 设置 → 下拉入口/分享，把
   `pages/share/share?token=<token>` 配为分享卡落地页；服务端分享链接生成时
   可按 `WEAVINE_SHARE_TARGET=miniprogram` 环境变量切换分享 URL 到小程序
   路径（当前默认 H5）

## API（与 H5 同源）

- `GET  https://www.weavine.com/api/public/share/:token` → 分享内容 JSON
- `POST https://www.weavine.com/api/public/share/:token/rsvp` → 日程回应 `{name, response}`

## 本地开发

微信开发者工具 → 导入 `apps/miniprogram` → 填测试 token：
编译模式 → 添加编译模式 → 启动参数 `token=<分享token>`。
开发者工具可在「详情 → 本地设置」勾选"不校验合法域名"先用后配。
