// ============================================================
// ANNEX — ai.js
// AI opponent logic: terrain-aware claims/fortification,
// ability usage (Extraction), and terraforming decisions.
// ============================================================

import {
  TERRAIN, MODE, ABILITY, TOOL,
  AI_TURN_DELAY_MIN, AI_TURN_DELAY_MAX,
} from "./constants.js";
import { randPick, shuffle } from "./utils.js";
import { getInHandCards, countCardsOnTerritory } from "./cards.js";

// --------------------------------------------------------
// Main AI decision entry point
// --------------------------------------------------------

/**
 * Decide what action the AI should take this turn.
 *
 * Returns an action descriptor:
 *   { action: "claim", territoryId }
 *   { action: "fortify", card, territoryId }
 *   { action: "ability", abilityIndex, targets }
 *   { action: "pass" }
 *
 * @param {object} state - full game state
 * @returns {object} action descriptor
 */
export function aiDecide(state) {
  const { territories, aiHand, mode } = state;
  const playableCards = getInHandCards(aiHand);
  const unclaimed = territories.filter(t => t.claimedBy === null);
  const canClaim = unclaimed.length > 0;
  const canFortify = playableCards.length > 0;

  if (!canClaim && !canFortify) return { action: "pass" };

  // Collect all candidate strategies with scores
  const strategies = [];

  // --- Evaluate claims ---
  if (canClaim) {
    evaluateClaims(state, territories, unclaimed, strategies);
  }

  // --- Evaluate fortifications ---
  if (canFortify) {
    evaluateFortifications(state, territories, playableCards, strategies);
  }

  // --- Evaluate abilities (Extraction only) ---
  if (mode === MODE.EXTRACTION && state.aiAbilities) {
    evaluateAbilities(state, territories, strategies);
  }

  // No strategies available — pass
  if (strategies.length === 0) return { action: "pass" };

  // Sort by score descending and pick (with slight randomization)
  strategies.sort((a, b) => b.score - a.score);
  const pickIdx = Math.random() < 0.75 ? 0 : Math.min(1, strategies.length - 1);
  return strategies[pickIdx];
}

// --------------------------------------------------------
// Claim evaluation
// --------------------------------------------------------

/**
 * Score each unclaimed territory as a potential claim target.
 * Terrain awareness:
 *   - High Ground: +15 (the +1 defender influence is very valuable)
 *   - Observatory: +20 (information advantage, especially in Extraction)
 *   - Chokepoint: conditional bonus if it bridges AI clusters
 *   - Scorched Earth: +5 (safe points once claimed, hard to profitably annex)
 *   - Fog: +4 (hidden defense value)
 *
 * @param {object} state
 * @param {object[]} territories
 * @param {object[]} unclaimed
 * @param {object[]} strategies - mutated, strategies pushed here
 */
function evaluateClaims(state, territories, unclaimed, strategies) {
  const aiClaimCount = territories.filter(t => t.claimedBy === "ai").length;

  for (const t of unclaimed) {
    let score = t.value * 12;

    // Network extension bonus — reward connecting to existing AI territories
    for (const nbId of t.connections) {
      if (territories[nbId].claimedBy === "ai") score += 10;
      if (territories[nbId].claimedBy === "player") score += 4;
    }

    // Connectivity value — more connections = more strategic
    score += t.connections.length * 3;

    // Early game: bias toward claiming to build board presence
    if (aiClaimCount < 3) score += 15;

    // --- Terrain modifiers ---
    score += getClaimTerrainBonus(t, state, territories);

    // Randomization
    score += Math.random() * 6;

    strategies.push({ action: "claim", territoryId: t.id, score });
  }
}

/**
 * Calculate terrain-specific bonus for claiming a territory.
 * @param {object} territory
 * @param {object} state
 * @param {object[]} territories
 * @returns {number}
 */
