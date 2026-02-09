import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.tsx'

console.log('[DEBUG] main.tsx 开始执行')

const rootElement = document.getElementById('root');
console.log('[DEBUG] root 元素:', rootElement)

if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);
console.log('[DEBUG] React root 创建成功')

root.render(<App />);
console.log('[DEBUG] React 渲染调用完成')
