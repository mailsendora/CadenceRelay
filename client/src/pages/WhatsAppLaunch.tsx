import { useEffect, useState } from 'react';
import apiClient from '../api/client';

export default function WhatsAppLaunch() {
  const [error, setError] = useState('');
  useEffect(() => {
    apiClient.post('/integrations/whatsapp/sso-token')
      .then(({ data }) => {
        const token = data?.token as string | undefined;
        if (!token) throw new Error('WhatsApp workspace is not linked yet.');
        window.location.assign(`/whatsapp/auth/callback?token=${encodeURIComponent(token)}`);
      })
      .catch((err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 409 || status === 503) {
          window.location.assign('/whatsapp/sign-in');
          return;
        }
        setError(err instanceof Error ? err.message : 'Unable to open WhatsApp');
      });
  }, []);
  return <div className="flex h-64 items-center justify-center text-gray-500">{error || 'Opening WhatsApp…'}</div>;
}
