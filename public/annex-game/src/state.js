// ============================================================
// ANNEX — state.js
// Game state factory, extraction persistence (localStorage),
// and state access helpers
// ============================================================

import {
  MODE, PHASE, STARTING_SALVAGE, RELIEF_PACKAGE,
  SEASON_CARRYOVER_RATIO, SEASON_FLOOR_BONUS,
  ABILITY, TOOL,
} from "./constants.js";

// --------------------------------------------------------
// localStorage key
// --------------------------------------------------------
const EXTRACTION_STORAGE_KEY = "annex_extraction_state";

// --------------------------------------------------------
// Default extraction persistent state
// --------------------------------------------------------
function defaultExtractionPersist() {
  return {
    salvage: STARTING_SALVAGE,
    inventory: {
      abilities: Object.values(ABILITY).map(type => ({ type, count: 0 })),
      terraforming: Object.values(TOOL).map(type => ({ type, count: 0 })),
    },
    stats: {
      matchesPlayed: 0,
      matchesWon: 0,
      totalSalvageEarned: 0,
      totalSalvageLost: 0,
      currentStreak: 0,
      bestStreak: 0,
    },
    season: 1,
  };
}

// --------------------------------------------------------
// Load / save extraction state
// --------------------------------------------------------

/**
 * Load extraction persistent state from localStorage.
 * Returns a valid state object even if nothing is stored.
 * @returns {object}
 */
export function loadExtractionState() {
  try {
    const raw = localStorage.getItem(EXTRACTION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge with defaults to handle schema evolution
      const defaults = defaultExtractionPersist();
      return mergeDefaults(parsed, defaults);
    }
  } catch (_e) {
    // Corrupted data — fall through to default
  }
  return defaultExtractionPersist();
}

/**
 * Save extraction persistent state to localStorage.
 * @param {object} extractionState
 */
export function saveExtractionState(extractionState) {
  try {
    localStorage.setItem(EXTRACTION_STORAGE_KEY, JSON.stringify(extractionState));
  } catch (_e) {
    // Storage full or unavailable — silently fail in prototype
  }
}

/**
 * Wipe extraction state (debug tool / new player).
 */
export function resetExtractionState() {
  const fresh = defaultExtractionPersist();
  saveExtractionState(fresh);
  return fresh;
}

/**
 * Apply seasonal soft reset to extraction state.
 * Formula: newBalance = floor(current * SEASON_CARRYOVER_RATIO) + SEASON_FLOOR_BONUS
 * Inventory survives. Only salvage resets.
 * @param {object} extractionState
 * @returns {object} mutated state
 */
export function seasonalReset(extractionState) {
  extractionState.salvage = Math.floor(
    extractionState.salvage * SEASON_CARRYOVER_RATIO
  ) + SEASON_FLOOR_BONUS;
  extractionState.season = (extractionState.season || 1) + 1;
  extractionState.stats.currentStreak = 0;
  saveExtractionState(extractionState);
  return extractionState;
}

/**
 * Grant relief package if salvage is 0.
 * @param {object} extractionState
 * @returns {object} mutated state
 */
export function applyReliefIfNeeded(extractionState) {
  if (extractionState.salvage <= 0) {
    extractionState.salvage = RELIEF_PACKAGE;
    saveExtractionState(extractionState);
  }
  return extractionState;
}

// --------------------------------------------------------
// Inventory helpers
// --------------------------------------------------------

/**
 * Get the count of a specific ability in inventory.
 * @param {object} extractionState
 * @param {string} abilityType
 * @returns {number}
 */
export function getAbilityCount(extractionState, abilityType) {
  const entry = extractionState.inventory.abilities.find(a => a.type === abilityType);
  return entry ? entry.count : 0;
}

/**
 * Get the count of a specific terraforming tool in inventory.
 * @param {object} extractionState
 * @param {string} toolType
 * @returns {number}
 */
export function getToolCount(extractionState, toolType) {
  const entry = extractionState.inventory.terraforming.find(t => t.type === toolType);
  return entry ? entry.count : 0;
}

/**
 * Add an ability to inventory (after purchase).
 * @param {object} extractionState
 * @param {string} abilityType
 * @param {number} [quantity=1]
 */
