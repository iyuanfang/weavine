# Weavine Landing Page

Static landing page served at `weavine.financialagent.cc/`.

Astro 4 + Tailwind 3 · 零 JS · 纯静态 · ~30KB HTML

## Dev

```bash
pnpm install
pnpm dev      # http://localhost:4321
```

## Build

```bash
pnpm build    # → ./dist/
```

## Deploy

构建产物通过 `scripts/deploy-landing.sh` 上传到服务器的 `/www/weavine/landing/`。

## Layout

```
src/
├── pages/index.astro     # 整页（hero / features / screenshots / download / footer）
└── styles/global.css     # Tailwind directives
```

部署后由 nginx 路由：

```
GET /              →  /www/weavine/landing/index.html
GET /<anything>    →  /www/weavine/spa/index.html  (web-spa，零改动)
```
