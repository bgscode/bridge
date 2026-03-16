import { Suspense } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/layout'
import { routes } from '@/routes'
import { ThemeProvider } from './components/theme-provider'

function App(): React.JSX.Element {
  return (
    <HashRouter>
      <ThemeProvider>
        <Layout>
          <Suspense fallback={<div className="text-muted-foreground text-sm">Loading...</div>}>
            <Routes>
              {routes.map((route) => (
                <Route key={route.path} path={route.path} element={route.element} />
              ))}
            </Routes>
          </Suspense>
        </Layout>
      </ThemeProvider>
    </HashRouter>
  )
}

export default App
