import { NextRequest, NextResponse } from 'next/server';
import { readSessionFromRequest } from '../../../../../lib/user-session';
import { getUserTier } from '../../../../../lib/tier';
import { getResearchJob } from '../../../../../lib/trading-agents/research-jobs';

async function assertProAccess(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const tier = await getUserTier(session.userId);
  if (tier !== 'pro' && tier !== 'elite' && tier !== 'custom') {
    return { error: NextResponse.json({ error: 'Pro access required' }, { status: 403 }) };
  }

  return { session };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await assertProAccess(req);
  if ('error' in access) {
    return access.error;
  }

  const { id } = await params;
  const job = await getResearchJob(id);
  if (!job || job.request.requestedBy !== access.session.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(job);
}
