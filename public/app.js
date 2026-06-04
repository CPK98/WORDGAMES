const socket = io();

let playerId = null;
let roomCode = null;
let myRack = [];
let latestRoom = null;
let selectedForExchange = new Set();
const keys = {};

const joinScreen = document.getElementById("join-screen");
const gameScreen = document.getElementById("game-screen");
const playerNameInput = document.getElementById("player-name");
const roomCodeInput = document.getElementById("room-code");
const joinBtn = document.getElementById("join-btn");
const roomLabel = document.getElementById("room-label");
const tilesLeft = document.getElementById("tiles-left");
const dictionarySize = document.getElementById("dictionary-size");
const playersDiv = document.getElementById("players");
const boardDiv = document.getElementById("board");
const rackDiv = document.getElementById("rack");
const messageDiv = document.getElementById("message");
const startBtn = document.getElementById("start-btn");
const submitBtn = document.getElementById("submit-btn");
const passBtn = document.getElementById("pass-btn");
const recallBtn = document.getElementById("recall-btn");
const exchangeBtn = document.getElementById("exchange-btn");
const gameOverPanel = document.getElementById("game-over-panel");
const letterCountsDiv = document.getElementById("letter-counts");
const historyList = document.getElementById("history-list");
const kombatBtn = document.getElementById("kombat-btn");
const fighterSelect = document.getElementById("fighter-select");
const kombatStagePanel = document.getElementById("kombat-stage-panel");
const kombatCanvas = document.getElementById("kombat-canvas");
const kombatCtx = kombatCanvas.getContext("2d");
const kombatStatus = document.getElementById("kombat-status");
const kombatChoice = document.getElementById("kombat-choice");
const kombatLog = document.getElementById("kombat-log");
const popup = document.getElementById("popup");
const confettiLayer = document.getElementById("confetti-layer");

joinBtn.addEventListener("click", joinRoom);
playerNameInput.addEventListener("keydown", event => {
  if (event.key === "Enter") joinRoom();
});
roomCodeInput.addEventListener("keydown", event => {
  if (event.key === "Enter") joinRoom();
});

startBtn.addEventListener("click", () => {
  socket.emit("startGame", { roomCode });
});

kombatBtn.addEventListener("click", () => {
  socket.emit("startKombat", { roomCode });
});

document.querySelectorAll("[data-fighter]").forEach(button => {
  button.addEventListener("click", () => {
    socket.emit("chooseFighter", {
      roomCode,
      fighter: button.dataset.fighter
    });
  });
});

submitBtn.addEventListener("click", () => {
  socket.emit("submitTurn", { roomCode });
});

passBtn.addEventListener("click", () => {
  socket.emit("passTurn", { roomCode });
});

recallBtn.addEventListener("click", () => {
  socket.emit("recallTiles", { roomCode });
});

exchangeBtn.addEventListener("click", () => {
  if (selectedForExchange.size === 0) {
    alert("Click one or more rack tiles first, then exchange.");
    return;
  }

  const count = selectedForExchange.size;
  const confirmed = confirm(`Exchange ${count} selected tile${count === 1 ? "" : "s"} and lose your turn?`);

  if (!confirmed) return;

  socket.emit("exchangeTiles", {
    roomCode,
    tileIds: [...selectedForExchange]
  });

  selectedForExchange.clear();
});

window.addEventListener("keydown", event => {
  keys[event.key.toLowerCase()] = true;
});

window.addEventListener("keyup", event => {
  keys[event.key.toLowerCase()] = false;
});

setInterval(() => {
  if (!latestRoom?.kombat?.active) return;

  const order = latestRoom.kombat.fighters.map(f => f.id);
  const myIndex = order.indexOf(playerId);

  if (myIndex === -1) return;

  const input = myIndex === 0
    ? {
        left: Boolean(keys["a"]),
        right: Boolean(keys["d"]),
        jump: Boolean(keys["w"]),
        block: Boolean(keys["s"]),
        attack: Boolean(keys["f"]),
        special: Boolean(keys["g"])
      }
    : {
        left: Boolean(keys["arrowleft"]),
        right: Boolean(keys["arrowright"]),
        jump: Boolean(keys["arrowup"]),
        block: Boolean(keys["arrowdown"]),
        attack: Boolean(keys["k"]),
        special: Boolean(keys["l"])
      };

  socket.emit("kombatInput", { roomCode, input });
}, 50);

