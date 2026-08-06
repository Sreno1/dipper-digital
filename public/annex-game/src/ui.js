// ============================================================
// ANNEX — ui.js
// DOM manipulation, screen management, notifications,
// hand rendering, resolution UI, extraction lobby UI,
// and all UI update logic
// ============================================================

import {
  PHASE,
  MODE,
  TERRAIN,
  TERRAIN_META,
  ABILITY_META,
  TOOL_META,
  WAGER_TIERS,
  MIN_WAGER,
  MAP_PRESETS,
  MAX_ABILITIES_PER_LOADOUT,
  MAX_TOOLS_PER_LOADOUT,
  VERSION,
} from "./constants.js";
import { $, $$ } from "./utils.js";
import {
  isResolutionPhase,
  isPlayerActionTurn,
  getHandCards,
  hasUnclaimed,
  isContested,
  loadExtractionState,
  saveExtractionState,
  getAbilityCount,
  getToolCount,
} from "./state.js";
import { getInHandCards, countHandCards, getVisibleCards } from "./cards.js";
import { getInfluenceBreakdown, buildReplaySummary } from "./resolution.js";
import { getShiftWarningState, getShiftIntelSummary } from "./tectonic.js";
import { buildTooltipData, toScreen, getTerritoryAt } from "./renderer.js";
import { formatNumber } from "./utils.js";

// --------------------------------------------------------
// Screen management
// --------------------------------------------------------

/**
 * Show a screen by id selector, hiding all other screens.
 * @param {string} id - e.g. "#screen-title"
 */
export function showScreen(id) {
  $$(".screen").forEach((s) => s.classList.remove("active"));
  const el = $(id);
  if (el) el.classList.add("active");
}

/**
 * Show an overlay screen (additive, doesn't hide others).
 * @param {string} id
 */
export function showOverlay(id) {
  const el = $(id);
  if (el) el.classList.add("active");
}

/**
 * Hide an overlay screen.
 * @param {string} id
 */
export function hideOverlay(id) {
  const el = $(id);
  if (el) el.classList.remove("active");
}

// --------------------------------------------------------
// Notifications
// --------------------------------------------------------

/**
 * Show a toast notification at the top of the screen.
 * @param {string} text
 * @param {string} [type] - "blue", "amber", "contested", "salvage", "shift"
 */
