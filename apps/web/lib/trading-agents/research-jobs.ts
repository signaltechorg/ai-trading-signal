import { query, queryOne } from '../db-pool';
import type {
  AgentAnalysis,
  FinalVerdict,
  ResearchJobStatus,
  ResearchReport,
  ResearchRequest,
} from './types';

interface JobRow {
  id: string;
  symbol: string;
  timeframe: string;
  requested_by: string;
  status: string;
  analyses: unknown[];
  final_verdict: unknown | null;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

function rowToReport(row: JobRow): ResearchReport {
  return {
    id: row.id,
    request: {
      symbol: row.symbol,
      timeframe: row.timeframe,
      requestedBy: row.requested_by,
    },
    status: row.status as ResearchJobStatus,
    analyses: row.analyses as AgentAnalysis[],
    finalVerdict: row.final_verdict as FinalVerdict | undefined,
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}

export async function createResearchJob(
  req: ResearchRequest,
): Promise<ResearchReport> {
  const rows = await query<JobRow>(
    `INSERT INTO research_jobs (symbol, timeframe, requested_by)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [req.symbol, req.timeframe, req.requestedBy],
  );
  return rowToReport(rows[0]);
}

export async function getResearchJob(
  id: string,
): Promise<ResearchReport | null> {
  const row = await queryOne<JobRow>(
    `SELECT * FROM research_jobs WHERE id = $1`,
    [id],
  );
  return row ? rowToReport(row) : null;
}

export async function listResearchJobs(
  userId: string,
  limit = 20,
): Promise<ResearchReport[]> {
  const rows = await query<JobRow>(
    `SELECT * FROM research_jobs
     WHERE requested_by = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map(rowToReport);
}

export async function updateJobStatus(
  id: string,
  status: ResearchJobStatus,
  analyses?: AgentAnalysis[],
  verdict?: FinalVerdict,
): Promise<void> {
  const sets: string[] = ['status = $2'];
  const params: unknown[] = [id, status];
  let idx = 3;

  if (analyses !== undefined) {
    sets.push(`analyses = $${idx}`);
    params.push(JSON.stringify(analyses));
    idx++;
  }

  if (verdict !== undefined) {
    sets.push(`final_verdict = $${idx}`);
    params.push(JSON.stringify(verdict));
    idx++;
  }

  if (status === 'complete' || status === 'failed') {
    sets.push(`completed_at = NOW()`);
  }

  await query(
    `UPDATE research_jobs SET ${sets.join(', ')} WHERE id = $1`,
    params,
  );
}
