'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import './login.css';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        router.push('/live');
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.message || 'Nieprawidłowa nazwa użytkownika lub hasło');
      }
    } catch {
      setError('Błąd połączenia z serwerem');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-bg" />

      <div className="login-card">
        {/* Brand */}
        <div className="login-brand">
          <div className="login-logo">M</div>
          <div className="login-brand-name">Motolia</div>
          <div className="login-brand-subtitle">Analytics Dashboard</div>
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-input-group">
            <label className="login-label" htmlFor="username">
              Nazwa użytkownika
            </label>
            <input
              id="username"
              className="login-input"
              type="text"
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="login-input-group">
            <label className="login-label" htmlFor="password">
              Hasło
            </label>
            <input
              id="password"
              className="login-input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="login-error">
              <span>⚠️</span>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="login-btn"
            disabled={loading || !username || !password}
          >
            {loading ? (
              <>
                <span
                  className="spinner"
                  style={{
                    width: 16,
                    height: 16,
                    borderWidth: 2,
                    borderColor: 'rgba(255,255,255,0.3)',
                    borderTopColor: 'white',
                  }}
                />
                Logowanie...
              </>
            ) : (
              'Zaloguj się'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
