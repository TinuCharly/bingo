import { Suspense } from 'react';
import GameRoom from '@/components/GameRoom';

export default function RoomPage() {
  return (
    <main className="relative min-h-screen overflow-hidden text-white selection:bg-primary/30">
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center font-bold">Loading room...</div>}>
        <GameRoom />
      </Suspense>
    </main>
  );
}
