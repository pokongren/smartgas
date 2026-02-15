import { createRoot } from 'react-dom/client'
import './index.css'  // Tailwind CSS v4
import './styles/index.css'
import App from './App.tsx'

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);
root.render(<App />);
