# AGENTS.md — 答题助手后端

## 项目概述

- **类型**: Node.js Express 后端服务 (CommonJS)
- **功能**: 从网页 HTML 提取题目 → Fuse.js 模糊匹配题库答案 + 自动考试系统 (Puppeteer)
- **入口**: `index.js` (端口 3000, 监听 `0.0.0.0`), WebSocket 监控端口 3001
- **Node.js**: >=18.0.0
- **题库**: `question_bank.json` (gitignored, JSON 数组, 每条含 `{question, answer, question_type, source}`)
- **版本**: 2.0.0 (2026-05-22)

## 启动与 env.conf 优先级陷阱

```powershell
npm run dev    # 开发模式 (NODE_ENV=development)
npm run prod   # 生产模式 (NODE_ENV=production)
.\启动.bat     # Windows 一键启动 (读取 env.conf)
```

**关键行为**: `index.js` 启动时读取 `env.conf` 并**覆盖** `process.env.NODE_ENV`。env.conf 优先级 > npm script 的环境变量。当前 `env.conf` 内容为 `production`。

**无 `.env` 自动加载**: `.env.development` / `.env.production` 仅作文档参考。环境变量需手动设置:
```powershell
$env:FUSE_THRESHOLD=0.20; node index.js
```

## 文件结构

```
publish/
├── index.js               # 服务入口, Express 启动, 加载题库, 扫描 题库导入/ 目录
├── routes.js              # 所有 API 路由 (含自动考试系统 + 监控 + 报告 API)
├── questionBank.js        # 题库内存管理、倒排索引、写锁、TXT 导入
├── questionMatcher.js     # Fuse.js 模糊匹配 + LRU 缓存 + 版本化 Fuse 实例
├── htmlParser.js          # Cheerio HTML 解析 (UTF-8/GBK 自动检测, 4 种策略降级)
├── examOrchestrator.js    # 考试编排器: 会话管理、Puppeteer 驱动、暂停/恢复/终止
├── strategyEngine.js      # 答题策略: 置信度阈值、正态分布延迟、人类行为模拟
├── monitor.js             # 监控系统: WebSocket 实时推送 + 紧急停止
├── reportGenerator.js     # 考试报告: JSON/CSV/HTML 三种格式输出
├── navigator.js           # 智能导航: DOM 元素检测、弹窗处理、页面刷新重试
├── browserDriver.js       # 驱动抽象基类 (PuppeteerDriver / OilMonkeyDriver)
├── middleware.js           # 3 个独立 Body 解析器 + CORS + 限流
├── config.js              # 集中配置 (环境变量默认值、题型常量、考试配置)
├── logger.js              # 日志写入 server.log (>10MB 自动清空)
├── textUtils.js           # cleanText (全角→半角) + extractIndexKeys (倒排索引)
├── cache.js               # LRU 缓存 (利用 Map 插入顺序)
├── env.conf               # 一行文本: development / production
├── 启动.bat               # Windows 启动脚本
├── drivers/               # 浏览器驱动
│   ├── puppeteerDriver.js # Puppeteer 真实浏览器 (headless=false 默认)
│   └── oilMonkeyDriver.js # WebSocket 与油猴脚本通信
├── domConfigs/            # DOM 选择器配置 (antDesignVue.json, generic.json)
├── web/                   # 前端页面
│   ├── index.html         # 主界面 (多 tab: 匹配/搜索/管理/工具)
│   └── tools/             # 工具资源
├── scripts/               # 油猴脚本 + Chrome 扩展
│   ├── 晖哥的晖/huigedehui/  # Chrome 扩展 (不依赖 Tampermonkey)
│   ├── 管理后台版/            # 管理后台油猴脚本
│   └── README.md
├── tests/
│   ├── unit/              # 单元测试 (5 个: cache, questionBank, questionMatcher, strategyEngine, textUtils)
│   └── integration/       # 集成测试 (api.test.js, 需 mock examOrchestrator 因 uuid ESM)
└── auto-answer.user.js    # 根目录油猴脚本 (与 scripts/ 内容不同, 独立控制面板)
```

## API 端点

### 核心 API
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/parse-and-get-answer` | 解析 HTML 获取答案 (核心), 接受 `htmlContent` |
| GET | `/api/question-bank` | 获取全部题库 |
| POST | `/api/question-bank` | 新增单条题目 |
| POST | `/api/question-bank/import` | 批量导入 (文本格式 `正确答案：` 分割) |
| POST | `/api/question-bank/import-file` | 文件直接导入 (支持 base64, GBK 自动检测) |
| GET | `/api/question-bank/search?q=` | 模糊搜索题库 |
| GET | `/api/matching-config` | 获取当前 Fuse 阈值 |
| POST | `/api/matching-config` | 设置阈值 (实时生效, 重建 Fuse 实例) |
| GET | `/api/health` | 健康检查 (生产环境隐藏 memory) |
| GET | `/api/get-env` | 读取 env.conf 环境 |
| POST | `/api/save-env` | 保存环境到 env.conf (需重启生效) |
| GET | `/api/extracted-questions` | 获取最近提取的题干 |
| GET | `/api/read-page-file?file=N.txt` | 读取 page/ 目录文件 (仅 1-3.txt) |

### 自动考试系统
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/start-exam` | 启动考试 (mode: manual/auto) |
| GET | `/api/exam-status/:sessionId` | 查询考试状态 |
| POST | `/api/pause-exam/:sessionId` | 暂停 |
| POST | `/api/resume-exam/:sessionId` | 恢复 |
| POST | `/api/abort-exam/:sessionId` | 终止 |
| GET | `/api/exam-report/:sessionId` | 获取报告 (需完成或终止) |
| POST | `/api/import-dom-config` | 导入 DOM 选择器配置 |

