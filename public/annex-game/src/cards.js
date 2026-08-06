// ============================================================
// ANNEX — cards.js
// Hand generation, wild card logic, card helpers
// ============================================================

import {
  RANKED_HAND_STRENGTHS, EXTRACTION_HAND_STRENGTHS,
  WILD_CARD_CHANCE, MODE,
} from "./constants.js";
import { shuffle } from "./utils.js";

// --------------------------------------------------------
// Card factory
// --------------------------------------------------------

/**
 * Create a single influence card.
 * @param {string} id - unique card id (e.g. "player_0")
 * @param {number} strength - 1-4 (or 0 for decoys)
 * @param {string} owner - "player" or "ai"
 * @param {object} [options]
 * @param {boolean} [options.isWild=false]
 * @param {boolean} [options.isDecoy=false]
 * @returns {object}
 */
export function createCard(id, strength, owner, options = {}) {
  return {
    id,
    strength,
    owner,
    state: "hand",              // "hand" | "played" | "forfeited"
    playedOnTerritory: null,    // territory id when played
    isWild: options.isWild || false,
    isDecoy: options.isDecoy || false,
    revealed: false,            // true if Intercept was used on this card
  };
}

// --------------------------------------------------------
// Hand generation
// --------------------------------------------------------

/**
 * Generate a hand of influence cards for one player.
 *
 * Ranked mode: 5 cards with strengths [4, 3, 2, 1, 1]
 * Extraction mode: 6 cards with strengths [4, 3, 2, 2, 1, 1], plus
 *   a 10% chance of one card becoming a Wild Card.
 *
 * @param {string} owner - "player" or "ai"
 * @param {string} mode - MODE.RANKED or MODE.EXTRACTION
 * @returns {object[]} array of card objects
 */
export function generateHand(owner, mode) {
  const baseStrengths = mode === MODE.EXTRACTION
    ? [...EXTRACTION_HAND_STRENGTHS]
    : [...RANKED_HAND_STRENGTHS];

  const strengths = shuffle(baseStrengths);

  const hand = strengths.map((str, i) =>
    createCard(`${owner}_${i}`, str, owner)
  );

  // Wild card chance (Extraction only)
  if (mode === MODE.EXTRACTION && Math.random() < WILD_CARD_CHANCE) {
    const wildIndex = Math.floor(Math.random() * hand.length);
    hand[wildIndex].isWild = true;
  }

  return hand;
}

// --------------------------------------------------------
// Card state helpers
// --------------------------------------------------------

/**
 * Get all cards still in hand.
 * @param {object[]} hand
 * @returns {object[]}
 */
export function getInHandCards(hand) {
  return hand.filter(c => c.state === "hand");
}

/**
 * Get all cards that have been played (on the board).
 * @param {object[]} hand
 * @returns {object[]}
 */
export function getPlayedCards(hand) {
  return hand.filter(c => c.state === "played");
}

/**
 * Get all cards forfeited (passed without playing).
 * @param {object[]} hand
 * @returns {object[]}
 */
export function getForfeitedCards(hand) {
  return hand.filter(c => c.state === "forfeited");
}

/**
 * Check if a card is playable (in hand, not yet played or forfeited).
 * @param {object} card
 * @returns {boolean}
 */
export function isPlayable(card) {
  return card.state === "hand";
}

/**
 * Check if a card can be split (strength >= 3, in hand, not wild).
 * @param {object} card
 * @returns {boolean}
 */
export function isSplittable(card) {
  return card.state === "hand" && card.strength >= 3 && !card.isDecoy;
}

/**
 * Check if a card can be reinforced (+1 strength, max 5, must be played).
 * @param {object} card
 * @returns {boolean}
 */
export function isReinforceable(card) {
  return card.state === "played" && card.strength < 5 && !card.isDecoy;
}

/**
 * Check if a card can be recalled (played, not a decoy).
 * @param {object} card
 * @returns {boolean}
 */
export function isRecallable(card) {
  return card.state === "played" && !card.isDecoy;
}

// --------------------------------------------------------
// Card play actions
// --------------------------------------------------------

/**
 * Play a card onto a territory. Mutates both the card and the territory.
 * @param {object} card
 * @param {object} territory
 * @returns {boolean} true if successful
 */
export function playCard(card, territory) {
  if (card.state !== "hand") return false;
  card.state = "played";
  card.playedOnTerritory = territory.id;
  territory.cardsPlayed.push(card);
  return true;
}

/**
 * Forfeit all remaining hand cards (when passing).
 * @param {object[]} hand
 */
export function forfeitHand(hand) {
  for (const card of hand) {
    if (card.state === "hand") {
      card.state = "forfeited";
    }
  }
}

/**
 * Recall a played card from the board back to hand.
 * Mutates both the card and the territory.
 * @param {object} card
 * @param {object[]} territories
 * @returns {boolean} true if successful
 */
export function recallCard(card, territories) {
  if (card.state !== "played") return false;
  const territory = territories[card.playedOnTerritory];
  if (!territory) return false;

  // Remove from territory's cardsPlayed
  territory.cardsPlayed = territory.cardsPlayed.filter(c => c.id !== card.id);

  // Return to hand
  card.state = "hand";
  card.playedOnTerritory = null;
  card.revealed = false;
  return true;
}

/**
 * Redirect a played card to an adjacent territory.
 * Reduces strength by 1 (minimum 1). Mutates card and both territories.
 * @param {object} card
 * @param {object[]} territories
 * @param {number} newTerritoryId
 * @returns {boolean} true if successful
 */