function getClaimTerrainBonus(territory, state, territories) {
  let bonus = 0;

  switch (territory.terrain) {
    case TERRAIN.HIGH_GROUND:
      // +1 defender influence is very valuable — makes annexation harder
      bonus += 15;
      break;

    case TERRAIN.OBSERVATORY:
      // Information advantage. In Extraction, reveals tectonic shift.
      // In Ranked, gives a peek at one opponent card.
      bonus += 20;
      break;

    case TERRAIN.CHOKEPOINT:
      // Valuable if it connects two AI clusters
      bonus += getChokepointClaimBonus(territory, territories);
      break;

    case TERRAIN.SCORCHED_EARTH:
      // Safe points — opponent gains nothing by annexing
      bonus += 5;
      break;

    case TERRAIN.FOG:
      // Hidden defense — opponent can't see if we fortify later
      bonus += 4;
      break;

    // PLAINS — no modifier
  }

  return bonus;
}

/**
 * Evaluate how valuable a Chokepoint territory is for the AI to claim.
 * More valuable when it bridges two clusters of AI territories.
 *
 * @param {object} territory
 * @param {object[]} territories
 * @returns {number}
 */
function getChokepointClaimBonus(territory, territories) {
  let aiNeighborClusters = 0;
  let aiNeighborCount = 0;

  for (const nbId of territory.connections) {
    if (territories[nbId].claimedBy === "ai") {
      aiNeighborCount++;
    }
  }

  // If the Chokepoint connects 2+ AI territories, it's a bridge — very valuable
  // for networks since Chokepoint counts double in chain length
  if (aiNeighborCount >= 2) return 18;
  if (aiNeighborCount === 1) return 10;
  return 4; // Still valuable for future network building
}

// --------------------------------------------------------
// Fortification evaluation
// --------------------------------------------------------

/**
 * Score each possible card placement on each territory.
 * Terrain awareness:
 *   - High Ground: harder to annex, so reduce attack score
 *   - Fog: increase bluff value (opponent can't see the card)
 *   - Scorched Earth: dramatically reduce attack score (0 pts if annexed)
 *   - Chokepoint: bonus for defending/attacking network bridges
 *
 * @param {object} state
 * @param {object[]} territories
 * @param {object[]} playableCards
 * @param {object[]} strategies - mutated
 */
function evaluateFortifications(state, territories, playableCards, strategies) {
  for (const card of playableCards) {
    for (const t of territories) {
      let score = 0;

      if (t.claimedBy === "ai") {
        score = evaluateDefend(t, card, territories);
      } else if (t.claimedBy === "player") {
        score = evaluateAttack(t, card, territories);
      } else {
        // Unclaimed — only bluffs or wild card plays make sense
        score = evaluateUnclaimedFortify(t, card);
      }

      // --- Terrain modifiers for fortification ---
      score += getFortifyTerrainBonus(t, card, territories);

      // Diminishing returns for stacking cards
      const existingAiCards = countCardsOnTerritory(t, "ai");
      if (existingAiCards >= 1) score *= 0.4;
      if (existingAiCards >= 2) score *= 0.1;

      // Randomization
      score += Math.random() * 4;

      if (score > 0) {
        strategies.push({
          action: "fortify",
          card,
          territoryId: t.id,
          score,
        });
      }
    }
  }
}

/**
 * Evaluate defending an AI-claimed territory.
 * @param {object} territory
 * @param {object} card
 * @param {object[]} territories
 * @returns {number}
 */
function evaluateDefend(territory, card, territories) {
  const threatCards = countCardsOnTerritory(territory, "player");

  if (threatCards > 0) {
    // Serious threat — use strong cards to defend
    return 20 + card.strength * 7 + territory.value * 5;
  }

  // Light defense — only worth it for high-value or bridge territories
  const isNetworkLink = territory.connections.some(
    nb => territories[nb].claimedBy === "ai"
  );
  return 5 + card.strength * 2 + territory.value * 2 + (isNetworkLink ? 8 : 0);
}

/**
 * Evaluate attacking (annexing) a player-claimed territory.
 * @param {object} territory
 * @param {object} card
 * @param {object[]} territories
 * @returns {number}
 */
