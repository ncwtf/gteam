import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { hydrateTokens } from './store';
import './styles.css';

// 先恢复本地保存的登录 token，再渲染
hydrateTokens().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
