import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./Login.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";
axios.defaults.withCredentials = true;

export default function Login() {
  const [mode, setMode] = useState("LOGIN"); // LOGIN, REGISTER, VERIFY
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState("");
  const [apiSuccess, setApiSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Si ya existe una sesión previa, redirigir al Dashboard
    const token = localStorage.getItem("token");
    if (token) {
      navigate("/dashboard");
    }
  }, [navigate]);

  const validate = () => {
    const newErrors = {};
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const cleanId = email.trim();

    if (mode === "LOGIN") {
      if (!cleanId) {
        newErrors.email = "Ingresa tu correo o usuario 'admin'";
      } else if (cleanId.toLowerCase() !== "admin" && !emailRegex.test(cleanId)) {
        newErrors.email = "Ingresa un correo válido o 'admin'";
      }
    } else if (mode === "REGISTER") {
      if (!emailRegex.test(cleanId)) {
        newErrors.email = "Ingresa un correo electrónico válido";
      }
    }

    if (mode !== "VERIFY" && (password.length < 6 || password.length > 128)) {
      newErrors.password = "La contraseña debe tener entre 6 y 128 caracteres";
    }
    if (mode === "REGISTER" && (name.trim().length < 2 || name.trim().length > 100)) {
      newErrors.name = "Ingresa tu nombre (entre 2 y 100 caracteres)";
    }
    if (mode === "VERIFY" && !/^\d{6}$/.test(code.trim())) {
      newErrors.code = "El código debe ser de 6 dígitos numéricos";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loading) return;
    setApiError(""); setApiSuccess("");
    if (!validate()) return;
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const res = await axios.post(`${API_BASE}/api/login`, {
        username: cleanEmail,
        email: cleanEmail,
        password
      }, { withCredentials: true });

      if (res.data?.token) {
        localStorage.setItem("token", res.data.token);
        if (remember) localStorage.setItem("remembered_user", cleanEmail);
        navigate("/dashboard");
      }
    } catch (err) {
      setApiError(err.response?.data?.error || "Credenciales incorrectas o servidor no disponible.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (loading) return;
    setApiError(""); setApiSuccess("");
    if (!validate()) return;
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const res = await axios.post(`${API_BASE}/api/register`, {
        name: name.trim(),
        email: cleanEmail,
        password
      }, { withCredentials: true });

      if (res.data?.token) {
        localStorage.setItem("token", res.data.token);
        navigate("/dashboard");
      } else {
        setApiSuccess(res.data.message || "Código enviado a tu correo Gmail.");
        setMode("VERIFY");
      }
    } catch (err) {
      setApiError(err.response?.data?.error || "Error al registrar la cuenta.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (loading) return;
    setApiError(""); setApiSuccess("");
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const res = await axios.post(`${API_BASE}/api/resend-code`, {
        email: cleanEmail
      }, { withCredentials: true });
      setApiSuccess(res.data.message || "Se ha enviado un nuevo código a tu correo Gmail.");
    } catch (err) {
      setApiError(err.response?.data?.error || "Error al reenviar el código.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (loading) return;
    setApiError(""); setApiSuccess("");
    if (!validate()) return;
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const res = await axios.post(`${API_BASE}/api/verify`, {
        email: cleanEmail,
        code: code.trim()
      }, { withCredentials: true });

      if (res.data?.token) {
        localStorage.setItem("token", res.data.token);
        navigate("/dashboard");
      }
    } catch (err) {
      setApiError(err.response?.data?.error || "Código incorrecto o expirado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`login-page ${darkMode ? "dark" : ""}`}>
      <div className="login-header">
        <button type="button" className="theme-toggle-btn" onClick={() => setDarkMode((d) => !d)}>
          {darkMode ? "☀ Modo Claro" : "🌙 Modo Oscuro"}
        </button>
      </div>

      <main className="login-card">
        <div className="login-logo">
          <svg viewBox="0 0 24 24" width="64" height="64" fill="#fff"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l4.9-1.4A10 10 0 1 0 12 2zm5.2 14.1c-.2.6-1.2 1.2-1.7 1.2-.4.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.6-2.7-1.2-4.4-3.9-4.5-4.1-.1-.2-1.1-1.4-1.1-2.7s.7-1.9.9-2.200c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.3.4-.4.4c-.1.1-.3.3-.1.6.2.3.7 1.200 1.600 1.900 1.100 1 2 1.300 2.300 1.400.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.600-.1l1.900.9c.3.1.5.2.5.3.1.2.1.700-.1 1.300z" /></svg>
        </div>

        <h1>{mode === "LOGIN" ? "Iniciar sesión" : mode === "REGISTER" ? "Registro" : "Verificación por Correo"}</h1>
        <p className="subtitle">
          {mode === "LOGIN" ? "Bienvenido de nuevo, te estábamos esperando" : 
           mode === "REGISTER" ? "Crea tu cuenta y valida tu código de Gmail" : 
           "Ingresa el código de 6 dígitos que enviamos a tu correo Gmail"}
        </p>

        {apiError && <div className="api-error-banner">{apiError}</div>}
        {apiSuccess && <div style={{backgroundColor: "#dcf8c6", color: "#075e54", padding: "10px 14px", borderRadius: "8px", marginBottom: "15px", fontSize: "14px", lineHeight: "1.4"}}>{apiSuccess}</div>}

        {mode === "VERIFY" && (
          <div style={{
            backgroundColor: "rgba(245, 158, 11, 0.12)",
            color: "#b45309",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            padding: "10px 14px",
            borderRadius: "8px",
            marginBottom: "15px",
            fontSize: "13px",
            lineHeight: "1.4",
            textAlign: "left"
          }}>
            ℹ️ Si no te llega al Gmail, por favor revisa la <strong>bandeja de spam</strong> ya que es una versión gratuita.
          </div>
        )}

        <form onSubmit={mode === "LOGIN" ? handleLogin : mode === "REGISTER" ? handleRegister : handleVerify} noValidate>
          
          {mode === "REGISTER" && (
            <div className="field">
              <label>Nombre</label>
              <input
                type="text"
                placeholder="Tu nombre"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={errors.name ? "invalid" : ""}
              />
              {errors.name && <span className="error">{errors.name}</span>}
            </div>
          )}

          {(mode === "LOGIN" || mode === "REGISTER") && (
            <>
              <div className="field">
                <label>{mode === "LOGIN" ? "Correo electrónico o Usuario" : "Correo electrónico"}</label>
                <input
                  type={mode === "LOGIN" ? "text" : "email"}
                  placeholder={mode === "LOGIN" ? "gonzalezyonild@gmail.com o admin" : "tu@correo.com"}
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={errors.email ? "invalid" : ""}
                />
                {errors.email && <span className="error">{errors.email}</span>}
              </div>

              <div className="field">
                <label>Contraseña</label>
                <div className="password-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••"
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={errors.password ? "invalid" : ""}
                  />
                  <button type="button" className="toggle" onClick={() => setShowPassword((s) => !s)}>
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
                {errors.password && <span className="error">{errors.password}</span>}
              </div>
            </>
          )}

          {mode === "VERIFY" && (
            <div className="field">
              <label>Código de verificación (6 dígitos)</label>
              <input
                type="text"
                placeholder="123456"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className={errors.code ? "invalid" : ""}
                style={{ textAlign: "center", fontSize: "22px", letterSpacing: "6px", fontFamily: "monospace" }}
              />
              {errors.code && <span className="error">{errors.code}</span>}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px", fontSize: "13px" }}>
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={loading}
                  style={{ background: "none", border: "none", color: "#00a884", cursor: "pointer", textDecoration: "underline", padding: 0 }}
                >
                  Reenviar código por Gmail
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("REGISTER"); setCode(""); setApiError(""); setApiSuccess(""); }}
                  style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", textDecoration: "underline", padding: 0 }}
                >
                  Cambiar datos
                </button>
              </div>
            </div>
          )}

          {mode === "LOGIN" && (
            <div className="options">
              <label className="remember">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Recordarme
              </label>
              <a href="#forgot" onClick={(e) => { e.preventDefault(); alert("Contacte al administrador."); }}>¿Olvidaste tu contraseña?</a>
            </div>
          )}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? <span className="spinner" /> : mode === "LOGIN" ? "Entrar" : mode === "REGISTER" ? "Registrarse" : "Verificar y Entrar"}
          </button>
        </form>

        <p className="signup" style={{ marginTop: "15px" }}>
          {mode === "LOGIN" ? (
            <>¿No tienes cuenta? <a href="#registro" onClick={(e) => { e.preventDefault(); setEmail(""); setPassword(""); setMode("REGISTER"); }}>Regístrate</a></>
          ) : (
            <>¿Ya tienes cuenta? <a href="#login" onClick={(e) => { e.preventDefault(); setMode("LOGIN"); }}>Inicia Sesión</a></>
          )}
        </p>
      </main>
    </div>
  );
}
