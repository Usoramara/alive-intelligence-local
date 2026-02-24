import { NextResponse } from 'next/server';
import { getProviderMode, setProviderMode, getProvider, checkOllamaHealth } from '@/lib/llm';

export async function GET() {
  const mode = getProviderMode();
  const provider = getProvider();

  let ollamaStatus = { connected: false, models: [] as string[] };
  if (mode === 'local') {
    ollamaStatus = await checkOllamaHealth();
  }

  return NextResponse.json({
    mode,
    providerName: provider.name,
    supportsVision: provider.supportsVision(),
    supportsToolUse: provider.supportsToolUse(),
    ollamaStatus,
  });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { mode } = body;

    if (mode !== 'cloud' && mode !== 'local') {
      return NextResponse.json(
        { error: 'Mode must be "cloud" or "local"' },
        { status: 400 },
      );
    }

    setProviderMode(mode);

    const provider = getProvider();
    let ollamaStatus = { connected: false, models: [] as string[] };
    if (mode === 'local') {
      ollamaStatus = await checkOllamaHealth();
    }

    return NextResponse.json({
      mode,
      providerName: provider.name,
      supportsVision: provider.supportsVision(),
      supportsToolUse: provider.supportsToolUse(),
      ollamaStatus,
    });
  } catch {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 },
    );
  }
}
