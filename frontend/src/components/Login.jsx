
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./Login.css";

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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

  const validate = () => {
    const newErrors = {};
    const emailRegex = /\S+@\S+\.\S+/;
    if (!emailRegex.test(email)) {
      newErrors.email = "Ingresa un correo válido";
    }
    if (mode !== "VERIFY" && password.length < 6) {
      newErrors.password = "Mínimo 6 caracteres";
    }
    if (mode === "REGISTER" && name.trim().length < 2) {
      newErrors.name = "Ingresa tu nombre";
    }
    if (mode === "VERIFY" && code.length !== 6) {
      newErrors.code = "El código debe ser de 6 dígitos";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setApiError(""); setApiSuccess("");
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/login`, { username: email, email, password });
      if (res.data?.token) {
        localStorage.setItem("token", res.data.token);
        if (remember) localStorage.setItem("remembered_user", email);
        navigate("/dashboard");
      }
    } catch (err) {
      setApiError(err.response?.data?.error || "Credenciales incorrectas.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setApiError(""); setApiSuccess("");
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/register`, { name, email, password });
      setApiSuccess(res.data.message);
      setMode("VERIFY");
    } catch (err) {
      setApiError(err.response?.data?.error || "Error al registrar.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setApiError(""); setApiSuccess("");
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/verify`, { email, code });
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

        <h1>{mode === "LOGIN" ? "Iniciar sesión" : mode === "REGISTER" ? "Registro" : "Verificación"}</h1>
        <p className="subtitle">
          {mode === "LOGIN" ? "Bienvenido de nuevo, te estábamos esperando" : 
           mode === "REGISTER" ? "Crea tu cuenta gratis" : 
           "Revisa tu correo por el código de 6 dígitos"}
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
              <input type="text" placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} className={errors.name ? "invalid" : ""} />
              {errors.name && <span className="error">{errors.name}</span>}
            </div>
          )}

          {(mode === "LOGIN" || mode === "REGISTER") && (
            <>
              <div className="field">
                <label>Correo electrónico</label>
                <input type="text" placeholder="tu@correo.com" value={email} onChange={(e) => setEmail(e.target.value)} className={errors.email ? "invalid" : ""} />
                {errors.email && <span className="error">{errors.email}</span>}
              </div>

              <div className="field">
                <label>Contraseña</label>
                <div className="password-wrapper">
                  <input type={showPassword ? "text" : "password"} placeholder="••••••" value={password} onChange={(e) => setPassword(e.target.value)} className={errors.password ? "invalid" : ""} />
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
              <label>Código de verificación</label>
              <input type="text" placeholder="123456" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} className={errors.code ? "invalid" : ""} />
              {errors.code && <span className="error">{errors.code}</span>}
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
