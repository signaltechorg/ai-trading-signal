import sqlite3
from pathlib import Path

DB = Path('/home/naim/.openclaw/workspace/tradeclaw/scripts/signals.db')
BLACKLISTED = {
    ('SOLUSDT','SELL'), ('USDJPY','BUY'), ('XRPUSDT','SELL'), ('BTCUSDT','SELL'),
    ('EURUSD','SELL'), ('GBPUSD','SELL'), ('ETHUSDT','SELL'), ('BNBUSDT','SELL'),
}
conn = sqlite3.connect(DB)
cur = conn.cursor()
where = "outcome IS NOT NULL AND outcome != 'LEGACY'"
rows = cur.execute(f"""
SELECT COUNT(*) total,
       SUM(CASE WHEN outcome IN ('TP1_HIT','EXPIRED_PROFIT') OR accuracy >= 0.5 THEN 1 ELSE 0 END) wins
FROM signals
WHERE {where}
""").fetchone()
print(rows[0], rows[1], round(100.0*rows[1]/rows[0],1) if rows[0] else 0)
conn.close()
