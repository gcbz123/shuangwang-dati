# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

答题助手后端系统，支持两种核心模式：
- **基础答题助手**: 解析网页 HTML，从题库模糊匹配答案
- **自动考试系统**: 混合模式（手动/自动）使用浏览器驱动自动完成答题

**技术栈**: Node.js >=18.0.0, Express, Puppeteer, Fuse.js, Cheerio
**入口**: `index.js` (端口 3000, 监听 `0.0.0.0`)
**题库文件**: `question_bank.json` (gitignored, JSON 数组)

## 关键架构

### 双层架构
```
┌─────────────────────────────────────┐
│      表现层 (Presentation)           │
│  Web UI (前端/) + 油猴脚本 (dati/)    │
└──────────────┬──────────────────────┘
               │ REST API
┌──────────────▼──────────────────────┐
│      应用层 (Application)            │
│  ExamOrchestrator (会话管理/编排)    │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      服务层 (Service)                │
│  BrowserDriver (Puppeteer/OilMonkey)│
│  Navigator (智能导航/DOM识别)        │
│  StrategyEngine (答题策略/模拟)      │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      核心层 (Core)                   │
│  QuestionBank (倒排索引/写锁)        │
│  QuestionMatcher (Fuse.js+LRU)       │
│  HtmlParser (UTF-8/GBK自动检测)      │
└─────────────────────────────────────┘
```

### 核心文件职责
- `index.js`: 服务器入口, 启动流程, 题库加载, `题库导入/` 扫描
- `routes.js`: 所有 API 路由, 限流中间件, 自动考试系统 API
- `questionBank.js`: 题库内存管理, 倒排索引, 写锁保护, TXT 导入
- `questionMatcher.js`: Fuse.js 模糊匹配, LRU 缓存, 版本化 Fuse 实例
- `htmlParser.js`: Cheerio HTML 解析, UTF-8/GBK 自动检测, 3 种策略降级
- `middleware.js`: 3 个独立 Body 解析器, CORS, 限流
- `config.js`: 集中配置 (注意: 不自动加载 .env 文件)
- `logger.js`: 日志写入 `server.log` (>10MB 自动清空)
- `examOrchestrator.js`: 考试会话管理, 流程编排, 异常处理
- `navigator.js`: 智能导航, DOM 识别, 弹窗处理
- `strategyEngine.js`: 答题策略, 人类行为模拟, 正态分布延迟
- `drivers/`: 浏览器驱动抽象 (PuppeteerDriver, OilMonkeyDriver)
- `domConfigs/`: DOM 选择器配置 (antDesignVue.json, generic.json)

## 常用命令

```bash
# 启动服务器
npm install                    # 安装依赖
node index.js                  # 直接启动
npm run dev                    # 开发模式 (注意: env.conf 优先级更高)
npm run prod                   # 生产模式
.\启动.bat                     # Windows 一键启动

# 构建 Windows 可执行文件
npm run build                  # 生成 answer-bot.exe (使用 pkg 打包)

# 开发调试
NODE_ENV=development node index.js
# Windows PowerShell 环境变量设置示例:
# $env:FUSE_THRESHOLD=0.20; node index.js
# $env:NODE_ENV="development"; node index.js

# 清理并重装依赖
npm run clean                  # 删除 node_modules 和 package-lock.json 后重装
```

## 重要陷阱

### 1. env.conf 优先级陷阱
`index.js` 启动时读取 `env.conf` 并**覆盖** `process.env.NODE_ENV`。这意味着:
- `npm run dev` 如果 `env.conf` 内容是 `production`, 服务会以生产模式启动
- env.conf 优先级 > npm script 的环境变量

### 2. .env 文件不会被自动加载
`.env.development` 和 `.env.production` 仅作为文档参考。实际设置环境变量需要手动传入:
```powershell
$env:FUSE_THRESHOLD=0.20; node index.js
```

### 3. Body Parser 独立解析器
`middleware.js` 有 **3 个独立解析器**, 不要合并或通配 `type`:
- `application/json` → `express.json()`
- `application/x-www-form-urlencoded` → `express.urlencoded()`
- `text/plain` → `express.text()`