export function addAbility(extractionState, abilityType, quantity = 1) {
  let entry = extractionState.inventory.abilities.find(a => a.type === abilityType);
  if (!entry) {
    entry = { type: abilityType, count: 0 };
    extractionState.inventory.abilities.push(entry);
  }
  entry.count += quantity;
}

/**
 * Remove an ability from inventory (for loadout or destruction).
 * @param {object} extractionState
 * @param {string} abilityType
 * @param {number} [quantity=1]
 * @returns {boolean} true if successful
 */
export function removeAbility(extractionState, abilityType, quantity = 1) {
  const entry = extractionState.inventory.abilities.find(a => a.type === abilityType);
  if (!entry || entry.count < quantity) return false;
  entry.count -= quantity;
  return true;
}

/**
 * Add a terraforming tool to inventory.
 * @param {object} extractionState
 * @param {string} toolType
 * @param {number} [quantity=1]
 */
export function addTool(extractionState, toolType, quantity = 1) {
  let entry = extractionState.inventory.terraforming.find(t => t.type === toolType);
  if (!entry) {
    entry = { type: toolType, count: 0 };
    extractionState.inventory.terraforming.push(entry);
  }
  entry.count += quantity;
}

/**
 * Remove a terraforming tool from inventory.
 * @param {object} extractionState
 * @param {string} toolType
 * @param {number} [quantity=1]
 * @returns {boolean}
 */
export function removeTool(extractionState, toolType, quantity = 1) {
  const entry = extractionState.inventory.terraforming.find(t => t.type === toolType);
  if (!entry || entry.count < quantity) return false;
  entry.count -= quantity;
  return true;
}

// --------------------------------------------------------
// Game state factory
// --------------------------------------------------------

/**
 * Create a fresh game state for a new match.
 * The map, hands, and mode-specific data are injected after creation.
 *
 * @param {object} options
 * @param {string} options.mode          - MODE.RANKED or MODE.EXTRACTION
 * @param {string} [options.mapPreset]   - preset key (ranked) or null (random)
 * @param {number} [options.wager]       - extraction wager amount
 * @param {object[]} [options.playerAbilities]  - loaded ability objects
 * @param {object[]} [options.aiAbilities]      - AI ability objects
 * @param {object[]} [options.playerTerraformTools] - loaded terraform tools
 * @param {object[]} [options.aiTerraformTools]     - AI terraform tools
 * @returns {object} game state
 */
export function createGameState(options = {}) {
  const mode = options.mode || MODE.RANKED;
  const isExtraction = mode === MODE.EXTRACTION;

  return {
    // ----- Core -----
    mode,
    phase: isExtraction ? PHASE.PLANNING : PHASE.PLANNING,

    // Map data — populated by map.js generateMap()
    territories: [],
    edges: [],

    // Hands — populated by cards.js generateHand()
    playerHand: [],
    aiHand: [],

    // Turn management
    currentTurn: Math.random() < 0.5 ? "player" : "ai",
    turnNumber: 1,
    consecutivePasses: 0,

    // Player interaction state
    selectedAction: null,     // "claim" | "fortify" | "ability" | null
    selectedCard: null,       // card object or null
    selectedAbility: null,    // ability object or null
    abilityTargetStep: 0,     // multi-step targeting progress
    abilityFirstTarget: null, // first target for multi-step abilities
    hoveredTerritory: null,   // territory id or null
    highlightedTerritories: [],

    // ----- Resolution state -----
    resolutionOrder: [],
    resolutionIndex: 0,
    resolutionFocusTerritory: null,
    resolutionResolvedIds: new Set(),
    resolutionRunningPlayer: 0,
    resolutionRunningAI: 0,
    resolutionHighlightChain: [],
    scores: { player: 0, ai: 0 },
    breakdown: null,

    // ----- Canvas state -----
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    dpr: 1,
    animFrame: null,

    // ----- Logging -----
    actionLog: [],

    // ----- Extraction-specific -----
    wager: isExtraction ? (options.wager || 50) : 0,
    playerAbilities: isExtraction ? (options.playerAbilities || []) : [],
    aiAbilities: isExtraction ? (options.aiAbilities || []) : [],
    playerTerraformTools: isExtraction ? (options.playerTerraformTools || []) : [],
    aiTerraformTools: isExtraction ? (options.aiTerraformTools || []) : [],
    terraformTurnIndex: 0,
    terraformCurrentPlayer: null,

    // ----- Tectonic Shift (Extraction only) -----
    tectonicShiftTurn: 0,       // populated at match start
    tectonicShiftData: null,    // { removeEdge, addEdge, valueUp, valueDown, aftershock }
    tectonicShiftOccurred: false,
    tectonicShiftRevealed: false, // true if animation has played

    // ----- Observatory tracking -----
    observatoryClaimedBy: null,   // "player" | "ai" | null
    observatoryPeekUsed: false,   // ranked: has the peek been used
    observatoryPeekBanked: false, // ranked: claimed but no adjacent opponent cards yet
    observatoryTerritoryId: null, // which territory is the observatory

    // ----- Wild card tracking (Extraction) -----
    hasWildCard: false,

    // ----- Map preset used -----
    mapPreset: options.mapPreset || null,
  };
}

