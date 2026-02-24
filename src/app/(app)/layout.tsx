'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ProviderToggle } from '@/components/provider-toggle';

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    fetch('/api/user/conversations')
      .then(r => r.ok ? r.json() : { conversations: [] })
      .then(data => setConversations(data.conversations ?? []))
      .catch(() => {});
  }, [pathname]);

  const createConversation = async () => {
    const response = await fetch('/api/user/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New conversation' }),
    });
    if (response.ok) {
      const { conversation } = await response.json();
      setConversations(prev => [conversation, ...prev]);
      router.push(`/chat/${conversation.id}`);
    }
  };

  return (
    <div className="h-screen w-screen flex">
      {/* Sidebar */}
      {sidebarOpen && (
        <aside className="w-60 shrink-0 bg-white/[0.02] border-r border-white/5 flex flex-col">
          {/* Sidebar header */}
          <div className="p-3 border-b border-white/5 flex items-center justify-between">
            <Link href="/" className="text-sm font-mono text-white/70 hover:text-white/90">
              Wybe OS
            </Link>
            <span className="text-xs font-mono text-white/30">local</span>
          </div>

          {/* New conversation button */}
          <button
            onClick={createConversation}
            className="m-2 px-3 py-2 text-xs font-mono text-white/50 hover:text-white/80 hover:bg-white/5 rounded border border-white/10 transition-colors"
          >
            + New conversation
          </button>

          {/* Conversation list */}
          <nav className="flex-1 overflow-y-auto scrollbar-thin p-2">
            {conversations.map(conv => {
              const isActive = pathname === `/chat/${conv.id}`;
              return (
                <Link
                  key={conv.id}
                  href={`/chat/${conv.id}`}
                  className={`block px-3 py-2 mb-0.5 rounded text-xs font-mono truncate transition-colors ${
                    isActive
                      ? 'bg-white/10 text-white/90'
                      : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                >
                  {conv.title}
                </Link>
              );
            })}
            {conversations.length === 0 && (
              <p className="text-xs text-white/20 font-mono text-center mt-8">
                No conversations yet
              </p>
            )}
          </nav>

          {/* Provider toggle */}
          <div className="border-t border-white/5">
            <ProviderToggle />
          </div>

          {/* Bottom links */}
          <div className="p-2 border-t border-white/5">
            <Link
              href="/intelligence"
              className="block px-3 py-2 text-xs font-mono text-white/30 hover:text-white/60 transition-colors"
            >
              Intelligence
            </Link>
            <Link
              href="/stream"
              className="block px-3 py-2 text-xs font-mono text-white/30 hover:text-white/60 transition-colors"
            >
              Stream
            </Link>
            <Link
              href="/execution/chat?session=main"
              className="block px-3 py-2 text-xs font-mono text-white/30 hover:text-white/60 transition-colors"
            >
              Execution
            </Link>
            <Link
              href="/settings"
              className="block px-3 py-2 text-xs font-mono text-white/30 hover:text-white/60 transition-colors"
            >
              Settings
            </Link>
          </div>
        </aside>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toggle sidebar button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute top-3 left-2 z-10 w-6 h-6 flex items-center justify-center text-white/20 hover:text-white/50 transition-colors"
          style={{ left: sidebarOpen ? undefined : '0.5rem' }}
        >
          {sidebarOpen ? '<' : '>'}
        </button>
        {children}
      </div>
    </div>
  );
}
