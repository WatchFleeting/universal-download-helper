# 全能下载助手 | Universal Download Helper

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-1.2.0-blue)]()

> 一个功能强大的 Tampermonkey 用户脚本，自动捕获 30+ 网盘、Openlist 开放目录、AList、腾飞 WebOS 等页面的文件直链。支持蓝奏云自动解析、批量导入、RPC 推送、多种导出格式，极大提升下载效率。

## ✨ 功能特性

- **智能页面识别**：自动激活于主流网盘、Openlist、AList、腾飞 WebOS 等页面，无需手动干预。
- **多维度链接捕获**：
  - 拦截 `XMLHttpRequest` / `fetch` API 请求，提取直链。
  - 扫描页面 DOM 元素（`<a>` 标签、`data-url` 属性等）。
  - 监听下载按钮点击、右键菜单复制等操作。
- **蓝奏云自动解析**：无需输入密码，自动获取真实下载地址。
- **批量导入链接**：支持粘贴多行链接（可附带自定义文件名），一键加入列表。
- **多种下载模式**：
  - 浏览器直接下载
  - 生成 Aria2 / cURL 命令
  - 生成比特彗星 BC 链接
  - RPC 推送至 Aria2 / Motrix（支持单个和批量，并发可控）
- **面板可拖拽**：位置记忆，不遮挡主要内容。
- **右键菜单集成**：Tampermonkey 菜单提供快速操作入口。
- **手动强制激活**：即使自动检测失败也可手动开启面板。

## 📦 安装方法

1. 确保已安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展。
2. 点击以下链接直接安装脚本：  
   [📥 安装最新版](https://raw.githubusercontent.com/WatchFleeting/universal-download-helper/main/universal-download-helper.user.js)
3. Tampermonkey 会自动弹出安装确认页面，点击“安装”即可。

> 如果您希望手动安装，请将上述链接中的代码复制后，在 Tampermonkey 管理面板中新建脚本并粘贴。

## 🔄 自动更新

本脚本已配置 `@updateURL` 和 `@downloadURL`，Tampermonkey 会定期检查更新。您也可以在管理面板中右键点击脚本 → **触发更新检查** 立即获取最新版本。

## 🚀 使用说明

1. **访问支持的页面**（如百度网盘分享页、Openlist 目录、AList 站点等），脚本将自动在页面左上角显示控制面板。
2. **捕获链接**：点击页面上的下载按钮、复制直链，或使用面板中的“扫描”/“导入”功能，链接会自动添加到列表。
3. **选择模式**：通过下拉菜单切换下载模式（直接下载/命令复制/BC链接/RPC推送）。
4. **执行操作**：点击每条链接旁的操作按钮，或使用“批量导出”/“批量RPC”等批量功能。
5. **RPC 设置**：点击“⚙️RPC”按钮配置 Aria2 RPC 地址、端口、密钥和保存目录。

### 手动激活
如果页面未自动显示面板，可点击 Tampermonkey 图标 → 找到本脚本 → 选择 **「🚀 强制激活面板」**。

## 🖥️ 支持平台

| 类型 | 示例 |
|------|------|
| 网盘 | 百度网盘、阿里云盘、天翼云盘、迅雷云盘、夸克网盘、115网盘、123云盘、蓝奏云、腾讯微云、UC网盘等 30+ |
| Openlist | Apache/Nginx 目录索引、HFS、Caddy、FileBrowser 等 |
| AList | 任何 AList 部署站点 |
| WebOS | 腾飞 WebOS 仿 Windows 11 云盘系统 |

## ⚙️ 配置说明

### RPC 设置
- **域名**：Aria2 RPC 地址（例如 `http://localhost`）
- **端口**：RPC 端口（默认 `16800`）
- **路径**：RPC 路径（通常为 `/jsonrpc`）
- **Token**：RPC 密钥（若未设置可留空）
- **目录**：文件下载保存目录（如 `D:/Downloads`）

### 调试模式
脚本默认开启调试日志，可在控制台查看捕获过程。如需关闭，修改脚本中 `CONFIG.debug = false`。

## 🐛 问题反馈

遇到问题或功能建议？欢迎在 [GitHub Issues](https://github.com/WatchFleeting/universal-download-helper/issues) 中提出。

提交问题时请提供：
- 浏览器及版本
- Tampermonkey 版本
- 访问的具体网址
- 控制台错误日志（如有）

## 📜 开源协议

本项目基于 [MIT License](LICENSE) 开源，欢迎 Fork 和贡献。

---

**Enjoy downloading! 🚀**
