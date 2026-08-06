// ============================================================
// ANNEX — renderer.js
// Canvas rendering: map drawing, terrain visuals, resolution
// animations, tectonic shift effects, ability targeting overlays,
// provisional network preview, contested escalation, card pressure
// ============================================================

import {
  TERRAIN,
  TERRAIN_META,
  COLORS,
  PHASE,
  MODE,
  NODE_RADIUS,
  NODE_RADIUS_HOVERED,
  NODE_RADIUS_FOCUS,
  HIT_RADIUS,
  PAD_X,
  PAD_Y,
  getNetworkBonus,
} from "./constants.js";
import { getVisibleCards, countHandCards } from "./cards.js";
import { isPostResolution, isResolutionPhase } from "./state.js";
import { getShiftWarningState } from "./tectonic.js";
import { calculateProvisionalNetworks } from "./resolution.js";

// --------------------------------------------------------
// Coordinate conversion
// --------------------------------------------------------

/**
 * Convert normalized territory coordinates to screen coordinates.
 * @param {object} territory - { x, y } in 0-1 range
 * @param {number} width - canvas width
 * @param {number} height - canvas height
 * @returns {{ x: number, y: number }}
 */
export function toScreen(territory, width, height) {
  return {
    x: PAD_X + territory.x * (width - 2 * PAD_X),
    y: PAD_Y + territory.y * (height - 2 * PAD_Y),
  };
}

/**
 * Find which territory (if any) is at a given screen coordinate.
 * @param {number} mx - mouse x
 * @param {number} my - mouse y
 * @param {object[]} territories
 * @param {number} width
 * @param {number} height
 * @returns {object|null}
 */
export function getTerritoryAt(mx, my, territories, width, height) {
  for (const t of territories) {
    const s = toScreen(t, width, height);
    if (Math.hypot(mx - s.x, my - s.y) < HIT_RADIUS) return t;
  }
  return null;
}

// --------------------------------------------------------
// Main draw entry point
// --------------------------------------------------------

/**
 * Draw the complete game map onto the canvas.
 * This is called every frame via requestAnimationFrame.
 *
 * @param {object} state - full game state
 */
export function drawMap(state) {
  const { ctx, width, height } = state;
  if (!ctx) return;

  ctx.clearRect(0, 0, width, height);

  // Build Voronoi cache once per map layout
  if (
    !state._voronoiCache ||
    state._voronoiWidth !== width ||
    state._voronoiHeight !== height
  ) {
    state._voronoiCache = buildVoronoiRegions(
      state.territories,
      width,
      height,
      state.edges,
    );
    state._voronoiWidth = width;
    state._voronoiHeight = height;
  }

  const inResolution =
    state.phase === PHASE.RESOLUTION ||
    state.phase === PHASE.RESOLUTION_NETWORKS;
  const postRes = isPostResolution(state);
  const focusId = state.resolutionFocusTerritory;
  const resolvedIds = state.resolutionResolvedIds;
  const highlightChain = state.resolutionHighlightChain || [];

  // Helper: get alpha for a territory during resolution
  function getTerritoryAlpha(t) {
    if (!inResolution) return 1;
    if (focusId === t.id) return 1;
    if (highlightChain.length > 0 && highlightChain.includes(t.id)) return 1;
    if (resolvedIds.has(t.id)) return 0.55;
    return 0.25;
  }

  // --- Tectonic shift warning pulse ---
  let shiftWarningIds = [];
  let shiftPulseAlpha = 0;
  if (
    state.mode === MODE.EXTRACTION &&
    state.tectonicShiftData &&
    !state.tectonicShiftOccurred
  ) {
    const warning = getShiftWarningState(
      state.turnNumber,
      state.tectonicShiftTurn,
    );
    if (warning.phase === "warning" || warning.phase === "imminent") {
      shiftWarningIds = state.tectonicShiftData.affectedTerritories || [];
      // Pulse effect: oscillate alpha based on time
      shiftPulseAlpha = 0.3 + 0.3 * Math.sin(Date.now() / 300);
    }
  }

  // --- B: Compute provisional networks for action-phase highlighting ---
  let provisionalPlayerNets = [];
  let provisionalAiNets = [];
  let provisionalChainIds = new Set();
  if (state.phase === PHASE.ACTION || state.phase === PHASE.PLANNING) {
    provisionalPlayerNets = calculateProvisionalNetworks(
      state.territories,
      "player",
    );
    provisionalAiNets = calculateProvisionalNetworks(state.territories, "ai");
    for (const net of provisionalPlayerNets) {
      for (const id of net.chain) provisionalChainIds.add(id);
    }
    for (const net of provisionalAiNets) {
      for (const id of net.chain) provisionalChainIds.add(id);
    }
  }

  // --- C: Card pressure — compute endgame tension ---
  let cardPressure = 0; // 0 = normal, 1 = low, 2 = critical
  if (state.phase === PHASE.ACTION) {
    const pCards = countHandCards(state.playerHand);
    const aCards = countHandCards(state.aiHand);
    const minCards = Math.min(pCards, aCards);
    if (minCards <= 1) cardPressure = 2;
    else if (minCards <= 2) cardPressure = 1;
  }

  // --- Draw Voronoi territory regions (map background) ---
  drawVoronoiBackground(
    ctx,
    state,
    width,
    height,
    postRes,
    inResolution,
    resolvedIds,
    getTerritoryAlpha,
    state.edges,
  );

  // --- B: Draw provisional network edges (action phase only) ---
  if (!postRes && !inResolution && provisionalChainIds.size > 0) {
    drawProvisionalNetworkEdges(
      ctx,
      state,
      width,
      height,
      provisionalPlayerNets,
      provisionalAiNets,
    );
  }

  // --- Draw edges ---
  drawEdges(
    ctx,
    state,
    width,
    height,
    postRes,
    inResolution,
    highlightChain,
    getTerritoryAlpha,
  );

  // --- Draw territories ---
  for (const t of state.territories) {
    drawTerritory(ctx, state, t, width, height, {
      postRes,
      inResolution,
      focusId,
      resolvedIds,
      highlightChain,
      getTerritoryAlpha,
      shiftWarningIds,
      shiftPulseAlpha,
      provisionalChainIds,
      cardPressure,
    });
  }

  // --- B: Draw provisional network bonus labels ---
  if (!postRes && !inResolution) {
    drawProvisionalNetworkLabels(
      ctx,
      state,
      width,
      height,
      provisionalPlayerNets,
      provisionalAiNets,
    );
  }
}

// --------------------------------------------------------
// Edge drawing
// --------------------------------------------------------

