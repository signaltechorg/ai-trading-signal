import type { Metadata } from 'next';
import { CopilotClient } from './CopilotClient';

export const metadata: Metadata = {
  title: 'TradeClaw Copilot',
  description:
    'A template-driven signal copilot that explains the strongest live TradeClaw setups, risk posture, and best next actions without an LLM API bill.',
  openGraph: {
    title: 'TradeClaw Copilot',
    description:
      'Public signal copilot with live market context, inline signal previews, and fast routes into the dashboard and builder.',
    type: 'website',
  },
};

export default function CopilotPage() {
  return <CopilotClient />;
}