export function notify(text, type) {
  const area = $("#notification-area");
  if (!area) return;
  const el = document.createElement("div");
  el.className = "notification " + (type || "");
  el.textContent = text;
  area.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// --------------------------------------------------------
// Action log
// --------------------------------------------------------

/**
 * Add an entry to the action log.
 * @param {object} state - game state (mutated: actionLog)
 * @param {string} text
 * @param {string} [type] - "player", "ai", "neutral", "shift", "ability"
 */
export function logAction(state, text, type) {
  if (!state) return;
  state.actionLog.push({
    text,
    type: type || "neutral",
    turn: state.turnNumber,
  });
  renderActionLog(state);
}

/**
 * Render the action log DOM element from state.
 * @param {object} state
 */
export function renderActionLog(state) {
  const container = $("#action-log-entries");
  if (!container) return;
  container.innerHTML = "";
  const recent = state.actionLog.slice(-10);
  for (const entry of recent) {
    const el = document.createElement("div");
    el.className = "log-entry log-" + (entry.type || "neutral");
    el.textContent = entry.text;
    container.appendChild(el);
  }
  container.scrollTop = container.scrollHeight;
}

// --------------------------------------------------------
// Main UI update
// --------------------------------------------------------

/**
 * Update all UI elements to reflect the current game state.
 * Called after every state change (turn, phase change, etc.)
 * @param {object} state
 */
export function updateUI(state) {
  if (!state) return;

  const inRes = isResolutionPhase(state);

  updateTopBar(state, inRes);
  updateActionButtons(state, inRes);
  updatePanelVisibility(state, inRes);
  updateInfoPanel(state);
  updateTectonicWarning(state);

  if (!inRes) {
    renderHand(state);
  }

  // Extraction: update salvage display
  if (state.mode === MODE.EXTRACTION) {
    updateSalvageDisplay(state);
  }
}

// --------------------------------------------------------
// Top bar
// --------------------------------------------------------

function updateTopBar(state, inRes) {
  // Turn indicator
  const turnEl = $("#turn-indicator");
  if (turnEl) {
    if (state.phase === PHASE.ACTION) {
      if (state.currentTurn === "player") {
        turnEl.textContent = "\u2B24 Your Turn";
        turnEl.className = "turn-indicator your-turn";
      } else {
        turnEl.textContent = "\u25CB AI Thinking...";
        turnEl.className = "turn-indicator ai-turn";
      }
    } else if (state.phase === PHASE.PLANNING) {
      turnEl.textContent = "Review your hand";
      turnEl.className = "turn-indicator";
    } else if (state.phase === PHASE.TERRAFORMING) {
      turnEl.textContent = "\uD83C\uDF0D Terraforming Phase";
      turnEl.className = "turn-indicator";
    } else if (state.phase === PHASE.TECTONIC_SHIFT) {
      turnEl.textContent = "\u26A1 Tectonic Shift!";
      turnEl.className = "turn-indicator shift-active";
    } else {
      turnEl.textContent = "";
      turnEl.className = "turn-indicator";
    }
  }

  // C: Cards remaining with pressure indicator
  const pCards = countHandCards(state.playerHand);
  const aCards = countHandCards(state.aiHand);
  const pEl = $("#player-cards-remaining");
  const aEl = $("#ai-cards-remaining");
  if (pEl) {
    pEl.textContent = pCards + " card" + (pCards !== 1 ? "s" : "");
    pEl.classList.remove("pressure-low", "pressure-critical");
    if (state.phase === PHASE.ACTION) {
      if (pCards <= 1) pEl.classList.add("pressure-critical");
      else if (pCards <= 2) pEl.classList.add("pressure-low");
    }
  }
  if (aEl) {
    aEl.textContent = aCards + " card" + (aCards !== 1 ? "s" : "");
    aEl.classList.remove("pressure-low", "pressure-critical");
    if (state.phase === PHASE.ACTION) {
      if (aCards <= 1) aEl.classList.add("pressure-critical");
      else if (aCards <= 2) aEl.classList.add("pressure-low");
    }
  }

  // Phase indicator
  const phaseEl = $("#phase-indicator");
  if (phaseEl) {
    if (state.phase === PHASE.PLANNING) {
      phaseEl.textContent = "PLANNING";
      phaseEl.className = "phase-indicator";
    } else if (state.phase === PHASE.TERRAFORMING) {
      phaseEl.textContent = "TERRAFORMING";
      phaseEl.className = "phase-indicator";
    } else if (state.phase === PHASE.ACTION) {
      let turnText = "TURN " + state.turnNumber;
      // Show tectonic shift turn in extraction mode
      if (
        state.mode === MODE.EXTRACTION &&
        state.tectonicShiftTurn &&
        !state.tectonicShiftOccurred
      ) {
        turnText += " / \u26A1" + state.tectonicShiftTurn;
      }
      phaseEl.textContent = turnText;
      phaseEl.className = "phase-indicator";
    } else if (state.phase === PHASE.TECTONIC_SHIFT) {
      phaseEl.textContent = "\u26A1 TECTONIC SHIFT";
      phaseEl.className = "phase-indicator resolution-phase";
    } else if (
      state.phase === PHASE.RESOLUTION ||
      state.phase === PHASE.RESOLUTION_NETWORKS
    ) {
      phaseEl.textContent = "RESOLUTION";
      phaseEl.className = "phase-indicator resolution-phase";
    } else if (state.phase === PHASE.GAMEOVER) {
      phaseEl.textContent = "GAME OVER";
      phaseEl.className = "phase-indicator resolution-phase";
    }
  }
}

// --------------------------------------------------------
// Action buttons
// --------------------------------------------------------

function updateActionButtons(state, inRes) {
  const isPlayerTurn = isPlayerActionTurn(state);
  const unclaimedExist = hasUnclaimed(state.territories);
  const hasCards = getInHandCards(state.playerHand).length > 0;

  const btnClaim = $("#btn-claim");
  const btnFortify = $("#btn-fortify");
  const btnPass = $("#btn-pass");

  if (btnClaim) {
    btnClaim.disabled = !(isPlayerTurn && unclaimedExist);
    btnClaim.classList.toggle(
      "active-action",
      state.selectedAction === "claim",
    );
  }
  if (btnFortify) {
    btnFortify.disabled = !(isPlayerTurn && hasCards);
    btnFortify.classList.toggle(
      "active-action",
      state.selectedAction === "fortify",
    );
  }
  if (btnPass) {
    btnPass.disabled = !(isPlayerTurn && !unclaimedExist);
  }

  // Inline ability buttons — always rebuild so closures always reference the
  // current state object (avoids stale-closure bugs across game resets).
  const abilityContainer = $("#ability-buttons");
  if (abilityContainer) {
    const abilities =
      state.mode === MODE.EXTRACTION && state.playerAbilities
        ? state.playerAbilities
        : [];

    abilityContainer.innerHTML = "";

    abilities.forEach((ability, index) => {
      const meta = ABILITY_META[ability.type];
      if (!meta) return;
      const btn = document.createElement("button");
      btn.className = "btn btn-action btn-ability-inline";
      if (ability.used) btn.classList.add("used");
      btn.dataset.abilityIndex = index;
      btn.disabled = !(isPlayerTurn && !ability.used);
      btn.classList.toggle(
        "active-action",
        state.selectedAction === "ability" &&
          state.selectedAbility &&
          state.selectedAbility === ability,
      );
      btn.innerHTML = `
        <span class="action-icon">${meta.icon}</span>
        <span class="action-label">${meta.label}</span>
      `;
      btn.addEventListener("click", () => {
        if (state._onSelectAbility) state._onSelectAbility(index);
      });
      abilityContainer.appendChild(btn);
    });
  }
}

// --------------------------------------------------------
// Panel visibility
// --------------------------------------------------------

function updatePanelVisibility(state, inRes) {
  const planningPanel = $("#planning-panel");
  const actionPanel = $("#action-panel");
  const terraformPanel = $("#terraform-panel");

  if (planningPanel) {
    planningPanel.style.display =
      state.phase === PHASE.PLANNING ? "flex" : "none";
  }
  if (actionPanel) {
    actionPanel.style.display = state.phase === PHASE.ACTION ? "flex" : "none";
  }
  if (terraformPanel) {
    terraformPanel.style.display =
      state.phase === PHASE.TERRAFORMING ? "flex" : "none";
  }
}

// --------------------------------------------------------
// Info panel (sidebar)
// --------------------------------------------------------

function updateInfoPanel(state) {
  const infoEl = $("#info-summary");
  if (!infoEl) return;

  const pClaimed = state.territories.filter(
    (t) => t.claimedBy === "player",
  ).length;
  const aClaimed = state.territories.filter((t) => t.claimedBy === "ai").length;
  const unclaimed = state.territories.length - pClaimed - aClaimed;
  const pCards = countHandCards(state.playerHand);
  const aCards = countHandCards(state.aiHand);

  let contested = 0;
  for (const t of state.territories) {
    if (isContested(t)) contested++;
  }

  // Count terrain types on the map
  const terrainCounts = {};
  for (const t of state.territories) {
    if (t.terrain !== TERRAIN.PLAINS) {
      terrainCounts[t.terrain] = (terrainCounts[t.terrain] || 0) + 1;
    }
  }

  let terrainLine = "";
  if (Object.keys(terrainCounts).length > 0) {
    const parts = Object.entries(terrainCounts).map(([terrain, count]) => {
      const meta = TERRAIN_META[terrain];
      return `${meta ? meta.icon : ""}${count}`;
    });
    terrainLine = `<div class="info-row"><span class="info-label">Terrain</span><span class="info-vals">${parts.join(" ")}</span></div>`;
  }

  infoEl.innerHTML = `
    <div class="info-row"><span class="info-label">Territories</span><span class="info-vals"><span class="info-blue">${pClaimed}</span> / <span class="info-amber">${aClaimed}</span> / <span class="info-muted">${unclaimed} open</span></span></div>
    <div class="info-row"><span class="info-label">Cards Left</span><span class="info-vals"><span class="info-blue">${pCards}</span> / <span class="info-amber">${aCards}</span></span></div>
    ${contested > 0 ? `<div class="info-row"><span class="info-label">Contested</span><span class="info-vals"><span class="info-contested">${contested} territor${contested > 1 ? "ies" : "y"}</span></span></div>` : ""}
    ${terrainLine}
  `;
}

// --------------------------------------------------------
// Hand rendering
// --------------------------------------------------------

/**
 * Render the player's hand of cards into the hand container.
 * @param {object} state
 */
export function renderHand(state) {
  const container = $("#hand-cards");
  if (!container) return;
  container.innerHTML = "";

  for (const card of state.playerHand) {
    // Skip forfeited/consumed cards from split
    if (
      card.state === "forfeited" &&
      !card.playedOnTerritory &&
      card.id.includes("_split")
    )
      continue;

    const el = document.createElement("div");
    el.className = "card strength-" + card.strength;
    if (card.state !== "hand") el.classList.add("played");
    if (card.isWild && card.state === "hand") el.classList.add("wild");
    if (card.isDecoy) el.classList.add("decoy");
    if (state.selectedCard && state.selectedCard.id === card.id)
      el.classList.add("selected");

    const dots =
      "\u25CF".repeat(card.strength) +
      "\u25CB".repeat(Math.max(0, 4 - card.strength));

    if (card.state === "hand") {
      const wildLabel = card.isWild
        ? '<div class="card-wild-label">WILD</div>'
        : "";
      el.innerHTML = `
        ${wildLabel}
        <div class="card-strength-pips">${dots}</div>
        <div class="card-strength-num">${card.strength}</div>
        <div class="card-strength-label">INFLUENCE</div>
      `;
      el.addEventListener("click", () => {
        if (!isPlayerActionTurn(state)) return;
        if (state._onSelectCard) state._onSelectCard(card);
      });
    } else {
      const tName =
        card.playedOnTerritory != null
          ? state.territories[card.playedOnTerritory].name
          : "?";
      el.innerHTML = `
        <div class="card-played-label">${card.isDecoy ? "DECOY" : "PLAYED"}</div>
        <div class="card-played-target">${tName}</div>
        <div class="card-strength-num played-num">${card.isDecoy ? "0" : card.strength}</div>
      `;
    }
    container.appendChild(el);
  }
}

// --------------------------------------------------------
// Ability panel rendering
// --------------------------------------------------------

/**
 * Render the ability selection panel for Extraction mode.
 * @param {object} state
 */
export function renderAbilityPanel(state) {
  const container = $("#ability-cards");
  if (!container) return;
  container.innerHTML = "";

  if (!state.playerAbilities) return;

  for (let i = 0; i < state.playerAbilities.length; i++) {
    const ability = state.playerAbilities[i];
    const meta = ABILITY_META[ability.type];
    if (!meta) continue;

    const el = document.createElement("div");
    el.className = "ability-card" + (ability.used ? " used" : "");
    el.innerHTML = `
      <div class="ability-icon">${meta.icon}</div>
      <div class="ability-name">${meta.label}</div>
      <div class="ability-desc">${meta.description}</div>
      ${ability.used ? '<div class="ability-used-label">USED</div>' : '<div class="ability-use-btn">Use</div>'}
    `;

    if (!ability.used) {
      el.addEventListener("click", () => {
        if (!isPlayerActionTurn(state)) return;
        if (state._onSelectAbility) state._onSelectAbility(i);
      });
    }

    container.appendChild(el);
  }

  // Cancel button
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-secondary ability-cancel-btn";
  cancelBtn.textContent = "\u2190 Back to actions";
  cancelBtn.addEventListener("click", () => {
    if (state._onCancelAbility) state._onCancelAbility();
  });
  container.appendChild(cancelBtn);
}

// --------------------------------------------------------
// Resolution UI
// --------------------------------------------------------

/**
 * Show the resolution territory detail panel for the current step.
 * @param {object} state
 * @param {object} territory
 * @param {function} onNext - callback when "Next" is clicked
 * @param {boolean} isLast - true if this is the last territory
 */
export function showResolutionDetail(state, territory, onNext, isLast) {
  const panel = $("#res-detail-panel");
  if (!panel) return;
  panel.classList.remove("hidden");

  const t = territory;

  // Header
  const nameEl = $("#res-detail-name");
  const valueEl = $("#res-detail-value");
  if (nameEl) nameEl.textContent = t.name;
  if (valueEl) {
    let valueText = t.value + " pt" + (t.value !== 1 ? "s" : "");
    if (t.terrain !== TERRAIN.PLAINS) {
      const meta = TERRAIN_META[t.terrain];
      valueText += " \u00B7 " + (meta ? meta.label : "");
    }
    valueEl.textContent = valueText;
  }

  // Build influence components
  const breakdown = getInfluenceBreakdown(t);

  const pCompEl = $("#res-detail-player-components");
  const aCompEl = $("#res-detail-ai-components");

  if (pCompEl) {
    if (breakdown.player.length > 0) {
      pCompEl.innerHTML = breakdown.player
        .map(
          (comp) =>
            `<span class="res-comp-tag tag-${comp.type}">${comp.label} +${comp.value}</span>`,
        )
        .join("");
    } else {
      pCompEl.innerHTML = '<span style="color:var(--text-muted)">\u2014</span>';
    }
  }

  if (aCompEl) {
    if (breakdown.ai.length > 0) {
      aCompEl.innerHTML = breakdown.ai
        .map(
          (comp) =>
            `<span class="res-comp-tag tag-${comp.type}">${comp.label} +${comp.value}</span>`,
        )
        .join("");
    } else {
      aCompEl.innerHTML = '<span style="color:var(--text-muted)">\u2014</span>';
    }
  }

  // Reset bars
  const pBar = $("#res-detail-player-bar");
  const aBar = $("#res-detail-ai-bar");
  const pTotal = $("#res-detail-player-total");
  const aTotal = $("#res-detail-ai-total");
  const resResult = $("#res-detail-result");

  if (pBar) pBar.style.width = "0%";
  if (aBar) aBar.style.width = "0%";
  if (pTotal) pTotal.textContent = "0";
  if (aTotal) aTotal.textContent = "0";
  if (resResult) {
    resResult.textContent = "";
    resResult.className = "res-detail-result";
  }

  // Animate bars
  const maxInf = Math.max(t.playerInfluence, t.aiInfluence, 1);
  setTimeout(() => {
    if (pBar) pBar.style.width = (t.playerInfluence / (maxInf + 1)) * 100 + "%";
    if (aBar) aBar.style.width = (t.aiInfluence / (maxInf + 1)) * 100 + "%";
    if (pTotal) pTotal.textContent = t.playerInfluence;
    if (aTotal) aTotal.textContent = t.aiInfluence;
  }, 200);

  // Show result after bars animate
  setTimeout(() => {
    if (!resResult) return;
    const annexed = t.owner && t.claimedBy && t.claimedBy !== t.owner;
    const scorched = t.terrain === TERRAIN.SCORCHED_EARTH && annexed;

    if (t.owner === "player") {
      if (annexed && scorched) {
        resResult.textContent = "\u26A1 ANNEXED \u2014 Scorched Earth! 0 pts";
      } else if (annexed) {
        resResult.textContent =
          "\u26A1 ANNEXED \u2014 You seized it! (+" + t.value + "pt)";
      } else {
        resResult.textContent = "You hold this territory (+" + t.value + "pt)";
      }
      resResult.className =
        "res-detail-result player-wins" + (annexed ? " annexation" : "");
    } else if (t.owner === "ai") {
      if (annexed && scorched) {
        resResult.textContent = "\u26A1 ANNEXED \u2014 Scorched Earth! 0 pts";
      } else if (annexed) {
        resResult.textContent =
          "\u26A1 ANNEXED \u2014 AI seized it! (+" + t.value + "pt)";
      } else {
        resResult.textContent = "AI holds this territory (+" + t.value + "pt)";
      }
      resResult.className =
        "res-detail-result ai-wins" + (annexed ? " annexation" : "");
    } else {
      resResult.textContent = "Neutral \u2014 no points";
      resResult.className = "res-detail-result neutral-result";
    }
  }, 650);

  // Button
  const btn = $("#btn-res-next");
  if (btn) {
    btn.innerHTML = isLast ? "Network Bonuses &rarr;" : "Next Territory &rarr;";
    // Replace onclick to avoid stacking listeners
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener("click", onNext);
  }
}

/**
 * Update the resolution score tally bar.
 * @param {object} state
 * @param {number} done - territories resolved so far
 */
export function updateResolutionTally(state, done) {
  const tally = $("#resolution-tally");
  if (tally) tally.classList.remove("hidden");

  const pPtsEl = $("#res-tally-player-pts");
  const aPtsEl = $("#res-tally-ai-pts");
  const subEl = $("#res-tally-sub");

  if (pPtsEl) {
    pPtsEl.textContent = state.resolutionRunningPlayer;
    pPtsEl.classList.remove("pts-bump");
    void pPtsEl.offsetWidth;
    pPtsEl.classList.add("pts-bump");
  }
  if (aPtsEl) {
    aPtsEl.textContent = state.resolutionRunningAI;
    aPtsEl.classList.remove("pts-bump");
    void aPtsEl.offsetWidth;
    aPtsEl.classList.add("pts-bump");
  }
  if (subEl) {
    subEl.textContent =
      "Territories scored: " + done + " / " + state.territories.length;
  }
}

/**
 * Show the network bonus phase panel.
 * @param {object} state
 * @param {function} onNext
 */
export function showNetworkPhase(state, onNext) {
  // Hide territory detail
  const detailPanel = $("#res-detail-panel");
  if (detailPanel) detailPanel.classList.add("hidden");

  const b = state.breakdown;
  if (!b) return;

  const allNetworks = [];
  for (const net of b.playerNetworks) {
    allNetworks.push({ owner: "player", ...net });
  }
  for (const net of b.aiNetworks) {
    allNetworks.push({ owner: "ai", ...net });
  }

  const listEl = $("#res-network-list");
  if (listEl) {
    listEl.innerHTML = "";
    if (allNetworks.length === 0) {
      listEl.innerHTML =
        '<div class="res-network-none">No networks of 3+ territories formed</div>';
    } else {
      for (const net of allNetworks) {
        const names = net.chain.map((id) => state.territories[id].name);
        const ownerLabel = net.owner === "player" ? "YOU" : "AI";
        const el = document.createElement("div");
        el.className =
          "res-network-item " +
          (net.owner === "player" ? "player-net" : "ai-net");

        let chainDesc =
          names.join(" \u2192 ") + " (" + net.chain.length + "-chain";
        if (net.effectiveLength > net.chain.length) {
          chainDesc += ", effective " + net.effectiveLength;
        }
        chainDesc += ")";

        el.innerHTML =
          '<span class="res-network-chain">' +
          ownerLabel +
          ": " +
          chainDesc +
          "</span>" +
          '<span class="res-network-bonus">+' +
          net.bonus +
          "</span>";
        listEl.appendChild(el);

        el.addEventListener("mouseenter", () => {
          state.resolutionHighlightChain = net.chain;
        });
        el.addEventListener("mouseleave", () => {
          state.resolutionHighlightChain = [];
        });
      }
    }
  }

  // Highlight all chains
  const allChainIds = [];
  for (const net of allNetworks) allChainIds.push(...net.chain);
  state.resolutionHighlightChain = allChainIds;

  // Update tally with network bonuses
  const finalPlayer = state.resolutionRunningPlayer + b.playerNetworkPts;
  const finalAI = state.resolutionRunningAI + b.aiNetworkPts;

  setTimeout(() => {
    const pPtsEl = $("#res-tally-player-pts");
    const aPtsEl = $("#res-tally-ai-pts");
    const subEl = $("#res-tally-sub");

    if (b.playerNetworkPts > 0 && pPtsEl) {
      pPtsEl.textContent = finalPlayer;
      pPtsEl.classList.remove("pts-bump");
      void pPtsEl.offsetWidth;
      pPtsEl.classList.add("pts-bump");
    }
    if (b.aiNetworkPts > 0 && aPtsEl) {
      aPtsEl.textContent = finalAI;
      aPtsEl.classList.remove("pts-bump");
      void aPtsEl.offsetWidth;
      aPtsEl.classList.add("pts-bump");
    }
    if (subEl) {
      subEl.textContent =
        b.playerNetworkPts > 0 || b.aiNetworkPts > 0
          ? "Network bonuses applied"
          : "No network bonuses";
    }

    state.resolutionRunningPlayer = finalPlayer;
    state.resolutionRunningAI = finalAI;
  }, 400);

  // Show network panel
  const netPanel = $("#res-network-panel");
  if (netPanel) netPanel.classList.remove("hidden");

  // Wire button
  const btn = $("#btn-res-network-next");
  if (btn) {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener("click", () => {
      state.resolutionHighlightChain = [];
      if (netPanel) netPanel.classList.add("hidden");
      onNext();
    });
  }
}

/**
 * Show the game over panel.
 * @param {object} state
 * @param {function} onPlayAgain
 * @param {function} onMainMenu
 */
export function showGameOver(state, onPlayAgain, onMainMenu) {
  const b = state.breakdown;
  if (!b) return;

  // Hide other panels
  $("#res-network-panel")?.classList.add("hidden");
  $("#res-detail-panel")?.classList.add("hidden");

  // Update tally
  const pPtsEl = $("#res-tally-player-pts");
  const aPtsEl = $("#res-tally-ai-pts");
  const subEl = $("#res-tally-sub");
  if (pPtsEl) pPtsEl.textContent = b.player;
  if (aPtsEl) aPtsEl.textContent = b.ai;
  if (subEl) {
    subEl.textContent =
      b.winner === "player"
        ? "You win!"
        : b.winner === "ai"
          ? "AI wins"
          : "Draw";
  }

  // Show final panel
  const panel = $("#res-final-panel");
  if (panel) panel.classList.remove("hidden");

  const titleEl = $("#res-final-title");
  if (titleEl) {
    if (b.winner === "player") {
      titleEl.textContent = "VICTORY!";
      titleEl.className = "res-final-title you-win";
    } else if (b.winner === "ai") {
      titleEl.textContent = "DEFEAT";
      titleEl.className = "res-final-title you-lose";
    } else {
      titleEl.textContent = "DRAW";
      titleEl.className = "res-final-title draw";
    }
  }

  const fpPts = $("#res-final-player-pts");
  const faPts = $("#res-final-ai-pts");
  if (fpPts) fpPts.textContent = b.player;
  if (faPts) faPts.textContent = b.ai;

  const breakdownEl = $("#res-final-breakdown");
  if (breakdownEl) {
    breakdownEl.innerHTML = `
      <div class="res-final-row">
        <span class="res-final-row-label">Territories</span>
        <span class="res-final-row-values">
          <span class="res-final-row-blue">${b.playerTerritoryCount}</span>
          <span class="res-final-row-amber">${b.aiTerritoryCount}</span>
        </span>
      </div>
      <div class="res-final-row">
        <span class="res-final-row-label">Territory Pts</span>
        <span class="res-final-row-values">
          <span class="res-final-row-blue">${b.playerTerritoryPts}</span>
          <span class="res-final-row-amber">${b.aiTerritoryPts}</span>
        </span>
      </div>
      <div class="res-final-row">
        <span class="res-final-row-label">Network Bonus</span>
        <span class="res-final-row-values">
          <span class="res-final-row-blue">+${b.playerNetworkPts}</span>
          <span class="res-final-row-amber">+${b.aiNetworkPts}</span>
        </span>
      </div>
      <div class="res-final-row">
        <span class="res-final-row-label">Annexations</span>
        <span class="res-final-row-values">
          <span class="res-final-row-blue">${b.playerAnnexations}</span>
          <span class="res-final-row-amber">${b.aiAnnexations}</span>
        </span>
      </div>
      <div class="res-final-row">
        <span class="res-final-row-label">Networks</span>
        <span class="res-final-row-values">
          <span class="res-final-row-blue">${b.playerNetworks.length > 0 ? b.playerNetworks.map((n) => n.chain.length + "-chain").join(", ") : "none"}</span>
          <span class="res-final-row-amber">${b.aiNetworks.length > 0 ? b.aiNetworks.map((n) => n.chain.length + "-chain").join(", ") : "none"}</span>
        </span>
      </div>
    `;

    // F: Post-resolution replay annotations
    const replaySummary = buildReplaySummary(state.territories);
    // Sort by value descending for the replay (high-value drama first)
    replaySummary.sort((a, b) => b.value - a.value);

    const replayEl = document.createElement("div");
    replayEl.className = "res-final-replay";
    replayEl.innerHTML = `<div class="res-final-replay-title">Territory Breakdown</div>`;

    const listEl = document.createElement("div");
    listEl.className = "replay-territory-list";

    for (const ts of replaySummary) {
      const ownerClass =
        ts.owner === "player"
          ? "player-owned"
          : ts.owner === "ai"
            ? "ai-owned"
            : "neutral-owned";
      const infText = ts.playerInfluence + " vs " + ts.aiInfluence;

      let resultText = "";
      let resultClass = "result-held";
      if (!ts.owner) {
        resultText = "Neutral";
        resultClass = "result-neutral";
      } else if (ts.scorched) {
        resultText = "\u26A1 Scorched 0pt";
        resultClass = "result-scorched";
      } else if (ts.annexed) {
        const who = ts.owner === "player" ? "You" : "AI";
        resultText = "\u26A1 " + who + " +" + ts.effectiveValue + "pt";
        resultClass = "result-annexed";
      } else {
        const who = ts.owner === "player" ? "Held" : "AI held";
        resultText = who + " +" + ts.effectiveValue + "pt";
        resultClass = "result-held";
      }

      const row = document.createElement("div");
      row.className = "replay-territory " + ownerClass;
      row.innerHTML = `
        <span class="replay-name">${ts.name}</span>
        <span class="replay-influence">${infText}</span>
        <span class="replay-result ${resultClass}">${resultText}</span>
      `;

      // Hover to highlight territory on map
      row.addEventListener("mouseenter", () => {
        state.resolutionHighlightChain = [ts.id];
      });
      row.addEventListener("mouseleave", () => {
        state.resolutionHighlightChain = [];
      });

      listEl.appendChild(row);
    }

    replayEl.appendChild(listEl);
    breakdownEl.appendChild(replayEl);
  }

  // Extraction outcome
  if (state.mode === MODE.EXTRACTION && state._extractionOutcome) {
    const outcome = state._extractionOutcome;
    const outcomeEl = document.createElement("div");
    outcomeEl.className = "res-final-extraction";
    outcomeEl.innerHTML = `
      <div class="res-final-row" style="border-top: 2px solid var(--border-light); padding-top: 8px; margin-top: 4px;">
        <span class="res-final-row-label" style="font-weight:700; color: var(--text);">Salvage</span>
        <span class="res-final-row-values">
          <span style="color: ${outcome.netSalvage >= 0 ? "var(--success)" : "var(--danger)"}; font-weight:800;">
            ${outcome.netSalvage >= 0 ? "+" : ""}${formatNumber(outcome.netSalvage)} \u25C6
          </span>
        </span>
      </div>
    `;
    if (breakdownEl) breakdownEl.appendChild(outcomeEl);

    if (outcome.lost) {
      const lostEl = document.createElement("div");
      lostEl.className = "res-final-row";
      lostEl.innerHTML = `<span class="res-final-row-label" style="color:var(--danger)">Abilities lost!</span><span></span>`;
      if (breakdownEl) breakdownEl.appendChild(lostEl);
    }
  }

  // Wire buttons
  const btnAgain = $("#btn-play-again");
  const btnMenu = $("#btn-main-menu");

  if (btnAgain) {
    const newBtn = btnAgain.cloneNode(true);
    btnAgain.parentNode.replaceChild(newBtn, btnAgain);
    newBtn.addEventListener("click", onPlayAgain);
  }
  if (btnMenu) {
    const newBtn = btnMenu.cloneNode(true);
    btnMenu.parentNode.replaceChild(newBtn, btnMenu);
    newBtn.addEventListener("click", onMainMenu);
  }
}

/**
 * Hide all resolution UI elements.
 */
export function resetResolutionUI() {
  $("#resolution-tally")?.classList.add("hidden");
  $("#res-detail-panel")?.classList.add("hidden");
  $("#res-network-panel")?.classList.add("hidden");
  $("#res-final-panel")?.classList.add("hidden");
}

// --------------------------------------------------------
// Tectonic shift warning banner
// --------------------------------------------------------

function updateTectonicWarning(state) {
  const banner = $("#tectonic-warning-banner");
  if (!banner) return;

  if (
    state.mode !== MODE.EXTRACTION ||
    !state.tectonicShiftTurn ||
    state.tectonicShiftOccurred
  ) {
    banner.classList.add("hidden");
    return;
  }

  const warning = getShiftWarningState(
    state.turnNumber,
    state.tectonicShiftTurn,
  );

  if (warning.phase === "warning") {
    banner.classList.remove("hidden");
    banner.textContent =
      "\u26A0 Tectonic Shift in " +
      warning.turnsUntil +
      " turn" +
      (warning.turnsUntil !== 1 ? "s" : "");
    banner.className = "tectonic-warning-banner warning";
  } else if (warning.phase === "imminent") {
    banner.classList.remove("hidden");
    banner.textContent = "\u26A0 Tectonic Shift THIS TURN";
    banner.className = "tectonic-warning-banner imminent";
  } else {
    banner.classList.add("hidden");
  }
}

// --------------------------------------------------------
// Salvage display (Extraction)
// --------------------------------------------------------

function updateSalvageDisplay(state) {
  const el = $("#salvage-display");
  if (!el) return;

  const persist = loadExtractionState();
  el.textContent = "\u25C6 " + formatNumber(persist.salvage);
  el.style.display = state.mode === MODE.EXTRACTION ? "" : "none";
}

// --------------------------------------------------------
// Observatory intel overlay
// --------------------------------------------------------

/**
 * Show the Observatory intel overlay with tectonic shift details.
 * @param {object} state
 */
export function showObservatoryIntel(state) {
  const overlay = $("#observatory-intel-overlay");
  if (!overlay) return;

  if (!state.tectonicShiftData) {
    overlay.classList.add("hidden");
    return;
  }

  const lines = getShiftIntelSummary(
    state.tectonicShiftData,
    state.territories,
  );
  const content = $("#observatory-intel-content");
  if (content) {
    content.innerHTML =
      "<h3>\uD83D\uDCE1 Observatory Intel</h3>" +
      "<p>Tectonic Shift details (Turn " +
      state.tectonicShiftTurn +
      "):</p>" +
      "<ul>" +
      lines.map((l) => "<li>" + l + "</li>").join("") +
      "</ul>";
  }

  overlay.classList.remove("hidden");
}

/**
 * Show the Observatory peek modal for Ranked mode.
 * The player selects an adjacent territory to peek at one opponent card.
 * @param {object} state
 * @param {number} observatoryId - the observatory territory id
 * @param {function} onPeek - callback(territoryId) when player selects a territory
 */
export function showObservatoryPeekModal(state, observatoryId, onPeek) {
  const obs = state.territories[observatoryId];
  if (!obs) return;

  // Find adjacent territories with opponent cards
  const adjacentWithCards = obs.connections.filter((nbId) => {
    const nb = state.territories[nbId];
    return nb.cardsPlayed.some((c) => c.owner === "ai" && !c.revealed);
  });

  if (adjacentWithCards.length === 0) {
    // Bank the peek for later
    state.observatoryPeekBanked = true;
    notify(
      "Observatory: No opponent cards adjacent yet. Peek banked for later.",
      "blue",
    );
    return;
  }

  // For the prototype, auto-peek the first adjacent territory with a card
  // (A full implementation would show a selection modal)
  const targetId = adjacentWithCards[0];
  const targetTerritory = state.territories[targetId];
  const card = targetTerritory.cardsPlayed.find(
    (c) => c.owner === "ai" && !c.revealed,
  );

  if (card) {
    card.revealed = true;
    notify(
      `Observatory: AI card on ${targetTerritory.name} is strength ${card.strength}`,
      "blue",
    );
    logAction(
      state,
      `Observatory reveals AI card on ${targetTerritory.name}: str ${card.strength}`,
      "ability",
    );
    // Notify opponent
    notify(
      `Observatory detected your card on ${targetTerritory.name}`,
      "amber",
    );
  }

  state.observatoryPeekUsed = true;
  if (onPeek) onPeek(targetId);
}

// --------------------------------------------------------
// Canvas input setup
// --------------------------------------------------------

/**
 * Set up mouse and touch input on the game canvas.
 * @param {object} state
 * @param {object} handlers - { onTerritoryClick, onCanvasClick }
 * @returns {function} cleanup function
 */
export function setupCanvasInput(state, handlers) {
  const canvas = state.canvas;
  if (!canvas) return () => {};

  const cleanupFns = [];

  // Mouse move — hover + tooltip
  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const t = getTerritoryAt(
      mx,
      my,
      state.territories,
      state.width,
      state.height,
    );
    state.hoveredTerritory = t ? t.id : null;

    // Tooltip
    const tip = $("#territory-tooltip");
    const inResPhase = isResolutionPhase(state);
    if (inResPhase || !t) {
      if (tip) tip.classList.add("hidden");
      return;
    }

    if (tip && t) {
      const data = buildTooltipData(t, state);
      const nameEl = tip.querySelector(".tooltip-name");
      const valueEl = tip.querySelector(".tooltip-value");
      const statusEl = tip.querySelector(".tooltip-status");
      const contestedEl = tip.querySelector(".tooltip-contested");
      const terrainEl = tip.querySelector(".tooltip-terrain");
      const infEl = tip.querySelector(".tooltip-influence");
      const networkEl = tip.querySelector(".tooltip-network");
      const connEl = tip.querySelector(".tooltip-connections");
      const entrenchEl = tip.querySelector(".tooltip-entrench");

      if (nameEl) nameEl.textContent = data.name;
      if (valueEl) valueEl.textContent = data.value;
      if (statusEl) statusEl.textContent = data.statusText;
      if (contestedEl) contestedEl.textContent = data.contestedText || "";
      if (terrainEl) terrainEl.textContent = data.terrainText || "";
      if (infEl) {
        infEl.textContent = data.influenceText || "";
        infEl.style.display = data.influenceText ? "block" : "none";
      }
      if (networkEl) {
        networkEl.textContent = data.networkText || "";
        networkEl.style.display = data.networkText ? "block" : "none";
      }
      if (connEl) connEl.textContent = data.connectionsText;
      if (entrenchEl) entrenchEl.textContent = data.entrenchText || "";

      tip.classList.remove("hidden");
      let tx = e.clientX + 16;
      let ty = e.clientY - 10;
      if (tx + 330 > window.innerWidth) tx = e.clientX - 330;
      if (ty + 200 > window.innerHeight) ty = e.clientY - 200;
      tip.style.left = tx + "px";
      tip.style.top = ty + "px";
    }
  }

  function onMouseLeave() {
    state.hoveredTerritory = null;
    const tip = $("#territory-tooltip");
    if (tip) tip.classList.add("hidden");
  }

  function onClick(e) {
    if (state.phase === PHASE.PLANNING) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const t = getTerritoryAt(
      mx,
      my,
      state.territories,
      state.width,
      state.height,
    );

    if (handlers.onCanvasClick) {
      handlers.onCanvasClick(t);
    }
  }

  function onTouchEnd(e) {
    if (e.changedTouches.length === 0) return;
    const touch = e.changedTouches[0];
    canvas.dispatchEvent(
      new MouseEvent("click", {
        clientX: touch.clientX,
        clientY: touch.clientY,
      }),
    );
    e.preventDefault();
  }

  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseleave", onMouseLeave);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("touchend", onTouchEnd);

  cleanupFns.push(() => {
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("mouseleave", onMouseLeave);
    canvas.removeEventListener("click", onClick);
    canvas.removeEventListener("touchend", onTouchEnd);
  });

  return () => cleanupFns.forEach((fn) => fn());
}