function drawEdges(
  ctx,
  state,
  width,
  height,
  postRes,
  inResolution,
  highlightChain,
  getTerritoryAlpha,
) {
  for (const [a, b] of state.edges) {
    const sa = toScreen(state.territories[a], width, height);
    const sb = toScreen(state.territories[b], width, height);
    const ta = state.territories[a];
    const tb = state.territories[b];

    const sameOwner = postRes && ta.owner && ta.owner === tb.owner;
    const sameClaim = ta.claimedBy && ta.claimedBy === tb.claimedBy;
    const bothInChain =
      highlightChain.includes(a) &&
      highlightChain.includes(b) &&
      ta.owner &&
      ta.owner === tb.owner;

    ctx.save();

    if (inResolution) {
      ctx.globalAlpha = Math.max(getTerritoryAlpha(ta), getTerritoryAlpha(tb));
    }

    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);

    if (bothInChain) {
      ctx.strokeStyle =
        ta.owner === "player" ? COLORS.playerLight : COLORS.aiLight;
      ctx.lineWidth = 4;
      ctx.shadowColor =
        ta.owner === "player" ? COLORS.playerGlow : COLORS.aiGlow;
      ctx.shadowBlur = 12;
    } else if (sameOwner) {
      ctx.strokeStyle =
        ta.owner === "player" ? COLORS.playerGlow : COLORS.aiGlow;
      ctx.lineWidth = 3.5;
    } else if (sameClaim) {
      const col =
        ta.claimedBy === "player"
          ? "rgba(37,99,235,0.12)"
          : "rgba(217,119,6,0.12)";
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = COLORS.edge;
      ctx.lineWidth = 1.5;
    }

    ctx.stroke();
    ctx.restore();
  }
}

// --------------------------------------------------------
// B: Provisional network edge drawing (action phase)
// --------------------------------------------------------

/**
 * Draw glowing edges along provisional network chains during the action phase.
 * These show players what network chains they're building based on claims.
 */
function drawProvisionalNetworkEdges(
  ctx,
  state,
  width,
  height,
  playerNets,
  aiNets,
) {
  const allNets = [
    ...playerNets.map((n) => ({ ...n, owner: "player" })),
    ...aiNets.map((n) => ({ ...n, owner: "ai" })),
  ];

  for (const net of allNets) {
    const chainSet = new Set(net.chain);

    for (const [a, b] of state.edges) {
      if (!chainSet.has(a) || !chainSet.has(b)) continue;

      const sa = toScreen(state.territories[a], width, height);
      const sb = toScreen(state.territories[b], width, height);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);

      const pulseAlpha = 0.15 + 0.1 * Math.sin(Date.now() / 600);
      if (net.owner === "player") {
        ctx.strokeStyle = `rgba(96, 165, 250, ${pulseAlpha + 0.15})`;
        ctx.shadowColor = COLORS.playerGlow;
      } else {
        ctx.strokeStyle = `rgba(251, 191, 36, ${pulseAlpha + 0.15})`;
        ctx.shadowColor = COLORS.aiGlow;
      }
      ctx.lineWidth = 3;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.restore();
    }
  }
}

/**
 * Draw floating network bonus labels at the centroid of each provisional network.
 */
function drawProvisionalNetworkLabels(
  ctx,
  state,
  width,
  height,
  playerNets,
  aiNets,
) {
  const allNets = [
    ...playerNets.map((n) => ({ ...n, owner: "player" })),
    ...aiNets.map((n) => ({ ...n, owner: "ai" })),
  ];

  for (const net of allNets) {
    // Calculate centroid of the chain
    let cx = 0,
      cy = 0;
    for (const id of net.chain) {
      const s = toScreen(state.territories[id], width, height);
      cx += s.x;
      cy += s.y;
    }
    cx /= net.chain.length;
    cy /= net.chain.length;

    // Offset slightly so it doesn't overlap with territory nodes
    cy -= 6;

    const pulseAlpha = 0.6 + 0.2 * Math.sin(Date.now() / 800);

    // Background pill
    const label = "+" + net.bonus;
    ctx.save();
    ctx.font = "bold 11px 'JetBrains Mono', monospace";
    const textW = ctx.measureText(label).width;
    const pillW = textW + 14;
    const pillH = 18;
    const pillR = pillH / 2;

    ctx.globalAlpha = pulseAlpha;

    // Pill background (with fallback for older browsers)
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(cx - pillW / 2, cy - pillH / 2, pillW, pillH, pillR);
    } else {
      const px = cx - pillW / 2;
      const py = cy - pillH / 2;
      ctx.moveTo(px + pillR, py);
      ctx.arcTo(px + pillW, py, px + pillW, py + pillH, pillR);
      ctx.arcTo(px + pillW, py + pillH, px, py + pillH, pillR);
      ctx.arcTo(px, py + pillH, px, py, pillR);
      ctx.arcTo(px, py, px + pillW, py, pillR);
      ctx.closePath();
    }
    ctx.fillStyle =
      net.owner === "player"
        ? "rgba(37, 99, 235, 0.75)"
        : "rgba(217, 119, 6, 0.75)";
    ctx.fill();

    // Label text
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy + 0.5);

    ctx.restore();
  }
}

// --------------------------------------------------------
// Territory drawing
// --------------------------------------------------------

