// ==UserScript== 替代为 Chrome Extension Content Script
// 智能考试助手 - 自动答题核心逻辑

(function() {
    'use strict';

    // ========== 配置 ==========
    const CONFIG = {
        apiUrl: 'http://localhost:3000',
        checkInterval: 500
    };

    // ========== 状态管理 ==========
    let state = {
        panel: null,
        isRunning: false,
        isPaused: false,
        answers: null,
        examType: null,
        typeStats: { danxuan: 0, duoxuan: 0, panduan: 0, jianda: 0 },
        totalQuestions: 0,
        answeredCount: 0,
        skippedCount: 0
    };

    // ========== 样式定义 ==========
    const STYLES = `
        #exam-assistant-panel {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 280px;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 12px;
            padding: 16px;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #fff;
            font-size: 13px;
            border: 1px solid rgba(255,255,255,0.2);
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            transition: all 0.3s ease;
        }
        #exam-assistant-panel:hover {
            box-shadow: 0 12px 40px rgba(0,0,0,0.4);
        }
        #exam-assistant-panel h3 {
            margin: 0 0 12px 0;
            font-size: 15px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        #exam-assistant-panel .close-btn {
            position: absolute;
            top: 12px;
            right: 12px;
            background: none;
            border: none;
            color: rgba(255,255,255,0.6);
            font-size: 18px;
            cursor: pointer;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
        }
        #exam-assistant-panel .close-btn:hover {
            background: rgba(255,255,255,0.1);
            color: white;
        }
        #exam-assistant-panel .button-group {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            margin-bottom: 12px;
        }
        #exam-assistant-panel button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border: none;
            color: white;
            padding: 10px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s;
        }
        #exam-assistant-panel button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        #exam-assistant-panel button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        #exam-assistant-panel button.pause-btn {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        }
        #exam-assistant-panel button.stop-btn {
            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);
        }
        #exam-assistant-panel .status-section {
            background: rgba(255,255,255,0.05);
            border-radius: 8px;
            padding: 10px;
            margin-bottom: 10px;
        }
        #exam-assistant-panel .status-item {
            display: flex;
            justify-content: space-between;
            margin: 6px 0;
            font-size: 12px;
        }
        #exam-assistant-panel .status-value {
            font-weight: 600;
            color: #667eea;
        }
        #exam-assistant-panel .exam-type-value {
            color: #f0ad4e;
        }
        #exam-assistant-panel .progress-bar {
            width: 100%;
            height: 6px;
            background: rgba(255,255,255,0.1);
            border-radius: 3px;
            overflow: hidden;
            margin-top: 8px;
        }
        #exam-assistant-panel .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            transition: width 0.3s ease;
            border-radius: 3px;
        }
        #exam-assistant-panel .keyboard-hints {
            font-size: 10px;
            opacity: 0.6;
            text-align: center;
        }
        #exam-assistant-panel .keyboard-hints .key {
            background: rgba(255,255,255,0.2);
            padding: 2px 6px;
            border-radius: 4px;
            margin: 0 3px;
        }
        #exam-ready-popup {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(8px);
            color: #fff;
            padding: 20px 40px;
            border-radius: 30px;
            font-size: 20px;
            font-weight: 400;
            z-index: 999999;
            display: none;
        }
    `;

    // ========== 初始化 ==========
    function init() {
        injectStyles();
        createPanel();
        createReadyPopup();
        bindKeyboard();
        state.examType = detectExamType();
        console.log('[Exam Assistant] 已就绪，考试类型:', state.examType);
    }

    // 注入样式
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);
    }

    // ========== 考试类型检测 ==========
    function detectExamType() {
        const hasPt = document.querySelectorAll('div[id^="pt"]').length > 0;
        const hasTi = document.querySelectorAll('.ti').length > 0;
        
        if (hasPt) {
            console.log('[Exam] 检测到局网考试 (ASP.NET)');
            return '局网考试';
        } else if (hasTi) {
            console.log('[Exam] 检测到职教考试 (Ant Design Vue)');
            return '职教考试';
        }
        return '未知';
    }

    // 根据考试类型获取题目容器
    function getQuestionContainers() {
        if (state.examType === '局网考试') {
            return document.querySelectorAll('div[id^="pt"]');
        } else {
            return document.querySelectorAll('.ti');
        }
    }

    // ========== UI 创建 ==========
    function createPanel() {
        if (state.panel) return;
        state.panel = document.createElement('div');
        state.panel.id = 'exam-assistant-panel';
        state.panel.innerHTML = `
            <button class="close-btn" id="panel-close-btn">×</button>
            <h3>🎓 智能考试助手</h3>
            <div class="button-group">
                <button id="start-btn">开始</button>
                <button id="pause-btn" class="pause-btn" disabled>暂停</button>
                <button id="stop-btn" class="stop-btn" disabled>停止</button>
            </div>
            <div class="status-section">
                <div class="status-item">
                    <span>状态:</span>
                    <span id="status-value" class="status-value">待机</span>
                </div>
                <div class="status-item">
                    <span>考试:</span>
                    <span id="exam-type-value" class="status-value exam-type-value">-</span>
                </div>
                <div class="status-item">
                    <span>进度:</span>
                    <span id="progress-value" class="status-value">0/0</span>
                </div>
                <div class="progress-bar">
                    <div id="progress-fill" class="progress-fill" style="width: 0%"></div>
                </div>
            </div>
            <div class="keyboard-hints">
                按 <span class="key">-</span> 获取源码
                <span class="key">+</span> 开始答题
                <span class="key">*</span> 隐藏面板
            </div>
        `;
        document.body.appendChild(state.panel);

        // 绑定按钮事件
        document.getElementById('start-btn').onclick = startExam;
        document.getElementById('pause-btn').onclick = pauseExam;
        document.getElementById('stop-btn').onclick = stopExam;
        document.getElementById('panel-close-btn').onclick = () => {
            state.panel.style.display = 'none';
        };
    }

    function createReadyPopup() {
        const popup = document.createElement('div');
        popup.id = 'exam-ready-popup';
        popup.textContent = '题库就绪';
        document.body.appendChild(popup);
    }

    function showReadyPopup() {
        const popup = document.getElementById('exam-ready-popup');
        popup.style.display = 'block';
        setTimeout(() => { popup.style.display = 'none'; }, 2000);
    }

    // ========== 键盘绑定 ==========
    function bindKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            switch(e.key) {
                case '-':
                    e.preventDefault();
                    fetchAndParse();
                    break;
                case '+':
                case '=':
                    e.preventDefault();
                    startExam();
                    break;
                case '*':
                    e.preventDefault();
                    togglePanel();
                    break;
            }
        });
    }

    function togglePanel() {
        if (state.panel) {
            state.panel.style.display = state.panel.style.display === 'none' ? 'block' : 'none';
        }
    }

    // ========== API 调用 ==========
    async function fetchAndParse() {
        updateStatus('获取中...');
        state.examType = detectExamType();
        document.getElementById('exam-type-value').textContent = state.examType || '-';

        try {
            const htmlContent = document.documentElement.outerHTML;
            const response = await fetch(CONFIG.apiUrl + '/api/parse-and-get-answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ htmlContent })
            });

            const resultText = await response.text();
            state.answers = parseAnswers(resultText);

            showReadyPopup();
            updateStatus('就绪 (' + state.answers.length + '题)');
            updateProgress(0, state.answers.length);

            console.log(`[Exam] 解析完成，共 ${state.answers.length} 道题，类型: ${state.examType}`);
        } catch (err) {
            updateStatus('失败');
            console.error('[Exam] 获取源码失败:', err);
        }
    }

    function parseAnswers(text) {
        const answers = [];
        const lines = text.split('\n');
        for (const line of lines) {
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

    // ========== 答题逻辑 ==========
    async function startExam() {
        if (!state.answers || state.answers.length === 0) {
            alert('请先按 - 获取源码');
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

        await executeAnswering();
    }

    async function executeAnswering() {
        let success = 0, failed = 0, skipped = 0;
        const containers = getQuestionContainers();

        for (let i = 0; i < state.answers.length; i++) {
            if (state.isPaused) {
                await waitForResume();
            }
            if (!state.isRunning) break;

            const ans = state.answers[i];
            updateProgress(i + 1, state.answers.length);

            try {
                const result = await answerQuestion(ans, containers);
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
                console.error(`[Exam] 第${ans.num}题答题失败:`, e);
            }
        }

        updateStatus(`完成(${success}/${state.totalQuestions})`);
        updateButtonsState(false);
        state.isRunning = false;
        alert(`答题完成！成功: ${success}, 跳过: ${skipped}, 失败: ${failed}`);
    }

    async function answerQuestion(ans, containers) {
        const globalIndex = ans.num - 1;
        if (globalIndex >= containers.length) {
            console.error(`[Exam] 题目索引越界 ${globalIndex}/${containers.length}`);
            return false;
        }

        const ti = containers[globalIndex];
        const targetLetter = ans.type === '判断'
            ? (ans.answer === '对' || ans.answer === '正确' ? 'A' : 'B')
            : ans.answer.trim().toUpperCase();

        // 简答题
        if (ans.type === '简答') {
            let input = ti.querySelector('textarea, input[type="text"]');
            if (!input) input = ti.querySelector('input[type="text"]');
            if (input) {
                input.value = ans.answer;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            return false;
        }

        // 局网考试
        if (state.examType === '局网考试') {
            const inputType = ans.type === '多选' ? 'checkbox' : 'radio';
            const inputs = ti.querySelectorAll(`table input[type="${inputType}"]`);
            
            if (ans.type === '多选') {
                const letters = ans.answer.replace(/[,，]/g, '').toUpperCase().split('');
                let clicked = 0;
                for (const letter of letters) {
                    for (const input of inputs) {
                        if (input.value.toUpperCase() === letter) {
                            input.click();
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            clicked++;
                            await sleep(50);
                        }
                    }
                }
                return clicked > 0;
            } else {
                for (const input of inputs) {
                    if (input.value.toUpperCase() === targetLetter) {
                        input.click();
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                }
            }
            return false;
        }

        // 职教考试
        const selector = ans.type === '多选' 
            ? 'label.ant-checkbox-wrapper' 
            : 'label.ant-radio-wrapper';
        const labels = ti.querySelectorAll(selector);
        
        const letters = ans.type === '多选' 
            ? ans.answer.replace(/[,，]/g, '').toUpperCase().split('')
            : [targetLetter];

        let clicked = 0;
        for (const letter of letters) {
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
            await sleep(100);
            return true;
        }

        // 回退：直接点击 input
        const inputs = ti.querySelectorAll(`input[type="${ans.type === '多选' ? 'checkbox' : 'radio'}"]`);
        for (const input of inputs) {
            if (input.value.toUpperCase() === targetLetter) {
                input.click();
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }

        return false;
    }

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

    function stopExam() {
        state.isRunning = false;
        state.isPaused = false;
        updateButtonsState(false);
        updateStatus('已停止');
    }

    function waitForResume() {
        return new Promise(resolve => {
            const check = setInterval(() => {
                if (!state.isPaused || !state.isRunning) {
                    clearInterval(check);
                    resolve();
                }
            }, 500);
        });
    }

    // ========== 工具函数 ==========
    function calculateDelay(len) {
        return (1000 + len * 50) * (Math.random() * 0.4 + 0.8);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function updateStatus(status) {
        const el = document.getElementById('status-value');
        if (el) el.textContent = status;
    }

    function updateProgress(current, total) {
        const progressEl = document.getElementById('progress-value');
        const fillEl = document.getElementById('progress-fill');
        if (progressEl) progressEl.textContent = `${current}/${total}`;
        if (fillEl && total > 0) fillEl.style.width = (current / total * 100) + '%';
    }

    function updateButtonsState(running) {
        const startBtn = document.getElementById('start-btn');
        const pauseBtn = document.getElementById('pause-btn');
        const stopBtn = document.getElementById('stop-btn');
        if (startBtn) startBtn.disabled = running;
        if (pauseBtn) pauseBtn.disabled = !running;
        if (stopBtn) stopBtn.disabled = !running;
    }

    // ========== 启动 ==========
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }
    
    // ========== 消息监听 (支持 Popup) ==========
    if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.action) {
                case 'fetchAndParse':
                    fetchAndParse().then(result => sendResponse(result));
                    return true;
                case 'startExam':
                    if (message.answers) {
                        state.answers = message.answers;
                    }
                    startExam().then(result => sendResponse(result));
                    return true;
                case 'stopExam':
                    stopExam();
                    sendResponse({ success: true });
                    return false;
                case 'getState':
                    sendResponse({
                        examType: state.examType,
                        status: document.getElementById('status-value')?.textContent || '待机',
                        answers: state.answers
                    });
                    return false;
            }
        });
    }
})();