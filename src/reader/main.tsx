import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { Reader } from './Reader';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Reader />
  </StrictMode>,
);
