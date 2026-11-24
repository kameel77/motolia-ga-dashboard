import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';

const MIN_SHARE_TOKEN_LENGTH = 16;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getConfiguredShareToken(): string {
  return (process.env.REPORT_SHARE_TOKEN || '').trim();
}

export function isShareTokenConfigured(): boolean {
  return getConfiguredShareToken().length >= MIN_SHARE_TOKEN_LENGTH;
}

/**
 * Fail-closed constant-time verification for the public viewer share token.
 * Returns false whenever REPORT_SHARE_TOKEN is unset or shorter than 16 chars.
 */
export function verifyReportShareToken(token: string | null | undefined): boolean {
  const expected = getConfiguredShareToken();
  if (expected.length < MIN_SHARE_TOKEN_LENGTH) {
    return false;
  }

  const candidate = (token || '').trim();
  if (!candidate) {
    return false;
  }

  return safeEqual(expected, candidate);
}

/**
 * Fail-closed Bearer token check against GA_ANALYTICS_API_KEY for n8n / server automation.
 */
export function verifyAnalyticsApiKey(request: NextRequest): boolean {
  const expected = (process.env.GA_ANALYTICS_API_KEY || '').trim();
  if (!expected) {
    return false;
  }

  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return false;
  }

  const candidate = authHeader.slice('Bearer '.length).trim();
  if (!candidate) {
    return false;
  }

  return safeEqual(expected, candidate);
}

export function getShareTokenValue(): string | null {
  if (!isShareTokenConfigured()) return null;
  return getConfiguredShareToken();
}
