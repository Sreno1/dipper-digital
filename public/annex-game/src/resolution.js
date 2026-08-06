// ============================================================
// ANNEX — resolution.js
// Territory resolution, network scoring, final score calculation,
// provisional network preview for action phase
// ============================================================

import { TERRAIN, getNetworkBonus } from "./constants.js";

// --------------------------------------------------------
// Territory resolution
// --------------------------------------------------------

/**
 * Resolve a single territory: calculate influence totals for both
 * players and determine the owner.
 *
 * Influence sources:
 *   - Claim flag: +2 base influence to the claimer
 *   - High Ground terrain: +1 to the claimer (defender bonus)
 *   - Entrench ability: +entrenchBonus to the claimer
 *   - Played cards: each card's strength value
 *
 * Tiebreaker: claimer wins ties. If no claimer and tied, territory is neutral.
 *
 * @param {object} territory - territory object (mutated in place)
 * @returns {{ pInf: number, aInf: number, owner: string|null, annexed: boolean, effectiveValue: number }}
 */
export function resolveTerritory(territory) {
  let pInf = 0;
  let aInf = 0;

  // Base claim influence (+2)
  if (territory.claimedBy === "player") pInf += 2;
  if (territory.claimedBy === "ai") aInf += 2;

  // High Ground terrain bonus (+1 to claimer)
  if (territory.terrain === TERRAIN.HIGH_GROUND && territory.claimedBy) {
    if (territory.claimedBy === "player") pInf += 1;
    else aInf += 1;
  }

  // Entrench ability bonus (+2 to claimer, stacks with High Ground)
  if (territory.entrenched && territory.claimedBy) {
    if (territory.claimedBy === "player") pInf += territory.entrenchBonus;
    else aInf += territory.entrenchBonus;
  }

  // Card influence
  for (const card of territory.cardsPlayed) {
    if (card.owner === "player") pInf += card.strength;
    else aInf += card.strength;
  }

  // Store totals on territory
  territory.playerInfluence = pInf;
  territory.aiInfluence = aInf;

  // Determine owner
  if (pInf > aInf) {
    territory.owner = "player";
  } else if (aInf > pInf) {
    territory.owner = "ai";
  } else {
    // Tie — claimer wins. If no claimer, neutral.
    territory.owner = territory.claimedBy || null;
  }

  // Determine if annexation occurred (winner is not the claimer)
  const annexed = !!(
    territory.owner &&
    territory.claimedBy &&
    territory.claimedBy !== territory.owner
  );

  // Calculate effective value (Scorched Earth: 0 for annexer)
  let effectiveValue = territory.value;
  if (territory.terrain === TERRAIN.SCORCHED_EARTH && annexed) {
    effectiveValue = 0;
  }

  return {
    pInf,
    aInf,
    owner: territory.owner,
    annexed,
    effectiveValue,
  };
}

/**
 * Resolve all territories on the map. Mutates territories in place.
 * Returns an array of resolution results in territory order.
 * @param {object[]} territories
 * @returns {object[]} array of { territoryId, pInf, aInf, owner, annexed, effectiveValue }
 */
export function resolveAllTerritories(territories) {
  const results = [];
  for (const t of territories) {
    const result = resolveTerritory(t);
    results.push({
      territoryId: t.id,
      ...result,
    });
  }
  return results;
}

// --------------------------------------------------------
// Network calculation
// --------------------------------------------------------

/**
 * Find all connected networks of 3+ territories controlled by the same owner.
 * Each network is a connected subgraph where every territory is owned by `owner`.
 *
 * For Chokepoint terrain: each Chokepoint territory in a chain adds +1 to the
 * effective chain length used for bonus calculation.
 *
 * @param {object[]} territories - all territories (post-resolution, owners set)
 * @param {string} owner - "player" or "ai"
 * @returns {{ chain: number[], effectiveLength: number, bonus: number }[]}
 */
export function calculateNetworks(territories, owner) {
  const owned = territories.filter((t) => t.owner === owner);
  const ownedSet = new Set(owned.map((t) => t.id));
  const visited = new Set();
  const networks = [];

  for (const t of owned) {
    if (visited.has(t.id)) continue;

    // BFS to find connected component within owned territories
    const chain = [];
    const queue = [t.id];
    visited.add(t.id);

    while (queue.length) {
      const cur = queue.shift();
      chain.push(cur);
      for (const nb of territories[cur].connections) {
        if (ownedSet.has(nb) && !visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }

    // Only networks of 3+ qualify
    if (chain.length >= 3) {
      // Calculate effective length (Chokepoint adds +1 per Chokepoint territory)
      const chokepointCount = chain.filter(
        (id) => territories[id].terrain === TERRAIN.CHOKEPOINT,
      ).length;
      const effectiveLength = chain.length + chokepointCount;
      const bonus = getNetworkBonus(effectiveLength);

      networks.push({ chain, effectiveLength, bonus });
    }
  }

  return networks;
}

// --------------------------------------------------------
// Resolution ordering
// --------------------------------------------------------

/**
 * Get the resolution order: territories sorted by point value ascending.
 * Lower-value territories resolve first, building to the high-value climax.
 * Within the same value, sort by territory id for determinism.
 *
 * @param {object[]} territories
 * @returns {object[]} sorted copy of territories array
 */
export function getResolutionOrder(territories) {
  return [...territories].sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    return a.id - b.id;
  });
}

