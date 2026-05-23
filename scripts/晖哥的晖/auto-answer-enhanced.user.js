// ==UserScript==
// @name         晖哥的助手(支持局网和职教考试)
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  支持自动/手动双模式的考试辅助脚本 - 方案A轻量级扩展
// @author       Sisyphus
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      localhost
// ==/UserScript==

(function() {
    'use strict';

    // ========== 配置 ==========
    const CONFIG = {
        apiUrl: 'http://localhost:3500',
        wsPort: 3501,  // WebSocket端口
        checkInterval: 500,
        autoMode: false,  // 默认手动模式
        autoNextPage: false  // 局网考试自动翻页
    };

    // ========== 状态管理 ==========
    let state = {
        panel: null,
        ws: null,
        sessionId: null,
        isRunning: false,
        isPaused: false,
        answers: null,
        examType: null,  // '局网考试' | '职教考试' | null
        typeStats: { danxuan: 0, duoxuan: 0, panduan: 0, jianda: 0 },
        currentQuestionIndex: 0,
        totalQuestions: 0,
        answeredCount: 0,
        skippedCount: 0,
        avgConfidence: 0
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
            animation: fadeInOut 2s ease-in-out;
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
        return '职教考试';
    }

    // 根据考试类型获取题目容器
    function getQuestionContainers() {
        if (state.examType === '局网考试') {
            return document.querySelectorAll('div[id^="pt"]');
        } else {
            return document.querySelectorAll('.ti');
        }
    }

    // ========== 初始化 ==========
    function init() {
        GM_addStyle(STYLES);
        createControlPanel();
        createReadyPopup();
        createProgressBar();
        createKeyboardHints();
        bindKeyboard();
        connectWebSocket();
        
        // 自动检测考试类型
        state.examType = detectExamType();

        console.log('智能考试助手 v2.2 已就绪');
        console.log('快捷键: - 获取源码 | + 开始答题 | * 隐藏界面 | / 停止 | D 调试 | H 显示帮助');
        console.log('翻页: 面板勾选"自动翻页"后，局网考试答题结束自动翻到下一页');
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
        };
        document.getElementById('auto-nextpage-checkbox').onchange = (e) => {
            CONFIG.autoNextPage = e.target.checked;
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

    // 绑定键盘事件
    function bindKeyboard() {
        document.addEventListener('keydown', (e) => {
            // 忽略输入框中的按键
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch(e.key) {
                case '-':
                    e.preventDefault();
                    fetchAndParse();
                    break;
                case '+':
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
        });
    }

    // 连接WebSocket(用于自动模式通信)
    function connectWebSocket() {
        try {
            state.ws = new WebSocket(`ws://localhost:${CONFIG.wsPort}`);

            state.ws.onopen = () => {
                console.log('[Exam] WebSocket connected');
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
                // 尝试重连
                setTimeout(connectWebSocket, 3000);
            };
        } catch (error) {
            console.warn('[Exam] WebSocket connection failed:', error.message);
        }
    }

    // 处理WebSocket消息
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

                case 'screenshot':
                    // 油猴脚本无法直接截图，返回null
                    result = null;
                    break;

                case 'injectScript':
                    eval(params.script);
                    result = true;
                    break;

                case 'evaluateScript':
                    result = eval(params.script);
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

        // 发送响应
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
            // 重新检测考试类型（页面可能已切换）
            state.examType = detectExamType();
            
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
            
            // 更新控制面板考试类型显示
            const examTypeEl = document.getElementById('exam-type-value');
            if (examTypeEl) {
                examTypeEl.textContent = state.examType || '-';
            }

            console.log(`解析完成，共 ${state.answers.length} 道题，类型: ${state.examType}`);

        } catch (err) {
            updateStatus('失败');
            console.error('获取源码失败:', err);
            GM_notification({
                text: '获取失败: ' + err.message,
                title: '智能考试助手',
                timeout: 3000,
                type: 'error'
            });
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
        const popup = document.getElementById('exam-ready-popup');
        popup.style.display = 'block';
        setTimeout(() => {
            popup.style.display = 'none';
        }, 2000);
    }

    // 开始考试
    async function startExam() {
        if (!state.answers || state.answers.length === 0) {
            GM_notification({
                text: '请先按 - 获取源码',
                title: '智能考试助手',
                timeout: 2000
            });
            return;
        }

        if (state.isRunning) return;

        state.isRunning = true;
        state.isPaused = false;
        state.totalQuestions = state.answers.length;
        state.answeredCount = 0;
        state.skippedCount = 0;

        updateButtonsState(true);
        updateStatus('运行中');
        showProgressBar();

        // 隐藏控制面板
        if (state.panel) state.panel.style.display = 'none';

        // 执行答题
        await executeAnswering();
    }

    // 执行答题流程（支持多页循环）
    async function executeAnswering() {
        let success = 0;
        let failed = 0;
        let skipped = 0;

        while (true) {
            // 答当前页的所有题
            for (let i = 0; i < state.answers.length; i++) {
                // 检查是否暂停
                if (state.isPaused) {
                    await waitForResume();
                }

                // 检查是否停止
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

                    // 随机延迟(模拟人类)
                    const delay = calculateDelay(ans.answer.length);
                    await sleep(delay);

                } catch (e) {
                    failed++;
                    console.error(`第${ans.num}题答题失败:`, e);
                }
            }

            if (!state.isRunning) break;

            // 当前页答完，自动翻页到下一页
            if (CONFIG.autoNextPage && state.examType === '局网考试' && hasNextPage()) {
                updateStatus('翻页中...');
                await sleep(500);
                if (!goToNextPage()) {
                    console.warn('[Page] 翻页失败');
                    break;
                }
                await waitForPageReady();
                // 重新获取当前页源码并解析
                await fetchAndParse(true);
                if (!state.answers || state.answers.length === 0) {
                    console.log('[Page] 下一页无题目，结束');
                    break;
                }
                // 继续处理下一页
                continue;
            }
            break;
        }

        // 完成
        hideProgressBar();
        updateStatus(`完成(${success})`);
        updateButtonsState(false);
        state.isRunning = false;

        GM_notification({
            text: `答题完成！成功: ${success}, 跳过: ${skipped}, 失败: ${failed}`,
            title: '智能考试助手',
            timeout: 5000
        });

        // 显示控制面板
        if (state.panel) state.panel.style.display = 'block';
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
            // 局网考试可能使用不同的输入框
            const juWangInput = ti.querySelector('input[type="text"]');
            if (juWangInput) {
                juWangInput.value = ans.answer;
                juWangInput.dispatchEvent(new Event('input', { bubbles: true }));
                juWangInput.dispatchEvent(new Event('change', { bubbles: true }));
                console.log(`填写第${ans.num}题简答 (局网)`);
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
            // 单选/判断：table input[type="radio"]
            // 多选：table input[type="checkbox"]
            const inputType = ans.type === '多选' ? 'checkbox' : 'radio';
            const inputs = ti.querySelectorAll(`table input[type="${inputType}"]`);
            
            // 局网判断题：radio value 用 T/F（True/False）而非 A/B
            const searchLetter = (ans.type === '判断')
                ? (targetLetter === 'A' ? 'T' : 'F')
                : targetLetter;
            
            let clicked = 0;
            for (const input of inputs) {
                if (input.value.toUpperCase() === searchLetter) {
                    input.click();
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    clicked++;
                    if (inputType === 'radio') {
                        console.log(`局网考试-第${ans.num}题已点击: ${targetLetter}`);
                        return true;
                    }
                }
            }
            
            // 多选题：可能答案是多个字母如 "A,C,D" 或 "ACD"
            if (ans.type === '多选') {
                const answerLetters = ans.answer.replace(/[,，]/g, '').toUpperCase().split('');
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
            }

            console.warn(`局网考试-第${ans.num}题未找到选项: ${searchLetter}`);
            return false;

        } else {
            // ==================== 职教考试 (Ant Design Vue) ====================
            // 单选/判断：label.ant-radio-wrapper
            // 多选：label.ant-checkbox-wrapper
            const selector = ans.type === '多选' 
                ? 'label.ant-checkbox-wrapper' 
                : 'label.ant-radio-wrapper';

            let labels = ti.querySelectorAll(selector);
            // 兼容：有些页面 ant-radio-wrapper 在 .ti 外作为同级元素
            if (labels.length === 0) {
                labels = document.querySelectorAll(selector);
            }
            
            // 多选题答案处理
            const answerLetters = ans.type === '多选' 
                ? ans.answer.replace(/[,，]/g, '').toUpperCase().split('')
                : [targetLetter];

            let clicked = 0;
            for (const letter of answerLetters) {
                for (const label of labels) {
                    const input = label.querySelector(`input[type="${ans.type === '多选' ? 'checkbox' : 'radio'}"]`);
                    if (input && input.value.toUpperCase() === letter) {
                        label.click();
                        await sleep(50);
                        clicked++;
                        break;
                    }
                }
            }

            if (clicked > 0) {
                console.log(`职教考试-${ans.type}第${ans.num}题: 成功 ${clicked}/${answerLetters.length}`);
                await sleep(100);
                return true;
            }

            // 回退：尝试直接查找 input
            let inputs = ti.querySelectorAll(`input[type="${ans.type === '多选' ? 'checkbox' : 'radio'}"]`);
            if (inputs.length === 0) {
                inputs = document.querySelectorAll(`input[type="${ans.type === '多选' ? 'checkbox' : 'radio'}"]`);
            }
            for (const input of inputs) {
                if (input.value.toUpperCase() === targetLetter) {
                    input.click();
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    console.log(`职教考试-第${ans.num}题已点击(回退): ${targetLetter}`);
                    return true;
                }
            }

            console.warn(`职教考试-第${ans.num}题未找到选项: ${targetLetter}`);
            return false;
        }
    }

    // 计算随机延迟
    function calculateDelay(questionLength) {
        const baseDelay = 200;
        const perCharDelay = 0;
        const randomFactor = Math.random() * 0.2 + 0.9;
        return (baseDelay + questionLength * perCharDelay) * randomFactor;
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

    // 获取当前页在导航栏中的索引
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

    // 判断是否有下一页
    function hasNextPage() {
        const pageLinks = document.querySelectorAll('#UpdatePanel1 a[id]');
        const current = getCurrentPageIndex();
        return current >= 0 && current < pageLinks.length - 1;
    }

    // 翻到下一页（点击页面导航链接）
    function goToNextPage() {
        // 直接调用 ASP.NET 的 __doPostBack
        if (typeof __doPostBack !== 'function') {
            console.warn('[Page] __doPostBack 不可用');
            return false;
        }
        const pageLinks = document.querySelectorAll('#UpdatePanel1 a[id]');
        const current = getCurrentPageIndex();
        if (current < 0 || current >= pageLinks.length - 1) return false;
        const nextLink = pageLinks[current + 1];
        __doPostBack(nextLink.id, '');
        console.log(`[Page] 翻页到第 ${current + 2} 页 (link id=${nextLink.id})`);
        return true;
    }

    // 等待 ASP.NET UpdatePanel 刷新完毕
    function waitForPageReady() {
        return new Promise(resolve => {
            if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
                const prm = Sys.WebForms.PageRequestManager.getInstance();
                const handler = function() {
                    prm.remove_endRequest(handler);
                    // 等 DOM 稳定后再继续
                    setTimeout(resolve, 600);
                };
                prm.add_endRequest(handler);
            } else {
                // 没有 ASP.NET AJAX 框架时，等固定时间
                setTimeout(resolve, 2000);
            }
        });
    }

    // 暂停考试
    function pauseExam() {
        state.isPaused = !state.isPaused;

        const pauseBtn = document.getElementById('pause-btn');
        if (state.isPaused) {
            pauseBtn.textContent = '继续';
            updateStatus('已暂停');
        } else {
            pauseBtn.textContent = '暂停';
            updateStatus('运行中');
        }
    }

    // 等待恢复
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
        updateButtonsState(false);
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
        hints.style.display = hints.style.display === 'none' ? 'block' : 'none';
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

    // ========== UI更新工具函数 ==========

    function updateStatus(status) {
        const el = document.getElementById('status-value');
        if (el) el.textContent = status;
    }

    function updateProgress(current, total) {
        const progressEl = document.getElementById('progress-value');
        const fillEl = document.getElementById('progress-fill');

        if (progressEl) {
            progressEl.textContent = `${current}/${total}`;
        }

        if (fillEl && total > 0) {
            const percentage = (current / total * 100);
            fillEl.style.width = percentage + '%';
        }
    }

    function updateButtonsState(running) {
        const startBtn = document.getElementById('start-btn');
        const pauseBtn = document.getElementById('pause-btn');
        const stopBtn = document.getElementById('stop-btn');

        if (startBtn) startBtn.disabled = running;
        if (pauseBtn) pauseBtn.disabled = !running;
        if (stopBtn) stopBtn.disabled = !running;
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