// --------------------------------------------------------
// Helpers
// --------------------------------------------------------

/**
 * Recursively merge `source` into `target`, adding any keys from `defaults`
 * that are missing in `source`. Does not overwrite existing keys in `source`.
 * @param {object} source - The loaded data
 * @param {object} defaults - The default schema
 * @returns {object}
 */
function mergeDefaults(source, defaults) {
  const result = { ...defaults };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      typeof defaults[key] === "object" &&
      !Array.isArray(defaults[key])
    ) {
      result[key] = mergeDefaults(source[key], defaults[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Check whether the current game state is in a resolution-like phase.
 * @param {object} state
 * @returns {boolean}
 */
export function isResolutionPhase(state) {
  return (
    state.phase === PHASE.RESOLUTION ||
    state.phase === PHASE.RESOLUTION_NETWORKS ||
    state.phase === PHASE.GAMEOVER
  );
}

/**
 * Check whether the current game state is post-resolution (owners determined).
 * @param {object} state
 * @returns {boolean}
 */
export function isPostResolution(state) {
  return (
    state.phase === PHASE.RESOLUTION ||
    state.phase === PHASE.RESOLUTION_NETWORKS ||
    state.phase === PHASE.GAMEOVER
  );
}

/**
 * Check whether it is the player's turn to act during the action phase.
 * @param {object} state
 * @returns {boolean}
 */
export function isPlayerActionTurn(state) {
  return state.phase === PHASE.ACTION && state.currentTurn === "player";
}

/**
 * Get all cards played on a territory by a specific owner.
 * @param {object} territory
 * @param {string} owner - "player" or "ai"
 * @returns {object[]}
 */
export function getCardsOnTerritory(territory, owner) {
  return territory.cardsPlayed.filter(c => c.owner === owner);
}

/**
 * Get all cards still in hand for a given hand array.
 * @param {object[]} hand
 * @returns {object[]}
 */
export function getHandCards(hand) {
  return hand.filter(c => c.state === "hand");
}

/**
 * Count unclaimed territories.
 * @param {object[]} territories
 * @returns {number}
 */
export function countUnclaimed(territories) {
  return territories.filter(t => t.claimedBy === null).length;
}

/**
 * Check if any unclaimed territories exist.
 * @param {object[]} territories
 * @returns {boolean}
 */
export function hasUnclaimed(territories) {
  return territories.some(t => t.claimedBy === null);
}

/**
 * Get all territories claimed by a specific owner.
 * @param {object[]} territories
 * @param {string} owner
 * @returns {object[]}
 */
export function getClaimedBy(territories, owner) {
  return territories.filter(t => t.claimedBy === owner);
}

/**
 * Get all territories owned (post-resolution) by a specific owner.
 * @param {object[]} territories
 * @param {string} owner
 * @returns {object[]}
 */
export function getOwnedBy(territories, owner) {
  return territories.filter(t => t.owner === owner);
}

/**
 * Check if a territory is contested (both players have presence).
 * @param {object} territory
 * @returns {boolean}
 */
export function isContested(territory) {
  const pCards = territory.cardsPlayed.filter(c => c.owner === "player").length;
  const aCards = territory.cardsPlayed.filter(c => c.owner === "ai").length;
  return (
    (territory.claimedBy === "player" && aCards > 0) ||
    (territory.claimedBy === "ai" && pCards > 0) ||
    (pCards > 0 && aCards > 0)
  );
}
