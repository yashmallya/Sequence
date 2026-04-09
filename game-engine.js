const BOARD_SIZE = 10;
const PLAYER_COLORS = ["blue", "green", "red", "gold"];
const SUITS = ["S", "H", "D", "C"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "Q", "K", "A"];
const TWO_EYED_JACKS = new Set(["JC", "JD"]);
const ONE_EYED_JACKS = new Set(["JH", "JS"]);
const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

function createMulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneCard(card) {
  return { ...card };
}

export function createCard(code) {
  return {
    code,
    rank: code.slice(0, -1),
    suit: code.slice(-1),
  };
}

function isCorner(row, col) {
  return (
    (row === 0 && col === 0) ||
    (row === 0 && col === BOARD_SIZE - 1) ||
    (row === BOARD_SIZE - 1 && col === 0) ||
    (row === BOARD_SIZE - 1 && col === BOARD_SIZE - 1)
  );
}

function inBounds(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function coordsKey(row, col) {
  return `${row},${col}`;
}

function shuffle(items, random) {
  const clone = items.slice();
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
}

function buildBoardCodes() {
  const cardCodes = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const code = `${rank}${suit}`;
      cardCodes.push(code, code);
    }
  }

  return cardCodes;
}

function createBoard(random) {
  const codes = shuffle(buildBoardCodes(), random);
  const board = [];
  let cursor = 0;

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const currentRow = [];
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (isCorner(row, col)) {
        currentRow.push({
          row,
          col,
          card_id: "CORNER",
          occupied_by: null,
          is_sequence_locked: true,
          sequence_ids: [],
          is_corner: true,
        });
        continue;
      }

      currentRow.push({
        row,
        col,
        card_id: codes[cursor],
        occupied_by: null,
        is_sequence_locked: false,
        sequence_ids: [],
        is_corner: false,
      });
      cursor += 1;
    }
    board.push(currentRow);
  }

  return board;
}

function createDeck(random) {
  const cards = [];
  for (let copy = 0; copy < 2; copy += 1) {
    for (const suit of SUITS) {
      for (const rank of [...RANKS, "J"]) {
        cards.push(createCard(`${rank}${suit}`));
      }
    }
  }

  return shuffle(cards, random);
}

function getHandSize(playerCount) {
  return playerCount === 2 ? 7 : 6;
}

function getWinningSequences(playerCount) {
  return playerCount === 2 ? 2 : 1;
}

function createPlayers(configuredPlayers) {
  return configuredPlayers.map((player, index) => ({
    player_id: player.player_id,
    display_name: player.display_name,
    color: PLAYER_COLORS[index],
    hand: [],
    discard_pile: [],
    sequences_completed: 0,
  }));
}

function findPlayer(state, playerId) {
  const player = state.players.find((entry) => entry.player_id === playerId);
  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }
  return player;
}

function getCurrentPlayer(state) {
  return state.players[state.currentPlayerIndex];
}

function getOpponentIds(state, playerId) {
  return state.players
    .filter((player) => player.player_id !== playerId)
    .map((player) => player.player_id);
}

function drawOne(state) {
  if (state.drawDeck.length === 0) {
    const discardPool = state.players.flatMap((player) => player.discard_pile.map(cloneCard));
    if (discardPool.length === 0) {
      return null;
    }

    const shuffled = shuffle(discardPool, state.random);
    state.drawDeck = shuffled;
    for (const player of state.players) {
      player.discard_pile = [];
    }
    state.log.push("Draw deck depleted. Reshuffled all discard piles into a new draw deck.");
  }

  return state.drawDeck.pop() ?? null;
}

function dealOpeningHands(state) {
  for (let round = 0; round < state.handSize; round += 1) {
    for (const player of state.players) {
      const next = drawOne(state);
      if (next) {
        player.hand.push(next);
      }
    }
  }
}

function buildCardPositionIndex(board) {
  const positions = new Map();
  for (const row of board) {
    for (const cell of row) {
      if (cell.is_corner) {
        continue;
      }
      const bucket = positions.get(cell.card_id) ?? [];
      bucket.push([cell.row, cell.col]);
      positions.set(cell.card_id, bucket);
    }
  }
  return positions;
}

