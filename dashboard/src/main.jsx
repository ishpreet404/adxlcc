import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { initPwa } from './lib/pwa';
import './index.css';

initPwa();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
