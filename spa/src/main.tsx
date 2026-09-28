import '@fontsource-variable/dm-sans/wght.css'
import '@fontsource-variable/noto-sans-jp/wght.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SvgSpriteDefs } from './icons/SvgSpriteDefs'
import './index.css'
import './stores/preferencesWatcher'
import { installRedmineRootHeightFit } from './utils/redmineRootHeight'

const rootElement = document.getElementById('redmine-canvas-gantt-root') || document.getElementById('root');
rootElement?.classList.add('rcg-theme');
if (rootElement?.id === 'redmine-canvas-gantt-root') {
  installRedmineRootHeightFit(rootElement);
}
createRoot(rootElement!).render(
  <StrictMode>
    <SvgSpriteDefs />
    <App />
  </StrictMode>,
)
