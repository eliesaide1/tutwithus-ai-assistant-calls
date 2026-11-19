import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './components/ui/AP_Button.css';
import './components/ui/AP_FormField.css';
import './main.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('The application root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