export function redirectCard(card, territories, newTerritoryId) {
  if (card.state !== "played") return false;
  const oldTerritory = territories[card.playedOnTerritory];
  const newTerritory = territories[newTerritoryId];
  if (!oldTerritory || !newTerritory) return false;

  // Verify adjacency
  if (!oldTerritory.connections.includes(newTerritoryId)) return false;

  // Remove from old territory
  oldTerritory.cardsPlayed = oldTerritory.cardsPlayed.filter(c => c.id !== card.id);

  // Reduce strength (min 1)
  card.strength = Math.max(1, card.strength - 1);

  // Place on new territory
  card.playedOnTerritory = newTerritoryId;
  card.revealed = false;
  newTerritory.cardsPlayed.push(card);
  return true;
}

/**
 * Reinforce a played card by adding +1 strength (max 5).
 * @param {object} card
 * @returns {boolean} true if successful
 */
export function reinforceCard(card) {
  if (card.state !== "played") return false;
  if (card.strength >= 5) return false;
  if (card.isDecoy) return false;
  card.strength += 1;
  return true;
}

/**
 * Split a hand card into two weaker cards.
 * The original card is removed and two new cards are created.
 * Each new card has floor(originalStrength / 2) strength, minimum 1.
 * @param {object} card - the card to split (must be in hand, strength >= 3)
 * @param {object[]} hand - the player's hand array (mutated)
 * @param {string} owner - "player" or "ai"
 * @returns {{ success: boolean, newCards?: object[] }}
 */
export function splitCard(card, hand, owner) {
  if (card.state !== "hand" || card.strength < 3) {
    return { success: false };
  }

  const halfStrength = Math.max(1, Math.floor(card.strength / 2));

  // Remove original card from hand
  card.state = "forfeited"; // mark as consumed

  // Create two new cards
  const baseId = card.id + "_split";
  const newCard1 = createCard(baseId + "a", halfStrength, owner);
  const newCard2 = createCard(baseId + "b", halfStrength, owner);

  hand.push(newCard1);
  hand.push(newCard2);

  return { success: true, newCards: [newCard1, newCard2] };
}

/**
 * Create a decoy card (strength 0) and add it to the territory.
 * @param {object} territory
 * @param {string} owner - "player" or "ai"
 * @returns {object} the decoy card
 */
export function createDecoy(territory, owner) {
  const decoy = createCard(
    `${owner}_decoy_${Date.now()}`,
    0,
    owner,
    { isDecoy: true }
  );
  decoy.state = "played";
  decoy.playedOnTerritory = territory.id;
  territory.cardsPlayed.push(decoy);
  return decoy;
}

/**
 * Sabotage: remove an opponent's card from a territory and return it to their hand.
 * @param {object} card - the opponent's card on the board
 * @param {object[]} territories
 * @param {object[]} opponentHand - the opponent's hand array
 * @returns {boolean} true if successful
 */
export function sabotageCard(card, territories, opponentHand) {
  if (card.state !== "played") return false;
  const territory = territories[card.playedOnTerritory];
  if (!territory) return false;

  // Remove from territory
  territory.cardsPlayed = territory.cardsPlayed.filter(c => c.id !== card.id);

  // Return to opponent's hand
  card.state = "hand";
  card.playedOnTerritory = null;
  card.revealed = false;
  // Card should already be in opponentHand array since it was dealt there
  // But if it's a decoy created mid-game, we need to add it
  if (!opponentHand.includes(card)) {
    opponentHand.push(card);
  }
  return true;
}

// --------------------------------------------------------
// Card counting / info helpers
// --------------------------------------------------------

/**
 * Count how many cards a player has played on a specific territory.
 * @param {object} territory
 * @param {string} owner - "player" or "ai"
 * @returns {number}
 */
export function countCardsOnTerritory(territory, owner) {
  return territory.cardsPlayed.filter(c => c.owner === owner).length;
}

/**
 * Get the total known strength of cards a player has on a territory.
 * For the owning player, all strengths are known.
 * For the opponent, only revealed cards' strengths are known.
 * @param {object} territory
 * @param {string} owner - whose cards to sum
 * @param {string} viewer - "player" or "ai" (who is looking)
 * @returns {{ total: number, known: boolean }}
 */
export function getVisibleStrength(territory, owner, viewer) {
  const cards = territory.cardsPlayed.filter(c => c.owner === owner);
  if (owner === viewer) {
    // You can see your own cards
    return {
      total: cards.reduce((sum, c) => sum + c.strength, 0),
      known: true,
    };
  }
  // Opponent cards — only revealed ones are visible
  const revealedCards = cards.filter(c => c.revealed);
  return {
    total: revealedCards.reduce((sum, c) => sum + c.strength, 0),
    known: revealedCards.length === cards.length,
  };
}

/**
 * Check if a territory has any cards on it that are hidden from a viewer
 * (accounting for Fog terrain).
 * On a Fog territory, the opponent cannot see that any cards were placed.
 * @param {object} territory
 * @param {string} viewer - "player" or "ai"
 * @returns {object[]} cards visible to the viewer
 */
export function getVisibleCards(territory, viewer) {
  return territory.cardsPlayed.filter(card => {
    // You always see your own cards
    if (card.owner === viewer) return true;
    // On Fog territory, opponent cards are invisible during action phase
    if (territory.terrain === "fog") return false;
    // Otherwise, opponent cards are visible (position known, strength hidden)
    return true;
  });
}

/**
 * Count total hand cards remaining for a player.
 * @param {object[]} hand
 * @returns {number}
 */
export function countHandCards(hand) {
  return hand.filter(c => c.state === "hand").length;
}
