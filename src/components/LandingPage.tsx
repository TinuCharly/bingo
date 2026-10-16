'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import {
  createRoom as createRoomRequest,
  getAvailableRooms,
  getRoom,
  joinRoom as joinRoomRequest,
  subscribeToPublicRooms,
  type AvailableRoom
} from '@/lib/gameApi';
import { ensurePlayerSession } from '@/lib/supabase';
import { SparklesIcon, KeyIcon, HashtagIcon, PlusCircleIcon, ArrowRightEndOnRectangleIcon, UserIcon, UsersIcon } from '@heroicons/react/24/solid';
import gsap from 'gsap';

export default function LandingPage() {
  const router = useRouter();
  const { setPlayerName, setPlayerId, setRoomId, setRoom } = useGameStore();
  
  const [name, setName] = useState('');
  const [availableRooms, setAvailableRooms] = useState<AvailableRoom[]>([]);
  const [sessionReady, setSessionReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
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

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void ensurePlayerSession()
      .then(async playerId => {
        if (!active) return;
        setPlayerId(playerId);
        setSessionReady(true);
        setAvailableRooms(await getAvailableRooms());
        if (active) {
          unsubscribe = subscribeToPublicRooms(setAvailableRooms, error => setErrorMessage(error.message));
        }
      })
      .catch(error => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Could not connect to the game service.');
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [setPlayerId]);

  const joinRoom = async (roomId: string, roomPassword = '') => {
    if (!name.trim() || busy) return;

    setBusy(true);
    setErrorMessage('');
    try {
      await ensurePlayerSession();
      setPlayerName(name.trim());
      const room = await joinRoomRequest(roomId, name.trim(), roomPassword);
      setRoom(room);
      setRoomId(room.id);
      router.push(`/room/${room.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not join this room.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !roomName.trim() || busy) return;

    setBusy(true);
    setErrorMessage('');
    try {
      await ensurePlayerSession();
      setPlayerName(name.trim());
      const roomId = await createRoomRequest({
        name: roomName.trim(),
        gridSize: Number(gridSize),
        isPrivate,
        password,
        playerName: name.trim()
      });
      const room = await getRoom(roomId);
      setRoom(room);
      setRoomId(room.id);
      router.push(`/room/${room.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create the room.');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !joinRoomId.trim()) return;
    await joinRoom(joinRoomId, joinPassword);
  };

  return (
    <>
      <div className="cloud-bg">
        <div className="cloud cloud1"></div>
        <div className="cloud cloud2"></div>
        <div className="cloud cloud3"></div>
      </div>

      <div className="mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 items-start gap-8 p-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <h1 ref={titleRef} className="title-3d lg:col-span-2">BINGO <span className="text-[#ff5252]">BLAST</span></h1>

        <div ref={panelRef} className="game-panel w-full max-w-md relative z-10 mx-auto lg:mx-0">
          {errorMessage && (
            <p role="alert" className="mb-4 rounded-xl border-2 border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
              {errorMessage}
            </p>
          )}
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
                disabled={!sessionReady || busy || !name.trim() || !roomName.trim()}
                className="game-button w-full py-4 mt-6 text-xl"
              >
                {busy ? 'Please wait...' : 'Create Game'}
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
                disabled={!sessionReady || busy || !name.trim() || !joinRoomId.trim()}
                className="game-button game-button-blue w-full py-4 mt-6 text-xl"
              >
                {busy ? 'Please wait...' : 'Join Game'}
              </button>
            </form>
          )}
        </div>

        <section className="game-panel w-full relative z-10" aria-labelledby="public-rooms-title">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 id="public-rooms-title" className="text-2xl font-black text-[#37474f]">Public Rooms</h2>
              <p className="text-sm font-bold text-[#37474f]/70">Join an open game without entering a room ID.</p>
            </div>
            <UsersIcon className="w-8 h-8 text-[#2962ff] shrink-0" />
          </div>

          {availableRooms.length === 0 ? (
            <p className="bg-[#f0f4f8] rounded-2xl p-4 text-center font-bold text-[#37474f]/70">
              No public rooms are available right now. Create one and invite your friends!
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {availableRooms.map((room) => (
                <li key={room.id} className="flex items-center justify-between gap-3 rounded-2xl border-2 border-[#e0e6ed] bg-white p-4 shadow-sm">
                  <div className="min-w-0">
                    <h3 className="truncate font-black text-[#37474f]">{room.name}</h3>
                    <p className="text-sm font-bold text-gray-500">
                      {room.gridSize}x{room.gridSize} grid · {room.playerCount} {room.playerCount === 1 ? 'player' : 'players'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => joinRoom(room.id)}
                    disabled={!sessionReady || busy || !name.trim()}
                    className="game-button game-button-blue shrink-0 px-4 py-2 text-sm"
                    aria-label={`Join ${room.name}`}
                  >
                    Join
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
