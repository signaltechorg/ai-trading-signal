import type { Metadata } from 'next';
import { SlackClient } from './SlackClient';

export const metadata: Metadata = {
  title: 'Slack Integration — TradeClaw',
  description:
    'Receive AI trading signal alerts in your Slack channels via incoming webhooks. Alerts fire on the 5-minute signal cron.',
  openGraph: {
    title: 'Slack Integration — TradeClaw',
    description: 'Get TradeClaw trading signals delivered to Slack on the 5-minute cadence.',
    type: 'website',
  },
};

export default function SlackPage() {
  return <SlackClient />;
}