function joinRoom() {
  const playerName = playerNameInput.value.trim();
  const enteredRoomCode = roomCodeInput.value.trim();

  if (!playerName || !enteredRoomCode) {
    alert("Please enter your name and a room code.");
    return;
  }

  socket.emit("joinRoom", {
    playerName,
    roomCode: enteredRoomCode
  });
}

socket.on("joined", data => {
  playerId = data.playerId;
  roomCode = data.roomCode;

  joinScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");

  roomLabel.textContent = roomCode;
});

socket.on("roomState", room => {
  latestRoom = room;
  renderRoom(room);
});

socket.on("rackUpdate", rack => {
  myRack = rack;

  const rackIds = new Set(myRack.map(tile => tile.id));
  selectedForExchange = new Set([...selectedForExchange].filter(id => rackIds.has(id)));

  renderRack();
});

socket.on("errorMessage", message => {
  showMessage(message);
});

socket.on("bingoMissed", data => {
  showPopup(data.message || "You had bingo, ya dingus");
});

socket.on("bingoPlayed", data => {
  showPopup(data.message || "Bingo!");
  launchConfetti();
});

function renderRoom(room) {
  roomLabel.textContent = room.code;
  tilesLeft.textContent = room.tilesLeft;
  dictionarySize.textContent = Number(room.dictionarySize || 0).toLocaleString();

  renderPlayers(room.players);
  renderBoard(room);
  renderLetterCounts(room.letterCountsNotOnBoard);
  renderHistory(room.history || []);
  renderKombat(room.kombat);
  renderGameOver(room);

  const isMyTurn = room.currentPlayerId === playerId;
  const gameStarted = room.started;
  const gameOver = room.gameOver;

  startBtn.disabled = gameStarted || Boolean(room.kombat?.active);
  kombatBtn.disabled = gameStarted || gameOver || Boolean(room.kombat?.active);
  submitBtn.disabled = !gameStarted || !isMyTurn || gameOver;
  passBtn.disabled = !gameStarted || !isMyTurn || gameOver;
  recallBtn.disabled = !gameStarted || !isMyTurn || gameOver;
  exchangeBtn.disabled = !gameStarted || !isMyTurn || gameOver || selectedForExchange.size === 0;

  fighterSelect.classList.toggle("hidden", gameStarted || Boolean(room.kombat?.active));

  showMessage(room.lastMessage || "Waiting for players.");
}

function renderPlayers(players) {
  playersDiv.innerHTML = "";

  players.forEach(player => {
    const card = document.createElement("div");
    card.className = "player-card";

    if (player.isCurrentTurn) {
      card.classList.add("current-turn");
    }

    card.innerHTML = `
      <div class="player-name">${escapeHTML(player.name)}</div>
      <div class="player-meta">Score: <strong>${player.score}</strong></div>
      <div class="player-meta">Rack: ${player.rackCount} tiles</div>
    `;

    playersDiv.appendChild(card);
  });
}

