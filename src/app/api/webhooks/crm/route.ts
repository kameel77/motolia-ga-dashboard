import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CrmLeadStatus } from '@prisma/client';

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

function mapThuliumStatus(statusName: string | null): CrmLeadStatus {
  if (!statusName) return CrmLeadStatus.NEW;
  const s = statusName.toLowerCase();
  
  if (
    s.includes("odrzucon") || 
    s.includes("przegran") || 
    s.includes("lost") || 
    s.includes("spam") || 
    s.includes("anulowan") ||
    s.includes("rezygnac") ||
    s.includes("bez powodzenia")
  ) {
    return CrmLeadStatus.LOST;
  }
  
  if (
    s.includes("wygran") || 
    s.includes("sukces") || 
    s.includes("sprzedan") || 
    s.includes("zaakceptowane") ||
    s.includes("won") ||
    (s.includes("zamkni") || s.includes("zamknięty"))
  ) {
    return CrmLeadStatus.WON;
  }
  
  if (
    s.includes("oferta") || 
    s.includes("offer") || 
    s.includes("wycen")
  ) {
    return CrmLeadStatus.OFFER;
  }
  
  if (
    s.includes("otwarty") || 
    s.includes("kontakt") || 
    s.includes("proces") || 
    s.includes("bieżąc") ||
    s.includes("toku") ||
    s.includes("podjęt")
  ) {
    return CrmLeadStatus.IN_PROGRESS;
  }
  
  if (s.includes("nowy") || s.includes("nowe")) {
    return CrmLeadStatus.NEW;
  }
  
  return CrmLeadStatus.NEW;
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
      const mappedStatus = mapThuliumStatus(lead.thuliumStatus || lead.status || 'Nowy');

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
          source: lead.source, // PHONE | EMAIL | WEB_FORM
          status: mappedStatus,
          thuliumStatus: lead.thuliumStatus || 'Nowy',
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
          clientName: lead.clientName || 'Klient Anonimowy',
          clientEmail: lead.clientEmail || null,
          clientPhone: lead.clientPhone || null,
          source: lead.source,
          status: mappedStatus,
          thuliumStatus: lead.thuliumStatus || 'Nowy',
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
        }
      });

      // Track conversion only on initial creation
      if (!existingLead) {
        const capturedAt = new Date(thuliumCreatedAt);
        capturedAt.setUTCSeconds(0, 0);
        capturedAt.setUTCMinutes(capturedAt.getUTCMinutes() < 30 ? 0 : 30);

        const dateHour = `${capturedAt.getUTCFullYear()}${String(capturedAt.getUTCMonth() + 1).padStart(2, '0')}${String(capturedAt.getUTCDate()).padStart(2, '0')}${String(capturedAt.getUTCHours()).padStart(2, '0')}${capturedAt.getUTCMinutes() < 30 ? '00' : '30'}`;
        const eventName = lead.source === 'PHONE' ? 'crm_lead_phone' : 'crm_lead_form';

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

      // Check if call already exists
      const existingCall = await prisma.crmCall.findUnique({
        where: { id: call.id }
      });

      if (!existingCall) {
        // Create new call record
        await prisma.crmCall.create({
          data: {
            id: call.id,
            phone: call.phone,
            direction: call.direction,
            disposition: call.disposition,
            duration: Number(call.duration || 0),
            billsec: Number(call.billsec || 0),
            agentName: call.agentName || null,
            queueName: call.queueName || null,
            timestamp,
          }
        });

        // Record conversion for answered calls
        if (call.disposition === 'ANSWERED') {
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
            phone: call.phone,
            direction: call.direction,
            disposition: call.disposition,
            duration: Number(call.duration || 0),
            billsec: Number(call.billsec || 0),
            agentName: call.agentName || null,
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
