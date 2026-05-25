'use client';

import { useState, useRef, useCallback } from 'react';
import DataTable from '@/components/ui/DataTable';
import './settings.css';

interface TVScheduleRow {
  date: string;
  time: string;
  station: string;
  pasmo: string;
  duration: number;
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
  const fileRef = useRef<HTMLInputElement>(null);

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
          <h1 className="page-title">⚙️ Ustawienia</h1>
          <p className="page-subtitle">
            Konfiguracja systemu i importy danych
          </p>
        </div>
      </div>

      <div className="settings-sections">
        {/* TV Schedule Upload */}
        <div className="settings-card">
          <div className="settings-card-title">
            📺 Harmonogram TV — Import CSV
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
            <div className="settings-upload-icon">📁</div>
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
        </div>

        {/* System Info */}
        <div className="settings-card">
          <div className="settings-card-title">🔧 Informacje systemowe</div>

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
