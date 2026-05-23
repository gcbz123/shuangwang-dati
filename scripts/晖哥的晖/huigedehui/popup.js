// popup.js - Popup 逻辑
document.addEventListener('DOMContentLoaded', function() {
    const examTypeEl = document.getElementById('exam-type');
    const statusEl = document.getElementById('status');
    const countEl = document.getElementById('count');
    const btnFetch = document.getElementById('btn-fetch');
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    
    let currentAnswers = null;
    
    // 初始化：获取当前标签页信息
    async function init() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'getState' }).catch(() => null);
            if (response) {
                examTypeEl.textContent = response.examType || '-';
                statusEl.textContent = response.status || '待机';
                if (response.answers && response.answers.length > 0) {
                    currentAnswers = response.answers;
                    countEl.textContent = currentAnswers.length;
                    btnStart.disabled = false;
                }
            }
        } catch (err) {
            console.log('无法获取状态');
        }
    }
    
    btnFetch.addEventListener('click', async function() {
        btnFetch.disabled = true;
        statusEl.textContent = '获取中...';
        
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const results = await chrome.tabs.sendMessage(tab.id, { action: 'fetchAndParse' });
            
            if (results && results.answers) {
                currentAnswers = results.answers;
                examTypeEl.textContent = results.examType || '-';
                statusEl.textContent = '就绪';
                countEl.textContent = currentAnswers.length;
                btnStart.disabled = false;
            } else {
                statusEl.textContent = '解析失败';
            }
        } catch (err) {
            statusEl.textContent = '获取失败';
        }
        
        btnFetch.disabled = false;
    });
    
    btnStart.addEventListener('click', async function() {
        if (!currentAnswers || currentAnswers.length === 0) {
            alert('请先获取源码');
            return;
        }
        
        btnStart.disabled = true;
        btnStop.disabled = false;
        statusEl.textContent = '运行中...';
        
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, { 
                action: 'startExam',
                answers: currentAnswers
            });
        } catch (err) {
            statusEl.textContent = '启动失败';
            btnStart.disabled = false;
            btnStop.disabled = true;
        }
    });
    
    btnStop.addEventListener('click', async function() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, { action: 'stopExam' });
            
            statusEl.textContent = '已停止';
            btnStart.disabled = false;
            btnStop.disabled = true;
        } catch (err) {
            console.error(err);
        }
    });
    
    init();
});