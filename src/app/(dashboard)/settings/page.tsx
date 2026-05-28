'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import DataTable from '@/components/ui/DataTable';
import './settings.css';

interface TVScheduleRow {
  date: string;
  time: string;
  station: string;
  pasmo: string;
  duration: number;
}

interface ImportLog {
  id: number;
  filename: string;
  recordCount: number;
  mode: 'add' | 'overwrite';
  importedAt: string;
}

export default function SettingsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [preview, setPreview] = useState<TVScheduleRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [overwrite, setOverwrite] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/tv-schedule');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleFile = useCallback((f: File | null) => {
    if (!f) return;
    setFile(f);
    setStatus(null);

    // Try to parse CSV for preview
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;
      const lines = text.trim().split('\n');
      if (lines.length < 2) return;

      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const rows: TVScheduleRow[] = [];

      for (let i = 1; i < Math.min(lines.length, 11); i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        rows.push({
          date: cols[headers.indexOf('date')] || cols[0] || '',
          time: cols[headers.indexOf('time')] || cols[1] || '',
          station: cols[headers.indexOf('station')] || cols[2] || '',
          pasmo: cols[headers.indexOf('pasmo')] || cols[3] || '',
          duration: parseInt(cols[headers.indexOf('duration')] || cols[4] || '0', 10),
        });
      }
      setPreview(rows);
    };
    reader.readAsText(f);
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setStatus(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('overwrite', overwrite ? 'true' : 'false');

      const res = await fetch('/api/tv-schedule', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        setStatus({
          type: 'success',
          message: `Harmonogram załadowany pomyślnie (${preview.length}+ rekordów)`,
        });
        setFile(null);
        if (fileRef.current) fileRef.current.value = '';
        fetchLogs(); // refresh log history instantly
      } else {
        const err = await res.text();
        setStatus({
          type: 'error',
          message: `Błąd przesyłania: ${err || res.statusText}`,
        });
      }
    } catch {
      setStatus({
        type: 'error',
        message: 'Błąd połączenia z serwerem',
      });
    } finally {
      setUploading(false);
    }
  };

  const previewColumns = [
    { key: 'date' as const, label: 'Data' },
    { key: 'time' as const, label: 'Czas' },
    { key: 'station' as const, label: 'Stacja' },
    { key: 'pasmo' as const, label: 'Pasmo' },
    {
      key: 'duration' as const,
      label: 'Czas (s)',
      align: 'right' as const,
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51-1z" />
              </svg>
            </span>
            Ustawienia
          </h1>
          <p className="page-subtitle">
            Konfiguracja systemu i importy danych
          </p>
        </div>
      </div>

      <div className="settings-sections">
        {/* TV Schedule Upload */}
        <div className="settings-card">
          <div className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center', color: 'var(--accent-purple)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                <line x1="7" y1="2" x2="7" y2="22" />
                <line x1="17" y1="2" x2="17" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <line x1="2" y1="7" x2="7" y2="7" />
                <line x1="2" y1="17" x2="7" y2="17" />
                <line x1="17" y1="17" x2="22" y2="17" />
                <line x1="17" y1="7" x2="22" y2="7" />
              </svg>
            </span>
            Harmonogram TV — Import CSV
          </div>

          {/* Import Method Toggle */}
          <div className="settings-import-mode" style={{ margin: '16px 0', padding: '12px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Metoda importu:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.875rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-primary)' }}>
                <input 
                  type="radio" 
                  name="importMode" 
                  checked={overwrite === true} 
                  onChange={() => setOverwrite(true)} 
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ fontWeight: overwrite ? 600 : 400 }}>Nadpisz istniejące emisje z dni obecnych w pliku (zalecane)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-primary)' }}>
                <input 
                  type="radio" 
                  name="importMode" 
                  checked={overwrite === false} 
                  onChange={() => setOverwrite(false)} 
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ fontWeight: !overwrite ? 600 : 400 }}>Dopisz nowe emisje, zachowując istniejące</span>
              </label>
            </div>
          </div>

          <div
            className={`settings-upload-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFile(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="settings-file-input"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            <div className="settings-upload-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            <div className="settings-upload-text">
              {file
                ? file.name
                : 'Przeciągnij plik CSV lub kliknij, aby wybrać'}
            </div>
            <div className="settings-upload-hint">
              Kolumny: date, time, station, pasmo, duration
            </div>
          </div>

          {file && (
            <div style={{ marginTop: 16 }}>
              <button
                className="btn btn-primary"
                onClick={handleUpload}
                disabled={uploading}
                style={{ width: '100%' }}
              >
                {uploading ? (
                  <>
                    <span className="spinner" /> Przesyłanie...
                  </>
                ) : (
                  '📤 Wyślij harmonogram'
                )}
              </button>
            </div>
          )}

          {status && (
            <div
              className={`settings-status ${status.type === 'error' ? 'error' : ''}`}
            >
              <span>{status.type === 'success' ? '✅' : '❌'}</span>
              {status.message}
            </div>
          )}

          {/* CSV Preview */}
          {preview.length > 0 && (
            <div className="settings-preview">
              <div
                style={{
                  fontSize: '0.8125rem',
                  color: 'var(--text-secondary)',
                  marginBottom: 8,
                  fontWeight: 500,
                }}
              >
                Podgląd (pierwsze {preview.length} rekordów):
              </div>
              <DataTable
                columns={previewColumns}
                data={preview as unknown as Record<string, unknown>[]}
              />
            </div>
          )}

          {/* Import History Logs */}
          {logs.length > 0 && (
            <div className="settings-logs" style={{ marginTop: 24, borderTop: '1px solid var(--border-color)', paddingTop: 20 }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📋</span> Historia ostatnich importów:
              </div>
              <div className="table-container" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>Plik</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>Wiersze</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>Tryb</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Data importu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                        <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.filename}>
                          {log.filename}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>
                          {log.recordCount} wierszy
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ 
                            padding: '2px 8px', 
                            borderRadius: '4px', 
                            fontSize: '0.6875rem', 
                            fontWeight: 600,
                            background: log.mode === 'overwrite' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                            color: log.mode === 'overwrite' ? '#ef4444' : '#10b981',
                            border: log.mode === 'overwrite' ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(16, 185, 129, 0.2)',
                            display: 'inline-block'
                          }}>
                            {log.mode === 'overwrite' ? 'Nadpisz' : 'Dopisz'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-muted)' }}>
                          {new Date(log.importedAt).toLocaleDateString('pl-PL')}{' '}
                          {new Date(log.importedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* System Info */}
        <div className="settings-card">
          <div className="settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51-1z" />
              </svg>
            </span>
            Informacje systemowe
          </div>

          <div className="settings-info-list">
            <div className="settings-info-item">
              <span className="settings-info-label">GA4 Property ID</span>
              <span className="settings-info-value">●●●●●●●●</span>
            </div>

            <div className="settings-info-item">
              <span className="settings-info-label">Ostatnia synchronizacja</span>
              <span className="settings-info-value">
                {new Date().toLocaleDateString('pl-PL')}{' '}
                {new Date().toLocaleTimeString('pl-PL', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>

            <div className="settings-info-item">
              <span className="settings-info-label">Interwał CRON</span>
              <span className="settings-info-value">*/15 * * * *</span>
            </div>

            <div className="settings-info-item">
              <span className="settings-info-label">Wersja API</span>
              <span className="settings-info-value">v1.0.0</span>
            </div>

            <div className="settings-info-item">
              <span className="settings-info-label">Status</span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span className="status-dot status-dot-active" />
                <span
                  style={{
                    fontSize: '0.875rem',
                    color: 'var(--accent-green)',
                    fontWeight: 600,
                  }}
                >
                  Aktywny
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
