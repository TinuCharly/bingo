import { create } from 'zustand';

export interface Player {
  id: string;
  name: string;
  grid?: (number | null)[] | null;
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
  winnerPlayerId: string | null;
  setupDeadline?: string | null;
  turnDeadline?: string | null;
}

interface GameState {
  playerName: string;
  roomId: string | null;
  room: Room | null;
  playerId: string | null;
  setPlayerName: (name: string) => void;
  setRoomId: (id: string | null) => void;
  setRoom: (room: Room | null) => void;
  setPlayerId: (id: string) => void;
}

export const useGameStore = create<GameState>((set) => ({
  playerName: '',
  roomId: null,
  room: null,
  playerId: null,
  setPlayerName: (name) => set({ playerName: name }),
  setRoomId: (id) => set({ roomId: id }),
  setRoom: (room) => set({ room }),
  setPlayerId: (id) => set({ playerId: id }),
}));
