import { NextRequest, NextResponse } from 'next/server';
import { listQueue, approvePost, rejectPost, updateCopy } from '../../../../lib/social-queue';
import { getAdminIdentityFromRequest } from '../../../../lib/admin-gate';
import { insertAdminAuditLog } from '../../../../lib/db';

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') as 'pending' | 'approved' | 'posted' | 'rejected' | null;
  const posts = await listQueue(status ?? undefined);
  return NextResponse.json({ posts });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, id, copy } = body as { action: string; id: string; copy?: string };

  if (!action || !id) return NextResponse.json({ error: 'Missing action or id' }, { status: 400 });

  const identity = await getAdminIdentityFromRequest(req);
  const actor = identity?.email ?? 'tc_admin';
  const via = identity?.via ?? 'secret';

  const logAuditFailure = (err: unknown) => console.error('[admin-audit-log] insert failed:', err);

  switch (action) {
    case 'approve':
      await approvePost(id);
      await insertAdminAuditLog({ actor, via, action: 'social_approve', target: id, payload: null }).catch(logAuditFailure);
      break;
    case 'reject':
      await rejectPost(id);
      await insertAdminAuditLog({ actor, via, action: 'social_reject', target: id, payload: null }).catch(logAuditFailure);
      break;
    case 'update_copy':
      if (!copy) return NextResponse.json({ error: 'Missing copy' }, { status: 400 });
      await updateCopy(id, copy);
      await insertAdminAuditLog({ actor, via, action: 'social_update_copy', target: id, payload: { copy } }).catch(logAuditFailure);
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
