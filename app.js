import {
  createGame,
  deserializeState,
  getLegalMovesForCard,
  playTurn,
  serializeState,
  turnInDeadCard,
} from "./game-engine.js";

const PLAYER_COLOR_CLASSES = ["player1", "player2", "player3", "player4"];
const SEAT_LABELS = ["Blue", "Green", "Red", "Gold"];
const SUIT_SYMBOLS = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣",
};

const app = document.querySelector("#app");

let localForm = {
  playerCount: 2,
  names: ["Player 1", "Player 2", "Player 3", "Player 4"],
};

let createForm = {
  playerCount: 2,
  hostName: "Host",
};

let session = loadSession();
let view = session?.roomId ? "online" : "menu";
let roomState = null;
let pollTimer = null;
let selectedHandIndex = null;
let errorMessage = "";
let localState = null;
let rulesOpen = false;
let joinForm = {
  seatId: null,
  displayName: "",
};

const RULE_SECTIONS = [
  {
    title: "Setup",
    items: [
      "The board is a 10x10 grid. Corners are free spaces for every player.",
      "Jacks do not appear on the board.",
      "For 2 players, deal 7 cards each. For 3 to 4 players, deal 6 cards each.",
      "In online mode, the host starts the room after all seats are claimed.",
    ],
  },
  {
    title: "How a Turn Works",
    items: [
      "Choose one card from your hand.",
      "Place a chip on a matching open board space, then automatically draw a replacement card.",
      "If both matching board spaces are already covered, that card is dead. Turn it in and draw a replacement, then continue your turn.",
    ],
  },
  {
    title: "Jacks",
    items: [
      "Two-eyed Jacks are wild and can place a chip on any open non-corner board space.",
      "One-eyed Jacks remove one opponent chip from the board.",
      "A One-eyed Jack cannot remove a chip that is already locked inside a completed sequence.",
      "Playing a One-eyed Jack ends your turn. You do not place your own chip that turn.",
    ],
  },
  {
    title: "Sequences",
    items: [
      "A sequence is 5 connected chips in a row: horizontal, vertical, or diagonal.",
      "Corners count for everyone, so you only need 4 of your own chips when using a corner in a sequence.",
      "Completed sequences are locked and cannot be broken.",
      "A second sequence may reuse one space from your first sequence.",
    ],
  },
  {
    title: "Winning",
    items: [
      "With 2 players, the first player to complete 2 sequences wins.",
      "With 3 or 4 players, the first player to complete 1 sequence wins in this prototype.",
      "If the draw deck runs out, discard piles are reshuffled into a new draw deck automatically.",
    ],
  },
];

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
  view = "menu";
}

function currentGame() {
  if (localState) {
    return serializeState(localState);
  }
  return roomState?.game ?? null;
}

function currentPlayer() {
  const game = currentGame();
  return game?.players.find((player) => player.player_id === game.currentPlayerId) ?? null;
}

function viewerPlayer() {
  if (localState) {
    const snapshot = serializeState(localState);
    return snapshot.players[snapshot.currentPlayerIndex] ?? null;
  }
  const game = currentGame();
  return game?.players.find((player) => player.player_id === game.viewerPlayerId) ?? null;
}

function isLocalGame() {
  return Boolean(localState);
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

  const center = compact
    ? `
      <div class="card-center compact-center">
        <span class="compact-rank">${card.rank}</span>
        <span class="compact-suit">${card.symbol}</span>
      </div>
    `
    : `<div class="card-center ${card.isJack ? "face-letter" : "suit"}">${card.isJack ? "J" : card.symbol}</div>`;

  return `
    <div class="${cardClass}">
      <div class="card-corner top">
        <span>${card.rank}</span>
        <span>${card.symbol}</span>
      </div>
      ${center}
      <div class="card-corner bottom">
        <span>${card.rank}</span>
        <span>${card.symbol}</span>
      </div>
      ${chipLabel ? `<div class="chip-token">${chipLabel}</div>` : ""}
    </div>
  `;
}

