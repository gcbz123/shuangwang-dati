// page-world.js - 在页面主世界执行的辅助脚本（非 strict mode）
// 通信方式：content script 通过 window.postMessage 发指令，
// 本脚本在页面主世界（非 strict mode）执行 __doPostBack 等页面函数。

(function() {
    // 防止重复注入导致事件监听器翻倍
    if (window.__huigePageWorldInjected) return;
    window.__huigePageWorldInjected = true;

    window.addEventListener('message', function(event) {
        if (!event.data || event.data.source !== 'huige-content') return;

        // 执行 __doPostBack（翻页）
        if (event.data.type === 'huige-doPostBack') {
            var callId = event.data.id;
            try {
                if (typeof __doPostBack === 'function') {
                    __doPostBack(event.data.eventTarget, event.data.eventArgument);
                }
            } catch (e) {
                // __doPostBack 内部可能访问 arguments.caller（strict mode 报错），
                // 但本文件是非 strict mode，所以不会报错。
                // 留这个 catch 以防万一。
            }
            window.postMessage({
                source: 'huige-page',
                type: 'huige-postback-done',
                id: callId
            }, '*');
        }

        // 监听 ASP.NET AJAX endRequest 事件，通知 content script 页面已刷新完毕
        if (event.data.type === 'huige-waitPageReady') {
            var listenerId = event.data.listenerId;
            var abortTimeout = event.data.abortTimeout || 5000;
            var notified = false;
            var endRequestHandler = null;

            function notify() {
                if (notified) return;
                notified = true;
                // 清理 endRequest 监听，防止累积
                if (endRequestHandler && typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
                    try {
                        var prm = Sys.WebForms.PageRequestManager.getInstance();
                        prm.remove_endRequest(endRequestHandler);
                    } catch (e) {}
                }
                window.postMessage({
                    source: 'huige-page',
                    type: 'huige-page-ready',
                    id: listenerId
                }, '*');
            }

            if (typeof Sys !== 'undefined' && Sys.WebForms && Sys.WebForms.PageRequestManager) {
                var prm = Sys.WebForms.PageRequestManager.getInstance();
                endRequestHandler = notify;
                prm.add_endRequest(notify);
                // 兜底超时，防止 endRequest 未触发导致永久卡住
                setTimeout(notify, abortTimeout);
            } else {
                // 无 ASP.NET AJAX 框架，立即通知
                notify();
            }
        }
    });

    console.log('[晖哥的助手] page-world.js 已加载到页面主世界（非 strict mode）');
})();
