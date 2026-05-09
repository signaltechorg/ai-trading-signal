import type { Metadata } from 'next';
import { RiskClient } from './RiskClient';

export const metadata: Metadata = {
  title: 'Risk Dashboard — Circuit Breakers & Drawdown Monitor | TradeClaw',
  description:
    'Live risk management dashboard with circuit breaker status, drawdown tracking, equity curve visualization, and vetoed signal log. Updates on every signal tick.',
  openGraph: {
    title: 'Risk Dashboard — Circuit Breakers & Drawdown Monitor',
    description:
      'Monitor circuit breakers, drawdown, equity curves, and vetoed signals — updated every 5 minutes alongside the signal cron.',
  },
};

export default function RiskPage() {
  return <RiskClient />;
}
