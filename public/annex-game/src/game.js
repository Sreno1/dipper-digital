// ============================================================
// ANNEX — game.js
// Main game orchestrator: turn flow, game start/end,
// mode selection, ability execution, terraforming phase,
// tectonic shift triggering, and wiring all systems together.
// ============================================================

import {
  PHASE,
  MODE,
  TERRAIN,
  ABILITY,
  ABILITY_META,
  TOOL,
  TOOL_META,
  RESOLUTION_STEP_DELAY,
  MAP_PRESETS,
  BASE_WIN_REWARD,
  MARGIN_BONUS_PER_POINT,
} from "./constants.js";
import { $, $$ } from "./utils.js";
import {
  createGameState,
  loadExtractionState,
  saveExtractionState,
  isPlayerActionTurn,
  hasUnclaimed,
  isResolutionPhase,
  getHandCards,
  applyReliefIfNeeded,
  addAbility,
  removeAbility,
  addTool,
  removeTool,
  getAbilityCount,
  getToolCount,
  seasonalReset,
  resetExtractionState,
} from "./state.js";
import {
  generateMap,
  generatePresetMap,
  generateRandomMap,
  findObservatoryId,
  buildEdgeSet,
  applyTerraform,
  validateTerraform,
} from "./map.js";
import {
  generateHand,
  getInHandCards,
  playCard,
  forfeitHand,
  createDecoy,
  sabotageCard,
  recallCard,
  redirectCard,
  reinforceCard,
  splitCard,
  countHandCards,
  isSplittable,
} from "./cards.js";
import {
  resolveAllTerritories,
  getResolutionOrder,
  calculateScores,
  calculateExtractionOutcome,
} from "./resolution.js";
import {
  calculateShiftTurn,
  generateShiftData,
  applyShift,
  validateShift,
  getShiftNotificationSummary,
} from "./tectonic.js";
import {
  aiDecide,
  getAiTurnDelay,
  aiTerraformDecide,
  adjustForTectonicIntel,
} from "./ai.js";
import { initCanvas, startRenderLoop, drawShiftAnimation } from "./renderer.js";
import {
  showScreen,
  showOverlay,
  hideOverlay,
  notify,
  logAction,
  updateUI,
  renderHand,
  showResolutionDetail,
  updateResolutionTally,
  showNetworkPhase,
  showGameOver,
  resetResolutionUI,
  setupCanvasInput,
  setupKeyboard,
  renderExtractionLobby,
  renderMapSelect,
  showObservatoryIntel,
  showObservatoryPeekModal,
  updateVersionTag,
} from "./ui.js";
import {
  hasCompletedTutorial,
  isTutorialActive,
  startTutorial,
  stopTutorial,
  resetTutorial,
  fireTutorialEvent,
  dismissCurrentStep,
} from "./tutorial.js";

// ============================================================
// Module-level state
// ============================================================

/** @type {object|null} Current game state */
let state = null;

/** @type {function|null} Cleanup for render loop */
let cancelRender = null;

/** @type {function|null} Cleanup for canvas input */
let cancelInput = null;

/** @type {function|null} Cleanup for keyboard */
let cancelKeyboard = null;

/** @type {function|null} Cleanup for canvas resize */
let cancelResize = null;

/** @type {object|null} Cached extraction persistent state */
let extractionPersist = null;

// ============================================================
// Initialization
// ============================================================

/**
 * Boot the application. Called once on page load.
 */
export function init() {
  updateVersionTag();
  wireMenuButtons();
  wireGameButtons();
  extractionPersist = loadExtractionState();
}

/**
 * Wire up the title screen and navigation buttons.
 */
function wireMenuButtons() {
  const btnRanked = $("#btn-play-ranked");
  const btnExtraction = $("#btn-play-extraction");
  const btnHowToPlay = $("#btn-how-to-play");
  const btnBackTitle = $("#btn-back-title");
  const btnBackTitle2 = $("#btn-back-title-2");
  const btnBackTitle3 = $("#btn-back-title-3");
  const btnResetSeason = $("#btn-reset-season");
  const btnResetAll = $("#btn-reset-all");

  // Legacy single play button (if mode buttons aren't in the DOM yet)
  const btnPlay = $("#btn-play");

  if (btnRanked) {
    btnRanked.addEventListener("click", () => {
      showScreen("#screen-map-select");
      renderMapSelect(onMapSelected);
    });
  }

  if (btnExtraction) {
    btnExtraction.addEventListener("click", () => {
      extractionPersist = loadExtractionState();
      applyReliefIfNeeded(extractionPersist);
      showScreen("#screen-extraction-lobby");
      _rerenderLobby();
    });
  }

  if (btnPlay) {
    // Fallback: if old single-button layout exists, start ranked with random map
    btnPlay.addEventListener("click", () => {
      // Check if mode buttons exist — if so, this is the new layout and btn-play
      // is repurposed. If not, just start a ranked game with a random preset.
      if (btnRanked) return; // New layout handles it
      const presetKeys = Object.keys(MAP_PRESETS);
      const randomPreset =
        presetKeys[Math.floor(Math.random() * presetKeys.length)];
      startRankedGame(randomPreset);
    });
  }

  if (btnHowToPlay) {
    btnHowToPlay.addEventListener("click", () =>
      showScreen("#screen-how-to-play"),
    );
  }

  // Multiple back buttons for different screens
  [btnBackTitle, btnBackTitle2, btnBackTitle3].forEach((btn) => {
    if (btn) btn.addEventListener("click", () => showScreen("#screen-title"));
  });

  if (btnResetSeason) {
    btnResetSeason.addEventListener("click", () => {
      extractionPersist = loadExtractionState();
      seasonalReset(extractionPersist);
      notify("Season reset applied!", "salvage");
      // Re-render lobby if visible
      _rerenderLobby();
    });
  }

  if (btnResetAll) {
    btnResetAll.addEventListener("click", () => {
      extractionPersist = resetExtractionState();
      notify("All extraction progress reset!", "contested");
    });
  }
}

// ============================================================
// Ranked mode entry
// ============================================================

/**
 * Called when a map is selected from the Ranked map select screen.
 * @param {string} presetKey
 */
function onMapSelected(presetKey) {
  startRankedGame(presetKey);
}

/**
 * Start a Ranked mode game with the given map preset.
 * @param {string} presetKey
 */
