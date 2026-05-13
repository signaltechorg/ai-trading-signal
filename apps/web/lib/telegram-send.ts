// Shared Telegram sender for admin / ops surfaces.
// The /telegram/webhook route defines its own local sender for the public bot
// flow; we deliberately keep that one as-is and use this helper only from the
// ops surface (telegram-ops-commands.ts, cron/ops-digest).
//
// HTML is the default parse mode because ops output interpolates arbitrary
// strings (gate reasons, symbol names) where MarkdownV2 escaping is brittle.

const TELEGRAM_API = 'https://api.telegram.org';

export type TelegramParseMode = 'HTML' | 'MarkdownV2';

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  parseMode: TelegramParseMode = 'HTML',
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' };

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      return { ok: false, error: `telegram api ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' };
  }
}

// HTML escape for body content. Telegram HTML parse mode only honors a small
// tag set (<b>, <i>, <code>, <pre>, <a>, etc.); everything else must be
// entity-encoded so a gate_reason like "rsi<30" doesn't break the message.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
