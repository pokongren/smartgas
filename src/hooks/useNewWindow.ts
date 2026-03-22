import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 将指定组件切换到一个独立的新浏览器窗口中渲染 (基于 Route 和 BroadcastChannel)
 * @param channelName 通信频道名称，必须全局唯一 (如: 'ai-assistant-sync')
 * @param routePath 弹窗页面的路由地址 (如: '/popout/assistant')
 */
export function useNewWindow(channelName: string, routePath: string) {
    const [isPoppedOut, setIsPoppedOut] = useState(false);
    const newWindow = useRef<Window | null>(null);
    const channel = useRef<BroadcastChannel | null>(null);

    useEffect(() => {
        // 监听当前页面被卸载时，自动关掉子窗口
        const handleUnload = () => {
            newWindow.current?.close();
        };
        window.addEventListener('beforeunload', handleUnload);

        return () => {
            window.removeEventListener('beforeunload', handleUnload);
            newWindow.current?.close();
            if (channel.current) {
                channel.current.close();
            }
        };
    }, []);

    // 接收子窗口的通信（比如子窗口被关闭了，主窗口要恢复挂载）
    useEffect(() => {
        if (!channel.current) {
            channel.current = new BroadcastChannel(channelName);
        }
        const bc = channel.current;

        bc.onmessage = (event) => {
            if (event.data?.type === 'POPOUT_CLOSED') {
                setIsPoppedOut(false);
                newWindow.current = null;
            }
        };

        return () => {
            bc.onmessage = null;
        };
    }, [channelName]);

    const popOut = useCallback((width = 400, height = 600, title = '新窗口') => {
        if (isPoppedOut) return;

        // 计算居中位置
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        // 打开独立路由
        const url = `/#${routePath}`;
        const win = window.open(
            url,
            channelName, // target name
            `width=${width},height=${height},left=${left},top=${top},titlebar=${title}`
        );

        if (!win) {
            alert('请允许浏览器弹出独立窗口！(点击地址栏右侧拦截提示)');
            return;
        }

        win.document.title = title;
        newWindow.current = win;
        setIsPoppedOut(true);

        // 监控外部窗口的关闭状态(轮询作为兜底，主要靠 BroadcastChannel)
        const checkClosed = setInterval(() => {
            if (win.closed) {
                clearInterval(checkClosed);
                setIsPoppedOut(false);
                newWindow.current = null;
            }
        }, 1000);

    }, [isPoppedOut, routePath, channelName]);

    const closePopOut = useCallback(() => {
        if (newWindow.current && !newWindow.current.closed) {
            newWindow.current.close();
        }
        setIsPoppedOut(false);
        newWindow.current = null;
    }, []);

    return { isPoppedOut, popOut, closePopOut };
}

/**
 * 专供弹窗页面内部使用的 Hook：负责初始化背景，并向父窗口发送关闭心跳
 */
export function usePopoutSync(channelName: string) {
    useEffect(() => {
        const channel = new BroadcastChannel(channelName);

        // 给 html 添加基础黑色样式防白屏刺眼
        document.documentElement.style.backgroundColor = '#0c1218';
        document.body.style.backgroundColor = '#0c1218';

        // 监听页面关闭事件，通知主程序恢复渲染
        window.addEventListener('beforeunload', () => {
            channel.postMessage({ type: 'POPOUT_CLOSED' });
        });

        return () => {
            channel.close();
        };
    }, [channelName]);
}