function startRankedGame(presetKey, enableTutorial) {
  cleanup();

  // E: Start tutorial for first-time players
  if (enableTutorial || !hasCompletedTutorial()) {
    startTutorial();
  }

  // Create state
  state = createGameState({
    mode: MODE.RANKED,
    mapPreset: presetKey,
  });

  // Generate map
  const map = generateMap({ mode: MODE.RANKED, mapPreset: presetKey });
  state.territories = map.territories;
  state.edges = map.edges;
  state._edgeSet = map.edgeSet;

  // Generate hands
  state.playerHand = generateHand("player", MODE.RANKED);
  state.aiHand = generateHand("ai", MODE.RANKED);

  // Find Observatory
  state.observatoryTerritoryId = findObservatoryId(state.territories);

  // Wire up callbacks
  wireStateCallbacks();

  // Show game screen
  showScreen("#screen-game");
  cancelResize = initCanvas(state);
  cancelInput = setupCanvasInput(state, { onCanvasClick: handleCanvasClick });
  cancelRender = startRenderLoop(state);
  cancelKeyboard = setupKeyboard(state, buildKeyboardHandlers());

  // Initial UI
  updateUI(state);
  logAction(
    state,
    `Ranked match — ${MAP_PRESETS[presetKey]?.name || "Random"} — 9 territories, 5 cards each`,
    "neutral",
  );
  logAction(state, "Claim territories. Fortify with cards. Bluff.", "neutral");

  // E: Fire tutorial game-start event
  fireTutorialEvent(state, "game-start");
}

// ============================================================
// Extraction mode entry
// ============================================================

/**
 * Handle buying an ability in the Extraction shop.
 * @param {string} abilityType
 */
function handleBuyAbility(abilityType) {
  const meta = ABILITY_META[abilityType];
  if (!meta) return;

  extractionPersist = loadExtractionState();
  if (extractionPersist.salvage < meta.cost) {
    notify("Not enough Salvage!", "contested");
    return;
  }

  extractionPersist.salvage -= meta.cost;
  addAbility(extractionPersist, abilityType);
  saveExtractionState(extractionPersist);

  notify(`Bought ${meta.label}!`, "blue");

  _rerenderLobby();
}

/**
 * Handle selling an ability back for a 50% refund.
 * @param {string} abilityType
 */
function handleSellAbility(abilityType) {
  const meta = ABILITY_META[abilityType];
  if (!meta) return;

  extractionPersist = loadExtractionState();
  if (getAbilityCount(extractionPersist, abilityType) < 1) {
    notify("Nothing to sell!", "contested");
    return;
  }

  const refund = Math.floor(meta.cost * 0.5);
  removeAbility(extractionPersist, abilityType);
  extractionPersist.salvage += refund;
  saveExtractionState(extractionPersist);

  notify(`Sold ${meta.label} for ◆ ${refund}`, "amber");

  _rerenderLobby();
}

/**
 * Handle buying a terraforming tool in the Extraction shop.
 * @param {string} toolType
 */
function handleBuyTool(toolType) {
  const meta = TOOL_META[toolType];
  if (!meta) return;

  extractionPersist = loadExtractionState();
  if (extractionPersist.salvage < meta.cost) {
    notify("Not enough Salvage!", "contested");
    return;
  }

  extractionPersist.salvage -= meta.cost;
  addTool(extractionPersist, toolType);
  saveExtractionState(extractionPersist);

  notify(`Bought ${meta.label}!`, "blue");

  _rerenderLobby();
}

/**
 * Handle selling a terraforming tool back for a 50% refund.
 * @param {string} toolType
 */
function handleSellTool(toolType) {
  const meta = TOOL_META[toolType];
  if (!meta) return;

  extractionPersist = loadExtractionState();
  if (getToolCount(extractionPersist, toolType) < 1) {
    notify("Nothing to sell!", "contested");
    return;
  }

  const refund = Math.floor(meta.cost * 0.5);
  removeTool(extractionPersist, toolType);
  extractionPersist.salvage += refund;
  saveExtractionState(extractionPersist);

  notify(`Sold ${meta.label} for ◆ ${refund}`, "amber");

  _rerenderLobby();
}

/**
 * Re-render the extraction lobby with the current persist state and handlers.
 * Centralises the repeated handler object construction.
 */
function _rerenderLobby() {
  renderExtractionLobby(extractionPersist, {
    onBuyAbility: handleBuyAbility,
    onSellAbility: handleSellAbility,
    onBuyTool: handleBuyTool,
    onSellTool: handleSellTool,
    onStartMatch: handleStartExtraction,
    onBack: () => showScreen("#screen-title"),
  });
}

/**
 * Handle starting an Extraction match.
 * @param {number} wager
 * @param {string[]} abilityTypes - loaded ability types
 * @param {string[]} toolTypes - loaded terraforming tool types
 */
function handleStartExtraction(wager, abilityTypes, toolTypes) {
  extractionPersist = loadExtractionState();

  // Validate wager
  if (wager > extractionPersist.salvage) {
    notify("Wager exceeds your Salvage balance!", "contested");
    return;
  }

  // Validate ability loadout — check inventory counts
  const abilityCounts = {};
  for (const type of abilityTypes) {
    abilityCounts[type] = (abilityCounts[type] || 0) + 1;
    if (getAbilityCount(extractionPersist, type) < abilityCounts[type]) {
      notify(
        `Not enough ${ABILITY_META[type]?.label || type} in inventory!`,
        "contested",
      );
      return;
    }
  }

  // Validate tool loadout
  const toolCounts = {};
  for (const type of toolTypes) {
    toolCounts[type] = (toolCounts[type] || 0) + 1;
    if (getToolCount(extractionPersist, type) < toolCounts[type]) {
      notify(
        `Not enough ${TOOL_META[type]?.label || type} in inventory!`,
        "contested",
      );
      return;
    }
  }

  // Remove items from inventory (consumed on match entry)
  for (const type of abilityTypes) {
    removeAbility(extractionPersist, type);
  }
  for (const type of toolTypes) {
    removeTool(extractionPersist, type);
  }
  saveExtractionState(extractionPersist);

  // Build ability and tool objects for in-match use
  const playerAbilities = abilityTypes.map((type) => ({ type, used: false }));
  const playerTerraformTools = toolTypes.map((type) => ({ type, used: false }));

  // AI loadout — simple: AI gets 1-2 random abilities and 0-1 random tools
  const aiAbilities = generateAiLoadout();
  const aiTerraformTools = generateAiTerraformLoadout();

  startExtractionGame(
    wager,
    playerAbilities,
    aiAbilities,
    playerTerraformTools,
    aiTerraformTools,
  );
}

/**
 * Generate a simple AI ability loadout for Extraction.
 * @returns {object[]}
 */
function generateAiLoadout() {
  const pool = [
    ABILITY.DECOY,
    ABILITY.REINFORCE,
    ABILITY.INTERCEPT,
    ABILITY.ENTRENCH,
  ];
  const count = 1 + Math.floor(Math.random() * 2); // 1-2 abilities
  const abilities = [];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(count, shuffled.length); i++) {
    abilities.push({ type: shuffled[i], used: false });
  }
  return abilities;
}

/**
 * Generate a simple AI terraforming loadout for Extraction.
 * @returns {object[]}
 */
function generateAiTerraformLoadout() {
  if (Math.random() < 0.4) return []; // 40% chance of no tools
  const pool = [TOOL.FORTIFICATION_KIT, TOOL.FOG_MACHINE, TOOL.SALT_THE_EARTH];
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return [{ type: pick, used: false }];
}

/**
 * Start an Extraction mode game.
 * @param {number} wager
 * @param {object[]} playerAbilities
 * @param {object[]} aiAbilities
 * @param {object[]} playerTerraformTools
 * @param {object[]} aiTerraformTools
 */
