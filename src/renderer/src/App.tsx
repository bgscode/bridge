import React from 'react'

function App(): React.JSX.Element {
  return (
    <div
      style={{
        backgroundColor: 'red',
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <h1 style={{ color: 'white', fontSize: '2rem', fontWeight: 'bold' }}>
        Hello World — Inline Style Test
      </h1>
    </div>
  )
}

export default App
