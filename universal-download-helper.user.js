// ==UserScript==
// @name         全能下载助手 | 支持30+网盘（含蓝奏云特殊解析）
// @namespace    https://github.com/WatchFleeting/universal-download-helper
// @version      1.0.0
// @author       Assistant
// @description  仅在网盘页面激活，自动捕获主流网盘直链，蓝奏云自动解析真实地址。支持API直接下载、Aria2命令、cURL命令、BC链接、RPC推送，配合IDM、Xdown、Aria2、cURL、比特彗星高效批量下载。
// @license      MIT
// @supportURL   https://github.com/WatchFleeting/universal-download-helper/issues
// @homepageURL  https://github.com/WatchFleeting/universal-download-helper
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?domain=greasyfork.org
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ======================= 网盘域名白名单 =======================
    const SUPPORTED_DOMAINS = [
        // 百度网盘
        'pan.baidu.com', 'yun.baidu.com',
        // 阿里云盘
        'www.aliyundrive.com', 'www.alipan.com',
        // 天翼云盘
        'cloud.189.cn',
        // 迅雷云盘
        'pan.xunlei.com',
        // 夸克网盘
        'pan.quark.cn',
        // 移动云盘
        'yun.139.com', 'caiyun.139.com',
        // 123云盘
        'www.123pan.com',
        // 小飞机网盘
        'feijipan.com', 'www.feijipan.com',
        // 115网盘
        '115.com',
        // 城通网盘
        'ctfile.com',
        // 腾讯微云
        'weiyun.com',
        // 蓝奏云
        'lanzou.com', 'lanzoux.com', 'lanzoui.com', 'lanzous.com', 'lanzouh.com',
        // 360云盘
        'yunpan.360.cn',
        // 文叔叔
        'ws28.cn',
        // UC网盘
        'uc.cn', 'drive.uc.cn'
    ];

    // 检查当前页面是否在支持列表中
    function isSupportedPage() {
        const host = location.hostname;
        return SUPPORTED_DOMAINS.some(domain => host === domain || host.endsWith('.' + domain));
    }

    // 如果不是支持的网盘页面，直接退出
    if (!isSupportedPage()) {
        console.log('[全能助手] 当前页面不在支持列表中，脚本未激活');
        return;
    }

    // ======================= 配置区 =======================
    const CONFIG = {
        panelLeft: '20px',
        panelTop: '80px',
        apiPatterns: [
            '/api/download', '/api/sharedownload', '/share/download',
            '/v2/file/download', '/v2/share_link/download',
            '/api/v1/file/download', '/api/v2/file/download',
            '/drive/v1/files', '/api/v1/file/download',
            '/hcy/file/download', '/orchestration/personalCloud/catalog/v1.0/getDisk',
            '/api/download', '/api/share', '/d/', '/down/',
            '115.com', '/v1/file/download',
            'ctfile.com', '/d/',
            'weiyun.com', '/api/disk/download',
            'lanzou', 'lanzoux', 'lanzoui',
            'yunpan.360.cn', 'yunpan.360.cn/api/file/download',
            'ws28.cn', '/f/',
            'uc.cn', 'drive.uc.cn'
        ],
        urlKeys: ['url', 'download_url', 'dlink', 'downloadUrl', 'link', 'downurl', 'web_content_link', 'downloadURL', 'urls', 'real_url', 'data'],
        debug: true,
        rpc: {
            domain: 'http://localhost',
            port: '16800',
            path: '/jsonrpc',
            token: '',
            dir: 'D:/Downloads'
        }
    };

    let capturedFiles = [];
    let isCapturing = true;
    let interceptorInstalled = false;
    let currentMode = 'api';
    let rpcConfig = { ...CONFIG.rpc };

    // ======================= 辅助函数 =======================
    function log(...args) {
        if (CONFIG.debug) console.log('[全能助手]', ...args);
    }

    function showToast(message, bgColor = '#333', duration = 2000) {
        let toast = document.getElementById('ud-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'ud-toast';
            toast.style.cssText = `
                position: fixed;
                bottom: 30px;
                right: 30px;
                background-color: ${bgColor};
                color: white;
                padding: 10px 20px;
                border-radius: 8px;
                font-size: 14px;
                z-index: 10001;
                font-family: system-ui, sans-serif;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                transition: opacity 0.3s;
                pointer-events: none;
            `;
            document.body.appendChild(toast);
        }
        toast.style.backgroundColor = bgColor;
        toast.textContent = message;
        toast.style.opacity = '1';
        clearTimeout(window.toastTimeout);
        window.toastTimeout = setTimeout(() => toast.style.opacity = '0', duration);
    }

    function loadSettings() {
        const saved = GM_getValue('capturedFiles', null);
        if (saved) {
            try {
                capturedFiles = JSON.parse(saved);
                log(`已加载 ${capturedFiles.length} 条历史链接`);
            } catch(e) {}
        }
        const savedRpc = GM_getValue('rpcConfig', null);
        if (savedRpc) {
            try {
                Object.assign(rpcConfig, JSON.parse(savedRpc));
            } catch(e) {}
        }
        updateLinkCount();
    }

    function saveCapturedFiles() {
        GM_setValue('capturedFiles', JSON.stringify(capturedFiles));
    }

    function saveRpcConfig() {
        GM_setValue('rpcConfig', JSON.stringify(rpcConfig));
    }

    function updateLinkCount() {
        const countSpan = document.getElementById('ud-link-count');
        if (countSpan) countSpan.textContent = capturedFiles.length;
    }

    function addCapturedFile(url, filename = '', referer = '') {
        if (!url || !url.startsWith('http')) return false;
        if (capturedFiles.some(f => f.url === url)) return false;
        if (!filename) {
            const urlParts = url.split('/');
            const last = urlParts.pop() || urlParts.pop();
            filename = decodeURIComponent(last.split('?')[0]) || 'unknown';
        }
        capturedFiles.push({ url, filename, referer, size: '' });
        saveCapturedFiles();
        updateLinkCount();
        log('捕获新文件:', filename, url);
        showToast(`✓ 已捕获: ${filename.substring(0, 30)}`, '#4CAF50');
        return true;
    }

    function clearAll() {
        capturedFiles = [];
        saveCapturedFiles();
        updateLinkCount();
        showToast('已清空所有链接', '#f44336');
    }

    // ======================= 蓝奏云专用解析 =======================
    async function parseLanzou(shareUrl, pwd = '') {
        try {
            let url = shareUrl.trim();
            if (!url.startsWith('http')) url = 'https://' + url;
            const urlObj = new URL(url);
            let baseDomain = urlObj.hostname;
            
            const getHtml = (url) => new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                    onload: (res) => resolve(res.responseText),
                    onerror: () => resolve(null)
                });
            });
            
            let html = await getHtml(url);
            if (!html) return null;
            
            let sign = '';
            const signMatch = html.match(/var skdklds\s*=\s*'([^']+)'/);
            if (signMatch) sign = signMatch[1];
            if (!sign) {
                const signMatch2 = html.match(/var\s+sign\s*=\s*'([^']+)'/);
                if (signMatch2) sign = signMatch2[1];
            }
            
            let pwdParam = pwd;
            if (!pwdParam) {
                const pwdMatch = html.match(/var\s+pwd\s*=\s*'([^']+)'/);
                if (pwdMatch) pwdParam = pwdMatch[1];
            }
            
            const postData = new URLSearchParams();
            postData.append('action', 'downprocess');
            postData.append('sign', sign);
            if (pwdParam) postData.append('p', pwdParam);
            if (html.includes('k:')) {
                const kMatch = html.match(/k\s*:\s*'([^']+)'/);
                if (kMatch) postData.append('k', kMatch[1]);
            }
            
            const ajaxUrl = `https://${baseDomain}/ajaxm.php`;
            const response = await new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: ajaxUrl,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
                    data: postData.toString(),
                    onload: (res) => {
                        try {
                            resolve(JSON.parse(res.responseText));
                        } catch(e) {
                            resolve(null);
                        }
                    },
                    onerror: () => resolve(null)
                });
            });
            
            if (response && response.zt === 1) {
                let dom = response.dom;
                let fileUrl = response.url;
                if (dom && fileUrl) {
                    let finalUrl = `https://${dom}/file/${fileUrl}`;
                    if (response.inf && response.inf.t) finalUrl += `?t=${response.inf.t}`;
                    return finalUrl;
                } else if (response.url) {
                    return response.url;
                }
            } else if (response && response.zt === 2) {
                log('蓝奏云需要验证码，无法自动解析');
                return null;
            } else {
                const folderMatch = html.match(/data\s*:\s*(\{.*?\})/s);
                if (folderMatch) {
                    try {
                        const folderData = JSON.parse(folderMatch[1]);
                        if (folderData && folderData.text && folderData.text.length > 0) {
                            const firstFile = folderData.text[0];
                            const fileUrl = `https://${baseDomain}/${firstFile.id}`;
                            return await parseLanzou(fileUrl, pwdParam);
                        }
                    } catch(e) {}
                }
                return null;
            }
        } catch (err) {
            log('蓝奏云解析异常:', err);
            return null;
        }
        return null;
    }

    // ======================= 各下载模式的处理函数 =======================
    function getReferer() { return location.href; }

    function toAria2Command(file) {
        let filename = file.filename.replace(/[\\/:*?"<>|]/g, '_');
        let cmd = `aria2c "${file.url}" --out "${filename}"`;
        if (file.referer) cmd += ` --header "Referer: ${file.referer}"`;
        return cmd;
    }

    function toCurlCommand(file) {
        let filename = file.filename.replace(/[\\/:*?"<>|]/g, '_');
        let cmd = `curl -L -C - "${file.url}" -o "${filename}"`;
        if (file.referer) cmd += ` -e "${file.referer}"`;
        return cmd;
    }

    function toBCLink(file) {
        let encodedFilename = encodeURIComponent(file.filename);
        let bcData = `AA/${encodedFilename}/?url=${encodeURIComponent(file.url)}`;
        if (file.referer) bcData += `&refer=${encodeURIComponent(file.referer)}`;
        bcData += 'ZZ';
        let bcBase64 = btoa(unescape(encodeURIComponent(bcData)));
        return `bc://http/${bcBase64}`;
    }

    async function sendToRPC(file) {
        const { domain, port, path, token, dir } = rpcConfig;
        const url = `${domain}:${port}${path}`;
        const payload = {
            id: Date.now(),
            jsonrpc: '2.0',
            method: 'aria2.addUri',
            params: [`token:${token}`, [file.url], {
                dir: dir,
                out: file.filename,
                header: file.referer ? [`Referer: ${file.referer}`] : []
            }]
        };
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify(payload),
                onload: (res) => {
                    if (res.status === 200) {
                        try {
                            const data = JSON.parse(res.response);
                            resolve(!!data.result);
                        } catch(e) { resolve(false); }
                    } else resolve(false);
                },
                onerror: () => resolve(false)
            });
        });
    }

    function directDownload(file) {
        const a = document.createElement('a');
        a.href = file.url;
        a.download = file.filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 1000);
    }

    // ======================= UI 面板 =======================
    function createPanel() {
        if (document.getElementById('ud-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'ud-panel';
        panel.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <strong>⚡ 全能下载助手</strong>
                <span id="ud-link-count" style="background:#2196F3; padding:2px 8px; border-radius:20px;">0</span>
            </div>
            <div style="margin-bottom: 8px;">
                <select id="ud-mode-select" style="width:100%; padding:4px; border-radius:4px;">
                    <option value="api">🌐 浏览器/IDM 直接下载</option>
                    <option value="aria">⬇️ Aria2 命令</option>
                    <option value="curl">📜 cURL 命令</option>
                    <option value="bc">🐿️ 比特彗星 BC 链接</option>
                    <option value="rpc">🚀 RPC 推送 (Aria2/Motrix)</option>
                </select>
            </div>
            <div id="ud-file-list" style="max-height: 300px; overflow-y: auto; font-size: 12px; margin-bottom: 8px;"></div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                <button id="ud-batch-export" style="flex:1; background:#4CAF50;">📋 批量导出</button>
                <button id="ud-clear-all" style="flex:1; background:#f44336;">🗑️ 清空</button>
                <button id="ud-settings" style="flex:1; background:#607d8b;">⚙️ RPC设置</button>
                <button id="ud-toggle-capture" style="flex:1; background:#ff9800;">⏸️ 暂停</button>
            </div>
            <div id="ud-drag-handle" style="position:absolute; top:0; left:0; right:0; height:24px; cursor:move; background:rgba(0,0,0,0.1); border-radius:8px 8px 0 0;"></div>
        `;
        panel.style.cssText = `
            position: fixed;
            left: ${CONFIG.panelLeft};
            top: ${CONFIG.panelTop};
            width: 320px;
            background: rgba(30,30,40,0.95);
            color: white;
            border-radius: 12px;
            padding: 12px;
            font-family: system-ui, sans-serif;
            font-size: 13px;
            z-index: 10000;
            box-shadow: 0 4px 15px rgba(0,0,0,0.4);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.2);
            user-select: none;
        `;
        document.body.appendChild(panel);

        document.getElementById('ud-mode-select').addEventListener('change', (e) => {
            currentMode = e.target.value;
            renderFileList();
        });
        document.getElementById('ud-batch-export').addEventListener('click', batchExport);
        document.getElementById('ud-clear-all').addEventListener('click', clearAll);
        document.getElementById('ud-settings').addEventListener('click', showRpcSettings);
        const toggleBtn = document.getElementById('ud-toggle-capture');
        toggleBtn.addEventListener('click', () => {
            isCapturing = !isCapturing;
            toggleBtn.textContent = isCapturing ? '⏸️ 暂停' : '▶️ 开始';
            toggleBtn.style.background = isCapturing ? '#ff9800' : '#607d8b';
            showToast(isCapturing ? '捕获已开启' : '捕获已暂停', isCapturing ? '#4CAF50' : '#f44336');
        });

        // 拖拽
        let dragHandle = document.getElementById('ud-drag-handle');
        let isDragging = false, startX, startY, startLeft, startTop;
        dragHandle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseInt(panel.style.left);
            startTop = parseInt(panel.style.top);
            panel.style.transition = 'none';
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let dx = e.clientX - startX, dy = e.clientY - startY;
            let newLeft = startLeft + dx, newTop = startTop + dy;
            newLeft = Math.min(Math.max(0, newLeft), window.innerWidth - panel.offsetWidth);
            newTop = Math.min(Math.max(0, newTop), window.innerHeight - panel.offsetHeight);
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
        });
        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                panel.style.transition = '';
                GM_setValue('panelLeft', panel.style.left);
                GM_setValue('panelTop', panel.style.top);
            }
        });
        const savedLeft = GM_getValue('panelLeft', null);
        const savedTop = GM_getValue('panelTop', null);
        if (savedLeft && savedTop) {
            panel.style.left = savedLeft;
            panel.style.top = savedTop;
        }
        renderFileList();
    }

    function renderFileList() {
        const container = document.getElementById('ud-file-list');
        if (!container) return;
        if (capturedFiles.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:#aaa;padding:10px;">暂无捕获的链接</div>';
            return;
        }
        let html = '';
        capturedFiles.forEach((file, idx) => {
            let actionHtml = '';
            if (currentMode === 'api') {
                actionHtml = `<button class="ud-download-btn" data-idx="${idx}" style="background:#4CAF50;">⬇️ 下载</button>`;
            } else if (currentMode === 'aria') {
                actionHtml = `<button class="ud-copy-btn" data-idx="${idx}" data-type="aria" style="background:#2196F3;">📋 复制命令</button>`;
            } else if (currentMode === 'curl') {
                actionHtml = `<button class="ud-copy-btn" data-idx="${idx}" data-type="curl" style="background:#2196F3;">📋 复制命令</button>`;
            } else if (currentMode === 'bc') {
                actionHtml = `<button class="ud-copy-btn" data-idx="${idx}" data-type="bc" style="background:#9C27B0;">📋 复制BC链接</button>`;
            } else if (currentMode === 'rpc') {
                actionHtml = `<button class="ud-rpc-btn" data-idx="${idx}" style="background:#FF5722;">🚀 推送</button>`;
            }
            html += `
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; padding:4px; background:rgba(255,255,255,0.1); border-radius:4px;">
                    <span style="flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;" title="${file.filename}">📄 ${file.filename}</span>
                    ${actionHtml}
                </div>
            `;
        });
        container.innerHTML = html;

        document.querySelectorAll('.ud-download-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                directDownload(capturedFiles[idx]);
                showToast(`开始下载: ${capturedFiles[idx].filename}`, '#4CAF50');
            });
        });
        document.querySelectorAll('.ud-copy-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                const type = btn.dataset.type;
                let text = '';
                if (type === 'aria') text = toAria2Command(capturedFiles[idx]);
                else if (type === 'curl') text = toCurlCommand(capturedFiles[idx]);
                else if (type === 'bc') text = toBCLink(capturedFiles[idx]);
                GM_setClipboard(text, 'text');
                showToast('已复制到剪贴板', '#4CAF50');
                btn.textContent = '✓ 已复制';
                setTimeout(() => { if (btn) btn.textContent = '📋 复制命令'; }, 1500);
            });
        });
        document.querySelectorAll('.ud-rpc-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const idx = parseInt(btn.dataset.idx);
                btn.textContent = '⏳ 推送中';
                btn.disabled = true;
                const success = await sendToRPC(capturedFiles[idx]);
                if (success) {
                    showToast(`推送成功: ${capturedFiles[idx].filename}`, '#4CAF50');
                    btn.textContent = '✓ 已推送';
                } else {
                    showToast(`推送失败，请检查RPC配置`, '#f44336');
                    btn.textContent = '❌ 失败';
                }
                setTimeout(() => {
                    if (btn) btn.textContent = '🚀 推送';
                    btn.disabled = false;
                }, 2000);
            });
        });
    }

    function batchExport() {
        if (capturedFiles.length === 0) {
            showToast('没有捕获到任何文件', '#ff9800');
            return;
        }
        let exportText = '';
        if (currentMode === 'aria') {
            exportText = capturedFiles.map(f => toAria2Command(f)).join('\n');
        } else if (currentMode === 'curl') {
            exportText = capturedFiles.map(f => toCurlCommand(f)).join('\n');
        } else if (currentMode === 'bc') {
            exportText = capturedFiles.map(f => toBCLink(f)).join('\n');
        } else if (currentMode === 'rpc') {
            showToast('RPC模式请逐个推送或使用批量推送按钮', '#ff9800');
            return;
        } else {
            exportText = capturedFiles.map(f => f.url).join('\n');
        }
        GM_setClipboard(exportText, 'text');
        showToast(`已复制 ${capturedFiles.length} 条${currentMode === 'aria' ? 'Aria2命令' : currentMode === 'curl' ? 'cURL命令' : currentMode === 'bc' ? 'BC链接' : '下载链接'}`, '#4CAF50');
    }

    function showRpcSettings() {
        const html = `
            <div style="display:flex; flex-direction:column; gap:10px;">
                <label>RPC域名: <input id="rpc-domain" type="text" value="${rpcConfig.domain}" style="width:100%;"></label>
                <label>端口: <input id="rpc-port" type="text" value="${rpcConfig.port}" style="width:100%;"></label>
                <label>路径: <input id="rpc-path" type="text" value="${rpcConfig.path}" style="width:100%;"></label>
                <label>Token: <input id="rpc-token" type="text" value="${rpcConfig.token}" style="width:100%;"></label>
                <label>保存目录: <input id="rpc-dir" type="text" value="${rpcConfig.dir}" style="width:100%;"></label>
            </div>
        `;
        Swal.fire({
            title: 'RPC 下载器设置',
            html: html,
            confirmButtonText: '保存',
            showCancelButton: true,
            preConfirm: () => {
                const domain = document.getElementById('rpc-domain').value;
                const port = document.getElementById('rpc-port').value;
                const path = document.getElementById('rpc-path').value;
                const token = document.getElementById('rpc-token').value;
                const dir = document.getElementById('rpc-dir').value;
                if (!domain || !port) {
                    Swal.showValidationMessage('域名和端口不能为空');
                    return false;
                }
                rpcConfig.domain = domain;
                rpcConfig.port = port;
                rpcConfig.path = path;
                rpcConfig.token = token;
                rpcConfig.dir = dir;
                saveRpcConfig();
                showToast('RPC配置已保存', '#4CAF50');
                return true;
            }
        });
    }

    // ======================= 网络请求拦截器 =======================
    function installInterceptor() {
        if (interceptorInstalled) return;
        interceptorInstalled = true;

        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            return originalFetch.apply(this, args).then(response => {
                if (isCapturing) {
                    const url = typeof args[0] === 'string' ? args[0] : args[0].url;
                    if (isDownloadApi(url)) {
                        const cloned = response.clone();
                        cloned.json().then(data => processExtractedData(data, getReferer()))
                              .catch(() => cloned.text().then(text => processExtractedData(text, getReferer())));
                    }
                }
                return response;
            });
        };

        const XHR = XMLHttpRequest.prototype;
        const originalOpen = XHR.open;
        const originalSend = XHR.send;
        XHR.open = function(method, url) {
            this._url = url;
            return originalOpen.apply(this, arguments);
        };
        XHR.send = function(body) {
            this.addEventListener('load', () => {
                if (isCapturing && isDownloadApi(this._url)) {
                    try {
                        const ct = this.getResponseHeader('content-type') || '';
                        if (ct.includes('json')) {
                            const data = JSON.parse(this.responseText);
                            processExtractedData(data, getReferer());
                        } else if (ct.includes('text')) {
                            processExtractedData(this.responseText, getReferer());
                        }
                    } catch(e) {}
                }
            });
            return originalSend.apply(this, arguments);
        };

        function isDownloadApi(url) {
            if (!url) return false;
            return CONFIG.apiPatterns.some(p => url.includes(p));
        }

        function processExtractedData(data, referer) {
            const links = extractLinksFromData(data, referer);
            for (let item of links) {
                if (/lanzou[a-z0-9]*\.(com|cn|net)/i.test(item.url)) {
                    parseLanzou(item.url, '').then(directUrl => {
                        if (directUrl) {
                            addCapturedFile(directUrl, extractFilenameFromUrl(directUrl), referer);
                        } else {
                            addCapturedFile(item.url, item.filename, referer);
                        }
                    });
                } else {
                    addCapturedFile(item.url, item.filename, referer);
                }
            }
        }

        function extractLinksFromData(data, referer, depth = 0) {
            if (depth > 3) return [];
            let results = [];
            if (typeof data === 'string') {
                const urlRegex = /https?:\/\/[^\s"'<>]+/g;
                const matches = data.match(urlRegex);
                if (matches) {
                    matches.forEach(url => results.push({ url, filename: '', referer }));
                }
            } else if (typeof data === 'object' && data !== null) {
                for (let key of CONFIG.urlKeys) {
                    if (data[key] && typeof data[key] === 'string' && data[key].startsWith('http')) {
                        let filename = data.filename || data.name || '';
                        results.push({ url: data[key], filename, referer });
                    }
                }
                for (let k in data) {
                    if (data.hasOwnProperty(k)) {
                        results.push(...extractLinksFromData(data[k], referer, depth+1));
                    }
                }
            }
            return results;
        }

        function extractFilenameFromUrl(url) {
            try {
                const urlObj = new URL(url);
                const path = urlObj.pathname.split('/').pop();
                return decodeURIComponent(path.split('?')[0]) || 'file';
            } catch(e) {
                return 'file';
            }
        }

        log('网络拦截器已启动，蓝奏云解析已集成');
    }

    // ======================= 增强页面按钮点击 =======================
    function enhanceButtons() {
        document.body.addEventListener('click', (e) => {
            if (!isCapturing) return;
            let target = e.target.closest('a, button');
            if (!target) return;
            const text = (target.innerText || '').toLowerCase();
            const href = target.href || '';
            if (text.includes('下载') || href.includes('/download') || href.includes('/d/')) {
                if (href && href.startsWith('http')) {
                    if (/lanzou[a-z0-9]*\.(com|cn|net)/i.test(href)) {
                        parseLanzou(href, '').then(directUrl => {
                            if (directUrl) addCapturedFile(directUrl, extractFilenameFromUrl(directUrl), getReferer());
                            else addCapturedFile(href, '', getReferer());
                        });
                    } else {
                        setTimeout(() => addCapturedFile(href, '', getReferer()), 500);
                    }
                }
            }
        });
    }

    // ======================= 样式和菜单 =======================
    GM_addStyle(`
        #ud-panel button {
            border: none;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            transition: 0.2s;
        }
        #ud-panel button:hover { opacity: 0.85; }
        #ud-file-list::-webkit-scrollbar { width: 4px; }
        #ud-file-list::-webkit-scrollbar-thumb { background: #888; border-radius: 4px; }
    `);

    function registerMenu() {
        GM_registerMenuCommand('📋 导出所有链接 (当前模式)', () => {
            if (capturedFiles.length === 0) return showToast('无链接', '#ff9800');
            let text = '';
            if (currentMode === 'aria') text = capturedFiles.map(f => toAria2Command(f)).join('\n');
            else if (currentMode === 'curl') text = capturedFiles.map(f => toCurlCommand(f)).join('\n');
            else if (currentMode === 'bc') text = capturedFiles.map(f => toBCLink(f)).join('\n');
            else text = capturedFiles.map(f => f.url).join('\n');
            GM_setClipboard(text);
            showToast('已复制', '#4CAF50');
        });
        GM_registerMenuCommand('🗑️ 清空所有链接', clearAll);
        GM_registerMenuCommand('⚙️ RPC 设置', showRpcSettings);
        GM_registerMenuCommand('🔄 显示/隐藏面板', () => {
            const p = document.getElementById('ud-panel');
            if (p) p.style.display = p.style.display === 'none' ? 'flex' : 'none';
        });
    }

    // ======================= 初始化 =======================
    function init() {
        loadSettings();
        installInterceptor();
        createPanel();
        enhanceButtons();
        registerMenu();
        log('全能下载助手已启动，支持30+网盘，蓝奏云自动解析');
        showToast('助手已启动，点击下载按钮即可捕获', '#4CAF50', 3000);
    }

    if (typeof Swal === 'undefined') {
        window.Swal = { fire: (opts) => { alert(opts.title || opts.text); return Promise.resolve({}); } };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
