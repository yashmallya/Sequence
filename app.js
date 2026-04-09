import { deserializeState, getLegalMovesForCard } from "./game-engine.js";

const PLAYER_COLOR_CLASSES = ["player1", "player2", "player3", "player4"];
const SEAT_LABELS = ["Blue", "Green", "Red", "Gold"];
const SUIT_SYMBOLS = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣",
};

const app = document.querySelector("#app");

let createForm = {
  playerCount: 2,
  names: ["Host", "Open Seat 2", "Open Seat 3", "Open Seat 4"],
};

let joinForm = {
  seatId: null,
  displayName: "",
};

let session = loadSession();
let roomState = null;
let pollTimer = null;
let selectedHandIndex = null;
let errorMessage = "";

function loadSession() {
  const roomId = new URLSearchParams(window.location.search).get("room");
  if (!roomId) {
    return null;
  }

  const raw = localStorage.getItem(`sequence-room:${roomId}`);
  return raw ? JSON.parse(raw) : { roomId, playerId: null, token: null };
}

function saveSession(nextSession) {
  session = nextSession;
  if (nextSession?.roomId) {
    localStorage.setItem(`sequence-room:${nextSession.roomId}`, JSON.stringify(nextSession));
    const url = new URL(window.location.href);
    url.searchParams.set("room", nextSession.roomId);
    window.history.replaceState({}, "", url);
  }
}

function clearRoomSession() {
  if (session?.roomId) {
    localStorage.removeItem(`sequence-room:${session.roomId}`);
  }
  session = null;
  roomState = null;
  selectedHandIndex = null;
  errorMessage = "";
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url);
}

function currentGame() {
  return roomState?.game ?? null;
}

function currentPlayer() {
  const game = currentGame();
  return game?.players.find((player) => player.player_id === game.currentPlayerId) ?? null;
}

function viewerPlayer() {
  const game = currentGame();
  return game?.players.find((player) => player.player_id === game.viewerPlayerId) ?? null;
}

function parseCard(code) {
  if (code === "CORNER") {
    return null;
  }

  return {
    rank: code.slice(0, -1),
    suit: code.slice(-1),
    symbol: SUIT_SYMBOLS[code.slice(-1)],
    isRed: code.endsWith("H") || code.endsWith("D"),
    isJack: code.startsWith("J"),
  };
}