// --------------------------------------------------------
// Final score calculation
// --------------------------------------------------------

/**
 * Calculate final scores for both players after all territories are resolved.
 *
 * Score = sum of effective territory point values + network bonuses.
 *
 * Tiebreaker: most annexations wins. If still tied, draw.
 *
 * @param {object[]} territories - all territories (post-resolution)
 * @returns {object} Full score breakdown
 */
export function calculateScores(territories) {
  let playerTerritoryPts = 0;
  let aiTerritoryPts = 0;
  let playerAnnexations = 0;
  let aiAnnexations = 0;
  let playerTerritoryCount = 0;
  let aiTerritoryCount = 0;

  for (const t of territories) {
    const annexed = t.owner && t.claimedBy && t.claimedBy !== t.owner;

    if (t.owner === "player") {
      playerTerritoryCount++;
      // Scorched Earth: annexed territories worth 0 to the annexer
      if (t.terrain === TERRAIN.SCORCHED_EARTH && annexed) {
        // Worth 0 points
      } else {
        playerTerritoryPts += t.value;
      }
      if (annexed) playerAnnexations++;
    } else if (t.owner === "ai") {
      aiTerritoryCount++;
      if (t.terrain === TERRAIN.SCORCHED_EARTH && annexed) {
        // Worth 0 points
      } else {
        aiTerritoryPts += t.value;
      }
      if (annexed) aiAnnexations++;
    }
  }

  // Network bonuses
  const playerNetworks = calculateNetworks(territories, "player");
  const aiNetworks = calculateNetworks(territories, "ai");

  let playerNetworkPts = 0;
  for (const net of playerNetworks) playerNetworkPts += net.bonus;

  let aiNetworkPts = 0;
  for (const net of aiNetworks) aiNetworkPts += net.bonus;

  // Totals
  const playerTotal = playerTerritoryPts + playerNetworkPts;
  const aiTotal = aiTerritoryPts + aiNetworkPts;

  // Determine winner
  let winner;
  if (playerTotal > aiTotal) {
    winner = "player";
  } else if (aiTotal > playerTotal) {
    winner = "ai";
  } else if (playerAnnexations > aiAnnexations) {
    winner = "player";
  } else if (aiAnnexations > playerAnnexations) {
    winner = "ai";
  } else {
    winner = "draw";
  }

  return {
    player: playerTotal,
    ai: aiTotal,
    playerTerritoryPts,
    aiTerritoryPts,
    playerNetworkPts,
    aiNetworkPts,
    playerAnnexations,
    aiAnnexations,
    playerNetworks,
    aiNetworks,
    playerTerritoryCount,
    aiTerritoryCount,
    winner,
  };
}

// --------------------------------------------------------
// Influence breakdown helpers (for UI display)
// --------------------------------------------------------

/**
 * Build an influence breakdown for a territory, showing each component
 * that contributes to the total influence for each player.
 * Used by the resolution detail panel to show "Flag +2", "Card +3", etc.
 *
 * @param {object} territory
 * @returns {{ player: object[], ai: object[] }}
 *   Each entry: { label: string, value: number, type: string }
 */
export function getInfluenceBreakdown(territory) {
  const player = [];
  const ai = [];

  // Claim flag
  if (territory.claimedBy === "player") {
    player.push({ label: "Flag", value: 2, type: "claim" });
  }
  if (territory.claimedBy === "ai") {
    ai.push({ label: "Flag", value: 2, type: "claim" });
  }

  // High Ground
  if (territory.terrain === TERRAIN.HIGH_GROUND && territory.claimedBy) {
    const target = territory.claimedBy === "player" ? player : ai;
    target.push({ label: "High Ground", value: 1, type: "terrain" });
  }

  // Entrench
  if (
    territory.entrenched &&
    territory.claimedBy &&
    territory.entrenchBonus > 0
  ) {
    const target = territory.claimedBy === "player" ? player : ai;
    target.push({
      label: "Entrench",
      value: territory.entrenchBonus,
      type: "ability",
    });
  }

  // Cards
  for (const card of territory.cardsPlayed) {
    const entry = {
      label: card.isDecoy ? "Decoy" : `Card`,
      value: card.strength,
      type: card.isDecoy ? "decoy" : "card",
    };
    if (card.owner === "player") player.push(entry);
    else ai.push(entry);
  }

  return { player, ai };
}

/**
 * Get a formatted text summary of a resolution result for the action log.
 * @param {object} territory
 * @param {{ annexed: boolean }} result
 * @returns {string}
 */
