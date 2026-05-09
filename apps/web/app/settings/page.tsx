import type { Metadata } from 'next';
import SettingsHub from './SettingsHub';

export const metadata: Metadata = {
  title: 'Settings — TradeClaw',
  description: 'Profile, alert channels, and webhook delivery configuration.',
};

export default function SettingsPage() {
  return <SettingsHub />;
}
