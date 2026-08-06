// ============================================================
// ANNEX — tutorial.js
// Guided first-game tutorial that narrates the core gameplay loop.
// Walks the player through claim, fortify, bluff, and resolution
// with contextual hints and forced pauses.
// ============================================================

import { PHASE, MODE, TERRAIN_META } from "./constants.js";
import { $, $$ } from "./utils.js";
import { countHandCards } from "./cards.js";
import { isPlayerActionTurn, hasUnclaimed } from "./state.js";

// --------------------------------------------------------
// Tutorial step definitions
// --------------------------------------------------------

/**
 * Each step has:
 *   - id: unique key
 *   - trigger: function(state, event) → boolean — when to show this step
 *   - message: string — the tutorial text
 *   - highlight: optional CSS selector or "canvas" to pulse
 *   - position: "top" | "bottom" | "center" — where to show the overlay
 *   - waitForAction: if true, step stays until the player acts
 *   - autoDismissMs: if set, auto-dismiss after N ms
 *   - onceOnly: if true (default), only show once per tutorial session
 */
const TUTORIAL_STEPS = [
  {
    id: "welcome",
    trigger: (state, event) =>
      event === "game-start" && state.phase === PHASE.PLANNING,
    message:
      "Welcome to Annex! You and the AI are competing for control of this map. " +
      "Each territory is worth points — hover over them to see their value. " +
      "Let's learn the basics.",
    position: "center",
    autoDismissMs: null,
    waitForAction: true,
  },
  {
    id: "your-hand",
    trigger: (state, event) =>
      event === "game-start" && state.phase === PHASE.PLANNING,
    message:
      "These are your Influence Cards. Each has a hidden strength value (1–4). " +
      "You'll play them face-down on territories to boost your control. " +
      "The AI can't see your card strengths — and you can't see theirs.",
    highlight: "#hand-cards",
    position: "bottom",
    autoDismissMs: null,
    waitForAction: true,
  },
  {
    id: "click-start",
    trigger: (state, event) =>
      event === "game-start" && state.phase === PHASE.PLANNING,
    message: 'When you\'re ready, click "Start Match" to begin.',
    highlight: "#btn-start-game",
    position: "bottom",
    autoDismissMs: null,
    waitForAction: true,
  },
  {
    id: "first-turn-claim",
    trigger: (state, event) =>
      event === "turn-start" &&
      state.phase === PHASE.ACTION &&
      state.currentTurn === "player" &&
      state.turnNumber <= 2,
    message:
      '🏴 CLAIM a territory by clicking "Claim" then clicking an unclaimed territory on the map. ' +
      "Claiming plants your flag and gives you +2 base influence there. " +
      "This is how you stake your position.",
    highlight: "#btn-claim",
    position: "bottom",
    autoDismissMs: null,
    waitForAction: true,
  },
  {
    id: "after-first-claim",
    trigger: (state, event) =>
      event === "player-claimed" && state.turnNumber <= 4,
    message:
      "Nice! You've planted your flag. The AI will claim territories too. " +
      "A flag alone gives +2 influence, but it can be beaten by opponent cards. " +
      "Watch what the AI does next...",
    position: "top",
    autoDismissMs: 4500,
    waitForAction: false,
  },
  {
    id: "teach-fortify",
    trigger: (state, event) =>
      event === "turn-start" &&
      state.phase === PHASE.ACTION &&
      state.currentTurn === "player" &&
      state.turnNumber >= 3 &&
      state.turnNumber <= 6 &&
      countHandCards(state.playerHand) >= 4,
    message:
      "🃏 Now try FORTIFYING. Select a card from your hand, then click " +
      '"Fortify" and click any territory on the map to play it face-down. ' +
      "The AI sees that you played a card, but not its strength. This is where bluffing begins!",
    highlight: "#hand-cards",
    position: "bottom",
    autoDismissMs: null,
    waitForAction: true,
  },
  {
    id: "after-fortify",
    trigger: (state, event) => event === "player-fortified",
    message:
      "Your card is now face-down on the map. Its strength is hidden from the AI. " +
      "At Resolution, all cards flip and the player with more total influence wins each territory.",
    position: "top",
    autoDismissMs: 5000,
    waitForAction: false,
  },
  {
    id: "ai-fortified-your-territory",
    trigger: (state, event) =>
      event === "ai-fortified" && state._lastAiFortifyWasOnPlayerTerritory,
    message:
      "⚠️ The AI just played a card on YOUR territory! " +
      "They might be trying to annex it — or it could be a bluff with a weak card. " +
      "You can fortify the same territory to defend it, or let it go and focus elsewhere.",
    position: "top",
    autoDismissMs: 5500,
    waitForAction: false,
  },
  {
    id: "teach-bluff",
    trigger: (state, event) =>
      event === "turn-start" &&
      state.phase === PHASE.ACTION &&
      state.currentTurn === "player" &&
      countHandCards(state.playerHand) >= 2 &&
      countHandCards(state.playerHand) <= 3,
    message:
      "💡 TIP: You can bluff by playing a weak card (strength 1) on an AI territory. " +
      "The AI sees a card was played but doesn't know if it's a real threat or a decoy. " +
      "This can force them to waste a strong card defending!",
    position: "top",
    autoDismissMs: 6000,
    waitForAction: false,
  },
  {
    id: "endgame-pressure",
    trigger: (state, event) =>
      event === "turn-start" &&
      state.phase === PHASE.ACTION &&
      state.currentTurn === "player" &&
      countHandCards(state.playerHand) === 1,
    message:
      "🔥 Last card! Every remaining card carries enormous weight. " +
      "The AI knows you have exactly 1 card left — and you know how many they have. " +
      "Choose wisely where to play it.",
    position: "top",
    autoDismissMs: 5000,
    waitForAction: false,
  },
  {
    id: "resolution-begins",
    trigger: (state, event) => event === "resolution-start",
    message:
      "⚡ RESOLUTION! All hidden cards are about to flip. " +
      "Territories resolve from lowest to highest value. " +
      "Watch for ANNEXATIONS — when a player steals a territory the opponent claimed!",
    position: "center",
    autoDismissMs: null,
    waitForAction: true,
  },
  {
    id: "first-annexation",
    trigger: (state, event) => event === "annexation-occurred",
    message:
      "⚡ ANNEXATION! A territory just changed hands! " +
      "This is the heart of Annex — the dramatic moment when hidden influence is revealed " +
      "and the board transforms.",
    position: "top",
    autoDismissMs: 4000,
    waitForAction: false,
  },
  {
    id: "network-phase",
    trigger: (state, event) => event === "network-phase",
    message:
      "🔗 NETWORK BONUSES: Connected chains of 3+ territories you control " +
      "earn bonus points. Longer chains = bigger bonuses. " +
      "This is why map position matters — control connected regions!",
    position: "top",
    autoDismissMs: null,
    waitForAction: true,
  },
  {
    id: "game-over",
    trigger: (state, event) => event === "game-over",
    message:
      "That's the core loop! Claim territories, play hidden cards, bluff your opponent, " +
      "and watch it all unfold at Resolution. Every game plays differently based on " +
      "the map layout and your card draws. Ready for another round?",
    position: "center",
    autoDismissMs: null,
    waitForAction: true,
  },
];

