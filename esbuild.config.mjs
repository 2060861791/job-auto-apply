/**
 * esbuild 构建配置
 * 将 TypeScript 源码编译打包为 Chrome Extension 可用的 JS 文件
 */
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync } from 'fs';

const isWatch = process.argv.includes('--watch');

// 确保 dist 目录存在
if (!existsSync('dist')) {
  mkdirSync('dist', { recursive: true });
}

/** @type {esbuild.BuildOptions} */
const baseConfig = {
  bundle: true,
  format: 'iife',
  target: 'chrome100',
  platform: 'browser',
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions[]} */
const builds = [
  {
    ...baseConfig,
    entryPoints: ['src/popup/popup.ts'],
    outfile: 'dist/popup.js',
  },
  {
    ...baseConfig,
    entryPoints: ['src/content/content.ts'],
    outfile: 'dist/content.js',
  },
  {
    ...baseConfig,
    entryPoints: ['src/background/background.ts'],
    outfile: 'dist/background.js',
  },
];

async function build() {
  // 复制静态文件
  cpSync('src/popup/popup.html', 'dist/popup.html');
  cpSync('src/popup/popup.css', 'dist/popup.css');
  cpSync('manifest.json', 'dist/manifest.json');
  console.log('📋 静态文件已复制到 dist/');

  if (isWatch) {
    // Watch 模式
    const contexts = await Promise.all(builds.map(b => esbuild.context(b)));
    await Promise.all(contexts.map(ctx => ctx.watch()));
    console.log('👀 Watch 模式已启动，监听文件变更...');
  } else {
    // 单次构建
    await Promise.all(builds.map(b => esbuild.build(b)));
    console.log('✅ 构建完成！');
  }
}

build().catch((err) => {
  console.error('❌ 构建失败:', err);
  process.exit(1);
});
