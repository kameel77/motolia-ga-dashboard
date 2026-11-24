import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CrmLeadStatus } from '@prisma/client';
import {
  mapThuliumStatus,
  mapThuliumSource,
  isMissedCallTicket,
  classifyInboundCall,
  normalizePhone,
} from '@/lib/thulium-mapping';

function parseWarsawDate(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date();
  const isoStr = dateStr.replace(" ", "T");
  if (isoStr.includes("Z") || isoStr.includes("+") || (isoStr.includes("-") && isoStr.split("-").length > 3)) {
    return new Date(dateStr);
  }

  const dateObj = new Date(isoStr + "Z");
  try {
    const tzString = dateObj.toLocaleString("en-US", { timeZone: "Europe/Warsaw" });
    const localDate = new Date(tzString);
    const diffMs = localDate.getTime() - dateObj.getTime();
    return new Date(new Date(isoStr + "Z").getTime() - diffMs);
  } catch (e) {
    const month = dateObj.getUTCMonth() + 1;
    const offset = (month >= 4 && month <= 10) ? "+02:00" : "+01:00";
    return new Date(isoStr + offset);
  }
}

export async function POST(request: NextRequest) {
  // 1. Basic Token Auth
  // Fail closed: no shared default token. An unset GA_ANALYTICS_API_KEY
  // rejects every request instead of accepting a value published in this repo.
  const authHeader = request.headers.get('authorization');
  const apiKey = process.env.GA_ANALYTICS_API_KEY;

  if (!apiKey) {
    console.error('[Webhook CRM] GA_ANALYTICS_API_KEY is not set — rejecting request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { type } = body;

    if (type === 'lead') {
      const { lead } = body;
      if (!lead || !lead.id) {
        return NextResponse.json({ error: 'Invalid lead payload' }, { status: 400 });
      }

      const thuliumCreatedAt = parseWarsawDate(lead.thuliumCreatedAt);
      const thuliumUpdatedAt = parseWarsawDate(lead.thuliumUpdatedAt);
      const thuliumStatusStr = lead.thuliumStatus || lead.status || 'Nowy';
      const mappedStatus = mapThuliumStatus(
        thuliumStatusStr,
        lead.statusId ?? lead.status_id,
        lead.substatusId ?? lead.substatus_id
      );
      const mappedSource = mapThuliumSource(lead);

      // Check if lead already exists
      const existingLead = await prisma.crmLead.findUnique({
        where: { id: lead.id }
      });

      // Upsert lead
      await prisma.crmLead.upsert({
        where: { id: lead.id },
        create: {
          id: lead.id,
          clientName: lead.clientName || 'Klient Anonimowy',
          clientEmail: lead.clientEmail || null,
          clientPhone: lead.clientPhone || null,
          source: mappedSource, // PHONE | EMAIL | WEB_FORM
          status: mappedStatus,
          thuliumStatus: thuliumStatusStr,
          queueName: lead.queueName || null,
          subject: lead.subject || null,
          agentName: lead.agentName || null,
          value: Number(lead.value || 0.0),
          url: lead.url || null,
          referrer: lead.referrer || null,
          utmSource: lead.utmSource || null,
          utmMedium: lead.utmMedium || null,
          utmCampaign: lead.utmCampaign || null,
          thuliumCreatedAt,
          thuliumUpdatedAt,
        },
        update: {
          clientName:
            lead.clientName && lead.clientName !== 'Klient Anonimowy'
              ? lead.clientName
              : undefined,
          clientEmail: lead.clientEmail || undefined,
          clientPhone: lead.clientPhone || undefined,
          source: mappedSource,
          status: mappedStatus,
          thuliumStatus: thuliumStatusStr,
          queueName: lead.queueName || undefined,
          subject: lead.subject || undefined,
          agentName: lead.agentName || null,
          value: Number(lead.value || 0.0) > 0 ? Number(lead.value) : undefined,
          url: lead.url || undefined,
          referrer: lead.referrer || undefined,
          utmSource: lead.utmSource || undefined,
          utmMedium: lead.utmMedium || undefined,
          utmCampaign: lead.utmCampaign || undefined,
          thuliumCreatedAt,
          thuliumUpdatedAt,
        }
      });

      if (!existingLead) {
        await prisma.crmLeadStatusHistory.create({
          data: {
            leadId: lead.id,
            fromStatus: null,
            toStatus: mappedStatus,
            thuliumStatus: thuliumStatusStr,
            changedAt: thuliumCreatedAt,
          },
        });
      } else if (existingLead.status !== mappedStatus) {
        await prisma.crmLeadStatusHistory.create({
          data: {
            leadId: lead.id,
            fromStatus: existingLead.status,
            toStatus: mappedStatus,
            thuliumStatus: thuliumStatusStr,
            changedAt: thuliumUpdatedAt,
          },
        });
      }

      // Track conversion only on initial creation for genuine web/form leads (not missed calls, excluded, or spam)
      const isMissedCall =
        mappedSource === 'PHONE' ||
        isMissedCallTicket(lead.queueName, lead.subject);
      const isExcluded = mappedStatus === CrmLeadStatus.EXCLUDED;
      const isSpam =
        mappedStatus === CrmLeadStatus.LOST &&
        thuliumStatusStr.toLowerCase().includes('spam');

      if (!existingLead && !isMissedCall && !isExcluded && !isSpam) {
        const capturedAt = new Date(thuliumCreatedAt);
        capturedAt.setUTCSeconds(0, 0);
        capturedAt.setUTCMinutes(capturedAt.getUTCMinutes() < 30 ? 0 : 30);

        const dateHour = `${capturedAt.getUTCFullYear()}${String(capturedAt.getUTCMonth() + 1).padStart(2, '0')}${String(capturedAt.getUTCDate()).padStart(2, '0')}${String(capturedAt.getUTCHours()).padStart(2, '0')}${capturedAt.getUTCMinutes() < 30 ? '00' : '30'}`;
        const eventName = 'crm_lead_form';

        // 1. Increment TrafficByHour conversions
        const trafficRow = await prisma.trafficByHour.findFirst({
          where: { dateHour }
        });

        if (trafficRow) {
          await prisma.trafficByHour.update({
            where: { id: trafficRow.id },
            data: { conversions: { increment: 1 } }
          });
        } else {
          await prisma.trafficByHour.create({
            data: {
              capturedAt,
              dateHour,
              sessions: 0,
              users: 0,
              conversions: 1
            }
          });
        }

        // 2. Add to ConversionEvent
        await prisma.conversionEvent.create({
          data: {
            capturedAt,
            eventName,
            source: lead.utmSource || 'crm_connector',
            medium: lead.utmMedium || (lead.source === 'PHONE' ? 'phone' : 'web'),
            count: 1
          }
        });
      }

      return NextResponse.json({ success: true, message: 'Lead synchronized' });

    } else if (type === 'call') {
      const { call } = body;
      if (!call || !call.id) {
        return NextResponse.json({ error: 'Invalid call payload' }, { status: 400 });
      }

      const timestamp = parseWarsawDate(call.timestamp);
      const callDirection = call.direction || 'INBOUND';
      const callBillsec = Number(call.billsec || 0);
      const callWaitTime = Number(call.waitTime ?? call.wait_time ?? 0);
      const callAgentName = call.agentName || null;
      const rawCallPhone =
        callDirection.toUpperCase() === 'OUTBOUND'
          ? call.dst || call.phone || ''
          : call.phone || '';
      const callPhone = normalizePhone(rawCallPhone) || rawCallPhone;

      // Check if call already exists
      const existingCall = await prisma.crmCall.findUnique({
        where: { id: call.id }
      });

      if (!existingCall) {
        // Create new call record
        await prisma.crmCall.create({
          data: {
            id: call.id,
            phone: callPhone,
            direction: callDirection,
            disposition: call.disposition,
            duration: Number(call.duration || 0),
            billsec: callBillsec,
            waitTime: callWaitTime,
            agentName: callAgentName,
            queueName: call.queueName || null,
            timestamp,
          }
        });

        const isInboundRealAnswer =
          (!callDirection || callDirection.toUpperCase() === 'INBOUND') &&
          classifyInboundCall({
            id: call.id,
            phone: call.phone || '',
            direction: callDirection,
            disposition: call.disposition,
            billsec: callBillsec,
            waitTime: callWaitTime,
            agentName: callAgentName,
            timestamp,
          }) === 'ANSWERED';

        // Record conversion for answered inbound calls handled by an agent (>= 30s)
        if (isInboundRealAnswer) {
          const capturedAt = new Date(timestamp);
          capturedAt.setUTCSeconds(0, 0);
          capturedAt.setUTCMinutes(capturedAt.getUTCMinutes() < 30 ? 0 : 30);

          const dateHour = `${capturedAt.getUTCFullYear()}${String(capturedAt.getUTCMonth() + 1).padStart(2, '0')}${String(capturedAt.getUTCDate()).padStart(2, '0')}${String(capturedAt.getUTCHours()).padStart(2, '0')}${capturedAt.getUTCMinutes() < 30 ? '00' : '30'}`;

          // Increment TrafficByHour conversions
          const trafficRow = await prisma.trafficByHour.findFirst({
            where: { dateHour }
          });

          if (trafficRow) {
            await prisma.trafficByHour.update({
              where: { id: trafficRow.id },
              data: { conversions: { increment: 1 } }
            });
          } else {
            await prisma.trafficByHour.create({
              data: {
                capturedAt,
                dateHour,
                sessions: 0,
                users: 0,
                conversions: 1
              }
            });
          }

          // Add to ConversionEvent
          await prisma.conversionEvent.create({
            data: {
              capturedAt,
              eventName: 'crm_lead_phone',
              source: 'crm_connector',
              medium: 'phone',
              count: 1
            }
          });
        }
      } else {
        // Update existing call details (e.g. disposition update)
        await prisma.crmCall.update({
          where: { id: call.id },
          data: {
            phone: callPhone,
            direction: callDirection,
            disposition: call.disposition,
            duration: Number(call.duration || 0),
            billsec: callBillsec,
            waitTime: callWaitTime,
            agentName: callAgentName,
            queueName: call.queueName || null,
            timestamp,
          }
        });
      }

      return NextResponse.json({ success: true, message: 'Call synchronized' });

    } else {
      return NextResponse.json({ error: 'Unknown event type' }, { status: 400 });
    }

  } catch (err: any) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
  }
}
