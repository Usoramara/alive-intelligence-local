import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'DEEPGRAM_API_KEY not configured' },
      { status: 500 },
    );
  }

  try {
    const res = await fetch('https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${apiKey}` },
    });

    if (!res.ok) {
      return NextResponse.json({ key: apiKey });
    }

    const projects = await res.json();
    const projectId = projects.projects?.[0]?.project_id;

    if (!projectId) {
      return NextResponse.json({ key: apiKey });
    }

    const keyRes = await fetch(
      `https://api.deepgram.com/v1/projects/${projectId}/keys`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          comment: `temp-stt-${Date.now()}`,
          scopes: ['usage:write'],
          time_to_live_in_seconds: 60,
        }),
      },
    );

    if (!keyRes.ok) {
      return NextResponse.json({ key: apiKey });
    }

    const keyData = await keyRes.json();
    return NextResponse.json({ key: keyData.key });
  } catch (error) {
    console.error('Deepgram token error:', error);
    return NextResponse.json({ key: apiKey });
  }
}
