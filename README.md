<div align="center">

<img src="https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Chrome Extension">
<img src="https://img.shields.io/badge/Manifest-V3-34A853?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Manifest V3">
<img src="https://img.shields.io/badge/%E7%BA%AF%E5%8E%9F%E7%94%9F-no_framework-8B5CF6?style=for-the-badge" alt="纯原生">
<img src="https://img.shields.io/badge/%E5%A4%A7%E5%B0%8F-~30KB-22C55E?style=for-the-badge" alt="~30KB">

</div>

<br>

<h1 align="center">💼 BOSS 自动投递</h1>

<p align="center">
  <b>极简 · 极小 · 纯原生</b><br>
  <sub>一个 ~30KB 的 Chrome 扩展，没有 Playwright，没有 Puppeteer，没有框架</sub>
</p>

<p align="center">
  每天 <b>150</b> 次沟通机会，设好条件 → 一键投递 → 解放双手 🤲
</p>

<br>

---

## 🎬 5 秒看懂

<div align="center">

<img src="assets/test.gif" width="720" alt="自动投递演示">

*从点击开始到自动沟通，全程无人值守*

</div>

<br>

---

## 💡 为什么选它

> 市面上有 Playwright 方案、Selenium 方案、Puppeteer 方案。
> 它们都很重，要装 Python，要配 driver，要写脚本。
>
> **这个只要拖进 Chrome 就能用。**

<table>
<tr>
<td width="33%" align="center">

### 🪶 极轻

<br>

**30KB** 核心逻辑<br>
没有 `node_modules` 黑洞<br>
没有浏览器驱动<br>
没有 Python 环境

</td>
<td width="33%" align="center">

### 🧬 纯原生

<br>

**零依赖运行**<br>
不依赖 Playwright<br>
不依赖 Puppeteer<br>
不依赖任何框架

</td>
<td width="33%" align="center">

### ⚡ 即装即用

<br>

`npm run build`<br>
拖进 Chrome<br>
点开始<br>
**完。**

</td>
</tr>
</table>

<br>

---

## 🖼️ 预览

<div align="center">

| | |
|:---:|:---:|
| **🏠 主页面** | **⚙ 设置面板** |
| <img src="assets/img2.png" width="450" alt="主页面"> | <img src="assets/img3.png" width="450" alt="设置页"> |
| 可拖动浮动面板，所有操作一手掌握 | 三档预设 + 独立滑块，速度随心调 |

<br>

| **📥 导出记录** |
|:---:|
| <img src="assets/img1.png" width="650" alt="导出记录"> |
| 一键导出 `.txt`，公司、地址、标签、时间一目了然 |

</div>

<br>

---

## 🚀 快速开始

```bash
npm install && npm run build
```

然后：

1. Chrome → `chrome://extensions` → 开启 **开发者模式**
2. **加载已解压的扩展程序** → 选 `dist/` 目录
3. 打开 [BOSS 直聘](https://www.zhipin.com/) 搜索结果页
4. 👉 页面右侧浮动面板 → **▶ 开 始**

> 💡 **提示**：构建依赖只有 `esbuild` + `typescript`，运行时代码是**纯浏览器 API**——`querySelector`、`MutationObserver`、`XPath`、`setTimeout`，没有任何第三方运行时依赖。

<br>

---

## 🧠 怎么工作的

```
搜索页 → 检测职位列表 → 8秒/个估算倒计时
                           │
     ┌──────────────────────┘
     ▼
  🔍 找下一条 → ✨ 高亮 → 👆 点击职位
                              │
                              ▼
                       等待右侧详情加载
                              │
                       找「立即沟通」按钮
                              │
                        ✨ 高亮 → 👆 点击
                              │
                         检查弹窗
                         /       \
                    有弹窗        无
                       │          │
                 点「留在此页」   记录 ✅
                       │          │
                       └────┬─────┘
                            │
                     ◀ 下一条 ──┘

             全部完成 / 手动停止 → 📥 导出
```

| 为什么这么做 | |
|---|---|
| 状态机 | `while(true)` 停不下来，状态机能 |
| 每次查 DOM | 虚拟列表会销毁节点，缓存 = 点空气 |
| text/role 定位 | BOSS 的 class 每次都变，文字不会 |
| 输出到面板 | 网站反调试，`console.log` 会被检测 |

<br>

---

## 🏗️ 源码结构

```
自动BOSS投递/
├── manifest.json               Chrome MV3 声明
├── esbuild.config.mjs          构建脚本
├── src/
│   ├── shared/types.ts         类型 · 枚举 · 速度预设
│   ├── content/content.ts      🔥 全部核心逻辑（~1000行）
│   ├── popup/                  极简弹窗（状态预览）
│   └── background/             Service Worker（消息中继）
├── assets/
│   ├── test.gif                ← 自动投递演示
│   ├── img1.png                ← 导出记录
│   ├── img2.png                ← 主页面
│   └── img3.png                ← 设置面板
└── dist/                       构建产物 → 加载到 Chrome
```

| | |
|---|---|
| 清单 | Manifest V3 |
| 语言 | TypeScript |
| 打包 | esbuild → IIFE |
| 运行时依赖 | **零。** 纯 DOM API |
| 核心大小 | ~30KB（content.js） |

<br>

---

## 🎮 面板操作

| 操作 | 说明 |
|------|------|
| `≡` 拖动 | 长按拖动面板到任意位置 |
| `▶/⏹` | **同一个按钮**，运行/停止自动切换 |
| `◀ ▶` | 手动浏览职位 |
| `🎯` | 点击检测：点页面元素查看 DOM 信息 |
| `🔄` | 刷新职位列表 |
| `📥 导出` | 导出投递记录为 `.txt` |
| `⚙` | 速度设置面板 |

<br>

---

## ⚙ 速度预设

| 预设 | 高亮 | 步间延迟 | 加载超时 | 适合 |
|------|------|----------|----------|------|
| 🐢 稳定 | 600ms | 1.2~2.5s | 6s | 网络慢，求稳 |
| ⚡ 推荐 | 350ms | 0.8~1.5s | 4s | 🌟 日常，90%+ 不出错 |
| 🚀 极速 | 150ms | 0.4~0.8s | 2.5s | 网络快，抢速度 |

<br>

---

<div align="center">

### 没有 Playwright。没有 Selenium。没有 800MB 的 node_modules。

### 就一个 30KB 的 Chrome 扩展，拖进去，点开始。🎯

<br>

<sub>Made with TypeScript · Chrome Extension API · 纯 DOM 操作</sub>

</div>