// --------------------------------------------------------
// Extraction lobby UI
// --------------------------------------------------------

/**
 * Render the Extraction lobby screen with shop, loadout, and wager.
 * @param {object} extractionState - from loadExtractionState()
 * @param {object} handlers - { onBuyAbility, onBuyTool, onStartMatch, onBack }
 */
export function renderExtractionLobby(extractionState, handlers) {
  const container = $("#extraction-lobby-content");
  if (!container) return;

  const { salvage, inventory } = extractionState;

  // Build the lobby HTML
  let html = "";

  // Salvage display
  html += `<div class="lobby-salvage">\u25C6 ${formatNumber(salvage)} Salvage</div>`;

  // Shop — Abilities
  html += `<div class="lobby-section"><div class="lobby-section-title">Shop \u2014 Abilities</div><div class="shop-grid">`;
  for (const [type, meta] of Object.entries(ABILITY_META)) {
    const owned = getAbilityCount(extractionState, type);
    const canAfford = salvage >= meta.cost;
    const refund = Math.floor(meta.cost * 0.5);
    html += `
      <div class="shop-card ${canAfford ? "" : "unaffordable"}">
        <div class="shop-icon">${meta.icon}</div>
        <div class="shop-name">${meta.label}</div>
        <div class="shop-desc">${meta.description}</div>
        <div class="shop-cost">\u25C6 ${meta.cost}</div>
        <div class="shop-owned">Owned: ${owned}</div>
        <div class="shop-actions">
          <button class="btn btn-primary shop-buy-btn" data-type="${type}" data-category="ability" ${canAfford ? "" : "disabled"}>Buy</button>
          <button class="btn btn-ghost btn-small shop-sell-btn" data-type="${type}" data-category="ability" ${owned > 0 ? "" : "disabled"} title="Sell for \u25C6 ${refund}">Sell (\u25C6${refund})</button>
        </div>
      </div>
    `;
  }
  html += `</div></div>`;

  // Shop — Terraforming
  html += `<div class="lobby-section"><div class="lobby-section-title">Shop \u2014 Terraforming</div><div class="shop-grid">`;
  for (const [type, meta] of Object.entries(TOOL_META)) {
    const owned = getToolCount(extractionState, type);
    const canAfford = salvage >= meta.cost;
    const refund = Math.floor(meta.cost * 0.5);
    html += `
      <div class="shop-card ${canAfford ? "" : "unaffordable"}">
        <div class="shop-icon">${meta.icon}</div>
        <div class="shop-name">${meta.label}</div>
        <div class="shop-desc">${meta.description}</div>
        <div class="shop-cost">\u25C6 ${meta.cost}</div>
        <div class="shop-owned">Owned: ${owned}</div>
        <div class="shop-actions">
          <button class="btn btn-primary shop-buy-btn" data-type="${type}" data-category="tool" ${canAfford ? "" : "disabled"}>Buy</button>
          <button class="btn btn-ghost btn-small shop-sell-btn" data-type="${type}" data-category="tool" ${owned > 0 ? "" : "disabled"} title="Sell for \u25C6 ${refund}">Sell (\u25C6${refund})</button>
        </div>
      </div>
    `;
  }
  html += `</div></div>`;

  // Loadout
  html += `<div class="lobby-section"><div class="lobby-section-title">Loadout</div>`;
  html += `<div class="loadout-section">`;
  html += `<div class="loadout-label">Abilities (max ${MAX_ABILITIES_PER_LOADOUT}):</div>`;
  html += `<div class="loadout-slots" id="ability-loadout-slots">`;
  for (let i = 0; i < MAX_ABILITIES_PER_LOADOUT; i++) {
    html += `<div class="loadout-slot empty" data-slot="${i}" data-category="ability">\u2014</div>`;
  }
  html += `</div>`;
  html += `<div class="loadout-label">Terraforming (max ${MAX_TOOLS_PER_LOADOUT}):</div>`;
  html += `<div class="loadout-slots" id="tool-loadout-slots">`;
  for (let i = 0; i < MAX_TOOLS_PER_LOADOUT; i++) {
    html += `<div class="loadout-slot empty" data-slot="${i}" data-category="tool">\u2014</div>`;
  }
  html += `</div>`;

  // Inventory for picking
  html += `<div class="loadout-inventory" id="loadout-inventory"></div>`;
  html += `</div></div>`;

  // Wager
  html += `<div class="lobby-section"><div class="lobby-section-title">Wager</div>`;
  html += `<div class="wager-section">`;
  html += `<input type="range" id="wager-slider" min="${MIN_WAGER}" max="${Math.max(MIN_WAGER, salvage)}" value="${MIN_WAGER}" step="10">`;
  html += `<div class="wager-display"><span id="wager-amount">${MIN_WAGER}</span> \u25C6</div>`;
  html += `<div class="wager-tier" id="wager-tier">${getWagerTierName(MIN_WAGER)}</div>`;
  html += `</div></div>`;

  // Start match button
  html += `<button id="btn-start-extraction" class="btn btn-primary lobby-start-btn">Start Match</button>`;

  container.innerHTML = html;

  // Wire up buy buttons
  container.querySelectorAll(".shop-buy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.type;
      const category = btn.dataset.category;
      if (category === "ability" && handlers.onBuyAbility) {
        handlers.onBuyAbility(type);
      } else if (category === "tool" && handlers.onBuyTool) {
        handlers.onBuyTool(type);
      }
    });
  });

  // Wire up sell buttons
  container.querySelectorAll(".shop-sell-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.type;
      const category = btn.dataset.category;
      if (category === "ability" && handlers.onSellAbility) {
        handlers.onSellAbility(type);
      } else if (category === "tool" && handlers.onSellTool) {
        handlers.onSellTool(type);
      }
    });
  });

  // Wire wager slider
  const slider = $("#wager-slider");
  if (slider) {
    slider.addEventListener("input", () => {
      const val = parseInt(slider.value);
      const amountEl = $("#wager-amount");
      const tierEl = $("#wager-tier");
      if (amountEl) amountEl.textContent = formatNumber(val);
      if (tierEl) tierEl.textContent = getWagerTierName(val);
    });
  }

  // Wire start button
  const startBtn = $("#btn-start-extraction");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      const wager = slider ? parseInt(slider.value) : MIN_WAGER;
      // Gather loadout from slots
      const abilityLoadout = gatherLoadout("ability");
      const toolLoadout = gatherLoadout("tool");
      if (handlers.onStartMatch) {
        handlers.onStartMatch(wager, abilityLoadout, toolLoadout);
      }
    });
  }

  // Wire loadout slot clicking
  setupLoadoutInteraction(extractionState, container);
}

