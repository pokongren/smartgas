import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.tsx'

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);
// NOTE: 暂时禁用 StrictMode,因为它会导致高德地图组件双重初始化并崩溃
// 在生产环境中 StrictMode 不会影响,这只是开发环境的问题
root.render(<App />);