function startExtractionGame(
  wager,
  playerAbilities,
  aiAbilities,
  playerTerraformTools,
  aiTerraformTools,
) {
  cleanup();

  // Create state
  state = createGameState({
    mode: MODE.EXTRACTION,
    wager,
    playerAbilities,
    aiAbilities,
    playerTerraformTools,
    aiTerraformTools,
  });

  // Generate random map
  const map = generateRandomMap({ assignTerrain: true });
  state.territories = map.territories;
  state.edges = map.edges;
  state._edgeSet = map.edgeSet;

  // Generate 6-card hands for Extraction
  state.playerHand = generateHand("player", MODE.EXTRACTION);
  state.aiHand = generateHand("ai", MODE.EXTRACTION);

  // Track wild card
  state.hasWildCard = state.playerHand.some((c) => c.isWild);

  // Find Observatory
  state.observatoryTerritoryId = findObservatoryId(state.territories);

  // Calculate tectonic shift turn and generate shift data
  const handSize = state.playerHand.length;
  state.tectonicShiftTurn = calculateShiftTurn(
    state.territories.length,
    handSize,
  );
  state.tectonicShiftData = generateShiftData(
    state.territories,
    state.edges,
    state._edgeSet,
  );

  // Wire callbacks
  wireStateCallbacks();

  // Check if terraforming phase is needed
  const hasTerraformTools =
    (playerTerraformTools && playerTerraformTools.length > 0) ||
    (aiTerraformTools && aiTerraformTools.length > 0);

  // Show game screen
  showScreen("#screen-game");
  cancelResize = initCanvas(state);
  cancelInput = setupCanvasInput(state, { onCanvasClick: handleCanvasClick });
  cancelRender = startRenderLoop(state);
  cancelKeyboard = setupKeyboard(state, buildKeyboardHandlers());

  // Initial UI
  logAction(
    state,
    `Extraction match — Wager: ${wager} — 9 territories, 6 cards each`,
    "neutral",
  );
  if (state.hasWildCard) {
    logAction(
      state,
      "You have a WILD card! Play it on any territory.",
      "ability",
    );
  }
  logAction(
    state,
    `Tectonic Shift on Turn ${state.tectonicShiftTurn}`,
    "shift",
  );

  if (hasTerraformTools) {
    startTerraformPhase();
  } else {
    state.phase = PHASE.PLANNING;
    updateUI(state);
  }
}

// ============================================================
// State callbacks
// ============================================================

/**
 * Wire the callback functions onto the state object.
 * These are used by the UI module to communicate user actions back
 * to the game orchestrator without circular imports.
 */
function wireStateCallbacks() {
  state._onSelectCard = handleSelectCard;
  state._onSelectAbility = handleSelectAbility;
  state._onCancelAbility = handleCancelAbility;
}

/**
 * Build the keyboard handler map.
 * @returns {object}
 */
function buildKeyboardHandlers() {
  return {
    onClaim: () => toggleAction("claim"),
    onFortify: () => toggleAction("fortify"),
    onAbility: () => {}, // abilities are now inline buttons; keyboard shortcut is a no-op
    onPass: handlePass,
    onSelectCard: handleSelectCard,
    onCancel: handleCancel,
    onAdvanceResolution: handleAdvanceResolution,
    onAdvanceNetworks: () => {
      const btn = $("#btn-res-network-next");
      if (btn) btn.click();
    },
    onStartGame: handleStartGamePhase,
  };
}

// ============================================================
// Action toggling
// ============================================================

/**
 * Toggle an action mode (claim/fortify/ability).
 * @param {string} action
 */
function toggleAction(action) {
  if (!state || !isPlayerActionTurn(state)) return;

  if (state.selectedAction === action) {
    state.selectedAction = null;
    state.selectedCard = null;
    state.selectedAbility = null;
  } else {
    state.selectedAction = action;
    state.selectedCard = null;
    state.selectedAbility = null;

    if (action === "fortify") {
      // Auto-select first hand card
      const first = getInHandCards(state.playerHand)[0];
      if (first) state.selectedCard = first;
    }
  }

  updateUI(state);
}

// ============================================================
// Player actions
// ============================================================

/**
 * Handle the player selecting a card from their hand.
 * @param {object} card
 */
function handleSelectCard(card) {
  if (!state || !isPlayerActionTurn(state)) return;

  if (state.selectedCard && state.selectedCard.id === card.id) {
    state.selectedCard = null;
    state.selectedAction = null;
  } else {
    state.selectedCard = card;
    state.selectedAction = "fortify";
  }
  updateUI(state);
}

/**
 * Handle the player selecting an ability from the ability panel.
 * @param {number} abilityIndex
 */
function handleSelectAbility(abilityIndex) {
  if (!state || !isPlayerActionTurn(state)) return;

  const ability = state.playerAbilities[abilityIndex];
  if (!ability || ability.used) return;

  state.selectedAbility = { ...ability, index: abilityIndex };
  state.selectedAction = "ability";
  state.abilityTargetStep = 0;
  state.abilityFirstTarget = null;

  const meta = ABILITY_META[ability.type];
  notify(`Select target for ${meta?.label || ability.type}`, "blue");
  updateUI(state);
}

/**
 * Handle canceling ability selection.
 */
function handleCancelAbility() {
  if (!state) return;
  state.selectedAction = null;
  state.selectedAbility = null;
  state.abilityTargetStep = 0;
  state.abilityFirstTarget = null;
  updateUI(state);
}

/**
 * Handle the cancel action (Escape key or deselect).
 */
function handleCancel() {
  if (!state) return;
  state.selectedAction = null;
  state.selectedCard = null;
  state.selectedAbility = null;
  state.abilityTargetStep = 0;
  state.abilityFirstTarget = null;
  updateUI(state);
}

/**
 * Handle clicking the canvas (territory or empty space).
 * Routes to the appropriate action based on current selection state.
 * @param {object|null} territory
 */
function handleCanvasClick(territory) {
  if (!state) return;
  if (!isPlayerActionTurn(state)) return;

  if (!territory) {
    handleCancel();
    return;
  }

  // --- Ability targeting ---
  if (state.selectedAction === "ability" && state.selectedAbility) {
    executeAbilityTarget(territory);
    return;
  }

  // --- Fortify: card selected, click any territory ---
  if (state.selectedAction === "fortify" && state.selectedCard) {
    executeFortify(territory);
    return;
  }

  // --- Claim: click unclaimed territory ---
  if (state.selectedAction === "claim") {
    if (!territory.claimedBy) {
      executeClaim(territory);
    } else {
      notify("Already claimed", "contested");
    }
    return;
  }

  // --- No action selected: auto-claim if unclaimed ---
  if (!territory.claimedBy && hasUnclaimed(state.territories)) {
    executeClaim(territory);
  }
}

/**
 * Execute a claim action on a territory.
 * @param {object} territory
 */