function renderCardFace(code, chipLabel = "", compact = false, selected = false) {
  if (code === "CORNER") {
    return `
      <div class="playing-card free-space ${selected ? "selected-surface" : ""}">
        <div class="free-mark">FREE</div>
        <div class="free-chip"></div>
      </div>
    `;
  }

  const card = parseCard(code);
  const cardClass = [
    "playing-card",
    card.isRed ? "red" : "black",
    compact ? "compact" : "",
    selected ? "selected-surface" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <div class="${cardClass}">
      <div class="card-corner top">
        <span>${card.rank}</span>
        <span>${card.symbol}</span>
      </div>
      <div class="card-center ${card.isJack ? "face-letter" : "suit"}">${card.isJack ? "J" : card.symbol}</div>
      <div class="card-corner bottom">
        <span>${card.rank}</span>
        <span>${card.symbol}</span>
      </div>
      ${chipLabel ? `<div class="chip-token">${chipLabel}</div>` : ""}
    </div>
  `;
}

function hydratePlayerView(game) {
  return deserializeState({
    ...game,
    currentPlayerIndex: game.players.findIndex((player) => player.player_id === game.currentPlayerId),
    drawDeck: [],
    players: game.players.map((player) => ({
      ...player,
      hand: player.hand ?? [],
      discard_pile: [],
      sequence_memberships: [],
    })),
  });
}

function getLegalMove() {
  const game = currentGame();
  const viewer = viewerPlayer();
  if (!game || !viewer || selectedHandIndex === null) {
    return null;
  }

  try {
    return getLegalMovesForCard(hydratePlayerView(game), viewer.player_id, selectedHandIndex);
  } catch {
    return null;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload;
}

function syncSelectionWithState() {
  if (currentGame() && selectedHandIndex !== null) {
    const viewer = viewerPlayer();
    if (!viewer || selectedHandIndex >= viewer.hand.length) {
      selectedHandIndex = null;
    }
  }
}

function setupPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
  }

  if (!session?.roomId) {
    pollTimer = null;
    return;
  }

  pollTimer = window.setInterval(() => {
    refreshRoom({ silent: true });
  }, 2000);
}

async function refreshRoom(options = {}) {
  if (!session?.roomId) {
    render();
    return;
  }

  try {
    const suffix =
      session.playerId && session.token
        ? `?playerId=${encodeURIComponent(session.playerId)}&token=${encodeURIComponent(session.token)}`
        : "";
    roomState = await fetchJson(`/api/rooms/${session.roomId}${suffix}`);
    syncSelectionWithState();
  } catch (error) {
    if (!options.silent) {
      errorMessage = error.message;
    }
  }

  render();
}

async function createRoom() {
  const payload = await fetchJson("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      playerCount: createForm.playerCount,
      names: createForm.names.slice(0, createForm.playerCount),
    }),
  });

  saveSession(payload.session);
  roomState = payload.room;
  joinForm = { seatId: null, displayName: "" };
  errorMessage = "";
  setupPolling();
  render();
}

async function joinSeat() {
  const payload = await fetchJson(`/api/rooms/${session.roomId}/join`, {
    method: "POST",
    body: JSON.stringify({
      playerId: joinForm.seatId,
      displayName: joinForm.displayName,
    }),
  });

  saveSession(payload.session);
  roomState = payload.room;
  errorMessage = "";
  setupPolling();
  render();
}

async function startRoom() {
  roomState = await fetchJson(`/api/rooms/${session.roomId}/start`, {
    method: "POST",
    body: JSON.stringify({
      playerId: session.playerId,
      token: session.token,
    }),
  });
  errorMessage = "";
  render();
}

async function submitAction(action, extra = {}) {
  roomState = await fetchJson(`/api/rooms/${session.roomId}/action`, {
    method: "POST",
    body: JSON.stringify({
      playerId: session.playerId,
      token: session.token,
      action,
      ...extra,
    }),
  });
  errorMessage = "";
  render();
}

function renderLanding() {
  app.innerHTML = `
    <div class="shell shell-setup">
      <section class="setup-hero">
        <p class="eyebrow">Sequence Online</p>
        <h1>Host a room, share the link, and play live.</h1>
        <p class="setup-copy">This version runs as a room-based multiplayer game. The server owns the board state, and each player joins from their own browser.</p>
      </section>

      <section class="setup-panel">
        <div class="count-picker">
          <span class="label">Players</span>
          <div class="count-options">
            ${[2, 3, 4]
              .map(
                (count) => `
                  <button class="count-option ${createForm.playerCount === count ? "active" : ""}" data-player-count="${count}">
                    ${count} players
                  </button>
                `,
              )
              .join("")}
          </div>
        </div>

        <div class="setup-grid">
          ${Array.from({ length: createForm.playerCount }, (_, index) => `
            <label class="setup-field">
              <span>${SEAT_LABELS[index]} seat</span>
              <div class="name-row">
                <span class="setup-chip ${PLAYER_COLOR_CLASSES[index]}"></span>
                <input type="text" data-name-index="${index}" value="${createForm.names[index]}" maxlength="24" />
              </div>
            </label>
          `).join("")}
        </div>

        ${errorMessage ? `<p class="error">${errorMessage}</p>` : ""}
        <button id="create-room" class="start-game">Create Room</button>
      </section>
    </div>
  `;

  document.querySelectorAll("[data-player-count]").forEach((button) => {
    button.addEventListener("click", () => {
      createForm.playerCount = Number(button.dataset.playerCount);
      render();
    });
  });

  document.querySelectorAll("[data-name-index]").forEach((input) => {
    input.addEventListener("input", () => {
      createForm.names[Number(input.dataset.nameIndex)] = input.value;
    });
  });

  document.querySelector("#create-room").addEventListener("click", async () => {
    try {
      await createRoom();
    } catch (error) {
      errorMessage = error.message;
      render();
    }
  });
}

function renderLobby() {
  const shareLink = `${window.location.origin}${window.location.pathname}?room=${session.roomId}`;
  const amHost = session.playerId === roomState.hostPlayerId;
  const joined = Boolean(session.playerId && session.token);

  app.innerHTML = `
    <div class="shell shell-setup">
      <section class="setup-hero">
        <p class="eyebrow">Room ${roomState.roomId}</p>
        <h1>Share the invite, then start when every seat is filled.</h1>
        <p class="setup-copy">Invite link: <strong>${shareLink}</strong></p>
      </section>

      <section class="setup-panel">
        <div class="lobby-grid">
          ${roomState.seats
            .map(
              (seat, index) => `
                <button class="seat-card ${seat.claimed ? "claimed" : "open"} ${seat.player_id === joinForm.seatId ? "selected-seat" : ""}" data-seat-id="${seat.player_id}" ${seat.claimed || joined ? "disabled" : ""}>
                  <span class="setup-chip ${PLAYER_COLOR_CLASSES[index]}"></span>
                  <strong>${seat.display_name}</strong>
                  <span>${seat.claimed ? "Claimed" : "Open seat"}</span>
                </button>
              `,
            )
            .join("")}
        </div>

        ${
          !joined
            ? `
              <div class="join-box">
                <input type="text" id="join-name" placeholder="Your name" value="${joinForm.displayName}" maxlength="24" />
                <button id="join-room" class="start-game" ${joinForm.seatId ? "" : "disabled"}>Join Selected Seat</button>
              </div>
            `
            : `
              <div class="join-box">
                <button id="copy-link" class="count-option">Copy Invite Link</button>
                ${amHost ? `<button id="start-room" class="start-game" ${roomState.readyToStart ? "" : "disabled"}>Start Game</button>` : `<p class="muted">Waiting for the host to start the game.</p>`}
              </div>
            `
        }

        ${errorMessage ? `<p class="error">${errorMessage}</p>` : ""}
      </section>
    </div>
  `;

  document.querySelectorAll("[data-seat-id]").forEach((button) => {
    button.addEventListener("click", () => {
      joinForm.seatId = button.dataset.seatId;
      render();
    });
  });

  const joinName = document.querySelector("#join-name");
  if (joinName) {
    joinName.addEventListener("input", () => {
      joinForm.displayName = joinName.value;
    });
  }

  const joinButton = document.querySelector("#join-room");
  if (joinButton) {
    joinButton.addEventListener("click", async () => {
      try {
        await joinSeat();
      } catch (error) {
        errorMessage = error.message;
        render();
      }
    });
  }

  const copyButton = document.querySelector("#copy-link");
  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(shareLink);
      copyButton.textContent = "Copied";
    });
  }

  const startButton = document.querySelector("#start-room");
  if (startButton) {
    startButton.addEventListener("click", async () => {
      try {
        await startRoom();
      } catch (error) {
        errorMessage = error.message;
        render();
      }
    });
  }
}

function renderGame() {
  const game = currentGame();
  const viewer = viewerPlayer();
  const turn = currentPlayer();
  const legalMove = getLegalMove();
  const amCurrentPlayer = viewer?.player_id === game.currentPlayerId && !game.winner;

  app.innerHTML = `
    <div class="shell game-shell">
      <section class="topbar">
        <div>
          <p class="eyebrow">Room ${roomState.roomId}</p>
          <h1>Play Sequence live with your room.</h1>
        </div>
        <div class="actions">
          <button id="leave-room">Leave Room</button>
        </div>
      </section>

      <section class="status-strip">
        <div>
          <span class="label">Your seat</span>
          <strong>${viewer?.display_name ?? "Spectator"} · ${viewer?.color ?? "-"}</strong>
        </div>
        <div>
          <span class="label">Current turn</span>
          <strong>${turn?.display_name ?? "Unknown"}</strong>
        </div>
        <div>
          <span class="label">Deck</span>
          <strong>${game.drawDeckCount} cards</strong>
        </div>
        <div>
          <span class="label">Winner</span>
          <strong>${game.winner ? game.players.find((player) => player.player_id === game.winner)?.display_name : "None"}</strong>
        </div>
      </section>

      ${errorMessage ? `<p class="error">${errorMessage}</p>` : ""}

      <main class="workspace">
        <section class="board-panel">
          <div class="table-frame">
            <div class="table-rail top">Shared board state</div>
            <div class="table-middle">
              <div class="table-rail side left">Room play</div>
              <div class="board">
                ${game.board
                  .map(
                    (row, rowIndex) => `
                      <div class="board-row">
                        ${row
                          .map((cell, colIndex) => {
                            const isSelectable = amCurrentPlayer && legalMove?.positions.some(
                              ([targetRow, targetCol]) => targetRow === rowIndex && targetCol === colIndex,
                            );
                            const classes = [
                              "cell",
                              cell.occupied_by ? PLAYER_COLOR_CLASSES[Number(cell.occupied_by.replace("player", "")) - 1] : "",
                              cell.is_sequence_locked ? "locked" : "",
                              isSelectable ? "selectable" : "",
                            ]
                              .filter(Boolean)
                              .join(" ");
                            const chipSeat = cell.occupied_by
                              ? game.players.find((player) => player.player_id === cell.occupied_by)?.display_name.slice(0, 1).toUpperCase()
                              : "";

                            return `
                              <button class="${classes}" data-row="${rowIndex}" data-col="${colIndex}" ${amCurrentPlayer ? "" : "disabled"}>
                                ${renderCardFace(cell.card_id, chipSeat, true)}
                              </button>
                            `;
                          })
                          .join("")}
                      </div>
                    `,
                  )
                  .join("")}
              </div>
              <div class="table-rail side right">${amCurrentPlayer ? "Your move" : "Waiting"}</div>
            </div>
            <div class="table-rail bottom">Invite others with the room link</div>
          </div>
        </section>

        <aside class="sidebar">
          <section class="panel">
            <h2>Your hand</h2>
            <div class="hand">
              ${(viewer?.hand ?? [])
                .map((card, index) => `
                  <button class="hand-card ${selectedHandIndex === index ? "selected" : ""}" data-hand-index="${index}" ${amCurrentPlayer ? "" : "disabled"}>
                    ${renderCardFace(card, "", false, selectedHandIndex === index)}
                    ${selectedHandIndex === index && legalMove?.isDeadCard ? '<span class="badge">Dead</span>' : ""}
                  </button>
                `)
                .join("")}
            </div>
            ${
              amCurrentPlayer && legalMove
                ? `
                  <div class="selection-info">
                    <p><strong>${legalMove.card.code}</strong> · ${legalMove.action}</p>
                    <p>${legalMove.isDeadCard ? "Both matching spaces are blocked. Turn this card in." : `${legalMove.positions.length} legal target(s) available.`}</p>
                    <button id="turn-in-dead" ${legalMove.isDeadCard ? "" : "disabled"}>Turn In Dead Card</button>
                  </div>
                `
                : `<p class="muted">${amCurrentPlayer ? "Select a card, then click a highlighted board space." : "Wait for your turn. The board updates live."}</p>`
            }
          </section>

          <section class="panel">
            <h2>Players</h2>
            ${game.players
              .map(
                (player) => `
                  <div class="player-row">
                    <div>
                      <strong>${player.display_name}</strong>
                      <p>${player.handCount} in hand · ${player.discardCount} discarded</p>
                    </div>
                    <div class="seq-count">${player.sequences_completed} seq</div>
                  </div>
                `,
              )
              .join("")}
          </section>

          <section class="panel">
            <h2>Turn log</h2>
            <div class="log">
              ${game.log
                .slice(-10)
                .reverse()
                .map((entry) => `<p>${entry}</p>`)
                .join("")}
            </div>
          </section>
        </aside>
      </main>
    </div>
  `;

  document.querySelector("#leave-room").addEventListener("click", () => {
    clearRoomSession();
    render();
  });

  document.querySelectorAll("[data-hand-index]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedHandIndex = Number(button.dataset.handIndex);
      errorMessage = "";
      render();
    });
  });

  document.querySelectorAll("[data-row]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!amCurrentPlayer || selectedHandIndex === null) {
        return;
      }

      try {
        await submitAction("play-turn", {
          handIndex: selectedHandIndex,
          row: Number(button.dataset.row),
          col: Number(button.dataset.col),
        });
        selectedHandIndex = null;
      } catch (error) {
        errorMessage = error.message;
        render();
      }
    });
  });

  const deadButton = document.querySelector("#turn-in-dead");
  if (deadButton) {
    deadButton.addEventListener("click", async () => {
      try {
        await submitAction("turn-in-dead", {
          handIndex: selectedHandIndex,
        });
        selectedHandIndex = null;
      } catch (error) {
        errorMessage = error.message;
        render();
      }
    });
  }
}

function render() {
  if (!session?.roomId) {
    renderLanding();
    return;
  }

  if (!roomState) {
    app.innerHTML = `<div class="shell shell-setup"><section class="setup-panel"><p>Loading room...</p></section></div>`;
    return;
  }

  if (!roomState.game) {
    renderLobby();
    return;
  }

  renderGame();
}

setupPolling();
refreshRoom();