function availablePositionsForCard(state, cardCode) {
  if (TWO_EYED_JACKS.has(cardCode)) {
    return state.board
      .flatMap((row) => row)
      .filter((cell) => !cell.is_corner && cell.occupied_by === null)
      .map((cell) => [cell.row, cell.col]);
  }

  if (ONE_EYED_JACKS.has(cardCode)) {
    const opponentIds = new Set(getOpponentIds(state, getCurrentPlayer(state).player_id));
    return state.board
      .flatMap((row) => row)
      .filter(
        (cell) =>
          !cell.is_corner &&
          opponentIds.has(cell.occupied_by) &&
          !cell.is_sequence_locked,
      )
      .map((cell) => [cell.row, cell.col]);
  }

  return (state.cardPositions.get(cardCode) ?? []).filter(([row, col]) => {
    const cell = state.board[row][col];
    return cell.occupied_by === null;
  });
}

function isDeadCard(state, cardCode) {
  if (TWO_EYED_JACKS.has(cardCode) || ONE_EYED_JACKS.has(cardCode)) {
    return false;
  }
  return availablePositionsForCard(state, cardCode).length === 0;
}

function getWindow(state, startRow, startCol, deltaRow, deltaCol) {
  const cells = [];
  for (let step = 0; step < 5; step += 1) {
    const row = startRow + step * deltaRow;
    const col = startCol + step * deltaCol;
    if (!inBounds(row, col)) {
      return null;
    }
    cells.push(state.board[row][col]);
  }
  return cells;
}

function cellMatchesPlayer(cell, playerId) {
  return cell.is_corner || cell.occupied_by === playerId;
}