function executeClaim(territory) {
  if (!state || territory.claimedBy) return;

  territory.claimedBy = "player";
  state.selectedAction = null;
  state.selectedCard = null;
  state.consecutivePasses = 0;

  logAction(
    state,
    `You claimed ${territory.name} (${territory.value}pt)`,
    "player",
  );
  notify(`You claimed ${territory.name}`, "blue");

  // Observatory handling
  handleObservatoryClaim(territory, "player");

  // E: Fire tutorial event for player claim
  fireTutorialEvent(state, "player-claimed");

  endTurn();
}

/**
 * Execute a fortify action (play a card on a territory).
 * @param {object} territory
 */
function executeFortify(territory) {
  if (!state || !state.selectedCard) return;

  const card = state.selectedCard;
  if (card.state !== "hand") return;

  // Wild card: assign target territory now
  if (card.isWild && card.playedOnTerritory === null) {
    // Wild cards can go anywhere — no restriction
  }

  const success = playCard(card, territory);
  if (!success) return;

  state.selectedAction = null;
  state.selectedCard = null;
  state.consecutivePasses = 0;

  logAction(
    state,
    `You fortified ${territory.name} (str ${card.strength})`,
    "player",
  );
  notify(`Fortified ${territory.name}`, "blue");

  // E: Fire tutorial event for player fortify
  fireTutorialEvent(state, "player-fortified");

  endTurn();
}

/**
 * Execute the player's pass action.
 */
function handlePass() {
  if (!state || !isPlayerActionTurn(state)) return;

  forfeitHand(state.playerHand);
  state.consecutivePasses++;
  state.selectedAction = null;
  state.selectedCard = null;

  logAction(state, "You passed", "player");
  notify("You passed", "blue");

  endTurn();
}

// ============================================================
// Ability execution
// ============================================================

/**
 * Route ability targeting to the specific ability handler.
 * @param {object} territory - the clicked territory
 */
function executeAbilityTarget(territory) {
  if (!state || !state.selectedAbility) return;

  const ability = state.selectedAbility;
  const meta = ABILITY_META[ability.type];
  if (!meta) return;

  let success = false;

  switch (ability.type) {
    case ABILITY.INTERCEPT:
      success = executeIntercept(territory);
      break;
    case ABILITY.DECOY:
      success = executeDecoy(territory);
      break;
    case ABILITY.REINFORCE:
      success = executeReinforce(territory);
      break;
    case ABILITY.SABOTAGE:
      success = executeSabotage(territory);
      break;
    case ABILITY.ENTRENCH:
      success = executeEntrench(territory);
      break;
    case ABILITY.RECALL:
      success = executeRecall(territory);
      break;
    case ABILITY.REDIRECT:
      success = executeRedirect(territory);
      break;
    case ABILITY.SPLIT:
      // Split targets a hand card, not a territory — handled via card select
      notify("Select a hand card (strength 3+) to split", "blue");
      return;
    default:
      notify("Unknown ability", "contested");
      return;
  }

  if (success) {
    // Mark ability as used
    state.playerAbilities[ability.index].used = true;
    state.selectedAction = null;
    state.selectedAbility = null;
    state.abilityTargetStep = 0;
    state.abilityFirstTarget = null;
    state.consecutivePasses = 0;
    endTurn();
  }
}

function executeIntercept(territory) {
  const aiCards = territory.cardsPlayed.filter(
    (c) => c.owner === "ai" && !c.revealed,
  );
  if (aiCards.length === 0) {
    notify("No hidden AI cards on this territory", "contested");
    return false;
  }
  const card = aiCards[0];
  card.revealed = true;
  logAction(
    state,
    `Intercept: AI card on ${territory.name} is str ${card.strength}`,
    "ability",
  );
  notify(
    `Intercepted: AI strength ${card.strength} on ${territory.name}`,
    "blue",
  );
  // Notify opponent
  logAction(
    state,
    `AI notified: card on ${territory.name} was intercepted`,
    "ai",
  );
  return true;
}

function executeDecoy(territory) {
  createDecoy(territory, "player");
  logAction(state, `Decoy placed on ${territory.name}`, "ability");
  notify(`Decoy placed on ${territory.name}`, "blue");
  return true;
}

function executeReinforce(territory) {
  const myCards = territory.cardsPlayed.filter(
    (c) => c.owner === "player" && c.strength < 5 && !c.isDecoy,
  );
  if (myCards.length === 0) {
    notify("No reinforceable cards here", "contested");
    return false;
  }
  const card = myCards[0];
  reinforceCard(card);
  logAction(
    state,
    `Reinforced card on ${territory.name} to str ${card.strength}`,
    "ability",
  );
  notify(`Reinforced to strength ${card.strength}`, "blue");
  return true;
}

function executeSabotage(territory) {
  const aiCards = territory.cardsPlayed.filter((c) => c.owner === "ai");
  if (aiCards.length === 0) {
    notify("No AI cards on this territory", "contested");
    return false;
  }
  const card = aiCards[0];
  sabotageCard(card, state.territories, state.aiHand);
  logAction(state, `Sabotaged AI card on ${territory.name}!`, "ability");
  notify(`Sabotaged AI card on ${territory.name}!`, "blue");
  logAction(state, `AI card removed from ${territory.name}`, "ai");
  return true;
}

function executeEntrench(territory) {
  if (territory.claimedBy !== "player") {
    notify("You can only entrench your own claimed territories", "contested");
    return false;
  }
  if (territory.entrenched) {
    notify("Already entrenched", "contested");
    return false;
  }
  territory.entrenched = true;
  territory.entrenchBonus = 2;
  logAction(
    state,
    `Entrenched ${territory.name} (+2 defender bonus)`,
    "ability",
  );
  notify(`Entrenched ${territory.name}`, "blue");
  return true;
}

function executeRecall(territory) {
  const myCards = territory.cardsPlayed.filter(
    (c) => c.owner === "player" && !c.isDecoy,
  );
  if (myCards.length === 0) {
    notify("No recallable cards here", "contested");
    return false;
  }
  const card = myCards[0];
  recallCard(card, state.territories);
  logAction(
    state,
    `Recalled card from ${territory.name} (str ${card.strength})`,
    "ability",
  );
  notify(`Card recalled from ${territory.name}`, "blue");
  return true;
}

function executeRedirect(territory) {
  // Multi-step: first click selects the card's territory, second click selects destination
  if (state.abilityTargetStep === 0) {
    // First click: territory with a player card
    const myCards = territory.cardsPlayed.filter(
      (c) => c.owner === "player" && !c.isDecoy && c.strength >= 2,
    );
    if (myCards.length === 0) {
      notify("No redirectable cards here (need str 2+)", "contested");
      return false;
    }
    state.abilityFirstTarget = {
      territoryId: territory.id,
      cardId: myCards[0].id,
    };
    state.abilityTargetStep = 1;
    state.highlightedTerritories = territory.connections;
    notify(`Now click an adjacent territory to redirect to`, "blue");
    updateUI(state);
    return false; // Don't end turn yet
  } else {
    // Second click: adjacent territory
    const firstTarget = state.abilityFirstTarget;
    if (!firstTarget) return false;

    const card =
      state.playerHand.find((c) => c.id === firstTarget.cardId) ||
      state.territories[firstTarget.territoryId].cardsPlayed.find(
        (c) => c.id === firstTarget.cardId,
      );
    if (!card) return false;

    const success = redirectCard(card, state.territories, territory.id);
    if (!success) {
      notify("Invalid redirect target (must be adjacent)", "contested");
      return false;
    }

    state.highlightedTerritories = [];
    logAction(
      state,
      `Redirected card to ${territory.name} (now str ${card.strength})`,
      "ability",
    );
    notify(`Card redirected to ${territory.name}`, "blue");
    return true;
  }
}

