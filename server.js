const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = {};

const WORD_LIST_PATH = path.join(__dirname, "data", "cwl.txt");
const WORD_SET = loadWordList();
const SEVEN_LETTER_WORDS = [...WORD_SET].filter(word => word.length === 7);

function loadWordList() {
  if (!fs.existsSync(WORD_LIST_PATH)) {
    console.warn("No data/cwl.txt file found. Dictionary validation will reject all words.");
    return new Set();
  }

  const words = fs
    .readFileSync(WORD_LIST_PATH, "utf8")
    .split(/\r?\n/)
    .map(line => line.trim().toUpperCase())
    .filter(line => /^[A-Z]+$/.test(line));

  console.log(`Loaded ${words.length} words from data/cwl.txt`);
  return new Set(words);
}

// Official English Scrabble-style tile values.
const TILE_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1,
  J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1,
  S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
  "?": 0
};

// Official English Scrabble-style tile counts: 100 total, including 2 blanks.
const TILE_DISTRIBUTION = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9,
  J: 1, K: 1, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6,
  S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
  "?": 2
};

// Bonus layout uses:
// TW = triple word, DW = double word, TL = triple letter, DL = double letter
const BONUS_LAYOUT = [
  ["TW","","","DL","","","","TW","","","","DL","","","TW"],
  ["","DW","","","","TL","","","","TL","","","","DW",""],
  ["","","DW","","","","DL","","DL","","","","DW","",""],
  ["DL","","","DW","","","","DL","","","","DW","","","DL"],
  ["","","","","DW","","","","","","DW","","","",""],
  ["","TL","","","","TL","","","","TL","","","","TL",""],
  ["","","DL","","","","DL","","DL","","","","DL","",""],
  ["TW","","","DL","","","","DW","","","","DL","","","TW"],
  ["","","DL","","","","DL","","DL","","","","DL","",""],
  ["","TL","","","","TL","","","","TL","","","","TL",""],
  ["","","","","DW","","","","","","DW","","","",""],
  ["DL","","","DW","","","","DL","","","","DW","","","DL"],
  ["","","DW","","","","DL","","DL","","","","DW","",""],
  ["","DW","","","","TL","","","","TL","","","","DW",""],
  ["TW","","","DL","","","","TW","","","","DL","","","TW"]
];

function createTileBag() {
  const bag = [];

  for (const letter in TILE_DISTRIBUTION) {
    for (let i = 0; i < TILE_DISTRIBUTION[letter]; i++) {
      bag.push({
        id: cryptoId(),
        letter,
        displayLetter: letter,
        value: TILE_VALUES[letter],
        isBlank: letter === "?"
      });
    }
  }

  return shuffle(bag);
}

function cryptoId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function shuffle(array) {
  const copy = [...array];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function createBoard() {
  return Array.from({ length: 15 }, () =>
    Array.from({ length: 15 }, () => null)
  );
}

function drawTiles(room, player) {
  while (player.rack.length < 7 && room.bag.length > 0) {
    player.rack.push(room.bag.pop());
  }
}

function createBattleState() {
  return {
    active: false,
    finished: false,
    winnerId: null,
    winnerName: "",
    fighters: {},
    log: [],
    startedAt: null
  };
}

function addHistory(room, item) {
  room.history.unshift({
    id: cryptoId(),
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    ...item
  });

  room.history = room.history.slice(0, 20);
}

function canRackMakeSevenLetterWord(rack) {
  if (!rack || rack.length !== 7 || SEVEN_LETTER_WORDS.length === 0) return false;

  const counts = {};
  let blanks = 0;

  for (const tile of rack) {
    if (tile.isBlank || tile.letter === "?") {
      blanks += 1;
    } else {
      counts[tile.letter] = (counts[tile.letter] || 0) + 1;
    }
  }

  for (const word of SEVEN_LETTER_WORDS) {
    const needed = {};
    for (const letter of word) needed[letter] = (needed[letter] || 0) + 1;

    let missing = 0;
    for (const letter in needed) {
      missing += Math.max(0, needed[letter] - (counts[letter] || 0));
      if (missing > blanks) break;
    }

    if (missing <= blanks) return true;
  }

  return false;
}

function createRoom(roomCode) {
  rooms[roomCode] = {
    code: roomCode,
    players: [],
    board: createBoard(),
    bag: createTileBag(),
    started: false,
    gameOver: false,
    currentTurnIndex: 0,
    pendingMoves: {},
    consecutivePasses: 0,
    history: [],
    battle: createBattleState(),
    firstTurnChoice: null,
    lastMessage: `Waiting for players. Dictionary loaded: ${WORD_SET.size.toLocaleString()} words.`,
    gameOverSummary: null
  };

  return rooms[roomCode];
}

function getPlayer(room, socketId) {
  return room.players.find(player => player.id === socketId);
}

function getCurrentPlayer(room) {
  return room.players[room.currentTurnIndex];
}

function getPublicRoomState(room) {
  return {
    code: room.code,
    board: room.board,
    bonusLayout: BONUS_LAYOUT,
    players: room.players.map((player, index) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      rackCount: player.rack.length,
      isCurrentTurn: !room.gameOver && index === room.currentTurnIndex
    })),
    currentPlayerId: room.gameOver ? null : getCurrentPlayer(room)?.id || null,
    started: room.started,
    gameOver: room.gameOver,
    tilesLeft: room.bag.length,
    letterCountsNotOnBoard: getLetterCountsNotOnBoard(room),
    lastMessage: room.lastMessage,
    dictionarySize: WORD_SET.size,
    history: room.history,
    battle: getPublicBattleState(room),
    firstTurnChoice: room.firstTurnChoice,
    gameOverSummary: room.gameOverSummary
  };
}

