'use client';

import { useState, useEffect, useCallback } from 'react';
import './leads.css';

interface CrmLead {
  id: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  source: 'PHONE' | 'EMAIL' | 'WEB_FORM';
  status: 'NEW' | 'IN_PROGRESS' | 'OFFER' | 'WON' | 'LOST';
  thuliumStatus: string;
  queueName: string | null;
  subject: string | null;
  agentName: string | null;
  value: number;
  url: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  thuliumCreatedAt: string;
  thuliumUpdatedAt: string;
}

interface Pagination {
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface KPIs {
  totalLeads: number;
  activeLeads: number;
  wonLeads: number;
  lostLeads: number;
  totalWonValue: number;
  totalActiveValue: number;
  conversionRate: number;
}

interface FunnelStage {
  name: string;
  stage: string;
  count: number;
}

interface FunnelOutcomes {
  won: number;
  lost: number;
}

interface AgentStat {
  name: string;
  leads: number;
  won: number;
  value: number;
  cr: number;
}

export default function LeadsPage() {
  // States
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ totalCount: 0, page: 1, limit: 20, totalPages: 1 });
  const [kpis, setKpis] = useState<KPIs>({
    totalLeads: 0,
    activeLeads: 0,
    wonLeads: 0,
    lostLeads: 0,
    totalWonValue: 0,
    totalActiveValue: 0,
    conversionRate: 0,
  });
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [funnelOutcomes, setFunnelOutcomes] = useState<FunnelOutcomes>({ won: 0, lost: 0 });
  const [agents, setAgents] = useState<AgentStat[]>([]);
  const [activeAgentsList, setActiveAgentsList] = useState<string[]>([]);
  
  const [period, setPeriod] = useState<string>('all'); // 'today', 'week', 'month', 'all', 'custom'
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const [source, setSource] = useState<string>('');
  const [agent, setAgent] = useState<string>('');
  const [page, setPage] = useState(1);

  // Debounce search term
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1); // Reset page on search
    }, 400);

    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Compute date range parameters for the API call
  const getDateParams = useCallback(() => {
    const now = new Date();
    const start = new Date();
    const end = new Date();

    if (period === 'today') {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { startDate: start.toISOString(), endDate: end.toISOString() };
    }
    
    if (period === 'week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(now.setDate(diff));
      monday.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { startDate: monday.toISOString(), endDate: end.toISOString() };
    }

    if (period === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      firstDay.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return { startDate: firstDay.toISOString(), endDate: end.toISOString() };
    }

    if (period === 'custom') {
      const ret: { startDate?: string; endDate?: string } = {};
      if (customStartDate) {
        const s = new Date(customStartDate);
        s.setHours(0, 0, 0, 0);
        ret.startDate = s.toISOString();
      }
      if (customEndDate) {
        const e = new Date(customEndDate);
        e.setHours(23, 59, 59, 999);
        ret.endDate = e.toISOString();
      }
      return ret;
    }

    return {};
  }, [period, customStartDate, customEndDate]);

  // Fetch leads and aggregates from API
  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.append('status', status);
      if (source) params.append('source', source);
      if (agent) params.append('agent', agent);
      if (debouncedSearch) params.append('search', debouncedSearch);
      
      const dateParams = getDateParams();
      if (dateParams.startDate) params.append('startDate', dateParams.startDate);
      if (dateParams.endDate) params.append('endDate', dateParams.endDate);
      
      params.append('page', String(page));
      params.append('limit', '20');

      const res = await fetch(`/api/leads?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads);
        setPagination(data.pagination);
        setKpis(data.kpis);
        setFunnel(data.funnel);
        setFunnelOutcomes(data.funnelOutcomes ?? { won: 0, lost: 0 });
        setAgents(data.agents);
        setActiveAgentsList(data.activeAgentsList);
        setError(false);
      } else {
        console.error('Failed to fetch leads');
        setError(true);
      }
    } catch (err) {
      console.error('Error fetching leads:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [status, source, agent, debouncedSearch, page, getDateParams]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Format currency in PLN
  const formatPLN = (val: number) => {
    return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(val);
  };

  // Format date helper
  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Helper for status classes
  const getStatusClass = (st: string) => {
    return st.toLowerCase();
  };

  // Helper for source translation/icon
  const getSourceBadge = (src: string) => {
    switch (src) {
      case 'PHONE':
        return <span className="source-badge-crm">📞 Telefon</span>;
      case 'EMAIL':
        return <span className="source-badge-crm">✉️ E-mail</span>;
      case 'WEB_FORM':
        return <span className="source-badge-crm">🖥️ Formularz</span>;
      default:
        return <span className="source-badge-crm">{src}</span>;
    }
  };

  const maxFunnelCount = Math.max(...funnel.map(f => f.count), 1);

  return (
    <div className="leads-container">
      {/* Header */}
      <div className="leads-header">
        <div>
          <h1 className="leads-title">CRM Leady</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>
            Przegląd lejka konwersji i leadów przesyłanych przez CRM Connector.
          </p>
        </div>
        <button 
          className="pagination-btn"
          onClick={fetchLeads}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          🔄 Odśwież dane
        </button>
      </div>

      {/* Date Range Selector */}
      <div className="date-filter-row">
        <div className="filter-group">
          <button
            className={`filter-pill ${period === 'today' ? 'active' : ''}`}
            onClick={() => { setPeriod('today'); setPage(1); }}
          >
            Dzisiaj
          </button>
          <button
            className={`filter-pill ${period === 'week' ? 'active' : ''}`}
            onClick={() => { setPeriod('week'); setPage(1); }}
          >
            Ten tydzień
          </button>
          <button
            className={`filter-pill ${period === 'month' ? 'active' : ''}`}
            onClick={() => { setPeriod('month'); setPage(1); }}
          >
            Ten miesiąc
          </button>
          <button
            className={`filter-pill ${period === 'all' ? 'active' : ''}`}
            onClick={() => { setPeriod('all'); setPage(1); }}
          >
            Wszystko
          </button>
          <button
            className={`filter-pill ${period === 'custom' ? 'active' : ''}`}
            onClick={() => { setPeriod('custom'); setPage(1); }}
          >
            Zakres dat...
          </button>
        </div>

        {period === 'custom' && (
          <div className="custom-date-inputs">
            <input
              type="date"
              className="date-input-crm"
              value={customStartDate}
              onChange={(e) => { setCustomStartDate(e.target.value); setPage(1); }}
            />
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>do</span>
            <input
              type="date"
              className="date-input-crm"
              value={customEndDate}
              onChange={(e) => { setCustomEndDate(e.target.value); setPage(1); }}
            />
          </div>
        )}
      </div>

      {error && !loading && (
        <div className="fetch-error-banner">
          <span>Nie udało się pobrać danych leadów. Sprawdź połączenie i spróbuj ponownie.</span>
          <button type="button" onClick={fetchLeads}>Spróbuj ponownie</button>
        </div>
      )}

      {/* KPI stats grid */}
      <div className="leads-kpis">
        <div className="kpi-card-crm total">
          <div className="kpi-label">Wszystkie leady</div>
          <div className="kpi-value-container">
            <div className="kpi-value">{kpis.totalLeads}</div>
          </div>
          <div className="kpi-subtext">Łączna liczba zarejestrowanych leadów</div>
        </div>

        <div className="kpi-card-crm active">
          <div className="kpi-label">Aktywne procesy</div>
          <div className="kpi-value-container">
            <div className="kpi-value">{kpis.activeLeads}</div>
          </div>
          <div className="kpi-subtext">W toku: {formatPLN(kpis.totalActiveValue)}</div>
        </div>

        <div className="kpi-card-crm won">
          <div className="kpi-label">Wygrane</div>
          <div className="kpi-value-container">
            <div className="kpi-value">{kpis.wonLeads}</div>
          </div>
          <div className="kpi-subtext">Leady ze statusem wygrany</div>
        </div>

        <div className="kpi-card-crm value">
          <div className="kpi-label">Wartość wygranych</div>
          <div className="kpi-value-container">
            <div className="kpi-value" style={{ color: 'var(--accent-green)' }}>{formatPLN(kpis.totalWonValue)}</div>
          </div>
          <div className="kpi-subtext">Łączna wartość wygranych leadów</div>
        </div>

        <div className="kpi-card-crm cr">
          <div className="kpi-label">Konwersja</div>
          <div className="kpi-value-container">
            <div className="kpi-value">{kpis.conversionRate}%</div>
          </div>
          <div className="kpi-subtext">Wygrane / wszystkie leady (CR%)</div>
        </div>
      </div>

      {/* Funnel Visualization */}
      <div className="funnel-card">
        <h2 className="funnel-title">Wizualizacja Lejka Konwersji (CRM)</h2>
        <div className="funnel-steps">
          {funnel.map((stage) => {
            const percentage = Math.round((stage.count / maxFunnelCount) * 100);
            return (
              <div key={stage.stage} className={`funnel-step ${stage.stage}`}>
                <div className="funnel-step-header">
                  <span className="funnel-step-name">{stage.name}</span>
                  <span className="funnel-step-count">{stage.count}</span>
                </div>
                <div className="funnel-step-bar">
                  <div className="funnel-step-fill" style={{ width: `${percentage}%` }} />
                </div>
                <div className="funnel-step-pct">
                  {stage.stage !== 'NEW' && kpis.totalLeads > 0
                    ? `${Math.round((stage.count / kpis.totalLeads) * 100)}% ogółu`
                    : 'Krok wejściowy'}
                </div>
              </div>
            );
          })}
          {/* Outcomes: WON and LOST are parallel exits, not sequential stages */}
          <div className="funnel-outcomes">
            <div className="funnel-step WON">
              <div className="funnel-step-header">
                <span className="funnel-step-name">Wygrane</span>
                <span className="funnel-step-count">{funnelOutcomes.won}</span>
              </div>
              <div className="funnel-step-bar">
                <div className="funnel-step-fill" style={{ width: `${Math.round((funnelOutcomes.won / maxFunnelCount) * 100)}%` }} />
              </div>
              <div className="funnel-step-pct">
                {kpis.totalLeads > 0 ? `${Math.round((funnelOutcomes.won / kpis.totalLeads) * 100)}% ogółu` : '—'}
              </div>
            </div>
            <div className="funnel-step LOST">
              <div className="funnel-step-header">
                <span className="funnel-step-name">Przegrane</span>
                <span className="funnel-step-count">{funnelOutcomes.lost}</span>
              </div>
              <div className="funnel-step-bar">
                <div className="funnel-step-fill" style={{ width: `${Math.round((funnelOutcomes.lost / maxFunnelCount) * 100)}%` }} />
              </div>
              <div className="funnel-step-pct">
                {kpis.totalLeads > 0 ? `${Math.round((funnelOutcomes.lost / kpis.totalLeads) * 100)}% ogółu` : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid of Leaderboard & Table */}
      <div className="dashboard-grid-crm">
        {/* Left column: Leaderboard */}
        <div className="leaderboard-card">
          <h2 className="leaderboard-title">
            <span>Efektywność Agentów</span>
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>Wartość wniosków</span>
          </h2>
          {agents.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              Brak przypisanych agentów z wynikami
            </div>
          ) : (
            <div className="leaderboard-list">
              {agents.map((agent) => (
                <div key={agent.name} className="leaderboard-item">
                  <div className="leaderboard-item-header">
                    <span className="leaderboard-agent-name">{agent.name}</span>
                    <span className="leaderboard-agent-value">{formatPLN(agent.value)}</span>
                  </div>
                  <div className="leaderboard-item-body">
                    <div className="leaderboard-stats">
                      <span>Leady: <strong>{agent.leads}</strong></span>
                      <span>Wygrane: <strong>{agent.won}</strong></span>
                    </div>
                    <span className={`leaderboard-cr ${agent.cr >= 30 ? 'high' : agent.cr >= 15 ? 'mid' : ''}`}>
                      CR: {agent.cr}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column: Lead Table Card */}
        <div className="leads-table-card">
          {/* Filters */}
          <div className="filters-row">
            <div className="search-input-wrapper">
              <svg className="search-icon-crm" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input 
                type="text" 
                placeholder="Szukaj po nazwisku, telefonie, e-mailu..." 
                className="search-input-crm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select 
              className="filter-select"
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            >
              <option value="">Wszystkie statusy</option>
              <option value="NEW">Nowy</option>
              <option value="IN_PROGRESS">W kontakcie</option>
              <option value="OFFER">Oferta</option>
              <option value="WON">Wygrany</option>
              <option value="LOST">Przegrany</option>
            </select>

            <select 
              className="filter-select"
              value={source}
              onChange={(e) => { setSource(e.target.value); setPage(1); }}
            >
              <option value="">Wszystkie źródła</option>
              <option value="WEB_FORM">Formularz WWW</option>
              <option value="PHONE">Rozmowa telefoniczna</option>
              <option value="EMAIL">E-mail</option>
            </select>

            <select 
              className="filter-select"
              value={agent}
              onChange={(e) => { setAgent(e.target.value); setPage(1); }}
            >
              <option value="">Wszyscy agenci</option>
              <option value="unassigned">Nieprzypisani</option>
              {activeAgentsList.map(aName => (
                <option key={aName} value={aName}>{aName}</option>
              ))}
            </select>
          </div>

          {/* Table */}
          {loading ? (
            <div className="loading-overlay-crm">
              <div className="spinner" />
              Ładowanie danych leadów...
            </div>
          ) : leads.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-secondary)' }}>
              <h3>Brak wyników</h3>
              <p style={{ fontSize: 13, marginTop: 4 }}>Brak leadów spełniających podane kryteria filtracji.</p>
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '15%' }}>Utworzono</th>
                      <th style={{ width: '20%' }}>Klient</th>
                      <th style={{ width: '12%' }}>Źródło</th>
                      <th style={{ width: '23%' }}>Szczegóły</th>
                      <th style={{ width: '10%' }}>Cena / Wartość</th>
                      <th style={{ width: '10%' }}>Status</th>
                      <th style={{ width: '10%' }}>Opiekun</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => (
                      <tr key={lead.id}>
                        {/* Date */}
                        <td style={{ fontSize: '13px' }}>{formatDate(lead.thuliumCreatedAt)}</td>

                        {/* Client details */}
                        <td>
                          <div className="client-info-cell">
                            <span className="client-name-crm">{lead.clientName}</span>
                            {lead.clientPhone && (
                              <span className="client-contact-crm">📞 {lead.clientPhone}</span>
                            )}
                            {lead.clientEmail && (
                              <span className="client-contact-crm">✉️ {lead.clientEmail}</span>
                            )}
                          </div>
                        </td>

                        {/* Source */}
                        <td>{getSourceBadge(lead.source)}</td>

                        {/* Subject & Vehicle info */}
                        <td>
                          <div className="car-info-cell">
                            <span className="car-model-crm" title={lead.subject || ''}>
                              {lead.subject || 'Brak tematu'}
                            </span>
                            {lead.url && (
                              <a href={lead.url} target="_blank" rel="noopener noreferrer" className="car-link-crm">
                                🔗 Zobacz ofertę ↗
                              </a>
                            )}
                            {(lead.utmSource || lead.referrer) && (
                              <div className="marketing-badge-crm">
                                {lead.referrer && <span className="marketing-ref">ref: {lead.referrer}</span>}
                                {lead.utmSource && (
                                  <span className="marketing-utm">
                                    {lead.utmSource} / {lead.utmMedium || '-'}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Value */}
                        <td>
                          <strong style={{ color: lead.status === 'WON' ? 'var(--accent-green)' : 'var(--text-primary)' }}>
                            {lead.value > 0 ? formatPLN(lead.value) : '-'}
                          </strong>
                        </td>

                        {/* Status badge */}
                        <td>
                          <span className={`status-badge-crm ${getStatusClass(lead.status)}`}>
                            {lead.thuliumStatus}
                          </span>
                        </td>

                        {/* Agent */}
                        <td style={{ fontSize: '13px', fontWeight: lead.agentName ? '500' : '400', color: lead.agentName ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {lead.agentName || 'Nieprzypisany'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="pagination-crm">
                <div className="pagination-info">
                  Strona <strong>{pagination.page}</strong> z <strong>{pagination.totalPages || 1}</strong> (Wszystkich leadów: {pagination.totalCount})
                </div>
                <div className="pagination-actions">
                  <button 
                    className="pagination-btn"
                    disabled={page === 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                  >
                    ◀ Poprzednia
                  </button>
                  <button 
                    className="pagination-btn"
                    disabled={page >= pagination.totalPages}
                    onClick={() => setPage(p => p + 1)}
                  >
                    Następna ▶
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
