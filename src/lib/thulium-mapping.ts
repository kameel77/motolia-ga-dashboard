import { CrmLeadSource, CrmLeadStatus } from '@prisma/client';

/**
 * Maps a Thulium ticket status (preferring exact status_id / substatus_id when
 * available, with a normalized Polish text fallback) to CrmLeadStatus.
 */
export function mapThuliumStatus(
  statusName: string | null | undefined,
  statusId?: number | null,
  substatusId?: number | null
): CrmLeadStatus {
  const numericStatusId =
    statusId !== undefined && statusId !== null ? Number(statusId) : null;
  const numericSubstatusId =
    substatusId !== undefined && substatusId !== null ? Number(substatusId) : null;

  if (numericStatusId !== null && !Number.isNaN(numericStatusId)) {
    switch (numericStatusId) {
      case 1: // Nowy
        return CrmLeadStatus.NEW;
      case 12: // Próba kontaktu
      case 3: // Oczekuje na klienta
      case 7: // Zakwalifikowany
      case 4: // Odłożone
        return CrmLeadStatus.IN_PROGRESS;
      case 9: // Oferta wysłana
      case 8: // Wniosek złożony
      case 2: // W realizacji
      case 10: // Przekierowany do dealera
        return CrmLeadStatus.OFFER;
      case 11: // Pojazd odebrany
        return CrmLeadStatus.WON;
      case 6: // Połączone
      case 13: // Test
        return CrmLeadStatus.EXCLUDED;
      case 5: // Zamknięte (+ podstatus)
        if (numericSubstatusId === 1) return CrmLeadStatus.WON; // Zamknięte - Wygrany
        if (numericSubstatusId === 3) return CrmLeadStatus.EXCLUDED; // Zamknięte - SPAM
        return CrmLeadStatus.LOST; // Zamknięte - Przegrany (2) lub gołe Zamknięte (null)
      default:
        break;
    }
  }

  if (!statusName) return CrmLeadStatus.NEW;
  const s = statusName.toLowerCase().trim();

  // Check EXCLUDED markers before generic "zamkni" so "Zamknięte - SPAM" does not fall into LOST.
  if (
    s.includes('spam') ||
    s.includes('połączone') ||
    s.includes('polaczone') ||
    s === 'test' ||
    /\btest\b/.test(s)
  ) {
    return CrmLeadStatus.EXCLUDED;
  }

  if (
    s.includes('wygran') ||
    s.includes('sukces') ||
    s.includes('sprzedan') ||
    s.includes('zaakceptowane') ||
    s.includes('odebrany') ||
    s.includes('won')
  ) {
    return CrmLeadStatus.WON;
  }

  if (
    s.includes('odrzucon') ||
    s.includes('przegran') ||
    s.includes('lost') ||
    s.includes('anulowan') ||
    s.includes('rezygnac') ||
    s.includes('bez powodzenia') ||
    s.includes('zamkni')
  ) {
    return CrmLeadStatus.LOST;
  }

  if (
    s.includes('oferta') ||
    s.includes('offer') ||
    s.includes('wycen') ||
    s.includes('wniosek') ||
    s.includes('realizacj') ||
    s.includes('dealer')
  ) {
    return CrmLeadStatus.OFFER;
  }

  if (
    s.includes('otwarty') ||
    s.includes('kontakt') ||
    s.includes('oczekuje') ||
    s.includes('zakwalifikowan') ||
    s.includes('odłożon') ||
    s.includes('odlozon') ||
    s.includes('proces') ||
    s.includes('bieżąc') ||
    s.includes('toku') ||
    s.includes('podjęt')
  ) {
    return CrmLeadStatus.IN_PROGRESS;
  }

  if (s.includes('nowy') || s.includes('nowe')) {
    return CrmLeadStatus.NEW;
  }

  return CrmLeadStatus.NEW;
}

export function isMissedCallTicket(
  queueName?: string | null,
  subject?: string | null
): boolean {
  const q = (queueName || '').toLowerCase();
  const sub = (subject || '').toLowerCase();
  return q.includes('nieodebrane') || sub.includes('nieodebrane');
}