### 4. Fuse 实例版本化管理
`questionMatcher.js` 使用 `dataVersion` 递增触发重建 (`invalidateFuse()`), 避免缓存问题。题库变更时必须调用 `invalidateFuse()`。

### 5. 题库写锁
`questionBank.js` 使用写锁 (`withWriteLock()`) 防止并发写入导致数据丢失。

## 关键配置

### 环境变量
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FUSE_THRESHOLD` | `0.22` (硬编码) | Fuse.js 阈值 0~1, 越小越严格 |
| `NODE_ENV` | `development` | 由 `env.conf` 决定 |
| `PORT` | `3000` | 监听端口 |
| `ALLOWED_ORIGINS` | 开发 `*`, 生产空→回退 `*` | CORS 白名单 (逗号分隔) |
| `BODY_LIMIT` | `5mb` | 请求体大小限制 |
| `CACHE_MAX_SIZE` | `2000` | LRU 缓存条目数 |
| `HTML_MAX_LENGTH` | `1048576` | HTML 内容最大字符数 (防 DoS) |

### 自动考试配置
在 `config.examConfig` 中:
- `defaultTimeLimit`: 默认考试时间限制 (7200000ms = 2小时)
- `maxConcurrentSessions`: 最大并发会话数 (5)
- `heartbeatInterval`: 心跳间隔 (30000ms)
- `defaultStrategy`: 答题策略 (置信度、延迟、跳过低置信度等)

## 核心算法

### 匹配算法 (questionMatcher.js)
1. **倒排索引**: `extractIndexKeys()` 提取全文 + 连续中文词 (>=2 字)
2. **候选集缩小**: `getIndexedCandidates()` 精确匹配 + 中文词匹配缩小范围
3. **Fuse.js 模糊匹配**: 在候选集上运行 (候选集小于全量时建临时 Fuse)
4. **版本化 Fuse 实例**: `dataVersion` 递增触发重建 (`invalidateFuse()`)
5. **LRU 缓存**: 答案缓存减少重复搜索

### 答题策略 (strategyEngine.js)
- **置信度评估**: 基于匹配分数计算, 可配置 `minConfidence` 阈值
- **人类延迟模拟**: 正态分布随机延迟, 基于题目长度计算
- **时间分配**: 动态计算剩余时间分配, 智能决定是否加速
- **优先级排序**: 先答高置信度题目

### HTML 解析 (htmlParser.js)
- **编码检测**: UTF-8/GBK 自动检测, 3 种策略降级
- **乱码检测**: 检查 UTF-8 有效性, 乱码特征识别
- **多策略提取**: 支持多种 DOM 结构 (.ti 类等)

## API 端点

### 基础答题助手
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/parse-and-get-answer` | 解析 HTML 获取答案 (核心) |
| GET | `/api/question-bank` | 获取全部题库 |
| POST | `/api/question-bank` | 新增单条题目 |
| POST | `/api/question-bank/import` | 批量导入 (文本格式) |
| POST | `/api/question-bank/import-file` | 直接导入文件内容 |
| GET | `/api/matching-config` | 获取当前阈值 |
| POST | `/api/matching-config` | 设置阈值 (实时生效) |
| GET | `/api/health` | 健康检查 (生产环境隐藏 memory) |
| GET | `/api/read-page-file?file=N.txt` | 读取页面源码文件 |
| POST | `/api/save-env` | 保存环境到 `env.conf` (需重启) |
| GET | `/api/get-env` | 读取当前环境 |
| GET | `/api/extracted-questions` | 获取最近提取的题干 |