/**
 * Handle Split ability via card selection (not territory click).
 * This is called when a hand card is clicked while Split is the active ability.
 * @param {object} card
 * @returns {boolean}
 */
function executeSplitOnCard(card) {
  if (!state || !state.selectedAbility) return false;
  if (state.selectedAbility.type !== ABILITY.SPLIT) return false;

  if (!isSplittable(card)) {
    notify("Can only split cards with strength 3+", "contested");
    return false;
  }

  const result = splitCard(card, state.playerHand, "player");
  if (!result.success) {
    notify("Split failed", "contested");
    return false;
  }

  state.playerAbilities[state.selectedAbility.index].used = true;
  state.selectedAction = null;
  state.selectedAbility = null;
  state.consecutivePasses = 0;

  logAction(
    state,
    `Split card: two str-${result.newCards[0].strength} cards created`,
    "ability",
  );
  notify("Card split into two!", "blue");
  endTurn();
  return true;
}

// ============================================================
// Observatory handling
// ============================================================

/**
 * Handle what happens when a player claims the Observatory territory.
 * @param {object} territory
 * @param {string} claimer - "player" or "ai"
 */
function handleObservatoryClaim(territory, claimer) {
  if (territory.terrain !== TERRAIN.OBSERVATORY) return;
  if (state.observatoryClaimedBy) return; // Already claimed by someone

  state.observatoryClaimedBy = claimer;

  if (state.mode === MODE.EXTRACTION) {
    // Extraction: reveal tectonic shift details
    if (claimer === "player") {
      showObservatoryIntel(state);
      logAction(
        state,
        "Observatory claimed! Tectonic Shift intel received.",
        "ability",
      );
      notify("Observatory: Tectonic Shift intel received!", "blue");
    } else {
      logAction(
        state,
        "AI claimed Observatory — gained Tectonic Shift intel",
        "ai",
      );
      notify("AI gained Tectonic Shift intel!", "amber");
    }
  } else {
    // Ranked: peek at one adjacent opponent card
    if (claimer === "player") {
      showObservatoryPeekModal(state, territory.id, () => {
        updateUI(state);
      });
    } else {
      // AI uses observatory peek
      executeAiObservatoryPeek(territory);
    }
  }
}

/**
 * AI uses the Ranked Observatory peek.
 * @param {object} territory - the Observatory territory
 */
function executeAiObservatoryPeek(territory) {
  const adjacentWithCards = territory.connections.filter((nbId) => {
    const nb = state.territories[nbId];
    return nb.cardsPlayed.some((c) => c.owner === "player" && !c.revealed);
  });

  if (adjacentWithCards.length > 0) {
    const targetId = adjacentWithCards[0];
    const targetTerritory = state.territories[targetId];
    const card = targetTerritory.cardsPlayed.find(
      (c) => c.owner === "player" && !c.revealed,
    );
    if (card) {
      // AI "knows" the card strength internally — mark as revealed for AI's benefit
      // We don't mark card.revealed = true since that's visible to the player;
      // instead, store on state
      if (!state._aiKnownCards) state._aiKnownCards = new Set();
      state._aiKnownCards.add(card.id);
      logAction(
        state,
        "AI used Observatory to scout your card on " + targetTerritory.name,
        "ai",
      );
      notify("AI scouted your card on " + targetTerritory.name + "!", "amber");
    }
  } else {
    // Bank for later — AI doesn't implement this yet, just skip
    logAction(
      state,
      "AI claimed Observatory (no adjacent cards to peek)",
      "ai",
    );
  }
}

// ============================================================
// Turn flow
// ============================================================

/**
 * End the current turn and advance to the next player or phase.
 */
function endTurn(skipTutorial) {
  if (!state) return;

  state.turnNumber++;

  const pCards = countHandCards(state.playerHand);
  const aCards = countHandCards(state.aiHand);
  const unclaimed = hasUnclaimed(state.territories);
  const pCan = unclaimed || pCards > 0;
  const aCan = unclaimed || aCards > 0;

  // Check if game should end
  if ((!pCan && !aCan) || state.consecutivePasses >= 2) {
    startResolution();
    return;
  }

  // Check for tectonic shift (Extraction only)
  if (
    state.mode === MODE.EXTRACTION &&
    !state.tectonicShiftOccurred &&
    state.tectonicShiftData &&
    state.turnNumber >= state.tectonicShiftTurn
  ) {
    executeTectonicShift();
    // After shift, continue turn flow
  }

  // Switch turns
  state.currentTurn = state.currentTurn === "player" ? "ai" : "player";

  // Skip if current player can't act
  if (state.currentTurn === "player" && !pCan) {
    state.currentTurn = "ai";
    if (!aCan) {
      startResolution();
      return;
    }
  } else if (state.currentTurn === "ai" && !aCan) {
    state.currentTurn = "player";
    if (!pCan) {
      startResolution();
      return;
    }
  }

  updateUI(state);
  if (state.currentTurn === "ai") {
    setTimeout(executeAiTurn, getAiTurnDelay());
  } else {
    // E: Fire tutorial event at start of player's turn
    fireTutorialEvent(state, "turn-start");
  }
}

/**
 * Execute the AI's turn.
 */
function executeAiTurn() {
  if (!state || state.phase !== PHASE.ACTION) return;

  const playable = getInHandCards(state.aiHand);
  const unclaimed = hasUnclaimed(state.territories);

  if (!unclaimed && playable.length === 0) {
    state.consecutivePasses++;
    logAction(state, "AI passed", "ai");
    notify("AI passed", "amber");
    endTurn();
    return;
  }

  const decision = aiDecide(state);

  switch (decision.action) {
    case "claim": {
      const t = state.territories[decision.territoryId];
      if (t && !t.claimedBy) {
        t.claimedBy = "ai";
        state.consecutivePasses = 0;
        logAction(state, `AI claimed ${t.name} (${t.value}pt)`, "ai");
        notify(`AI claimed ${t.name}`, "amber");
        handleObservatoryClaim(t, "ai");
      } else {
        // Fallback — claim any unclaimed territory
        const fallback = state.territories.find((t2) => !t2.claimedBy);
        if (fallback) {
          fallback.claimedBy = "ai";
          state.consecutivePasses = 0;
          logAction(state, `AI claimed ${fallback.name}`, "ai");
          notify(`AI claimed ${fallback.name}`, "amber");
          handleObservatoryClaim(fallback, "ai");
        } else {
          state.consecutivePasses++;
        }
      }
      break;
    }

    case "fortify": {
      if (decision.card) {
        const card = decision.card;
        const t = state.territories[decision.territoryId];
        playCard(card, t);
        state.consecutivePasses = 0;

        // Fog: don't reveal placement to player
        if (t.terrain === TERRAIN.FOG) {
          logAction(state, "AI fortified a territory", "ai");
        } else {
          logAction(state, `AI fortified ${t.name}`, "ai");
          notify(`AI fortified ${t.name}`, "amber");
        }

        // E: Track if AI fortified a player-claimed territory (for tutorial)
        state._lastAiFortifyWasOnPlayerTerritory = t.claimedBy === "player";
        fireTutorialEvent(state, "ai-fortified");
      } else {
        state.consecutivePasses++;
      }
      break;
    }

    case "ability": {
      executeAiAbility(decision);
      break;
    }

    default: {
      // Pass
      forfeitHand(state.aiHand);
      state.consecutivePasses++;
      logAction(state, "AI passed", "ai");
      notify("AI passed", "amber");
      break;
    }
  }

  endTurn();
}

