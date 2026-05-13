import sqlite3
conn = sqlite3.connect('/home/naim/.openclaw/workspace/tradeclaw/scripts/signals.db')
row = conn.execute("""
SELECT COUNT(*) total,
       SUM(CASE WHEN outcome IN ('TP1_HIT','EXPIRED_PROFIT') OR accuracy >= 0.5 THEN 1 ELSE 0 END) wins,
       ROUND(100.0*SUM(CASE WHEN outcome IN ('TP1_HIT','EXPIRED_PROFIT') OR accuracy >= 0.5 THEN 1 ELSE 0 END)/COUNT(*),1) win_rate
FROM signals
WHERE outcome IS NOT NULL AND outcome != 'LEGACY';
""").fetchone()
print(row[0], row[1], row[2])
conn.close()
