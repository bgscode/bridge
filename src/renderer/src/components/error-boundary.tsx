import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Top-level error boundary.
 *
 * Without this, any uncaught render error blanks the entire window. With it,
 * the user sees a recovery card and can reload without losing the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] uncaught render error:', error, info.componentStack)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private handleReset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          color: '#e2e8f0',
          fontFamily: 'system-ui, sans-serif',
          padding: 24
        }}
      >
        <div
          style={{
            maxWidth: 560,
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 12,
            padding: 24,
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)'
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, color: '#f87171' }}>Something went wrong</h2>
          <p style={{ marginTop: 8, fontSize: 13, color: '#cbd5e1' }}>
            The app hit an unexpected error and recovered. You can try again or reload the window.
          </p>
          <pre
            style={{
              marginTop: 12,
              padding: 12,
              background: '#0f172a',
              color: '#fca5a5',
              borderRadius: 8,
              fontSize: 12,
              maxHeight: 180,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {error.message}
          </pre>
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                border: '1px solid #475569',
                borderRadius: 6,
                color: '#e2e8f0',
                cursor: 'pointer'
              }}
            >
              Try again
            </button>
            <button
              onClick={this.handleReload}
              style={{
                padding: '8px 14px',
                background: '#2563eb',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
