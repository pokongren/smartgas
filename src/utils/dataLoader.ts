/**
 * 大数据文件加载优化工具
 * 
 * 策略：
 * 1. 分块加载 - 将大数据分割成多个小文件
 * 2. 渐进加载 - 优先加载可视区域数据
 * 3. 缓存策略 - 使用 IndexedDB 缓存已加载数据
 * 4. 压缩传输 - 支持 gzip/brotli 压缩
 */

// ==================== 类型定义 ====================
interface DataChunk {
  id: string;
  data: any;
  timestamp: number;
}

interface LoadOptions {
  priority?: 'high' | 'low';
  cache?: boolean;
  chunkSize?: number;
  onProgress?: (progress: number) => void;
}

// ==================== IndexedDB 缓存 ====================
const DB_NAME = 'PipelineDataCache';
const STORE_NAME = 'dataChunks';
const DB_VERSION = 1;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

const getCachedData = async (id: string): Promise<any | null> => {
  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const result = request.result as DataChunk | undefined;
        // 缓存有效期 1 小时
        if (result && Date.now() - result.timestamp < 3600000) {
          resolve(result.data);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
};

const setCachedData = async (id: string, data: any): Promise<void> => {
  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const chunk: DataChunk = {
      id,
      data,
      timestamp: Date.now(),
    };
    
    return new Promise((resolve, reject) => {
      const request = store.put(chunk);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('Cache write failed:', error);
  }
};

// ==================== 数据加载器 ====================
class DataLoader {
  private loadingChunks = new Set<string>();
  private abortControllers = new Map<string, AbortController>();

  /**
   * 加载单个数据文件
   */
  async load<T = any>(
    url: string, 
    options: LoadOptions = {}
  ): Promise<T> {
    const { cache = true, priority = 'low', onProgress } = options;
    
    // 1. 检查缓存
    if (cache) {
      const cached = await getCachedData(url);
      if (cached) {
        console.log(`[DataLoader] Cache hit: ${url}`);
        return cached;
      }
    }

    // 2. 检查是否正在加载
    if (this.loadingChunks.has(url)) {
      console.log(`[DataLoader] Already loading: ${url}`);
      // 等待现有请求完成
      await this.waitForLoading(url);
      const cached = await getCachedData(url);
      if (cached) return cached;
    }

    // 3. 发起新请求
    this.loadingChunks.add(url);
    const controller = new AbortController();
    this.abortControllers.set(url, controller);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        priority: priority === 'high' ? 'high' : 'low',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // 4. 处理进度（如果支持）
      const contentLength = response.headers.get('content-length');
      let data: T;

      if (contentLength && onProgress) {
        const total = parseInt(contentLength, 10);
        const reader = response.body?.getReader();
        if (reader) {
          const chunks: Uint8Array[] = [];
          let loaded = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            onProgress(loaded / total);
          }

          // 合并 chunks
          const allChunks = new Uint8Array(loaded);
          let position = 0;
          for (const chunk of chunks) {
            allChunks.set(chunk, position);
            position += chunk.length;
          }

          const text = new TextDecoder().decode(allChunks);
          data = JSON.parse(text);
        } else {
          data = await response.json();
        }
      } else {
        data = await response.json();
      }

      // 5. 写入缓存
      if (cache) {
        await setCachedData(url, data);
      }

      return data;
    } finally {
      this.loadingChunks.delete(url);
      this.abortControllers.delete(url);
    }
  }

  /**
   * 分块加载大数据
   */
  async loadChunks<T = any>(
    baseUrl: string, 
    chunkCount: number,
    options: LoadOptions = {}
  ): Promise<T[]> {
    const { onProgress } = options;
    const results: T[] = [];
    let completed = 0;

    const promises = Array.from({ length: chunkCount }, async (_, i) => {
      const url = `${baseUrl}/chunk-${i}.json`;
      const data = await this.load<T>(url, {
        ...options,
        onProgress: onProgress 
          ? (p) => {
              // 简单进度计算
              onProgress((completed + p) / chunkCount);
            }
          : undefined,
      });
      completed++;
      if (onProgress) onProgress(completed / chunkCount);
      return data;
    });

    const chunks = await Promise.all(promises);
    return chunks;
  }

  /**
   * 取消加载
   */
  abort(url?: string): void {
    if (url) {
      const controller = this.abortControllers.get(url);
      controller?.abort();
    } else {
      this.abortControllers.forEach(c => c.abort());
    }
  }

  /**
   * 等待加载完成
   */
  private waitForLoading(url: string): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (!this.loadingChunks.has(url)) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }
}

// ==================== React Hook ====================
import { useState, useEffect, useCallback } from 'react';

const globalLoader = new DataLoader();

export const useDataLoader = <T = any>(url: string | null, options: LoadOptions = {}) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState(0);

  const load = useCallback(async () => {
    if (!url) return;

    setLoading(true);
    setError(null);
    setProgress(0);

    try {
      const result = await globalLoader.load<T>(url, {
        ...options,
        onProgress: setProgress,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
    return () => {
      if (url) globalLoader.abort(url);
    };
  }, [url, load]);

  return { data, loading, error, progress, reload: load };
};

export { DataLoader, globalLoader };
export default globalLoader;
