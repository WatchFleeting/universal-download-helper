# 全能下载助手

[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-已适配-brightgreen)](https://www.tampermonkey.net/)
[![License](https://img.shields.io/github/license/yourname/universal-download-helper)](LICENSE)

## ✨ 特性
- **仅在网盘页面激活**，不浪费资源
- 支持 **30+ 主流网盘**（百度、阿里、天翼、迅雷、夸克、移动、123、小飞机、115、城通、微云、**蓝奏云**、360、文叔叔、UC等）
- 蓝奏云**自动解析真实直链**
- **五种下载模式**：浏览器直链（IDM）、Aria2命令、cURL命令、比特彗星BC链接、RPC推送
- 批量捕获、悬浮面板、持久化存储

## 📥 安装
1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 点击 [**安装脚本**](https://github.com/yourname/universal-download-helper/raw/main/universal-download-helper.user.js)
3. 访问任意支持的网盘页面，点击下载即可自动捕获

## 🚀 使用说明
- 捕获后，悬浮面板会显示文件列表
- 选择下载模式（下拉菜单）
- 可单独点击每个文件的按钮，或点击“批量导出”复制所有链接
- RPC模式需先在设置中填写 Aria2/Motrix 地址

## ⚠️ 注意事项
- 部分网盘需要登录且文件未过期
- 直链有时效性，请尽快下载
- 蓝奏云解析依赖页面结构，若失效请提交 Issue

## 📄 许可证
MIT
