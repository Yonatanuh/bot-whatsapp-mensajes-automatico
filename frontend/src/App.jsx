import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
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
              La aplicación encontró un detalle al dibujar esta pantalla. Puedes reintentar, recargar o limpiar la memoria caché del navegador para actualizar el panel a la última versión disponible.
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
            <Link className="app-error-link" to="/login">Volver al inicio de sesión</Link>
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