/**
 * Get the wager tier name for a given amount.
 * @param {number} amount
 * @returns {string}
 */
function getWagerTierName(amount) {
  for (const tier of WAGER_TIERS) {
    if (amount >= tier.min && amount <= tier.max) {
      return "Tier: " + tier.name;
    }
  }
  return "Tier: All In";
}

/**
 * Gather loadout types from the loadout slot DOM elements.
 * @param {string} category - "ability" or "tool"
 * @returns {string[]}
 */
function gatherLoadout(category) {
  const slots = document.querySelectorAll(
    `.loadout-slot[data-category="${category}"]`,
  );
  const types = [];
  for (const slot of slots) {
    const type = slot.dataset.loadedType;
    if (type) types.push(type);
  }
  return types;
}

/**
 * Set up interactive loadout slot clicking for the extraction lobby.
 * @param {object} extractionState
 * @param {HTMLElement} container
 */
function setupLoadoutInteraction(extractionState, container) {
  const slots = container.querySelectorAll(".loadout-slot");
  const inventoryEl = container.querySelector("#loadout-inventory");
  if (!inventoryEl) return;

  slots.forEach((slot) => {
    slot.addEventListener("click", () => {
      const category = slot.dataset.category;
      const slotIndex = parseInt(slot.dataset.slot);

      // If slot has something, unequip it
      if (slot.dataset.loadedType) {
        const type = slot.dataset.loadedType;
        slot.dataset.loadedType = "";
        slot.textContent = "\u2014";
        slot.classList.add("empty");
        // No need to "return" to inventory in prototype — inventory is persistent
        // Just clear the slot
        return;
      }

      // Show available items for this slot
      const items =
        category === "ability"
          ? extractionState.inventory.abilities.filter((a) => a.count > 0)
          : extractionState.inventory.terraforming.filter((t) => t.count > 0);

      // Count already loaded of each type
      const loaded = {};
      container
        .querySelectorAll(`.loadout-slot[data-category="${category}"]`)
        .forEach((s) => {
          if (s.dataset.loadedType) {
            loaded[s.dataset.loadedType] =
              (loaded[s.dataset.loadedType] || 0) + 1;
          }
        });

      inventoryEl.innerHTML = "";
      if (items.length === 0) {
        inventoryEl.innerHTML =
          '<div class="loadout-empty">No items in inventory. Buy some from the shop!</div>';
        return;
      }

      for (const item of items) {
        const usedCount = loaded[item.type] || 0;
        const available = item.count - usedCount;
        if (available <= 0) continue;

        const meta =
          category === "ability"
            ? ABILITY_META[item.type]
            : TOOL_META[item.type];
        if (!meta) continue;

        const btn = document.createElement("button");
        btn.className = "btn btn-secondary loadout-pick-btn";
        btn.textContent = `${meta.icon} ${meta.label} (${available} avail)`;
        btn.addEventListener("click", () => {
          slot.textContent = `${meta.icon} ${meta.label}`;
          slot.dataset.loadedType = item.type;
          slot.classList.remove("empty");
          inventoryEl.innerHTML = "";
        });
        inventoryEl.appendChild(btn);
      }
    });
  });
}

