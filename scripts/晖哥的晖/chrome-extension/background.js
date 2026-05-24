// background.js - Service Worker
// 负责配置存储、通知显示、以及注入 page-world.js 到页面主世界

// 页面主世界脚本是否已注入到各 tab 的记录
var injectedTabs = {};

chrome.runtime.onInstalled.addListener(() => {
    // 仅写入状态配置，不覆盖用户自定义的 apiUrl/wsPort
    chrome.storage.local.set({
        autoMode: false,
        autoNextPage: true
    });
    console.log('[晖哥的助手] 插件已安装，配置初始化完成');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    var tabId = sender.tab ? sender.tab.id : null;

    // 注入 page-world.js 到页面主世界
    if (message.type === 'injectPageWorld') {
        if (!tabId) {
            sendResponse({ success: false, error: 'No tab id' });
            return true;
        }
        if (injectedTabs[tabId]) {
            sendResponse({ success: true });
            return true;
        }
        chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            files: ['page-world.js']
        }).then(() => {
            injectedTabs[tabId] = true;
            sendResponse({ success: true });
        }).catch((err) => {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    if (message.type === 'getConfig') {
        chrome.storage.local.get(['autoMode', 'autoNextPage', 'apiUrl', 'wsPort'], (config) => {
            sendResponse({ success: true, config });
        });
        return true;
    }

    if (message.type === 'saveConfig') {
        chrome.storage.local.set(message.config, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    if (message.type === 'showNotification') {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: message.title || '晖哥的助手',
            message: message.text,
            priority: 0
        });
        sendResponse({ success: true });
        return true;
    }
});

// Tab 关闭时清理注入记录
chrome.tabs.onRemoved.addListener((tabId) => {
    delete injectedTabs[tabId];
});