function evaluateAttack(territory, card, territories) {
  let score = 12 + card.strength * 8 + territory.value * 4;

  // Extra value for disrupting player networks
  let playerNeighborClaims = 0;
  for (const nbId of territory.connections) {
    if (territories[nbId].claimedBy === "player") playerNeighborClaims++;
  }
  score += playerNeighborClaims * 7;

  // Bridge disruption bonus
  if (playerNeighborClaims >= 2) score += 10;

  // Bluffing: sometimes play str-1 on player territories to waste their resources
  if (card.strength === 1 && Math.random() < 0.35) {
    score += 14;
  }

  return score;
}

/**
 * Evaluate fortifying an unclaimed territory.
 * Generally low value — only bluffs with weak cards.
 * @param {object} territory
 * @param {object} card
 * @returns {number}
 */
function evaluateUnclaimedFortify(territory, card) {
  return card.strength <= 1 ? 8 + territory.value * 2 : 2;
}

/**
 * Terrain-specific bonuses for fortification decisions.
 * @param {object} territory
 * @param {object} card
 * @param {object[]} territories
 * @returns {number}
 */
function getFortifyTerrainBonus(territory, card, territories) {
  let bonus = 0;

  switch (territory.terrain) {
    case TERRAIN.HIGH_GROUND:
      if (territory.claimedBy === "ai") {
        // Defending High Ground — already has +1, less need for cards
        bonus -= 3;
      } else if (territory.claimedBy === "player") {
        // Attacking High Ground — harder to annex, need stronger cards
        bonus -= 10;
        if (card.strength >= 3) bonus += 5; // Still worthwhile with strong cards
      }
      break;

    case TERRAIN.FOG:
      if (territory.claimedBy === "ai") {
        // Defending on Fog — opponent can't see the card, free hidden defense
        bonus += 6;
      }
      // Bluffing on Fog is extra effective since opponent can't even see the card
      if (territory.claimedBy === "player" && card.strength <= 1) {
        // Actually, on fog the opponent can't see we played here, so bluff is useless
        // Don't bluff on fog — they won't react to what they can't see
        bonus -= 10;
      }
      break;

    case TERRAIN.SCORCHED_EARTH:
      if (territory.claimedBy === "player") {
        // Attacking Scorched Earth — even if we annex, worth 0 points
        bonus -= 25;
      }
      if (territory.claimedBy === "ai") {
        // Defending Scorched Earth — opponent has no incentive to attack
        bonus -= 5;
      }
      break;

    case TERRAIN.CHOKEPOINT:
      // Chokepoint territories are extra valuable for networks
      if (territory.claimedBy === "ai") {
        bonus += 6; // Worth defending
      }
      if (territory.claimedBy === "player") {
        // Worth attacking to disrupt opponent networks
        const playerNeighbors = territory.connections.filter(
          nb => territories[nb].claimedBy === "player"
        ).length;
        if (playerNeighbors >= 1) bonus += 8;
      }
      break;
  }

  return bonus;
}

// --------------------------------------------------------
// Ability evaluation (Extraction only)
// --------------------------------------------------------

/**
 * Evaluate each unused ability and generate strategies.
 * Each ability use costs a turn, so it competes with claims/fortifications.
 *
 * @param {object} state
 * @param {object[]} territories
 * @param {object[]} strategies - mutated
 */
function evaluateAbilities(state, territories, strategies) {
  if (!state.aiAbilities) return;

  for (let i = 0; i < state.aiAbilities.length; i++) {
    const ability = state.aiAbilities[i];
    if (ability.used) continue;

    const evaluation = evaluateSingleAbility(ability, state, territories);
    if (evaluation && evaluation.score > 0) {
      strategies.push({
        action: "ability",
        abilityIndex: i,
        abilityType: ability.type,
        targets: evaluation.targets,
        score: evaluation.score,
      });
    }
  }
}

/**
 * Evaluate a single ability for the AI.
 * Returns { score, targets } or null if the ability can't be used.
 *
 * @param {object} ability - { type, used }
 * @param {object} state
 * @param {object[]} territories
 * @returns {{ score: number, targets: object }|null}
 */
