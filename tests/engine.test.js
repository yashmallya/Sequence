import test from "node:test";
import assert from "node:assert/strict";

import {
  createGame,
  playTurn,
  serializeState,
  turnInDeadCard,
} from "../game-engine.js";

function clearBoard(state) {
  for (const row of state.board) {
    for (const cell of row) {
      if (!cell.is_corner) {
        cell.occupied_by = null;
        cell.is_sequence_locked = false;
        cell.sequence_ids = [];
      }
    }
  }
}

function setHand(state, playerId, codes) {
  const player = state.players.find((entry) => entry.player_id === playerId);
  player.hand = codes.map((code) => ({ code, rank: code.slice(0, -1), suit: code.slice(-1) }));
}

function placeChip(state, row, col, playerId, locked = false) {
  const cell = state.board[row][col];
  cell.occupied_by = playerId;
  cell.is_sequence_locked = locked;
  cell.sequence_ids = locked ? [`${playerId}-existing`] : [];
}

test("new game deals 7 cards each and tracks draw deck", () => {
  const state = createGame({ seed: 3 });
  const snapshot = serializeState(state);

  assert.equal(snapshot.players[0].hand.length, 7);
  assert.equal(snapshot.players[1].hand.length, 7);
  assert.equal(snapshot.drawDeckCount, 90);
});

test("three-player game deals 6 cards and needs one sequence", () => {
  const state = createGame({
    seed: 5,
    players: [
      { player_id: "player1", display_name: "Ava" },
      { player_id: "player2", display_name: "Ben" },
      { player_id: "player3", display_name: "Cara" },
    ],
  });
  const snapshot = serializeState(state);

  assert.equal(snapshot.players[0].hand.length, 6);
  assert.equal(snapshot.players[1].hand.length, 6);
  assert.equal(snapshot.players[2].hand.length, 6);
  assert.equal(snapshot.drawDeckCount, 86);
  assert.equal(snapshot.winningSequences, 1);
});

test("standard play places a chip and draws replacement", () => {
  const state = createGame({ seed: 11 });
  clearBoard(state);
  const target = state.board.flat().find((cell) => !cell.is_corner);
  setHand(state, "player1", [target.card_id]);

  const beforeDeck = state.drawDeck.length;
  playTurn(state, "player1", 0, target.row, target.col);

  assert.equal(target.occupied_by, "player1");
  assert.equal(state.players[0].hand.length, 1);
  assert.equal(state.drawDeck.length, beforeDeck - 1);
  assert.equal(state.currentPlayerIndex, 1);
});

test("one-eyed jack cannot remove locked sequence chips", () => {
  const state = createGame({ seed: 14 });
  clearBoard(state);
  setHand(state, "player1", ["JS"]);
  placeChip(state, 2, 2, "player2", true);

  assert.throws(() => playTurn(state, "player1", 0, 2, 2), /unlocked opponent chip/);
});

test("dead card can be turned in without ending the turn", () => {
  const state = createGame({ seed: 17 });
  clearBoard(state);
  const duplicated = state.board.flat().find((cell) => !cell.is_corner).card_id;
  const positions = state.cardPositions.get(duplicated);
  for (const [row, col] of positions) {
    placeChip(state, row, col, "player2");
  }

  setHand(state, "player1", [duplicated]);
  const beforeDeck = state.drawDeck.length;
  turnInDeadCard(state, "player1", 0);

  assert.equal(state.players[0].hand.length, 1);
  assert.equal(state.drawDeck.length, beforeDeck - 1);
  assert.equal(state.currentPlayerIndex, 0);
});

test("completing two sequences wins the game", () => {
  const state = createGame({ seed: 21 });
  clearBoard(state);
  setHand(state, "player1", ["JC"]);

  placeChip(state, 4, 0, "player1");
  placeChip(state, 4, 1, "player1");
  placeChip(state, 4, 2, "player1");
  placeChip(state, 4, 3, "player1");
  placeChip(state, 0, 4, "player1");
  placeChip(state, 1, 4, "player1");
  placeChip(state, 2, 4, "player1");
  placeChip(state, 3, 4, "player1");

  playTurn(state, "player1", 0, 4, 4);

  assert.equal(state.players[0].sequences_completed, 2);
  assert.equal(state.winner, "player1");
  assert.equal(state.board[4][4].is_sequence_locked, true);
});