// --------------------------------------------------------
// Ranked map select UI
// --------------------------------------------------------

/**
 * Render the map selection screen for Ranked mode.
 * @param {function} onSelect - callback(presetKey) when a map is selected
 */
export function renderMapSelect(onSelect) {
  const container = $("#map-select-grid");
  if (!container) return;

  container.innerHTML = "";

  for (const [key, preset] of Object.entries(MAP_PRESETS)) {
    const el = document.createElement("div");
    el.className = "map-select-card " + preset.category;

    // Count terrain types
    const terrainSummary = {};
    for (const terrain of preset.terrain) {
      if (terrain !== TERRAIN.PLAINS) {
        const meta = TERRAIN_META[terrain];
        const label = meta ? meta.icon + " " + meta.label : terrain;
        terrainSummary[label] = (terrainSummary[label] || 0) + 1;
      }
    }
    const terrainText =
      Object.entries(terrainSummary)
        .map(
          ([label, count]) => `${label}${count > 1 ? " \u00D7" + count : ""}`,
        )
        .join(", ") || "All Plains";

    el.innerHTML = `
      <div class="map-select-name">${preset.name}</div>
      <div class="map-select-category">${preset.category === "conservative" ? "Conservative" : "Terrain-Heavy"}</div>
      <div class="map-select-desc">${preset.description}</div>
      <div class="map-select-terrain">${terrainText}</div>
    `;

    el.addEventListener("click", () => {
      if (onSelect) onSelect(key);
    });

    container.appendChild(el);
  }
}