function detectCandidateSequences(state, row, col, playerId) {
  const player = findPlayer(state, playerId);
  const existingSignatures = new Set(player.sequence_memberships ?? []);
  const candidates = [];

  for (const [deltaRow, deltaCol] of DIRECTIONS) {
    for (let offset = -4; offset <= 0; offset += 1) {
      const startRow = row + offset * deltaRow;
      const startCol = col + offset * deltaCol;
      const window = getWindow(state, startRow, startCol, deltaRow, deltaCol);
      if (!window) {
        continue;
      }
      if (!window.every((cell) => cellMatchesPlayer(cell, playerId))) {
        continue;
      }

      const nonCorners = window.filter((cell) => !cell.is_corner);
      const overlap = nonCorners.filter((cell) => cell.sequence_ids.some((id) => id.startsWith(playerId))).length;
      if (overlap > 1) {
        continue;
      }

      const signature = nonCorners.map((cell) => coordsKey(cell.row, cell.col)).sort().join("|");
      if (existingSignatures.has(signature)) {
        continue;
      }

      candidates.push({
        cells: window,
        signature,
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!seen.has(candidate.signature)) {
      seen.add(candidate.signature);
      deduped.push(candidate);
    }
  }

  return deduped;
}

function selectBestSequenceSet(candidates) {
  let best = [];

  function backtrack(index, chosen) {
    if (index === candidates.length) {
      if (chosen.length > best.length) {
        best = chosen.slice();
      }
      return;
    }

    backtrack(index + 1, chosen);

    const next = candidates[index];
    const isCompatible = chosen.every((existing) => {
      const existingKeys = new Set(
        existing.cells.filter((cell) => !cell.is_corner).map((cell) => coordsKey(cell.row, cell.col)),
      );
      let overlap = 0;
      for (const cell of next.cells) {
        if (cell.is_corner) {
          continue;
        }
        if (existingKeys.has(coordsKey(cell.row, cell.col))) {
          overlap += 1;
        }
      }
      return overlap <= 1;
    });

    if (isCompatible) {
      chosen.push(next);
      backtrack(index + 1, chosen);
      chosen.pop();
    }
  }

  backtrack(0, []);
  return best;
}

function applyCompletedSequences(state, playerId, sequences) {
  const player = findPlayer(state, playerId);
  if (!player.sequence_memberships) {
    player.sequence_memberships = [];
  }

  for (const sequence of sequences) {
    const sequenceId = `${playerId}-seq-${state.sequenceCounter}`;
    state.sequenceCounter += 1;
    player.sequences_completed += 1;
    player.sequence_memberships.push(sequence.signature);

    for (const cell of sequence.cells) {
      if (cell.is_corner) {
        continue;
      }
      cell.is_sequence_locked = true;
      cell.sequence_ids.push(sequenceId);
    }
  }

  if (sequences.length > 0) {
    state.log.push(`${player.display_name} completed ${sequences.length} sequence${sequences.length > 1 ? "s" : ""}.`);
  }
}

function finalizeTurn(state) {
  const active = getCurrentPlayer(state);
  const drawn = drawOne(state);
  if (drawn) {
    active.hand.push(drawn);
  }

  if (active.sequences_completed >= state.winningSequences) {
    state.winner = active.player_id;
    state.log.push(`${active.display_name} wins with ${active.sequences_completed} completed sequence${active.sequences_completed > 1 ? "s" : ""}.`);
    return;
  }

  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
}

function removeCardFromHand(player, handIndex) {
  if (handIndex < 0 || handIndex >= player.hand.length) {
    throw new Error("Invalid hand selection.");
  }
  return player.hand.splice(handIndex, 1)[0];
}

function assertPlayersTurn(state, playerId) {
  if (state.winner) {
    throw new Error("Game is already complete.");
  }
  if (getCurrentPlayer(state).player_id !== playerId) {
    throw new Error("It is not this player's turn.");
  }
}

export function createGame(options = {}) {
  const configuredPlayers =
    options.players && options.players.length >= 2
      ? options.players
      : [
          { player_id: "player1", display_name: "Player 1" },
          { player_id: "player2", display_name: "Player 2" },
        ];
  const random = createMulberry32(options.seed ?? Date.now());
  const state = {
    board: createBoard(random),
    players: createPlayers(configuredPlayers),
    currentPlayerIndex: 0,
    drawDeck: createDeck(random),
    winner: null,
    sequenceCounter: 1,
    log: ["Game created."],
    random,
    handSize: getHandSize(configuredPlayers.length),
    winningSequences: getWinningSequences(configuredPlayers.length),
  };

  state.cardPositions = buildCardPositionIndex(state.board);
  dealOpeningHands(state);
  state.log.push(`Opening hands dealt. ${state.players[0].display_name} starts.`);

  return state;
}

export function getLegalMovesForCard(state, playerId, handIndex) {
  assertPlayersTurn(state, playerId);
  const player = findPlayer(state, playerId);
  const card = player.hand[handIndex];
  if (!card) {
    throw new Error("Invalid hand selection.");
  }

  const positions = availablePositionsForCard(state, card.code);
  return {
    card,
    positions,
    isDeadCard: isDeadCard(state, card.code),
    action:
      TWO_EYED_JACKS.has(card.code)
        ? "place-anywhere"
        : ONE_EYED_JACKS.has(card.code)
          ? "remove-opponent"
          : "match-card",
  };
}

export function playTurn(state, playerId, handIndex, row, col) {
  assertPlayersTurn(state, playerId);
  const player = findPlayer(state, playerId);
  const card = removeCardFromHand(player, handIndex);
  const cell = state.board[row]?.[col];

  if (!cell) {
    player.hand.splice(handIndex, 0, card);
    throw new Error("Selected board space is out of bounds.");
  }

  if (TWO_EYED_JACKS.has(card.code)) {
    if (cell.is_corner || cell.occupied_by !== null) {
      player.hand.splice(handIndex, 0, card);
      throw new Error("Two-eyed Jack must target an open non-corner space.");
    }
    cell.occupied_by = playerId;
    player.discard_pile.push(card);
    state.log.push(`${player.display_name} played ${card.code} and claimed ${row + 1},${col + 1}.`);
    const completed = selectBestSequenceSet(detectCandidateSequences(state, row, col, playerId));
    applyCompletedSequences(state, playerId, completed);
    finalizeTurn(state);
    return state;
  }

  if (ONE_EYED_JACKS.has(card.code)) {
    const opponentIds = new Set(getOpponentIds(state, playerId));
    if (
      cell.is_corner ||
      !opponentIds.has(cell.occupied_by) ||
      cell.is_sequence_locked
    ) {
      player.hand.splice(handIndex, 0, card);
      throw new Error("One-eyed Jack must remove an unlocked opponent chip.");
    }
    const removedPlayer = findPlayer(state, cell.occupied_by);
    cell.occupied_by = null;
    cell.is_sequence_locked = false;
    cell.sequence_ids = [];
    player.discard_pile.push(card);
    state.log.push(`${player.display_name} played ${card.code} and removed ${removedPlayer.display_name} from ${row + 1},${col + 1}.`);
    finalizeTurn(state);
    return state;
  }

  if (cell.is_corner || cell.card_id !== card.code || cell.occupied_by !== null) {
    player.hand.splice(handIndex, 0, card);
    throw new Error("Selected card must match an open board space.");
  }

  cell.occupied_by = playerId;
  player.discard_pile.push(card);
  state.log.push(`${player.display_name} played ${card.code} on ${row + 1},${col + 1}.`);
  const completed = selectBestSequenceSet(detectCandidateSequences(state, row, col, playerId));
  applyCompletedSequences(state, playerId, completed);
  finalizeTurn(state);
  return state;
}

export function turnInDeadCard(state, playerId, handIndex) {
  assertPlayersTurn(state, playerId);
  const player = findPlayer(state, playerId);
  const card = player.hand[handIndex];
  if (!card) {
    throw new Error("Invalid hand selection.");
  }
  if (!isDeadCard(state, card.code)) {
    throw new Error("Selected card is not dead.");
  }

  const discarded = removeCardFromHand(player, handIndex);
  player.discard_pile.push(discarded);
  const replacement = drawOne(state);
  if (replacement) {
    player.hand.push(replacement);
  }
  state.log.push(`${player.display_name} turned in dead card ${discarded.code} and drew a replacement.`);
  return state;
}

export function getBoardSummaryCell(cell) {
  if (cell.is_corner) {
    return "★";
  }
  if (cell.occupied_by === "player1") {
    return "B";
  }
  if (cell.occupied_by === "player2") {
    return "G";
  }
  return cell.card_id;
}

export function serializeState(state) {
  return {
    board: state.board.map((row) =>
      row.map((cell) => ({
        card_id: cell.card_id,
        occupied_by: cell.occupied_by,
        is_sequence_locked: cell.is_sequence_locked,
        is_corner: cell.is_corner,
        sequence_ids: cell.sequence_ids.slice(),
      })),
    ),
    players: state.players.map((player) => ({
      player_id: player.player_id,
      display_name: player.display_name,
      color: player.color,
      hand: player.hand.map((card) => card.code),
      discard_pile: player.discard_pile.map((card) => card.code),
      sequences_completed: player.sequences_completed,
      sequence_memberships: (player.sequence_memberships ?? []).slice(),
    })),
    currentPlayerIndex: state.currentPlayerIndex,
    currentPlayerId: state.players[state.currentPlayerIndex]?.player_id ?? null,
    drawDeckCount: state.drawDeck.length,
    drawDeck: state.drawDeck.map((card) => card.code),
    winner: state.winner,
    handSize: state.handSize,
    winningSequences: state.winningSequences,
    sequenceCounter: state.sequenceCounter,
    log: state.log.slice(),
  };
}

export function deserializeState(snapshot) {
  const board = snapshot.board.map((row, rowIndex) =>
    row.map((cell, colIndex) => ({
      row: rowIndex,
      col: colIndex,
      card_id: cell.card_id,
      occupied_by: cell.occupied_by,
      is_sequence_locked: cell.is_sequence_locked,
      sequence_ids: cell.sequence_ids ? cell.sequence_ids.slice() : [],
      is_corner: cell.is_corner,
    })),
  );

  const state = {
    board,
    players: snapshot.players.map((player) => ({
      player_id: player.player_id,
      display_name: player.display_name,
      color: player.color,
      hand: (player.hand ?? []).map(createCard),
      discard_pile: (player.discard_pile ?? []).map(createCard),
      sequences_completed: player.sequences_completed,
      sequence_memberships: (player.sequence_memberships ?? []).slice(),
    })),
    currentPlayerIndex: snapshot.currentPlayerIndex ?? 0,
    drawDeck: (snapshot.drawDeck ?? []).map(createCard),
    winner: snapshot.winner ?? null,
    handSize: snapshot.handSize,
    winningSequences: snapshot.winningSequences,
    sequenceCounter: snapshot.sequenceCounter ?? 1,
    log: snapshot.log.slice(),
    random: Math.random,
  };

  state.cardPositions = buildCardPositionIndex(board);
  return state;
}

export function createPlayerView(state, viewerPlayerId = null) {
  const snapshot = serializeState(state);
  const {
    drawDeck,
    ...publicSnapshot
  } = snapshot;

  return {
    ...publicSnapshot,
    viewerPlayerId,
    players: snapshot.players.map((player) => ({
      player_id: player.player_id,
      display_name: player.display_name,
      color: player.color,
      handCount: player.hand.length,
      discardCount: player.discard_pile.length,
      sequences_completed: player.sequences_completed,
      hand: player.player_id === viewerPlayerId ? player.hand.slice() : [],
      discard_pile: [],
      isCurrentTurn: player.player_id === snapshot.currentPlayerId,
    })),
  };
}