/**
 * Execute an AI ability action.
 * @param {object} decision - from aiDecide()
 */
function executeAiAbility(decision) {
  if (!state || !decision.abilityType) return;

  const ability = state.aiAbilities[decision.abilityIndex];
  if (!ability || ability.used) return;

  const meta = ABILITY_META[decision.abilityType];
  const targets = decision.targets || {};

  switch (decision.abilityType) {
    case ABILITY.INTERCEPT: {
      if (targets.cardId) {
        const card = findCardById(targets.cardId);
        if (card) {
          // AI sees the card; mark it as known to AI
          if (!state._aiKnownCards) state._aiKnownCards = new Set();
          state._aiKnownCards.add(card.id);
          logAction(
            state,
            `AI used Intercept on ${state.territories[card.playedOnTerritory]?.name || "a territory"}`,
            "ai",
          );
          notify(`AI intercepted your card!`, "amber");
          // Notify player which card
          const tName =
            card.playedOnTerritory != null
              ? state.territories[card.playedOnTerritory].name
              : "?";
          notify(`AI peeked at your card on ${tName}`, "amber");
        }
      }
      break;
    }

    case ABILITY.DECOY: {
      if (targets.territoryId !== undefined) {
        const t = state.territories[targets.territoryId];
        createDecoy(t, "ai");
        if (t.terrain === TERRAIN.FOG) {
          logAction(state, "AI used an ability", "ai");
        } else {
          logAction(state, `AI placed a card on ${t.name}`, "ai");
        }
      }
      break;
    }

    case ABILITY.REINFORCE: {
      if (targets.cardId) {
        const card = findCardById(targets.cardId);
        if (card) {
          reinforceCard(card);
          logAction(state, "AI used Reinforce", "ai");
        }
      }
      break;
    }

    case ABILITY.SABOTAGE: {
      if (targets.cardId) {
        const card = findCardById(targets.cardId);
        if (card) {
          const tName =
            card.playedOnTerritory != null
              ? state.territories[card.playedOnTerritory].name
              : "?";
          sabotageCard(card, state.territories, state.playerHand);
          logAction(state, `AI sabotaged your card on ${tName}!`, "ai");
          notify(`AI sabotaged your card on ${tName}!`, "amber");
        }
      }
      break;
    }

    case ABILITY.ENTRENCH: {
      if (targets.territoryId !== undefined) {
        const t = state.territories[targets.territoryId];
        if (t.claimedBy === "ai" && !t.entrenched) {
          t.entrenched = true;
          t.entrenchBonus = 2;
          logAction(state, `AI entrenched ${t.name}`, "ai");
          notify(`AI entrenched ${t.name}`, "amber");
        }
      }
      break;
    }

    case ABILITY.RECALL: {
      if (targets.cardId) {
        const card = findCardById(targets.cardId);
        if (card) {
          recallCard(card, state.territories);
          logAction(state, "AI recalled a card", "ai");
        }
      }
      break;
    }

    case ABILITY.REDIRECT: {
      if (targets.cardId && targets.targetTerritoryId !== undefined) {
        const card = findCardById(targets.cardId);
        if (card) {
          redirectCard(card, state.territories, targets.targetTerritoryId);
          logAction(state, "AI redirected a card", "ai");
        }
      }
      break;
    }

    case ABILITY.SPLIT: {
      if (targets.cardId) {
        const card = findCardById(targets.cardId);
        if (card) {
          splitCard(card, state.aiHand, "ai");
          logAction(state, "AI split a card", "ai");
        }
      }
      break;
    }
  }

  ability.used = true;
  state.consecutivePasses = 0;
}

/**
 * Find a card by ID across all hands and territories.
 * @param {string} cardId
 * @returns {object|null}
 */
function findCardById(cardId) {
  // Check player hand
  for (const c of state.playerHand) {
    if (c.id === cardId) return c;
  }
  // Check AI hand
  for (const c of state.aiHand) {
    if (c.id === cardId) return c;
  }
  // Check territories
  for (const t of state.territories) {
    for (const c of t.cardsPlayed) {
      if (c.id === cardId) return c;
    }
  }
  return null;
}

// ============================================================
// Terraforming phase
// ============================================================

/**
 * Start the terraforming phase (Extraction only).
 * Players alternate applying terrain modifications.
 */
function startTerraformPhase() {
  if (!state) return;

  state.phase = PHASE.TERRAFORMING;

  // Determine turn order: player who goes SECOND in action gets to terraform FIRST
  const actionFirst = state.currentTurn; // Who goes first in the action phase
  const terraformFirst = actionFirst === "player" ? "ai" : "player";

  // Build combined tool queue
  const toolQueue = [];

  const firstTools =
    terraformFirst === "player"
      ? state.playerTerraformTools
      : state.aiTerraformTools;
  const secondTools =
    terraformFirst === "player"
      ? state.aiTerraformTools
      : state.playerTerraformTools;
  const firstOwner = terraformFirst;
  const secondOwner = terraformFirst === "player" ? "ai" : "player";

  // Interleave: first player tool 1, second player tool 1, first player tool 2, etc.
  const maxLen = Math.max(firstTools.length, secondTools.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < firstTools.length)
      toolQueue.push({ tool: firstTools[i], owner: firstOwner });
    if (i < secondTools.length)
      toolQueue.push({ tool: secondTools[i], owner: secondOwner });
  }

  state._terraformQueue = toolQueue;
  state._terraformIndex = 0;
  state._terraformHistory = [];

  updateUI(state);
  logAction(
    state,
    "Terraforming Phase — modify the map before the match begins",
    "neutral",
  );

  processTerraformQueue();
}

/**
 * Process the next item in the terraform queue.
 */