### 监控 API
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/monitor/active-sessions` | 所有活跃监控会话 |
| GET | `/api/monitor/session/:sessionId` | 监控会话详情 |
| POST | `/api/monitor/emergency-stop/:sessionId` | 紧急停止 |
| POST | `/api/monitor/clear-stop/:sessionId` | 清除紧急停止 |

### 报告 API
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/reports/generate/:sessionId` | 生成报告 (format: json/csv/html/all) |
| GET | `/api/reports` | 报告列表 |
| GET | `/api/reports/:sessionId/:format` | 下载报告文件 |
| DELETE | `/api/reports/:sessionId` | 删除报告 |

## 匹配算法

1. **文本清洗**: `cleanText()` → 全角转半角、合并空白、去首尾引号、归一化括号
2. **倒排索引**: `extractIndexKeys()` 提取全文 + 连续中文词 (>=2 字)
3. **候选集缩小**: `getIndexedCandidates()` 精确匹配 + 中文词匹配缩小范围
4. **Fuse.js 模糊匹配**: 在候选集上运行; 候选集小于全量时建临时 Fuse (不缓存)
5. **版本化 Fuse 实例**: `dataVersion` 递增触发重建 (`invalidateFuse()`)
6. **LRU 缓存**: `cleanText(question)` 作 key, `answerCache` 最多 2000 条

**阈值**: 默认 0.22 (越小越严格), 通过 `FUSE_THRESHOLD` 环境变量或 API 调整。

## HTML 解析 (4 种策略降级)

1. `.ti` 类元素 (Ant Design Vue)
2. `.ant-radio-group` (新车务段系统, 从父元素提取题干)
3. 直接从 `.ant-radio-wrapper` label 文本提取
4. `div[id^="pt"]` (局网考试 ASP.NET WebForms, span + table 结构)

支持 UTF-8/GBK 自动检测 + 乱码特征识别 (`isValidUTF8`)。

## 已知 Bug / 注意事项

### `findOptionByText` 子串匹配过松
`questionMatcher.js` 中当答案以文本形式存储时, `includes()` 子串匹配会导致短文本选项优先命中。当前修复: 子串匹配时选择**选项文本最长**的。

### uuid ESM 兼容性
`examOrchestrator.js` 使用 `uuid` v14 (ESM only), 但项目是 CommonJS。Jest 测试中需要 mock examOrchestrator 模块 (`jest.mock('../../examOrchestrator', ...)`)。不影响运行时 (Node.js >=18 支持 `require()` ESM)。

### bodyParser 拆分
`middleware.js` 有 **3 个独立解析器**, 不要合并或通配 `type`:
- `application/json` → `express.json()`
- `application/x-www-form-urlencoded` → `express.urlencoded()`
- `text/plain` → `express.text()`

### CORS 行为
- 开发环境: 允许所有来源 (`*`)
- 生产环境: `ALLOWED_ORIGINS` 为空时回退到 `*`; 有白名单时仅允许列表内域名

### 环境变量 vs 硬编码默认值
| 变量 | 代码硬编码 | 说明 |
|------|-----------|------|
| `FUSE_THRESHOLD` | `0.22` | `config.fuseThresholdDefault` |
| `PORT` | `3000` | `config.port` |
| `CACHE_MAX_SIZE` | `2000` | `config.cacheMaxSize` |
| `BODY_LIMIT` | `5mb` | `config.bodyLimit` |
| `RATE_LIMIT_WINDOW` | `60000` | `config.rateLimitWindow` |
| `RATE_LIMIT_MAX` | `60` | `config.rateLimitMax` |
| `HTML_MAX_LENGTH` | `1048576` | `config.htmlMaxLength` (防 DoS) |

## 测试

```powershell
npm test                 # Jest 全部测试 + coverage
npm run test:unit        # 仅单元测试 (tests/unit/)
npm run test:integration # 仅集成测试 (tests/integration/)
npm test -- --watch      # watch 模式
```

**Jest 配置注意**: `transformIgnorePatterns: ["/node_modules/(?!(uuid)/)"]` — 因为 uuid 是 ESM-only, 需要被转译。

**集成测试需要 mock**: `examOrchestrator` (uuid ESM), `monitor`, `reportGenerator`, `logger`。

## 构建

```powershell
npm run build   # pkg → answer-bot.exe (node18-win-x64, ~50-100MB)
npm run clean   # rm -rf node_modules package-lock.json && npm install
```

构建产物无需 Node.js 即可运行, 但配置文件 (env.conf, question_bank.json) 仍需在同一目录。

## 题库导入格式

每行格式: `序号. 题干 正确答案：答案内容`

- 判断题自动检测: `对/错/正确/错误` 开头
- 单选题: `A.` 开头
- 多选题: `A.内容;B.内容` 或纯字母 `ABC`

启动时自动扫描 `题库导入/` 目录下的 `.txt` 文件并导入。