function drawTerritory(ctx, state, t, width, height, opts) {
  const {
    postRes,
    inResolution,
    focusId,
    resolvedIds,
    highlightChain,
    getTerritoryAlpha,
    shiftWarningIds,
    shiftPulseAlpha,
    provisionalChainIds,
    cardPressure,
  } = opts;

  const s = toScreen(t, width, height);
  const hovered = state.hoveredTerritory === t.id;
  const isCardTarget = state.selectedCard && state.selectedAction === "fortify";
  const isAbilityTargeting =
    state.selectedAction === "ability" && state.selectedAbility;
  const isFocus = inResolution && focusId === t.id;
  const isResolved = resolvedIds.has(t.id);
  const isChainHighlight = highlightChain.includes(t.id);
  const alpha = getTerritoryAlpha(t);
  const isShiftWarning = shiftWarningIds.includes(t.id);
  const isProvisionalChain =
    provisionalChainIds && provisionalChainIds.has(t.id);

  const R = NODE_RADIUS;
  const r = isFocus ? NODE_RADIUS_FOCUS : hovered ? NODE_RADIUS_HOVERED : R;

  ctx.save();
  ctx.globalAlpha = alpha;

  // --- Tectonic shift warning ring ---
  if (isShiftWarning && !postRes) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 14, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(251, 191, 36, ${shiftPulseAlpha})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // --- Focus glow ring during resolution ---
  if (isFocus) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 12, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(167, 139, 250, 0.2)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 7, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // --- Chain glow ring ---
  if (
    isChainHighlight &&
    !isFocus &&
    state.phase === PHASE.RESOLUTION_NETWORKS
  ) {
    const chainOwner = t.owner;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 8, 0, Math.PI * 2);
    ctx.fillStyle =
      chainOwner === "player" ? "rgba(37,99,235,0.2)" : "rgba(217,119,6,0.2)";
    ctx.fill();
  }

  // --- B: Provisional network glow ring (action phase) ---
  if (isProvisionalChain && !postRes && !inResolution && t.claimedBy) {
    const netPulse = 0.08 + 0.06 * Math.sin(Date.now() / 600);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 6, 0, Math.PI * 2);
    ctx.fillStyle =
      t.claimedBy === "player"
        ? `rgba(37,99,235,${netPulse})`
        : `rgba(217,119,6,${netPulse})`;
    ctx.fill();
  }

  // --- Ability targeting glow ---
  if (isAbilityTargeting && hovered && !postRes) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(167, 139, 250, 0.25)";
    ctx.fill();
  }

  // --- Fortify target glow ---
  if (isCardTarget && hovered && !postRes) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 8, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.accentGlow;
    ctx.fill();
  }

  // --- Terrain background pattern (drawn before main circle) ---
  drawTerrainBackground(ctx, s, r, t.terrain, postRes);

  // --- Ownership background fill (claimed/owned territory) ---
  drawOwnershipBackground(ctx, s, r, t, postRes);

  // --- Main circle ---
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);

  if (
    postRes &&
    (isResolved ||
      state.phase === PHASE.GAMEOVER ||
      state.phase === PHASE.RESOLUTION_NETWORKS) &&
    t.owner
  ) {
    ctx.fillStyle = t.owner === "player" ? COLORS.player : COLORS.ai;
  } else if (isFocus && t.owner) {
    ctx.fillStyle = t.owner === "player" ? COLORS.player : COLORS.ai;
  } else if (t.claimedBy) {
    ctx.fillStyle = t.claimedBy === "player" ? COLORS.playerBg : COLORS.aiBg;
  } else {
    ctx.fillStyle = COLORS.surface2;
  }
  ctx.fill();

  // --- Border ---
  ctx.lineWidth = 2.5;
  if (isFocus) {
    ctx.strokeStyle = COLORS.accent;
    ctx.shadowColor = COLORS.accentGlow;
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else if (
    hovered &&
    state.selectedAction === "claim" &&
    !t.claimedBy &&
    !postRes
  ) {
    ctx.strokeStyle = COLORS.playerLight;
    ctx.shadowColor = COLORS.playerGlow;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else if (t.claimedBy === "player") {
    ctx.strokeStyle = COLORS.player;
    ctx.stroke();
  } else if (t.claimedBy === "ai") {
    ctx.strokeStyle = COLORS.ai;
    ctx.stroke();
  } else if (hovered) {
    ctx.strokeStyle = COLORS.textDim;
    ctx.stroke();
  } else {
    ctx.strokeStyle = COLORS.neutral;
    ctx.stroke();
  }

  // --- Terrain-specific border overlay ---
  drawTerrainBorder(ctx, s, r, t.terrain, postRes);

  // --- D: Contested territory visual escalation ---
  if (!postRes) {
    const pCards = t.cardsPlayed.filter((c) => c.owner === "player").length;
    const aCards = t.cardsPlayed.filter((c) => c.owner === "ai").length;
    const contested =
      (t.claimedBy === "player" && aCards > 0) ||
      (t.claimedBy === "ai" && pCards > 0) ||
      (pCards > 0 && aCards > 0);

    if (contested) {
      const totalCards = pCards + aCards;
      drawContestedHatch(ctx, s, r, t.claimedBy, totalCards);
    }
  }

  // --- Value badge (top-right) ---
  drawValueBadge(ctx, s, r, t, postRes, isResolved, isFocus, state);

  // --- Terrain icon (lower-left) ---
  drawTerrainIcon(ctx, s, r, t.terrain);

  // --- Territory name ---
  const isOwned =
    (postRes &&
      (isResolved ||
        state.phase === PHASE.GAMEOVER ||
        state.phase === PHASE.RESOLUTION_NETWORKS) &&
      t.owner) ||
    (isFocus && t.owner);
  ctx.fillStyle = isOwned ? "#fff" : COLORS.text;
  ctx.font = (isFocus ? "bold 15px" : "bold 13px") + " 'Inter', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(t.name, s.x, s.y - 4);

  // --- Status line under name ---
  let statusText = "";
  if (isOwned) {
    statusText = t.owner === "player" ? "YOURS" : "AI";
  } else if (!t.claimedBy && !postRes) {
    statusText = "unclaimed";
  }
  if (statusText) {
    ctx.fillStyle = isOwned ? "rgba(255,255,255,0.7)" : COLORS.textMuted;
    ctx.font = "600 9px 'Inter', sans-serif";
    ctx.fillText(statusText, s.x, s.y + 10);
  }

  // --- Card indicators ---
  drawCardIndicators(ctx, state, t, s, r, isFocus, postRes, width, height);

  // --- Claim flag icon ---
  if (t.claimedBy && !postRes) {
    const fx = s.x - r * 0.6;
    const fy = s.y - r * 0.6;
    ctx.beginPath();
    ctx.arc(fx, fy, 8, 0, Math.PI * 2);
    ctx.fillStyle = t.claimedBy === "player" ? COLORS.player : COLORS.ai;
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u2691", fx, fy + 1);
  }

  // --- Entrench indicator ---
  if (t.entrenched && !postRes) {
    ctx.fillStyle = COLORS.accentLight;
    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\uD83C\uDFF0", s.x + r * 0.55, s.y + r * 0.55);
  }

  ctx.restore();
}

// --------------------------------------------------------
// Ownership background
// --------------------------------------------------------
// Voronoi map background
// --------------------------------------------------------

// --------------------------------------------------------
// Voronoi helpers
// --------------------------------------------------------

/**
 * Deterministic hash noise in [0,1) for integer (col, row).
 * Stable across frames so water edges don't flicker.
 */
function cellNoise(col, row) {
  let h = (col * 374761393 + row * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h >>> 0) & 0xffff) / 65536;
}

/**
 * Build Voronoi region data.
 *
 * For each grid cell we store:
 *   ownerGrid  – index of closest territory
 *   secondGrid – index of 2nd-closest territory
 *   ratioGrid  – minDist/secDist as uint8 (0=deep inside, 255=on boundary)
 *   waterGrid  – 0=land, >0=water (value = depth 1-255 for alpha feathering)
 *   borderGrid – 1 if this is a land-border cell between two CONNECTED territories
 *
 * Water strategy: any cell whose two closest territories are DISCONNECTED
 * and whose distance ratio is above a noise-wobbled threshold becomes water.
 * This creates wide, natural bodies of water that fill the space between
 * disconnected territories rather than tracing a thin boundary line.
 */
