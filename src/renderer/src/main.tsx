import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/error-boundary'

// Surface any unhandled promise rejection in the renderer instead of letting
// it disappear silently. Production builds remove the StrictMode warnings,
// so this is the safety net users actually rely on.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer] unhandledrejection:', event.reason)
})
window.addEventListener('error', (event) => {
  console.error('[renderer] window error:', event.error ?? event.message)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