function renderKombat(kombat) {
  if (!kombat || (!kombat.active && !kombat.finished)) {
    kombatStagePanel.classList.add("hidden");
    kombatChoice.classList.add("hidden");
    kombatChoice.innerHTML = "";
    drawEmptyStage();
    return;
  }

  kombatStagePanel.classList.remove("hidden");

  if (kombat.active) {
    kombatStatus.textContent = "Fight!";
  } else if (kombat.finished) {
    kombatStatus.textContent = `${kombat.winnerName} wins!`;
  }

  drawKombat(kombat);

  kombatLog.innerHTML = (kombat.log || []).map(line => `<div>${escapeHTML(line)}</div>`).join("");

  if (kombat.finished && kombat.winnerId === playerId && !latestRoom.started) {
    kombatChoice.classList.remove("hidden");
    kombatChoice.innerHTML = `
      <button id="choose-first-btn" class="primary-btn">I want to go first</button>
      <button id="choose-second-btn">I want to go second</button>
    `;

    document.getElementById("choose-first-btn").addEventListener("click", () => {
      socket.emit("chooseTurnOrder", { roomCode, choice: "first" });
    });

    document.getElementById("choose-second-btn").addEventListener("click", () => {
      socket.emit("chooseTurnOrder", { roomCode, choice: "second" });
    });
  } else if (kombat.finished && !latestRoom.started) {
    kombatChoice.classList.remove("hidden");
    kombatChoice.innerHTML = `<strong>${escapeHTML(kombat.winnerName)}</strong> chooses who starts.`;
  } else {
    kombatChoice.classList.add("hidden");
    kombatChoice.innerHTML = "";
  }
}

function drawEmptyStage() {
  const ctx = kombatCtx;
  ctx.clearRect(0, 0, kombatCanvas.width, kombatCanvas.height);
}

function drawKombat(kombat) {
  const ctx = kombatCtx;
  ctx.clearRect(0, 0, kombatCanvas.width, kombatCanvas.height);

  drawPixelBackground(ctx);

  const fighters = kombat.fighters || [];

  fighters.forEach((fighter, index) => {
    drawHealthBar(ctx, fighter, index);
  });

  fighters.forEach(fighter => {
    drawFighter(ctx, fighter);
  });

  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.font = "16px monospace";
  ctx.fillText("P1: WASD + F/G   P2: ARROWS + K/L", 250, 402);
}

function drawPixelBackground(ctx) {
  ctx.fillStyle = "#171024";
  ctx.fillRect(0, 0, 860, 420);

  ctx.fillStyle = "#261943";
  for (let x = 0; x < 860; x += 52) {
    const h = 90 + ((x * 7) % 120);
    ctx.fillRect(x, 260 - h, 44, h);
  }

  ctx.fillStyle = "#3b2863";
  for (let x = 0; x < 860; x += 22) {
    ctx.fillRect(x, 306, 18, 12);
  }

  ctx.fillStyle = "#4f347e";
  ctx.fillRect(0, 320, 860, 100);

  ctx.fillStyle = "#302052";
  for (let x = 0; x < 860; x += 36) {
    ctx.fillRect(x, 344, 24, 8);
  }

  ctx.fillStyle = "#f2d67a";
  ctx.font = "28px monospace";
  ctx.fillText("TILE KOMBAT", 330, 54);
}

