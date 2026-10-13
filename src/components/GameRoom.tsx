'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore, Room, Player } from '@/store/gameStore';
import { getSocket } from '@/lib/socket';
import { 
  UsersIcon, PlayIcon, ArrowPathIcon, TrophyIcon, 
  ClockIcon, CheckCircleIcon, SparklesIcon,
  ExclamationTriangleIcon, LightBulbIcon
} from '@heroicons/react/24/solid';
import clsx from 'clsx';
import confetti from 'canvas-confetti';
import gsap from 'gsap';

import AuroraBackground from '@/components/AuroraBackground';
export interface ValidationError {
  cellIndex: number;
  value: string;
  type: 'nan' | 'negative' | 'zero' | 'higher' | 'duplicate';
  title: string;
  reason: string;
  fix: string;
  conflictingCellIndex?: number;
}

const getPlayerScore = (grid: (number | null)[] | undefined, markedNumbers: number[], size: number) => {
    if (!grid || grid.length === 0) return 0;
    const markedSet = new Set(markedNumbers);
    let stars = 0;
    for(let r=0; r<size; r++) {
       let rowWin = true;
       for(let c=0; c<size; c++) { if (!markedSet.has(grid[r * size + c] as number)) { rowWin = false; break; } }
       if (rowWin) stars++;
    }
    for(let c=0; c<size; c++) {
       let colWin = true;
       for(let r=0; r<size; r++) { if (!markedSet.has(grid[r * size + c] as number)) { colWin = false; break; } }
       if (colWin) stars++;
    }
    let d1Win = true, d2Win = true;
    for(let i=0; i<size; i++) {
       if (!markedSet.has(grid[i * size + i] as number)) d1Win = false;
       if (!markedSet.has(grid[i * size + (size - 1 - i)] as number)) d2Win = false;
    }
    if (d1Win) stars++;
    if (d2Win) stars++;
    return stars;
};

const getPlayingCellSizeClass = (size: number) => {
  if (size <= 3) return "w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 text-2xl sm:text-3xl md:text-4xl";
  if (size === 4) return "w-16 h-16 sm:w-20 sm:h-20 md:w-22 md:h-22 text-xl sm:text-2xl md:text-3xl";
  if (size === 5) return "w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 text-lg sm:text-xl md:text-2xl";
  if (size === 6) return "w-11 h-11 sm:w-13 sm:h-13 md:w-16 md:h-16 text-base sm:text-lg md:text-xl";
  return "w-9 h-9 sm:w-11 sm:h-11 md:w-13 md:h-13 text-xs sm:text-sm md:text-base";
};

const getSetupCellSizeClass = (size: number) => {
  if (size <= 3) return "w-18 h-18 sm:w-22 sm:h-22 text-2xl sm:text-3xl";
  if (size === 4) return "w-14 h-14 sm:w-16 sm:h-16 text-xl sm:text-2xl";
  if (size === 5) return "w-12 h-12 sm:w-14 sm:h-14 text-base sm:text-xl";
  if (size === 6) return "w-10 h-10 sm:w-12 sm:h-12 text-sm sm:text-base";
  return "w-8 h-8 sm:w-10 sm:h-10 text-xs sm:text-sm";
};

