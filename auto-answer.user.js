// ==UserScript==
// @name         自动答题助手
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  自动读取网页源码文件并填充答案
// @author       Sisyphus
// @match        http://localhost:3500/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const API_URL = 'http://localhost:3500';

    // 添加控制面板
    function addControlPanel() {
        if (document.getElementById('auto-answer-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'auto-answer-panel';
        panel.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: white;
            border: 2px solid #4CAF50;
            border-radius: 8px;
            padding: 15px;
            z-index: 99999;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            max-width: 300px;
            font-size: 14px;
        `;

        panel.innerHTML = `
            <h3 style="margin: 0 0 10px 0; color: #4CAF50;">🌟 自动答题助手</h3>
            <div style="margin-bottom: 10px;">
                <label><input type="checkbox" id="aa-file1" checked> 1.txt</label>
                <label><input type="checkbox" id="aa-file2" checked> 2.txt</label>
                <label><input type="checkbox" id="aa-file3"> 3.txt</label>
            </div>
            <button id="aa-run-btn" style="
                background: #4CAF50;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                width: 100%;
            ">🚀 开始答题</button>
            <div id="aa-result" style="
                margin-top: 10px;
                padding: 10px;
                background: #f5f5f5;
                border-radius: 4px;
                display: none;
                max-height: 200px;
                overflow-y: auto;
                font-size: 12px;
                white-space: pre-wrap;
            "></div>
            <button id="aa-close-btn" style="
                margin-top: 10px;
                background: #666;
                color: white;
                border: none;
                padding: 5px 10px;
                border-radius: 4px;
                cursor: pointer;
            ">关闭</button>
        `;

        document.body.appendChild(panel);

        // 绑定事件
        document.getElementById('aa-run-btn').addEventListener('click', runAutoAnswer);
        document.getElementById('aa-close-btn').addEventListener('click', () => panel.remove());
    }

    async function runAutoAnswer() {
        const btn = document.getElementById('aa-run-btn');
        const resultDiv = document.getElementById('aa-result');

        const files = [];
        if (document.getElementById('aa-file1').checked) files.push('1.txt');
        if (document.getElementById('aa-file2').checked) files.push('2.txt');
        if (document.getElementById('aa-file3').checked) files.push('3.txt');

        if (files.length === 0) {
            alert('请至少选择一个文件');
            return;
        }

        btn.disabled = true;
        btn.textContent = '处理中...';
        resultDiv.style.display = 'block';
        resultDiv.textContent = '正在处理...\n';

        let logMessages = [];
        let clickCommands = [];

        try {
            for (const filename of files) {
                logMessages.push(`\n=== 读取 ${filename} ===`);

                // 读取文件
                const response = await fetch(API_URL + '/api/read-page-file?file=' + encodeURIComponent(filename));
                if (!response.ok) throw new Error('读取文件失败: ' + filename);

                const htmlContent = await response.text();
                logMessages.push(`文件大小: ${htmlContent.length} 字符`);

                // 发送到后端解析
                const parseRes = await fetch(API_URL + '/api/parse-and-get-answer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ htmlContent })
                });

                const resultText = await parseRes.text();
                logMessages.push(`\n--- 答案结果 ---\n${resultText}`);

                // 解析并生成点击指令
                const lines = resultText.split('\n');
                for (const line of lines) {
                    const match = line.match(/(单选|多选|判断|简答)-第(\d+)题答案[：:](.+)/);
                    if (match) {
                        const [, type, num, answer] = match;
                        const cleanAnswer = answer.trim();

                        // 生成油猴可用的点击脚本
                        let cmd = '';
                        if (type === '单选') {
                            // 查找单选按钮
                            const radioMatch = cleanAnswer.match(/([A-D])/);
                            if (radioMatch) {
                                cmd = `// ${filename} 第${num}题 单选\nclickRadio('${radioMatch[1]}', ${num})`;
                                clickCommands.push(cmd);
                            }
                        } else if (type === '判断') {
                            // 判断题：A=对, B=错
                            if (cleanAnswer === '对' || cleanAnswer === 'A') {
                                cmd = `// ${filename} 第${num}题 判断\nclickRadio('A', ${num})`;
                            } else if (cleanAnswer === '错' || cleanAnswer === 'B') {
                                cmd = `// ${filename} 第${num}题 判断\nclickRadio('B', ${num})`;
                            }
                            if (cmd) clickCommands.push(cmd);
                        } else if (type === '简答') {
                            cmd = `// ${filename} 第${num}题 简答\nfillAnswer('${cleanAnswer.replace(/'/g, "\\'")}', ${num})`;
                            clickCommands.push(cmd);
                        }
                    }
                }
            }

            // 显示结果
            resultDiv.textContent = logMessages.join('\n');

            if (clickCommands.length > 0) {
                resultDiv.textContent += `\n\n=== 可执行的点击脚本 ===\n\n`;
                resultDiv.textContent += clickCommands.join('\n\n');

                // 提供自动执行选项
                setTimeout(() => {
                    if (confirm('是否自动执行点击？\n\n注意：这将尝试在当前页面点击选项')) {
                        executeClicks(clickCommands);
                    }
                }, 500);
            }

        } catch (err) {
            logMessages.push('\n❌ 错误: ' + err.message);
            resultDiv.textContent = logMessages.join('\n');
        } finally {
            btn.disabled = false;
            btn.textContent = '🚀 开始答题';
        }
    }

    // 执行点击操作
    function executeClicks(commands) {
        let success = 0;
        let failed = 0;

        // 查找页面中的题目容器
        const questionContainers = document.querySelectorAll('.ti, [class*="question"], .ant-radio-group');

        commands.forEach((cmd, idx) => {
            // 解析命令
            const radioMatch = cmd.match(/clickRadio\('([A-D])',\s*(\d+)\)/);
            const fillMatch = cmd.match(/fillAnswer\('(.+)',\s*(\d+)\)/);

            if (radioMatch) {
                const letter = radioMatch[1];
                const qNum = parseInt(radioMatch[2]);
                // 查找对应题号的单选按钮
                const radios = document.querySelectorAll(`input[type="radio"]`);
                // 这里需要根据实际的HTML结构来定位
                // 尝试查找包含对应选项的radio
                const targetRadio = Array.from(radios).find(r => {
                    const label = r.closest('label');
                    return label && label.textContent.includes(letter);
                });
                if (targetRadio) {
                    targetRadio.click();
                    success++;
                } else {
                    failed++;
                }
            } else if (fillMatch) {
                const answer = fillMatch[1];
                const qNum = parseInt(fillMatch[2]);
                // 查找textarea
                const textareas = document.querySelectorAll('textarea');
                if (textareas[qNum - 1]) {
                    textareas[qNum - 1].value = answer;
                    success++;
                } else {
                    failed++;
                }
            }
        });

        alert(`执行完成: 成功 ${success}, 失败 ${failed}`);
    }

    // 在管理页面加载控制面板
    if (window.location.pathname.includes('admin.html')) {
        // 等待页面加载完成
        if (document.readyState === 'complete') {
            addControlPanel();
        } else {
            window.addEventListener('load', addControlPanel);
        }
    }
})();