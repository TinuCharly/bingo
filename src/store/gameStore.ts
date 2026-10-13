import { create } from 'zustand';

export interface Player {
  id: string;
  name: string;
  grid?: (number | null)[];
  markedNumbers: number[];
  hasSubmittedGrid?: boolean;
}

export interface Room {
  id: string;
  name: string;
  isPrivate: boolean;
  password?: string;
  gridSize: number;
  players: Player[];
  status: 'waiting' | 'setup' | 'playing' | 'finished';
  currentTurnIndex: number;
  currentChosenNumber: number | null;
  winner: string | null;
}

interface GameState {
  playerName: string;
  roomId: string | null;
  room: Room | null;
  socketId: string | null;
  setPlayerName: (name: string) => void;
  setRoomId: (id: string | null) => void;
  setRoom: (room: Room | null) => void;
  setSocketId: (id: string) => void;
}

export const useGameStore = create<GameState>((set) => ({
  playerName: '',
  roomId: null,
  room: null,
  socketId: null,
  setPlayerName: (name) => set({ playerName: name }),
  setRoomId: (id) => set({ roomId: id }),
  setRoom: (room) => set({ room }),
  setSocketId: (id) => set({ socketId: id }),
}));
