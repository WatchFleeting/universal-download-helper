// ==UserScript==
// @name         全能下载助手 | 网盘+Openlist+AList+WebOS
// @namespace    https://github.com/WatchFleeting/universal-download-helper
// @version      1.1.0
// @author       鸿渚
// @description  自动捕获30+网盘、Openlist、AList、腾飞WebOS直链，支持主动获取网盘API直链。蓝奏云自动解析。支持浏览器/IDM下载、Aria2/cURL命令、BC链接、RPC推送。
// @license      MIT
// @supportURL   https://github.com/WatchFleeting/universal-download-helper/issues
// @homepageURL  https://github.com/WatchFleeting/universal-download-helper
// @updateURL    https://raw.githubusercontent.com/WatchFleeting/universal-download-helper/main/universal-download-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/WatchFleeting/universal-download-helper/main/universal-download-helper.user.js
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?domain=greasyfork.org
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_cookie
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ---------- 配置模块 ----------
    const CONFIG = {
        version: '1.1.0',
        panelLeft: '20px',
        panelTop: '80px',
        debug: true,
        rpcConcurrency: 3,
        apiPatterns: [
            '/api/download', '/api/sharedownload', '/share/download',
            '/v2/file/download', '/v2/share_link/download',
            '/api/v1/file/download', '/api/v2/file/download',
            '/drive/v1/files', '/hcy/file/download',
            '/orchestration/personalCloud/catalog/v1.0/getDisk',
            '/d/', '/down/', '115.com', 'ctfile.com', 'weiyun.com', 'lanzou',
            'yunpan.360.cn', '/f/', 'uc.cn',
            '/api/fs/get', '/api/fs/list', '/api/public/path', '/api/me',
            '/api/public/link', '/api/disk/manage'
        ],
        urlKeys: ['url','download_url','dlink','downloadUrl','link','downurl','web_content_link','downloadURL','urls','real_url','data','raw_url','src'],
        rpc: { domain: 'http://localhost', port: '16800', path: '/jsonrpc', token: '', dir: 'D:/Downloads' },
        supportedDomains: [
            'pan.baidu.com', 'yun.baidu.com', 'www.aliyundrive.com', 'www.alipan.com',
            'cloud.189.cn', 'pan.xunlei.com', 'pan.quark.cn', 'yun.139.com', 'caiyun.139.com',
            'www.123pan.com', 'feijipan.com', 'www.feijipan.com', '115.com', 'ctfile.com',
            'weiyun.com', 'lanzou.com', 'lanzoux.com', 'lanzoui.com', 'lanzous.com', 'lanzouh.com',
            'yunpan.360.cn', 'ws28.cn', 'uc.cn', 'drive.uc.cn'
        ]
    };

    // ---------- 状态模块 ----------
    const state = {
        capturedFiles: [],
        isCapturing: true,
        interceptorInstalled: false,
        currentMode: 'api',
        rpcConfig: { ...CONFIG.rpc },
        panel: null,
        activePan: null          // 当前网盘类型，用于主动获取
    };

    // ---------- 工具函数 ----------
    const log = (...args) => CONFIG.debug && console.log('[全能助手]', ...args);
    const warn = (...args) => CONFIG.debug && console.warn('[全能助手]', ...args);
    const error = (...args) => CONFIG.debug && console.error('[全能助手]', ...args);

    function showToast(message, bgColor = '#333', duration = 2000) {
        let toast = document.getElementById('ud-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'ud-toast';
            toast.style.cssText = `
                position:fixed; bottom:30px; right:30px; background:${bgColor}; color:#fff;
                padding:10px 20px; border-radius:8px; font-size:14px; z-index:10001;
                transition:opacity 0.3s; pointer-events:none;
            `;
            document.body.appendChild(toast);
        }
        toast.style.backgroundColor = bgColor;
        toast.textContent = message;
        toast.style.opacity = '1';
        clearTimeout(window.toastTimeout);
        window.toastTimeout = setTimeout(() => toast.style.opacity = '0', duration);
    }

    function getReferer() { return location.href; }

    function extractFilenameFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname.split('/').pop();
            return decodeURIComponent(path.split('?')[0]) || 'file';
        } catch(e) { return 'file'; }
    }

    function sanitizeFilename(name) {
        return name.replace(/[\\/:*?"<>|]/g, '_');
    }

    function loadSettings() {
        try {
            const saved = GM_getValue('capturedFiles', null);
            if (saved) state.capturedFiles = JSON.parse(saved);
            const savedRpc = GM_getValue('rpcConfig', null);
            if (savedRpc) Object.assign(state.rpcConfig, JSON.parse(savedRpc));
        } catch(e) { warn('加载设置失败', e); }
        updateLinkCount();
    }

    function saveCapturedFiles() {
        try { GM_setValue('capturedFiles', JSON.stringify(state.capturedFiles)); } catch(e) { warn('保存失败', e); }
    }

    function saveRpcConfig() {
        try { GM_setValue('rpcConfig', JSON.stringify(state.rpcConfig)); } catch(e) { warn('保存RPC失败', e); }
    }

    // ---------- 页面特征检测 ----------
    function detectPanType() {
        const host = location.hostname;
        if (/pan\.baidu\.com|yun\.baidu\.com/.test(host)) return 'baidu';
        if (/aliyundrive\.com|alipan\.com/.test(host)) return 'ali';
        if (/cloud\.189\.cn/.test(host)) return 'tianyi';
        if (/pan\.xunlei\.com/.test(host)) return 'xunlei';
        if (/pan\.quark\.cn/.test(host)) return 'quark';
        if (/yun\.139\.com|caiyun\.139\.com/.test(host)) return 'yidong';
        return null;
    }

    function isSupportedPage() {
        const host = location.hostname;
        // 白名单
        if (CONFIG.supportedDomains.some(d => host === d || host.endsWith('.' + d))) return true;
        // Openlist
        if (/Index of \/|目录列表|Directory listing|文件列表/i.test(document.title)) return true;
        const h1 = document.querySelector('h1');
        if (h1 && /index of|目录列表|directory listing/i.test(h1.textContent)) return true;
        const table = document.querySelector('table');
        if (table) {
            const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.toLowerCase());
            if (headers.some(h => /name|file|last modified/i.test(h))) return true;
        }
        const pre = document.querySelector('pre');
        if (pre && pre.querySelectorAll('a[href]').length > 3) return true;
        if (document.querySelector('.filelist, #files, [class*="file-list"], [class*="directory-listing"]')) return true;
        // AList
        if (document.querySelector('#app') && (document.querySelector('[class*="hope"]') || document.querySelector('.hope-ui-dark'))) return true;
        const generator = document.querySelector('meta[name="generator"]');
        if (generator && /alist/i.test(generator.content)) return true;
        if (window.AList || window.AListConfig) return true;
        // WebOS
        if (document.querySelector('[class*="start"], [class*="taskbar"], [class*="win11"], [class*="this-pc"]')) return true;
        const title = document.querySelector('title');
        if (title && /腾飞|webos|私有云/i.test(title.textContent)) return true;
        if (document.querySelector('meta[name="generator"]')?.content.match(/腾飞|webos/i)) return true;
        return false;
    }

    function isOpenlistPage() {
        return /Index of \/|目录列表/i.test(document.title) ||
               (document.querySelector('h1') && /index of/i.test(document.querySelector('h1').textContent)) ||
               (document.querySelector('pre') && document.querySelectorAll('pre a[href]').length > 3);
    }

    // ---------- 链接管理 ----------
    function addCapturedFile(url, filename = '', referer = '', size = '') {
        if (!url || !url.startsWith('http')) return false;
        if (state.capturedFiles.some(f => f.url === url)) return false;
        if (!filename) filename = extractFilenameFromUrl(url);
        state.capturedFiles.push({ url, filename, referer, size });
        saveCapturedFiles();
        updateLinkCount();
        renderFileList();
        log('捕获:', filename, url);
        showToast(`✓ 已捕获: ${filename.substring(0, 30)}`, '#4CAF50');
        return true;
    }

    function removeFile(index) {
        if (index >= 0 && index < state.capturedFiles.length) {
            const removed = state.capturedFiles.splice(index, 1)[0];
            saveCapturedFiles();
            updateLinkCount();
            renderFileList();
            showToast(`已移除: ${removed.filename}`, '#f44336');
        }
    }

    function clearAll() {
        state.capturedFiles = [];
        saveCapturedFiles();
        updateLinkCount();
        renderFileList();
        showToast('已清空所有链接', '#f44336');
    }

    function updateLinkCount() {
        const cnt = document.getElementById('ud-link-count');
        if (cnt) cnt.textContent = state.capturedFiles.length;
    }

    // ---------- 蓝奏云解析 ----------
    async function parseLanzou(shareUrl, pwd = '', retry = 0) {
        const MAX_RETRY = 2;
        try {
            let url = shareUrl.trim();
            if (!url.startsWith('http')) url = 'https://' + url;
            const urlObj = new URL(url);
            let baseDomain = urlObj.hostname;

            const getHtml = (u) => new Promise(r => {
                GM_xmlhttpRequest({
                    method: 'GET', url: u,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                    onload: res => r(res.responseText),
                    onerror: () => r(null),
                    timeout: 10000
                });
            });

            let html = await getHtml(url);
            if (!html) {
                if (retry < MAX_RETRY) return parseLanzou(shareUrl, pwd, retry + 1);
                return null;
            }

            let sign = (html.match(/var skdklds\s*=\s*'([^']+)'/) || [])[1] ||
                       (html.match(/var\s+sign\s*=\s*'([^']+)'/) || [])[1] ||
                       (html.match(/sign\s*:\s*'([^']+)'/) || [])[1] || '';
            let pwdParam = pwd || (html.match(/var\s+pwd\s*=\s*'([^']+)'/) || [])[1] || '';

            const postData = new URLSearchParams();
            postData.append('action', 'downprocess');
            postData.append('sign', sign);
            if (pwdParam) postData.append('p', pwdParam);
            const kMatch = html.match(/k\s*:\s*'([^']+)'/);
            if (kMatch) postData.append('k', kMatch[1]);

            const ajaxUrl = `https://${baseDomain}/ajaxm.php`;
            const resp = await new Promise(r => {
                GM_xmlhttpRequest({
                    method: 'POST', url: ajaxUrl,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    data: postData.toString(),
                    onload: res => { try { r(JSON.parse(res.responseText)); } catch(e) { r(null); } },
                    onerror: () => r(null),
                    timeout: 10000
                });
            });

            if (resp && resp.zt === 1) {
                let dom = resp.dom, fileUrl = resp.url;
                if (dom && fileUrl) {
                    return `https://${dom}/file/${fileUrl}` + (resp.inf?.t ? `?t=${resp.inf.t}` : '');
                }
                if (resp.url) return resp.url;
            }
            const folderMatch = html.match(/data\s*:\s*(\{.*?\})/s);
            if (folderMatch) {
                try {
                    const folderData = JSON.parse(folderMatch[1]);
                    if (folderData?.text?.length) {
                        const firstFile = folderData.text[0];
                        return await parseLanzou(`https://${baseDomain}/${firstFile.id}`, pwdParam);
                    }
                } catch(e) {}
            }
            return null;
        } catch(e) {
            error('蓝奏云解析异常', e);
            if (retry < MAX_RETRY) return parseLanzou(shareUrl, pwd, retry + 1);
            return null;
        }
    }

    // ---------- 链接扫描 ----------
    function scanOpenlistLinks() {
        if (!isOpenlistPage()) { showToast('非Openlist页面', '#ff9800'); return; }
        const links = document.querySelectorAll('a[href]');
        const base = location.href;
        let cnt = 0;
        links.forEach(a => {
            const href = a.getAttribute('href');
            if (!href || href === '../' || href === './' || href === '/' || href.startsWith('?')) return;
            try {
                const full = new URL(href, base).href;
                if (full.endsWith('/')) return;
                const fname = a.textContent.trim() || extractFilenameFromUrl(full);
                if (addCapturedFile(full, decodeURIComponent(fname), location.href)) cnt++;
            } catch(e) {}
        });
        showToast(cnt ? `已捕获 ${cnt} 个文件` : '未发现新链接', cnt ? '#4CAF50' : '#ff9800');
    }

    function scanPageLinks() {
        const selectors = [
            'a[href*="/d/"]', 'a[href*="/file/"]', 'a[href*="/download"]',
            '[data-url]', '[data-raw-url]', '[data-download-url]', '[data-link]', '[data-clipboard-text]'
        ];
        let cnt = 0;
        document.querySelectorAll(selectors.join(',')).forEach(el => {
            const url = el.href || el.getAttribute('data-url') || el.getAttribute('data-raw-url') ||
                        el.getAttribute('data-download-url') || el.getAttribute('data-link') || el.getAttribute('data-clipboard-text');
            if (url && url.startsWith('http') && !state.capturedFiles.some(f => f.url === url)) {
                const fname = el.textContent.trim() || el.getAttribute('data-filename') || extractFilenameFromUrl(url);
                if (addCapturedFile(url, fname, location.href)) cnt++;
            }
        });
        showToast(cnt ? `扫描到 ${cnt} 个链接` : '未发现新链接', cnt ? '#4CAF50' : '#ff9800');
    }

    // ---------- 批量导入 ----------
    function batchImportLinks() {
        const dlg = document.createElement('div');
        dlg.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:#2a2a3a;color:#fff;padding:20px;border-radius:12px;z-index:10002;box-shadow:0 0 20px #000;width:500px;';
        dlg.innerHTML = `
            <h3 style="margin-top:0;">批量导入链接</h3>
            <p style="font-size:12px;color:#aaa;">每行一个链接，可附带文件名（空格或制表符分隔）</p>
            <textarea id="ud-batch-textarea" style="width:100%;height:200px;background:#1a1a2a;color:#fff;border:1px solid #444;border-radius:4px;padding:8px;font-family:monospace;resize:vertical;" placeholder="https://..."></textarea>
            <div style="margin-top:15px;text-align:right;">
                <button id="ud-batch-import-confirm" style="background:#4CAF50;border:none;color:#fff;padding:6px 16px;border-radius:4px;margin-right:8px;">导入</button>
                <button id="ud-batch-import-cancel" style="background:#f44336;border:none;color:#fff;padding:6px 16px;border-radius:4px;">取消</button>
            </div>
        `;
        document.body.appendChild(dlg);
        dlg.querySelector('#ud-batch-import-cancel').onclick = () => dlg.remove();
        dlg.querySelector('#ud-batch-import-confirm').onclick = () => {
            const raw = dlg.querySelector('#ud-batch-textarea').value;
            const lines = raw.split('\n');
            let added = 0;
            lines.forEach(line => {
                line = line.trim();
                if (!line || !line.startsWith('http')) return;
                const parts = line.split(/\s+/);
                const url = parts[0];
                const filename = parts.slice(1).join(' ') || '';
                if (addCapturedFile(url, filename, getReferer())) added++;
            });
            showToast(`成功导入 ${added} 条链接`, '#4CAF50');
            dlg.remove();
        };
    }

    function manualAddLink() {
        const url = prompt('请输入文件直链 (http/https):');
        if (!url) return;
        const filename = prompt('请输入文件名 (可选):', extractFilenameFromUrl(url));
        addCapturedFile(url, filename || '', location.href);
    }

    // ---------- 导出与RPC ----------
    function toAria2Command(f) {
        return `aria2c "${f.url}" --out "${sanitizeFilename(f.filename)}"` + (f.referer ? ` --header "Referer: ${f.referer}"` : '');
    }
    function toCurlCommand(f) {
        return `curl -L -C - "${f.url}" -o "${sanitizeFilename(f.filename)}"` + (f.referer ? ` -e "${f.referer}"` : '');
    }
    function toBCLink(f) {
        let enc = encodeURIComponent(f.filename);
        let data = `AA/${enc}/?url=${encodeURIComponent(f.url)}`;
        if (f.referer) data += `&refer=${encodeURIComponent(f.referer)}`;
        data += 'ZZ';
        return `bc://http/${btoa(unescape(encodeURIComponent(data)))}`;
    }

    async function sendToRPC(file) {
        const { domain, port, path, token, dir } = state.rpcConfig;
        const url = `${domain}:${port}${path}`;
        let headers = [];
        if (file.referer) headers.push(`Referer: ${file.referer}`);
        if (state.activePan === 'baidu') {
            const bduss = await getBaiduBDUSS();
            if (bduss) headers.push(`Cookie: BDUSS=${bduss}`);
            headers.push(`User-Agent: netdisk`);
        } else if (state.activePan === 'ali') {
            headers.push(`Referer: https://www.aliyundrive.com/`);
        } else if (state.activePan === 'quark') {
            headers.push(`Cookie: ${document.cookie}`);
        }
        const payload = {
            id: Date.now() + Math.random(),
            jsonrpc: '2.0',
            method: 'aria2.addUri',
            params: [`token:${token}`, [file.url], {
                dir: dir,
                out: file.filename,
                header: headers
            }]
        };
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'POST', url, headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify(payload),
                onload: res => { try { resolve(!!JSON.parse(res.response).result); } catch(e) { resolve(false); } },
                onerror: () => resolve(false),
                timeout: 15000
            });
        });
    }

    async function batchSendToRPC() {
        if (!state.capturedFiles.length) { showToast('列表为空', '#ff9800'); return; }
        const total = state.capturedFiles.length;
        let success = 0, failed = 0;
        showToast(`开始批量推送 ${total} 个任务`, '#2196F3');

        const queue = [...state.capturedFiles];
        const workers = Array(CONFIG.rpcConcurrency).fill().map(async () => {
            while (queue.length) {
                const file = queue.shift();
                const ok = await sendToRPC(file);
                if (ok) success++; else failed++;
            }
        });
        await Promise.all(workers);
        showToast(`批量推送完成：成功 ${success}，失败 ${failed}`, success === total ? '#4CAF50' : '#ff9800');
    }

    function directDownload(file) {
        const a = document.createElement('a');
        a.href = file.url;
        a.download = file.filename;
        a.click();
    }

    // ---------- 网盘主动获取直链 (核心增强) ----------
    async function fetchPanLinks() {
        const panType = detectPanType();
        if (!panType) { showToast('当前页面非已知网盘', '#ff9800'); return; }
        state.activePan = panType;
        showToast(`正在获取 ${panType} 直链...`, '#2196F3');

        try {
            let files = [];
            if (panType === 'baidu') files = await fetchBaiduLinks();
            else if (panType === 'ali') files = await fetchAliLinks();
            else if (panType === 'tianyi') files = await fetchTianyiLinks();
            else if (panType === 'xunlei') files = await fetchXunleiLinks();
            else if (panType === 'quark') files = await fetchQuarkLinks();
            else if (panType === 'yidong') files = await fetchYidongLinks();

            if (files.length === 0) {
                showToast('未获取到任何文件，请确认已选中文件', '#ff9800');
                return;
            }
            files.forEach(f => addCapturedFile(f.url, f.filename, f.referer, f.size));
            showToast(`成功获取 ${files.length} 个直链`, '#4CAF50');
        } catch (e) {
            error('获取网盘直链失败', e);
            showToast('获取失败，请刷新或检查登录状态', '#f44336');
        }
    }

    // 百度网盘 (需 BDUSS)
    async function getBaiduBDUSS() {
        return new Promise(resolve => {
            if (typeof GM_cookie !== 'undefined') {
                GM_cookie('list', {name: 'BDUSS', url: location.origin}, (cookies) => {
                    resolve(cookies?.[0]?.value || '');
                });
            } else {
                const match = document.cookie.match(/BDUSS=([^;]+)/);
                resolve(match ? match[1] : '');
            }
        });
    }

    async function fetchBaiduLinks() {
        // 简化示例，实际需根据页面类型调用不同API
        showToast('百度网盘主动获取功能开发中，请使用通用捕获', '#ff9800');
        return [];
    }

    async function fetchAliLinks() {
        // 阿里云盘
        showToast('阿里云盘主动获取功能开发中，请使用通用捕获', '#ff9800');
        return [];
    }

    async function fetchTianyiLinks() {
        // 天翼云盘
        showToast('天翼云盘主动获取功能开发中，请使用通用捕获', '#ff9800');
        return [];
    }

    async function fetchXunleiLinks() {
        // 迅雷云盘
        showToast('迅雷云盘主动获取功能开发中，请使用通用捕获', '#ff9800');
        return [];
    }

    async function fetchQuarkLinks() {
        // 夸克网盘
        showToast('夸克网盘主动获取功能开发中，请使用通用捕获', '#ff9800');
        return [];
    }

    async function fetchYidongLinks() {
        // 移动云盘
        showToast('移动云盘主动获取功能开发中，请使用通用捕获', '#ff9800');
        return [];
    }

    // ---------- UI渲染 ----------
    function renderFileList() {
        const container = document.getElementById('ud-file-list');
        if (!container) return;
        if (!state.capturedFiles.length) {
            container.innerHTML = '<div style="text-align:center;color:#aaa;padding:10px;">暂无捕获的链接</div>';
            return;
        }
        let html = '';
        state.capturedFiles.forEach((f, i) => {
            let act = '';
            if (state.currentMode === 'api') act = `<button class="ud-dl" data-i="${i}" style="background:#4CAF50;">⬇️下载</button>`;
            else if (state.currentMode === 'aria') act = `<button class="ud-copy" data-i="${i}" data-t="aria" style="background:#2196F3;">📋复制</button>`;
            else if (state.currentMode === 'curl') act = `<button class="ud-copy" data-i="${i}" data-t="curl" style="background:#2196F3;">📋复制</button>`;
            else if (state.currentMode === 'bc') act = `<button class="ud-copy" data-i="${i}" data-t="bc" style="background:#9C27B0;">📋复制</button>`;
            else if (state.currentMode === 'rpc') act = `<button class="ud-rpc" data-i="${i}" style="background:#FF5722;">🚀推送</button>`;
            html += `
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;padding:4px;background:rgba(255,255,255,0.1);border-radius:4px;">
                    <span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${f.filename}">📄 ${f.filename}</span>
                    <button class="ud-remove" data-i="${i}" style="background:#f44336;margin-right:4px;">✖</button>
                    ${act}
                </div>
            `;
        });
        container.innerHTML = html;

        container.querySelectorAll('.ud-remove').forEach(btn => {
            btn.onclick = () => removeFile(parseInt(btn.dataset.i));
        });
        container.querySelectorAll('.ud-dl').forEach(btn => {
            btn.onclick = () => directDownload(state.capturedFiles[btn.dataset.i]);
        });
        container.querySelectorAll('.ud-copy').forEach(btn => {
            btn.onclick = () => {
                const f = state.capturedFiles[btn.dataset.i];
                let txt = btn.dataset.t === 'aria' ? toAria2Command(f) :
                          btn.dataset.t === 'curl' ? toCurlCommand(f) : toBCLink(f);
                GM_setClipboard(txt);
                showToast('已复制', '#4CAF50');
            };
        });
        container.querySelectorAll('.ud-rpc').forEach(btn => {
            btn.onclick = async () => {
                const f = state.capturedFiles[btn.dataset.i];
                btn.textContent = '⏳'; btn.disabled = true;
                const ok = await sendToRPC(f);
                showToast(ok ? '推送成功' : '推送失败', ok ? '#4CAF50' : '#f44336');
                btn.textContent = '🚀推送'; btn.disabled = false;
            };
        });
    }

    function batchExport() {
        if (!state.capturedFiles.length) { showToast('无链接', '#ff9800'); return; }
        let txt = '';
        if (state.currentMode === 'aria') txt = state.capturedFiles.map(toAria2Command).join('\n');
        else if (state.currentMode === 'curl') txt = state.capturedFiles.map(toCurlCommand).join('\n');
        else if (state.currentMode === 'bc') txt = state.capturedFiles.map(toBCLink).join('\n');
        else if (state.currentMode === 'rpc') return showToast('请使用批量RPC推送', '#ff9800');
        else txt = state.capturedFiles.map(f => f.url).join('\n');
        GM_setClipboard(txt);
        showToast(`已导出 ${state.capturedFiles.length} 条`, '#4CAF50');
    }

    function showRpcSettings() {
        const dlg = document.createElement('div');
        dlg.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:#2a2a3a;color:#fff;padding:20px;border-radius:12px;z-index:10002;box-shadow:0 0 20px #000;';
        dlg.innerHTML = `
            <h3>RPC设置</h3>
            <div style="display:flex;flex-direction:column;gap:8px;">
                <label>域名: <input id="rpc-domain" value="${state.rpcConfig.domain}"></label>
                <label>端口: <input id="rpc-port" value="${state.rpcConfig.port}"></label>
                <label>路径: <input id="rpc-path" value="${state.rpcConfig.path}"></label>
                <label>Token: <input id="rpc-token" value="${state.rpcConfig.token}"></label>
                <label>目录: <input id="rpc-dir" value="${state.rpcConfig.dir}"></label>
            </div>
            <div style="margin-top:15px;text-align:right;">
                <button id="rpc-save" style="background:#4CAF50;border:none;color:#fff;padding:6px 16px;border-radius:4px;margin-right:8px;">保存</button>
                <button id="rpc-cancel" style="background:#f44336;border:none;color:#fff;padding:6px 16px;border-radius:4px;">取消</button>
            </div>
        `;
        document.body.appendChild(dlg);
        dlg.querySelector('#rpc-save').onclick = () => {
            state.rpcConfig.domain = dlg.querySelector('#rpc-domain').value;
            state.rpcConfig.port = dlg.querySelector('#rpc-port').value;
            state.rpcConfig.path = dlg.querySelector('#rpc-path').value;
            state.rpcConfig.token = dlg.querySelector('#rpc-token').value;
            state.rpcConfig.dir = dlg.querySelector('#rpc-dir').value;
            saveRpcConfig();
            showToast('RPC配置已保存', '#4CAF50');
            dlg.remove();
        };
        dlg.querySelector('#rpc-cancel').onclick = () => dlg.remove();
    }

    function createPanel() {
        if (document.getElementById('ud-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'ud-panel';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <strong style="cursor:help;" id="ud-debug-info">⚡ 全能下载助手</strong>
                <span id="ud-link-count" style="background:#2196F3;padding:2px 8px;border-radius:20px;">0</span>
            </div>
            <select id="ud-mode-select" style="width:100%;padding:4px;border-radius:4px;margin-bottom:8px;">
                <option value="api">🌐 直接下载</option>
                <option value="aria">⬇️ Aria2命令</option>
                <option value="curl">📜 cURL命令</option>
                <option value="bc">🐿️ BC链接</option>
                <option value="rpc">🚀 RPC推送</option>
            </select>
            <div id="ud-file-list" style="max-height:300px;overflow-y:auto;font-size:12px;margin-bottom:8px;"></div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
                <button id="ud-batch-export" style="flex:1;background:#4CAF50;">📋导出</button>
                <button id="ud-clear-all" style="flex:1;background:#f44336;">🗑️清空</button>
                <button id="ud-settings" style="flex:1;background:#607d8b;">⚙️RPC</button>
                <button id="ud-scan-page" style="flex:1;background:#9C27B0;">🔍扫描</button>
                <button id="ud-fetch-pan" style="flex:1;background:#00BCD4;">📥获取网盘</button>
                <button id="ud-batch-import" style="flex:1;background:#00BCD4;">📥导入</button>
                <button id="ud-batch-rpc" style="flex:1;background:#E91E63;">🚀批量RPC</button>
                <button id="ud-manual-add" style="flex:1;background:#FF9800;">➕手动</button>
                <button id="ud-toggle-capture" style="flex:1;background:#ff9800;">⏸️暂停</button>
            </div>
            <div id="ud-drag-handle" style="position:absolute;top:0;left:0;right:0;height:24px;cursor:move;background:rgba(0,0,0,0.1);border-radius:8px 8px 0 0;"></div>
        `;
        panel.style.cssText = `
            position:fixed; left:${CONFIG.panelLeft}; top:${CONFIG.panelTop}; width:400px;
            background:rgba(30,30,40,0.95); color:#fff; border-radius:12px; padding:12px;
            font-size:13px; z-index:10000; box-shadow:0 4px 15px rgba(0,0,0,0.4);
            backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,0.2); user-select:none;
        `;
        document.body.appendChild(panel);
        state.panel = panel;

        document.getElementById('ud-debug-info').onclick = () => {
            console.log('[调试] URL:', location.href, '特征:', isSupportedPage(), 'Openlist:', isOpenlistPage());
            showToast('调试信息已输出到控制台', '#2196F3');
        };
        document.getElementById('ud-mode-select').onchange = e => { state.currentMode = e.target.value; renderFileList(); };
        document.getElementById('ud-batch-export').onclick = batchExport;
        document.getElementById('ud-clear-all').onclick = clearAll;
        document.getElementById('ud-settings').onclick = showRpcSettings;
        document.getElementById('ud-scan-page').onclick = scanPageLinks;
        document.getElementById('ud-fetch-pan').onclick = fetchPanLinks;
        document.getElementById('ud-batch-import').onclick = batchImportLinks;
        document.getElementById('ud-batch-rpc').onclick = batchSendToRPC;
        document.getElementById('ud-manual-add').onclick = manualAddLink;
        const toggle = document.getElementById('ud-toggle-capture');
        toggle.onclick = () => {
            state.isCapturing = !state.isCapturing;
            toggle.textContent = state.isCapturing ? '⏸️暂停' : '▶️开始';
            toggle.style.background = state.isCapturing ? '#ff9800' : '#607d8b';
        };

        // 拖拽
        let dragging = false, startX, startY, startLeft, startTop;
        const handle = document.getElementById('ud-drag-handle');
        handle.onmousedown = e => {
            if (e.button !== 0) return;
            dragging = true;
            startX = e.clientX; startY = e.clientY;
            startLeft = parseInt(panel.style.left); startTop = parseInt(panel.style.top);
            panel.style.transition = 'none';
            e.preventDefault();
        };
        window.addEventListener('mousemove', e => {
            if (!dragging) return;
            let l = startLeft + e.clientX - startX, t = startTop + e.clientY - startY;
            panel.style.left = Math.min(Math.max(0, l), innerWidth - panel.offsetWidth) + 'px';
            panel.style.top = Math.min(Math.max(0, t), innerHeight - panel.offsetHeight) + 'px';
        });
        window.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                panel.style.transition = '';
                GM_setValue('panelLeft', panel.style.left);
                GM_setValue('panelTop', panel.style.top);
            }
        });
        const savedLeft = GM_getValue('panelLeft'), savedTop = GM_getValue('panelTop');
        if (savedLeft && savedTop) { panel.style.left = savedLeft; panel.style.top = savedTop; }

        renderFileList();
    }

    // ---------- 网络拦截 ----------
    function installInterceptor() {
        if (state.interceptorInstalled) return;
        state.interceptorInstalled = true;

        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            return originalFetch.apply(this, args).then(resp => {
                if (state.isCapturing) {
                    const url = typeof args[0] === 'string' ? args[0] : args[0].url;
                    if (CONFIG.apiPatterns.some(p => url.includes(p))) {
                        const clone = resp.clone();
                        clone.json().then(d => processData(d, getReferer()))
                             .catch(() => clone.text().then(t => processData(t, getReferer())));
                    }
                }
                return resp;
            });
        };

        const XHR = XMLHttpRequest.prototype;
        const open = XHR.open, send = XHR.send;
        XHR.open = function(method, url) {
            this._url = url;
            return open.apply(this, arguments);
        };
        XHR.send = function(body) {
            this.addEventListener('load', () => {
                if (state.isCapturing && CONFIG.apiPatterns.some(p => this._url.includes(p))) {
                    try {
                        const ct = this.getResponseHeader('content-type') || '';
                        if (ct.includes('json')) processData(JSON.parse(this.responseText), getReferer());
                        else if (ct.includes('text')) processData(this.responseText, getReferer());
                    } catch(e) {}
                }
            });
            return send.apply(this, arguments);
        };
        log('网络拦截器已安装');
    }

    function processData(data, referer) {
        const links = extractLinks(data, referer);
        links.forEach(item => {
            if (/lanzou[a-z0-9]*\.(com|cn|net)/i.test(item.url)) {
                parseLanzou(item.url).then(direct => {
                    if (direct) addCapturedFile(direct, extractFilenameFromUrl(direct), referer);
                    else addCapturedFile(item.url, item.filename, referer);
                });
            } else {
                addCapturedFile(item.url, item.filename, referer);
            }
        });
    }

    function extractLinks(data, referer, depth = 0) {
        if (depth > 3) return [];
        let results = [];
        if (typeof data === 'string') {
            const urls = data.match(/https?:\/\/[^\s"'<>]+/g) || [];
            urls.forEach(u => results.push({ url: u, filename: '', referer }));
        } else if (data && typeof data === 'object') {
            if (data.code === 200 && data.data) {
                if (data.data.raw_url || data.data.download_url) {
                    let u = data.data.raw_url || data.data.download_url;
                    let n = data.data.name || data.data.filename || '';
                    results.push({ url: u, filename: n, referer });
                }
                if (Array.isArray(data.data.files)) {
                    data.data.files.forEach(f => {
                        let u = f.raw_url || f.download_url || f.url;
                        if (u) results.push({ url: u, filename: f.name, referer });
                    });
                }
            }
            CONFIG.urlKeys.forEach(k => {
                if (data[k] && typeof data[k] === 'string' && data[k].startsWith('http')) {
                    results.push({ url: data[k], filename: data.filename || data.name || '', referer });
                }
            });
            for (let k in data) if (data.hasOwnProperty(k)) results.push(...extractLinks(data[k], referer, depth + 1));
        }
        return results;
    }

    function enhanceButtons() {
        document.body.addEventListener('click', e => {
            if (!state.isCapturing) return;
            const target = e.target.closest('a, button, [role="menuitem"]');
            if (!target) return;
            const href = target.href || target.getAttribute('data-url') || target.getAttribute('data-href') || '';
            const text = (target.innerText || '').toLowerCase();

            if (text.includes('下载') || href.includes('/download') || href.includes('/d/')) {
                if (href.startsWith('http')) {
                    if (/lanzou/.test(href)) {
                        parseLanzou(href).then(d => {
                            if (d) addCapturedFile(d, extractFilenameFromUrl(d), getReferer());
                            else addCapturedFile(href, '', getReferer());
                        });
                    } else {
                        addCapturedFile(href, '', getReferer());
                    }
                }
            }

            if (isOpenlistPage() && href.startsWith('http') && !href.endsWith('/')) {
                if (!state.capturedFiles.some(f => f.url === href)) {
                    addCapturedFile(href, target.textContent.trim() || extractFilenameFromUrl(href), location.href);
                }
            }

            if (text.includes('复制链接') || text.includes('永久链接')) {
                if (href) addCapturedFile(href, extractFilenameFromUrl(href), getReferer());
                else navigator.clipboard?.readText().then(txt => {
                    if (txt.startsWith('http')) addCapturedFile(txt, extractFilenameFromUrl(txt), getReferer());
                }).catch(() => {});
            }

            const rawUrl = target.getAttribute('data-raw-url') || target.getAttribute('data-download-url') || href;
            if ((text.includes('下载') || target.getAttribute('aria-label')?.includes('下载')) && rawUrl) {
                addCapturedFile(rawUrl, target.getAttribute('data-filename') || extractFilenameFromUrl(rawUrl), getReferer());
                e.preventDefault();
            }
        });
    }

    // ---------- 菜单与样式 ----------
    GM_addStyle(`
        #ud-panel button { border:none; color:#fff; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px; }
        #ud-panel button:hover { opacity:0.85; }
        #ud-file-list::-webkit-scrollbar { width:4px; }
        #ud-file-list::-webkit-scrollbar-thumb { background:#888; border-radius:4px; }
    `);

    function registerMenu() {
        GM_registerMenuCommand('📋 导出所有链接', batchExport);
        GM_registerMenuCommand('🗑️ 清空所有链接', clearAll);
        GM_registerMenuCommand('⚙️ RPC设置', showRpcSettings);
        GM_registerMenuCommand('🔍 扫描Openlist', scanOpenlistLinks);
        GM_registerMenuCommand('🔎 扫描页面链接', scanPageLinks);
        GM_registerMenuCommand('📥 批量导入链接', batchImportLinks);
        GM_registerMenuCommand('🚀 批量RPC推送', batchSendToRPC);
        GM_registerMenuCommand('🔄 显示/隐藏面板', () => {
            if (state.panel) state.panel.style.display = state.panel.style.display === 'none' ? 'block' : 'none';
        });
        GM_registerMenuCommand('🚀 强制激活', forceActivate);
    }

    function forceActivate() {
        if (state.panel) return showToast('面板已激活');
        loadSettings();
        createPanel();
        installInterceptor();
        enhanceButtons();
        registerMenu();
        showToast('强制激活成功', '#4CAF50');
        if (isOpenlistPage()) setTimeout(scanOpenlistLinks, 1000);
    }

    // ---------- 初始化 ----------
    function init() {
        if (!isSupportedPage()) {
            registerMenu();
            return;
        }
        loadSettings();
        installInterceptor();
        createPanel();
        enhanceButtons();
        registerMenu();
        if (isOpenlistPage()) setTimeout(scanOpenlistLinks, 1500);
        log(`全能下载助手 v${CONFIG.version} 已启动`);
        showToast('助手已启动', '#4CAF50', 2000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