function getPublicBattleState(room) {
  const battle = room.battle || createBattleState();

  return {
    active: battle.active,
    finished: battle.finished,
    winnerId: battle.winnerId,
    winnerName: battle.winnerName,
    fighters: Object.values(battle.fighters || {}).map(fighter => ({
      id: fighter.id,
      name: fighter.name,
      hp: fighter.hp,
      alive: fighter.alive
    })),
    log: battle.log.slice(0, 6)
  };
}

function emitRoom(room) {
  io.to(room.code).emit("roomState", getPublicRoomState(room));
  for (const player of room.players) {
    io.to(player.id).emit("rackUpdate", player.rack);
  }
}

function resetBlankForRack(tile) {
  if (tile.isBlank) {
    tile.displayLetter = "?";
    tile.value = 0;
  }
  return tile;
}

function removePendingMoves(room, playerId) {
  const moves = room.pendingMoves[playerId] || [];

  for (const move of moves) {
    room.board[move.row][move.col] = null;
  }

  const player = getPlayer(room, playerId);
  if (player) {
    const returnedTiles = moves.map(move => resetBlankForRack({ ...move.tile }));
    player.rack.push(...returnedTiles);
    player.rack.sort((a, b) => a.displayLetter.localeCompare(b.displayLetter));
  }

  room.pendingMoves[playerId] = [];
}

function allPendingTiles(room, playerId) {
  return room.pendingMoves[playerId] || [];
}

function isFirstMove(room) {
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const tile = room.board[row][col];
      if (tile && !tile.pending) return false;
    }
  }
  return true;
}

function hasNeighbour(room, row, col) {
  const directions = [[1,0],[-1,0],[0,1],[0,-1]];
  return directions.some(([dr, dc]) => {
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || r >= 15 || c < 0 || c >= 15) return false;
    return room.board[r][c] && !room.board[r][c].pending;
  });
}

function getWord(room, startRow, startCol, direction) {
  const [dr, dc] = direction;
  let row = startRow;
  let col = startCol;

  while (
    row - dr >= 0 &&
    row - dr < 15 &&
    col - dc >= 0 &&
    col - dc < 15 &&
    room.board[row - dr][col - dc]
  ) {
    row -= dr;
    col -= dc;
  }

  const cells = [];

  while (
    row >= 0 &&
    row < 15 &&
    col >= 0 &&
    col < 15 &&
    room.board[row][col]
  ) {
    cells.push({
      row,
      col,
      tile: room.board[row][col]
    });

    row += dr;
    col += dc;
  }

  return cells;
}

