import type { Metadata } from 'next';
import BadgesReadmeLoader from './BadgesReadmeLoader';

export const metadata: Metadata = {
  title: 'README Badges Generator — TradeClaw',
  description:
    'Generate live signal badges for your TradeClaw fork. Add dynamic BUY/SELL badges to your GitHub README — every fork spreads the word.',
  openGraph: {
    title: 'TradeClaw README Badge Generator',
    description:
      'Fork TradeClaw and add live signal badges to your README. Badges refresh every 5 minutes with the latest BUY/SELL direction and confidence for any asset pair.',
    type: 'website',
  },
};

export default function BadgesReadmePage() {
  return <BadgesReadmeLoader />;
}
