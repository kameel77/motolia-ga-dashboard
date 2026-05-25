'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import './dashboard.css';

interface NavItem {
  icon: string;
  label: string;
  href: string;
}

const mainNavItems: NavItem[] = [
  { icon: '🔴', label: 'Live', href: '/live' },
  { icon: '📊', label: 'Overview', href: '/overview' },
  { icon: '📺', label: 'Kanały', href: '/channels' },
  { icon: '📈', label: 'Trendy & TV', href: '/trends' },
];

const analysisNavItems: NavItem[] = [
  { icon: '🗺️', label: 'Geografia', href: '/geography' },
  { icon: '📱', label: 'Urządzenia', href: '/devices' },
  { icon: '🎯', label: 'Konwersje', href: '/conversions' },
];

const systemNavItems: NavItem[] = [
  { icon: '⚙️', label: 'Ustawienia', href: '/settings' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  const renderNavItem = (item: NavItem) => {
    const isActive = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`nav-item ${isActive ? 'active' : ''}`}
        title={collapsed ? item.label : undefined}
      >
        <span className="nav-item-icon">{item.icon}</span>
        <span className="nav-item-label">{item.label}</span>
      </Link>
    );
  };

  return (
    <div className="dashboard-layout">
      {/* Mobile Header */}
      <header className="mobile-header">
        <button
          className="hamburger-btn"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          <span className="hamburger-line" />
          <span className="hamburger-line" />
          <span className="hamburger-line" />
        </button>
        <span className="mobile-brand">Motolia Analytics</span>
        <div style={{ width: 36 }} />
      </header>

      {/* Mobile Overlay */}
      <div
        className={`sidebar-overlay ${mobileOpen ? 'visible' : ''}`}
        onClick={() => setMobileOpen(false)}
      />

      {/* Sidebar */}
      <aside
        className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
      >
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-logo">M</div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">Motolia</span>
            <span className="sidebar-brand-subtitle">Analytics</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          <div className="nav-section-label">Dashboard</div>
          {mainNavItems.map(renderNavItem)}

          <div className="nav-section-label">Analiza</div>
          {analysisNavItems.map(renderNavItem)}

          <div className="nav-section-label">System</div>
          {systemNavItems.map(renderNavItem)}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <button
            className="sidebar-toggle-btn"
            onClick={() => setCollapsed(!collapsed)}
          >
            <span style={{ fontSize: '1rem' }}>
              {collapsed ? '→' : '←'}
            </span>
            <span className="sidebar-toggle-label">
              {collapsed ? '' : 'Zwiń'}
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`main-content ${collapsed ? 'sidebar-collapsed' : ''}`}>
        {children}
      </main>
    </div>
  );
}
