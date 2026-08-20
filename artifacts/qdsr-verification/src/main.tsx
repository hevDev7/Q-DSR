import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), so a boundary that already handled an
  // error does not also trigger Vite's full-screen overlay in development.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

// Dev-only: lets the merkle root of the browser SDK be compared against the
// server's in a real browser. Stripped from production builds by the guard.
if (import.meta.env.DEV) {
  void import('./lib/evidence-upload').then((m) => {
    (window as unknown as Record<string, unknown>).__probeMerkleRoot = m.__probeMerkleRoot;
  });
}
