import { NextResponse } from 'next/server';
import { checkOllamaHealth, getProvider, getProviderMode } from '@/lib/llm';

export async function GET() {
  const mode = getProviderMode();
  const provider = getProvider();

  if (mode !== 'local') {
    return NextResponse.json({
      mode: 'cloud',
      healthy: true,
      models: [],
    });
  }

  const healthy = await checkOllamaHealth();
  let models: string[] = [];

  if (healthy) {
    try {
      models = await provider.listModels();
    } catch {
      // Models list failed but Ollama is reachable
    }
  }

  return NextResponse.json({
    mode: 'local',
    healthy,
    models,
  });
}
