import { useState } from 'react';
import toast from 'react-hot-toast';
import { AiGeneratedEmail, AiEmailDomain, AiEmailTone, generateAiEmail } from '../api/aiEmail.api';

interface Props {
  onClose: () => void;
  onUse: (email: AiGeneratedEmail, templateName: string) => Promise<void> | void;
  useLabel?: string;
}

const domains: Array<[AiEmailDomain, string]> = [
  ['ecommerce', 'E-commerce'], ['saas', 'SaaS'], ['education', 'Education'],
  ['healthcare', 'Healthcare'], ['real_estate', 'Real Estate'], ['finance', 'Finance'],
  ['nonprofit', 'Non-profit'], ['hospitality', 'Hospitality'],
  ['professional_services', 'Professional Services'], ['general', 'General'],
];

export default function AiEmailGenerator({ onClose, onUse, useLabel = 'Use this email' }: Props) {
  const [domain, setDomain] = useState<AiEmailDomain>('general');
  const [goal, setGoal] = useState('Marketing campaign');
  const [tone, setTone] = useState<AiEmailTone>('professional');
  const [language, setLanguage] = useState('English');
  const [audience, setAudience] = useState('Prospective customers');
  const [prompt, setPrompt] = useState('');
  const [sender, setSender] = useState('');
  const [templateName, setTemplateName] = useState('AI Generated Email');
  const [result, setResult] = useState<AiGeneratedEmail | null>(null);
  const [generating, setGenerating] = useState(false);
  const [using, setUsing] = useState(false);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');

  async function handleGenerate() {
    if (prompt.trim().length < 10) return toast.error('Describe the email in at least 10 characters');
    setGenerating(true);
    try {
      const email = await generateAiEmail({ domain, goal, tone, language, audience, prompt, sender: sender || undefined });
      setResult(email);
      if (templateName === 'AI Generated Email') setTemplateName(`${goal} - AI`);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'AI email generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleUse() {
    if (!result) return;
    setUsing(true);
    try {
      await onUse(result, templateName.trim() || 'AI Generated Email');
      onClose();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Could not use generated email');
    } finally {
      setUsing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div><h2 className="text-lg font-semibold">AI Email Generator</h2><p className="text-xs text-gray-500">Generate, review and select—nothing is sent automatically.</p></div>
          <button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-700">&times;</button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_1fr]">
          <div className="overflow-y-auto border-r p-5 space-y-3">
            <label className="block text-sm font-medium">Domain / industry<select value={domain} onChange={e => setDomain(e.target.value as AiEmailDomain)} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal">{domains.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="block text-sm font-medium">Campaign goal<input value={goal} onChange={e => setGoal(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal" /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm font-medium">Tone<select value={tone} onChange={e => setTone(e.target.value as AiEmailTone)} className="mt-1 w-full rounded-lg border px-2 py-2 font-normal"><option>professional</option><option>friendly</option><option>persuasive</option><option>concise</option><option>warm</option></select></label>
              <label className="block text-sm font-medium">Language<input value={language} onChange={e => setLanguage(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 font-normal" /></label>
            </div>
            <label className="block text-sm font-medium">Target audience<textarea value={audience} onChange={e => setAudience(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal" /></label>
            <label className="block text-sm font-medium">Sender / brand (optional)<input value={sender} onChange={e => setSender(e.target.value)} placeholder="Brand Name <hello@example.com>" className="mt-1 w-full rounded-lg border px-3 py-2 font-normal" /></label>
            <label className="block text-sm font-medium">What should the email say?<textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={7} maxLength={5000} placeholder="Describe your offer, important facts, CTA and constraints..." className="mt-1 w-full rounded-lg border px-3 py-2 font-normal" /></label>
            <button onClick={handleGenerate} disabled={generating || prompt.trim().length < 10} className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">{generating ? 'Generating…' : result ? 'Regenerate email' : 'Generate email'}</button>
          </div>
          <div className="min-h-0 overflow-y-auto bg-gray-50 p-5">
            {!result ? <div className="flex h-full items-center justify-center text-center text-gray-400"><div><div className="text-4xl">✦</div><p className="mt-2">Your generated email preview will appear here.</p></div></div> : (
              <div className="mx-auto max-w-3xl space-y-3">
                <div className="rounded-lg border bg-white p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-gray-500">Subject</p><h3 className="font-semibold">{result.subject}</h3><p className="mt-1 text-sm text-gray-500">{result.previewText}</p></div><span className={`rounded-full px-3 py-1 text-sm font-semibold ${result.quality.score >= 80 ? 'bg-green-100 text-green-700' : result.quality.score >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>Quality {result.quality.score}</span></div>
                  {(result.quality.errors.length + result.quality.warnings.length > 0) && <div className="mt-3 border-t pt-2 text-xs text-gray-600">{[...result.quality.errors, ...result.quality.warnings].map(item => <p key={item.code}>• {item.message}</p>)}</div>}
                </div>
                <div className="flex justify-end gap-2"><button onClick={() => setPreviewMode('desktop')} className={`rounded px-3 py-1 text-xs ${previewMode === 'desktop' ? 'bg-gray-800 text-white' : 'bg-white border'}`}>Desktop</button><button onClick={() => setPreviewMode('mobile')} className={`rounded px-3 py-1 text-xs ${previewMode === 'mobile' ? 'bg-gray-800 text-white' : 'bg-white border'}`}>Mobile</button></div>
                <iframe title="AI email preview" sandbox="allow-same-origin" srcDoc={result.html} className={`mx-auto h-[480px] rounded-lg border bg-white transition-all ${previewMode === 'mobile' ? 'w-[375px]' : 'w-full'}`} />
                <label className="block text-sm font-medium">Template name<input value={templateName} onChange={e => setTemplateName(e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal" /></label>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3"><button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancel</button><button onClick={handleUse} disabled={!result || using} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-50">{using ? 'Applying…' : useLabel}</button></div>
      </div>
    </div>
  );
}

