import type { Metadata } from 'next';
import APIUsageClient from './APIUsageClient';

export const metadata: Metadata = {
  title: 'API Usage Dashboard — TradeClaw',
  description:
    'Monitor your TradeClaw API usage, view rate limits, and track per-key quota consumption with live-updating gauges and endpoint breakdowns.',
  openGraph: {
    title: 'API Usage Dashboard — TradeClaw',
    description:
      'Live API usage monitoring. Quota bars, rate limit visualization, per-key stats.',
    images: [{ url: '/api/og', width: 1200, height: 630 }],
  },
};

export default function APIUsagePage() {
  return <APIUsageClient />;
}