function buildVoronoiRegions(territories, width, height, edges) {
  const CELL = 4;
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);

  // Build a Set of connected pairs for quick lookup
  const connected = new Set();
  if (edges) {
    for (const [a, b] of edges) {
      connected.add(a < b ? `${a},${b}` : `${b},${a}`);
    }
  }

  const cells = territories.map(() => []);
  const ownerGrid = new Int16Array(cols * rows).fill(-1);
  const secondGrid = new Int16Array(cols * rows).fill(-1);
  const ratioGrid = new Uint8Array(cols * rows);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const px = col * CELL + CELL / 2;
      const py = row * CELL + CELL / 2;

      let minDist = Infinity;
      let secDist = Infinity;
      let closest = 0;
      let second = -1;

      for (let i = 0; i < territories.length; i++) {
        const t = territories[i];
        const tx = PAD_X + t.x * (width - 2 * PAD_X);
        const ty = PAD_Y + t.y * (height - 2 * PAD_Y);
        const d = (px - tx) * (px - tx) + (py - ty) * (py - ty);
        if (d < minDist) {
          secDist = minDist;
          second = closest;
          minDist = d;
          closest = i;
        } else if (d < secDist) {
          secDist = d;
          second = i;
        }
      }

      const idx = row * cols + col;
      cells[closest].push({ col, row });
      ownerGrid[idx] = closest;
      secondGrid[idx] = second;
      ratioGrid[idx] =
        secDist > 0 ? Math.min(255, Math.floor((minDist / secDist) * 255)) : 0;
    }
  }

  // --- Water: wide fill between disconnected territories ---
  // For any cell whose closest and 2nd-closest territories are NOT connected,
  // if the distance ratio is high enough (close to the boundary between them)
  // the cell becomes water. A noise offset per-cell wobbles the cutoff so
  // coastlines are irregular.
  //
  // WATER_THRESHOLD controls how far the water extends from the boundary
  // toward the territory centre. Lower = wider water. 0.50 means "water fills
  // all cells that are in the outer 50% of the region toward that neighbor".
  const WATER_THRESHOLD = 0.5;
  const WATER_NOISE_RANGE = 0.12; // ± wobble on the threshold

  const waterGrid = new Uint8Array(cols * rows); // 0=land, 1–255=water depth

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      const here = ownerGrid[idx];
      const there = secondGrid[idx];
      if (here < 0 || there < 0) continue;

      const key = here < there ? `${here},${there}` : `${there},${here}`;
      if (connected.has(key)) continue; // connected = land, not water

      const ratio = ratioGrid[idx] / 255; // 0 = deep inside, 1 = on boundary

      // Per-cell noise wobbles the cutoff
      const noise = cellNoise(col, row);
      const cutoff =
        WATER_THRESHOLD - WATER_NOISE_RANGE + noise * WATER_NOISE_RANGE * 2;

      if (ratio > cutoff) {
        // Depth: how far past the cutoff. 0 = at coastline edge, 1 = dead centre
        const depth = Math.min(1, (ratio - cutoff) / (1 - cutoff));
        waterGrid[idx] = Math.max(1, Math.floor(depth * 255));
      }
    }
  }

  // --- Border grid: land boundaries between CONNECTED territories ---
  // A cell is a border cell if any of its 4-connected neighbors belongs
  // to a different, CONNECTED territory.
  const borderGrid = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      const here = ownerGrid[idx];
      if (here < 0) continue;
      if (waterGrid[idx]) continue; // water cells aren't land borders

      const nb = [
        col > 0 ? ownerGrid[idx - 1] : -1,
        col < cols - 1 ? ownerGrid[idx + 1] : -1,
        row > 0 ? ownerGrid[idx - cols] : -1,
        row < rows - 1 ? ownerGrid[idx + cols] : -1,
      ];
      for (const n of nb) {
        if (n >= 0 && n !== here) {
          const key = here < n ? `${here},${n}` : `${n},${here}`;
          if (connected.has(key)) {
            borderGrid[idx] = 1;
            break;
          }
        }
      }
    }
  }

  return {
    cells,
    CELL,
    cols,
    rows,
    ownerGrid,
    secondGrid,
    ratioGrid,
    waterGrid,
    borderGrid,
    connected,
  };
}

/**
 * Draw the Voronoi-based map background.
 *
 * Pass order:
 *   1. Land fills — faint ownership/neutral tints per region
 *   2. Land borders — subtle dashed lines between connected territories
 *   3. Water fill — wide dark bodies between disconnected territories
 *   4. Contested cross-hatch over land cells
 */
