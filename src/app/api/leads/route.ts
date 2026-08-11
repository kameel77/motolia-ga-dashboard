import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { CrmLeadStatus, CrmLeadSource, Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status') as CrmLeadStatus | null;
  const sourceFilter = searchParams.get('source') as CrmLeadSource | null;
  const search = searchParams.get('search') || '';
  const agentFilter = searchParams.get('agent') || '';
  const startDateStr = searchParams.get('startDate');
  const endDateStr = searchParams.get('endDate');
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const limit = Math.max(1, Number(searchParams.get('limit') || 20));
  const skip = (page - 1) * limit;

  try {
    // Build base date filter
    const dateWhere: Prisma.CrmLeadWhereInput = {};
    if (startDateStr || endDateStr) {
      dateWhere.thuliumCreatedAt = {};
      if (startDateStr) {
        dateWhere.thuliumCreatedAt.gte = new Date(startDateStr);
      }
      if (endDateStr) {
        dateWhere.thuliumCreatedAt.lte = new Date(endDateStr);
      }
    }

    // Build specific where clause for leads list (includes filters)
    const where: Prisma.CrmLeadWhereInput = { ...dateWhere };

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

    // Fetch matching leads and count
    const [leads, totalCount] = await Promise.all([
      prisma.crmLead.findMany({
        where,
        orderBy: { thuliumCreatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.crmLead.count({ where }),
    ]);

    // Fetch KPI stats (filtered by date range)
    const kpiStats = await prisma.crmLead.groupBy({
      by: ['status'],
      where: dateWhere,
      _count: { id: true },
      _sum: { value: true },
    });

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

      if (stat.status === 'WON') {
        wonLeads += count;
        totalWonValue += sumVal;
      } else if (stat.status === 'LOST') {
        lostLeads += count;
      } else {
        activeLeads += count;
        totalActiveValue += sumVal;
      }
    }

    const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 10000) / 100 : 0;

    // Funnel distribution
    const statusCounts = kpiStats.reduce((acc, curr) => {
      acc[curr.status] = curr._count.id;
      return acc;
    }, {} as Record<CrmLeadStatus, number>);

    // Cumulative funnel: "reached at least stage X" (monotonically decreasing).
    // LOST is excluded from stage counts (stage at loss is unknown) and shown
    // as a separate exit branch alongside WON.
    const reachedOffer = (statusCounts['OFFER'] || 0) + (statusCounts['WON'] || 0);
    const reachedInProgress = (statusCounts['IN_PROGRESS'] || 0) + reachedOffer;

    const funnel = [
      { name: 'Wszystkie leady', stage: 'NEW', count: totalLeads },
      { name: 'W kontakcie', stage: 'IN_PROGRESS', count: reachedInProgress },
      { name: 'Oferta', stage: 'OFFER', count: reachedOffer },
    ];
    const funnelOutcomes = {
      won: statusCounts['WON'] || 0,
      lost: statusCounts['LOST'] || 0,
    };

    // Agent performance (group by agentName, filtered by date range)
    const agentStats = await prisma.crmLead.groupBy({
      by: ['agentName'],
      _count: { id: true },
      _sum: { value: true },
      where: {
        ...dateWhere,
        agentName: { not: null }
      }
    });

    const agentWonStats = await prisma.crmLead.groupBy({
      by: ['agentName'],
      _count: { id: true },
      where: {
        ...dateWhere,
        status: 'WON',
        agentName: { not: null }
      }
    });

    const wonCountMap = new Map<string, number>();
    for (const w of agentWonStats) {
      if (w.agentName) wonCountMap.set(w.agentName, w._count.id);
    }

    const agents = agentStats.map((stat) => {
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
    }).sort((a, b) => b.value - a.value);

    // List of active agents for filter dropdown
    const allAgentsRaw = await prisma.crmLead.groupBy({
      by: ['agentName'],
      where: { agentName: { not: null } }
    });
    const activeAgentsList = allAgentsRaw.map(a => a.agentName).filter((a): a is string => !!a);

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
    });

  } catch (err: any) {
    console.error('Leads fetch error:', err);
    return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
  }
}
