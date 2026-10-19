import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

class AppErrorBoundary extends React.Component {
  state = { hasError: false, retryKey: 0 };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Dashboard render error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState(state => ({
      hasError: false,
      retryKey: state.retryKey + 1
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <main style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          background: '#f1f5f9',
          color: '#0f172a',
          fontFamily: 'system-ui, sans-serif'
        }}>
          <section style={{
            width: 'min(100%, 480px)',
            padding: '32px',
            borderRadius: '16px',
            background: '#fff',
            boxShadow: '0 12px 40px rgba(15, 23, 42, 0.12)',
            textAlign: 'center'
          }}>
            <h1 style={{ margin: '0 0 12px', fontSize: '22px' }}>El panel tuvo un problema</h1>
            <p style={{ margin: '0 0 24px', lineHeight: 1.6, color: '#475569' }}>
              Tus datos guardados no se han eliminado. Puedes volver a cargar el panel o regresar al inicio de sesión.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={this.handleRetry}
                style={{
                  padding: '10px 16px',
                  border: 0,
                  borderRadius: '8px',
                  background: '#008f6f',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Reintentar
              </button>
              <a href="/login" style={{ alignSelf: 'center', color: '#008f6f', fontWeight: 600 }}>
                Volver al inicio de sesión
              </a>
            </div>
          </section>
        </main>
      );
    }

    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}

function App() {
  return (
    <BrowserRouter>
      <AppErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AppErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