const validateGridCell = (
  index: number,
  rawVal: string,
  allCells: string[],
  gridSize: number
): ValidationError | null => {
  const trimmed = rawVal.trim();
  if (trimmed === '') return null;

  const max = gridSize * gridSize;

  // 1. Negative numbers or minus sign
  if (trimmed === '-' || /^-+\d+/.test(trimmed)) {
    return {
      cellIndex: index,
      value: trimmed,
      type: 'negative',
      title: 'Negative Number Not Allowed',
      reason: `Negative number (${trimmed}) cannot be entered in Bingo.`,
      fix: `Please enter a positive whole number between 1 and ${max}.`
    };
  }

  // 2. NaN / Non-numeric (letters, decimals, symbols)
  if (!/^\d+$/.test(trimmed)) {
    return {
      cellIndex: index,
      value: trimmed,
      type: 'nan',
      title: 'Not a Valid Number',
      reason: `"${trimmed}" is not a valid whole number (NaN). Letters, punctuation, decimals, and special characters cannot be entered.`,
      fix: `Please enter a positive whole number between 1 and ${max}.`
    };
  }

  const num = parseInt(trimmed, 10);

  // 3. Zero
  if (num === 0) {
    return {
      cellIndex: index,
      value: trimmed,
      type: 'zero',
      title: 'Zero Not Allowed',
      reason: '0 cannot be entered. Bingo numbers start from 1.',
      fix: `Please enter a number between 1 and ${max}.`
    };
  }

  // 4. Number higher than nxn
  if (num > max) {
    return {
      cellIndex: index,
      value: trimmed,
      type: 'higher',
      title: 'Number Too High',
      reason: `${num} cannot be entered because it is higher than ${max} (the maximum number for a ${gridSize}×${gridSize} grid).`,
      fix: `Please enter a number between 1 and ${max}.`
    };
  }

  // 5. Duplicate number
  const conflictingIndex = allCells.findIndex((otherVal, otherIdx) => {
    if (otherIdx === index) return false;
    const otherTrimmed = otherVal.trim();
    if (!/^\d+$/.test(otherTrimmed)) return false;
    return parseInt(otherTrimmed, 10) === num;
  });

  if (conflictingIndex !== -1) {
    const conflictRow = Math.floor(conflictingIndex / gridSize) + 1;
    const conflictCol = (conflictingIndex % gridSize) + 1;
    return {
      cellIndex: index,
      value: trimmed,
      type: 'duplicate',
      title: 'Duplicate Number',
      reason: `Number ${num} is already entered in Row ${conflictRow}, Column ${conflictCol} (Cell #${conflictingIndex + 1}).`,
      fix: `Each number from 1 to ${max} must be unique. Please choose an unused number.`,
      conflictingCellIndex: conflictingIndex
    };
  }

  return null;
};