export function getResolutionSummary(territory, result) {
  if (!territory.owner) {
    return `${territory.name} — neutral (no points)`;
  }

  const ownerLabel = territory.owner === "player" ? "You" : "AI";
  const pts = territory.value;
  const scorched =
    territory.terrain === TERRAIN.SCORCHED_EARTH && result.annexed;

  if (result.annexed) {
    if (scorched) {
      return `⚡ ${territory.name} ANNEXED by ${ownerLabel} — Scorched Earth! 0 pts`;
    }
    return `⚡ ${territory.name} ANNEXED by ${ownerLabel} (+${pts}pt)`;
  }

  return `${territory.name} held by ${ownerLabel} (+${pts}pt)`;
}

// --------------------------------------------------------
// Provisional network preview (action phase)
// --------------------------------------------------------

/**
 * Calculate provisional networks based on current claims (before resolution).
 * During the action phase, territory ownership isn't determined yet, so we
 * use claimedBy as a proxy. This lets us show players what network chains
 * they're building and what bonuses they'd earn if they hold everything.
 *
 * @param {object[]} territories - all territories
 * @param {string} owner - "player" or "ai"
 * @returns {{ chain: number[], effectiveLength: number, bonus: number }[]}
 */
export function calculateProvisionalNetworks(territories, owner) {
  const claimed = territories.filter((t) => t.claimedBy === owner);
  const claimedSet = new Set(claimed.map((t) => t.id));
  const visited = new Set();
  const networks = [];

  for (const t of claimed) {
    if (visited.has(t.id)) continue;

    const chain = [];
    const queue = [t.id];
    visited.add(t.id);

    while (queue.length) {
      const cur = queue.shift();
      chain.push(cur);
      for (const nb of territories[cur].connections) {
        if (claimedSet.has(nb) && !visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }

    if (chain.length >= 3) {
      const chokepointCount = chain.filter(
        (id) => territories[id].terrain === TERRAIN.CHOKEPOINT,
      ).length;
      const effectiveLength = chain.length + chokepointCount;
      const bonus = getNetworkBonus(effectiveLength);
      networks.push({ chain, effectiveLength, bonus });
    }
  }

  return networks;
}

/**
 * Build a full post-resolution influence breakdown for every territory,
 * suitable for the game-over replay summary screen.
 *
 * @param {object[]} territories - all territories (post-resolution, owners set)
 * @returns {object[]} array of territory summary objects
 */
export function buildReplaySummary(territories) {
  const summaries = [];

  for (const t of territories) {
    const breakdown = getInfluenceBreakdown(t);
    const pTotal = breakdown.player.reduce((s, c) => s + c.value, 0);
    const aTotal = breakdown.ai.reduce((s, c) => s + c.value, 0);
    const annexed = !!(t.owner && t.claimedBy && t.claimedBy !== t.owner);
    const scorched = t.terrain === TERRAIN.SCORCHED_EARTH && annexed;
    const effectiveValue = scorched ? 0 : t.value;

    summaries.push({
      id: t.id,
      name: t.name,
      value: t.value,
      effectiveValue,
      terrain: t.terrain,
      claimedBy: t.claimedBy,
      owner: t.owner,
      playerInfluence: pTotal,
      aiInfluence: aTotal,
      playerBreakdown: breakdown.player,
      aiBreakdown: breakdown.ai,
      annexed,
      scorched,
    });
  }

  return summaries;
}

// --------------------------------------------------------
// Extraction outcome calculation
// --------------------------------------------------------

/**
 * Calculate the Salvage outcome for an Extraction match.
 *
 * Win:  +BASE_WIN_REWARD + wager + (margin * MARGIN_BONUS_PER_POINT)
 * Lose: -wager, all brought consumables destroyed
 *
 * @param {object} breakdown - from calculateScores()
 * @param {number} wager
 * @param {string} playerResult - "player" (won) or "ai" (lost) or "draw"
 * @returns {{ netSalvage: number, base: number, wagerReward: number, marginBonus: number, lost: boolean }}
 */
export function calculateExtractionOutcome(breakdown, wager, playerResult) {
  const BASE_WIN_REWARD = 100;
  const MARGIN_BONUS_PER_POINT = 10;

  if (playerResult === "player") {
    // Player won
    const margin = Math.abs(breakdown.player - breakdown.ai);
    const base = BASE_WIN_REWARD;
    const wagerReward = wager;
    const marginBonus = margin * MARGIN_BONUS_PER_POINT;
    return {
      netSalvage: base + wagerReward + marginBonus,
      base,
      wagerReward,
      marginBonus,
      lost: false,
    };
  } else if (playerResult === "ai") {
    // Player lost
    return {
      netSalvage: -wager,
      base: 0,
      wagerReward: 0,
      marginBonus: 0,
      lost: true,
    };
  } else {
    // Draw — return wager, no bonus
    return {
      netSalvage: 0,
      base: 0,
      wagerReward: 0,
      marginBonus: 0,
      lost: false,
    };
  }
}