// --------------------------------------------------------
// Tutorial state
// --------------------------------------------------------

let tutorialActive = false;
let seenSteps = new Set();
let currentStepId = null;
let pendingSteps = [];
let dismissTimer = null;
let onDismissCallback = null;

const TUTORIAL_STORAGE_KEY = "annex_tutorial_state";

// --------------------------------------------------------
// Persistence
// --------------------------------------------------------

function loadTutorialState() {
  try {
    const raw = localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        completed: parsed.completed || false,
        seenSteps: new Set(parsed.seenSteps || []),
      };
    }
  } catch (_e) {
    // ignore
  }
  return { completed: false, seenSteps: new Set() };
}

function saveTutorialState() {
  try {
    localStorage.setItem(
      TUTORIAL_STORAGE_KEY,
      JSON.stringify({
        completed: isTutorialComplete(),
        seenSteps: [...seenSteps],
      }),
    );
  } catch (_e) {
    // ignore
  }
}

// --------------------------------------------------------
// Public API
// --------------------------------------------------------

/**
 * Check if the player has completed the tutorial before.
 * @returns {boolean}
 */
export function hasCompletedTutorial() {
  const saved = loadTutorialState();
  return saved.completed;
}

/**
 * Check if a tutorial is currently active.
 * @returns {boolean}
 */
export function isTutorialActive() {
  return tutorialActive;
}

/**
 * Check if all key tutorial steps have been seen.
 * @returns {boolean}
 */
export function isTutorialComplete() {
  const keySteps = [
    "welcome",
    "first-turn-claim",
    "teach-fortify",
    "resolution-begins",
  ];
  return keySteps.every((id) => seenSteps.has(id));
}

/**
 * Start or resume the tutorial system.
 * Call this when a new game starts.
 */
export function startTutorial() {
  const saved = loadTutorialState();
  seenSteps = saved.seenSteps;
  tutorialActive = true;
  currentStepId = null;
  pendingSteps = [];
  ensureTutorialOverlay();
}

/**
 * Stop the tutorial entirely. Called on cleanup or when player dismisses.
 */
export function stopTutorial() {
  tutorialActive = false;
  currentStepId = null;
  pendingSteps = [];
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  hideTutorialOverlay();
  saveTutorialState();
}

/**
 * Reset tutorial progress (debug / settings).
 */