export function mapThuliumSource(ticket: {
  ticket_queue_name?: string | null;
  queueName?: string | null;
  subject?: string | null;
  source?: string | null;
}): CrmLeadSource {
  const queue = (ticket.ticket_queue_name ?? ticket.queueName ?? '').toLowerCase();
  const subject = (ticket.subject ?? '').toLowerCase();
  const sourceStr = (ticket.source ?? '').toLowerCase();

  if (isMissedCallTicket(queue, subject)) {
    return CrmLeadSource.PHONE;
  }

  if (
    queue.includes('oferta_www') ||
    queue.includes('formularz') ||
    subject.includes('[motolia]')
  ) {
    return CrmLeadSource.WEB_FORM;
  }

  if (
    sourceStr.includes('phone') ||
    sourceStr.includes('telefon') ||
    sourceStr.includes('call')
  ) {
    return CrmLeadSource.PHONE;
  }

  if (sourceStr.includes('email') || sourceStr.includes('mail')) {
    return CrmLeadSource.EMAIL;
  }

  return CrmLeadSource.WEB_FORM;
}

/**
 * Normalizes a phone number for client-level deduplication:
 * strips non-digits, strips leading international "00", and prefixes 9-digit PL numbers with "48".
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.length === 9) {
    digits = `48${digits}`;
  }

  return digits;
}

export interface CallLike {
  id?: string;
  phone: string;
  direction: string;
  disposition: string;
  billsec: number;
  waitTime?: number | null;
  agentName?: string | null;
  timestamp: Date;
}

export type InboundCallClassification = 'ANSWERED' | 'SHORT_ANSWERED' | 'MISSED';

/**
 * Classifies a single inbound call. Calls marked ANSWERED by the PBX without any
 * assigned agent (abandoned in IVR/queue) are treated as MISSED.
 */
export function classifyInboundCall(call: CallLike): InboundCallClassification {
  const hasAgent = Boolean(call.agentName && call.agentName.trim().length > 0);
  const talkSec = Math.max(0, (call.billsec || 0) - (call.waitTime || 0));

  if (call.disposition === 'ANSWERED' && hasAgent) {
    return talkSec >= 30 ? 'ANSWERED' : 'SHORT_ANSWERED';
  }

  return 'MISSED';
}

export interface InboundCallSummary {
  uniqueAnswered: number;
  uniqueMissed: number;
  uniqueTotal: number;
  rawAnswered: number;
  rawMissed: number;
  rawShortAnswered: number;
}

/**
 * Summarizes inbound calls deduplicated by normalized phone number.
 * A caller with 4 missed attempts counts once; if they later reach an agent,
 * they count once as answered (not also as missed).
 */
export function summarizeInboundCalls(calls: CallLike[]): InboundCallSummary {
  const answeredPhones = new Set<string>();
  const missedPhones = new Set<string>();

  let rawAnswered = 0;
  let rawMissed = 0;
  let rawShortAnswered = 0;

  calls.forEach((call, idx) => {
    if (call.direction && call.direction.toUpperCase() !== 'INBOUND') {
      return;
    }

    const normalized = normalizePhone(call.phone);
    const key = normalized || `anon:${call.id || idx}`;
    const classification = classifyInboundCall(call);

    if (classification === 'ANSWERED') {
      rawAnswered += 1;
      answeredPhones.add(key);
    } else if (classification === 'SHORT_ANSWERED') {
      rawShortAnswered += 1;
    } else {
      rawMissed += 1;
      missedPhones.add(key);
    }
  });

  let uniqueMissed = 0;
  for (const key of missedPhones) {
    if (!answeredPhones.has(key)) {
      uniqueMissed += 1;
    }
  }

  const uniqueAnswered = answeredPhones.size;
  return {
    uniqueAnswered,
    uniqueMissed,
    uniqueTotal: uniqueAnswered + uniqueMissed,
    rawAnswered,
    rawMissed,
    rawShortAnswered,
  };
}
