/**
 * Post immediate Telegram alerts for newly recorded signals.
 * Used by .github/workflows/signal-alerts.yml
 */

import fs from 'node:fs';

const WEEKEND_SKIP = new Set([
  'XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF',
]);

type Signal = {
  id?: string;
  direction?: string;
  symbol?: string;
  timeframe?: string;
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

async function sendMessage(botToken: string, channelId: string, text: string): Promise<number> {
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
  const messageId = result.result?.message_id;
  if (messageId == null) throw new Error('Telegram response missing message_id');
  console.log(`Sent immediate alert: ${messageId}`);
  return messageId;
}

async function markTelegramPosted(
  apiBase: string,
  cronSecret: string,
  signalId: string,
  messageId: number,
): Promise<void> {
  try {
    const response = await fetch(`${apiBase}/api/cron/signals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({ signalId, messageId }),
    });
    const result = await response.json();
    console.log(`  Marked ${signalId} as posted: ${JSON.stringify(result)}`);
  } catch (err) {
    console.warn(`  Warning: failed to mark ${signalId} as posted:`, err);
  }
}

async function main(): Promise<void> {
  const payloadPath = process.env.SIGNAL_PAYLOAD_PATH ?? '/tmp/tradeclaw-cron-signals.json';
  const apiBase = (process.env.API_BASE_URL ?? 'https://tradeclaw.win').replace(/\/$/, '');
  const botToken = requireEnv('TELEGRAM_BOT_TOKEN');
  const channelId = requireEnv('TELEGRAM_CHANNEL_ID');
  const cronSecret = requireEnv('CRON_SECRET');

  const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8')) as { newSignals?: Signal[] };
  let newSignals = payload.newSignals ?? [];
  if (newSignals.length === 0) {
    console.log('No new signals recorded.');
    return;
  }

  const isWeekend = new Date().getUTCDay() >= 6;
  if (isWeekend) {
    newSignals = newSignals.filter((s) => !WEEKEND_SKIP.has(String(s.symbol ?? '').toUpperCase()));
  }
  if (newSignals.length === 0) {
    console.log('No signals to post (market closed).');
    return;
  }

  for (const signal of newSignals) {
    const emoji = signal.direction === 'BUY' ? '📈' : '📉';
    const text = [
      '⚡️ New AI Trading Signal',
      '',
      `${emoji} ${signal.direction} ${signal.symbol} · ${signal.timeframe}`,
      `Confidence: ${signal.confidence}%`,
      `Entry: $${signal.entry}`,
      `TP1: $${signal.takeProfit1}`,
      `SL: $${signal.stopLoss}`,
      '',
      apiBase.replace(/^https?:\/\//, ''),
      '⚠️ Not financial advice. DYOR.',
    ].join('\n');

    const messageId = await sendMessage(botToken, channelId, text);
    if (signal.id) {
      await markTelegramPosted(apiBase, cronSecret, signal.id, messageId);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