function getWordsFormed(room, playerId) {
  const moves = allPendingTiles(room, playerId);
  if (moves.length === 0) return [];

  const rows = [...new Set(moves.map(move => move.row))];
  const cols = [...new Set(moves.map(move => move.col))];

  let mainDirection = [0, 1];

  if (cols.length === 1 && rows.length > 1) {
    mainDirection = [1, 0];
  }

  const firstMove = moves[0];
  const mainWord = getWord(room, firstMove.row, firstMove.col, mainDirection);
  const crossDirection = mainDirection[0] === 0 ? [1, 0] : [0, 1];

  const words = [];

  if (mainWord.length > 1) {
    words.push(mainWord);
  }

  for (const move of moves) {
    const crossWord = getWord(room, move.row, move.col, crossDirection);
    if (crossWord.length > 1) {
      const key = crossWord.map(cell => `${cell.row},${cell.col}`).join("|");
      const alreadyAdded = words.some(word => word.map(cell => `${cell.row},${cell.col}`).join("|") === key);
      if (!alreadyAdded) words.push(crossWord);
    }
  }

  return words;
}

function cellsToWord(cells) {
  return cells.map(cell => cell.tile.displayLetter).join("").toUpperCase();
}

function validateMove(room, playerId) {
  const moves = allPendingTiles(room, playerId);

  if (moves.length === 0) {
    return { ok: false, message: "Place at least one tile first." };
  }

  const rows = [...new Set(moves.map(move => move.row))];
  const cols = [...new Set(moves.map(move => move.col))];

  const sameRow = rows.length === 1;
  const sameCol = cols.length === 1;

  if (!sameRow && !sameCol) {
    return { ok: false, message: "Tiles must be placed in one straight line." };
  }

  if (isFirstMove(room)) {
    const coversCentre = moves.some(move => move.row === 7 && move.col === 7);
    if (!coversCentre) {
      return { ok: false, message: "The first word must touch the centre star." };
    }
  } else {
    const touchesExistingTile = moves.some(move => hasNeighbour(room, move.row, move.col));
    if (!touchesExistingTile) {
      return { ok: false, message: "Your move must connect to a tile already on the board." };
    }
  }

  if (moves.length > 1) {
    if (sameRow) {
      const row = rows[0];
      const minCol = Math.min(...cols);
      const maxCol = Math.max(...cols);

      for (let col = minCol; col <= maxCol; col++) {
        if (!room.board[row][col]) {
          return { ok: false, message: "There cannot be gaps between placed tiles." };
        }
      }
    }

    if (sameCol) {
      const col = cols[0];
      const minRow = Math.min(...rows);
      const maxRow = Math.max(...rows);

      for (let row = minRow; row <= maxRow; row++) {
        if (!room.board[row][col]) {
          return { ok: false, message: "There cannot be gaps between placed tiles." };
        }
      }
    }
  }

  const words = getWordsFormed(room, playerId);

  if (words.length === 0) {
    return { ok: false, message: "Your move must create a word of at least 2 letters." };
  }

  const invalidWords = words
    .map(cellsToWord)
    .filter(word => !WORD_SET.has(word));

  if (invalidWords.length > 0) {
    return {
      ok: false,
      message: `Invalid word${invalidWords.length > 1 ? "s" : ""}: ${invalidWords.join(", ")}`
    };
  }

  return { ok: true, words };
}

function scoreWord(cells) {
  let letterTotal = 0;
  let wordMultiplier = 1;

  for (const cell of cells) {
    const bonus = cell.tile.pending ? BONUS_LAYOUT[cell.row][cell.col] : "";
    let letterScore = cell.tile.value;

    if (bonus === "DL") letterScore *= 2;
    if (bonus === "TL") letterScore *= 3;
    if (bonus === "DW") wordMultiplier *= 2;
    if (bonus === "TW") wordMultiplier *= 3;

    letterTotal += letterScore;
  }

  return letterTotal * wordMultiplier;
}

function calculateTurnScore(room, playerId, words) {
  const moves = allPendingTiles(room, playerId);

  const wordSummaries = words.map(cells => ({
    word: cellsToWord(cells),
    score: scoreWord(cells)
  }));

  let total = wordSummaries.reduce((sum, word) => sum + word.score, 0);

  if (moves.length === 7) {
    total += 50;
    wordSummaries.push({ word: "7-tile bonus", score: 50 });
  }

  return { total, wordSummaries };
}

function rackValue(player) {
  return player.rack.reduce((sum, tile) => sum + Number(tile.value || 0), 0);
}

function getLetterCountsNotOnBoard(room) {
  const counts = { ...TILE_DISTRIBUTION };

  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const tile = room.board[row][col];

      if (tile) {
        const physicalLetter = tile.letter;
        counts[physicalLetter] = Math.max(0, (counts[physicalLetter] || 0) - 1);
      }
    }
  }

  return counts;
}