function processTerraformQueue() {
  if (!state || !state._terraformQueue) return;

  if (state._terraformIndex >= state._terraformQueue.length) {
    // Terraforming complete — move to planning
    finishTerraforming();
    return;
  }

  const current = state._terraformQueue[state._terraformIndex];

  if (current.owner === "ai") {
    // AI terraforms automatically
    executeAiTerraform(current.tool);
    state._terraformIndex++;
    setTimeout(processTerraformQueue, 600);
  } else {
    // Player terraforms — wait for click
    // For the prototype, we auto-apply using a simple heuristic
    // (full implementation would show a terraform UI)
    notify(
      `Terraforming: ${TOOL_META[current.tool.type]?.label || current.tool.type}. Click a territory.`,
      "blue",
    );

    // For now, auto-apply with AI heuristic for simplicity
    executeAutoTerraform(current.tool, "player");
    state._terraformIndex++;
    setTimeout(processTerraformQueue, 600);
  }
}

/**
 * Execute AI terraforming for a single tool.
 * @param {object} tool
 */
function executeAiTerraform(tool) {
  const decision = aiTerraformDecide(
    tool,
    state.territories,
    state.edges,
    state._edgeSet,
  );
  if (!decision) {
    logAction(state, "AI skipped terraforming (no valid target)", "ai");
    return;
  }

  applyTerraform(
    tool.type,
    state.territories,
    state.edges,
    state._edgeSet,
    decision.targetId,
    decision.targetId2,
  );
  tool.used = true;

  const meta = TOOL_META[tool.type];
  const tName =
    decision.targetId >= 0 ? state.territories[decision.targetId].name : "";
  logAction(state, `AI used ${meta?.label || tool.type} on ${tName}`, "ai");
  notify(`AI terraformed ${tName}`, "amber");

  if (state._terraformHistory) {
    state._terraformHistory.push({
      tool: tool.type,
      player: "ai",
      targetId: decision.targetId,
    });
  }
}

/**
 * Auto-apply a player terraforming tool using AI heuristic.
 * (In a full implementation, this would be replaced by player UI interaction.)
 * @param {object} tool
 * @param {string} owner
 */
function executeAutoTerraform(tool, owner) {
  const decision = aiTerraformDecide(
    tool,
    state.territories,
    state.edges,
    state._edgeSet,
  );
  if (!decision) {
    logAction(state, "No valid terraform target — skipped", owner);
    return;
  }

  applyTerraform(
    tool.type,
    state.territories,
    state.edges,
    state._edgeSet,
    decision.targetId,
    decision.targetId2,
  );
  tool.used = true;

  const meta = TOOL_META[tool.type];
  const tName =
    decision.targetId >= 0 ? state.territories[decision.targetId].name : "";
  logAction(
    state,
    `${meta?.label || tool.type} applied to ${tName}`,
    owner === "player" ? "player" : "ai",
  );
  notify(`Terraformed ${tName}`, "blue");

  if (state._terraformHistory) {
    state._terraformHistory.push({
      tool: tool.type,
      player: owner,
      targetId: decision.targetId,
    });
  }
}

/**
 * Finish the terraforming phase and transition to planning.
 */
function finishTerraforming() {
  if (!state) return;

  // Recalculate Observatory position (may have changed via Watchtower)
  state.observatoryTerritoryId = findObservatoryId(state.territories);

  // Re-generate tectonic shift data in case map changed
  if (state.mode === MODE.EXTRACTION) {
    state._edgeSet = buildEdgeSet(state.edges);
    state.tectonicShiftData = generateShiftData(
      state.territories,
      state.edges,
      state._edgeSet,
    );
  }

  state.phase = PHASE.PLANNING;
  logAction(state, "Terraforming complete. Review your hand.", "neutral");
  updateUI(state);
}

// ============================================================
// Tectonic shift execution
// ============================================================

/**
 * Execute the tectonic shift during the action phase.
 */
function executeTectonicShift() {
  if (!state || !state.tectonicShiftData || state.tectonicShiftOccurred) return;

  // Validate the shift is still safe to apply
  const validation = validateShift(
    state.tectonicShiftData,
    state.territories,
    state.edges,
    state._edgeSet,
  );
  if (!validation.valid) {
    logAction(
      state,
      "Tectonic Shift fizzled — " + (validation.reason || "invalid"),
      "shift",
    );
    state.tectonicShiftOccurred = true;
    return;
  }

  // Apply the shift
  const result = applyShift(
    state.tectonicShiftData,
    state.territories,
    state.edges,
    state._edgeSet,
  );
  state.tectonicShiftOccurred = true;

  // Rebuild edge set
  state._edgeSet = buildEdgeSet(state.edges);

  // Notify
  const summary = getShiftNotificationSummary(result);
  logAction(state, summary, "shift");
  notify(summary, "shift");

  updateUI(state);
}

// ============================================================
// Planning → Action transition
// ============================================================

/**
 * Handle the "Start Match" button click from the planning phase.
 */
function handleStartGamePhase() {
  if (!state || state.phase !== PHASE.PLANNING) return;

  state.phase = PHASE.ACTION;
  updateUI(state);

  // E: Dismiss any planning-phase tutorial steps and fire game-start
  if (isTutorialActive()) {
    dismissCurrentStep();
  }

  if (state.currentTurn === "ai") {
    notify("AI goes first", "amber");
    setTimeout(executeAiTurn, getAiTurnDelay());
  } else {
    notify("You go first — claim a territory!", "blue");
    // E: Fire tutorial event for the player's first turn
    fireTutorialEvent(state, "turn-start");
  }
}

// ============================================================
// Resolution
// ============================================================

/**
 * Start the resolution phase.
 */
function startResolution() {
  if (!state) return;

  state.phase = PHASE.RESOLUTION;
  state.currentTurn = null;

  // E: Fire tutorial event for resolution start
  fireTutorialEvent(state, "resolution-start");

  // Determine resolution order (lowest value first)
  const order = getResolutionOrder(state.territories);
  state.resolutionOrder = order;
  state.resolutionIndex = 0;
  state.resolutionFocusTerritory = null;
  state.resolutionResolvedIds = new Set();
  state.resolutionRunningPlayer = 0;
  state.resolutionRunningAI = 0;
  state.resolutionHighlightChain = [];

  // Resolve all territories (compute influence + owners)
  resolveAllTerritories(state.territories);
  state.breakdown = calculateScores(state.territories);
  state.scores = { player: state.breakdown.player, ai: state.breakdown.ai };

  // Hide action panels
  const actionPanel = $("#action-panel");
  const planningPanel = $("#planning-panel");
  if (actionPanel) actionPanel.style.display = "none";
  if (planningPanel) planningPanel.style.display = "none";

  // Show tally
  const tally = $("#resolution-tally");
  if (tally) {
    tally.classList.remove("hidden");
    const pPtsEl = $("#res-tally-player-pts");
    const aPtsEl = $("#res-tally-ai-pts");
    const subEl = $("#res-tally-sub");
    if (pPtsEl) pPtsEl.textContent = "0";
    if (aPtsEl) aPtsEl.textContent = "0";
    if (subEl)
      subEl.textContent = "Territories scored: 0 / " + state.territories.length;
  }

  // Phase indicator
  const phaseEl = $("#phase-indicator");
  if (phaseEl) {
    phaseEl.textContent = "RESOLUTION";
    phaseEl.className = "phase-indicator resolution-phase";
  }

  updateUI(state);

  // Start stepping through territories
  setTimeout(() => showNextResolutionStep(), 600);
}

