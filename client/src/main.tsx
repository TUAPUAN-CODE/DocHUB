import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
// the default font is bundled with the app: a phone on a Wi-Fi without internet used to wait for fonts.googleapis.com (a blocking request) before showing anything
import '@fontsource/prompt/thai-300.css'; import '@fontsource/prompt/thai-400.css'; import '@fontsource/prompt/thai-500.css'; import '@fontsource/prompt/thai-600.css'; import '@fontsource/prompt/thai-700.css';
import '@fontsource/prompt/latin-300.css'; import '@fontsource/prompt/latin-400.css'; import '@fontsource/prompt/latin-500.css'; import '@fontsource/prompt/latin-600.css'; import '@fontsource/prompt/latin-700.css';
import './index.css';
import '@/store/theme';
import App from './App';

import { isStaleBuildError, reloadForNewBuild } from './lib/staleBuild';

// After a deploy (git pull) a page that was already open still runs the old build, whose code pieces are gone from the server:
// opening the PDF export, a dialog or a page then fails with "Failed to fetch dynamically imported module". Load the new build.
window.addEventListener('vite:preloadError', (e) => { e.preventDefault(); reloadForNewBuild(); });
window.addEventListener('unhandledrejection', (e) => { if (isStaleBuildError(e.reason)) reloadForNewBuild(); });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </BrowserRouter>
  </React.StrictMode>,
);