export default function GameRoom() {
  const router = useRouter();
  const { playerName, room, setRoom } = useGameStore();
  const socket = getSocket();

  const totalCells = room ? room.gridSize * room.gridSize : 25;
  const maxNumber = totalCells;
  const size = room ? room.gridSize : 5;

  const [gridInputs, setGridInputs] = useState<string[]>(() => new Array(totalCells).fill(''));
  const [prevCellCount, setPrevCellCount] = useState(totalCells);

  // Adjust grid inputs during render if cell count changes (e.g. room loaded)
  if (totalCells !== prevCellCount) {
    setPrevCellCount(totalCells);
    setGridInputs(new Array(totalCells).fill(''));
  }

  const [setupTimer, setSetupTimer] = useState(120);
  const [turnTimer, setTimer] = useState(0);
  const [chosenNumber, setChosenNumber] = useState<number | null>(null);
  const [turnAlert, setTurnAlert] = useState<string | null>(null);

  const [focusedCell, setFocusedCell] = useState<number | null>(null);
  const [lastEditedCell, setLastEditedCell] = useState<number | null>(null);
  const [shakingCell, setShakingCell] = useState<number | null>(null);
  const [submitErrorMessage, setSubmitErrorMessage] = useState<{ title: string; reason: string; fix: string } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playerName || !room) {
      router.push('/');
    }
  }, [playerName, room, router]);

  useEffect(() => {
    if (room?.status === 'finished') {
      confetti({
        particleCount: 150,
        spread: 100,
        origin: { y: 0.6 },
        colors: ['#ffca28', '#ff5252', '#448aff', '#69f0ae']
      });
    }
  }, [room?.status]);

  useEffect(() => {
    if (containerRef.current) {
      gsap.fromTo(containerRef.current, 
        { opacity: 0, scale: 0.95, y: 20 }, 
        { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: "back.out(1.5)" }
      );
    }
  }, [room?.status]);

  useEffect(() => {
    const handleRoomUpdated = (updatedRoom: Room) => setRoom(updatedRoom);
    const handleGameStatusChanged = ({ status, room: r }: { status: string; room: Room }) => {
      setRoom(r);
      if (status === 'setup') {
        const requiredLength = r.gridSize * r.gridSize;
        setGridInputs(new Array(requiredLength).fill(''));
        setSetupTimer(120);
        setFocusedCell(null);
        setLastEditedCell(null);
        setSubmitErrorMessage(null);
      }
    };
    const handleNumberChosen = ({ number, chooserName }: { number: number; chooserId: string; chooserName: string }) => {
      setChosenNumber(number);
      setTurnAlert(`${chooserName} chose ${number}!`);
      setTimer(30);
      
      if (containerRef.current) {
        gsap.fromTo(containerRef.current, { x: -5 }, { x: 5, duration: 0.1, yoyo: true, repeat: 3, ease: "power1.inOut" });
        gsap.set(containerRef.current, { x: 0, delay: 0.4 });
      }
    };
    const handleNextTurn = ({ room: r }: { currentTurnIndex: number; room: Room }) => {
      setRoom(r);
      setChosenNumber(null);
      setTurnAlert(null);
    };
    const handleGameOver = ({ room: r }: { winners: string; room: Room }) => {
      setRoom(r);
      setChosenNumber(null);
      setTurnAlert(`Game Over!`);
    };

    socket.on('roomUpdated', handleRoomUpdated);
    socket.on('gameStatusChanged', handleGameStatusChanged);
    socket.on('numberChosen', handleNumberChosen);
    socket.on('nextTurn', handleNextTurn);
    socket.on('gameOver', handleGameOver);
    socket.on('playerMarked', () => { /* Player marked visual */ });

    return () => {
      socket.off('roomUpdated', handleRoomUpdated);
      socket.off('gameStatusChanged', handleGameStatusChanged);
      socket.off('numberChosen', handleNumberChosen);
      socket.off('nextTurn', handleNextTurn);
      socket.off('gameOver', handleGameOver);
      socket.off('playerMarked');
    };
  }, [socket, setRoom]);

  useEffect(() => {
    if (room?.status === 'setup') {
      const int = setInterval(() => setSetupTimer(prev => Math.max(0, prev - 1)), 1000);
      return () => clearInterval(int);
    }
  }, [room?.status]);

  useEffect(() => {
    if (chosenNumber !== null) {
      const int = setInterval(() => setTimer(prev => Math.max(0, prev - 1)), 1000);
      return () => clearInterval(int);
    }
  }, [chosenNumber]);

  // Real-time error computation for all cells
  const allErrors = useMemo(() => {
    return gridInputs.map((val, idx) => validateGridCell(idx, val, gridInputs, size));
  }, [gridInputs, size]);

  // Determine active error for banner display
  const activeError = useMemo(() => {
    if (focusedCell !== null && allErrors[focusedCell]) {
      return allErrors[focusedCell];
    }
    if (lastEditedCell !== null && allErrors[lastEditedCell]) {
      return allErrors[lastEditedCell];
    }
    const firstErr = allErrors.find((e): e is ValidationError => e !== null);
    if (firstErr) return firstErr;
    return null;
  }, [focusedCell, lastEditedCell, allErrors]);

  // Real-time used & unused numbers tracker
  const usedNumbers = useMemo(() => {
    const set = new Set<number>();
    gridInputs.forEach((val) => {
      const trimmed = val.trim();
      if (/^\d+$/.test(trimmed)) {
        const n = parseInt(trimmed, 10);
        if (n >= 1 && n <= maxNumber) {
          set.add(n);
        }
      }
    });
    return set;
  }, [gridInputs, maxNumber]);

  const unusedNumbers = useMemo(() => {
    const unused: number[] = [];
    for (let i = 1; i <= maxNumber; i++) {
      if (!usedNumbers.has(i)) {
        unused.push(i);
      }
    }
    return unused;
  }, [usedNumbers, maxNumber]);

  const filledCount = useMemo(() => {
    return gridInputs.filter(v => v.trim() !== '').length;
  }, [gridInputs]);

  const isGridComplete = useMemo(() => {
    return filledCount === maxNumber && allErrors.every(e => e === null);
  }, [filledCount, maxNumber, allErrors]);

  if (!room) return null;

  const me = room.players.find((p: Player) => p.id === socket.id);
  const isCreator = room.players[0]?.id === socket.id;
  const isMyTurn = room.players[room.currentTurnIndex]?.id === socket.id;

  const handleStart = () => {
    socket.emit('startGame', room.id);
  };

  const handleInputChange = (index: number, val: string) => {
    setSubmitErrorMessage(null);
    setLastEditedCell(index);
    const newInputs = [...gridInputs];
    newInputs[index] = val;
    setGridInputs(newInputs);

    const err = validateGridCell(index, val, newInputs, size);
    if (err) {
      setShakingCell(index);
      setTimeout(() => setShakingCell(null), 350);
    }
  };

  const handleInsertNumber = (num: number) => {
    setSubmitErrorMessage(null);
    const newInputs = [...gridInputs];
    let targetIdx = focusedCell;
    if (targetIdx === null || newInputs[targetIdx].trim() !== '') {
      targetIdx = newInputs.findIndex(v => v.trim() === '');
    }
    if (targetIdx === -1) targetIdx = 0;

    newInputs[targetIdx] = num.toString();
    setGridInputs(newInputs);
    setLastEditedCell(targetIdx);

    const nextEmpty = newInputs.findIndex((v, i) => i > targetIdx && v.trim() === '');
    const toFocus = nextEmpty !== -1 ? nextEmpty : targetIdx;
    setFocusedCell(toFocus);
    setTimeout(() => {
      const el = document.getElementById(`setup-input-${toFocus}`);
      el?.focus();
    }, 10);
  };

  const handleAutoFill = () => {
    setSubmitErrorMessage(null);
    const nums = Array.from({ length: maxNumber }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    setGridInputs(nums.map(n => n.toString()));
    setFocusedCell(null);
    setLastEditedCell(null);
  };

  const handleClearAll = () => {
    setSubmitErrorMessage(null);
    setGridInputs(new Array(maxNumber).fill(''));
    setFocusedCell(null);
    setLastEditedCell(null);
  };

  const handleSubmitGrid = () => {
    // 1. Check for cell errors
    const firstErrIdx = allErrors.findIndex(e => e !== null);
    if (firstErrIdx !== -1) {
      const err = allErrors[firstErrIdx]!;
      setFocusedCell(firstErrIdx);
      setLastEditedCell(firstErrIdx);
      setShakingCell(firstErrIdx);
      setTimeout(() => setShakingCell(null), 400);
      const el = document.getElementById(`setup-input-${firstErrIdx}`);
      el?.focus();
      setSubmitErrorMessage({
        title: 'Cannot Submit: Please Fix Errors',
        reason: `Cell #${firstErrIdx + 1} has an issue: ${err.reason}`,
        fix: err.fix
      });
      return;
    }

    // 2. Check for empty cells
    const firstEmptyIdx = gridInputs.findIndex(v => v.trim() === '');
    if (firstEmptyIdx !== -1) {
      setFocusedCell(firstEmptyIdx);
      setLastEditedCell(firstEmptyIdx);
      setShakingCell(firstEmptyIdx);
      setTimeout(() => setShakingCell(null), 400);
      const el = document.getElementById(`setup-input-${firstEmptyIdx}`);
      el?.focus();
      setSubmitErrorMessage({
        title: 'Cannot Submit: Grid Incomplete',
        reason: `Cell #${firstEmptyIdx + 1} is empty. All ${maxNumber} cells must be filled before playing.`,
        fix: `Enter an unused number between 1 and ${maxNumber} (Available: ${unusedNumbers.slice(0, 6).join(', ')}${unusedNumbers.length > 6 ? '...' : ''}).`
      });
      return;
    }

    // 3. Emit valid grid
    const finalGrid = gridInputs.map(v => parseInt(v.trim(), 10));
    socket.emit('submitGrid', { roomId: room.id, grid: finalGrid });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    const N = room.gridSize;
    const r = Math.floor(i / N);
    const c = i % N;
    let nextI = -1;

    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
      nextI = (r - 1) * N + c;
    } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
      nextI = (r + 1) * N + c;
    } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      nextI = r * N + (c - 1);
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      nextI = r * N + (c + 1);
    } else if (e.key === 'Enter') {
      nextI = (i + 1) % (N * N);
    }

    if (nextI >= 0 && nextI < N * N) {
      e.preventDefault();
      setFocusedCell(nextI);
      const nextInput = document.getElementById(`setup-input-${nextI}`);
      nextInput?.focus();
    }
  };

  const handleCellClickPlay = (num: number) => {
    if (room.status !== 'playing') return;
    
    const isMarked = me?.markedNumbers.includes(num);
    
    if (chosenNumber === null && isMyTurn && !isMarked) {
      socket.emit('chooseNumber', { roomId: room.id, number: num });
    } else if (chosenNumber !== null && chosenNumber === num && !isMarked) {
      socket.emit('markNumber', { roomId: room.id });
    }
  };

  return (
    <>
    <AuroraBackground 
        className="absolute inset-0 w-full h-full -z-10"
        style={{ aspectRatio: 'auto' }} speed={10}      />
      <div className="cloud-bg">
        <div className="cloud cloud1"></div>
        <div className="cloud cloud2"></div>
        <div className="cloud cloud3"></div>
      </div>
      
      <div className="min-h-screen p-4 flex flex-col items-center max-w-6xl mx-auto relative z-10" ref={containerRef}>
        
        {/* Header Bar */}
        <div className="w-full flex flex-col sm:flex-row justify-between items-center bg-white/40 backdrop-blur-md p-4 rounded-3xl border-4 border-white mb-6 shadow-lg">
          <div className="text-center sm:text-left mb-2 sm:mb-0">
            <h2 className="text-2xl font-black text-[#ff8f00] drop-shadow-md">{room.name}</h2>
            <p className="text-sm font-bold text-[#37474f]">Room ID: {room.id} • {room.gridSize}x{room.gridSize}</p>
          </div>
          <div className="flex items-center gap-4 text-sm font-bold">
            <span className="flex items-center gap-1 text-[#2962ff] bg-white px-3 py-1.5 rounded-xl shadow-sm">
              <UsersIcon className="w-5 h-5"/> {room.players.length} Players
            </span>
            <span className="px-4 py-1.5 rounded-xl bg-[#ff5252] text-white uppercase shadow-sm">{room.status}</span>
          </div>
        </div>

        {/* Status: WAITING */}
        {room.status === 'waiting' && (
          <div className="game-panel w-full max-w-md text-center mt-10">
            <ArrowPathIcon className="w-16 h-16 text-[#ff8f00] animate-spin mx-auto mb-6 drop-shadow-md" />
            <h3 className="text-3xl font-black text-[#37474f] mb-2">Waiting for players</h3>
            <p className="text-[#37474f]/70 font-bold mb-8">Share the Room ID to play together!</p>
            
            <div className="bg-[#f0f4f8] rounded-2xl p-5 mb-8 text-left border-4 border-white shadow-inner">
              <h4 className="text-sm font-black text-[#2962ff] mb-3 uppercase tracking-wider">Players In Room</h4>
              <ul className="space-y-3">
                {room.players.map((p: Player, i: number) => (
                  <li key={i} className="flex items-center gap-3 text-lg font-bold text-[#37474f]">
                    <div className="w-4 h-4 rounded-full bg-[#69f0ae] shadow-md"></div>
                    {p.name} 
                    {i === 0 && <span className="text-xs bg-[#ffca28] text-white px-2 py-1 rounded-lg ml-2 shadow-sm">Host</span>}
                  </li>
                ))}
              </ul>
            </div>

            {isCreator && room.players.length >= 2 ? (
              <button onClick={handleStart} className="game-button w-full flex items-center justify-center gap-2 py-4">
                <PlayIcon className="w-6 h-6" /> Start Game
              </button>
            ) : isCreator ? (
              <p className="text-md font-bold text-[#ff5252] bg-white/50 p-3 rounded-xl border-2 border-white">Need at least 2 players to start.</p>
            ) : (
              <p className="text-md font-bold text-[#37474f] bg-white/50 p-3 rounded-xl border-2 border-white">Waiting for host to start...</p>
            )}
          </div>
        )}

        {/* Status: SETUP */}
        {room.status === 'setup' && (
          <div className="flex flex-col items-center w-full mt-4">
            <div className="flex items-center justify-between w-full max-w-lg mb-6 bg-white p-4 rounded-2xl shadow-lg border-4 border-white">
              <div>
                <h3 className="text-2xl font-black text-[#ff8f00]">Setup Grid</h3>
                <p className="text-xs font-bold text-gray-500">Fill numbers from 1 to {maxNumber}</p>
              </div>
              <div className="flex items-center gap-2 text-white bg-[#ff5252] px-4 py-2 rounded-xl font-bold shadow-sm">
                <ClockIcon className="w-6 h-6" /> {Math.floor(setupTimer/60)}:{(setupTimer%60).toString().padStart(2, '0')}
              </div>
            </div>
            
            {!me?.hasSubmittedGrid ? (
              <>
                <div className="flex flex-wrap justify-center gap-3 mb-6">
                  <button onClick={handleAutoFill} className="game-button game-button-blue px-5 py-2.5 text-sm">
                    🎲 Auto Fill
                  </button>
                  <button onClick={handleClearAll} className="game-button game-button-accent px-5 py-2.5 text-sm">
                    🗑️ Clear Grid
                  </button>
                </div>

                {/* Live Validation Error Banner */}
                {(activeError || submitErrorMessage) && (
                  <div className="w-full max-w-lg mb-6 bg-gradient-to-br from-red-500/15 via-red-50 to-orange-50 border-4 border-[#ff5252] rounded-3xl p-4 sm:p-5 shadow-xl transition-all duration-300">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className="bg-[#ff5252] text-white p-2.5 rounded-2xl shadow-md shrink-0 mt-0.5">
                        <ExclamationTriangleIcon className="w-6 h-6 sm:w-7 sm:h-7" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <h4 className="text-lg sm:text-xl font-black text-[#d32f2f]">
                            {activeError ? activeError.title : submitErrorMessage?.title}
                          </h4>
                          {activeError && (
                            <span className="text-xs font-black uppercase px-2.5 py-1 rounded-full bg-[#ff5252] text-white shadow-sm">
                              Cell #{activeError.cellIndex + 1} (Row {Math.floor(activeError.cellIndex / room.gridSize) + 1}, Col {(activeError.cellIndex % room.gridSize) + 1})
                            </span>
                          )}
                        </div>

                        <div className="space-y-2 text-sm sm:text-base font-bold text-[#37474f]">
                          <div className="flex items-start gap-2 bg-white/80 p-2.5 rounded-xl border border-red-200">
                            <span className="text-[#d32f2f] font-black shrink-0">Reason:</span>
                            <span className="text-[#37474f] leading-snug">
                              {activeError ? activeError.reason : submitErrorMessage?.reason}
                            </span>
                          </div>
                          <div className="flex items-start gap-2 bg-emerald-50/90 p-2.5 rounded-xl border border-emerald-200">
                            <span className="text-[#2e7d32] font-black shrink-0">💡 Fix:</span>
                            <span className="text-[#1b5e20] leading-snug">
                              {activeError ? activeError.fix : submitErrorMessage?.fix}
                            </span>
                          </div>
                        </div>

                        {activeError && (
                          <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                handleInputChange(activeError.cellIndex, '');
                                const el = document.getElementById(`setup-input-${activeError.cellIndex}`);
                                el?.focus();
                              }}
                              className="text-xs font-black text-[#d32f2f] hover:text-white bg-red-100 hover:bg-[#ff5252] px-3.5 py-1.5 rounded-xl transition-all border border-red-200 shadow-sm active:scale-95"
                            >
                              Clear This Cell
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Unused Numbers Helper Bar */}
                <div className="w-full max-w-lg mb-6 bg-white/70 backdrop-blur-md p-4 rounded-3xl border-4 border-white shadow-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-black text-[#37474f] flex items-center gap-1.5">
                      <LightBulbIcon className="w-5 h-5 text-[#ffca28]" />
                      {isGridComplete ? "All Numbers Placed!" : `Available Numbers (${unusedNumbers.length} remaining)`}
                    </span>
                    <span className="text-xs font-black px-2.5 py-1 rounded-xl bg-[#e0e6ed] text-[#37474f]">
                      Filled: {filledCount} / {maxNumber}
                    </span>
                  </div>

                  {!isGridComplete ? (
                    <>
                      <p className="text-xs font-bold text-gray-500 mb-2">
                        Click any number below to insert into the selected cell:
                      </p>
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 bg-[#f0f4f8] rounded-2xl border-2 border-[#e0e6ed]">
                        {unusedNumbers.map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => handleInsertNumber(n)}
                            title={`Place number ${n}`}
                            className="px-2.5 py-1 text-xs font-black bg-white hover:bg-[#ff8f00] text-[#37474f] hover:text-white rounded-xl shadow-sm border border-gray-200 transition-all transform hover:scale-110 active:scale-90"
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-2xl border-2 border-emerald-200 text-emerald-800 text-sm font-bold">
                      <CheckCircleIcon className="w-6 h-6 text-emerald-600 shrink-0" />
                      <span>Awesome! All {maxNumber} numbers placed with 0 duplicates. Click below to submit!</span>
                    </div>
                  )}
                </div>

                {/* The Setup Grid */}
                <div 
                  className="grid gap-2 sm:gap-3 bg-[#e0e6ed] p-4 sm:p-5 rounded-[2rem] border-4 border-white shadow-xl mb-8 mx-auto w-fit max-w-full justify-items-center"
                  style={{ gridTemplateColumns: `repeat(${room.gridSize}, minmax(0, 1fr))` }}
                >
                  {gridInputs.map((val, i) => {
                    const err = allErrors[i];
                    const isConflict = activeError?.conflictingCellIndex === i;
                    const isShaking = shakingCell === i;
                    const hasVal = val.trim() !== '';

                    return (
                      <div key={i} className="relative">
                        <input
                          key={i}
                          id={`setup-input-${i}`}
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={4}
                          value={val}
                          onFocus={() => {
                            setFocusedCell(i);
                            setSubmitErrorMessage(null);
                          }}
                          onChange={(e) => handleInputChange(i, e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, i)}
                          className={clsx(
                            getSetupCellSizeClass(room.gridSize),
                            "rounded-2xl flex items-center justify-center text-center font-black transition-all outline-none aspect-square",
                            err 
                              ? "bg-[#ffebee] text-[#d32f2f] border-4 border-[#ff5252] shadow-[0_0_12px_rgba(255,82,82,0.4)]" 
                              : isConflict
                              ? "bg-[#fff8e1] text-[#ff8f00] border-4 border-[#ffa000] animate-conflict-pulse"
                              : hasVal
                              ? "bg-white text-[#ff8f00] border-b-4 border-[#ffca28] shadow-sm focus:border-[#448aff] focus:ring-2 focus:ring-[#448aff]/40"
                              : "bg-[#f0f4f8] text-[#37474f] border-b-4 border-[#d1d9e6] shadow-inner focus:bg-white focus:border-[#448aff] focus:ring-2 focus:ring-[#448aff]/40",
                            isShaking && "animate-cell-shake"
                          )}
                        />
                        {err && (
                          <span 
                            title={err.reason}
                            className="absolute -top-1 -right-1 w-5 h-5 bg-[#ff5252] text-white rounded-full flex items-center justify-center text-xs font-black shadow-md pointer-events-none"
                          >
                            !
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <button 
                  onClick={handleSubmitGrid} 
                  className={clsx(
                    "game-button w-full max-w-md py-4 text-xl flex items-center justify-center gap-2",
                    isGridComplete && "animate-pulse"
                  )}
                >
                  <CheckCircleIcon className="w-6 h-6" /> Ready & Submit
                </button>
              </>
            ) : (
              <div className="game-panel p-10 text-center max-w-md w-full">
                <CheckCircleIcon className="w-20 h-20 text-[#69f0ae] mx-auto mb-6 drop-shadow-md" />
                <h3 className="text-3xl font-black text-[#37474f] mb-4">Grid Ready!</h3>
                <p className="text-lg font-bold text-[#37474f]/70 mb-6">Waiting for others to finish...</p>
                <div className="flex flex-wrap justify-center gap-3">
                  {room.players.map((p: Player, i: number) => (
                    <span key={i} className={clsx(
                      "px-4 py-2 rounded-xl text-sm font-black border-2 shadow-sm", 
                      p.hasSubmittedGrid ? "bg-[#69f0ae]/20 text-[#00c853] border-[#69f0ae]" : "bg-gray-100 text-gray-400 border-gray-200"
                    )}>
                      {p.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Status: PLAYING */}
        {room.status === 'playing' && (
          <div className="flex flex-col lg:flex-row gap-8 w-full">
            
            {/* Side Panel */}
            <div className="w-full lg:w-72 flex flex-col gap-6">
              <div className="game-panel p-5">
                <h3 className="text-lg font-black text-[#ff8f00] uppercase tracking-wider mb-4 border-b-4 border-gray-100 pb-2">Players</h3>
                <ul className="space-y-4">
                  {room.players.map((p: Player, i: number) => {
                    const isCurrentTurn = room.currentTurnIndex === i;
                    const isMe = p.id === socket.id;
                    return (
                      <li key={i} className={clsx(
                        "p-4 rounded-2xl border-4 transition-all relative overflow-hidden", 
                        isCurrentTurn ? "bg-white border-[#448aff] shadow-[0_8px_0_#2962ff] transform -translate-y-1" : "bg-[#f0f4f8] border-white shadow-sm"
                      )}>
                        <div className="flex justify-between items-center mb-2">
                          <span className={clsx("font-black text-lg", isCurrentTurn ? "text-[#448aff]" : "text-[#37474f]")}>
                            {p.name} {isMe && <span className="text-sm text-gray-400">(You)</span>}
                          </span>
                          {isCurrentTurn && <span className="text-xs font-black bg-[#ff5252] text-white px-3 py-1 rounded-lg animate-bounce">TURN</span>}
                        </div>
                        
                        <div className="w-full bg-gray-200 rounded-full h-3 mb-2 shadow-inner">
                          <div className="bg-[#69f0ae] h-3 rounded-full" style={{ width: `${(p.markedNumbers.length / (room.gridSize*room.gridSize)) * 100}%` }}></div>
                        </div>
                        
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-gray-500">Marked: {p.markedNumbers.length}</span>
                          {isMe && (
                            <span className="text-sm font-black text-[#ff8f00] flex items-center gap-1">
                              <TrophyIcon className="w-4 h-4"/> {getPlayerScore(p.grid, p.markedNumbers, room.gridSize)}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {/* Main Board */}
            <div className="flex-1 flex flex-col items-center">
              
              {/* Alert Banner */}
              {turnAlert && (
                <div className="w-full max-w-lg mb-6 bg-white border-4 border-[#ffca28] p-4 rounded-3xl text-center shadow-xl transform transition-all duration-300">
                  <h3 className="text-2xl font-black text-[#ff8f00] mb-1">{turnAlert}</h3>
                  {chosenNumber !== null && (
                    <div className="text-lg font-black text-[#ff5252] flex items-center justify-center gap-2">
                      <ClockIcon className="w-6 h-6" /> Time left: {turnTimer}s
                    </div>
                  )}
                </div>
              )}

              <div className="mb-6 text-center bg-white/80 p-4 rounded-3xl border-4 border-white shadow-lg w-full max-w-lg">
                <h3 className="text-3xl font-black text-[#37474f] mb-2">
                  {isMyTurn ? (chosenNumber === null ? "YOUR TURN!" : "WAITING FOR OTHERS...") : (chosenNumber === null ? "Wait for their turn..." : "MARK IT!")}
                </h3>
                {isMyTurn && chosenNumber === null && (
                  <p className="text-[#ff8f00] font-bold text-lg">Pick a number from your board!</p>
                )}
                {!isMyTurn && chosenNumber !== null && (
                  <p className="text-[#ff5252] font-black text-xl animate-pulse">Find {chosenNumber} on your board!</p>
                )}
              </div>

              {/* The Bingo Grid in Playing state with proper gridTemplateColumns */}
              <div 
                className="bingo-grid"
                style={{ gridTemplateColumns: `repeat(${room.gridSize}, minmax(0, 1fr))` }}
              >
                {me?.grid?.map((num: number | null, i: number) => {
                  const numVal = num as number;
                  const isMarked = me.markedNumbers.includes(numVal);
                  const isHighlight = chosenNumber === numVal && !isMarked;
                  
                  return (
                    <button
                      key={i}
                      onClick={() => handleCellClickPlay(numVal)}
                      disabled={isMarked || (chosenNumber !== null && chosenNumber !== numVal)}
                      className={clsx(
                        "bingo-cell",
                        getPlayingCellSizeClass(room.gridSize),
                        isMarked && "marked",
                        isHighlight && "marked-other animate-pulse scale-105 shadow-[0_0_20px_#ff5252]"
                      )}
                    >
                      {isMarked && <SparklesIcon className="w-8 h-8 sm:w-12 sm:h-12 opacity-30 absolute pointer-events-none" />}
                      <span className="relative z-10">{numVal}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Status: FINISHED */}
        {room.status === 'finished' && (
          <div className="game-panel p-10 sm:p-16 rounded-[3rem] text-center max-w-2xl w-full border-8 border-white shadow-[0_20px_50px_rgba(0,0,0,0.3)] bg-gradient-to-b from-white to-[#fff8e1]">
            <TrophyIcon className="w-32 h-32 text-[#ff8f00] mx-auto mb-6 drop-shadow-[0_10px_0_#c56000] animate-bounce" />
            <h2 className="title-3d text-[#ff5252] drop-shadow-[0_6px_0_#c62828] mb-2">GAME OVER!</h2>
            
            <div className="bg-[#ffca28] text-white p-4 rounded-3xl shadow-inner border-4 border-white mb-10 transform -rotate-2 inline-block px-10">
              <p className="text-3xl font-black uppercase">Winner: {room.winner}</p>
            </div>
            
            <div className="bg-white rounded-3xl p-8 mb-10 shadow-lg border-4 border-[#e0e6ed]">
              <h3 className="text-2xl font-black text-[#2962ff] mb-6 uppercase border-b-4 border-gray-100 pb-4">Final Scores</h3>
              <div className="space-y-4">
                {room.players.map((p: Player, i: number) => (
                  <div key={i} className="flex justify-between items-center text-xl font-bold bg-[#f0f4f8] p-4 rounded-2xl border-b-4 border-gray-200">
                    <span className="text-[#37474f]">{p.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[#ff8f00] text-3xl font-black">{getPlayerScore(p.grid, p.markedNumbers, room.gridSize)}</span>
                      <TrophyIcon className="w-8 h-8 text-[#ffca28]" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={() => router.push('/')} className="game-button game-button-blue w-full py-5 text-2xl shadow-[0_10px_0_#0039cb]">
              Play Again
            </button>
          </div>
        )}

      </div>
    </>
  );
}