export function resetTutorial() {
  seenSteps = new Set();
  tutorialActive = false;
  currentStepId = null;
  try {
    localStorage.removeItem(TUTORIAL_STORAGE_KEY);
  } catch (_e) {
    // ignore
  }
}

/**
 * Fire a tutorial event. The tutorial system checks if any step should
 * trigger based on the current game state and event name.
 *
 * @param {object} state - current game state
 * @param {string} event - event name (e.g. "turn-start", "player-claimed")
 */
export function fireTutorialEvent(state, event) {
  if (!tutorialActive) return;
  if (!state) return;

  // Find matching steps that haven't been seen
  const matching = TUTORIAL_STEPS.filter((step) => {
    if (seenSteps.has(step.id)) return false;
    try {
      return step.trigger(state, event);
    } catch (_e) {
      return false;
    }
  });

  if (matching.length === 0) return;

  // Queue all matching steps
  for (const step of matching) {
    if (
      !pendingSteps.some((p) => p.id === step.id) &&
      currentStepId !== step.id
    ) {
      pendingSteps.push(step);
    }
  }

  // Show the first one if nothing is currently displayed
  if (!currentStepId) {
    showNextStep();
  }
}

/**
 * Dismiss the current tutorial step.
 * Called when the player clicks the overlay or presses a key.
 */
export function dismissCurrentStep() {
  if (!tutorialActive || !currentStepId) return;

  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  currentStepId = null;
  hideTutorialOverlay();

  if (onDismissCallback) {
    const cb = onDismissCallback;
    onDismissCallback = null;
    cb();
  }

  // Show next queued step after a short delay
  if (pendingSteps.length > 0) {
    setTimeout(() => showNextStep(), 400);
  }
}

// --------------------------------------------------------
// Internal
// --------------------------------------------------------

function showNextStep() {
  if (!tutorialActive) return;
  if (pendingSteps.length === 0) return;

  const step = pendingSteps.shift();
  if (seenSteps.has(step.id)) {
    // Already seen, skip to next
    if (pendingSteps.length > 0) showNextStep();
    return;
  }

  currentStepId = step.id;
  seenSteps.add(step.id);
  saveTutorialState();

  showTutorialOverlay(step);

  // Auto-dismiss if configured
  if (step.autoDismissMs && !step.waitForAction) {
    dismissTimer = setTimeout(() => {
      dismissCurrentStep();
    }, step.autoDismissMs);
  }

  // Apply highlight
  if (step.highlight && step.highlight !== "canvas") {
    const el = $(step.highlight);
    if (el) {
      el.classList.add("tutorial-highlight");
      // Remove highlight when step is dismissed
      const originalDismiss = onDismissCallback;
      onDismissCallback = () => {
        el.classList.remove("tutorial-highlight");
        if (originalDismiss) originalDismiss();
      };
    }
  }
}

// --------------------------------------------------------
// DOM overlay
// --------------------------------------------------------

function ensureTutorialOverlay() {
  let overlay = $("#tutorial-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "tutorial-overlay";
    overlay.className = "tutorial-overlay hidden";
    overlay.innerHTML = `
      <div class="tutorial-card">
        <div class="tutorial-icon">💡</div>
        <div class="tutorial-message"></div>
        <div class="tutorial-actions">
          <button class="btn btn-primary tutorial-btn-continue">Got it</button>
          <button class="btn btn-ghost tutorial-btn-skip">Skip tutorial</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Wire up buttons
    const btnContinue = overlay.querySelector(".tutorial-btn-continue");
    const btnSkip = overlay.querySelector(".tutorial-btn-skip");

    if (btnContinue) {
      btnContinue.addEventListener("click", (e) => {
        e.stopPropagation();
        dismissCurrentStep();
      });
    }
    if (btnSkip) {
      btnSkip.addEventListener("click", (e) => {
        e.stopPropagation();
        stopTutorial();
        // Mark as completed so it doesn't show again
        seenSteps = new Set(TUTORIAL_STEPS.map((s) => s.id));
        saveTutorialState();
      });
    }
  }
}

function showTutorialOverlay(step) {
  const overlay = $("#tutorial-overlay");
  if (!overlay) return;

  const messageEl = overlay.querySelector(".tutorial-message");
  if (messageEl) messageEl.textContent = step.message;

  // Position
  overlay.className = "tutorial-overlay tutorial-" + (step.position || "top");
  overlay.classList.remove("hidden");

  // Show/hide continue button based on waitForAction
  const btnContinue = overlay.querySelector(".tutorial-btn-continue");
  if (btnContinue) {
    btnContinue.style.display =
      step.waitForAction || !step.autoDismissMs ? "inline-flex" : "none";
  }
}

function hideTutorialOverlay() {
  const overlay = $("#tutorial-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
  }

  // Remove all tutorial highlights
  const highlighted = $$(".tutorial-highlight");
  highlighted.forEach((el) => el.classList.remove("tutorial-highlight"));
}