function drawHealthBar(ctx, fighter, index) {
  const x = index === 0 ? 24 : 536;
  const y = 20;
  const w = 300;
  const h = 22;

  ctx.fillStyle = "#000000";
  ctx.fillRect(x - 4, y - 4, w + 8, h + 32);

  ctx.fillStyle = "#ffffff";
  ctx.font = "14px monospace";
  ctx.fillText(`${fighter.playerName} — ${fighter.characterName}`, x, y + 42);

  ctx.fillStyle = "#5a1f2f";
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = fighter.hp > 40 ? "#4ce26b" : "#ffcc4d";
  if (fighter.hp <= 20) ctx.fillStyle = "#ff4d5e";
  ctx.fillRect(x, y, w * (fighter.hp / 100), h);

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

function drawFighter(ctx, fighter) {
  const x = fighter.x;
  const y = fighter.y;
  const facing = fighter.facing || 1;

  ctx.save();
  ctx.translate(x + fighter.w / 2, y);
  ctx.scale(facing, 1);

  const hurt = fighter.hurt;
  const attacking = fighter.attacking;
  const specialing = fighter.specialing;

  ctx.fillStyle = hurt ? "#ffffff" : fighter.colour;
  ctx.fillRect(-18, -58, 36, 48);

  ctx.fillStyle = fighter.accent;
  ctx.fillRect(-13, -78, 26, 22);

  ctx.fillStyle = "#161616";
  ctx.fillRect(4, -72, 5, 5);

  ctx.fillStyle = fighter.colour;
  ctx.fillRect(-24, -46, 10, 28);
  ctx.fillRect(14, -46, 10, 28);

  if (attacking) {
    ctx.fillStyle = "#ffe66d";
    ctx.fillRect(20, -42, 34, 12);
  }

  if (specialing) {
    ctx.fillStyle = "rgba(255, 230, 109, .85)";
    ctx.fillRect(22, -54, 96, 26);
    ctx.fillStyle = "#ffffff";
    ctx.font = "12px monospace";
    ctx.fillText("SPECIAL", 35, -36);
  }

  ctx.fillStyle = "#222";
  ctx.fillRect(-16, -10, 12, 24);
  ctx.fillRect(4, -10, 12, 24);

  if (fighter.blocking) {
    ctx.fillStyle = "rgba(143,199,242,.75)";
    ctx.fillRect(18, -64, 16, 58);
  }

  ctx.restore();

  if (!fighter.alive) {
    ctx.fillStyle = "rgba(0,0,0,.75)";
    ctx.fillRect(x - 12, y - 84, 70, 96);
    ctx.fillStyle = "#ffffff";
    ctx.font = "18px monospace";
    ctx.fillText("KO", x + 4, y - 36);
  }
}

function renderHistory(history) {
  if (!history || history.length === 0) {
    historyList.innerHTML = `<div class="history-item">No plays yet.</div>`;
    return;
  }

  historyList.innerHTML = history
    .map(item => `
      <div class="history-item">
        <div>${escapeHTML(item.time || "")} — ${escapeHTML(item.text || "")}</div>
        ${item.score !== null && item.score !== undefined ? `<div class="history-score">+${item.score}</div>` : ""}
      </div>
    `)
    .join("");
}

function renderLetterCounts(counts) {
  if (!counts) {
    letterCountsDiv.innerHTML = "";
    return;
  }

  const order = [
    "A", "B", "C", "D", "E", "F", "G",
    "H", "I", "J", "K", "L", "M", "N",
    "O", "P", "Q", "R", "S", "T", "U",
    "V", "W", "X", "Y", "Z", "?"
  ];

  letterCountsDiv.innerHTML = order
    .map(letter => {
      const label = letter === "?" ? "Blank" : letter;
      return `
        <div class="letter-count-item">
          <span class="letter-count-letter">${label}</span>
          <span class="letter-count-number">${counts[letter] ?? 0}</span>
        </div>
      `;
    })
    .join("");
}

function renderGameOver(room) {
  if (!room.gameOver || !room.gameOverSummary) {
    gameOverPanel.classList.add("hidden");
    gameOverPanel.innerHTML = "";
    return;
  }

  const summary = room.gameOverSummary;
  const finalScores = summary.finalScores
    .map(item => `<li>${escapeHTML(item.name)}: <strong>${item.score}</strong></li>`)
    .join("");

  const adjustments = summary.adjustments
    .map(item => `<li>${escapeHTML(item)}</li>`)
    .join("");

  gameOverPanel.classList.remove("hidden");
  gameOverPanel.innerHTML = `
    <h3>Game Over</h3>
    <p>${escapeHTML(summary.reason)}</p>
    <p><strong>Winner${summary.winners.length > 1 ? "s" : ""}:</strong> ${summary.winners.map(escapeHTML).join(", ")}</p>
    <h4>Final Scores</h4>
    <ol class="final-score-list">${finalScores}</ol>
    <h4>End-game Adjustments</h4>
    <ul class="adjustment-list">${adjustments}</ul>
  `;
}

function renderBoard(room) {
  boardDiv.innerHTML = "";

  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const square = document.createElement("div");
      square.className = "square";
      square.dataset.row = row;
      square.dataset.col = col;

      const bonus = room.bonusLayout[row][col];

      if (bonus) {
        square.classList.add(`bonus-${bonus}`);
        square.innerHTML = `<span class="bonus-label">${bonusLabel(bonus)}</span>`;
      }

      if (row === 7 && col === 7) {
        square.classList.add("centre");
        square.innerHTML = `<span class="bonus-label">★<br>START</span>`;
      }

      const tile = room.board[row][col];

      if (tile) {
        square.innerHTML = "";
        square.appendChild(createTileElement(tile, false));
      }

      square.addEventListener("dragover", event => {
        event.preventDefault();
        square.classList.add("drag-over");
      });

      square.addEventListener("dragleave", () => {
        square.classList.remove("drag-over");
      });

      square.addEventListener("drop", event => {
        event.preventDefault();
        square.classList.remove("drag-over");

        const tileId = event.dataTransfer.getData("text/plain");
        if (!tileId) return;

        const tile = myRack.find(item => item.id === tileId);
        let blankLetter = "";

        if (tile && tile.isBlank) {
          blankLetter = prompt("Choose a letter for the blank tile:") || "";
          blankLetter = blankLetter.trim().toUpperCase();

          if (!/^[A-Z]$/.test(blankLetter)) {
            alert("Please enter one letter from A to Z.");
            return;
          }
        }

        socket.emit("placeTile", {
          roomCode,
          tileId,
          row,
          col,
          blankLetter
        });

        selectedForExchange.delete(tileId);
      });

      boardDiv.appendChild(square);
    }
  }
}

