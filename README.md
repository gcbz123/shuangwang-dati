# 答题助手后端

## 📦 发布说明

### 版本信息
- **版本**: 2.0.0
- **Node.js**: >=18.0.0
- **更新日期**: 2026-05-22

### 核心功能
- ✅ 支持局网考试/职教考试自动识别
- ✅ Fuse.js 模糊匹配 + LRU 缓存
- ✅ UTF-8/GBK 自动编码检测
- ✅ 自动考试系统（手动/自动双模式）
- ✅ 题库批量导入（支持 Excel/TXT）
- ✅ 实时答题统计

## 🚀 快速启动

### 方式一：直接运行
```bash
npm install
node index.js
```

### 方式二：使用脚本
```bash
# Windows
.\启动.bat
```

### 方式三：生产模式
```bash
npm run prod
```

## 🌐 访问地址

- **本地访问**: http://localhost:3000/
- **局域网访问**: http://你的IP:3000/

## 📋 功能说明

### 1. 答题助手
粘贴网页源码，自动匹配题库返回答案。

### 2. 题库管理
- 导入题库：`题库导入/` 目录放入 .txt 文件，重启自动导入
- 批量导入：通过 Web 界面导入 Excel/文本格式题库
- 题型分类：自动识别单选/多选/判断/简答

### 3. 自动考试
- **手动模式**：配合油猴脚本使用
- **自动模式**：使用 Puppeteer 驱动浏览器自动答题

## 📁 目录结构

```
publish/
├── index.js              # 服务入口
├── routes.js             # API 路由
├── questionBank.js       # 题库管理
├── questionMatcher.js    # 答案匹配
├── htmlParser.js         # HTML 解析
├── config.js             # 配置
├── examOrchestrator.js    # 考试编排器
├── drivers/              # 浏览器驱动
│   ├── puppeteerDriver.js
│   └── oilMonkeyDriver.js
├── web/                   # Web UI
│   └── index.html         # 主界面
├── scripts/               # 脚本
│   ├── 晖哥的晖/          # 浏览器扩展
│   │   └── huigedehui/    # Chrome 扩展
│   ├── 管理后台版/        # 油猴脚本(管理后台)
│   └── auto-answer-enhanced.user.js
├── domConfigs/             # DOM 选择器配置
└── 启动.bat               # Windows 启动脚本
```

## ⚙️ 配置

### 环境变量
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FUSE_THRESHOLD` | `0.22` | 匹配阈值 (0~1) |
| `NODE_ENV` | `development` | 由 env.conf 决定 |
| `PORT` | `3000` | 监听端口 |
| `ALLOWED_ORIGINS` | `*` | CORS 白名单 |

### 配置文件
- `env.conf` - 环境配置 (development/production)
- `question_bank.json` - 题库数据
- `domConfigs/` - DOM 选择器配置

## 🔧 API 接口

### 核心接口
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/parse-and-get-answer` | 解析 HTML 获取答案 |
| GET | `/api/question-bank` | 获取题库 |
| POST | `/api/question-bank/import` | 批量导入 |
| GET | `/api/matching-config` | 获取阈值 |
| POST | `/api/matching-config` | 设置阈值 |

### 自动考试接口
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/start-exam` | 启动考试 |
| GET | `/api/exam-status/:sessionId` | 查询状态 |
| POST | `/api/pause-exam/:sessionId` | 暂停 |
| POST | `/api/abort-exam/:sessionId` | 终止 |

## 🛠️ 浏览器扩展

### Chrome 扩展 (推荐)
1. 打开 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `scripts/晖哥的晖/huigedehui`

**快捷键**: `-` 获取源码 | `+` 开始答题 | `*` 隐藏面板

### 油猴脚本
1. 安装 Tampermonkey 或 ScriptCat
2. 导入 `scripts/auto-answer-enhanced.user.js`

## 📝 日志

- `server.log` - 运行日志 (>10MB 自动清空)
- 查看日志: `tail -f server.log` (Linux) 或直接打开文件

## ⚠️ 注意事项

1. **env.conf 优先级**: `index.js` 启动时读取 `env.conf` 覆盖 `NODE_ENV`
2. **.env 不自动加载**: 环境变量需手动设置或通过命令行传入
3. **题库变更**: 导入后自动调用 `invalidateFuse()` 清空缓存

## 📄 许可证
ISC License