function finishGame(room, reason, outPlayer = null) {
  if (room.gameOver) return;

  const adjustments = [];
  let totalLeftover = 0;

  for (const player of room.players) {
    const leftover = rackValue(player);
    totalLeftover += leftover;

    if (leftover > 0) {
      player.score -= leftover;
      adjustments.push(`${player.name} -${leftover}`);
    } else {
      adjustments.push(`${player.name} -0`);
    }
  }

  if (outPlayer) {
    outPlayer.score += totalLeftover;
    adjustments.push(`${outPlayer.name} +${totalLeftover} for opponents' remaining tiles`);
  }

  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 0;
  const winners = sorted.filter(player => player.score === topScore).map(player => player.name);

  room.gameOver = true;
  room.currentTurnIndex = 0;
  room.gameOverSummary = {
    reason,
    adjustments,
    winners,
    finalScores: sorted.map(player => ({
      name: player.name,
      score: player.score,
      leftoverRackValue: rackValue(player)
    }))
  };

  room.lastMessage = `Game over! ${reason} Winner${winners.length > 1 ? "s" : ""}: ${winners.join(", ")}.`;
}

function advanceTurn(room) {
  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
}

function canExchangeTiles(room, player, tileIds) {
  if (!Array.isArray(tileIds) || tileIds.length === 0) {
    return { ok: false, message: "Select at least one tile to exchange." };
  }

  const uniqueIds = [...new Set(tileIds)];

  if (uniqueIds.length !== tileIds.length) {
    return { ok: false, message: "Duplicate tile selection detected." };
  }

  if (room.bag.length < uniqueIds.length) {
    return {
      ok: false,
      message: `Not enough tiles left to exchange. Tiles left in bag: ${room.bag.length}.`
    };
  }

  const rackIds = new Set(player.rack.map(tile => tile.id));

  for (const id of uniqueIds) {
    if (!rackIds.has(id)) {
      return { ok: false, message: "One of the selected tiles is no longer in your rack." };
    }
  }

  return { ok: true, tileIds: uniqueIds };
}

