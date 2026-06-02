# AGENTS.md — 答题助手后端

## 项目概述
- **类型**: Node.js Express 后端 (CommonJS)
- **功能**: HTML 提取题目 → Fuse.js 模糊匹配题库答案 + Puppeteer 自动考试
- **入口**: `index.js` (端口 3500, `0.0.0.0`), WebSocket 监控端口 3501
- **Node**: >=18.0.0
- **题库**: `question_bank.json` (gitignored, JSON 数组: `{question, answer, question_type, source}`), 类型: `single`/`multiple`/`judgment`/`short_answer`

## 关键命令
```powershell
npm run dev              # 开发 (NODE_ENV=development)
npm run prod             # 生产 (NODE_ENV=production)
npm test                 # Jest + coverage
npm run test:unit        # 仅 tests/unit/ (⚠️ 实际跑全部, 见下方)
npm run test:integration # 仅 tests/integration/ (⚠️ 同上)
npm run build            # pkg → answer-bot.exe (node18-win-x64)
npm run clean            # 删除 node_modules + lockfile 后重装
.\启动.bat               # Windows 一键启动 (kill 旧进程 port 3500)
.\kill-port.bat          # 单独杀掉 port 3500 占用进程
```

## ⚠️ env.conf 优先级陷阱
`index.js` 启动时读取 `env.conf` **覆盖** `process.env.NODE_ENV`。env.conf > npm script 环境变量。当前内容: `development`。

**.env 文件不自动加载** — `.env.development` / `.env.production` 仅文档参考。手动设:
```powershell
$env:FUSE_THRESHOLD=0.20; node index.js
```

## 架构快照
| 文件 | 职责 |
|------|------|
| `questionBank.js` | 内存题库 + 倒排索引 + 写锁 (`withWriteLock`) + TXT 导入 |
| `questionMatcher.js` | Fuse.js 模糊匹配 + LRU 缓存 (2000 条) + 版本化 Fuse (需调用 `invalidateFuse()`) |
| `htmlParser.js` | Cheerio 解析, 4 策略降级: `.ti` → `.ant-radio-group` → label 文本 → `div[id^="pt"]` |
| `examOrchestrator.js` | 考试会话管理, 使用 `uuid` v14 (ESM, Node >=18 可 `require()`) |
| `middleware.js` | 3 个独立 Body 解析器 (json/urlencoded/text) + CORS + 限流 + 管理员认证 |
| `drivers/puppeteerDriver.js` | Puppeteer 真实浏览器 (默认 headless=false) |
| `drivers/oilMonkeyDriver.js` | WebSocket 与油猴脚本通信 |

## 测试陷阱
- **`package.json` 中 `test:unit`/`test:integration` 使用了 `--testPathPatterns` (错误)**, 正确参数是 `--testPathPattern` (注意单复数)。当前脚本不生效, 运行后会跑所有测试。
- **Jest `transformIgnorePatterns`**: `["/node_modules/(?!(uuid)/)"]` — uuid v14 是 ESM-only, 需被 babel 转译。
- **集成测试** 需 mock: `examOrchestrator` (uuid ESM), `monitor`, `reportGenerator`, `logger`。
- **测试数据**: `tests/题库/` 包含 .txt 和 .xls 题库样本, `tests/kill.bat` 用于杀掉测试残留进程。

## 已知 Bug
- ~~`questionMatcher.js` `findOptionByText`: 子串匹配 (`includes()`) 导致短文本选项优先命中~~ **已修复**: 子串匹配时选**文本最长**选项 (line 158-168)。

## 匹配算法 (questionMatcher.js)
1. `cleanText()`: 全角→半角、合并空白、去首尾引号
2. `extractIndexKeys()`: 倒排索引 (全文 + >=2 字中文词)
3. `getIndexedCandidates()`: 精确 + 中文词匹配缩小候选集
4. Fuse.js 匹配 (候选集 < 全量时临时 Fuse, 不缓存)
5. `dataVersion` 递增触发 Fuse 重建 (`invalidateFuse()`)
6. LRU 缓存 key=`cleanText(question)`, max=2000

**阈值**: 默认 `FUSE_THRESHOLD=0.22` (越小越严格), 可通过 API 实时调整。

## 标签搜索
- Chrome 扩展: `scripts/晖哥的晖/chrome-extension/` (Manifest V3, `content.js` 核心)
- 油猴脚本: `scripts/管理后台版/`, `scripts/晖哥的晖/auto-answer-enhanced.user.js`
- DOM 配置: `domConfigs/` (antDesignVue.json, generic.json)
- 题库导入: `题库导入/` 目录 `.txt` 文件, 启动时自动扫描导入

## Chrome 插件要点
- `content.js` 支持 `enabled` 配置，关闭时不注入面板/不绑快捷键
- `manifest.json` 限定域名后，content script 仅注入白名单页面
- 职教考试答题时，选项点击**严格限定在当前题目容器内**，不回退到全局查询（防跨题目污染）

## 其他注意
- 启动时自动扫描 `题库导入/` 目录 `.txt` 文件并导入 (去重后 `saveQuestionBank` + `invalidateFuse`)
- CORS: 开发环境 `*`; 生产环境 `ALLOWED_ORIGINS` 为空时仅同源 (不设 CORS 头)
- `bodyLimit` 默认 `5mb`, 3 个解析器分别绑定 `application/json`, `application/x-www-form-urlencoded`, `text/plain`
- 构建产物 `answer-bot.exe` 无需 Node, 但 `env.conf`/`question_bank.json` 仍需同目录
