const socket = io();

let playerId = null;
let roomCode = null;
let myRack = [];
let latestRoom = null;
let selectedForExchange = new Set();

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

  // Remove exchanged selections that are no longer in the rack.
  const rackIds = new Set(myRack.map(tile => tile.id));
  selectedForExchange = new Set([...selectedForExchange].filter(id => rackIds.has(id)));

  renderRack();
});

socket.on("errorMessage", message => {
  showMessage(message);
});

function renderRoom(room) {
  roomLabel.textContent = room.code;
  tilesLeft.textContent = room.tilesLeft;
  dictionarySize.textContent = Number(room.dictionarySize || 0).toLocaleString();

  renderPlayers(room.players);
  renderBoard(room);
  renderLetterCounts(room.letterCountsNotOnBoard);
  renderGameOver(room);

  const isMyTurn = room.currentPlayerId === playerId;
  const gameStarted = room.started;
  const gameOver = room.gameOver;

  startBtn.disabled = gameStarted;
  submitBtn.disabled = !gameStarted || !isMyTurn || gameOver;
  passBtn.disabled = !gameStarted || !isMyTurn || gameOver;
  recallBtn.disabled = !gameStarted || !isMyTurn || gameOver;
  exchangeBtn.disabled = !gameStarted || !isMyTurn || gameOver || selectedForExchange.size === 0;

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

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
