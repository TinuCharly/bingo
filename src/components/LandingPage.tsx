'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { getSocket } from '@/lib/socket';
import { SparklesIcon, KeyIcon, HashtagIcon, PlusCircleIcon, ArrowRightEndOnRectangleIcon, UserIcon } from '@heroicons/react/24/solid';
import gsap from 'gsap';

export default function LandingPage() {
  const router = useRouter();
  const { setPlayerName, setRoomId, setRoom } = useGameStore();
  
  const [name, setName] = useState('');
  const [tab, setTab] = useState<'create' | 'join'>('create');
  
  // Create state
  const [roomName, setRoomName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState('');
  const [gridSize, setGridSize] = useState('5');

  // Join state
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinPassword, setJoinPassword] = useState('');

  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  
  useEffect(() => {
    // GSAP animations for game-like bouncy intro
    if (panelRef.current) {
      gsap.fromTo(panelRef.current, 
        { scale: 0.8, opacity: 0, y: 50 },
        { scale: 1, opacity: 1, y: 0, duration: 0.8, ease: "elastic.out(1, 0.5)" }
      );
    }
    if (titleRef.current) {
      gsap.fromTo(titleRef.current,
        { scale: 0.5, opacity: 0, rotation: -10 },
        { scale: 1, opacity: 1, rotation: 0, duration: 1, delay: 0.2, ease: "back.out(1.7)" }
      );
    }
  }, []);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !roomName) return;
    
    setPlayerName(name);
    const socket = getSocket();
    
    socket.emit('createRoom', { roomName, isPrivate, password, gridSize, creatorName: name });
    
    socket.once('roomUpdated', (room) => {
      setRoom(room);
      setRoomId(room.id);
      router.push(`/room/${room.id}`);
    });
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !joinRoomId) return;
    
    setPlayerName(name);
    const socket = getSocket();
    
    socket.emit('joinRoom', { roomId: joinRoomId, password: joinPassword, playerName: name });
    
    socket.once('roomUpdated', (room) => {
      setRoom(room);
      setRoomId(room.id);
      router.push(`/room/${room.id}`);
    });
    
    socket.once('error', (err) => {
      alert(err);
    });
  };

  return (
    <>
      <div className="cloud-bg">
        <div className="cloud cloud1"></div>
        <div className="cloud cloud2"></div>
        <div className="cloud cloud3"></div>
      </div>

      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <h1 ref={titleRef} className="title-3d">BINGO <span className="text-[#ff5252]">BLAST</span></h1>

        <div ref={panelRef} className="game-panel w-full max-w-md relative z-10">
          <div className="flex justify-center mb-6">
            <div className="bg-[#ffca28] p-4 rounded-full shadow-[0_4px_0_#c56000,0_8px_15px_rgba(0,0,0,0.2)] transform -translate-y-12 absolute border-4 border-white">
              <SparklesIcon className="w-10 h-10 text-white" />
            </div>
          </div>
          
          <div className="mt-4 mb-6">
            <label className="block text-lg font-bold mb-2 text-[#37474f]">Your Nickname</label>
            <div className="relative">
              <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
              <input 
                type="text" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="game-input w-full px-5 py-4 pl-12 text-lg"
                placeholder="Enter your name"
                required
              />
            </div>
          </div>

          <div className="flex bg-[#e0e6ed] p-2 rounded-2xl mb-8 shadow-inner border-2 border-white">
            <button 
              type="button"
              onClick={() => setTab('create')}
              className={`flex-1 py-3 rounded-xl text-md font-bold transition-all ${tab === 'create' ? 'bg-white text-[#ff8f00] shadow-[0_4px_10px_rgba(0,0,0,0.1)]' : 'text-gray-500 hover:bg-white/50'}`}
            >
              <PlusCircleIcon className="w-5 h-5 inline-block mr-1 -mt-1" />
              Create
            </button>
            <button 
              type="button"
              onClick={() => setTab('join')}
              className={`flex-1 py-3 rounded-xl text-md font-bold transition-all ${tab === 'join' ? 'bg-white text-[#2962ff] shadow-[0_4px_10px_rgba(0,0,0,0.1)]' : 'text-gray-500 hover:bg-white/50'}`}
            >
              <ArrowRightEndOnRectangleIcon className="w-5 h-5 inline-block mr-1 -mt-1" />
              Join
            </button>
          </div>

          {tab === 'create' ? (
            <form onSubmit={handleCreate} className="space-y-5">
              <div>
                <label className="block text-md font-bold mb-2 text-[#37474f]">Room Name</label>
                <input 
                  type="text" 
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="game-input w-full px-4 py-3"
                  placeholder="E.g. Fun Room"
                  required
                />
              </div>
              
              <div>
                <label className="block text-md font-bold mb-2 text-[#37474f]">Grid Size: {gridSize}x{gridSize}</label>
                <input 
                  type="range" 
                  min="3" 
                  max="10" 
                  value={gridSize}
                  onChange={(e) => setGridSize(e.target.value)}
                  className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#ff8f00]"
                />
              </div>

              <div className="flex items-center gap-3 py-2 bg-[#f0f4f8] p-3 rounded-xl border-2 border-[#e0e6ed]">
                <input 
                  type="checkbox" 
                  id="private" 
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="w-6 h-6 rounded-md text-[#ff8f00] focus:ring-[#ff8f00] border-gray-300 shadow-sm accent-[#ff8f00]"
                />
                <label htmlFor="private" className="text-md font-bold text-[#37474f] cursor-pointer">Private Room</label>
              </div>

              {isPrivate && (
                <div className="relative animate-in slide-in-from-top-2">
                  <KeyIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
                  <input 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="game-input w-full px-4 py-3 pl-12"
                    placeholder="Set Password"
                    required={isPrivate}
                  />
                </div>
              )}

              <button 
                type="submit"
                disabled={!name || !roomName}
                className="game-button w-full py-4 mt-6 text-xl"
              >
                Create Game
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="space-y-5">
              <div className="relative">
                <HashtagIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
                <input 
                  type="text" 
                  value={joinRoomId}
                  onChange={(e) => setJoinRoomId(e.target.value)}
                  className="game-input w-full px-4 py-3 pl-12"
                  placeholder="Room ID"
                  required
                />
              </div>
              
              <div className="relative">
                <KeyIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
                <input 
                  type="password" 
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  className="game-input w-full px-4 py-3 pl-12"
                  placeholder="Password (if private)"
                />
              </div>

              <button 
                type="submit"
                disabled={!name || !joinRoomId}
                className="game-button game-button-blue w-full py-4 mt-6 text-xl"
              >
                Join Game
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
