// ==UserScript==
// @name         全能下载助手 | 网盘+Openlist+AList+WebOS
// @namespace    https://github.com/WatchFleeting/universal-download-helper
// @version      1.2.0
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
        version: '1.2.0',
        panelLeft: '20px',
        panelTop: '80px',
        debug: true,
        maxConcurrent: 3,                // 并发请求数限制
        themeColor: '#09AAFF',
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
        activePan: null
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
            const savedColor = GM_getValue('themeColor', null);
            if (savedColor) CONFIG.themeColor = savedColor;
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
        if (/www\.123pan\.com/.test(host)) return '123pan';
        if (/lanzou[a-z]*\.(com|cn|net)/.test(host)) return 'lanzou';
        if (/drive\.uc\.cn|pan\.uc\.cn/.test(host)) return 'uc';
        if (/115\.com/.test(host)) return '115';
        return null;
    }

    function isSupportedPage() {
        const host = location.hostname;
        if (CONFIG.supportedDomains.some(d => host === d || host.endsWith('.' + d))) return true;
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
        if (document.querySelector('#app') && (document.querySelector('[class*="hope"]') || document.querySelector('.hope-ui-dark'))) return true;
        const generator = document.querySelector('meta[name="generator"]');
        if (generator && /alist/i.test(generator.content)) return true;
        if (window.AList || window.AListConfig) return true;
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
        dlg.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:#fff;color:#333;padding:20px;border-radius:12px;z-index:10002;box-shadow:0 0 20px rgba(0,0,0,0.2);width:500px;';
        dlg.innerHTML = `
            <h3 style="margin-top:0; color:${CONFIG.themeColor};">批量导入链接</h3>
            <p style="font-size:12px;color:#666;">每行一个链接，可附带文件名（空格或制表符分隔）</p>
            <textarea id="ud-batch-textarea" style="width:100%;height:200px;background:#fafafa;color:#333;border:1px solid #ddd;border-radius:6px;padding:8px;font-family:monospace;resize:vertical;" placeholder="https://..."></textarea>
            <div style="margin-top:15px;text-align:right;">
                <button id="ud-batch-import-confirm" style="background:${CONFIG.themeColor};border:none;color:#fff;padding:6px 16px;border-radius:6px;margin-right:8px;">导入</button>
                <button id="ud-batch-import-cancel" style="background:#f44336;border:none;color:#fff;padding:6px 16px;border-radius:6px;">取消</button>
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
        const workers = Array(CONFIG.maxConcurrent).fill().map(async () => {
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

    // ---------- 网盘主动获取核心模块 (v1.2.0 增强) ----------
    async function getBaiduBDUSS() {
        if (typeof GM_cookie !== 'undefined') {
            return new Promise(resolve => {
                GM_cookie('list', {name: 'BDUSS', url: location.origin}, (cookies) => {
                    resolve(cookies?.[0]?.value || '');
                });
            });
        } else {
            const match = document.cookie.match(/BDUSS=([^;]+)/);
            return match ? match[1] : '';
        }
    }

    // 辅助函数：获取各网盘选中项（完整实现）
    function getSelectedItemsForBaidu() {
        try {
            if (document.querySelector('.wp-s-core-pan')) {
                const vue = document.querySelector('.wp-s-core-pan').__vue__;
                if (vue && vue.selectedList) {
                    return vue.selectedList.filter(f => f.isdir === 0);
                }
            }
            if (window.require) {
                const context = require('system-core:context/context.js').instanceForSystem;
                return context.list.getSelected().filter(f => f.isdir === 0);
            }
        } catch (e) { error('百度网盘获取选中项失败', e); }
        return [];
    }

    function getSelectedItemsForAli() {
        try {
            const listDom = document.querySelector('[class*="list"]');
            if (!listDom) return [];
            const key = Object.keys(listDom).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            if (!key) return [];
            const fiber = listDom[key];
            let props = fiber.pendingProps;
            if (!props) return [];
            const dataSource = props.dataSource || [];
            const selectedKeys = props.selectedKeys || [];
            return dataSource.filter(f => selectedKeys.includes(f.file_id) && f.type === 'file');
        } catch (e) { error('阿里云盘获取选中项失败', e); }
        return [];
    }

    function getSelectedItemsForTianyi() {
        try {
            if (document.querySelector('.c-file-list')?.__vue__) {
                const vue = document.querySelector('.c-file-list').__vue__;
                return vue.selectedList.filter(f => !f.isFolder);
            }
            if (document.querySelector('.info-detail')?.__vue__) {
                const detail = document.querySelector('.info-detail').__vue__.fileDetail;
                return detail && !detail.isFolder ? [detail] : [];
            }
        } catch (e) { error('天翼云盘获取选中项失败', e); }
        return [];
    }

    function getSelectedItemsForXunlei() {
        try {
            const items = document.querySelectorAll('.SourceListItem__item--XxpOC');
            const selected = [];
            items.forEach(el => {
                const vue = el.__vue__;
                if (vue && vue.selected && vue.selected.includes(vue.info.id) && vue.info.kind === 'drive#file') {
                    selected.push(vue.info);
                }
            });
            return selected;
        } catch (e) { error('迅雷云盘获取选中项失败', e); }
        return [];
    }

    function getSelectedItemsForQuark() {
        try {
            const listDom = document.querySelector('.file-list');
            if (!listDom) return [];
            const key = Object.keys(listDom).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            if (!key) return [];
            const fiber = listDom[key];
            let props = fiber.pendingProps || fiber.memoizedProps;
            if (!props) return [];
            const fileList = props.list || [];
            const selectedKeys = props.selectedRowKeys || [];
            return fileList.filter(f => selectedKeys.includes(f.fid) && f.file === true);
        } catch (e) { error('夸克网盘获取选中项失败', e); }
        return [];
    }

    function getSelectedItemsForYidong() {
        try {
            if (document.querySelector('.main_file_list')?.__vue__) {
                const vue = document.querySelector('.main_file_list').__vue__;
                return vue.selectList.map(v => v.item).filter(f => f.fileEtag || f.coName);
            }
            if (document.querySelector('.home-page')?.__vue__) {
                const vue = document.querySelector('.home-page').__vue__;
                const fileList = vue._computedWatchers.fileList.value || [];
                const dirList = vue._computedWatchers.dirList.value || [];
                const selectedFile = vue.selectedFile || [];
                const selectedDir = vue.selectedDir || [];
                const files = fileList.filter((v, i) => selectedFile.includes(i));
                const dirs = dirList.filter((v, i) => selectedDir.includes(i));
                return [...files, ...dirs].filter(f => f.fileEtag || f.coName);
            }
        } catch (e) { error('移动云盘获取选中项失败', e); }
        return [];
    }

    function getBdstoken() {
        const match = document.cookie.match(/bdstoken=([^;]+)/);
        return match ? match[1] : '';
    }
    function getAliToken() {
        const token = localStorage.getItem('token');
        return token ? JSON.parse(token).access_token : '';
    }
    function getTianyiToken() {
        return localStorage.getItem('accessToken') || '';
    }
    function getXunleiToken() {
        for (let i=0; i<localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('credentials_')) return JSON.parse(localStorage.getItem(key));
        }
        return null;
    }
    function baseSizeFormat(size) {
        if (!size) return '';
        const units = ['B','KB','MB','GB','TB'];
        let i = 0;
        while (size >= 1024 && i < units.length-1) { size /= 1024; i++; }
        return size.toFixed(1) + units[i];
    }

    // 并发控制执行器
    async function runWithConcurrencyLimit(tasks, limit) {
        const results = [];
        const executing = [];
        for (const task of tasks) {
            const p = Promise.resolve().then(() => task());
            results.push(p);
            if (limit <= tasks.length) {
                const e = p.then(() => executing.splice(executing.indexOf(e), 1));
                executing.push(e);
                if (executing.length >= limit) {
                    await Promise.race(executing);
                }
            }
        }
        return Promise.all(results);
    }

    const PanAdapters = {
        // 百度网盘（支持主页和分享页）
        async baidu() {
            const isShare = /^\/(s|share)\//.test(location.pathname);
            if (!isShare) {
                const selected = getSelectedItemsForBaidu();
                if (!selected.length) throw new Error('请先勾选文件');
                const bduss = await getBaiduBDUSS();
                if (!bduss) throw new Error('未登录百度账号');
                const fidlist = selected.map(f => f.fs_id);
                const bdstoken = getBdstoken();
                const url = `https://pan.baidu.com/api/download?app_id=250528&channel=chunlei&clienttype=0&web=1&fidlist=${JSON.stringify(fidlist)}&bdstoken=${bdstoken}`;
                const resp = await fetch(url, { headers: { 'Cookie': `BDUSS=${bduss}` } }).then(r => r.json());
                if (resp.errno !== 0) throw new Error(resp.errmsg || '获取失败');
                const files = [];
                for (let item of resp.list) {
                    if (item.dlink) files.push({ url: item.dlink, filename: item.server_filename, size: baseSizeFormat(item.size) });
                }
                return files;
            } else {
                // 分享页提示转存
                showToast('提示：请将文件保存到网盘后，在主页勾选下载', '#ff9800', 4000);
                return [];
            }
        },
        // 阿里云盘
        async ali() {
            const isShare = /^\/(s|share)\//.test(location.pathname);
            if (!isShare) {
                const selected = getSelectedItemsForAli();
                if (!selected.length) throw new Error('请先勾选文件');
                const token = getAliToken();
                if (!token) throw new Error('未登录阿里云盘');
                const tasks = selected.map(file => async () => {
                    const resp = await fetch('https://api.aliyundrive.com/v2/file/get_download_url', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ drive_id: file.drive_id, file_id: file.file_id })
                    }).then(r => r.json());
                    if (resp.url) return { url: resp.url, filename: file.name, size: baseSizeFormat(file.size) };
                    return null;
                });
                const results = await runWithConcurrencyLimit(tasks, CONFIG.maxConcurrent);
                return results.filter(Boolean);
            } else {
                showToast('提示：阿里分享页请先转存到网盘，再在主页勾选下载', '#ff9800', 4000);
                return [];
            }
        },
        // 天翼云盘
        async tianyi() {
            const selected = getSelectedItemsForTianyi();
            if (!selected.length) throw new Error('请先勾选文件');
            const token = getTianyiToken();
            if (!token) throw new Error('未登录天翼云盘');
            const tasks = selected.map(file => async () => {
                const resp = await fetch(`https://cloud.189.cn/api/open/file/getFileDownloadUrl.action?fileId=${file.fileId}`, {
                    headers: { 'Accept': 'application/json', 'AccessToken': token }
                }).then(r => r.json());
                if (resp.fileDownloadUrl) return { url: resp.fileDownloadUrl, filename: file.fileName, size: baseSizeFormat(file.size) };
                return null;
            });
            const results = await runWithConcurrencyLimit(tasks, CONFIG.maxConcurrent);
            return results.filter(Boolean);
        },
        // 迅雷云盘
        async xunlei() {
            const isShare = /^\/(s|share)\//.test(location.pathname);
            if (!isShare) {
                const selected = getSelectedItemsForXunlei();
                if (!selected.length) throw new Error('请先勾选文件');
                const token = getXunleiToken();
                if (!token) throw new Error('未登录迅雷云盘');
                const tasks = selected.map(file => async () => {
                    const resp = await fetch(`https://pan.xunlei.com/rest/pan/xdrive/file?file_id=${file.id}`, {
                        headers: { 'Authorization': `${token.token_type} ${token.access_token}` }
                    }).then(r => r.json());
                    if (resp.web_content_link) return { url: resp.web_content_link, filename: file.name, size: baseSizeFormat(file.size) };
                    return null;
                });
                const results = await runWithConcurrencyLimit(tasks, CONFIG.maxConcurrent);
                return results.filter(Boolean);
            } else {
                showToast('提示：迅雷分享页请先转存到网盘，再在主页勾选下载', '#ff9800', 4000);
                return [];
            }
        },
        // 夸克网盘
        async quark() {
            const isShare = /^\/(s|share)\//.test(location.pathname);
            if (!isShare) {
                const selected = getSelectedItemsForQuark();
                if (!selected.length) throw new Error('请先勾选文件');
                const tasks = selected.map(file => async () => {
                    const resp = await fetch('https://pan.quark.cn/1/clouddrive/file/download', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fid: file.fid })
                    }).then(r => r.json());
                    if (resp.data?.download_url) return { url: resp.data.download_url, filename: file.file_name, size: baseSizeFormat(file.size) };
                    return null;
                });
                const results = await runWithConcurrencyLimit(tasks, CONFIG.maxConcurrent);
                return results.filter(Boolean);
            } else {
                showToast('提示：夸克分享页请先转存到网盘，再在主页勾选下载', '#ff9800', 4000);
                return [];
            }
        },
        // 移动云盘
        async yidong() {
            const selected = getSelectedItemsForYidong();
            if (!selected.length) throw new Error('请先勾选文件');
            const tasks = selected.map(file => async () => {
                const resp = await fetch('https://yun.139.com/orchestration/personalCloud/catalog/v1.0/getDisk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contentID: file.contentID })
                }).then(r => r.json());
                if (resp.data?.downloadURL) return { url: resp.data.downloadURL, filename: file.contentName, size: baseSizeFormat(file.contentSize) };
                return null;
            });
            const results = await runWithConcurrencyLimit(tasks, CONFIG.maxConcurrent);
            return results.filter(Boolean);
        },
        // 123云盘分享页
        async '123pan'() {
            if (location.pathname.startsWith('/s/')) {
                const shareKey = location.pathname.split('/s/')[1];
                const resp = await fetch(`https://www.123pan.com/b/api/share/get?shareKey=${shareKey}`).then(r => r.json());
                if (resp.code !== 0) throw new Error('获取分享信息失败');
                const files = resp.data.InfoList.filter(f => f.Type === 0);
                const tasks = files.map(f => async () => {
                    const dl = await fetch('https://www.123pan.com/b/api/share/download', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ShareKey: shareKey, FileID: f.FileId, S3keyFlag: f.S3KeyFlag, Size: f.Size, Etag: f.Etag })
                    }).then(r => r.json());
                    if (dl.code === 0 && dl.data.DownloadURL) {
                        return { url: dl.data.DownloadURL, filename: f.FileName, size: baseSizeFormat(f.Size) };
                    }
                    return null;
                });
                const results = await runWithConcurrencyLimit(tasks, CONFIG.maxConcurrent);
                return results.filter(Boolean);
            }
            throw new Error('123网盘主页主动获取暂未实现，请使用通用捕获');
        },
        // 蓝奏云
        async lanzou() {
            const direct = await parseLanzou(location.href);
            return direct ? [{ url: direct, filename: extractFilenameFromUrl(direct) }] : [];
        },
        // UC网盘分享页
        async uc() {
            const shareId = location.pathname.match(/\/s\/([a-f0-9]+)/)?.[1];
            if (!shareId) throw new Error('非UC分享页');
            const info = await fetch(`https://drive.uc.cn/api/v1/share/info?share_id=${shareId}`).then(r => r.json());
            if (info.code !== 0) throw new Error('获取信息失败');
            const tasks = info.data.file_list.map(file => async () => {
                const dl = await fetch(`https://drive.uc.cn/api/v1/share/download?share_id=${shareId}&file_id=${file.file_id}`).then(r => r.json());
                if (dl.code === 0 && dl.data.download_url) {
                    return { url: dl.data.download_url, filename: file.file_name };
                }
                return null;
            });
            const results = await runWithConcurrencyLimit(tasks, CONFIG.maxConcurrent);
            return results.filter(Boolean);
        },
        // 115网盘分享页
        async '115'() {
            const shareCode = location.pathname.split('/s/')[1];
            if (!shareCode) throw new Error('非115分享页');
            const info = await fetch(`https://webapi.115.com/share/snap?share_code=${shareCode}`).then(r => r.json());
            if (info.state !== true) throw new Error('获取分享信息失败');
            const tasks = info.data.list.map(file => async () => {
                const resp = await fetch('https://webapi.115.com/share/down', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `share_code=${shareCode}&file_id=${file.fid}`
                }).then(r => r.json());
                if (resp.state && resp.data?.url) {
                    return { url: resp.data.url, filename: file.n, size: baseSizeFormat(file.s) };
                }
                return null;
            });
            const results = await runWithConcurrencyLimit(tasks, CONFIG.maxConcurrent);
            return results.filter(Boolean);
        }
    };

    async function fetchPanLinks() {
        const panType = detectPanType();
        if (!panType) {
            showToast('当前页面非已知网盘', '#ff9800');
            return;
        }
        state.activePan = panType;
        showToast(`正在获取 ${panType} 直链...`, '#2196F3');

        try {
            let files = [];
            if (PanAdapters[panType]) {
                files = await PanAdapters[panType]();
            } else {
                showToast('该网盘主动获取暂未支持，请使用通用捕获', '#ff9800');
                return;
            }
            if (files.length === 0) {
                showToast('未获取到任何文件，请确认已选中或页面正确', '#ff9800');
                return;
            }
            files.forEach(f => addCapturedFile(f.url, f.filename, getReferer(), f.size));
            showToast(`成功获取 ${files.length} 个直链`, '#4CAF50');
        } catch (e) {
            error('获取网盘直链失败', e);
            showToast(e.message || '获取失败，请刷新或检查登录状态', '#f44336');
        }
    }

    // ---------- UI 样式（网盘直链助手风格） ----------
    function injectStyles() {
        const color = CONFIG.themeColor;
        const css = `
            ::-webkit-scrollbar { width: 6px; height: 10px; }
            ::-webkit-scrollbar-track { background: none; }
            ::-webkit-scrollbar-thumb { background-color: rgba(85,85,85,.4); border-radius: 5px; }
            ::-webkit-scrollbar-thumb:hover { background-color: rgba(85,85,85,.3); }

            .ud-panel {
                position: fixed;
                left: ${GM_getValue('panelLeft', CONFIG.panelLeft)};
                top: ${GM_getValue('panelTop', CONFIG.panelTop)};
                width: 550px;
                max-height: 80vh;
                background: #fff;
                color: #333;
                border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.15);
                z-index: 10000;
                font-size: 13px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                border: 1px solid rgba(0,0,0,0.08);
                display: flex;
                flex-direction: column;
                user-select: none;
            }

            .ud-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                border-bottom: 1px solid #eee;
                cursor: move;
                background: #fff;
                border-radius: 12px 12px 0 0;
            }
            .ud-title {
                font-size: 16px;
                font-weight: 600;
                color: ${color};
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .ud-close {
                background: none;
                border: none;
                font-size: 20px;
                cursor: pointer;
                color: #999;
                padding: 0 4px;
                transition: color 0.2s;
            }
            .ud-close:hover { color: #f44336; }

            .ud-content {
                padding: 12px 16px;
                flex: 1;
                overflow-y: auto;
            }

            .ud-toolbar {
                display: flex;
                gap: 8px;
                margin-bottom: 12px;
                flex-wrap: wrap;
            }
            .ud-btn {
                background: ${color};
                border: none;
                color: white;
                padding: 6px 12px;
                border-radius: 6px;
                font-size: 12px;
                cursor: pointer;
                transition: opacity 0.2s;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                font-weight: 500;
            }
            .ud-btn:hover { opacity: 0.85; }
            .ud-btn.secondary { background: #6c757d; }
            .ud-btn.success { background: #55af28; }
            .ud-btn.warning { background: #da9328; }
            .ud-btn.danger { background: #cc3235; }
            .ud-btn.outline {
                background: transparent;
                border: 1px solid ${color};
                color: ${color};
            }

            .ud-file-list {
                max-height: 400px;
                overflow-y: auto;
                border: 1px solid #eee;
                border-radius: 8px;
                background: #fafafa;
            }
            .ud-file-item {
                display: flex;
                align-items: center;
                padding: 8px 12px;
                border-bottom: 1px solid #eee;
                transition: background 0.15s;
                background: #fff;
            }
            .ud-file-item:last-child { border-bottom: none; }
            .ud-file-item:hover { background: #f5f5f5; }

            .ud-file-name {
                flex: 0 0 180px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-weight: 500;
                cursor: default;
            }
            .ud-file-size {
                margin-left: 6px;
                color: #f56c6c;
                font-size: 11px;
                font-weight: normal;
            }

            .ud-file-link {
                flex: 1;
                margin: 0 10px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                color: ${color};
                cursor: pointer;
                text-decoration: none;
                font-family: monospace;
                font-size: 11px;
            }
            .ud-file-link:hover { text-decoration: underline; }

            .ud-file-actions {
                display: flex;
                gap: 6px;
                flex-shrink: 0;
            }
            .ud-action-btn {
                background: #e9ecef;
                border: none;
                color: #333;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 11px;
                cursor: pointer;
                transition: all 0.15s;
            }
            .ud-action-btn:hover { background: #dee2e6; }
            .ud-action-btn.danger { background: #f8d7da; color: #721c24; }
            .ud-action-btn.danger:hover { background: #f5c6cb; }
            .ud-action-btn.primary { background: ${color}; color: white; }

            .ud-footer {
                padding: 10px 16px;
                border-top: 1px solid #eee;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 12px;
                color: #888;
            }

            .ud-dropdown {
                position: relative;
                display: inline-block;
            }
            .ud-dropdown-menu {
                position: absolute;
                top: 100%;
                left: 0;
                background: white;
                border: 1px solid #ddd;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                z-index: 10;
                min-width: 120px;
                display: none;
            }
            .ud-dropdown:hover .ud-dropdown-menu { display: block; }
            .ud-dropdown-item {
                padding: 8px 16px;
                cursor: pointer;
                white-space: nowrap;
            }
            .ud-dropdown-item:hover { background: #f0f0f0; }

            .ud-tooltip {
                position: absolute;
                background: #333;
                color: white;
                padding: 6px 10px;
                border-radius: 6px;
                font-size: 12px;
                z-index: 10001;
                max-width: 300px;
                word-break: break-word;
                pointer-events: none;
                display: none;
            }

            @media (max-width: 600px) {
                .ud-panel { width: 95vw; left: 2.5vw !important; }
            }
        `;
        GM_addStyle(css);
    }

    function renderFileList() {
        const container = document.getElementById('ud-file-list');
        if (!container) return;

        const files = state.capturedFiles;
        const countSpan = document.getElementById('ud-link-count');
        if (countSpan) countSpan.textContent = files.length;

        if (!files.length) {
            container.innerHTML = '<div style="text-align:center; color:#999; padding:20px;">暂无捕获的链接</div>';
            return;
        }

        let html = '';
        files.forEach((f, i) => {
            const sizeDisplay = f.size ? `<span class="ud-file-size">${f.size}</span>` : '';
            let actions = '';

            if (state.currentMode === 'api') {
                actions = `
                    <button class="ud-action-btn primary" data-action="download" data-index="${i}">⬇️下载</button>
                    <button class="ud-action-btn" data-action="copy-link" data-index="${i}">📋复制</button>
                `;
            } else if (state.currentMode === 'aria') {
                actions = `<button class="ud-action-btn" data-action="copy" data-type="aria" data-index="${i}">📋复制命令</button>`;
            } else if (state.currentMode === 'curl') {
                actions = `<button class="ud-action-btn" data-action="copy" data-type="curl" data-index="${i}">📋复制命令</button>`;
            } else if (state.currentMode === 'bc') {
                actions = `<button class="ud-action-btn" data-action="copy" data-type="bc" data-index="${i}">📋复制BC链接</button>`;
            } else if (state.currentMode === 'rpc') {
                actions = `<button class="ud-action-btn primary" data-action="rpc" data-index="${i}">🚀推送</button>`;
            }

            html += `
                <div class="ud-file-item" data-index="${i}">
                    <span class="ud-file-name" title="${f.filename}">📄 ${f.filename}${sizeDisplay}</span>
                    <span class="ud-file-link" data-action="copy-link" data-index="${i}" title="点击复制链接">${f.url}</span>
                    <div class="ud-file-actions">
                        ${actions}
                        <button class="ud-action-btn danger" data-action="remove" data-index="${i}">✖</button>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    }

    function updateModeDisplay() {
        const modeBtn = document.getElementById('ud-mode-btn');
        if (!modeBtn) return;
        const modeNames = {
            api: '🌐 直接下载',
            aria: '⬇️ Aria2 命令',
            curl: '📜 cURL 命令',
            bc: '🐿️ BC 链接',
            rpc: '🚀 RPC 推送'
        };
        modeBtn.innerHTML = `${modeNames[state.currentMode] || '选择模式'} ▼`;
    }

    function createPanel() {
        if (document.getElementById('ud-panel')) return;
        injectStyles();

        const panel = document.createElement('div');
        panel.id = 'ud-panel';
        panel.className = 'ud-panel';
        panel.innerHTML = `
            <div class="ud-header" id="ud-drag-handle">
                <span class="ud-title">
                    <span>⚡ 全能下载助手</span>
                    <span id="ud-link-count" style="background: ${CONFIG.themeColor}; color: white; padding: 2px 8px; border-radius: 20px; font-size: 12px;">0</span>
                </span>
                <button class="ud-close" id="ud-close-panel" title="关闭面板">✕</button>
            </div>
            <div class="ud-content">
                <div class="ud-toolbar">
                    <div class="ud-dropdown">
                        <button class="ud-btn" id="ud-mode-btn">🌐 直接下载 ▼</button>
                        <div class="ud-dropdown-menu" id="ud-mode-menu">
                            <div class="ud-dropdown-item" data-mode="api">🌐 直接下载</div>
                            <div class="ud-dropdown-item" data-mode="aria">⬇️ Aria2 命令</div>
                            <div class="ud-dropdown-item" data-mode="curl">📜 cURL 命令</div>
                            <div class="ud-dropdown-item" data-mode="bc">🐿️ BC 链接</div>
                            <div class="ud-dropdown-item" data-mode="rpc">🚀 RPC 推送</div>
                        </div>
                    </div>
                    <button class="ud-btn" id="ud-scan-page">🔍 扫描页面</button>
                    <button class="ud-btn" id="ud-fetch-pan">📥 获取网盘</button>
                    <button class="ud-btn secondary" id="ud-settings">⚙️ RPC设置</button>
                </div>

                <div class="ud-file-list" id="ud-file-list">
                    <div style="text-align:center; color:#999; padding:20px;">暂无捕获的链接</div>
                </div>
            </div>
            <div class="ud-footer">
                <div>
                    <button class="ud-btn outline" id="ud-batch-import" style="margin-right:6px;">📥 批量导入</button>
                    <button class="ud-btn outline" id="ud-manual-add">➕ 手动添加</button>
                </div>
                <div>
                    <button class="ud-btn success" id="ud-batch-export">📋 导出全部</button>
                    <button class="ud-btn danger" id="ud-clear-all">🗑️ 清空</button>
                    <button class="ud-btn" id="ud-batch-rpc" style="background:#E91E63;">🚀 批量RPC</button>
                </div>
            </div>
            <div id="ud-tooltip" class="ud-tooltip"></div>
        `;
        document.body.appendChild(panel);
        state.panel = panel;

        bindPanelEvents();
        setupDrag(panel.querySelector('#ud-drag-handle'), panel);

        const left = GM_getValue('panelLeft', CONFIG.panelLeft);
        const top = GM_getValue('panelTop', CONFIG.panelTop);
        panel.style.left = left;
        panel.style.top = top;

        renderFileList();
        updateModeDisplay();
    }

    function bindPanelEvents() {
        const panel = state.panel;

        panel.querySelector('#ud-close-panel').onclick = () => {
            panel.style.display = 'none';
            showToast('面板已隐藏，可通过菜单重新打开', '#666');
        };

        panel.querySelectorAll('[data-mode]').forEach(item => {
            item.onclick = () => {
                state.currentMode = item.dataset.mode;
                updateModeDisplay();
                renderFileList();
            };
        });

        panel.querySelector('#ud-scan-page').onclick = scanPageLinks;
        panel.querySelector('#ud-fetch-pan').onclick = fetchPanLinks;
        panel.querySelector('#ud-settings').onclick = showRpcSettings;
        panel.querySelector('#ud-batch-import').onclick = batchImportLinks;
        panel.querySelector('#ud-manual-add').onclick = manualAddLink;
        panel.querySelector('#ud-batch-export').onclick = batchExport;
        panel.querySelector('#ud-clear-all').onclick = clearAll;
        panel.querySelector('#ud-batch-rpc').onclick = batchSendToRPC;

        const list = panel.querySelector('#ud-file-list');
        list.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            const index = target.dataset.index;
            const action = target.dataset.action;
            const file = state.capturedFiles[index];

            if (action === 'remove') {
                removeFile(index);
            } else if (action === 'download') {
                directDownload(file);
            } else if (action === 'copy') {
                let txt = '';
                if (target.dataset.type === 'aria') txt = toAria2Command(file);
                else if (target.dataset.type === 'curl') txt = toCurlCommand(file);
                else if (target.dataset.type === 'bc') txt = toBCLink(file);
                else txt = file.url;
                GM_setClipboard(txt);
                showToast('已复制', '#4CAF50');
            } else if (action === 'rpc') {
                target.textContent = '⏳';
                target.disabled = true;
                sendToRPC(file).then(ok => {
                    showToast(ok ? '推送成功' : '推送失败', ok ? '#4CAF50' : '#f44336');
                    target.textContent = '🚀推送';
                    target.disabled = false;
                });
            } else if (action === 'copy-link') {
                GM_setClipboard(file.url);
                showToast('链接已复制', '#4CAF50');
            }
        });

        list.addEventListener('mouseenter', (e) => {
            const nameEl = e.target.closest('.ud-file-name');
            if (nameEl) {
                const index = nameEl.closest('[data-index]')?.dataset.index;
                if (index !== undefined) {
                    const file = state.capturedFiles[index];
                    const tip = `${file.filename}  ${file.size || ''}`;
                    const tooltip = document.getElementById('ud-tooltip');
                    tooltip.textContent = tip;
                    tooltip.style.display = 'block';
                    const rect = nameEl.getBoundingClientRect();
                    tooltip.style.left = rect.left + 'px';
                    tooltip.style.top = (rect.bottom + 5) + 'px';
                }
            }
        }, true);
        list.addEventListener('mouseleave', (e) => {
            if (e.target.closest('.ud-file-name')) {
                document.getElementById('ud-tooltip').style.display = 'none';
            }
        }, true);
    }

    function setupDrag(handle, panel) {
        let dragging = false, startX, startY, startLeft, startTop;
        handle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseInt(panel.style.left) || panel.offsetLeft;
            startTop = parseInt(panel.style.top) || panel.offsetTop;
            panel.style.transition = 'none';
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            let l = startLeft + e.clientX - startX;
            let t = startTop + e.clientY - startY;
            l = Math.min(Math.max(0, l), window.innerWidth - panel.offsetWidth);
            t = Math.min(Math.max(0, t), window.innerHeight - panel.offsetHeight);
            panel.style.left = l + 'px';
            panel.style.top = t + 'px';
        });
        window.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                panel.style.transition = '';
                GM_setValue('panelLeft', panel.style.left);
                GM_setValue('panelTop', panel.style.top);
            }
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
        dlg.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:#fff;color:#333;padding:20px;border-radius:12px;z-index:10002;box-shadow:0 0 20px rgba(0,0,0,0.2);';
        dlg.innerHTML = `
            <h3 style="color:${CONFIG.themeColor};">⚙️ RPC设置</h3>
            <div style="display:flex;flex-direction:column;gap:10px;min-width:300px;">
                <label>域名: <input id="rpc-domain" value="${state.rpcConfig.domain}" style="width:200px;"></label>
                <label>端口: <input id="rpc-port" value="${state.rpcConfig.port}" style="width:200px;"></label>
                <label>路径: <input id="rpc-path" value="${state.rpcConfig.path}" style="width:200px;"></label>
                <label>Token: <input id="rpc-token" value="${state.rpcConfig.token}" style="width:200px;"></label>
                <label>目录: <input id="rpc-dir" value="${state.rpcConfig.dir}" style="width:200px;"></label>
                <label>主题颜色: <input type="color" id="theme-color" value="${CONFIG.themeColor}"></label>
            </div>
            <div style="margin-top:15px;text-align:right;">
                <button id="rpc-save" style="background:${CONFIG.themeColor};border:none;color:#fff;padding:6px 16px;border-radius:6px;margin-right:8px;">保存</button>
                <button id="rpc-cancel" style="background:#f44336;border:none;color:#fff;padding:6px 16px;border-radius:6px;">取消</button>
            </div>
        `;
        document.body.appendChild(dlg);

        dlg.querySelector('#rpc-save').onclick = () => {
            state.rpcConfig.domain = dlg.querySelector('#rpc-domain').value;
            state.rpcConfig.port = dlg.querySelector('#rpc-port').value;
            state.rpcConfig.path = dlg.querySelector('#rpc-path').value;
            state.rpcConfig.token = dlg.querySelector('#rpc-token').value;
            state.rpcConfig.dir = dlg.querySelector('#rpc-dir').value;
            const newColor = dlg.querySelector('#theme-color').value;
            CONFIG.themeColor = newColor;
            GM_setValue('themeColor', newColor);
            saveRpcConfig();
            document.documentElement.style.setProperty('--ud-primary', newColor);
            showToast('设置已保存', '#4CAF50');
            dlg.remove();
            if (state.panel) {
                state.panel.remove();
                state.panel = null;
                createPanel();
            }
        };
        dlg.querySelector('#rpc-cancel').onclick = () => dlg.remove();
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

    // ---------- 菜单与初始化 ----------
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