io.on("connection", socket => {
  socket.on("joinRoom", ({ roomCode, playerName }) => {
    roomCode = String(roomCode || "").trim().toUpperCase();
    playerName = String(playerName || "").trim().slice(0, 18);

    if (!roomCode || !playerName) {
      socket.emit("errorMessage", "Enter your name and a room code.");
      return;
    }

    const room = rooms[roomCode] || createRoom(roomCode);

    if (room.started && !room.players.some(player => player.id === socket.id)) {
      socket.emit("errorMessage", "This game has already started. Create a new room.");
      return;
    }

    if (room.players.length >= 4) {
      socket.emit("errorMessage", "This room already has 4 players.");
      return;
    }

    const existing = room.players.find(player => player.id === socket.id);
    if (!existing) {
      room.players.push({
        id: socket.id,
        name: playerName,
        rack: [],
        score: 0
      });
    }

    socket.join(roomCode);

    socket.emit("joined", {
      playerId: socket.id,
      roomCode
    });

    emitRoom(room);
  });

  socket.on("startGame", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    if (room.players.length < 2) {
      socket.emit("errorMessage", "You need at least 2 players to start.");
      return;
    }

    if (WORD_SET.size === 0) {
      socket.emit("errorMessage", "No word list is loaded. Add words to data/cwl.txt, then restart the server.");
      return;
    }

    if (room.started) return;

    room.started = true;
    room.gameOver = false;
    room.battle.active = false;
    room.lastMessage = "Game started! First player begins.";

    for (const player of room.players) {
      drawTiles(room, player);
    }

    emitRoom(room);
  });

  socket.on("placeTile", ({ roomCode, tileId, row, col, blankLetter }) => {
    const room = rooms[roomCode];
    if (!room || !room.started || room.gameOver) return;

    const player = getPlayer(room, socket.id);
    const currentPlayer = getCurrentPlayer(room);

    row = Number(row);
    col = Number(col);

    if (!player || !currentPlayer || currentPlayer.id !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }

    if (row < 0 || row >= 15 || col < 0 || col >= 15) return;

    if (room.board[row][col]) {
      socket.emit("errorMessage", "That square already has a tile.");
      return;
    }

    const tileIndex = player.rack.findIndex(tile => tile.id === tileId);
    if (tileIndex === -1) return;

    const [tile] = player.rack.splice(tileIndex, 1);

    if (tile.isBlank) {
      const chosen = String(blankLetter || "").trim().toUpperCase();
      if (!/^[A-Z]$/.test(chosen)) {
        player.rack.push(resetBlankForRack(tile));
        socket.emit("errorMessage", "Choose a letter for the blank tile.");
        emitRoom(room);
        return;
      }
      tile.displayLetter = chosen;
      tile.value = 0;
    }

    const boardTile = {
      ...tile,
      pending: true,
      placedBy: socket.id
    };

    room.board[row][col] = boardTile;

    if (!room.pendingMoves[socket.id]) {
      room.pendingMoves[socket.id] = [];
    }

    room.pendingMoves[socket.id].push({ row, col, tile });

    emitRoom(room);
  });

  socket.on("recallTiles", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.gameOver) return;

    const currentPlayer = getCurrentPlayer(room);
    if (!currentPlayer || currentPlayer.id !== socket.id) return;

    removePendingMoves(room, socket.id);
    room.lastMessage = "Tiles recalled.";
    emitRoom(room);
  });

  socket.on("submitTurn", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.gameOver) return;

    const player = getPlayer(room, socket.id);
    const currentPlayer = getCurrentPlayer(room);

    if (!player || !currentPlayer || currentPlayer.id !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }

    const hadBingoAvailable = canRackMakeSevenLetterWord(player.rack);
    const validation = validateMove(room, socket.id);

    if (!validation.ok) {
      socket.emit("errorMessage", validation.message);
      return;
    }

    const result = calculateTurnScore(room, socket.id, validation.words);
    player.score += result.total;

    const moves = allPendingTiles(room, socket.id);
    for (const move of moves) {
      room.board[move.row][move.col].pending = false;
      delete room.board[move.row][move.col].placedBy;
    }

    room.pendingMoves[socket.id] = [];
    drawTiles(room, player);

    const wordText = result.wordSummaries
      .map(item => `${item.word} (${item.score})`)
      .join(", ");

    room.consecutivePasses = 0;
    room.lastMessage = `${player.name} scored ${result.total}: ${wordText}`;

    addHistory(room, {
      type: "play",
      player: player.name,
      text: `${player.name}: ${wordText}`,
      score: result.total
    });

    if (hadBingoAvailable && moves.length < 7) {
      io.to(player.id).emit("bingoMissed", { message: "You had bingo, ya dingus" });
    }

    if (moves.length === 7) {
      io.to(room.code).emit("bingoPlayed", {
        playerName: player.name,
        message: `${player.name} played all 7 tiles!`
      });
    }

    if (room.bag.length === 0 && player.rack.length === 0) {
      finishGame(room, `${player.name} used all their tiles with no tiles left in the bag.`, player);
      emitRoom(room);
      return;
    }

    advanceTurn(room);
    emitRoom(room);
  });

  socket.on("exchangeTiles", ({ roomCode, tileIds }) => {
    const room = rooms[roomCode];
    if (!room || !room.started || room.gameOver) return;

    const player = getPlayer(room, socket.id);
    const currentPlayer = getCurrentPlayer(room);

    if (!player || !currentPlayer || currentPlayer.id !== socket.id) {
      socket.emit("errorMessage", "It is not your turn.");
      return;
    }

    if (allPendingTiles(room, socket.id).length > 0) {
      socket.emit("errorMessage", "Recall your placed tiles before exchanging.");
      return;
    }

    const check = canExchangeTiles(room, player, tileIds);

    if (!check.ok) {
      socket.emit("errorMessage", check.message);
      return;
    }

    const returning = [];

    player.rack = player.rack.filter(tile => {
      if (check.tileIds.includes(tile.id)) {
        returning.push(resetBlankForRack(tile));
        return false;
      }
      return true;
    });

    // Draw replacement tiles first, then return exchanged tiles to the bag.
    const exchangedCount = returning.length;
    for (let i = 0; i < exchangedCount && room.bag.length > 0; i++) {
      player.rack.push(room.bag.pop());
    }

    room.bag = shuffle([...room.bag, ...returning]);
    room.consecutivePasses = 0;
    room.lastMessage = `${player.name} exchanged ${exchangedCount} tile${exchangedCount === 1 ? "" : "s"} and lost their turn.`;
    addHistory(room, {
      type: "exchange",
      player: player.name,
      text: `${player.name} exchanged ${exchangedCount} tile${exchangedCount === 1 ? "" : "s"}.`,
      score: null
    });

    advanceTurn(room);
    emitRoom(room);
  });

  socket.on("passTurn", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.gameOver) return;

    const currentPlayer = getCurrentPlayer(room);
    if (!currentPlayer || currentPlayer.id !== socket.id) return;

    removePendingMoves(room, socket.id);

    room.consecutivePasses += 1;
    room.lastMessage = `${currentPlayer.name} passed.`;
    addHistory(room, {
      type: "pass",
      player: currentPlayer.name,
      text: `${currentPlayer.name} passed.`,
      score: null
    });

    // Optional practical end condition: if everyone passes twice in a row and the bag is empty, end the game.
    if (room.bag.length === 0 && room.consecutivePasses >= room.players.length * 2) {
      finishGame(room, "All players passed twice in a row with no tiles left in the bag.");
      emitRoom(room);
      return;
    }

    advanceTurn(room);
    emitRoom(room);
  });

  socket.on("startBattle", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.started || room.gameOver) return;

    if (room.players.length < 2) {
      socket.emit("errorMessage", "You need at least 2 players for the first-turn fight.");
      return;
    }

    room.battle = createBattleState();
    room.battle.active = true;
    room.battle.finished = false;
    room.battle.startedAt = Date.now();
    room.battle.log.unshift("The pixel fight begins!");

    for (const player of room.players) {
      room.battle.fighters[player.id] = {
        id: player.id,
        name: player.name,
        hp: 100,
        alive: true,
        lastAttack: 0
      };
    }

    room.lastMessage = "First-turn pixel fight started! Mash Attack until one fighter remains.";
    emitRoom(room);
  });

  socket.on("battleAttack", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || !room.battle || !room.battle.active || room.battle.finished) return;

    const fighter = room.battle.fighters[socket.id];
    if (!fighter || !fighter.alive) return;

    const now = Date.now();
    if (now - fighter.lastAttack < 650) {
      socket.emit("errorMessage", "Your fighter needs a split second to recover!");
      return;
    }

    fighter.lastAttack = now;

    const opponents = Object.values(room.battle.fighters).filter(item => item.id !== socket.id && item.alive);
    if (opponents.length === 0) return;

    const target = opponents[Math.floor(Math.random() * opponents.length)];
    const damage = Math.floor(Math.random() * 10) + 8;

    target.hp = Math.max(0, target.hp - damage);
    room.battle.log.unshift(`${fighter.name} bonked ${target.name} for ${damage}.`);

    if (target.hp <= 0) {
      target.alive = false;
      room.battle.log.unshift(`${target.name} has been dramatically pixel-punched out.`);
    }

    const alive = Object.values(room.battle.fighters).filter(item => item.alive);

    if (alive.length === 1) {
      const winner = alive[0];
      room.battle.active = false;
      room.battle.finished = true;
      room.battle.winnerId = winner.id;
      room.battle.winnerName = winner.name;
      room.lastMessage = `${winner.name} won the pixel fight! They choose whether to go first or second.`;
    }

    emitRoom(room);
  });

  socket.on("chooseTurnOrder", ({ roomCode, choice }) => {
    const room = rooms[roomCode];
    if (!room || room.started || !room.battle || !room.battle.finished) return;

    const winnerId = room.battle.winnerId;
    if (socket.id !== winnerId) {
      socket.emit("errorMessage", "Only the pixel fight winner can choose.");
      return;
    }

    const winnerIndex = room.players.findIndex(player => player.id === winnerId);
    if (winnerIndex === -1) return;

    if (choice === "second") {
      room.currentTurnIndex = (winnerIndex + 1) % room.players.length;
      room.firstTurnChoice = `${room.players[winnerIndex].name} chose to go second.`;
    } else {
      room.currentTurnIndex = winnerIndex;
      room.firstTurnChoice = `${room.players[winnerIndex].name} chose to go first.`;
    }

    room.lastMessage = `${room.firstTurnChoice} Click Start Game when ready.`;
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const index = room.players.findIndex(player => player.id === socket.id);

      if (index !== -1) {
        room.players.splice(index, 1);
        delete room.pendingMoves[socket.id];

        if (room.players.length === 0) {
          delete rooms[roomCode];
        } else if (!room.gameOver) {
          room.currentTurnIndex = room.currentTurnIndex % room.players.length;
          room.lastMessage = "A player disconnected.";
          emitRoom(room);
        }

        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Game running at http://localhost:${PORT}`);
});
