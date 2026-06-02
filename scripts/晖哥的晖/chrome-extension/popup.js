// popup.js - 弹窗控制逻辑

// 向当前活动 tab 发送消息
async function sendToContent(action, data = {}) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return null;
        try {
            return await chrome.tabs.sendMessage(tab.id, { action, ...data });
        } catch (e) {
            console.warn('[Popup] content 未响应:', e.message);
            return null;
        }
    } catch (e) {
        console.warn('[Popup] tabs.query 失败:', e.message);
        return null;
    }
}

// 刷新状态显示
async function refreshStatus() {
    const resp = await sendToContent('getStatus');

    const statusEl = document.getElementById('status-val');
    const examTypeEl = document.getElementById('exam-type-val');
    const answersCountEl = document.getElementById('answers-count-val');
    const progressEl = document.getElementById('progress-val');
    const fillEl = document.getElementById('progress-fill');

    if (!resp || !resp.success) {
        statusEl.textContent = '未连接';
        statusEl.className = 'status-val danger';
        return;
    }

    const { enabled, examType, isRunning, answeredCount, totalQuestions, hasAnswers, answersCount } = resp.status;

    // 状态
    if (enabled === false) {
        statusEl.textContent = '已停用';
        statusEl.className = 'status-val warning';
    } else if (isRunning) {
        statusEl.textContent = '运行中';
        statusEl.className = 'status-val success';
    } else if (hasAnswers) {
        statusEl.textContent = '就绪';
        statusEl.className = 'status-val';
    } else {
        statusEl.textContent = '待机';
        statusEl.className = 'status-val';
    }

    // 考试类型
    examTypeEl.textContent = examType || '-';

    // 题目数量
    answersCountEl.textContent = hasAnswers ? `${answersCount} 题` : '-';

    // 答题进度
    progressEl.textContent = `${answeredCount}/${totalQuestions || 0}`;
    if (fillEl && totalQuestions > 0) {
        fillEl.style.width = (answeredCount / totalQuestions * 100) + '%';
    }
}


// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 加载配置
    const config = await new Promise(resolve => {
        try { chrome.storage.local.get(['enabled', 'autoMode', 'autoNextPage'], resolve); } catch (_) { resolve({}); }
    });

    const enabledEl = document.getElementById('toggle-enabled');
    const autoModeEl = document.getElementById('auto-mode');
    const autoNextEl = document.getElementById('auto-nextpage');

    enabledEl.checked = config.enabled !== false;
    autoModeEl.checked = config.autoMode || false;
    autoNextEl.checked = config.autoNextPage !== undefined ? config.autoNextPage : true;

    // 刷新状态
    await refreshStatus();

    // ========== 配置同步 ==========

    enabledEl.addEventListener('change', async () => {
        const enabled = enabledEl.checked;
        try { chrome.storage.local.set({ enabled }); } catch (_) {}
        await sendToContent('updateConfig', { enabled });
        await refreshStatus();
    });

    autoModeEl.addEventListener('change', async () => {
        const autoMode = autoModeEl.checked;
        try { chrome.storage.local.set({ autoMode }); } catch (_) {}
        await sendToContent('updateConfig', { autoMode });
    });

    autoNextEl.addEventListener('change', async () => {
        const autoNextPage = autoNextEl.checked;
        try { chrome.storage.local.set({ autoNextPage }); } catch (_) {}
        await sendToContent('updateConfig', { autoNextPage });
    });

});
