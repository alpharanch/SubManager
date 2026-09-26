import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import App from './App';
import { useStore } from './store';

// ?demo shows fictional sample data instead of a real YouTube account.
const mode = new URLSearchParams(window.location.search).has('demo') ? 'demo' : 'live';
void useStore.getState().init(mode);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
