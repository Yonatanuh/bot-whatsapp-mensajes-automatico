import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AlertTriangle, RefreshCw, RotateCcw, LogIn } from 'lucide-react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

class AppErrorBoundary extends React.Component {
  state = { hasError: false, retryKey: 0, errorMessage: '', componentStack: '' };

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : 'Error de interfaz no identificado.'
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Application render error:', error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack || '' });
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && this.props.location?.pathname !== prevProps.location?.pathname) {
      this.setState({ hasError: false, errorMessage: '', componentStack: '' });
    }
  }

  handleRetry = () => {
    this.setState(state => ({
      hasError: false,
      retryKey: state.retryKey + 1,
      errorMessage: '',
      componentStack: ''
    }));
  };

  handleReload = () => {
    window.location.reload();
  };

  handleGoToLogin = (e) => {
    if (e) e.preventDefault();
    try {
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
    } catch {}
    this.setState({ hasError: false, errorMessage: '', componentStack: '' });
    window.location.href = '/login';
  };

  handleClearCacheAndReload = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      if ('caches' in window) {
        caches.keys().then(names => {
          names.forEach(name => caches.delete(name));
        });
      }
    } catch {}
    window.location.href = '/login?v=' + Date.now();
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-error-screen" role="alert">
          <section className="app-error-card">
            <span className="app-error-icon" aria-hidden="true">
              <AlertTriangle size={24} />
            </span>
            <p className="app-error-eyebrow">Recuperación del sistema</p>
            <h1>Esta vista no se pudo mostrar</h1>
            <p className="app-error-copy">
              La aplicación encontró un detalle al dibujar esta pantalla. Puedes reintentar la vista, recargar el sitio o regresar de inmediato al inicio de sesión.
            </p>
            <pre className="app-error-detail">{this.state.errorMessage}</pre>
            {this.state.componentStack && (
              <details className="app-error-components">
                <summary>Mostrar ubicación del error</summary>
                <pre>{this.state.componentStack}</pre>
              </details>
            )}
            <div className="app-error-actions">
              <button type="button" className="app-error-primary" onClick={this.handleRetry}>
                <RotateCcw size={16} />
                Reintentar vista
              </button>
              <button type="button" className="app-error-secondary" onClick={this.handleReload}>
                <RefreshCw size={16} />
                Recargar sitio
              </button>
              <button type="button" className="app-error-secondary" onClick={this.handleClearCacheAndReload} style={{ borderColor: "var(--wa-button)", color: "var(--wa-button)" }}>
                <RefreshCw size={16} />
                Limpiar Caché y Actualizar
              </button>
            </div>
            <div style={{ marginTop: '16px' }}>
              <button
                type="button"
                onClick={this.handleGoToLogin}
                className="app-error-link"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: 'var(--wa-button, #008f6f)',
                  fontWeight: 600,
                  fontSize: '14px'
                }}
              >
                <LogIn size={15} />
                Volver al inicio de sesión
              </button>
            </div>
          </section>
        </main>
      );
    }

    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}

function RouteBoundary({ children }) {
  const location = useLocation();
  return (
    <AppErrorBoundary key={location.pathname} location={location}>
      {children}
    </AppErrorBoundary>
  );
}

function App() {
  return (
    <BrowserRouter>
      <RouteBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </RouteBoundary>
    </BrowserRouter>
  );
}

export default App;
