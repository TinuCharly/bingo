import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Room } from '@/store/gameStore';
import { ensurePlayerSession, getSupabase } from '@/lib/supabase';

export interface AvailableRoom {
  id: string;
  name: string;
  gridSize: number;
  playerCount: number;
}

const parseRoom = (value: unknown): Room => {
  if (!value || typeof value !== 'object') throw new Error('The server returned an invalid room.');
  const room = value as Record<string, unknown>;
  const validStatuses = ['waiting', 'setup', 'playing', 'finished'];
  if (
    typeof room.id !== 'string' ||
    typeof room.name !== 'string' ||
    typeof room.gridSize !== 'number' ||
    typeof room.isPrivate !== 'boolean' ||
    !Array.isArray(room.players) ||
    typeof room.status !== 'string' ||
    !validStatuses.includes(room.status) ||
    typeof room.currentTurnIndex !== 'number' ||
    (room.currentChosenNumber !== null && typeof room.currentChosenNumber !== 'number') ||
    (room.winner !== null && typeof room.winner !== 'string') ||
    (room.winnerPlayerId !== null && typeof room.winnerPlayerId !== 'string')
  ) {
    throw new Error('The server returned an invalid room.');
  }

  const players = room.players.map((value): Room['players'][number] => {
    if (!value || typeof value !== 'object') throw new Error('The server returned an invalid player.');
    const player = value as Record<string, unknown>;
    if (
      typeof player.id !== 'string' ||
      typeof player.name !== 'string' ||
      !Array.isArray(player.markedNumbers) ||
      !player.markedNumbers.every(number => typeof number === 'number') ||
      typeof player.hasSubmittedGrid !== 'boolean' ||
      (player.grid !== null && (!Array.isArray(player.grid) || !player.grid.every(number => typeof number === 'number')))
    ) {
      throw new Error('The server returned an invalid player.');
    }

    return {
      id: player.id,
      name: player.name,
      grid: player.grid as number[] | null,
      markedNumbers: player.markedNumbers,
      hasSubmittedGrid: player.hasSubmittedGrid
    };
  });

  return {
    id: room.id,
    name: room.name,
    gridSize: room.gridSize,
    isPrivate: room.isPrivate,
    players,
    status: room.status as Room['status'],
    currentTurnIndex: room.currentTurnIndex,
    currentChosenNumber: room.currentChosenNumber as number | null,
    winner: room.winner as string | null,
    winnerPlayerId: room.winnerPlayerId as string | null,
    setupDeadline: typeof room.setupDeadline === 'string' ? room.setupDeadline : null,
    turnDeadline: typeof room.turnDeadline === 'string' ? room.turnDeadline : null
  };
};

const runRoomRpc = async (name: string, args: Record<string, unknown>) => {
  await ensurePlayerSession();
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw new Error(error.message);
  return parseRoom(data);
};

export const getAvailableRooms = async (): Promise<AvailableRoom[]> => {
  await ensurePlayerSession();
  const { data, error } = await getSupabase().rpc('list_public_rooms');
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error('The server returned an invalid room list.');

  return data.map((value): AvailableRoom => {
    if (!value || typeof value !== 'object') throw new Error('The server returned an invalid room.');
    const room = value as Record<string, unknown>;
    if (
      typeof room.id !== 'string' ||
      typeof room.name !== 'string' ||
      typeof room.grid_size !== 'number' ||
      typeof room.player_count !== 'number'
    ) {
      throw new Error('The server returned an invalid room.');
    }

    return {
      id: room.id,
      name: room.name,
      gridSize: room.grid_size,
      playerCount: room.player_count
    };
  });
};

export const createRoom = async (options: {
  name: string;
  gridSize: number;
  isPrivate: boolean;
  password: string;
  playerName: string;
}) => {
  await ensurePlayerSession();
  const { data, error } = await getSupabase().rpc('create_room', {
    p_name: options.name,
    p_grid_size: options.gridSize,
    p_is_private: options.isPrivate,
    p_password: options.password,
    p_player_name: options.playerName
  });
  if (error) throw new Error(error.message);
  if (typeof data !== 'string') throw new Error('The server did not return a room ID.');
  return data;
};

export const joinRoom = async (roomId: string, playerName: string, password: string) =>
  runRoomRpc('join_room', { p_room_code: roomId.trim().toLowerCase(), p_player_name: playerName, p_password: password });

export const getRoom = async (roomId: string) => {
  await ensurePlayerSession();
  const { data, error } = await getSupabase().rpc('get_room', { p_room_code: roomId });
  if (error) throw new Error(error.message);
  return parseRoom(data);
};

export const startGame = (roomId: string) => runRoomRpc('start_game', { p_room_code: roomId });
export const submitGrid = (roomId: string, grid: number[]) =>
  runRoomRpc('submit_grid', { p_room_code: roomId, p_grid: grid });
export const chooseNumber = (roomId: string, number: number) =>
  runRoomRpc('choose_number', { p_room_code: roomId, p_number: number });
export const markNumber = (roomId: string) => runRoomRpc('mark_number', { p_room_code: roomId });
export const completeSetup = (roomId: string) => runRoomRpc('complete_setup_timeout', { p_room_code: roomId });
export const resolveTurnTimeout = (roomId: string) => runRoomRpc('resolve_turn_timeout', { p_room_code: roomId });

const refreshRoom = async (roomId: string, onRoom: (room: Room) => void, onError: (error: Error) => void) => {
  try {
    onRoom(await getRoom(roomId));
  } catch (error) {
    onError(error instanceof Error ? error : new Error('Could not refresh the room.'));
  }
};

export const subscribeToRoom = (
  roomId: string,
  onRoom: (room: Room) => void,
  onError: (error: Error) => void
) => {
  const supabase = getSupabase();
  const refresh = () => void refreshRoom(roomId, onRoom, onError);
  const channel: RealtimeChannel = supabase
    .channel(`room:${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, refresh)
    .subscribe(status => {
      if (status === 'SUBSCRIBED') refresh();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError(new Error('Lost the live room connection. Please refresh the page.'));
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
};

export const subscribeToPublicRooms = (
  onRooms: (rooms: AvailableRoom[]) => void,
  onError: (error: Error) => void
) => {
  const supabase = getSupabase();
  let active = true;
  const refresh = async () => {
    try {
      const rooms = await getAvailableRooms();
      if (active) onRooms(rooms);
    } catch (error) {
      if (active) onError(error instanceof Error ? error : new Error('Could not load public rooms.'));
    }
  };

  const channel = supabase
    .channel('public-rooms')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => void refresh())
    .subscribe(status => {
      if (status === 'SUBSCRIBED') void refresh();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError(new Error('Lost the live public-room connection. Please refresh the page.'));
      }
    });

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
};
