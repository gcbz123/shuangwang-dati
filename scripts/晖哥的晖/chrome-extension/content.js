// content.js - 晖哥的助手 Chrome 插件内容脚本
// 核心逻辑源自 auto-answer-enhanced.user.js，保持功能一致

(function() {
    'use strict';

    // 防止重复注入
    if (window.__huigeAssistantLoaded) return;
    window.__huigeAssistantLoaded = true;

    // ========== 配置 ==========
    const CONFIG = {
        apiUrl: 'http://10.104.240.163:3500',
        wsPort: 3501,
        autoMode: false,
        autoNextPage: true
    };

    // ========== 状态管理 ==========
    let state = {
        panel: null,
        ws: null,
        isRunning: false,
        isPaused: false,
        answers: null,
        examType: null,  // '局网考试' | '职教考试' | null
        typeStats: { danxuan: 0, duoxuan: 0, panduan: 0, jianda: 0 },
        totalQuestions: 0,
        answeredCount: 0,
        skippedCount: 0,
        apiConnected: false,
        apiCheckTimer: null
    };

    // ========== 样式定义 ==========
    const STYLES = `
        #exam-control-panel {
            position: fixed;
            top: 20px;
            right: 0;
            transform: translateX(calc(100% - 8px));
            width: 160px;
            max-height: calc(100vh - 120px);
            overflow-y: auto;
            background: rgba(30, 41, 59, 0.45);
            backdrop-filter: blur(16px) saturate(180%);
            -webkit-backdrop-filter: blur(16px) saturate(180%);
            border-radius: 10px 0 0 10px;
            padding: 10px 10px 8px 12px;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #f1f5f9;
            font-size: 13px;
            border: 1px solid rgba(255,255,255,0.15);
            border-right: none;
            box-shadow: 0 8px 32px rgba(0,0,0,0.15);
            transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
            cursor: default;
        }

        #exam-control-panel::before {
            content: '';
            position: absolute;
            left: -14px;
            top: 16px;
            width: 14px;
            height: 32px;
            background: linear-gradient(180deg, #60a5fa, #a78bfa);
            border-radius: 4px 0 0 4px;
            box-shadow: 0 0 16px rgba(96, 165, 250, 0.4);
            transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        }

        #exam-control-panel:hover {
            transform: translateX(0);
            box-shadow: -4px 0 24px rgba(0,0,0,0.25);
        }

        #exam-control-panel:hover::before {
            height: calc(100% - 16px);
            border-radius: 14px 0 0 14px;
            box-shadow: 0 0 20px rgba(96, 165, 250, 0.5);
        }

        #exam-control-panel h3 {
            margin: 0 0 6px 0;
            font-size: 12px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 4px;
            color: #fff;
        }

        #exam-control-panel .mode-selector {
            background: rgba(255,255,255,0.08);
            border-radius: 5px;
            padding: 5px 8px;
            margin-bottom: 6px;
        }

        #exam-control-panel .mode-option {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            padding: 2px 0;
            font-size: 11px;
        }

        #exam-control-panel .mode-option input[type="checkbox"] {
            width: 13px;
            height: 13px;
            cursor: pointer;
        }

        #exam-control-panel .status-section {
            background: rgba(255,255,255,0.06);
            border-radius: 5px;
            padding: 5px 8px;
            margin-bottom: 4px;
        }

        #exam-control-panel .status-item {
            display: flex;
            justify-content: space-between;
            margin: 3px 0;
            font-size: 11px;
        }

        #exam-control-panel .status-value {
            font-weight: 600;
            color: #60a5fa;
        }

        #exam-control-panel .progress-bar {
            width: 100%;
            height: 4px;
            background: rgba(255,255,255,0.1);
            border-radius: 2px;
            overflow: hidden;
            margin-top: 5px;
        }

        #exam-control-panel .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #60a5fa 0%, #a78bfa 100%);
            transition: width 0.3s ease;
            border-radius: 3px;
        }

        #exam-control-panel .close-btn {
            position: absolute;
            top: 6px;
            right: 8px;
            background: none;
            border: none;
            color: rgba(255,255,255,0.5);
            font-size: 16px;
            cursor: pointer;
            width: 22px;
            height: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: all 0.2s;
            line-height: 1;
        }

        #exam-control-panel .close-btn:hover {
            background: rgba(255,255,255,0.15);
            color: white;
        }

        #exam-control-panel .key {
            background: rgba(255,255,255,0.15);
            padding: 1px 4px;
            border-radius: 3px;
            font-size: 10px;
        }

        /* 就绪提示 */
        #exam-ready-popup {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: #fff;
            padding: 20px 40px;
            border-radius: 30px;
            font-size: 20px;
            font-weight: 400;
            z-index: 999999;
            letter-spacing: 2px;
            display: none;
            animation: fadeInOut 3s ease-in-out;
        }

        @keyframes fadeInOut {
            0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
            20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        }

        /* 进度条 */
        #exam-progress {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: #fff;
            padding: 10px 24px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 400;
            z-index: 999999;
            display: none;
        }

        /* 键盘快捷键提示 */
        #keyboard-hints {
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: rgba(255,255,255,0.8);
            padding: 8px 16px;
            border-radius: 12px;
            font-size: 11px;
            z-index: 999998;
            display: none;
        }

        #keyboard-hints .key {
            background: rgba(255,255,255,0.2);
            padding: 2px 6px;
            border-radius: 4px;
            margin: 0 3px;
            font-weight: 500;
        }
    `;

    // ========== 考试类型检测 ==========
    function detectExamType() {
        if (document.querySelectorAll('div[id^="pt"]').length > 0) {
            console.log('[Exam] 检测到局网考试 (ASP.NET)');
            return '局网考试';
        }
        if (document.querySelectorAll('.ti').length > 0) {
            console.log('[Exam] 检测到职教考试 (Ant Design Vue)');
            return '职教考试';
        }
        // 未检测到考试特征，返回 null，不在无关页面加载
        return null;
    }

    // 根据考试类型获取题目容器
    function getQuestionContainers() {
        if (state.examType === '局网考试') {
            return document.querySelectorAll('div[id^="pt"]');
        } else {
            return document.querySelectorAll('.ti');
        }
    }

    // ========== 从 Chrome storage 加载配置 ==========
    function loadConfig() {
        try {
            chrome.storage.local.get(['autoMode', 'autoNextPage'], (result) => {
                if (chrome.runtime.lastError) return;
                if (result.autoMode !== undefined) CONFIG.autoMode = result.autoMode;
                // autoNextPage：强制默认 true（局网考试默认自动翻页）
                CONFIG.autoNextPage = result.autoNextPage !== undefined ? result.autoNextPage : true;

                console.log('[Config] 加载完成 autoMode=' + CONFIG.autoMode + ' autoNextPage=' + CONFIG.autoNextPage + ' apiUrl=' + CONFIG.apiUrl);

                const autoModeEl = document.getElementById('auto-mode-checkbox');
                const autoNextEl = document.getElementById('auto-nextpage-checkbox');
                if (autoModeEl) autoModeEl.checked = CONFIG.autoMode;
                if (autoNextEl) autoNextEl.checked = CONFIG.autoNextPage;
            });
        } catch (_) {
            // 扩展上下文失效时静默使用默认配置
        }
    }

    // ========== 初始化 ==========
    function init() {
        // 先注册消息监听，确保 popup 始终可通信
        try { chrome.runtime.onMessage.addListener(handlePopupMessage); } catch (_) {}

        // 无条件绑定键盘快捷键，`-` / `+` 等核心功能始终可用
        bindKeyboard();
        // 启动 API 心跳（仅首次注入需要，msg 里已有独立 startApiHealthCheck）
        startApiHealthCheck();

        // 检测考试类型，非考试页面不创建 UI、不连 WS
        state.examType = detectExamType();
        if (state.examType === null) {
            console.log('[Exam] 非考试页面，插件轻量模式已启动');
            console.log('快捷键: - 获取源码 | + 开始答题（可用，如适用）');
            return;
        }

        // 注入样式
        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);

        createControlPanel();
        createReadyPopup();
        createProgressBar();
        createKeyboardHints();
        connectWebSocket();

        // 从 storage 加载配置
        loadConfig();

        // 检测到局网考试后，注入 page-world.js 到页面主世界
        if (state.examType === '局网考试') {
            ensurePageWorldInjected().catch(e => console.warn('[Page] 初始化注入失败:', e.message));
        }

        console.log('晖哥的助手 v2.3 (Chrome 插件) 已就绪');
        console.log('快捷键: - 获取源码 | + 开始答题 | * 隐藏界面 | / 停止 | D 调试 | H 显示帮助');
    }

    // 处理来自 popup.js 的消息
    function handlePopupMessage(message, sender, sendResponse) {
        switch (message.action) {
            case 'fetchAndParse':
                fetchAndParse();
                sendResponse({ success: true });
                break;
            case 'startExam':
                startExam();
                sendResponse({ success: true });
                break;
            case 'stopExam':
                stopExam();
                sendResponse({ success: true });
                break;
            case 'togglePanel':
                togglePanel();
                sendResponse({ success: true });
                break;
            case 'debugPage':
                debugPage();
                sendResponse({ success: true });
                break;
            case 'getStatus':
                sendResponse({
                    success: true,
                    status: {
                        examType: state.examType,
                        isRunning: state.isRunning,
                        answeredCount: state.answeredCount,
                        totalQuestions: state.totalQuestions,
                        hasAnswers: !!(state.answers && state.answers.length > 0),
                        answersCount: state.answers ? state.answers.length : 0,
                        apiConnected: state.apiConnected
                    }
                });
                break;
            case 'updateConfig':
                if (message.enabled !== undefined) {
                    if (message.enabled) {
                        // 启用：先检测考试类型，非考试页面不创建 UI
                        if (!state.panel) {
                            const detected = detectExamType();
                            if (detected === null) {
                                console.log('[Exam] 非考试页面，插件不加载');
                                sendResponse({ success: true });
                                return;
                            }
                            state.examType = detected;
                            createControlPanel();
                            createReadyPopup();
                            createProgressBar();
                            createKeyboardHints();
                            bindKeyboard();
                            connectWebSocket();
                            startApiHealthCheck();
                        }
                    } else {
                        // 禁用：清理 UI，停止 API 检测
                        cleanupUI();
                        stopApiHealthCheck();
                    }
                }
                if (message.autoMode !== undefined) CONFIG.autoMode = message.autoMode;
                if (message.autoNextPage !== undefined) CONFIG.autoNextPage = message.autoNextPage;
                // 同步到面板 checkbox
                const autoModeEl = document.getElementById('auto-mode-checkbox');
                const autoNextEl = document.getElementById('auto-nextpage-checkbox');
                if (autoModeEl) autoModeEl.checked = CONFIG.autoMode;
                if (autoNextEl) autoNextEl.checked = CONFIG.autoNextPage;
                sendResponse({ success: true });
                break;
        }
        return true;
    }

    // 创建控制面板
    function createControlPanel() {
        if (state.panel) return;

        state.panel = document.createElement('div');
        state.panel.id = 'exam-control-panel';
        state.panel.innerHTML = `
            <button class="close-btn" id="panel-close-btn">×</button>
            <h3>🎓 晖哥的助手</h3>

            <div class="mode-selector">
                <label class="mode-option">
                    <input type="checkbox" id="auto-mode-checkbox" ${CONFIG.autoMode ? 'checked' : ''}>
                    <span>自动模式</span>
                </label>
                <label class="mode-option">
                    <input type="checkbox" id="auto-nextpage-checkbox" ${CONFIG.autoNextPage ? 'checked' : ''}>
                    <span>自动翻页</span>
                </label>
            </div>

            <div class="status-section">
                <div class="status-item">
                    <span>状态:</span>
                    <span id="status-value" class="status-value">待机</span>
                </div>
                <div class="status-item">
                    <span>考试:</span>
                    <span id="exam-type-value" class="status-value" style="color:#f0ad4e;">-</span>
                </div>
                <div class="status-item">
                    <span>进度:</span>
                    <span id="progress-value" class="status-value">0/0</span>
                </div>
                <div class="status-item">
                    <span>置信度:</span>
                    <span id="confidence-value" class="status-value">-</span>
                </div>
                <div class="progress-bar">
                    <div id="progress-fill" class="progress-fill" style="width: 0%"></div>
                </div>
            </div>

            <div style="font-size: 10px; opacity: 0.6; text-align: center;">
                按 <span class="key">H</span> 查看快捷键
            </div>
        `;

        document.body.appendChild(state.panel);

        // 绑定按钮事件
        document.getElementById('panel-close-btn').onclick = () => {
            state.panel.style.display = 'none';
        };
        document.getElementById('auto-mode-checkbox').onchange = (e) => {
            CONFIG.autoMode = e.target.checked;
            try { chrome.storage.local.set({ autoMode: CONFIG.autoMode }); } catch (_) {}
        };
        document.getElementById('auto-nextpage-checkbox').onchange = (e) => {
            CONFIG.autoNextPage = e.target.checked;
            try { chrome.storage.local.set({ autoNextPage: CONFIG.autoNextPage }); } catch (_) {}
        };
    }

    // 创建就绪提示
    function createReadyPopup() {
        const popup = document.createElement('div');
        popup.id = 'exam-ready-popup';
        popup.textContent = '题库就绪';
        document.body.appendChild(popup);
    }

    // 创建进度条
    function createProgressBar() {
        const bar = document.createElement('div');
        bar.id = 'exam-progress';
        document.body.appendChild(bar);
    }

    // 创建键盘提示
    function createKeyboardHints() {
        const hints = document.createElement('div');
        hints.id = 'keyboard-hints';
        hints.innerHTML = `
            <span class="key">-</span> 获取源码
            <span class="key">+</span> 开始答题
            <span class="key">*</span> 隐藏界面
            <span class="key">/</span> 停止
            <span class="key">D</span> 调试
            <span class="key">H</span> 帮助
        `;
        document.body.appendChild(hints);
    }

    // 判断当前焦点是否在可编辑元素内（输入框、文本框等）
    function isEditableTarget(target) {
        // 排除 INPUT / TEXTAREA / SELECT
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        // 排除 contenteditable 元素
        if (target.isContentEditable) return true;
        // 排除 ARIA 角色
        if (target.getAttribute('role') === 'textbox') return true;
        return false;
    }

    // 键盘事件处理函数（命名函数，便于移除）
    function handleKeyDown(e) {
        // 在可编辑元素中不拦截按键，避免干扰用户名/密码等输入
        if (isEditableTarget(e.target)) return;

        // 额外安全：如果焦点在 shadow DOM 或 iframe 内的可编辑区域也排除
        const activeEl = document.activeElement;
        if (activeEl && activeEl !== e.target && isEditableTarget(activeEl)) return;

        switch(e.key) {
            case '-':
                e.preventDefault();
                fetchAndParse();
                break;
            case '+':
            case '=':  // 主键盘 = 键（+ 需 Shift+=，部分系统下 key 为 '='）
                e.preventDefault();
                startExam();
                break;
            case '*':
                e.preventDefault();
                togglePanel();
                break;
            case '/':
                e.preventDefault();
                stopExam();
                break;
            case 'd':
            case 'D':
                e.preventDefault();
                debugPage();
                break;
            case 'h':
            case 'H':
                e.preventDefault();
                toggleKeyboardHints();
                break;
        }
    }

    // 绑定键盘事件
    function bindKeyboard() {
        document.removeEventListener('keydown', handleKeyDown);
        document.addEventListener('keydown', handleKeyDown);
    }

    // 检测 API 服务器是否可达
    async function checkApiConnection() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const response = await fetch(`${CONFIG.apiUrl}/api/health`, {
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const wasConnected = state.apiConnected;
            state.apiConnected = response.ok;

            if (state.apiConnected && !wasConnected) {
                console.log('[API] 服务器已连接');
                updateStatus('API 已连接');
            } else if (!state.apiConnected && wasConnected) {
                console.warn('[API] 服务器断开');
                updateStatus('API 未连接');
            }
        } catch (err) {
            console.warn('[API] 健康检查失败:', err.message);
            if (state.apiConnected) {
                state.apiConnected = false;
                console.warn('[API] 服务器未响应');
                updateStatus('API 未连接');
            }
            // 首次连接失败也记录日志，便于排查
            if (!state.apiConnected) {
                console.log('[API] 服务器未连接（首次或持续）');
            }
        }
    }

    // 启动 API 状态定时检测
    function startApiHealthCheck() {
        if (state.apiCheckTimer) return;
        checkApiConnection();
        state.apiCheckTimer = setInterval(checkApiConnection, 10000);
    }

    // 停止 API 状态定时检测
    function stopApiHealthCheck() {
        if (state.apiCheckTimer) {
            clearInterval(state.apiCheckTimer);
            state.apiCheckTimer = null;
        }
        state.apiConnected = false;
    }

    // 连接 WebSocket（用于自动模式通信）
    let _wsRetryCount = 0;
    const _wsMaxRetries = 10;
    const _wsBaseDelay = 3000;

    function connectWebSocket() {
        try {
            const wsHost = CONFIG.apiUrl.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
            state.ws = new WebSocket(`ws://${wsHost}:${CONFIG.wsPort}`);

            state.ws.onopen = () => {
                console.log('[Exam] WebSocket connected');
                _wsRetryCount = 0;
                updateStatus('connected');
            };

            state.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            };

            state.ws.onerror = (error) => {
                console.warn('[Exam] WebSocket error:', error);
            };

            state.ws.onclose = () => {
                console.log('[Exam] WebSocket closed');
                // 指数退避重连：3s → 6s → 12s ... 上限 60s，最多重试 10 次
                if (_wsRetryCount < _wsMaxRetries) {
                    const delay = Math.min(_wsBaseDelay * Math.pow(2, _wsRetryCount), 60000);
                    _wsRetryCount++;
                    console.log(`[Exam] 重连第 ${_wsRetryCount} 次，等待 ${delay / 1000}s`);
                    setTimeout(connectWebSocket, delay);
                } else {
                    console.warn('[Exam] WebSocket 超过最大重连次数，停止重连');
                }
            };
        } catch (error) {
            console.warn('[Exam] WebSocket connection failed:', error.message);
        }
    }

    // 处理 WebSocket 消息
    function handleWebSocketMessage(message) {
        const { type, commandId, command, params } = message;

        if (type !== 'command') return;

        let result = null;
        let error = null;

        try {
            switch(command) {
                case 'navigate':
                    window.location.href = params.url;
                    result = true;
                    break;

                case 'getPageSource':
                    result = document.documentElement.outerHTML;
                    break;

                case 'click':
                    const clickEl = document.querySelector(params.selector);
                    if (clickEl) {
                        clickEl.click();
                        result = true;
                    } else {
                        error = 'Element not found';
                    }
                    break;

                case 'fillInput':
                    const inputEl = document.querySelector(params.selector);
                    if (inputEl) {
                        inputEl.value = params.value;
                        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                        result = true;
                    } else {
                        error = 'Input element not found';
                    }
                    break;

                case 'waitForElement':
                    result = waitForElement(params.selector, params.timeout);
                    break;

                case 'injectScript':
                    // [安全] new Function() 已移除，不再支持任意脚本注入
                    error = 'injectScript disabled for security';
                    break;

                case 'evaluateScript':
                    // [安全] new Function() 已移除，使用结构化命令代替
                    error = 'evaluateScript disabled for security';
                    break;

                case 'detectNextButton':
                    result = findNextButton(params.selectors);
                    break;

                default:
                    error = 'Unknown command: ' + command;
            }
        } catch (e) {
            error = e.message;
        }

        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({
                type: 'response',
                commandId,
                data: result,
                error
            }));
        }
    }

    // 等待元素出现
    function waitForElement(selector, timeout = 5000) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const checkInterval = setInterval(() => {
                if (document.querySelector(selector)) {
                    clearInterval(checkInterval);
                    resolve(true);
                }
                if (Date.now() - startTime > timeout) {
                    clearInterval(checkInterval);
                    resolve(false);
                }
            }, 100);
        });
    }

    // 获取源码并解析
    async function fetchAndParse(silent = false) {
        updateStatus('获取中...');

        try {
            // [安全] 仅在检测到有效类型时更新，防止翻页时被覆盖为 null
            const detected = detectExamType();
            if (detected !== null) state.examType = detected;
            const htmlContent = document.documentElement.outerHTML;

            const response = await fetch(CONFIG.apiUrl + '/api/parse-and-get-answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ htmlContent })
            });

            const resultText = await response.text();
            state.answers = parseAnswers(resultText);

            if (!silent) {
                showReadyPopup();
                updateStatus('就绪');
            }
            updateProgress(0, state.answers.length);

            const examTypeEl = document.getElementById('exam-type-value');
            if (examTypeEl) {
                examTypeEl.textContent = state.examType || '-';
            }

            console.log(`解析完成，共 ${state.answers.length} 道题，类型: ${state.examType}`);

        } catch (err) {
            updateStatus('失败');
            console.error('获取源码失败:', err);
            safeSendMessage({
                type: 'showNotification',
                text: '获取失败: ' + err.message,
                title: '晖哥的助手'
            }).catch(() => {});
        }
    }

    // 解析答案文本
    function parseAnswers(text) {
        const answers = [];
        const lines = text.split('\n');

        for (const line of lines) {
            const statsMatch = line.match(/题型统计: 单选(\d+)题, 多选(\d+)题, 判断(\d+)题, 简答(\d+)题/);
            if (statsMatch) {
                state.typeStats = {
                    danxuan: parseInt(statsMatch[1]),
                    duoxuan: parseInt(statsMatch[2]),
                    panduan: parseInt(statsMatch[3]),
                    jianda: parseInt(statsMatch[4])
                };
                continue;
            }

            const match = line.match(/(单选|多选|判断|简答)-第(\d+)题答案[：:](.+)/);
            if (match) {
                answers.push({
                    type: match[1],
                    num: parseInt(match[2]),
                    answer: match[3].trim()
                });
            }
        }
        return answers;
    }

    // 显示就绪提示
    function showReadyPopup() {
        let popup = document.getElementById('exam-ready-popup');
        if (!popup) {
            // 浮窗不存在时即时创建，不依赖 init 中的 UI 创建流程
            popup = document.createElement('div');
            popup.id = 'exam-ready-popup';
            popup.textContent = '题库就绪';
            // 内联样式，白色毛玻璃透明风格
            Object.assign(popup.style, {
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                background: 'rgba(255, 255, 255, 0.65)',
                backdropFilter: 'blur(16px) saturate(180%)',
                WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                color: '#1e293b',
                padding: '12px 24px',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: '600',
                letterSpacing: '1.5px',
                zIndex: '999999',
                border: '1px solid rgba(255,255,255,0.4)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                display: 'none'
            });
            document.body.appendChild(popup);
        }
        popup.style.display = 'block';
        setTimeout(() => {
            if (popup) popup.style.display = 'none';
        }, 1000);
    }

    // 开始考试
    async function startExam() {
        if (!state.answers || state.answers.length === 0) {
            safeSendMessage({
                type: 'showNotification',
                text: '请先按 - 获取源码',
                title: '晖哥的助手'
            }).catch(() => {});
            return;
        }

        if (state.isRunning) return;

        state.isRunning = true;
        state.isPaused = false;
        state.totalQuestions = state.answers.length;
        state.answeredCount = 0;
        state.skippedCount = 0;

        updateStatus('运行中');
        showProgressBar();

        if (state.panel) state.panel.style.display = 'none';

        await executeAnswering();
    }

    // 执行答题流程（支持多页循环）
    async function executeAnswering() {
        let success = 0;
        let failed = 0;
        let skipped = 0;

        while (true) {
            for (let i = 0; i < state.answers.length; i++) {
                if (state.isPaused) {
                    await waitForResume();
                }
                if (!state.isRunning) break;

                const ans = state.answers[i];
                updateProgress(i + 1, state.answers.length);

                try {
                    const result = await answerQuestion(ans);

                    if (result === 'skipped') {
                        skipped++;
                        state.skippedCount++;
                    } else if (result) {
                        success++;
                        state.answeredCount++;
                    } else {
                        failed++;
                    }

                    const delay = calculateDelay(ans.answer.length);
                    await sleep(delay);

                } catch (e) {
                    failed++;
                    console.error(`第${ans.num}题答题失败:`, e);
                }
            }

            if (!state.isRunning) break;

            // 局网考试：强制开启自动翻页（忽略用户配置，确保考试能连续完成）
            if (state.examType === '局网考试') {
                CONFIG.autoNextPage = true;
            }

            if (CONFIG.autoNextPage && state.examType === '局网考试' && hasNextPage()) {
                updateStatus('翻页中...');
                await sleep(500);
                if (!(await goToNextPage())) {
                    console.warn('[Page] 翻页失败');
                    break;
                }
                await waitForPageReady();
                await fetchAndParse(true);
                if (!state.answers || state.answers.length === 0) {
                    console.log('[Page] 下一页无题目，结束');
                    break;
                }
                continue;
            }
            break;
        }

        hideProgressBar();
        updateStatus(`完成(${success})`);
        state.isRunning = false;

        safeSendMessage({
            type: 'showNotification',
            text: `答题完成！成功: ${success}, 跳过: ${skipped}, 失败: ${failed}`,
            title: '晖哥的助手'
        }).catch(() => {});

        if (state.panel) state.panel.style.display = 'block';
    }

    // 在指定容器内查找匹配答案的选项并点击
    function clickOptionInContainer(ti, ans, targetLetter) {
        if (ans.type === '多选') {
            const answerLetters = ans.answer.replace(/[,，]/g, '').toUpperCase().split('');
            const selector = 'label.ant-checkbox-wrapper';
            let labels = ti.querySelectorAll(selector);
            let clicked = 0;
            for (const letter of answerLetters) {
                for (const label of labels) {
                    const input = label.querySelector('input[type="checkbox"]');
                    if (input && input.value.toUpperCase() === letter) {
                        label.click();
                        clicked++;
                        break;
                    }
                }
            }
            return clicked > 0 ? clicked : 0;
        } else {
            const selector = 'label.ant-radio-wrapper';
            const labels = ti.querySelectorAll(selector);
            for (const label of labels) {
                const input = label.querySelector('input[type="radio"]');
                if (input && input.value.toUpperCase() === targetLetter) {
                    label.click();
                    return 1;
                }
            }
            // 回退：直接查找 input（仅在容器内）
            const inputSelector = `input[type="radio"]`;
            const inputs = ti.querySelectorAll(inputSelector);
            for (const input of inputs) {
                if (input.value.toUpperCase() === targetLetter) {
                    input.click();
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    return 1;
                }
            }
            return 0;
        }
    }

    // 回答单道题
    async function answerQuestion(ans) {
        console.log(`开始回答第${ans.num}题, 类型:${ans.type}, 答案:${ans.answer}, 考试类型:${state.examType}`);

        const containers = getQuestionContainers();
        const globalIndex = ans.num - 1;

        if (globalIndex >= containers.length) {
            console.error(`题目索引越界 ${globalIndex}/${containers.length}`);
            return false;
        }

        const ti = containers[globalIndex];

        // 简答题（两种考试类型通用）
        if (ans.type === '简答') {
            const input = ti.querySelector('textarea, input[type="text"]');
            if (input) {
                input.value = ans.answer;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                console.log(`填写第${ans.num}题简答`);
                await sleep(80);
                return true;
            }
            return false;
        }

        // 判断题答案转换：A=对, B=错
        const targetLetter = ans.type === '判断'
            ? (ans.answer === '对' || ans.answer === '正确' ? 'A' : 'B')
            : ans.answer.trim().toUpperCase();

        if (state.examType === '局网考试') {
            // ==================== 局网考试 (ASP.NET) ====================
            const inputType = ans.type === '多选' ? 'checkbox' : 'radio';
            const inputs = ti.querySelectorAll(`table input[type="${inputType}"]`);

            const searchLetter = (ans.type === '判断')
                ? (targetLetter === 'A' ? 'T' : 'F')
                : targetLetter;

            if (ans.type === '多选') {
                const answerLetters = ans.answer.replace(/[,，]/g, '').toUpperCase().split('');
                let clicked = 0;
                for (const letter of answerLetters) {
                    for (const input of inputs) {
                        if (input.value.toUpperCase() === letter) {
                            input.click();
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            clicked++;
                            await sleep(50);
                        }
                    }
                }
                console.log(`局网考试-多选第${ans.num}题: 成功 ${clicked}/${answerLetters.length}`);
                return clicked > 0;
            } else {
                for (const input of inputs) {
                    if (input.value.toUpperCase() === searchLetter) {
                        input.click();
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        console.log(`局网考试-第${ans.num}题已点击: ${targetLetter}`);
                        return true;
                    }
                }
                console.warn(`局网考试-第${ans.num}题未找到选项: ${searchLetter}`);
                return false;
            }

        } else {
            // ==================== 职教考试 (Ant Design Vue) ====================
            // 仅在当前题目容器内查找，绝不回退到全局查询（防止跨题目污染）
            const clicked = clickOptionInContainer(ti, ans, targetLetter);

            if (clicked > 0) {
                const countLabel = ans.type === '多选' ? `成功 ${clicked}/${ans.answer.replace(/[,，]/g, '').length}` : targetLetter;
                console.log(`职教考试-${ans.type}第${ans.num}题: ${countLabel}`);
                await sleep(100);
                return true;
            }

            console.warn(`职教考试-第${ans.num}题未找到选项: ${targetLetter} (容器内无匹配)`);
            return false;
        }
    }

    // 计算随机延迟
    function calculateDelay(questionLength) {
        const baseDelay = 200;
        const randomFactor = Math.random() * 0.2 + 0.9;
        return baseDelay * randomFactor;
    }

    // 查找下一题按钮
    function findNextButton(selectors = []) {
        const buttons = document.querySelectorAll('button, a[role="button"], .ant-btn');
        for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (text.includes('下一题') || text.includes('Next')) {
                if (!btn.disabled && btn.offsetParent !== null) {
                    return btn.className || btn.tagName;
                }
            }
        }
        return null;
    }

    // ========== 局网考试翻页功能 ==========

    function getCurrentPageIndex() {
        const pageLinks = document.querySelectorAll('#UpdatePanel1 a[id]');
        for (let i = 0; i < pageLinks.length; i++) {
            const style = pageLinks[i].getAttribute('style') || '';
            if (style.includes('text-decoration:none')) {
                return i;
            }
        }
        return -1;
    }

    function hasNextPage() {
        const pageLinks = document.querySelectorAll('#UpdatePanel1 a[id]');
        const current = getCurrentPageIndex();
        return current >= 0 && current < pageLinks.length - 1;
    }

    // 检测扩展上下文是否仍然有效（重载插件后旧 content script 会失效）
    function isExtensionAlive() {
        try {
            return !!(chrome && chrome.runtime && chrome.runtime.id);
        } catch (e) {
            return false;
        }
    }

    // 安全的 runtime.sendMessage 封装，扩展失效时静默跳过
    function safeSendMessage(msg) {
        return new Promise((resolve, reject) => {
            if (!isExtensionAlive()) {
                reject(new Error('Extension context invalidated'));
                return;
            }
            chrome.runtime.sendMessage(msg, (resp) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(resp);
                }
            });
        });
    }

    // 注入 page-world.js 到页面主世界（仅需一次）
    let pageWorldInjected = false;
    async function ensurePageWorldInjected() {
        if (pageWorldInjected) return;
        try {
            const resp = await safeSendMessage({ type: 'injectPageWorld' });
            if (resp && resp.success) {
                pageWorldInjected = true;
            } else {
                console.warn('[Page] page-world.js 注入失败:', resp);
            }
        } catch (e) {
            console.warn('[Page] page-world.js 注入异常:', e.message);
        }
    }

    // 通过 postMessage 通知 page-world.js 在页面主世界执行 __doPostBack
    // page-world.js 运行在非 strict mode，可以正常调用 ASP.NET 的 _doPostBack
    function execPostBack(eventTarget, eventArgument) {
        return new Promise((resolve) => {
            const callId = 'huige-postback-' + Date.now();
            const timeout = setTimeout(() => {
                window.removeEventListener('message', handler);
                resolve(false); // 超时视为失败
            }, 3000);

            const handler = (event) => {
                // [安全] 仅接受同源消息
                if (event.origin !== window.location.origin) return;
                if (event.data && event.data.type === 'huige-postback-done' && event.data.id === callId) {
                    clearTimeout(timeout);
                    window.removeEventListener('message', handler);
                    resolve(true);
                }
            };
            window.addEventListener('message', handler);

            window.postMessage({
                source: 'huige-content',
                type: 'huige-doPostBack',
                id: callId,
                eventTarget,
                eventArgument
            }, window.location.origin);
        });
    }

    async function goToNextPage() {
        const pageLinks = document.querySelectorAll('#UpdatePanel1 a[id]');
        const current = getCurrentPageIndex();
        if (current < 0 || current >= pageLinks.length - 1) return false;
        const nextLinkId = pageLinks[current + 1].id;
        
        // 确保 page-world.js 已注入
        await ensurePageWorldInjected();
        
        const ok = await execPostBack(nextLinkId, '');
        if (!ok) {
            console.warn('[Page] execPostBack 超时');
            return false;
        }
        console.log('[Page] 翻页到第 ' + (current + 2) + ' 页 (link id=' + nextLinkId + ')');
        return true;
    }

    function waitForPageReady() {
        return new Promise(resolve => {
            const listenerId = 'huige-ready-' + Date.now();
            const timeout = setTimeout(() => {
                window.removeEventListener('message', handler);
                console.log('[Page] waitForPageReady 超时兜底');
                resolve();
            }, 6000);

            const handler = (event) => {
                // [安全] 仅接受同源消息
                if (event.origin !== window.location.origin) return;
                if (event.data && event.data.source === 'huige-page' && event.data.type === 'huige-page-ready' && event.data.id === listenerId) {
                    clearTimeout(timeout);
                    window.removeEventListener('message', handler);
                    setTimeout(resolve, 600);
                }
            };
            window.addEventListener('message', handler);

            // 通过 postMessage 通知 page-world.js 监听 endRequest
            window.postMessage({
                source: 'huige-content',
                type: 'huige-waitPageReady',
                listenerId,
                abortTimeout: 5000
            }, window.location.origin);
        });
    }

    function waitForResume() {
        return new Promise(resolve => {
            const checkInterval = setInterval(() => {
                if (!state.isPaused || !state.isRunning) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 500);
        });
    }

    // 停止考试
    function stopExam() {
        state.isRunning = false;
        state.isPaused = false;
        updateStatus('已停止');
        hideProgressBar();
        if (state.panel) state.panel.style.display = 'block';
        console.log('考试已停止');
    }

    // 切换面板显示
    function togglePanel() {
        if (state.panel) {
            state.panel.style.display = state.panel.style.display === 'none' ? 'block' : 'none';
        }
    }

    // 切换键盘提示
    function toggleKeyboardHints() {
        const hints = document.getElementById('keyboard-hints');
        if (!hints) return;
        hints.style.display = hints.style.display === 'none' ? 'block' : 'none';
    }

    // 清理 UI（禁用插件时调用）
    function cleanupUI() {
        if (state.panel) {
            state.panel.remove();
            state.panel = null;
        }
        const popup = document.getElementById('exam-ready-popup');
        if (popup) popup.remove();
        const progress = document.getElementById('exam-progress');
        if (progress) progress.remove();
        const hints = document.getElementById('keyboard-hints');
        if (hints) hints.remove();
        // 移除键盘事件监听器
        document.removeEventListener('keydown', handleKeyDown);
        // 关闭 WebSocket
        if (state.ws) {
            state.ws.close();
            state.ws = null;
        }
        // 停止 API 检测
        stopApiHealthCheck();
    }

    // 调试页面
    function debugPage() {
        console.log('========== 页面调试 ==========');
        console.log('考试类型:', state.examType || '未检测');
        console.log('按钮:', document.querySelectorAll('button').length);
        console.log('Radio:', document.querySelectorAll('input[type="radio"]').length);
        console.log('Checkbox:', document.querySelectorAll('input[type="checkbox"]').length);
        console.log('Textarea:', document.querySelectorAll('textarea').length);
        console.log('.ti 容器:', document.querySelectorAll('.ti').length);
        console.log('div[id^="pt"] 容器:', document.querySelectorAll('div[id^="pt"]').length);
        console.log('label.ant-radio-wrapper:', document.querySelectorAll('label.ant-radio-wrapper').length);
        console.log('==============================');
    }

    // ========== UI 更新工具函数 ==========

    function updateStatus(status) {
        const el = document.getElementById('status-value');
        if (el) el.textContent = status;
    }

    function updateProgress(current, total) {
        const progressEl = document.getElementById('progress-value');
        const fillEl = document.getElementById('progress-fill');
        if (progressEl) progressEl.textContent = `${current}/${total}`;
        if (fillEl && total > 0) {
            fillEl.style.width = (current / total * 100) + '%';
        }
    }

    function showProgressBar() {
        const bar = document.getElementById('exam-progress');
        if (bar) bar.style.display = 'block';
    }

    function hideProgressBar() {
        const bar = document.getElementById('exam-progress');
        if (bar) bar.style.display = 'none';
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ========== 启动 ==========
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }
})();
