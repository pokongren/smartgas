import { createRoot } from 'react-dom/client'
import './index.css'  // Tailwind CSS v4
import './styles/index.css'
// Material Symbols 图标字体已在 index.html 中通过本地 woff2 内联加载，无需此处引入
import App from './App.tsx'

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);
root.render(<App />);