function evaluateSingleAbility(ability, state, territories) {
  switch (ability.type) {
    case ABILITY.INTERCEPT:
      return evaluateIntercept(state, territories);

    case ABILITY.DECOY:
      return evaluateDecoy(state, territories);

    case ABILITY.REINFORCE:
      return evaluateReinforce(state, territories);

    case ABILITY.SABOTAGE:
      return evaluateSabotage(state, territories);

    case ABILITY.ENTRENCH:
      return evaluateEntrench(state, territories);

    case ABILITY.RECALL:
      return evaluateRecall(state, territories);

    case ABILITY.REDIRECT:
      return evaluateRedirect(state, territories);

    case ABILITY.SPLIT:
      return evaluateSplit(state);

    default:
      return null;
  }
}

/**
 * Intercept: Reveal one opponent card's strength.
 * Best used on high-value contested territories.
 */
function evaluateIntercept(state, territories) {
  let bestScore = 0;
  let bestTarget = null;

  for (const t of territories) {
    const playerCards = t.cardsPlayed.filter(
      c => c.owner === "player" && !c.revealed
    );
    if (playerCards.length === 0) continue;

    // Value based on territory value and number of hidden player cards
    const score = t.value * 8 + playerCards.length * 5;
    if (score > bestScore) {
      bestScore = score;
      bestTarget = { territoryId: t.id, cardId: playerCards[0].id };
    }
  }

  if (!bestTarget) return null;
  return { score: bestScore, targets: bestTarget };
}

/**
 * Decoy: Place a fake strength-0 card.
 * Best used adjacent to real targets to create noise.
 */
function evaluateDecoy(state, territories) {
  // Prefer territories adjacent to AI's real investments
  const aiPlayedTerritories = new Set();
  for (const t of territories) {
    if (t.cardsPlayed.some(c => c.owner === "ai")) {
      aiPlayedTerritories.add(t.id);
    }
  }

  let bestScore = 0;
  let bestTarget = null;

  for (const t of territories) {
    if (t.claimedBy === "player") {
      // Decoy on player territory — looks like an attack
      let score = 12 + Math.random() * 8;
      // More convincing if adjacent to AI's real plays
      const adjacentToReal = t.connections.some(nb => aiPlayedTerritories.has(nb));
      if (adjacentToReal) score += 6;
      // Less useful late game (opponent can count cards)
      const cardsRemaining = getInHandCards(state.aiHand).length;
      if (cardsRemaining <= 1) score *= 0.3;

      if (score > bestScore) {
        bestScore = score;
        bestTarget = { territoryId: t.id };
      }
    }
  }

  // Decoys on fog territories are pointless (opponent can't see them)
  if (bestTarget) {
    const t = territories[bestTarget.territoryId];
    if (t.terrain === TERRAIN.FOG) return null;
  }

  if (!bestTarget) return null;
  return { score: bestScore, targets: bestTarget };
}

/**
 * Reinforce: +1 strength to a played card.
 * Best used on the highest-value contested territory.
 */
function evaluateReinforce(state, territories) {
  let bestScore = 0;
  let bestTarget = null;

  for (const t of territories) {
    const aiCards = t.cardsPlayed.filter(
      c => c.owner === "ai" && c.strength < 5 && !c.isDecoy
    );
    if (aiCards.length === 0) continue;

    const isContested = t.cardsPlayed.some(c => c.owner === "player") ||
                        (t.claimedBy === "player");
    const score = t.value * 5 + (isContested ? 10 : 0) + aiCards[0].strength * 2;

    if (score > bestScore) {
      bestScore = score;
      bestTarget = { cardId: aiCards[0].id };
    }
  }

  if (!bestTarget) return null;
  return { score: bestScore, targets: bestTarget };
}

/**
 * Sabotage: Remove an opponent card from the board.
 * Best used on the most valuable contested territory.
 */
