# BOSS直聘自动投递

Chrome Extension (Manifest V3)，自动循环点击 BOSS 直聘职位列表中的「立即沟通」按钮。

## 功能

- 自动逐条点击职位列表中的职位
- 自动点击「立即沟通」按钮
- 自动处理「留在此页」弹窗
- 支持懒加载（无限滚动）自动加载更多职位
- 操作前红色高亮目标元素，清晰可见
- 每一步随机等待 1~3 秒，模拟真人操作
- 随时可停止，状态机架构可安全中断

## 项目结构

```
├── manifest.json              # MV3 声明
├── package.json               # 依赖管理
├── tsconfig.json              # TypeScript 配置
├── esbuild.config.mjs         # 构建脚本
├── src/
│   ├── shared/types.ts        # 类型、枚举、常量
│   ├── popup/
│   │   ├── popup.html         # 弹窗 UI
│   │   ├── popup.css          # 弹窗样式
│   │   └── popup.ts           # 开始/停止 + 状态显示
│   ├── content/
│   │   └── content.ts         # 核心：状态机 + DOM 操作
│   └── background/
│       └── background.ts      # Service Worker 消息中继
└── dist/                      # 构建产物（加载到 Chrome）
```

## 快速开始

### 1. 安装依赖 & 构建

```bash
npm install
npm run build
```

### 2. 加载到 Chrome

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择项目中的 `dist/` 目录

### 3. 使用

1. 打开 https://www.zhipin.com/ ，登录并搜索职位
2. 点击 Chrome 工具栏的扩展图标
3. 点击 **开始**
4. 观察自动化流程：红色高亮 → 点击职位 → 立即沟通 → 处理弹窗 → 下一条
5. 随时点击 **停止** 中断

## 技术要点

| 特性 | 实现 |
|------|------|
| 架构 | Manifest V3 + TypeScript + esbuild |
| 流程控制 | 17 状态有限状态机（非 while(true)） |
| 元素定位 | 文字/role/aria-label（不依赖随机 class） |
| 懒加载 | MutationObserver + 滚动 + 轮询双保险 |
| 高亮反馈 | 红色 3px 边框 + box-shadow，持续 500ms |
| 容错 | 全链路 try-catch，连续 5 次错误自动停止 |

## 开发

```bash
npm run build    # 单次构建
npm run watch    # 监听模式（文件变更自动构建）
```