function renderRack() {
  rackDiv.innerHTML = "";

  myRack.forEach(tile => {
    rackDiv.appendChild(createTileElement(tile, true));
  });

  if (latestRoom) {
    const isMyTurn = latestRoom.currentPlayerId === playerId;
    exchangeBtn.disabled = !latestRoom.started || !isMyTurn || latestRoom.gameOver || selectedForExchange.size === 0;
  }
}

function createTileElement(tile, draggable) {
  const tileDiv = document.createElement("div");
  tileDiv.className = "tile";

  if (tile.pending) {
    tileDiv.classList.add("pending");
  }

  if (tile.isBlank) {
    tileDiv.classList.add("blank");
  }

  if (selectedForExchange.has(tile.id)) {
    tileDiv.classList.add("selected-for-exchange");
  }

  tileDiv.draggable = draggable;
  tileDiv.dataset.tileId = tile.id;
  tileDiv.innerHTML = `
    <span class="letter">${tile.displayLetter}</span>
    <span class="tile-value">${tile.value}</span>
  `;

  if (draggable) {
    tileDiv.addEventListener("click", () => {
      if (selectedForExchange.has(tile.id)) {
        selectedForExchange.delete(tile.id);
      } else {
        selectedForExchange.add(tile.id);
      }

      renderRack();
    });

    tileDiv.addEventListener("dragstart", event => {
      event.dataTransfer.setData("text/plain", tile.id);
    });
  }

  return tileDiv;
}

function bonusLabel(bonus) {
  if (bonus === "TW") return "TRIPLE<br>WORD";
  if (bonus === "DW") return "DOUBLE<br>WORD";
  if (bonus === "TL") return "TRIPLE<br>LETTER";
  if (bonus === "DL") return "DOUBLE<br>LETTER";
  return "";
}

function showMessage(message) {
  messageDiv.textContent = message;
}

function showPopup(message) {
  popup.textContent = message;
  popup.classList.remove("hidden");

  setTimeout(() => {
    popup.classList.add("hidden");
  }, 3200);
}

function launchConfetti() {
  const colours = ["#d84b5f", "#f2b84b", "#3f72d8", "#1e6f5c", "#8fc7f2", "#f5a3ad"];

  for (let i = 0; i < 120; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colours[Math.floor(Math.random() * colours.length)];
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    confettiLayer.appendChild(piece);

    setTimeout(() => piece.remove(), 3200);
  }
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