function drawVoronoiBackground(
  ctx,
  state,
  width,
  height,
  postRes,
  inResolution,
  resolvedIds,
  getTerritoryAlpha,
) {
  const cache = state._voronoiCache;
  if (!cache) return;

  const { cells, CELL, waterGrid, borderGrid, cols, rows } = cache;

  ctx.save();

  // --- Pass 1: land fills ---
  for (let i = 0; i < state.territories.length; i++) {
    const t = state.territories[i];
    const regionCells = cells[i];
    if (!regionCells || regionCells.length === 0) continue;

    const alpha = getTerritoryAlpha(t);

    let r, g, b, a;
    if (postRes && t.owner) {
      if (t.owner === "player") {
        r = 37;
        g = 99;
        b = 235;
        a = 0.22;
      } else {
        r = 217;
        g = 119;
        b = 6;
        a = 0.22;
      }
    } else if (t.claimedBy) {
      if (t.claimedBy === "player") {
        r = 37;
        g = 99;
        b = 235;
        a = 0.1;
      } else {
        r = 217;
        g = 119;
        b = 6;
        a = 0.1;
      }
    } else {
      // Unclaimed: very faint neutral tint so regions are visible
      r = 180;
      g = 185;
      b = 200;
      a = 0.05;
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;

    for (const { col, row } of regionCells) {
      if (waterGrid[row * cols + col]) continue;
      ctx.fillRect(col * CELL, row * CELL, CELL + 1, CELL + 1);
    }
  }

  // --- Pass 2: land borders between connected territories ---
  // Draw border cells as a faint dashed line effect using noise to
  // skip every other cell, creating a natural dashed appearance.
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (!borderGrid[idx]) continue;
      // Use noise to create a dashed effect — skip ~50% of border cells
      const n = cellNoise(col * 3, row * 3);
      if (n > 0.45) continue;
      ctx.globalAlpha = 0.08 + n * 0.06;
      ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
    }
  }

  // --- Pass 3: water fill ---
  // Each water cell has a depth value (1–255). Higher depth = deeper water
  // = higher alpha. This naturally feathers the coastline.
  ctx.fillStyle = "rgba(6, 16, 38, 1)";
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      const depth = waterGrid[idx];
      if (!depth) continue;

      // depth 1–255 maps to alpha 0.15–0.75
      const depthNorm = depth / 255;
      const noise = cellNoise(col + 77, row + 31);
      const cellAlpha = (0.15 + depthNorm * 0.6) * (0.85 + noise * 0.15);

      ctx.globalAlpha = cellAlpha;
      ctx.fillRect(col * CELL, row * CELL, CELL + 1, CELL + 1);
    }
  }

  // --- Pass 4: contested cross-hatch on land cells only ---
  for (let i = 0; i < state.territories.length; i++) {
    const t = state.territories[i];
    const regionCells = cells[i];
    if (!regionCells || regionCells.length === 0) continue;

    const pCards = t.cardsPlayed.filter((c) => c.owner === "player").length;
    const aCards = t.cardsPlayed.filter((c) => c.owner === "ai").length;
    const contested =
      !postRes &&
      ((t.claimedBy === "player" && aCards > 0) ||
        (t.claimedBy === "ai" && pCards > 0) ||
        (pCards > 0 && aCards > 0));

    if (!contested) continue;

    const hatchColor =
      t.claimedBy === "player"
        ? "rgba(217, 119, 6, 0.20)"
        : "rgba(37, 99, 235, 0.20)";

    ctx.save();
    ctx.globalAlpha = getTerritoryAlpha(t);
    ctx.beginPath();
    for (const { col, row } of regionCells) {
      if (!waterGrid[row * cols + col]) {
        ctx.rect(col * CELL, row * CELL, CELL + 1, CELL + 1);
      }
    }
    ctx.clip();

    ctx.strokeStyle = hatchColor;
    ctx.lineWidth = 1;
    const step = 8;
    for (let d = -height; d < width + height; d += step) {
      ctx.beginPath();
      ctx.moveTo(d, 0);
      ctx.lineTo(d + height, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(d, height);
      ctx.lineTo(d + height, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Draw a subtle coloured background for claimed/owned territories.
 * Blue tint for player, orange for AI. Intensifies when owned post-resolution.
 */
function drawOwnershipBackground(ctx, s, r, t, postRes) {
  // Voronoi handles the broad fill — this just adds a stronger glow
  // directly under the node circle to anchor it to its region colour.
  if (!t.claimedBy && !t.owner) return;

  ctx.save();

  const color =
    postRes && t.owner
      ? t.owner === "player"
        ? "rgba(37,99,235,0.22)"
        : "rgba(217,119,6,0.22)"
      : t.claimedBy === "player"
        ? "rgba(37,99,235,0.12)"
        : "rgba(217,119,6,0.12)";

  // Radial glow behind the node
  const grad = ctx.createRadialGradient(s.x, s.y, r * 0.2, s.x, s.y, r * 1.6);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r * 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// --------------------------------------------------------
// Contested overlay
// --------------------------------------------------------

/**
 * Draw cross-hatch pattern over a contested territory.
 * Indicates opponent has cards on your claimed territory.
 */
function drawContestedHatch(ctx, s, r, claimedBy, totalCards) {
  // Voronoi layer handles the broad hatch — this adds a tighter ring
  // around the node itself so the contested state is clear up close.
  // D: Escalates visually based on total card count.
  if (!claimedBy) return;

  totalCards = totalCards || 2;

  // Escalation tiers: 2 cards = mild, 3 = moderate, 4+ = intense
  const intensity = Math.min(totalCards, 5);
  const baseAlpha = 0.4 + intensity * 0.1;
  const pulseSpeed = 800 - intensity * 100; // faster pulse with more cards
  const pulseAlpha = baseAlpha + 0.15 * Math.sin(Date.now() / pulseSpeed);
  const ringWidth = 1.5 + intensity * 0.5;

  ctx.save();

  // Outer pulsing glow for high-tension territories (3+ cards)
  if (totalCards >= 3) {
    const glowSize = r + 8 + intensity * 2;
    const glowAlpha =
      0.06 + 0.04 * intensity * Math.abs(Math.sin(Date.now() / pulseSpeed));
    ctx.beginPath();
    ctx.arc(s.x, s.y, glowSize, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(232, 121, 249, ${glowAlpha})`;
    ctx.fill();
  }

  // Dashed ring
  ctx.beginPath();
  ctx.arc(s.x, s.y, r + 5, 0, Math.PI * 2);
  ctx.lineWidth = ringWidth;
  const dashGap = Math.max(2, 6 - intensity);
  ctx.setLineDash([4, dashGap]);

  if (totalCards >= 4) {
    // Intense: contested purple glow
    ctx.strokeStyle = `rgba(232, 121, 249, ${pulseAlpha})`;
    ctx.shadowColor = "rgba(232, 121, 249, 0.5)";
    ctx.shadowBlur = 8;
  } else {
    ctx.strokeStyle =
      claimedBy === "player"
        ? `rgba(217, 119, 6, ${pulseAlpha})`
        : `rgba(37, 99, 235, ${pulseAlpha})`;
  }

  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// --------------------------------------------------------
// Terrain background
// --------------------------------------------------------

/**
 * Draw terrain-specific background effects on the territory node.
 * Drawn before the main fill so they appear subtly underneath.
 */
function drawTerrainBackground(ctx, s, r, terrain, postRes) {
  // Terrain fills are always drawn (even post-res) so the map stays readable.
  // Intensity is reduced post-resolution.
  const alpha = postRes ? 0.18 : 0.32;

  switch (terrain) {
    case TERRAIN.SCORCHED_EARTH: {
      // Deep red fill + dense diagonal hatch
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r - 1, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = `rgba(127, 29, 29, ${alpha})`;
      ctx.fill();

      if (!postRes) {
        ctx.strokeStyle = "rgba(239, 68, 68, 0.22)";
        ctx.lineWidth = 1.5;
        const step = 7;
        for (let i = -r * 2; i < r * 2; i += step) {
          ctx.beginPath();
          ctx.moveTo(s.x + i, s.y - r);
          ctx.lineTo(s.x + i + r * 2, s.y + r * 2);
          ctx.stroke();
        }
        // Cross hatch
        ctx.strokeStyle = "rgba(239, 68, 68, 0.10)";
        for (let i = -r * 2; i < r * 2; i += step) {
          ctx.beginPath();
          ctx.moveTo(s.x + i, s.y + r);
          ctx.lineTo(s.x + i + r * 2, s.y - r * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
      break;
    }

    case TERRAIN.HIGH_GROUND: {
      // Green tinted fill with concentric rings suggesting elevation
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = `rgba(20, 83, 45, ${alpha})`;
      ctx.fill();

      if (!postRes) {
        // Concentric elevation rings
        for (let ring = 1; ring <= 2; ring++) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, r * (0.35 + ring * 0.22), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(74, 222, 128, ${0.14 - ring * 0.04})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.restore();
      break;
    }

    case TERRAIN.FOG: {
      // Blue-grey fill + radial gradient haze
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = `rgba(30, 41, 59, ${alpha + 0.1})`;
      ctx.fill();

      if (!postRes) {
        const grad = ctx.createRadialGradient(s.x, s.y, r * 0.2, s.x, s.y, r);
        grad.addColorStop(0, "rgba(148, 163, 184, 0.08)");
        grad.addColorStop(0.5, "rgba(148, 163, 184, 0.16)");
        grad.addColorStop(1, "rgba(100, 116, 139, 0.05)");
        ctx.fillStyle = grad;
        ctx.fill();
      }
      ctx.restore();
      break;
    }

    case TERRAIN.OBSERVATORY: {
      // Deep amber/gold fill + sweeping scan lines
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = `rgba(78, 52, 0, ${alpha})`;
      ctx.fill();

      if (!postRes) {
        // Scan lines radiating outward
        ctx.strokeStyle = "rgba(250, 204, 21, 0.13)";
        ctx.lineWidth = 1;
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x + Math.cos(angle) * r, s.y + Math.sin(angle) * r);
          ctx.stroke();
        }
        // Centre dot
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(250, 204, 21, 0.3)";
        ctx.fill();
      }
      ctx.restore();
      break;
    }

    case TERRAIN.CHOKEPOINT: {
      // Magenta/pink fill + diamond lattice
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = `rgba(80, 7, 36, ${alpha})`;
      ctx.fill();

      if (!postRes) {
        // Diamond grid overlay
        ctx.strokeStyle = "rgba(244, 114, 182, 0.18)";
        ctx.lineWidth = 1;
        const gs = 10;
        for (let dx = -r; dx < r; dx += gs) {
          ctx.beginPath();
          ctx.moveTo(s.x + dx, s.y - r);
          ctx.lineTo(s.x + dx + r, s.y + r);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(s.x + dx + r, s.y - r);
          ctx.lineTo(s.x + dx, s.y + r);
          ctx.stroke();
        }
      }
      ctx.restore();
      break;
    }
  }
}

// --------------------------------------------------------
// Terrain border overlay
// --------------------------------------------------------

/**
 * Draw terrain-specific border modifications.
 * Fog gets a dashed border; Chokepoint gets a diamond highlight.
 */
function drawTerrainBorder(ctx, s, r, terrain, postRes) {
  const borderAlpha = postRes ? 0.25 : 0.75;

  switch (terrain) {
    case TERRAIN.FOG: {
      // Dashed border in fog colour
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.fog;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.globalAlpha = borderAlpha * 0.6;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      break;
    }

    case TERRAIN.CHOKEPOINT: {
      // Solid bright-pink border
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 2, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.chokepoint;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = borderAlpha * 0.7;
      ctx.stroke();
      ctx.restore();
      break;
    }

    case TERRAIN.HIGH_GROUND: {
      // Double border — inner solid green ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 2, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.highGround;
      ctx.lineWidth = 2;
      ctx.globalAlpha = borderAlpha * 0.55;
      ctx.stroke();
      ctx.restore();
      break;
    }

    case TERRAIN.OBSERVATORY: {
      // Gold dashed outer ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.observatory;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.globalAlpha = borderAlpha * 0.6;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      break;
    }

    case TERRAIN.SCORCHED_EARTH: {
      // Red solid border
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 2, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.scorchedEarth;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = borderAlpha * 0.6;
      ctx.stroke();
      ctx.restore();
      break;
    }
  }
}

// --------------------------------------------------------
// Value badge
// --------------------------------------------------------

function drawValueBadge(ctx, s, r, t, postRes, isResolved, isFocus, state) {
  const badgeX = s.x + r * 0.6;
  const badgeY = s.y - r * 0.6;
  const badgeR = 12;

  ctx.beginPath();
  ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);

  const isOwned =
    (isResolved ||
      isFocus ||
      state.phase === PHASE.GAMEOVER ||
      state.phase === PHASE.RESOLUTION_NETWORKS) &&
    t.owner;

  ctx.fillStyle = isOwned
    ? t.owner === "player"
      ? "#1d4ed8"
      : "#b45309"
    : COLORS.surface3;
  ctx.fill();

  // Value text
  ctx.fillStyle = isOwned ? "#fff" : COLORS.aiLight;
  ctx.font = "bold 12px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(t.value, badgeX, badgeY + 0.5);

  // Show original value if changed by tectonic shift
  if (t.originalValue !== undefined && t.value !== t.originalValue) {
    ctx.fillStyle =
      t.value > t.originalValue ? COLORS.success : COLORS.scorchedEarth;
    ctx.font = "bold 8px 'JetBrains Mono', monospace";
    ctx.fillText(
      t.value > t.originalValue ? "\u2191" : "\u2193",
      badgeX + badgeR + 4,
      badgeY,
    );
  }
}

// --------------------------------------------------------
// Terrain icon
// --------------------------------------------------------

/**
 * Draw the terrain type icon in the lower-left of the territory node.
 * Plains have no icon.
 */
function drawTerrainIcon(ctx, s, r, terrain) {
  if (terrain === TERRAIN.PLAINS) return;

  const meta = TERRAIN_META[terrain];
  if (!meta) return;

  // Icon sits at bottom-centre of the node
  const ix = s.x;
  const iy = s.y + r * 0.52;

  // Per-terrain colour and full label
  let iconColor = COLORS.textMuted;
  let bgColor = "rgba(0,0,0,0.55)";
  let label = meta.label.toUpperCase();

  switch (terrain) {
    case TERRAIN.HIGH_GROUND:
      iconColor = COLORS.highGround;
      bgColor = "rgba(20, 83, 45, 0.75)";
      label = "▲ HIGH";
      break;
    case TERRAIN.FOG:
      iconColor = COLORS.fog;
      bgColor = "rgba(30, 41, 59, 0.80)";
      label = "◌ FOG";
      break;
    case TERRAIN.OBSERVATORY:
      iconColor = COLORS.observatory;
      bgColor = "rgba(78, 52, 0, 0.80)";
      label = "◎ OBS";
      break;
    case TERRAIN.CHOKEPOINT:
      iconColor = COLORS.chokepoint;
      bgColor = "rgba(80, 7, 36, 0.80)";
      label = "◆ CHOKE";
      break;
    case TERRAIN.SCORCHED_EARTH:
      iconColor = COLORS.scorchedEarth;
      bgColor = "rgba(127, 29, 29, 0.80)";
      label = "✕ SCORCH";
      break;
  }

  ctx.save();

  // Measure text to size the pill background
  ctx.font = "bold 8px 'Inter', sans-serif";
  const textW = ctx.measureText(label).width;
  const pillW = textW + 8;
  const pillH = 13;

  // Pill background
  const px = ix - pillW / 2;
  const py = iy - pillH / 2;
  const pr = 3;

  ctx.beginPath();
  ctx.moveTo(px + pr, py);
  ctx.lineTo(px + pillW - pr, py);
  ctx.quadraticCurveTo(px + pillW, py, px + pillW, py + pr);
  ctx.lineTo(px + pillW, py + pillH - pr);
  ctx.quadraticCurveTo(px + pillW, py + pillH, px + pillW - pr, py + pillH);
  ctx.lineTo(px + pr, py + pillH);
  ctx.quadraticCurveTo(px, py + pillH, px, py + pillH - pr);
  ctx.lineTo(px, py + pr);
  ctx.quadraticCurveTo(px, py, px + pr, py);
  ctx.closePath();

  ctx.fillStyle = bgColor;
  ctx.fill();

  // Coloured top edge for extra identity
  ctx.strokeStyle = iconColor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.8;
  ctx.stroke();

  // Label text
  ctx.globalAlpha = 1;
  ctx.fillStyle = iconColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, ix, iy + 0.5);

  ctx.restore();
}

// --------------------------------------------------------
// Card indicators
// --------------------------------------------------------

/**
 * Draw card placement indicators on a territory.
 * During resolution focus: show all cards revealed with strengths.
 * During action phase: show position indicators with fog awareness.
 */
function drawCardIndicators(
  ctx,
  state,
  t,
  s,
  r,
  isFocus,
  postRes,
  width,
  height,
) {
  if (isFocus) {
    // Resolution focus — show ALL cards revealed
    const cards = t.cardsPlayed;
    if (cards.length === 0) return;

    const totalW = cards.length * 18 - 2;
    const startX = s.x - totalW / 2;
    const cy = s.y + r + 12;

    for (let ci = 0; ci < cards.length; ci++) {
      const card = cards[ci];
      const cx = startX + ci * 18;
      ctx.fillStyle = card.owner === "player" ? COLORS.player : COLORS.ai;
      ctx.beginPath();
      ctx.arc(cx + 7, cy, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 9px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(card.isDecoy ? "D" : card.strength, cx + 7, cy + 0.5);
    }
  } else if (!postRes && t.cardsPlayed.length > 0) {
    // Action phase — show card indicators with fog awareness
    // Player sees their own cards + opponent cards on non-fog territories
    const visibleToPlayer = getVisibleCards(t, "player");

    if (visibleToPlayer.length === 0 && t.cardsPlayed.length > 0) {
      // All cards are hidden (fog territory with only opponent cards)
      // Show nothing — that's the point of fog
      return;
    }

    const cards = visibleToPlayer;
    const totalW = cards.length * 14 - 2;
    const startX = s.x - totalW / 2;
    const cy = s.y + r + 10;

    for (let ci = 0; ci < cards.length; ci++) {
      const card = cards[ci];
      const cx = startX + ci * 14;
      ctx.fillStyle = card.owner === "player" ? COLORS.player : COLORS.ai;
      ctx.beginPath();
      ctx.arc(cx + 5, cy, 5, 0, Math.PI * 2);
      ctx.fill();

      // Show strength for own cards, "?" for opponent cards (unless revealed by Intercept)
      ctx.fillStyle = "#fff";
      ctx.font = "bold 7px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      let label;
      if (card.owner === "player") {
        label = card.isDecoy ? "D" : String(card.strength);
      } else if (card.revealed) {
        label = card.isDecoy ? "D" : String(card.strength);
      } else {
        label = "?";
      }
      ctx.fillText(label, cx + 5, cy + 0.5);
    }

    // If there are hidden cards on fog territories that belong to the player,
    // show a small fog indicator
    if (t.terrain === TERRAIN.FOG) {
      const hiddenOpponentCards = t.cardsPlayed.filter(
        (c) => c.owner !== "player",
      );
      // We don't show anything for hidden opponent cards — that's intentional
    }
  }
}

// --------------------------------------------------------
// Canvas initialization
// --------------------------------------------------------

/**
 * Initialize or resize the game canvas to fit its container.
 * @param {object} state - game state (mutated: canvas, ctx, width, height, dpr)
 * @returns {function} cleanup function to remove resize listener
 */
export function initCanvas(state) {
  const canvas = document.querySelector("#game-canvas");
  const container = document.querySelector("#map-container");
  if (!canvas || !container) return () => {};

  state.canvas = canvas;
  state.ctx = canvas.getContext("2d");
  state.dpr = window.devicePixelRatio || 1;

  function resize() {
    const rect = container.getBoundingClientRect();
    state.width = rect.width;
    state.height = rect.height;
    canvas.width = rect.width * state.dpr;
    canvas.height = rect.height * state.dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  resize();
  window.addEventListener("resize", resize);

  return () => window.removeEventListener("resize", resize);
}

// --------------------------------------------------------
// Render loop
// --------------------------------------------------------

/**
 * Start the render loop. Returns a cancel function.
 * @param {object} state
 * @returns {function} cancel function
 */
export function startRenderLoop(state) {
  let running = true;

  function loop() {
    if (!running || !state.ctx) return;
    drawMap(state);
    state.animFrame = requestAnimationFrame(loop);
  }

  loop();

  return () => {
    running = false;
    if (state.animFrame) {
      cancelAnimationFrame(state.animFrame);
      state.animFrame = null;
    }
  };
}

// --------------------------------------------------------
// Tectonic shift animation helpers
// --------------------------------------------------------

/**
 * Draw a tectonic shift animation frame.
 * This is called during the TECTONIC_SHIFT phase for visual effect.
 * The actual state mutation happens in tectonic.applyShift().
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 * @param {number} progress - 0 to 1 animation progress
 * @param {object} shiftData
 */
export function drawShiftAnimation(ctx, state, progress, shiftData) {
  const { width, height } = state;

  // Screen shake effect
  if (progress < 0.3) {
    const intensity = (1 - progress / 0.3) * 4;
    const shakeX = (Math.random() - 0.5) * intensity;
    const shakeY = (Math.random() - 0.5) * intensity;
    ctx.save();
    ctx.translate(shakeX, shakeY);
  }

  // Draw the normal map first
  drawMap(state);

  if (progress < 0.3) {
    ctx.restore();
  }

  // Overlay effects for the shift
  if (shiftData.removeEdge && progress < 0.5) {
    // Flash on removed edge
    const { a, b } = shiftData.removeEdge;
    const sa = toScreen(state.territories[a], width, height);
    const sb = toScreen(state.territories[b], width, height);
    const flashAlpha = Math.max(0, 1 - progress * 4);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.strokeStyle = `rgba(239, 68, 68, ${flashAlpha})`;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.restore();
  }

  if (shiftData.addEdge && progress > 0.3) {
    // Bright flash on new edge
    const { a, b } = shiftData.addEdge;
    const sa = toScreen(state.territories[a], width, height);
    const sb = toScreen(state.territories[b], width, height);
    const fadeIn = Math.min(1, (progress - 0.3) * 3);
    const flashAlpha = fadeIn * 0.8;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.strokeStyle = `rgba(250, 204, 21, ${flashAlpha})`;
    ctx.lineWidth = 5;
    ctx.shadowColor = "rgba(250, 204, 21, 0.6)";
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.restore();
  }

  // Value change flash
  const valueTargets = [];
  if (shiftData.valueUp)
    valueTargets.push({
      id: shiftData.valueUp.territoryId,
      color: COLORS.success,
    });
  if (shiftData.valueDown)
    valueTargets.push({
      id: shiftData.valueDown.territoryId,
      color: COLORS.scorchedEarth,
    });

  if (progress > 0.5) {
    const flashAlpha = Math.max(0, 1 - (progress - 0.5) * 4);
    for (const vt of valueTargets) {
      const t = state.territories[vt.id];
      const ts = toScreen(t, width, height);
      ctx.save();
      ctx.beginPath();
      ctx.arc(ts.x, ts.y, NODE_RADIUS + 6, 0, Math.PI * 2);
      ctx.strokeStyle = vt.color;
      ctx.lineWidth = 3;
      ctx.globalAlpha = flashAlpha;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Aftershock flash
  if (shiftData.aftershock && progress > 0.7) {
    const t = state.territories[shiftData.aftershock.territoryId];
    const ts = toScreen(t, width, height);
    const flashAlpha = Math.max(0, 1 - (progress - 0.7) * 3.3);
    ctx.save();
    ctx.beginPath();
    ctx.arc(ts.x, ts.y, NODE_RADIUS + 10, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(239, 68, 68, ${flashAlpha * 0.3})`;
    ctx.fill();
    ctx.restore();
  }
}

// --------------------------------------------------------
// Tooltip data builder
// --------------------------------------------------------

/**
 * Build tooltip data for a hovered territory.
 * Used by the UI module to populate the tooltip DOM element.
 *
 * @param {object} territory
 * @param {object} state
 * @returns {object} tooltip data
 */
export function buildTooltipData(territory, state) {
  const t = territory;
  const terrainMeta = TERRAIN_META[t.terrain];

  // Status text
  let statusText;
  if (t.claimedBy === "player") {
    statusText = "\uD83D\uDD35 Claimed by You";
  } else if (t.claimedBy === "ai") {
    statusText = "\uD83D\uDFE0 Claimed by AI";
  } else {
    statusText = "Unclaimed \u2014 click to claim on your turn";
  }

  // Terrain info
  let terrainText = "";
  if (t.terrain !== TERRAIN.PLAINS) {
    terrainText = `${terrainMeta.label}: ${terrainMeta.description}`;
  }

  // --- A: Full influence breakdown preview ---
  const pCards = t.cardsPlayed.filter((c) => c.owner === "player");
  const visibleAiCards = getVisibleCards(t, "player").filter(
    (c) => c.owner === "ai",
  );
  const hiddenAiCardCount =
    t.terrain === TERRAIN.FOG
      ? 0
      : t.cardsPlayed.filter((c) => c.owner === "ai").length -
        visibleAiCards.length;

  // Build structured influence preview
  let playerInfluenceParts = [];
  let playerKnownTotal = 0;
  let aiInfluenceParts = [];
  let aiKnownTotal = 0;
  let aiHasUnknown = false;

  // Player influence components
  if (t.claimedBy === "player") {
    playerInfluenceParts.push("Flag +2");
    playerKnownTotal += 2;
  }
  if (t.terrain === TERRAIN.HIGH_GROUND && t.claimedBy === "player") {
    playerInfluenceParts.push("High Ground +1");
    playerKnownTotal += 1;
  }
  if (t.entrenched && t.claimedBy === "player" && t.entrenchBonus > 0) {
    playerInfluenceParts.push("Entrench +" + t.entrenchBonus);
    playerKnownTotal += t.entrenchBonus;
  }
  for (const c of pCards) {
    const label = c.isDecoy ? "Decoy +0" : "Card +" + c.strength;
    playerInfluenceParts.push(label);
    playerKnownTotal += c.strength;
  }

  // AI influence components
  if (t.claimedBy === "ai") {
    aiInfluenceParts.push("Flag +2");
    aiKnownTotal += 2;
  }
  if (t.terrain === TERRAIN.HIGH_GROUND && t.claimedBy === "ai") {
    aiInfluenceParts.push("High Ground +1");
    aiKnownTotal += 1;
  }
  if (t.entrenched && t.claimedBy === "ai" && t.entrenchBonus > 0) {
    aiInfluenceParts.push("Entrench +" + t.entrenchBonus);
    aiKnownTotal += t.entrenchBonus;
  }
  for (const c of visibleAiCards) {
    if (c.revealed) {
      const label = c.isDecoy ? "Decoy +0" : "Card +" + c.strength;
      aiInfluenceParts.push(label);
      aiKnownTotal += c.strength;
    } else {
      aiInfluenceParts.push("Card +?");
      aiHasUnknown = true;
    }
  }
  if (hiddenAiCardCount > 0 && t.terrain !== TERRAIN.FOG) {
    for (let i = 0; i < hiddenAiCardCount; i++) {
      aiInfluenceParts.push("Card +?");
      aiHasUnknown = true;
    }
  }

  // Build influence summary text
  const influenceLines = [];
  if (playerInfluenceParts.length > 0) {
    const totalStr = "= " + playerKnownTotal;
    influenceLines.push(
      "You: " + playerInfluenceParts.join(" \u2022 ") + " " + totalStr,
    );
  }
  if (aiInfluenceParts.length > 0) {
    const totalStr = aiHasUnknown
      ? "= " + aiKnownTotal + "+?"
      : "= " + aiKnownTotal;
    influenceLines.push(
      "AI: " + aiInfluenceParts.join(" \u2022 ") + " " + totalStr,
    );
  }
  if (
    t.terrain === TERRAIN.FOG &&
    t.cardsPlayed.some((c) => c.owner === "ai")
  ) {
    influenceLines.push("AI: \uD83C\uDF2B\uFE0F hidden (Fog)");
  }

  // Contested status
  const isContested =
    (t.claimedBy === "player" && visibleAiCards.length > 0) ||
    (t.claimedBy === "ai" && pCards.length > 0) ||
    (pCards.length > 0 && visibleAiCards.length > 0);
  let contestedText = "";
  if (isContested) {
    const totalCardCount =
      pCards.length + t.cardsPlayed.filter((c) => c.owner === "ai").length;
    if (totalCardCount >= 4) {
      contestedText = "\u26A1 HIGHLY CONTESTED";
    } else if (totalCardCount >= 3) {
      contestedText = "\u2694\uFE0F Contested";
    } else {
      contestedText = "\u2694\uFE0F Contested";
    }
  }

  // --- B: Network preview info ---
  let networkText = "";
  if (state.phase === PHASE.ACTION || state.phase === PHASE.PLANNING) {
    if (t.claimedBy) {
      const nets = calculateProvisionalNetworks(state.territories, t.claimedBy);
      const myNet = nets.find((n) => n.chain.includes(t.id));
      if (myNet) {
        const chainNames = myNet.chain.map((id) => state.territories[id].name);
        const ownerLabel = t.claimedBy === "player" ? "Your" : "AI";
        networkText = `\uD83D\uDD17 ${ownerLabel} network: ${chainNames.join(" \u2192 ")} (+${myNet.bonus} bonus)`;
      }
    }
  }

  // Connection info
  const connNames = t.connections.map((id) => state.territories[id].name);

  // Entrench info
  let entrenchText = "";
  if (t.entrenched) {
    entrenchText = `Entrenched: +${t.entrenchBonus} defender bonus`;
  }

  return {
    name: t.name,
    value: t.value + " point" + (t.value !== 1 ? "s" : ""),
    statusText,
    terrainText,
    influenceText: influenceLines.join("\n"),
    contestedText,
    networkText,
    connectionsText: "Connects to: " + connNames.join(", "),
    entrenchText,
  };
}
