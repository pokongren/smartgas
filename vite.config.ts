import path from 'path';
import { defineConfig, loadEnv, splitVendorChunkPlugin } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const isDev = mode === 'development';

  return {
    // ===== 开发服务器优化 =====
    server: {
      port: 3000,
      host: '0.0.0.0',
      // HMR 优化：禁用全屏错误覆盖层
      hmr: {
        overlay: false,
      },
      // API 代理 - 将工作流 API 转发到后端
      // NOTE: 将所有 /api 请求代理到后端，包括工作流、AI 助手等所有 API
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
      // 预编译常用文件
      warmup: {
        clientFiles: ['./src/main.tsx', './src/App.tsx'],
      },
    },

    plugins: [
      react(),
      // 自动 vendor chunk 分割
      splitVendorChunkPlugin(),
      // 包体积分析（仅分析模式）
      process.env.ANALYZE === 'true' && visualizer({
        open: true,
        gzipSize: true,
        brotliSize: true,
        filename: './dist/stats.html',
        template: 'treemap',
      }),
    ].filter(Boolean),

    // ===== 依赖预构建优化（解决冷启动慢） =====
    optimizeDeps: {
      // 强制预构建的依赖
      include: [
        'react',
        'react-dom',
        'react-router-dom',
        'axios',
        '@amap/amap-jsapi-loader',
      ],
      // 排除不需要预构建的
      exclude: [],
      // 启用依赖缓存
      force: false,
      // ESBuild 优化选项
      esbuildOptions: {
        target: 'es2020',
      },
    },

    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      // 消除 __DEV__ 等标志
      __DEV__: JSON.stringify(isDev),
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      // 优化模块解析 - 优先使用浏览器版本
      mainFields: ['browser', 'module', 'jsnext:main', 'jsnext'],
    },

    css: {
      modules: {
        localsConvention: 'camelCase',
      },
      // 开发时使用 SourceMap
      devSourcemap: isDev,
    },

    // ===== 生产构建优化 =====
    build: {
      // 目标浏览器
      target: 'es2020',
      // 启用 Terser 压缩
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: !isDev, // 移除 console
          drop_debugger: !isDev, // 移除 debugger
          pure_funcs: ['console.log', 'console.info', 'console.debug'], // 纯函数优化
        },
        format: {
          comments: false, // 移除注释
        },
      },

      // Source Map 策略：开发用 inline，生产关闭
      sourcemap: isDev ? 'inline' : false,

      // CSS 优化
      cssMinify: true,

      // 资源内联阈值：4KB 以下内联
      assetsInlineLimit: 4096,

      // 代码分割策略
      rollupOptions: {
        output: {
          // 手动 chunk 分割策略
          manualChunks(id) {
            // 将路由组件单独打包
            if (id.includes('src/views/')) {
              return 'views';
            }
            // 组件分离
            if (id.includes('src/components/map-view/')) {
              return 'map-components';
            }
            // node_modules 分包
            if (id.includes('node_modules')) {
              // React 核心库
              if (id.includes('react') || id.includes('react-dom')) {
                return 'react-core';
              }
              // 路由
              if (id.includes('react-router')) {
                return 'router';
              }
              // 地图库
              if (id.includes('@amap')) {
                return 'amap';
              }
              // 其他按包名分块
              const match = id.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
              if (match) {
                return `vendor-${match[1].replace('/', '-')}`;
              }
            }
          },
          // 入口文件命名
          entryFileNames: 'js/[name]-[hash].js',
          // chunk 文件命名
          chunkFileNames: 'js/[name]-[hash].js',
          // 资源文件命名
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name || '';
            if (/\.css$/.test(info)) {
              return 'css/[name]-[hash][extname]';
            }
            if (/\.(png|jpe?g|gif|svg|webp|ico)$/.test(info)) {
              return 'img/[name]-[hash][extname]';
            }
            if (/\.(woff2?|eot|ttf|otf)$/.test(info)) {
              return 'fonts/[name]-[hash][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          },
        },
        // Tree Shaking 优化
        treeshake: {
          moduleSideEffects: false,
          propertyReadSideEffects: false,
        },
      },

      // 分块大小警告阈值
      chunkSizeWarningLimit: 500, // KB

      // 报告压缩后大小（关闭以加速构建）
      reportCompressedSize: false,

      // 清空输出目录
      emptyOutDir: true,
    },

    // ===== 预览配置 =====
    preview: {
      port: 4173,
      host: '0.0.0.0',
    },

    // ===== ESBuild 优化 =====
    esbuild: {
      drop: isDev ? [] : ['console', 'debugger'],
      legalComments: 'none',
    },
  };
});
