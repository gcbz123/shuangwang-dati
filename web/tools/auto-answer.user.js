// ==UserScript==
// @name         答题助手 - 键盘控制版
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  小键盘-获取源码，小键盘+自动答题，小键盘*隐藏界面
// @author       Sisyphus
// @match        http://*/*
// @match        https://*/*
// @run-at      document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // ========== 配置 ==========
    const CONFIG = {
        apiUrl: 'http://10.104.240.163:3000',
        checkInterval: 500  // 检查间隔
    };

    // ========== 状态 ==========
    let state = {
        panel: null,
        statusPanel: null,
        htmlContent: null,
        answers: null,
        typeStats: { danxuan: 0, duoxuan: 0, panduan: 0, jianda: 0 },  // 各题型数量
        isProcessing: false,
        questionElements: [],
        currentQuestionIndex: 0,
        lastButtonText: ''
    };

    // ========== 样式 ==========
    const STYLES = `
        #dati-panel {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 200px;
            background: rgba(0, 0, 0, 0.15);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 8px;
            padding: 12px;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #333;
            font-size: 12px;
            border: 1px solid rgba(255,255,255,0.3);
        }
        #dati-panel h3 {
            margin: 0 0 8px 0;
            font-size: 13px;
            font-weight: 500;
            opacity: 0.9;
        }
        #dati-panel .status {
            background: rgba(255,255,255,0.3);
            border-radius: 6px;
            padding: 8px;
            margin-bottom: 8px;
        }
        #dati-panel .status-item {
            display: flex;
            justify-content: space-between;
            margin: 3px 0;
            font-size: 11px;
        }
        #dati-panel .key-hint {
            background: rgba(255,255,255,0.3);
            border-radius: 4px;
            padding: 6px;
            font-size: 10px;
            text-align: center;
            opacity: 0.8;
        }
        #dati-panel .key {
            background: rgba(0,0,0,0.1);
            padding: 1px 5px;
            border-radius: 3px;
            font-weight: 500;
            margin: 0 2px;
        }
        #dati-panel .close-btn {
            position: absolute;
            top: 6px;
            right: 8px;
            background: none;
            border: none;
            color: #666;
            font-size: 14px;
            cursor: pointer;
            opacity: 0.5;
        }
        #dati-panel .close-btn:hover { opacity: 1; }

        /* 答题就绪提示窗 */
        #dati-ready-popup {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: #fff;
            padding: 15px 30px;
            border-radius: 30px;
            font-size: 18px;
            font-weight: 300;
            z-index: 999999;
            letter-spacing: 2px;
            display: none;
        }

        /* 答题进度 */
        #dati-progress {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: #fff;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 300;
            z-index: 999999;
            display: none;
        }
    `;

    // ========== 初始化 ==========
    function init() {
        GM_addStyle(STYLES);
        createPanel();
        createReadyPopup();
        createProgressBar();
        bindKeyboard();
        console.log('答题助手已就绪 - 小键盘-获取源码, 小键盘+开始答题, 小键盘*隐藏界面');
    }

    // 创建悬浮面板
    function createPanel() {
        if (state.panel) return;

        state.panel = document.createElement('div');
        state.panel.id = 'dati-panel';
        state.panel.innerHTML = `
            <button class="close-btn" onclick="document.getElementById('dati-panel').remove()">×</button>
            <h3>答题助手</h3>
            <div class="status">
                <div class="status-item">
                    <span>源码</span>
                    <span id="dati-html-status">-</span>
                </div>
                <div class="status-item">
                    <span>答案</span>
                    <span id="dati-answer-status">-</span>
                </div>
                <div class="status-item">
                    <span>题目</span>
                    <span id="dati-count">0</span>
                </div>
            </div>
            <div class="key-hint">
                <span class="key">-</span>源码 <span class="key">+</span>答题 <span class="key">*</span>隐藏 <span class="key">/</span>停止
            </div>
        `;
        document.body.appendChild(state.panel);
    }

    // 创建就绪提示窗
    function createReadyPopup() {
        state.statusPanel = document.createElement('div');
        state.statusPanel.id = 'dati-ready-popup';
        state.statusPanel.textContent = '题库就绪';
        document.body.appendChild(state.statusPanel);
    }

    // 调试：打印页面结构
    function debugPage() {
        console.log('========== 页面调试 ==========');

        // 打印所有按钮
        const buttons = document.querySelectorAll('button');
        console.log(`页面共有 ${buttons.length} 个按钮:`);
        buttons.forEach((btn, i) => {
            if (btn.textContent.trim()) {
                console.log(`  [${i}] ${btn.textContent.trim().substring(0, 20)} class="${btn.className}" disabled=${btn.disabled}`);
            }
        });

        // 打印所有radio
        const radios = document.querySelectorAll('input[type="radio"]');
        console.log(`页面共有 ${radios.length} 个radio:`);
        radios.forEach((r, i) => {
            if (i < 20) {
                console.log(`  [${i}] value="${r.value}" name="${r.name}" checked=${r.checked}`);
            }
        });
        if (radios.length > 20) {
            console.log(`  ... 共 ${radios.length} 个`);
        }

        // 打印所有checkbox
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        console.log(`页面共有 ${checkboxes.length} 个checkbox:`);
        checkboxes.forEach((c, i) => {
            if (i < 10) {
                console.log(`  [${i}] value="${c.value}" checked=${c.checked}`);
            }
        });
        if (checkboxes.length > 10) {
            console.log(`  ... 共 ${checkboxes.length} 个`);
        }

        // 打印 textarea/input
        const inputs = document.querySelectorAll('textarea, input[type="text"]');
        console.log(`页面共有 ${inputs.length} 个输入框:`);
        inputs.forEach((inp, i) => {
            console.log(`  [${i}] ${inp.tagName} value="${inp.value}" placeholder="${inp.placeholder || ''}"`);
        });

        console.log('========== 调试结束 ==========');
    }

    // 创建进度条
    function createProgressBar() {
        state.progressBar = document.createElement('div');
        state.progressBar.id = 'dati-progress';
        document.body.appendChild(state.progressBar);
    }

    // 绑定键盘事件
    function bindKeyboard() {
        document.addEventListener('keydown', (e) => {
            // 小键盘 - 获取源码
            if (e.key === '-' || e.code === 'NumpadSubtract') {
                e.preventDefault();
                fetchAndParse();
            }
            // 小键盘 + 开始答题
            else if (e.key === '+' || e.code === 'NumpadAdd') {
                e.preventDefault();
                startAnswering();
            }
            // 小键盘 * 隐藏/显示界面
            else if (e.key === '*' || e.code === 'NumpadMultiply') {
                e.preventDefault();
                togglePanel();
            }
            // 小键盘 / 停止答题
            else if (e.key === '/' || e.code === 'NumpadDivide') {
                e.preventDefault();
                stopAnswering();
            }
            // 小键盘 D 调试
            else if (e.key === 'd' || e.key === 'D') {
                e.preventDefault();
                debugPage();
            }
        });
    }

    // 停止答题
    function stopAnswering() {
        state.isProcessing = false;
        state.progressBar.style.display = 'none';
        updateStatus('answer', '已停止');
        console.log('答题已停止');
    }

    // 隐藏/显示面板
    function togglePanel() {
        if (state.panel) {
            if (state.panel.style.display === 'none') {
                state.panel.style.display = 'block';
            } else {
                state.panel.style.display = 'none';
            }
        }
    }

    // ========== 核心功能 ==========

    // 获取网页源码并解析
    async function fetchAndParse() {
        if (state.isProcessing) return;

        updateStatus('html', '获取中...');
        state.isProcessing = true;

        try {
            // 获取当前页面的HTML
            const htmlContent = document.documentElement.outerHTML;
            state.htmlContent = htmlContent;

            // 发送到后端解析
            const response = await fetch(CONFIG.apiUrl + '/api/parse-and-get-answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ htmlContent })
            });

            const resultText = await response.text();
            state.answers = parseAnswers(resultText);

            updateStatus('html', '✓ 已获取');
            updateStatus('answer', '✓ 已解析');
            updateCount(state.answers.length);

            // 显示就绪提示
            showReadyPopup();

            console.log('解析完成，共', state.answers.length, '道题');

        } catch (err) {
            updateStatus('html', '✗ 失败');
            console.error('获取源码失败:', err);
            alert('获取失败: ' + err.message);
        } finally {
            state.isProcessing = false;
        }
    }

    // 解析答案文本
    function parseAnswers(text) {
        const answers = [];
        const lines = text.split('\n');

        for (const line of lines) {
            // 解析题型统计
            const statsMatch = line.match(/题型统计: 单选(\d+)题, 多选(\d+)题, 判断(\d+)题, 简答(\d+)题/);
            if (statsMatch) {
                state.typeStats = {
                    danxuan: parseInt(statsMatch[1]),
                    duoxuan: parseInt(statsMatch[2]),
                    panduan: parseInt(statsMatch[3]),
                    jianda: parseInt(statsMatch[4])
                };
                console.log('题型统计:', state.typeStats);
                continue;
            }

            // 解析题目答案
            const match = line.match(/(单选|多选|判断|简答)-第(\d+)题：答案：(.+)/);
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
        state.statusPanel.style.display = 'block';
        setTimeout(() => {
            state.statusPanel.style.display = 'none';
        }, 2000);
    }

    // 开始答题
    async function startAnswering() {
        if (!state.answers || state.answers.length === 0) {
            alert('请先按 - 获取源码');
            return;
        }

        if (state.isProcessing) return;
        state.isProcessing = true;

        // 隐藏浮动面板，避免答题时被看到
        if (state.panel) state.panel.style.display = 'none';
        if (state.statusPanel) state.statusPanel.style.display = 'none';

        updateStatus('answer', '答题中...');
        state.progressBar.style.display = 'block';

        let success = 0;
        let failed = 0;

        for (const ans of state.answers) {
            state.progressBar.textContent = `答题中: ${ans.num}/${state.answers.length}`;

            try {
                const result = await answerQuestion(ans);
                if (result) success++;
                else failed++;

                // 延迟一下，避免太快
                await sleep(100);
            } catch (e) {
                failed++;
                console.error('答题失败:', ans.num, e);
            }
        }

        state.progressBar.style.display = 'none';
        updateStatus('answer', `完成(${success}/${success + failed})`);
        state.isProcessing = false;

        alert(`答题完成！成功: ${success}, 失败: ${failed}`);
    }

// 回答单道题 - 基于 .ti 容器定位，题号直接对应 .ti 索引
    async function answerQuestion(ans) {
        console.log(`开始回答第${ans.num}题, 类型:${ans.type}, 答案:${ans.answer}`);

        const allTis = document.querySelectorAll('.ti');
        const globalIndex = ans.num - 1;
        if (globalIndex >= allTis.length) {
            console.error(`题目索引越界 ${globalIndex}/${allTis.length}`);
            return false;
        }
        const ti = allTis[globalIndex];

        if (ans.type === '单选' || ans.type === '判断') {
            const target = ans.type === '判断'
                ? (ans.answer === '对' || ans.answer === '正确' ? 'A' : 'B')
                : ans.answer.trim().toUpperCase();

            // 优先点击 label（触发完整的 Vue 事件链）
            const labels = ti.querySelectorAll('label.ant-radio-wrapper');
            for (const label of labels) {
                const radio = label.querySelector('input[type="radio"]');
                if (radio && radio.value.toUpperCase() === target) {
                    label.click();
                    await sleep(80);
                    return true;
                }
            }
            // 降级：直接点击 input
            const radios = ti.querySelectorAll('input[type="radio"]');
            for (const r of radios) {
                if (r.value.toUpperCase() === target) {
                    r.click();
                    r.dispatchEvent(new Event('change', { bubbles: true }));
                    await sleep(80);
                    return true;
                }
            }
            console.warn(`第${ans.num}题未找到选项: ${target}`);
            return false;
        }

        if (ans.type === '多选') {
            const answers = ans.answer.split(/[,，]/).map(a => a.trim().toUpperCase());
            const labels = ti.querySelectorAll('label.ant-checkbox-wrapper');
            let clicked = 0;

            for (const a of answers) {
                for (const label of labels) {
                    const cb = label.querySelector('input[type="checkbox"]');
                    if (cb && cb.value.toUpperCase() === a) {
                        label.click();
                        await sleep(50);
                        clicked++;
                        break;
                    }
                }
            }
            console.log(`多选第${ans.num}题: 成功 ${clicked}/${answers.length}`);
            await sleep(100);
            return clicked > 0;
        }

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
        return false;
    }

    // 查找"下一题"按钮
    function findNextButton() {
        // 由于 querySelector 不支持 :contains，用 textContent 查找
        const buttons = document.querySelectorAll('button, a[role="button"], .ant-btn');
        for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (text.includes('下一题') || text.includes('Next') ||
                text.includes('确认') || text.includes('提交') || text.includes('Submit')) {
                // 排除禁用状态
                if (!btn.disabled && btn.offsetParent !== null) {
                    console.log('找到下一题按钮:', text);
                    return btn;
                }
            }
        }

        // 备选：查找带有"下一题"相关类的元素
        const nextElements = document.querySelectorAll('[class*="next"], [class*="submit"]');
        for (const el of nextElements) {
            if (el.tagName === 'BUTTON' || el.tagName === 'A') {
                if (!el.disabled && el.offsetParent !== null) {
                    console.log('找到下一题按钮(备选):', el.className);
                    return el;
                }
            }
        }

        console.log('未找到下一题按钮');
        return null;
    }

    // 等待题目加载完成
    async function waitForQuestionLoaded() {
        const maxWait = 3000;
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWait) {
            const questionEl = document.querySelector('.question-content, .ant-layout-content, .ti, .ant-radio-group');
            if (questionEl) {
                await sleep(100);
                return true;
            }
            await sleep(100);
        }
        return false;
    }

    // ========== 工具函数 ==========

    function updateStatus(type, value) {
        const el = document.getElementById(`dati-${type}-status`);
        if (el) el.textContent = value;
    }

    function updateCount(value) {
        const el = document.getElementById('dati-count');
        if (el) el.textContent = value;
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