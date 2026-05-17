import { NextResponse } from 'next/server';
import { readSessionFromRequest } from '../../../../lib/user-session';
import {
  createResearchJob,
  getResearchJob,
  listResearchJobs,
} from '../../../../lib/trading-agents/research-jobs';
import { runMockResearch } from '../../../../lib/trading-agents/mock-pipeline';

export async function POST(req: Request) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.symbol !== 'string' || !body.symbol.trim()) {
    return NextResponse.json(
      { error: 'symbol is required' },
      { status: 400 },
    );
  }

  const symbol = body.symbol.trim().toUpperCase();
  const timeframe = typeof body.timeframe === 'string' ? body.timeframe : 'H1';

  const job = await createResearchJob({
    symbol,
    timeframe,
    requestedBy: session.userId,
  });

  // Fire and forget — pipeline runs in background
  runMockResearch(job.id, symbol, timeframe).catch(() => {});

  return NextResponse.json(job, { status: 201 });
}

export async function GET(req: Request) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (id) {
    const job = await getResearchJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(job);
  }

  const jobs = await listResearchJobs(session.userId, 20);
  return NextResponse.json(jobs);
}