function evaluateSabotage(state, territories) {
  let bestScore = 0;
  let bestTarget = null;

  for (const t of territories) {
    const playerCards = t.cardsPlayed.filter(c => c.owner === "player");
    if (playerCards.length === 0) continue;

    // Prefer removing cards from high-value territories where AI has presence
    const aiPresence = t.claimedBy === "ai" || t.cardsPlayed.some(c => c.owner === "ai");
    const score = t.value * 10 + (aiPresence ? 15 : 0) + playerCards.length * 3;

    if (score > bestScore) {
      bestScore = score;
      bestTarget = { cardId: playerCards[0].id };
    }
  }

  if (!bestTarget) return null;
  return { score: bestScore, targets: bestTarget };
}

/**
 * Entrench: +2 defender bonus on a claimed territory.
 * Best used on the AI's most valuable claimed territory without card defense.
 */
function evaluateEntrench(state, territories) {
  let bestScore = 0;
  let bestTarget = null;

  for (const t of territories) {
    if (t.claimedBy !== "ai") continue;
    if (t.entrenched) continue; // Already entrenched

    const aiCardCount = countCardsOnTerritory(t, "ai");
    // More valuable when the territory has no card defense
    const score = t.value * 6 + (aiCardCount === 0 ? 8 : 0);

    if (score > bestScore) {
      bestScore = score;
      bestTarget = { territoryId: t.id };
    }
  }

  if (!bestTarget) return null;
  return { score: bestScore, targets: bestTarget };
}

/**
 * Recall: Pick up a played card and return to hand.
 * Conservative — AI only uses this with a clear threshold (score > 20).
 * Best when a card is wasted on an uncontested territory.
 */
function evaluateRecall(state, territories) {
  let bestScore = 0;
  let bestTarget = null;

  for (const t of territories) {
    const aiCards = t.cardsPlayed.filter(c => c.owner === "ai" && !c.isDecoy);
    if (aiCards.length === 0) continue;

    // Card is "wasted" if territory is uncontested and AI already wins it
    const playerCards = t.cardsPlayed.filter(c => c.owner === "player");
    const isOvercommitted = aiCards.length > 1 && playerCards.length === 0 && t.claimedBy === "ai";

    if (isOvercommitted) {
      // Recall the weakest card — it's not needed here
      const weakest = [...aiCards].sort((a, b) => a.strength - b.strength)[0];
      const score = weakest.strength * 8; // Value of getting the card back
      if (score > bestScore) {
        bestScore = score;
        bestTarget = { cardId: weakest.id };
      }
    }
  }

  // Apply the threshold — only recall if clearly beneficial
  if (bestScore < 20) return null;
  if (!bestTarget) return null;
  return { score: bestScore, targets: bestTarget };
}

/**
 * Redirect: Move a played card to adjacent territory (strength -1).
 * Conservative — only redirect if there's a clearly better target.
 */
function evaluateRedirect(state, territories) {
  let bestScore = 0;
  let bestTarget = null;

  for (const t of territories) {
    const aiCards = t.cardsPlayed.filter(c => c.owner === "ai" && !c.isDecoy && c.strength >= 2);
    if (aiCards.length === 0) continue;

    // Check adjacent territories for better placement
    for (const card of aiCards) {
      for (const nbId of t.connections) {
        const nb = territories[nbId];
        const nbPlayerCards = countCardsOnTerritory(nb, "player");
        const nbAiCards = countCardsOnTerritory(nb, "ai");

        // Is the adjacent territory more contested and valuable?
        if (nb.claimedBy === "player" && nbPlayerCards > 0 && nbAiCards === 0 && nb.value > t.value) {
          const score = (nb.value - t.value) * 8 + (card.strength - 1) * 3;
          if (score > bestScore) {
            bestScore = score;
            bestTarget = { cardId: card.id, targetTerritoryId: nbId };
          }
        }
      }
    }
  }

  if (bestScore < 20) return null;
  if (!bestTarget) return null;
  return { score: bestScore, targets: bestTarget };
}

/**
 * Split: Break a strong hand card into two weaker ones.
 * Conservative — only split if there are multiple high-value targets.
 */
