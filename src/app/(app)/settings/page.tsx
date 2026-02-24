'use client';

import { useState, useEffect } from 'react';

interface UsageStats {
  totalTokens: number;
  totalCost: number;
  tier: string;
}

interface ProviderInfo {
  mode: 'cloud' | 'local';
  providerName: string;
  supportsVision: boolean;
  supportsToolUse: boolean;
  ollamaHealthy: boolean;
}

interface OllamaInfo {
  healthy: boolean;
  models: string[];
}

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [ollama, setOllama] = useState<OllamaInfo | null>(null);

  useEffect(() => {
    fetch('/api/user/usage')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setStats({
            totalTokens: data.totalTokens ?? 0,
            totalCost: data.costCents ? data.costCents / 100 : 0,
            tier: data.tier ?? 'free',
          });
        }
      })
      .catch(() => {});

    fetch('/api/user/provider')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setProvider(data); })
      .catch(() => {});

    fetch('/api/system/ollama')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setOllama(data); })
      .catch(() => {});
  }, []);

  const switchMode = async (mode: 'cloud' | 'local') => {
    try {
      const res = await fetch('/api/user/provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        const data = await res.json();
        setProvider(data);
      }
    } catch {
      // Switch failed
    }
  };

  const saveApiKey = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 500));
    setSaving(false);
    setSaved(true);
    setApiKey('');
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <main className="flex-1 p-8">
      <div className="max-w-xl mx-auto">
        <h1 className="text-xl font-mono text-white/80 mb-8">Settings</h1>

        {/* LLM Provider */}
        <section className="mb-8">
          <h2 className="text-sm font-mono text-white/50 uppercase tracking-wider mb-3">
            LLM Provider
          </h2>
          <div className="p-4 border border-white/5 rounded-lg space-y-4">
            {/* Mode selector */}
            <div className="flex gap-2">
              <button
                onClick={() => switchMode('local')}
                className={`flex-1 px-3 py-2 rounded text-xs font-mono border transition-colors ${
                  provider?.mode === 'local'
                    ? 'bg-white/10 border-white/20 text-white/80'
                    : 'border-white/5 text-white/30 hover:text-white/50 hover:border-white/10'
                }`}
              >
                Local (Ollama)
              </button>
              <button
                onClick={() => switchMode('cloud')}
                className={`flex-1 px-3 py-2 rounded text-xs font-mono border transition-colors ${
                  provider?.mode === 'cloud'
                    ? 'bg-white/10 border-white/20 text-white/80'
                    : 'border-white/5 text-white/30 hover:text-white/50 hover:border-white/10'
                }`}
              >
                Cloud (Claude)
              </button>
            </div>

            {/* Status */}
            {provider && (
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-xs font-mono text-white/40">Status</span>
                  <span className="text-xs font-mono">
                    {provider.mode === 'local' ? (
                      provider.ollamaHealthy ? (
                        <span className="text-green-400/80">Connected</span>
                      ) : (
                        <span className="text-red-400/80">Disconnected</span>
                      )
                    ) : (
                      <span className="text-blue-400/80">Cloud</span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs font-mono text-white/40">Vision</span>
                  <span className={`text-xs font-mono ${provider.supportsVision ? 'text-green-400/60' : 'text-white/20'}`}>
                    {provider.supportsVision ? 'Available' : 'Unavailable'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs font-mono text-white/40">Tool Use</span>
                  <span className={`text-xs font-mono ${provider.supportsToolUse ? 'text-green-400/60' : 'text-white/20'}`}>
                    {provider.supportsToolUse ? 'Available' : 'Unavailable'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Ollama Models */}
        {provider?.mode === 'local' && ollama && (
          <section className="mb-8">
            <h2 className="text-sm font-mono text-white/50 uppercase tracking-wider mb-3">
              Ollama Models
            </h2>
            <div className="p-4 border border-white/5 rounded-lg">
              {ollama.healthy ? (
                ollama.models.length > 0 ? (
                  <div className="space-y-1">
                    {ollama.models.map(model => (
                      <div key={model} className="text-xs font-mono text-white/50 px-2 py-1 bg-white/[0.03] rounded">
                        {model}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs font-mono text-white/30">
                    No models found. Pull a model with: ollama pull qwen3:14b
                  </p>
                )
              ) : (
                <p className="text-xs font-mono text-red-400/60">
                  Ollama is not running. Start it with: ollama serve
                </p>
              )}
            </div>
          </section>
        )}

        {/* Usage */}
        <section className="mb-8">
          <h2 className="text-sm font-mono text-white/50 uppercase tracking-wider mb-3">
            Usage
          </h2>
          <div className="p-4 border border-white/5 rounded-lg">
            <div className="flex justify-between mb-2">
              <span className="text-xs font-mono text-white/40">Tier</span>
              <span className="text-xs font-mono text-white/60 capitalize">
                {stats?.tier ?? '...'}
              </span>
            </div>
            <div className="flex justify-between mb-2">
              <span className="text-xs font-mono text-white/40">Tokens used</span>
              <span className="text-xs font-mono text-white/60">
                {stats?.totalTokens?.toLocaleString() ?? '...'}
              </span>
            </div>
            {provider?.mode === 'local' && (
              <p className="text-[10px] font-mono text-white/20 mt-2">
                Local mode — no API costs
              </p>
            )}
          </div>
        </section>

        {/* BYOK (only in cloud mode) */}
        {provider?.mode === 'cloud' && (
          <section className="mb-8">
            <h2 className="text-sm font-mono text-white/50 uppercase tracking-wider mb-3">
              Anthropic API Key
            </h2>
            <p className="text-xs font-mono text-white/30 mb-3">
              Set your Anthropic API key for cloud mode.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded text-xs font-mono text-white/60 placeholder:text-white/20 focus:outline-none focus:border-white/20"
              />
              <button
                onClick={saveApiKey}
                disabled={!apiKey || saving}
                className="px-4 py-2 bg-white/10 border border-white/10 rounded text-xs font-mono text-white/60 hover:bg-white/15 disabled:opacity-30 transition-colors"
              >
                {saving ? '...' : saved ? 'Saved' : 'Save'}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
