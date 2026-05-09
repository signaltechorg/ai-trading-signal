import { Metadata } from 'next';
import LiveLoader from './LiveLoader';

export const metadata: Metadata = {
  title: 'Live Signal Feed | TradeClaw',
  description: 'Live trading signal feed across BTC, ETH, XAU, EUR, GBP and more. Refreshed every 5 minutes. Embeddable widget for your blog or site.',
  keywords: ['live trading signals', '5-minute trading signals', 'bitcoin signals', 'forex signals', 'embeddable widget'],
  openGraph: {
    title: 'TradeClaw — Live Signal Feed',
    description: 'Live AI trading signals (5-minute cadence). Embed in your blog or site with one script tag.',
    type: 'website',
  },
};

export default function LivePage() {
  return <LiveLoader />;
}
