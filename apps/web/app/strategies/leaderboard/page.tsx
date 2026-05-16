import type { Metadata } from 'next';
import { LeaderboardClient } from './LeaderboardClient';

export const metadata: Metadata = {
  title: 'Strategy Leaderboard — TradeClaw',
  description:
    'Public TradeClaw leaderboard ranked by Sharpe ratio, profit factor, win rate, and total P&L. Share top backtests, open the Strategy Builder, or browse the Marketplace.',
  openGraph: {
    title: 'Strategy Leaderboard — TradeClaw',
    description:
      'Public backtest rankings for TradeClaw strategies, optimized for community proof and sharing.',
    type: 'website',
  },
};

export default function StrategyLeaderboardPage() {
  return <LeaderboardClient />;
}