function evaluateSplit(state) {
  const splittable = getInHandCards(state.aiHand).filter(c => c.strength >= 3);
  if (splittable.length === 0) return null;

  // Count high-value contested territories where AI doesn't have a card
  const contestedCount = state.territories.filter(t => {
    const playerPresence = t.claimedBy === "player" || t.cardsPlayed.some(c => c.owner === "player");
    const aiHasCard = t.cardsPlayed.some(c => c.owner === "ai");
    return playerPresence && !aiHasCard && t.value >= 3;
  }).length;

  // Split is worthwhile if we need to spread across multiple targets
  if (contestedCount >= 2) {
    const card = splittable.sort((a, b) => b.strength - a.strength)[0];
    return {
      score: contestedCount * 8 + card.strength * 3,
      targets: { cardId: card.id },
    };
  }

  return null;
}

// --------------------------------------------------------
// Terraforming AI (Extraction only)
// --------------------------------------------------------

/**
 * Decide which terraforming tool to apply and where.
 *
 * Strategy:
 *   - Fortification Kit → highest-value Plains territory
 *   - Fog Machine → medium-value well-connected Plains territory
 *   - Salt the Earth → high-value Plains territory (defensive)
 *   - Chokepoint Charge → 2-connection Plains territory
 *   - Watchtower → medium-value Plains territory
 *   - Demolition Charge → edge that most isolates opponent potential
 *   - Bridge Builder → edge that extends AI's likely network
 *
 * @param {object} tool - { type, used }
 * @param {object[]} territories
 * @param {number[][]} edges
 * @param {Set} edgeSet
 * @returns {{ targetId: number, targetId2?: number }|null}
 */
export function aiTerraformDecide(tool, territories, edges, edgeSet) {
  const plains = territories.filter(t => t.terrain === TERRAIN.PLAINS);

  switch (tool.type) {
    case TOOL.FORTIFICATION_KIT: {
      // Place High Ground on highest-value Plains territory
      const sorted = [...plains].sort((a, b) => b.value - a.value);
      return sorted.length > 0 ? { targetId: sorted[0].id } : null;
    }

    case TOOL.FOG_MACHINE: {
      // Place Fog on medium-value well-connected Plains territory
      // Check adjacency constraint (no adjacent Fog)
      const candidates = plains.filter(t => {
        return !t.connections.some(nb => territories[nb].terrain === TERRAIN.FOG);
      });
      // Prefer well-connected territories (3+ connections)
      const preferred = candidates.filter(t => t.connections.length >= 3);
      const pool = preferred.length > 0 ? preferred : candidates;
      // Sort by value — prefer medium value (not too high, not too low)
      const sorted = [...pool].sort(
        (a, b) => Math.abs(a.value - 3) - Math.abs(b.value - 3)
      );
      return sorted.length > 0 ? { targetId: sorted[0].id } : null;
    }

    case TOOL.WATCHTOWER: {
      // Place Observatory on medium-value Plains territory
      const sorted = [...plains].sort(
        (a, b) => Math.abs(a.value - 3) - Math.abs(b.value - 3)
      );
      return sorted.length > 0 ? { targetId: sorted[0].id } : null;
    }

    case TOOL.CHOKEPOINT_CHARGE: {
      // Place Chokepoint on a 2-connection Plains territory
      const candidates = plains.filter(t => t.connections.length === 2);
      // Prefer higher value
      const sorted = [...candidates].sort((a, b) => b.value - a.value);
      return sorted.length > 0 ? { targetId: sorted[0].id } : null;
    }

    case TOOL.SALT_THE_EARTH: {
      // Place Scorched Earth on high-value Plains territory (defensive play)
      const candidates = plains.filter(t => t.value >= 2);
      const sorted = [...candidates].sort((a, b) => b.value - a.value);
      return sorted.length > 0 ? { targetId: sorted[0].id } : null;
    }

    case TOOL.DEMOLITION_CHARGE: {
      // Remove edge — prefer edges that are far from AI's likely territory
      // Simple heuristic: remove edge between two territories with low value
      const removable = edges.filter(([a, b]) => {
        if (territories[a].connections.length <= 2) return false;
        if (territories[b].connections.length <= 2) return false;
        return true;
      });
      if (removable.length === 0) return null;
      // Pick the edge connecting the lowest total value
      const sorted = [...removable].sort(
        (a, b) => (territories[a[0]].value + territories[a[1]].value) -
                  (territories[b[0]].value + territories[b[1]].value)
      );
      return { targetId: sorted[0][0], targetId2: sorted[0][1] };
    }

    case TOOL.BRIDGE_BUILDER: {
      // Add edge — prefer connecting two high-value territories
      const candidates = findPotentialEdgesForAI(territories, edgeSet);
      if (candidates.length === 0) return null;
      const sorted = [...candidates].sort(
        (a, b) => (territories[b[0]].value + territories[b[1]].value) -
                  (territories[a[0]].value + territories[a[1]].value)
      );
      return { targetId: sorted[0][0], targetId2: sorted[0][1] };
    }

    default:
      return null;
  }
}