### 自动考试系统
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/start-exam` | 启动考试 (支持 manual/auto 模式) |
| GET | `/api/exam-status/:sessionId` | 查询考试状态 |
| POST | `/api/pause-exam/:sessionId` | 暂停考试 |
| POST | `/api/resume-exam/:sessionId` | 恢复考试 |
| POST | `/api/abort-exam/:sessionId` | 终止考试 |
| GET | `/api/exam-report/:sessionId` | 生成考试报告 |
| POST | `/api/import-dom-config` | 导入 DOM 选择器配置 |

## 开发注意事项

### 题库变更流程
1. 修改题库 → 调用 `saveQuestionBank(bank)`
2. 必须调用 `invalidateFuse()` 清空缓存
3. 写锁会自动保护并发写入

### DOM 配置扩展
1. 在 `domConfigs/` 创建新 JSON 文件
2. 定义选择器 (nextButton, questionContainer 等)
3. 通过 `/api/import-dom-config` 导入
4. 启动考试时指定 `domConfigName`

### 驱动扩展
当前支持的驱动:
- `PuppeteerDriver`: 使用 Puppeteer 的真实浏览器 (支持 headless/有头模式)
- `OilMonkeyDriver`: 配合油猴脚本使用 (用于手动模式)

扩展新驱动:
1. 继承 `BrowserDriver` 基类
2. 实现核心方法: `navigate`, `getPageSource`, `click`, `fillInput` 等
3. 在 `examOrchestrator.js` 中注册新驱动

### 反检测措施
- PuppeteerDriver 已实现基础反检测 (User-Agent 轮换、headless 特征隐藏)
- 建议在驱动中添加随机延迟、鼠标移动模拟等
- 策略引擎提供正态分布延迟, 可调整 `randomDelayEnabled`

### 编码处理
- `htmlParser.js` 自动检测 UTF-8/GBK
- 使用 `iconv-lite` 处理 GBK 编码
- 导入题库时自动检测文件编码

## 故障排查

### 匹配结果不准确
- 检查 `FUSE_THRESHOLD` 值 (0~1, 默认 0.22, 越小越严格)
- 调整阈值: `$env:FUSE_THRESHOLD=0.20; node index.js`
- 重启服务清除 LRU 缓存

### 题库未更新
- 确保调用了 `invalidateFuse()` 清空 Fuse 缓存
- 检查题库文件是否正确保存
- 查看日志确认题库加载成功

### 编码乱码
- `htmlParser.js` 会自动检测 UTF-8/GBK
- 如仍有问题，检查源网页实际编码
- 手动导入时选择正确的编码格式

### 并发问题
- 检查 `maxConcurrentSessions` 配置 (默认 5)
- 会话通过 UUID 管理，通过 `/api/exam-status/:sessionId` 查询状态
- 查看日志中的错误堆栈追踪会话问题

## 数据文件

### Gitignored 文件 (不要提交)
- `question_bank.json`: 主题库文件 (JSON 数组格式)
- `extracted_questions.json`: 最近提取的题干
- `*.log`, `error.log`, `server.log`: 日志文件
- `question_bank.json.bak`: 题库备份
- `*.exe`: 构建的可执行文件

### 数据持久化目录
- `题库导入/`: 放入 .txt 文件，服务启动时自动导入

## 前端资源
- `前端/`: Web UI 管理后台
  - `index.html`: 主界面 (答题助手)
  - `admin.html`: 管理界面
  - `auto-test.html`: 自动测试界面
  - `tools/`: 工具和脚本资源
- `dati/`: 油猴脚本目录 (手动模式)
- `auto-answer.user.js`: 油猴脚本主文件 (与 `dati/` 内容相同)

## 日志
- `server.log`: 服务运行日志 (>10MB 自动清空)
- `error.log`: 错误日志
- 通过 `logger.js` 统一管理, 支持 `debug/info/warn/error` 级别

## 构建 Windows 可执行文件

使用 `pkg` 工具将 Node.js 应用打包为单文件 Windows 可执行程序:

```bash
npm run build
# 生成: answer-bot.exe
```

配置在 `package.json` 中:
- 目标平台: `node18-win-x64`
- 输出文件: `answer-bot.exe`
- 包含: 所有依赖和资源 (除 node_modules)

注意:
- 构建 Windows exe 需要运行 Windows 系统
- 构建产物较大 (~50-100MB)
- 无需安装 Node.js 即可运行
- 配置文件仍需在同一目录 (env.conf, question_bank.json)