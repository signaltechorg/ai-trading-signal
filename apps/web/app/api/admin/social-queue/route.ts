import { NextRequest, NextResponse } from 'next/server';
import { listQueue, approvePost, rejectPost, updateCopy } from '../../../../lib/social-queue';

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') as 'pending' | 'approved' | 'posted' | 'rejected' | null;
  const posts = await listQueue(status ?? undefined);
  return NextResponse.json({ posts });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, id, copy } = body as { action: string; id: string; copy?: string };

  if (!action || !id) return NextResponse.json({ error: 'Missing action or id' }, { status: 400 });

  switch (action) {
    case 'approve':
      await approvePost(id);
      break;
    case 'reject':
      await rejectPost(id);
      break;
    case 'update_copy':
      if (!copy) return NextResponse.json({ error: 'Missing copy' }, { status: 400 });
      await updateCopy(id, copy);
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