/**
 * Find potential edges the AI could add (within 2 hops, respecting constraints).
 * Lightweight duplicate of map.findPotentialEdges to avoid circular imports.
 *
 * @param {object[]} territories
 * @param {Set} edgeSet
 * @returns {Array<[number, number]>}
 */
function findPotentialEdgesForAI(territories, edgeSet) {
  const MAX = 4;
  const candidates = [];
  const seen = new Set();

  for (let i = 0; i < territories.length; i++) {
    if (territories[i].connections.length >= MAX) continue;
    for (const nb of territories[i].connections) {
      for (const nb2 of territories[nb].connections) {
        if (nb2 === i) continue;
        if (territories[nb2].connections.length >= MAX) continue;
        const key = Math.min(i, nb2) + "," + Math.max(i, nb2);
        if (edgeSet.has(key)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push([i, nb2]);
      }
    }
  }

  return candidates;
}

// --------------------------------------------------------
// Tectonic shift awareness
// --------------------------------------------------------

/**
 * If the AI has Observatory intel about the tectonic shift,
 * adjust its strategy. This modifies the AI's evaluation scores
 * rather than being a separate action.
 *
 * Called internally by aiDecide when Observatory intel is available.
 *
 * @param {object} state
 * @param {object[]} strategies
 */
export function adjustForTectonicIntel(state, strategies) {
  if (!state.tectonicShiftData || state.tectonicShiftOccurred) return;
  if (state.observatoryClaimedBy !== "ai") return;

  const shift = state.tectonicShiftData;

  for (const strategy of strategies) {
    if (strategy.action === "claim" || strategy.action === "fortify") {
      const tId = strategy.territoryId;

      // Territory value is about to increase — boost score
      if (shift.valueUp && shift.valueUp.territoryId === tId) {
        strategy.score += 12;
      }

      // Territory value is about to decrease — reduce score
      if (shift.valueDown && shift.valueDown.territoryId === tId) {
        strategy.score -= 8;
      }

      // Edge about to be removed — if this territory depends on that edge
      // for network connectivity, reduce confidence
      if (shift.removeEdge) {
        const { a, b } = shift.removeEdge;
        if (tId === a || tId === b) {
          strategy.score -= 5;
        }
      }

      // Edge about to be added — territories that will gain a new connection
      // become more valuable
      if (shift.addEdge) {
        const { a, b } = shift.addEdge;
        if (tId === a || tId === b) {
          strategy.score += 6;
        }
      }

      // Territory about to become Scorched Earth — avoid investing
      if (shift.aftershock && shift.aftershock.territoryId === tId) {
        strategy.score -= 15;
      }
    }
  }
}

// --------------------------------------------------------
// AI turn delay helper
// --------------------------------------------------------

/**
 * Get a random delay for the AI's turn, simulating "thinking" time.
 * @returns {number} delay in milliseconds
 */
export function getAiTurnDelay() {
  return AI_TURN_DELAY_MIN + Math.random() * (AI_TURN_DELAY_MAX - AI_TURN_DELAY_MIN);
}