function getFanStyle(index, total, selected) {
  const midpoint = (total - 1) / 2;
  const offset = index - midpoint;
  const rotate = offset * 6;
  const lift = selected ? -18 : -Math.abs(offset) * 2;
  return `--fan-rotate:${rotate}deg; --fan-lift:${lift}px; --fan-order:${index};`;
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
  const viewer = viewerPlayer();
  if (!viewer || selectedHandIndex === null) {
    return null;
  }

  try {
    if (localState) {
      return getLegalMovesForCard(localState, viewer.player_id, selectedHandIndex);
    }
    const game = currentGame();
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
      names: [createForm.hostName],
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

function startLocalGame() {
  localState = createGame({
    players: Array.from({ length: localForm.playerCount }, (_, index) => ({
      player_id: `player${index + 1}`,
      display_name: localForm.names[index].trim() || `Player ${index + 1}`,
    })),
  });
  selectedHandIndex = null;
  errorMessage = "";
}

function leaveLocalGame() {
  localState = null;
  selectedHandIndex = null;
  errorMessage = "";
  view = "menu";
}

function renderHome() {
  app.innerHTML = `
    <div class="shell shell-setup">
      <section class="brand-stage">
        <div class="brand-lockup">
          <div class="brand-medallion">S</div>
          <div class="brand-wordmark">Sequence</div>
        </div>
      </section>

      <section class="setup-hero hero-card">
        <p class="eyebrow">Sequence</p>
        <h1>Play locally on one device or host a room online.</h1>
        <p class="setup-copy">Use local hot-seat mode for quick same-device games. Use online mode when you want an invite link for friends.</p>
      </section>

      <section class="setup-panel home-panel">
        <div class="mode-grid">
          <button class="mode-card" id="choose-local">
            <div class="mode-icon">◉</div>
            <div class="mode-copy">
              <strong>Local Multiplayer</strong>
              <span>2 to 4 players on a single device.</span>
            </div>
            <span class="mode-cta">Start Local Game</span>
          </button>
          <button class="mode-card" id="choose-online">
            <div class="mode-icon">⌘</div>
            <div class="mode-copy">
              <strong>Online Room</strong>
              <span>Create a room and let friends join by link.</span>
            </div>
            <span class="mode-cta">Host Online Room</span>
          </button>
        </div>
      </section>
    </div>
  `;

  document.querySelector("#choose-local").addEventListener("click", () => {
    view = "local-setup";
    render();
  });
  document.querySelector("#choose-online").addEventListener("click", () => {
    view = "online-setup";
    render();
  });
}

function renderLocalSetup() {
  app.innerHTML = `
    <div class="shell shell-setup">
      <section class="brand-stage compact-brand">
        <div class="brand-lockup">
          <div class="brand-medallion">S</div>
          <div class="brand-wordmark">Sequence</div>
        </div>
      </section>

      <section class="setup-hero hero-card">
        <p class="eyebrow">Local Multiplayer</p>
        <h1>Set up a single-device hot-seat game.</h1>
        <p class="setup-copy">All players share one screen. Choose the player count, enter names, and pass the device each turn.</p>
      </section>

      <section class="setup-panel">
        <div class="count-picker">
          <span class="label">Players</span>
          <div class="count-options">
            ${[2, 3, 4]
              .map(
                (count) => `
                  <button class="count-option ${localForm.playerCount === count ? "active" : ""}" data-local-player-count="${count}">
                    ${count} players
                  </button>
                `,
              )
              .join("")}
          </div>
        </div>

        <div class="setup-grid">
          ${Array.from({ length: localForm.playerCount }, (_, index) => `
            <label class="setup-field">
              <span>${SEAT_LABELS[index]} seat</span>
              <div class="name-row">
                <span class="setup-chip ${PLAYER_COLOR_CLASSES[index]}"></span>
                <input type="text" data-local-name-index="${index}" value="${localForm.names[index]}" maxlength="24" />
              </div>
            </label>
          `).join("")}
        </div>

        <div class="join-box">
          <button class="count-option" id="back-home-local">Back</button>
          <button id="start-local" class="start-game">Start Local Game</button>
        </div>
      </section>
    </div>
  `;

  document.querySelectorAll("[data-local-player-count]").forEach((button) => {
    button.addEventListener("click", () => {
      localForm.playerCount = Number(button.dataset.localPlayerCount);
      render();
    });
  });
  document.querySelectorAll("[data-local-name-index]").forEach((input) => {
    input.addEventListener("input", () => {
      localForm.names[Number(input.dataset.localNameIndex)] = input.value;
    });
  });
  document.querySelector("#back-home-local").addEventListener("click", () => {
    view = "menu";
    render();
  });
  document.querySelector("#start-local").addEventListener("click", () => {
    startLocalGame();
    render();
  });
}

function renderOnlineSetup() {
  app.innerHTML = `
    <div class="shell shell-setup">
      <section class="brand-stage compact-brand">
        <div class="brand-lockup">
          <div class="brand-medallion">S</div>
          <div class="brand-wordmark">Sequence</div>
        </div>
      </section>

      <section class="setup-hero hero-card">
        <p class="eyebrow">Sequence Online</p>
        <h1>Host a room, share the link, and play live.</h1>
        <p class="setup-copy">Create a room, choose the seat count, and share the invite. Other players choose their own name when they join.</p>
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
          <label class="setup-field">
            <span>${SEAT_LABELS[0]} seat</span>
            <div class="name-row">
              <span class="setup-chip ${PLAYER_COLOR_CLASSES[0]}"></span>
              <input type="text" id="host-name" value="${createForm.hostName}" maxlength="24" />
            </div>
          </label>
        </div>

        ${errorMessage ? `<p class="error">${errorMessage}</p>` : ""}
        <div class="join-box">
          <button class="count-option" id="back-home-online">Back</button>
          <button id="create-room" class="start-game">Create Room</button>
        </div>
      </section>
    </div>
  `;

  document.querySelectorAll("[data-player-count]").forEach((button) => {
    button.addEventListener("click", () => {
      createForm.playerCount = Number(button.dataset.playerCount);
      render();
    });
  });

  document.querySelector("#host-name").addEventListener("input", (event) => {
    createForm.hostName = event.target.value;
  });

  document.querySelector("#back-home-online").addEventListener("click", () => {
    view = "menu";
    render();
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
      <section class="brand-stage compact-brand">
        <div class="brand-lockup">
          <div class="brand-medallion">S</div>
          <div class="brand-wordmark">Sequence</div>
        </div>
      </section>

      <section class="setup-hero hero-card">
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
  const roomOrLocalLabel = isLocalGame() ? "Local Game" : `Room ${roomState.roomId}`;
  const winnerName = game.winner ? game.players.find((player) => player.player_id === game.winner)?.display_name : null;

  app.innerHTML = `
    <div class="shell game-shell tabletop-shell">
      <section class="game-hud">
        <button id="open-rules" class="hud-round" aria-label="Open rules">?</button>
        <div class="turn-banner">
          <div class="turn-seat">
            <span class="seat-token ${viewer ? PLAYER_COLOR_CLASSES[Number(viewer.player_id.replace("player", "")) - 1] : ""}"></span>
            <span>${viewer?.display_name ?? "Spectator"}</span>
          </div>
          <div class="turn-main">${winnerName ? `${winnerName} wins` : amCurrentPlayer ? "Your Turn" : `${turn?.display_name ?? "Unknown"} Turn`}</div>
          <div class="turn-badge">${viewer?.sequences_completed ?? 0}</div>
        </div>
        <div class="hud-brand">Sequence</div>
        <div class="hud-actions">
          <button id="leave-room" class="hud-round" aria-label="${isLocalGame() ? "Exit local game" : "Leave room"}">${isLocalGame() ? "×" : "↗"}</button>
        </div>
      </section>

      ${errorMessage ? `<p class="error">${errorMessage}</p>` : ""}

      <main class="tabletop-stage">
        <section class="board-zone">
          <div class="table-frame">
            <div class="table-rail top">Sequence</div>
            <div class="table-middle">
              <div class="table-rail side left">${isLocalGame() ? "Local Multiplayer" : roomOrLocalLabel}</div>
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
                            const isDimmed = amCurrentPlayer && legalMove && !isSelectable;
                            const classes = [
                              "cell",
                              cell.occupied_by ? PLAYER_COLOR_CLASSES[Number(cell.occupied_by.replace("player", "")) - 1] : "",
                              cell.is_sequence_locked ? "locked" : "",
                              isSelectable ? "selectable" : "",
                              isDimmed ? "dimmed" : "",
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
              <div class="table-rail side right">${amCurrentPlayer ? "Your Move" : "Stand By"}</div>
            </div>
            <div class="table-rail bottom">${isLocalGame() ? "Pass the device after each turn" : "Share the room link to join"}</div>
          </div>
          <aside class="table-side-piles">
            <div class="pile-stack deck-stack">
              <div class="stack-card back-card"></div>
              <div class="stack-card back-card offset-one"></div>
              <div class="stack-card back-card offset-two"></div>
              <p>Deck</p>
              <strong>${game.drawDeckCount}</strong>
            </div>
            <div class="pile-stack note-stack">
              <p>Latest Moves</p>
              <div class="mini-log">
                ${game.log
                  .slice(-3)
                  .reverse()
                  .map((entry) => `<span>${entry}</span>`)
                  .join("")}
              </div>
            </div>
          </aside>
        </section>

        <section class="bottom-dock">
          <div class="tray player-tray">
            <span class="tray-label">${isLocalGame() ? "Table Players" : "Room Players"}</span>
            <div class="player-stack">
              ${game.players
                .map(
                  (player) => `
                    <div class="player-chip-row">
                      <span class="seat-token ${PLAYER_COLOR_CLASSES[Number(player.player_id.replace("player", "")) - 1]}"></span>
                      <div class="player-chip-copy">
                        <strong>${player.display_name}</strong>
                        <span>${player.handCount ?? player.hand.length} in hand · ${player.sequences_completed} seq</span>
                      </div>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </div>

          <div class="tray hand-tray">
            <div class="hand-banner">${amCurrentPlayer ? "Choose a card" : "Current hand"}</div>
            <div class="hand-fan">
              ${(viewer?.hand ?? [])
                .map((card, index, cards) => `
                  <button
                    class="hand-card fan-card ${selectedHandIndex === index ? "selected" : ""}"
                    data-hand-index="${index}"
                    style="${getFanStyle(index, cards.length, selectedHandIndex === index)}"
                    ${amCurrentPlayer ? "" : "disabled"}
                  >
                    ${renderCardFace(card, "", false, selectedHandIndex === index)}
                    ${selectedHandIndex === index && legalMove?.isDeadCard ? '<span class="badge">Dead</span>' : ""}
                  </button>
                `)
                .join("")}
            </div>
            ${
              amCurrentPlayer && legalMove
                ? `
                  <div class="selection-info compact-selection">
                    <p><strong>${legalMove.card.code}</strong> · ${legalMove.action}</p>
                    <p>${legalMove.isDeadCard ? "Both matching spaces are blocked. Turn this card in." : `${legalMove.positions.length} legal target(s) available.`}</p>
                    <button id="turn-in-dead" ${legalMove.isDeadCard ? "" : "disabled"}>Turn In Dead Card</button>
                  </div>
                `
                : `<p class="muted hand-note">${amCurrentPlayer ? "Select a card, then click a highlighted board space." : "Wait for your turn. The board updates live."}</p>`
            }
          </div>

          <div class="tray info-tray">
            <span class="tray-label">Table Notes</span>
            <div class="info-metrics">
              <div><span>Mode</span><strong>${roomOrLocalLabel}</strong></div>
              <div><span>Turn</span><strong>${turn?.display_name ?? "Unknown"}</strong></div>
              <div><span>Winner</span><strong>${winnerName ?? "None"}</strong></div>
            </div>
            <div class="discard-preview">
              <div class="spread-card">${renderCardFace("QS", "", true)}</div>
              <div class="spread-card">${renderCardFace("7H", "", true)}</div>
              <div class="spread-card">${renderCardFace("10C", "", true)}</div>
            </div>
          </div>
        </section>
      </main>

      ${
        rulesOpen
          ? `
            <div class="rules-overlay" id="rules-overlay">
              <section class="rules-book" role="dialog" aria-modal="true" aria-labelledby="rules-title">
                <div class="rules-head">
                  <div>
                    <p class="eyebrow">Sequence Rules</p>
                    <h2 id="rules-title">How to play and how to win.</h2>
                  </div>
                  <button id="close-rules" class="icon-button close-button" aria-label="Close rules">×</button>
                </div>
                <div class="rules-body">
                  ${RULE_SECTIONS.map(
                    (section) => `
                      <section class="rules-section">
                        <h3>${section.title}</h3>
                        <ul>
                          ${section.items.map((item) => `<li>${item}</li>`).join("")}
                        </ul>
                      </section>
                    `,
                  ).join("")}
                </div>
              </section>
            </div>
          `
          : ""
      }
    </div>
  `;

  document.querySelector("#open-rules").addEventListener("click", () => {
    rulesOpen = true;
    render();
  });

  document.querySelector("#leave-room").addEventListener("click", () => {
    if (isLocalGame()) {
      leaveLocalGame();
    } else {
      clearRoomSession();
    }
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
        if (isLocalGame()) {
          playTurn(
            localState,
            viewer.player_id,
            selectedHandIndex,
            Number(button.dataset.row),
            Number(button.dataset.col),
          );
        } else {
          await submitAction("play-turn", {
            handIndex: selectedHandIndex,
            row: Number(button.dataset.row),
            col: Number(button.dataset.col),
          });
        }
        selectedHandIndex = null;
        errorMessage = "";
        render();
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
        if (isLocalGame()) {
          turnInDeadCard(localState, viewer.player_id, selectedHandIndex);
        } else {
          await submitAction("turn-in-dead", {
            handIndex: selectedHandIndex,
          });
        }
        selectedHandIndex = null;
        errorMessage = "";
        render();
      } catch (error) {
        errorMessage = error.message;
        render();
      }
    });
  }

  const closeRulesButton = document.querySelector("#close-rules");
  if (closeRulesButton) {
    closeRulesButton.addEventListener("click", () => {
      rulesOpen = false;
      render();
    });
  }

  const rulesOverlay = document.querySelector("#rules-overlay");
  if (rulesOverlay) {
    rulesOverlay.addEventListener("click", (event) => {
      if (event.target === rulesOverlay) {
        rulesOpen = false;
        render();
      }
    });
  }
}

function render() {
  if (localState) {
    renderGame();
    return;
  }

  if (!session?.roomId) {
    if (view === "local-setup") {
      renderLocalSetup();
      return;
    }
    if (view === "online-setup") {
      renderOnlineSetup();
      return;
    }
    renderHome();
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
