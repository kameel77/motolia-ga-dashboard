import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { CrmLeadStatus, CrmLeadSource, Prisma } from '@prisma/client';
import { summarizeInboundCalls } from '@/lib/thulium-mapping';

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status') as CrmLeadStatus | null;
  const sourceFilter = searchParams.get('source') as CrmLeadSource | null;
  const search = searchParams.get('search') || '';
  const agentFilter = searchParams.get('agent') || '';
  const includeExcluded = searchParams.get('includeExcluded') === 'true';
  const startDateStr = searchParams.get('startDate');
  const endDateStr = searchParams.get('endDate');
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const limit = Math.max(1, Number(searchParams.get('limit') || 20));
  const skip = (page - 1) * limit;

  try {
    // Build base date filter
    const dateWhere: Prisma.CrmLeadWhereInput = {};
    const callDateWhere: Prisma.CrmCallWhereInput = {};
    if (startDateStr || endDateStr) {
      dateWhere.thuliumCreatedAt = {};
      callDateWhere.timestamp = {};
      if (startDateStr) {
        const startD = new Date(startDateStr);
        dateWhere.thuliumCreatedAt.gte = startD;
        callDateWhere.timestamp.gte = startD;
      }
      if (endDateStr) {
        const endD = new Date(endDateStr);
        dateWhere.thuliumCreatedAt.lte = endD;
        callDateWhere.timestamp.lte = endD;
      }
    }

    // Core sales pipeline filter: exclude SPAM, merged, and test tickets; keep Nieodebrane callbacks in sales funnel
    const salesLeadWhere: Prisma.CrmLeadWhereInput = {
      status: { not: CrmLeadStatus.EXCLUDED },
    };

    const salesDateWhere: Prisma.CrmLeadWhereInput = {
      ...dateWhere,
      ...salesLeadWhere,
    };

    // Build specific where clause for leads table (includes optional filters)
    const where: Prisma.CrmLeadWhereInput = { ...dateWhere };
    if (!includeExcluded && statusFilter !== CrmLeadStatus.EXCLUDED) {
      where.AND = [salesLeadWhere];
    }

    if (statusFilter) {
      where.status = statusFilter;
    }
    if (sourceFilter) {
      where.source = sourceFilter;
    }
    if (agentFilter) {
      where.agentName = agentFilter === 'unassigned' ? null : agentFilter;
    }
    if (search) {
      where.OR = [
        { clientName: { contains: search, mode: 'insensitive' } },
        { clientPhone: { contains: search, mode: 'insensitive' } },
        { clientEmail: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
      ];
    }

    const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Fetch leads, counts, cohort funnel data, calls, and agent stats in parallel
    const [
      leads,
      totalCount,
      allTicketsInRangeCount,
      kpiStats,
      funnelLeads,
      staleNewCount,
      inboundCalls,
      agentStats,
      agentWonStats,
      allAgentsRaw,
    ] = await Promise.all([
      prisma.crmLead.findMany({
        where,
        orderBy: { thuliumCreatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.crmLead.count({ where }),
      prisma.crmLead.count({ where: dateWhere }),
      prisma.crmLead.groupBy({
        by: ['status'],
        where: salesDateWhere,
        _count: { id: true },
        _sum: { value: true },
      }),
      prisma.crmLead.findMany({
        where: salesDateWhere,
        select: {
          id: true,
          status: true,
          statusHistory: {
            select: { toStatus: true },
          },
        },
      }),
      prisma.crmLead.count({
        where: {
          ...salesDateWhere,
          status: CrmLeadStatus.NEW,
          thuliumCreatedAt: { lt: staleCutoff },
        },
      }),
      prisma.crmCall.findMany({
        where: {
          ...callDateWhere,
          direction: 'INBOUND',
        },
        select: {
          id: true,
          phone: true,
          direction: true,
          disposition: true,
          billsec: true,
          waitTime: true,
          agentName: true,
          timestamp: true,
        },
      }),
      prisma.crmLead.groupBy({
        by: ['agentName'],
        _count: { id: true },
        _sum: { value: true },
        where: {
          ...salesDateWhere,
          agentName: { not: null },
        },
      }),
      prisma.crmLead.groupBy({
        by: ['agentName'],
        _count: { id: true },
        where: {
          ...salesDateWhere,
          status: CrmLeadStatus.WON,
          agentName: { not: null },
        },
      }),
      prisma.crmLead.groupBy({
        by: ['agentName'],
        where: {
          ...salesLeadWhere,
          agentName: { not: null },
        },
      }),
    ]);

    let totalLeads = 0;
    let activeLeads = 0;
    let wonLeads = 0;
    let lostLeads = 0;
    let totalWonValue = 0;
    let totalActiveValue = 0;

    for (const stat of kpiStats) {
      const count = stat._count.id ?? 0;
      const sumVal = stat._sum.value ?? 0;
      totalLeads += count;

      if (stat.status === CrmLeadStatus.WON) {
        wonLeads += count;
        totalWonValue += sumVal;
      } else if (stat.status === CrmLeadStatus.LOST) {
        lostLeads += count;
      } else {
        activeLeads += count;
        totalActiveValue += sumVal;
      }
    }

    const conversionRate =
      totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 10000) / 100 : 0;

    const statusCounts = kpiStats.reduce((acc, curr) => {
      acc[curr.status] = curr._count.id;
      return acc;
    }, {} as Record<CrmLeadStatus, number>);

    // Cohort funnel from CrmLeadStatusHistory + current status:
    // a lead lost after receiving an offer still counts as having reached IN_PROGRESS and OFFER.
    let reachedInProgress = 0;
    let reachedOffer = 0;

    for (const lead of funnelLeads) {
      const seen = new Set<CrmLeadStatus>([
        lead.status,
        ...lead.statusHistory.map((h) => h.toStatus),
      ]);
      const hadOffer = seen.has(CrmLeadStatus.OFFER) || seen.has(CrmLeadStatus.WON);
      const hadInProgress = hadOffer || seen.has(CrmLeadStatus.IN_PROGRESS);
      if (hadInProgress) reachedInProgress += 1;
      if (hadOffer) reachedOffer += 1;
    }

    const funnel = [
      { name: 'Wszystkie leady', stage: 'NEW', count: totalLeads },
      { name: 'W kontakcie', stage: 'IN_PROGRESS', count: reachedInProgress },
      { name: 'Oferta', stage: 'OFFER', count: reachedOffer },
    ];
    const funnelOutcomes = {
      won: statusCounts[CrmLeadStatus.WON] || 0,
      lost: statusCounts[CrmLeadStatus.LOST] || 0,
    };

    const wonCountMap = new Map<string, number>();
    for (const w of agentWonStats) {
      if (w.agentName) wonCountMap.set(w.agentName, w._count.id);
    }

    const agents = agentStats
      .map((stat) => {
        const name = stat.agentName ?? 'Nieprzypisany';
        const count = stat._count.id ?? 0;
        const won = wonCountMap.get(name) ?? 0;
        const value = stat._sum.value ?? 0;
        return {
          name,
          leads: count,
          won,
          value: Math.round(value * 100) / 100,
          cr: count > 0 ? Math.round((won / count) * 10000) / 100 : 0,
        };
      })
      .sort((a, b) => b.value - a.value);

    const activeAgentsList = allAgentsRaw
      .map((a) => a.agentName)
      .filter((a): a is string => !!a);

    const callSummary = summarizeInboundCalls(inboundCalls);
    const excludedCount = Math.max(0, allTicketsInRangeCount - totalLeads);

    return NextResponse.json({
      leads,
      pagination: {
        totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
      },
      kpis: {
        totalLeads,
        activeLeads,
        wonLeads,
        lostLeads,
        totalWonValue: Math.round(totalWonValue * 100) / 100,
        totalActiveValue: Math.round(totalActiveValue * 100) / 100,
        conversionRate,
      },
      funnel,
      funnelOutcomes,
      agents,
      activeAgentsList,
      callSummary,
      hygiene: {
        staleNewCount,
      },
      excludedCount,
    });
  } catch (err: any) {
    console.error('Leads fetch error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