// --------------------------------------------------------
// Keyboard shortcuts
// --------------------------------------------------------

/**
 * Set up keyboard shortcuts for the game.
 * @param {object} state
 * @param {object} handlers - { onClaim, onFortify, onPass, onSelectCard, onAbility, onCancel, onAdvanceResolution, onAdvanceNetworks, onStartGame }
 * @returns {function} cleanup function
 */
export function setupKeyboard(state, handlers) {
  function onKeyDown(e) {
    if (!state) return;

    // Planning phase — Enter to start
    if (
      state.phase === PHASE.PLANNING &&
      (e.key === "Enter" || e.key === " ")
    ) {
      if (handlers.onStartGame) handlers.onStartGame();
      return;
    }

    // Resolution: space/enter/right to advance
    if (
      state.phase === PHASE.RESOLUTION &&
      (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")
    ) {
      if (handlers.onAdvanceResolution) handlers.onAdvanceResolution();
      return;
    }

    if (
      state.phase === PHASE.RESOLUTION_NETWORKS &&
      (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")
    ) {
      if (handlers.onAdvanceNetworks) handlers.onAdvanceNetworks();
      return;
    }

    // Action phase — player turn only
    if (!isPlayerActionTurn(state)) return;

    if (e.key === "c" || e.key === "C") {
      if (handlers.onClaim) handlers.onClaim();
    } else if (e.key === "f" || e.key === "F") {
      if (handlers.onFortify) handlers.onFortify();
    } else if (e.key === "a" || e.key === "A") {
      if (handlers.onAbility) handlers.onAbility();
    } else if (e.key >= "1" && e.key <= "9") {
      const idx = parseInt(e.key) - 1;
      const avail = getInHandCards(state.playerHand);
      if (idx < avail.length && handlers.onSelectCard) {
        handlers.onSelectCard(avail[idx]);
      }
    } else if (e.key === "Escape") {
      if (handlers.onCancel) handlers.onCancel();
    } else if (e.key === "p" || e.key === "P") {
      if (!hasUnclaimed(state.territories) && handlers.onPass) {
        handlers.onPass();
      }
    }
  }

  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}

// --------------------------------------------------------
// Version tag update
// --------------------------------------------------------

/**
 * Update the version tag on the title screen.
 */
export function updateVersionTag() {
  const tag = $(".version-tag");
  if (tag) tag.textContent = "Prototype v" + VERSION;
}