/**
 * Show the next territory in the resolution sequence.
 */
function showNextResolutionStep() {
  if (!state || state.phase !== PHASE.RESOLUTION) return;

  if (state.resolutionIndex >= state.resolutionOrder.length) {
    // Done with territories — move to network phase
    state.resolutionFocusTerritory = null;
    setTimeout(() => enterNetworkPhase(), 400);
    return;
  }

  const t = state.resolutionOrder[state.resolutionIndex];
  state.resolutionFocusTerritory = t.id;

  const isLast = state.resolutionIndex >= state.resolutionOrder.length - 1;

  showResolutionDetail(
    state,
    t,
    () => {
      handleAdvanceResolution();
    },
    isLast,
  );
}

/**
 * Advance to the next territory in resolution.
 */
function handleAdvanceResolution() {
  if (!state || state.phase !== PHASE.RESOLUTION) return;

  const t = state.resolutionOrder[state.resolutionIndex];

  // Mark as resolved
  state.resolutionResolvedIds.add(t.id);

  // Update running score
  const annexed = t.owner && t.claimedBy && t.claimedBy !== t.owner;
  const scorched = t.terrain === TERRAIN.SCORCHED_EARTH && annexed;

  // E: Fire tutorial event if an annexation occurred
  if (annexed) {
    fireTutorialEvent(state, "annexation-occurred");
  }

  if (t.owner === "player" && !scorched) {
    state.resolutionRunningPlayer += t.value;
  } else if (t.owner === "player" && scorched) {
    // Scorched earth annexed — 0 points
  }
  if (t.owner === "ai" && !scorched) {
    state.resolutionRunningAI += t.value;
  }

  updateResolutionTally(state, state.resolutionResolvedIds.size);

  // Move to next
  state.resolutionIndex++;
  state.resolutionFocusTerritory = null;

  setTimeout(() => showNextResolutionStep(), RESOLUTION_STEP_DELAY);
}

/**
 * Enter the network bonus phase.
 */
function enterNetworkPhase() {
  if (!state) return;

  state.phase = PHASE.RESOLUTION_NETWORKS;
  state.resolutionFocusTerritory = null;

  // E: Fire tutorial event for network phase
  fireTutorialEvent(state, "network-phase");

  showNetworkPhase(state, () => {
    enterGameOver();
  });
}

/**
 * Enter the game over state.
 */
function enterGameOver() {
  if (!state) return;

  state.phase = PHASE.GAMEOVER;
  state.resolutionFocusTerritory = null;
  state.resolutionHighlightChain = [];

  // E: Fire tutorial event for game over
  fireTutorialEvent(state, "game-over");

  // Calculate Extraction outcome if applicable
  if (state.mode === MODE.EXTRACTION) {
    const outcome = calculateExtractionOutcome(
      state.breakdown,
      state.wager,
      state.breakdown.winner,
    );
    state._extractionOutcome = outcome;

    // Apply to persistent state
    extractionPersist = loadExtractionState();
    extractionPersist.salvage += outcome.netSalvage;
    extractionPersist.stats.matchesPlayed++;

    if (state.breakdown.winner === "player") {
      extractionPersist.stats.matchesWon++;
      extractionPersist.stats.currentStreak++;
      extractionPersist.stats.bestStreak = Math.max(
        extractionPersist.stats.bestStreak,
        extractionPersist.stats.currentStreak,
      );
      if (outcome.netSalvage > 0) {
        extractionPersist.stats.totalSalvageEarned += outcome.netSalvage;
      }
    } else if (state.breakdown.winner === "ai") {
      extractionPersist.stats.currentStreak = 0;
      if (outcome.netSalvage < 0) {
        extractionPersist.stats.totalSalvageLost += Math.abs(
          outcome.netSalvage,
        );
      }
      // Abilities brought into the match are already consumed from inventory
      // No additional penalty needed — they were removed at match start
    }

    applyReliefIfNeeded(extractionPersist);
    saveExtractionState(extractionPersist);
  }

  showGameOver(state, handlePlayAgain, handleMainMenu);
}

// ============================================================
// Post-game actions
// ============================================================

/**
 * Handle "Play Again" button.
 */
function handlePlayAgain() {
  cleanup();
  resetResolutionUI();

  if (state && state.mode === MODE.EXTRACTION) {
    // Return to extraction lobby
    extractionPersist = loadExtractionState();
    showScreen("#screen-extraction-lobby");
    // Re-render lobby if visible
    _rerenderLobby();
  } else if (state && state.mode === MODE.RANKED) {
    // Show map select again
    showScreen("#screen-map-select");
    renderMapSelect(onMapSelected);
  } else {
    showScreen("#screen-title");
  }
}

/**
 * Handle "Main Menu" button.
 */
function handleMainMenu() {
  cleanup();
  resetResolutionUI();
  showScreen("#screen-title");
}

// ============================================================
// Cleanup
// ============================================================

/**
 * Clean up all active game resources (render loop, input handlers, etc.)
 */
function cleanup() {
  // E: Stop tutorial on cleanup
  if (isTutorialActive()) {
    stopTutorial();
  }
  if (cancelRender) {
    cancelRender();
    cancelRender = null;
  }
  if (cancelInput) {
    cancelInput();
    cancelInput = null;
  }
  if (cancelKeyboard) {
    cancelKeyboard();
    cancelKeyboard = null;
  }
  if (cancelResize) {
    cancelResize();
    cancelResize = null;
  }
  if (state && state.animFrame) {
    cancelAnimationFrame(state.animFrame);
  }
}

// ============================================================
// Planning phase + game screen button wiring
// ============================================================

/**
 * Wire up all static buttons inside #screen-game.
 * Called once from init() after the DOM is ready.
 */
function wireGameButtons() {
  // Start game button (planning phase)
  const btnStart = $("#btn-start-game");
  if (btnStart) {
    btnStart.addEventListener("click", handleStartGamePhase);
  }

  // Action buttons
  const btnClaim = $("#btn-claim");
  const btnFortify = $("#btn-fortify");
  const btnPass = $("#btn-pass");

  if (btnClaim) {
    btnClaim.addEventListener("click", () => toggleAction("claim"));
  }
  if (btnFortify) {
    btnFortify.addEventListener("click", () => toggleAction("fortify"));
  }
  if (btnPass) {
    btnPass.addEventListener("click", handlePass);
  }
  // Ability buttons are inline in #ability-buttons and self-wired by updateActionButtons()

  // Observatory intel toggle
  const btnIntel = $("#btn-observatory-intel");
  if (btnIntel) {
    btnIntel.addEventListener("click", () => {
      if (state) showObservatoryIntel(state);
    });
  }

  // Observatory intel close
  const btnIntelClose = $("#btn-observatory-intel-close");
  if (btnIntelClose) {
    btnIntelClose.addEventListener("click", () => {
      const overlay = $("#observatory-intel-overlay");
      if (overlay) overlay.classList.add("hidden");
    });
  }
}
