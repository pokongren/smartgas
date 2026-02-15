import React from 'react'
/**
 * 路由预加载工具
 * 
 * 使用场景：
 * 1. 用户 hover 导航菜单时预加载目标路由
 * 2. 当前页面空闲时预加载下一页
 * 3. 根据用户行为预测预加载
 */

// 路由组件映射表
const routeChunkMap: Record<string, () => Promise<any>> = {
  '/tech': () => import('../views/TechView'),
  '/map-demo': () => import('../views/MapDemo'),
  '/global': () => import('../views/GlobalPipelineView'),
};

// 已预加载的 chunk 集合
const prefetchedChunks = new Set<string>();

/**
 * 预加载指定路由的组件
 * @param path 路由路径
 */
export const prefetchRoute = (path: string): void => {
  const loader = routeChunkMap[path];
  if (!loader) return;

  if (prefetchedChunks.has(path)) {
    console.log(`[Prefetch] ${path} already loaded`);
    return;
  }

  // 使用 requestIdleCallback 在浏览器空闲时预加载
  const doPrefetch = () => {
    loader().then(() => {
      prefetchedChunks.add(path);
      console.log(`[Prefetch] ${path} loaded successfully`);
    }).catch(err => {
      console.warn(`[Prefetch] ${path} failed:`, err);
    });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(doPrefetch, { timeout: 2000 });
  } else {
    // 降级：使用 setTimeout
    setTimeout(doPrefetch, 100);
  }
};

/**
 * 预加载多个路由
 * @param paths 路由路径数组
 * @param priority 是否高优先级（立即加载）
 */
export const prefetchRoutes = (paths: string[], priority = false): void => {
  if (priority) {
    paths.forEach(prefetchRoute);
  } else {
    // 分批预加载，避免网络拥堵
    paths.forEach((path, index) => {
      setTimeout(() => prefetchRoute(path), index * 100);
    });
  }
};

/**
 * 根据当前路由预加载相关路由
 * @param currentPath 当前路径
 */
export const prefetchRelatedRoutes = (currentPath: string): void => {
  const routeRelations: Record<string, string[]> = {
    '/': ['/tech', '/global'],
    '/tech': ['/global', '/'],
    '/global': ['/tech'],
  };

  const related = routeRelations[currentPath];
  if (related) {
    prefetchRoutes(related);
  }
};

/**
 * 使用 Intersection Observer 预加载可见区域的链接
 * @param container 容器元素
 */
export const setupPrefetchObserver = (container?: HTMLElement): void => {
  if (!('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const link = entry.target as HTMLAnchorElement;
          const href = link.getAttribute('href');
          if (href && href.startsWith('/')) {
            prefetchRoute(href);
          }
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '100px' }
  );

  const target = container || document;
  target.querySelectorAll('a[href^="/"]').forEach(link => {
    observer.observe(link);
  });
};

/**
 * React Hook: 使用预加载
 * @param currentPath 当前路径
 */
export const useRoutePrefetch = (currentPath: string) => {
  React.useEffect(() => {
    // 页面加载完成后 3 秒预加载相关路由
    const timer = setTimeout(() => {
      prefetchRelatedRoutes(currentPath);
    }, 3000);

    return () => clearTimeout(timer);
  }, [currentPath]);
};

// 导出默认对象
export default {
  prefetchRoute,
  prefetchRoutes,
  prefetchRelatedRoutes,
  setupPrefetchObserver,
};
