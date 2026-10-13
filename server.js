import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server } from 'socket.io';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;

// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });
  
  const io = new Server(httpServer);

  const rooms = new Map();

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', ({ roomName, isPrivate, password, gridSize, creatorName }) => {
        const roomId = Math.random().toString(36).substring(2, 9);
        const room = {
           id: roomId,
           name: roomName,
           isPrivate,
           password,
           gridSize: Number(gridSize),
           players: [{ id: socket.id, name: creatorName, grid: [], markedNumbers: [] }],
           status: 'waiting', // waiting | setup | playing | finished
           currentTurnIndex: 0,
           currentChosenNumber: null,
           playersMarked: new Set(),
           winner: null
        };
        rooms.set(roomId, room);
        socket.join(roomId);
        socket.emit('roomCreated', room.id);
        io.to(roomId).emit('roomUpdated', getSafeRoom(room));
    });

    socket.on('joinRoom', ({ roomId, password, playerName }) => {
        const room = rooms.get(roomId);
        if (!room) return socket.emit('error', 'Room not found');
        if (room.isPrivate && room.password !== password) return socket.emit('error', 'Incorrect password');
        if (room.status !== 'waiting') return socket.emit('error', 'Game already started');

        room.players.push({ id: socket.id, name: playerName, grid: [], markedNumbers: [] });
        socket.join(roomId);
        io.to(roomId).emit('roomUpdated', getSafeRoom(room));
    });

    socket.on('startGame', (roomId) => {
        const room = rooms.get(roomId);
        if (room && room.players[0].id === socket.id && room.players.length >= 2) {
            room.status = 'setup';
            io.to(roomId).emit('gameStatusChanged', { status: 'setup', room: getSafeRoom(room) });
            // start 2 min timer
            setTimeout(() => {
               const currentRoom = rooms.get(roomId);
               if (currentRoom && currentRoom.status === 'setup') {
                   // Auto-fill grids for players who haven't submitted
                   currentRoom.players.forEach(p => {
                       if (!p.grid || p.grid.length === 0) {
                           const size = currentRoom.gridSize;
                           const max = size * size;
                           const nums = Array.from({length: max}, (_, i) => i + 1).sort(() => Math.random() - 0.5);
                           p.grid = nums;
                       }
                   });
                   currentRoom.status = 'playing';
                   io.to(roomId).emit('gameStatusChanged', { status: 'playing', room: getSafeRoom(currentRoom) });
               }
            }, 120000);
        }
    });

    socket.on('submitGrid', ({ roomId, grid }) => {
        const room = rooms.get(roomId);
        if (room && room.status === 'setup') {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                const max = room.gridSize * room.gridSize;
                if (!Array.isArray(grid) || grid.length !== max) {
                    return socket.emit('error', `Grid must contain exactly ${max} numbers.`);
                }
                const set = new Set();
                for (const num of grid) {
                    if (typeof num !== 'number' || isNaN(num) || num < 1 || num > max) {
                        return socket.emit('error', `Grid numbers must be whole numbers between 1 and ${max}.`);
                    }
                    if (set.has(num)) {
                        return socket.emit('error', `Duplicate number ${num} is not allowed.`);
                    }
                    set.add(num);
                }

                player.grid = grid;
                io.to(roomId).emit('roomUpdated', getSafeRoom(room));
                
                // check if all players submitted
                if (room.players.every(p => p.grid && p.grid.length > 0)) {
                    room.status = 'playing';
                    io.to(roomId).emit('gameStatusChanged', { status: 'playing', room: getSafeRoom(room) });
                }
            }
        }
    });

    socket.on('chooseNumber', ({ roomId, number }) => {
        const room = rooms.get(roomId);
        if (room && room.status === 'playing') {
            if (room.players[room.currentTurnIndex].id === socket.id) {
                if (room.currentChosenNumber === null) {
                    room.currentChosenNumber = number;
                    room.playersMarked = new Set();
                    
                    const player = room.players[room.currentTurnIndex];
                    if (!player.markedNumbers.includes(number)) {
                       player.markedNumbers.push(number);
                    }
                    room.playersMarked.add(socket.id);
                    
                    io.to(roomId).emit('numberChosen', { number, chooserId: socket.id, chooserName: player.name });
                    
                    // start 30s timer
                    room.turnTimer = setTimeout(() => {
                        handleTurnEnd(room, roomId);
                    }, 30000);

                    // Check if everyone already marked (e.g. 1 player somehow)
                    if (room.playersMarked.size === room.players.length) {
                        clearTimeout(room.turnTimer);
                        handleTurnEnd(room, roomId);
                    }
                }
            }
        }
    });

    socket.on('markNumber', ({ roomId }) => {
         const room = rooms.get(roomId);
         if (room && room.status === 'playing' && room.currentChosenNumber !== null) {
             const player = room.players.find(p => p.id === socket.id);
             if (player && !room.playersMarked.has(socket.id)) {
                 if (!player.markedNumbers.includes(room.currentChosenNumber)) {
                     player.markedNumbers.push(room.currentChosenNumber);
                 }
                 room.playersMarked.add(socket.id);
                 
                 // check if everyone marked
                 if (room.playersMarked.size === room.players.length) {
                     clearTimeout(room.turnTimer);
                     handleTurnEnd(room, roomId);
                 } else {
                     io.to(roomId).emit('playerMarked', socket.id);
                 }
             }
         }
    });

    socket.on('disconnect', () => {
        rooms.forEach((room, roomId) => {
            const pIdx = room.players.findIndex(p => p.id === socket.id);
            if (pIdx !== -1) {
                room.players.splice(pIdx, 1);
                io.to(roomId).emit('roomUpdated', getSafeRoom(room));
                if (room.players.length === 0) {
                    rooms.delete(roomId);
                }
            }
        });
    });
    
    function handleTurnEnd(room, roomId) {
        // Auto mark for those who didn't
        room.players.forEach(p => {
            if (!room.playersMarked.has(p.id)) {
                if (!p.markedNumbers.includes(room.currentChosenNumber)) {
                    p.markedNumbers.push(room.currentChosenNumber);
                }
            }
        });

        // Check for winners
        const winners = [];
        room.players.forEach(p => {
            if (checkWin(p.grid, p.markedNumbers, room.gridSize)) {
                winners.push(p);
            }
        });

        if (winners.length > 0) {
            room.status = 'finished';
            room.winner = winners.map(w => w.name).join(', ');
            io.to(roomId).emit('gameOver', { winners: room.winner, room: getSafeRoom(room) });
        } else {
            room.currentChosenNumber = null;
            room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
            io.to(roomId).emit('nextTurn', { currentTurnIndex: room.currentTurnIndex, room: getSafeRoom(room) });
        }
    }
  });

  function getSafeRoom(room) {
      return {
          id: room.id,
          name: room.name,
          gridSize: room.gridSize,
          isPrivate: room.isPrivate,
          players: room.players.map(p => ({
             id: p.id,
             name: p.name,
             hasSubmittedGrid: p.grid && p.grid.length > 0,
             markedNumbers: p.markedNumbers,
             grid: p.grid // Sending grid back so clients can render it, wait, sending grid of other players is okay for spectator but maybe it's a secret? Bingo usually you can see others' grids. Let's send it.
          })),
          status: room.status,
          currentTurnIndex: room.currentTurnIndex,
          currentChosenNumber: room.currentChosenNumber,
          winner: room.winner
      };
  }

  function checkWin(grid, marked, size) {
      if(!grid || grid.length === 0) return false;
      const markedSet = new Set(marked);
      let stars = 0;
      
      // check rows
      for(let r=0; r<size; r++) {
         let rowWin = true;
         for(let c=0; c<size; c++) {
            if (!markedSet.has(grid[r * size + c])) { rowWin = false; break; }
         }
         if (rowWin) stars++;
      }
      // check cols
      for(let c=0; c<size; c++) {
         let colWin = true;
         for(let r=0; r<size; r++) {
            if (!markedSet.has(grid[r * size + c])) { colWin = false; break; }
         }
         if (colWin) stars++;
      }
      // check diagonals
      let d1Win = true;
      let d2Win = true;
      for(let i=0; i<size; i++) {
         if (!markedSet.has(grid[i * size + i])) d1Win = false;
         if (!markedSet.has(grid[i * size + (size - 1 - i)])) d2Win = false;
      }
      if (d1Win) stars++;
      if (d2Win) stars++;

      return stars >= size;
  }

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});
