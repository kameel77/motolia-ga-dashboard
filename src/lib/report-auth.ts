import crypto from 'node:crypto';

const MIN_SHARE_TOKEN_LENGTH = 16;

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

  const expectedBuf = Buffer.from(expected, 'utf8');
  const candidateBuf = Buffer.from(candidate, 'utf8');
  if (expectedBuf.length !== candidateBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, candidateBuf);
}

export function getShareTokenValue(): string | null {
  if (!isShareTokenConfigured()) return null;
  return getConfiguredShareToken();
}
