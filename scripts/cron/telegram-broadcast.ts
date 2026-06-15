/**
 * Broadcast top digest signals to Telegram.
 * Used by .github/workflows/telegram-broadcast.yml
 */

import fs from 'node:fs';

const WEEKEND_SKIP = new Set([
  'XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'NZDUSD',
]);

type DigestSignal = {
  direction?: string;
  symbol?: string;
  confidence?: number;
  entry?: number;
  takeProfit1?: number;
  stopLoss?: number;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const digestPath = process.env.DIGEST_PAYLOAD_PATH ?? '/tmp/tradeclaw-digest.json';
  const apiBase = (process.env.API_BASE_URL ?? 'https://tradeclaw.win').replace(/\/$/, '');
  const botToken = requireEnv('TELEGRAM_BOT_TOKEN');
  const channelId = requireEnv('TELEGRAM_CHANNEL_ID');

  const digest = JSON.parse(fs.readFileSync(digestPath, 'utf8')) as { topSignals?: DigestSignal[] };
  const isWeekend = new Date().getUTCDay() >= 6;
  let signals = digest.topSignals ?? [];
  if (isWeekend) {
    signals = signals.filter((s) => !WEEKEND_SKIP.has(String(s.symbol ?? '').toUpperCase()));
  }
  signals = signals.slice(0, 3);

  if (signals.length === 0) {
    console.log('No weekend-safe fallback digest signals to broadcast.');
    return;
  }

  const lines = ['📡 AI Trading Signal Broadcast', '━━━━━━━━━━━━━━━━━━━━'];
  for (const [index, signal] of signals.entries()) {
    const emoji = signal.direction === 'BUY' ? '📈' : '📉';
    lines.push(
      '',
      `${emoji} #${index + 1} ${signal.direction} ${signal.symbol}`,
      `Confidence: ${signal.confidence}%`,
      `Entry: $${signal.entry}`,
      `TP1: $${signal.takeProfit1}`,
      `SL: $${signal.stopLoss}`,
    );
  }
  lines.push(
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    `🤖 AI Trading Signal | ${apiBase.replace(/^https?:\/\//, '')}`,
    '⚠️ Not financial advice. DYOR.',
  );
  const text = lines.join('\n');

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: channelId,
      text,
      disable_web_page_preview: true,
    }),
  });
  const result = await response.json() as { ok?: boolean; result?: { message_id?: number } };
  if (!result.ok) throw new Error(`Telegram send failed: ${JSON.stringify(result)}`);
  console.log('Sent Telegram message:', result.result?.message_id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
