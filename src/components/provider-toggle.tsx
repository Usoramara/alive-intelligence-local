'use client';

import { useState, useEffect } from 'react';

interface ProviderState {
  mode: 'cloud' | 'local';
  providerName: string;
  supportsVision: boolean;
  supportsToolUse: boolean;
  ollamaHealthy: boolean;
}

export function ProviderToggle() {
  const [state, setState] = useState<ProviderState | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetch('/api/user/provider')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setState(data); })
      .catch(() => {});
  }, []);

  const toggleMode = async () => {
    if (!state || switching) return;
    const newMode = state.mode === 'cloud' ? 'local' : 'cloud';

    setSwitching(true);
    try {
      const res = await fetch('/api/user/provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) {
        const data = await res.json();
        setState(data);
      }
    } catch {
      // Toggle failed
    }
    setSwitching(false);
  };

  if (!state) {
    return (
      <div className="px-3 py-2 text-xs font-mono text-white/20">
        Loading...
      </div>
    );
  }

  const isLocal = state.mode === 'local';
  const statusColor = isLocal
    ? state.ollamaHealthy ? 'bg-green-500' : 'bg-red-500'
    : 'bg-blue-500';

  return (
    <div className="px-3 py-2">
      <button
        onClick={toggleMode}
        disabled={switching}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono hover:bg-white/5 transition-colors disabled:opacity-50"
      >
        {/* Status dot */}
        <span className={`w-1.5 h-1.5 rounded-full ${statusColor} shrink-0`} />

        {/* Mode label */}
        <span className="text-white/50 truncate">
          {isLocal ? 'Local' : 'Cloud'}
          <span className="text-white/20 ml-1">
            ({state.providerName})
          </span>
        </span>
      </button>

      {/* Capability warnings */}
      {isLocal && !state.ollamaHealthy && (
        <p className="text-[10px] font-mono text-red-400/60 px-2 mt-1">
          Ollama disconnected
        </p>
      )}
      {isLocal && state.ollamaHealthy && !state.supportsVision && (
        <p className="text-[10px] font-mono text-yellow-400/40 px-2 mt-1">
          No vision model
        </p>
      )}
    </div>
  );
}
