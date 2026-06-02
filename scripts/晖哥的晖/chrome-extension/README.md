# 晖哥的助手 - Chrome 插件版

> 基于油猴脚本 `auto-answer-enhanced.user.js v2.2` 移植的 Chrome 扩展，核心逻辑保持一致。

## 功能特性

- ✅ 支持**局网考试**（ASP.NET 架构）和**职教考试**（Ant Design Vue 架构）
- ✅ 自动检测考试类型
- ✅ 支持单选、多选、判断、简答四种题型
- ✅ **自动模式**：连接本地 API 服务，全自动答题
- ✅ **手动模式**：按快捷键控制节奏
- ✅ 局网考试**自动翻页**
- ✅ WebSocket 远程控制通道（与油猴脚本保持一致）
- ✅ 悬浮控制面板 + Chrome Popup 双重操控界面

---

## 目录结构

```
chrome-extension/
├── manifest.json        # 插件配置（Manifest V3）
├── content.js           # 内容脚本（核心逻辑）
├── background.js        # Service Worker
├── popup.html           # 插件弹窗界面
├── popup.js             # 弹窗控制逻辑
├── generate-icons.js    # 图标生成脚本（开发用）
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 安装步骤

### 1. 加载插件（开发者模式）

1. 打开 Chrome，地址栏输入：`chrome://extensions/`
2. 右上角开启 **「开发者模式」**
3. 点击 **「加载已解压的扩展程序」**
4. 选择 `chrome-extension/` 目录
5. 插件安装成功，工具栏出现 🎓 图标

### 2. 确认本地 API 服务运行

插件需要连接本地 API 服务（与油猴脚本一致）：
- REST API：`http://localhost:3500`
- WebSocket：`ws://localhost:3501`

---

## 使用方法

### 方式一：使用 Popup 弹窗（推荐）

1. 打开考试页面
2. 点击工具栏 🎓 图标打开弹窗
3. 点击 **「获取题目源码」** → 等待提示「就绪」
4. 点击 **「开始答题」** → 自动完成

### 方式二：使用页面快捷键（与油猴脚本一致）

| 按键 | 功能 |
|------|------|
| `-`  | 获取源码并解析 |
| `+`  | 开始答题 |
| `*`  | 显示/隐藏悬浮面板 |
| `/`  | 停止答题 |
| `D`  | 输出调试信息到控制台 |
| `H`  | 显示/隐藏快捷键提示 |

> ⚠️ 快捷键在输入框中不生效（避免干扰正常输入）

---

## 配置说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| 自动模式 | 连接 WebSocket 后全自动操作 | 关 |
| 自动翻页 | 局网考试答完当前页后自动翻页 | 关 |

配置会自动同步保存到 Chrome 存储，下次打开页面时自动恢复。

---

## 与油猴脚本的差异

| 功能 | 油猴脚本 | Chrome 插件 |
|------|---------|------------|
| 注入方式 | Tampermonkey | content_scripts |
| 通知 | `GM_notification` | `chrome.notifications` |
| 配置存储 | 内存（刷新丢失） | `chrome.storage.local`（持久化） |
| 样式注入 | `GM_addStyle` | 动态 `<style>` 标签 |
| eval/脚本 | `eval()` | `new Function()` |
| 控制面板 | 悬浮面板 | 悬浮面板 + Popup 双重界面 |

---

## 开发说明

如需替换更精美的图标，将 PNG 文件放入 `icons/` 目录（16px、48px、128px 三种尺寸）即可。
