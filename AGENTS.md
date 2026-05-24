# AGENTS.md — 答题助手后端

Node.js Express 后端 (CommonJS), 端口 **3500**. 从 HTML 提取题目 → Fuse.js 匹配题库答案. 自动考试系统用 Puppeteer 驱动.

## 启动命令

```powershell
npm run dev          # NODE_ENV=development
npm run prod         # NODE_ENV=production
.\启动.bat            # Windows: 读 env.conf, 杀旧进程 3500, 启动
```

## ⚠️ 第一大陷阱: env.conf 优先级

`index.js` 启动时读 `env.conf` **覆盖** `process.env.NODE_ENV`. 即使 `npm run dev` 设了 NODE_ENV, env.conf 说了算.

```powershell
# 当前 env.conf = development
# 要临时覆盖: $env:NODE_ENV="production"; node index.js
```

`.env.development` / `.env.production` **仅文档参考**, 不自动加载. 手动设环境变量:
```powershell
$env:FUSE_THRESHOLD=0.20; node index.js
```

## 测试

```powershell
npm test                 # Jest + coverage
npm run test:unit        # tests/unit/
npm run test:integration # tests/integration/ (需 mock examOrchestrator)
```

**Jest 坑**: `uuid` v14 是 ESM-only, 但项目是 CommonJS. `transformIgnorePatterns: ["/node_modules/(?!(uuid)/)"]` 让 Jest 转译 uuid. 集成测试必须 mock `examOrchestrator`, `monitor`, `reportGenerator`, `logger`.

## 构建

```powershell
npm run build   # pkg → answer-bot.exe (node18-win-x64)
npm run clean   # 删 node_modules + lock, 重装
```

## 关键陷阱

| # | 问题 | 说明 |
|---|------|------|
| 1 | **env.conf 覆盖 NODE_ENV** | 启动脚本读文件覆盖 `process.env`, 优先级 > npm script |
| 2 | **无 .env 自动加载** | `.env.development/production` 仅文档, 环境变量手动传 |
| 3 | **bodyParser 拆为 3 个** | `middleware.js` 含 3 个独立解析器: json, urlencoded, text/plain. 不要合并或通配 `type` |
| 4 | **uuid ESM + CJS** | uuid v14 是 ESM, require() 在 Node>=18 能工作, 但 Jest 需 mock |
| 5 | **Fuse 版本化管理** | 题库变更后必须调 `invalidateFuse()` 清缓存重建 Fuse 实例 |
| 6 | **题库写锁** | `questionBank.withWriteLock()` 防并发写入 |
| 7 | **选项子串匹配** | `findOptionByText` 用 `includes()` 过松, 短文本优先命中. 已修: 子串匹配选最长 |
| 8 | **CORS** | 开发允许 `*`. 生产: `ALLOWED_ORIGINS` 为空回退 `*`, 有白名单则限定 |

## 环境变量默认值 (代码硬编码)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3500` | 端口 (README 写 3000 是旧版) |
| `FUSE_THRESHOLD` | `0.22` | 越小越严格 |
| `CACHE_MAX_SIZE` | `2000` | LRU 缓存条数 |
| `BODY_LIMIT` | `5mb` | 请求体限制 |
| `RATE_LIMIT_WINDOW` | `60000` | ms |
| `RATE_LIMIT_MAX` | `60` | 每窗口请求数 |
| `HTML_MAX_LENGTH` | `1048576` | 防 DoS |
| `ADMIN_TOKEN` | `sycwd123` | 管理员令牌 (middleware.js) |

## 匹配算法概览

1. `cleanText()` 归一化 (全角→半角, 去引号, 合并空白)
2. `extractIndexKeys()` 建倒排索引 (中文词 >=2 字)
3. `getIndexedCandidates()` 缩小候选集 (精确+中文词匹配)
4. Fuse.js 模糊匹配 (候选集 < 全量时建临时 Fuse, 不缓存)
5. LRU 缓存 `answerCache` key = `cleanText(question)`

## 标签搜索

- Chrome 扩展: `scripts/晖哥的晖/huigedehui/` (不依赖 Tampermonkey)
- 油猴脚本: `scripts/管理后台版/`, `auto-answer.user.js` (根目录独立版)
- DOM 配置: `domConfigs/` (antDesignVue.json, generic.json)
- 题库导入: `题库导入/` 目录 `.txt` 文件, 启动时自动扫描导入
