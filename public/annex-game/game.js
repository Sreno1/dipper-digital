// ============================================================
// ANNEX — Prototype v0.2 — Complete Rewrite
// Smaller map, unlocked cards, real decisions
// ============================================================

(function () {
  "use strict";

  // --------------------------------------------------------
  // Constants
  // --------------------------------------------------------
  const TERRITORY_NAMES = [
    "Kessler",
    "Voss",
    "Maren",
    "Dahl",
    "Oren",
    "Thane",
    "Liora",
    "Calix",
    "Selene",
  ];

  const NETWORK_BONUS = { 3: 3, 4: 5, 5: 8, 6: 12, 7: 15 };
  function getNetworkBonus(len) {
    if (len < 3) return 0;
    if (len <= 7) return NETWORK_BONUS[len];
    return 15 + (len - 7) * 3;
  }

  // Hand strengths — fixed distribution
  const HAND_STRENGTHS = [4, 3, 2, 1, 1];

  // --------------------------------------------------------
  // Utility
  // --------------------------------------------------------
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // --------------------------------------------------------
  // Map Generation — 9 territory hex-ish grid
  // --------------------------------------------------------
  function generateMap() {
    // Fixed 9-node layout in a roughly hex pattern for readability
    // Positions in 0-1 normalized space
    const layouts = [
      // Layout: 3-3-3 hex rows
      [
        { x: 0.2, y: 0.18 },
        { x: 0.5, y: 0.15 },
        { x: 0.8, y: 0.18 },
        { x: 0.12, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.88, y: 0.5 },
        { x: 0.2, y: 0.82 },
        { x: 0.5, y: 0.85 },
        { x: 0.8, y: 0.82 },
      ],
      // Layout: diamond-ish
      [
        { x: 0.5, y: 0.1 },
        { x: 0.25, y: 0.28 },
        { x: 0.75, y: 0.28 },
        { x: 0.1, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.9, y: 0.5 },
        { x: 0.25, y: 0.72 },
        { x: 0.75, y: 0.72 },
        { x: 0.5, y: 0.9 },
      ],
      // Layout: cross-ish
      [
        { x: 0.5, y: 0.1 },
        { x: 0.25, y: 0.3 },
        { x: 0.5, y: 0.33 },
        { x: 0.75, y: 0.3 },
        { x: 0.15, y: 0.55 },
        { x: 0.5, y: 0.58 },
        { x: 0.85, y: 0.55 },
        { x: 0.35, y: 0.82 },
        { x: 0.65, y: 0.82 },
      ],
    ];

    const layout = layouts[Math.floor(Math.random() * layouts.length)];
    const names = shuffle(TERRITORY_NAMES);

    // Point values: ensure a mix. One 5, two 4s, three 3s, two 2s, one 1
    // This gives 28 total points on the board — tight, meaningful
    const values = shuffle([5, 4, 4, 3, 3, 3, 2, 2, 1]);

    const territories = layout.map((pos, i) => ({
      id: i,
      name: names[i],
      x: pos.x,
      y: pos.y,
      value: values[i],
      connections: [],
      claimedBy: null,
      cardsPlayed: [],
      owner: null,
      playerInfluence: 0,
      aiInfluence: 0,
    }));

    // Build edges: connect nodes that are close enough
    // We want 2-4 connections per node, forming a connected graph
    const edges = [];
    const edgeSet = new Set();

    function addEdge(a, b) {
      const key = Math.min(a, b) + "," + Math.max(a, b);
      if (edgeSet.has(key)) return;
      edgeSet.add(key);
      edges.push([a, b]);
      territories[a].connections.push(b);
      territories[b].connections.push(a);
    }

    // Connect each node to nearest 2-3 neighbors
    for (let i = 0; i < 9; i++) {
      const dists = [];
      for (let j = 0; j < 9; j++) {
        if (i === j) continue;
        dists.push({ j, d: dist(territories[i], territories[j]) });
      }
      dists.sort((a, b) => a.d - b.d);
      // Connect to 2 nearest always, 3rd with some probability
      const count = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let k = 0; k < Math.min(count, dists.length); k++) {
        if (
          territories[i].connections.length < 4 &&
          territories[dists[k].j].connections.length < 4
        ) {
          addEdge(i, dists[k].j);
        }
      }
    }

    // Ensure connected graph
    function getComponents() {
      const visited = new Set();
      const components = [];
      for (let i = 0; i < 9; i++) {
        if (visited.has(i)) continue;
        const comp = [];
        const queue = [i];
        visited.add(i);
        while (queue.length) {
          const cur = queue.shift();
          comp.push(cur);
          for (const nb of territories[cur].connections) {
            if (!visited.has(nb)) {
              visited.add(nb);
              queue.push(nb);
            }
          }
        }
        components.push(comp);
      }
      return components;
    }

    let components = getComponents();
    while (components.length > 1) {
      let bestD = Infinity,
        bestA = -1,
        bestB = -1;
      for (const a of components[0]) {
        for (const b of components[1]) {
          const d = dist(territories[a], territories[b]);
          if (d < bestD) {
            bestD = d;
            bestA = a;
            bestB = b;
          }
        }
      }
      addEdge(bestA, bestB);
      components = getComponents();
    }

    // Ensure min 2 connections
    for (let i = 0; i < 9; i++) {
      if (territories[i].connections.length < 2) {
        const dists = [];
        for (let j = 0; j < 9; j++) {
          if (i === j || territories[i].connections.includes(j)) continue;
          if (territories[j].connections.length >= 4) continue;
          dists.push({ j, d: dist(territories[i], territories[j]) });
        }
        dists.sort((a, b) => a.d - b.d);
        if (dists.length) addEdge(i, dists[0].j);
      }
    }

    return { territories, edges };
  }

  // --------------------------------------------------------
  // Hand Generation — UNLOCKED cards (play on any territory)
  // --------------------------------------------------------
  function generateHand(owner) {
    const strengths = shuffle([...HAND_STRENGTHS]);
    return strengths.map((str, i) => ({
      id: owner + "_" + i,
      strength: str,
      owner,
      state: "hand", // hand | played | forfeited
      playedOnTerritory: null, // set when played
    }));
  }

  // --------------------------------------------------------
  // AI Logic — smarter, reads the board
  // --------------------------------------------------------
  function aiDecide(state) {
    const { territories, aiHand } = state;
    const playableCards = aiHand.filter((c) => c.state === "hand");
    const unclaimed = territories.filter((t) => t.claimedBy === null);
    const canClaim = unclaimed.length > 0;
    const canFortify = playableCards.length > 0;

    if (!canClaim && !canFortify) return { action: "pass" };

    const strategies = [];

    // --- Evaluate claims ---
    if (canClaim) {
      for (const t of unclaimed) {
        let score = t.value * 12;
        // Network extension bonus
        for (const nbId of t.connections) {
          if (territories[nbId].claimedBy === "ai") score += 10;
          if (territories[nbId].claimedBy === "player") score += 4;
        }
        // Connectivity value
        score += t.connections.length * 3;
        // Early game: bias toward claiming (build board presence)
        const aiClaims = territories.filter(
          (t2) => t2.claimedBy === "ai",
        ).length;
        if (aiClaims < 3) score += 15;
        score += Math.random() * 6;
        strategies.push({ action: "claim", territoryId: t.id, score });
      }
    }

    // --- Evaluate fortifying ---
    if (canFortify) {
      for (const card of playableCards) {
        for (const t of territories) {
          let score = 0;

          if (t.claimedBy === "ai") {
            // Defend — especially if player has cards here
            const threatCards = t.cardsPlayed.filter(
              (c) => c.owner === "player",
            ).length;
            if (threatCards > 0) {
              // Serious threat — use strong cards
              score = 20 + card.strength * 7 + t.value * 5;
            } else {
              // Light defense — only worth it for high-value or bridge territories
              const isNetworkLink = t.connections.some(
                (nb) => territories[nb].claimedBy === "ai",
              );
              score =
                5 + card.strength * 2 + t.value * 2 + (isNetworkLink ? 8 : 0);
            }
          } else if (t.claimedBy === "player") {
            // Attack — try to annex
            score = 12 + card.strength * 8 + t.value * 4;
            // Extra value for disrupting networks
            let playerNeighborClaims = 0;
            for (const nbId of t.connections) {
              if (territories[nbId].claimedBy === "player")
                playerNeighborClaims++;
            }
            score += playerNeighborClaims * 7;
            // Bridge disruption bonus
            if (playerNeighborClaims >= 2) score += 10;
          } else {
            // Unclaimed — only worth it with weak cards as bluffs
            score = card.strength <= 1 ? 8 + t.value * 2 : 2;
          }

          // Bluffing: sometimes play str-1 on player territories
          if (
            card.strength === 1 &&
            t.claimedBy === "player" &&
            Math.random() < 0.35
          ) {
            score += 14;
          }

          // Don't stack too many cards on one territory (diminishing returns)
          const existingAiCards = t.cardsPlayed.filter(
            (c) => c.owner === "ai",
          ).length;
          if (existingAiCards >= 1) score *= 0.4;
          if (existingAiCards >= 2) score *= 0.1;

          score += Math.random() * 4;
          strategies.push({
            action: "fortify",
            card,
            territoryId: t.id,
            score,
          });
        }
      }
    }

    strategies.sort((a, b) => b.score - a.score);
    const pick = Math.random() < 0.75 ? 0 : Math.min(1, strategies.length - 1);
    return strategies[pick] || { action: "pass" };
  }

  // --------------------------------------------------------
  // Game State
  // --------------------------------------------------------
  let state = null;

  function newGame() {
    const map = generateMap();
    const playerHand = generateHand("player");
    const aiHand = generateHand("ai");

    state = {
      phase: "planning", // planning | action | resolution | resolution-networks | gameover
      territories: map.territories,
      edges: map.edges,
      playerHand,
      aiHand,
      currentTurn: Math.random() < 0.5 ? "player" : "ai",
      turnNumber: 1,
      selectedAction: null,
      selectedCard: null,
      hoveredTerritory: null,
      highlightedTerritories: [],
      consecutivePasses: 0,
      resolutionOrder: [],
      resolutionIndex: 0,
      resolutionFocusTerritory: null, // id of territory currently being shown
      resolutionResolvedIds: new Set(), // ids already resolved
      resolutionRunningPlayer: 0, // running score tally
      resolutionRunningAI: 0,
      resolutionHighlightChain: [], // territory ids to highlight for network
      scores: { player: 0, ai: 0 },
      breakdown: null,
      canvas: null,
      ctx: null,
      width: 0,
      height: 0,
      dpr: 1,
      animFrame: null,
      actionLog: [],
    };
    return state;
  }

  // --------------------------------------------------------
  // Resolution & Scoring
  // --------------------------------------------------------
  function resolveTerritory(t) {
    let pInf = 0,
      aInf = 0;
    if (t.claimedBy === "player") pInf += 2;
    if (t.claimedBy === "ai") aInf += 2;
    for (const c of t.cardsPlayed) {
      if (c.owner === "player") pInf += c.strength;
      else aInf += c.strength;
    }
    t.playerInfluence = pInf;
    t.aiInfluence = aInf;

    if (pInf > aInf) t.owner = "player";
    else if (aInf > pInf) t.owner = "ai";
    else {
      if (t.claimedBy) t.owner = t.claimedBy;
      else t.owner = null;
    }
    return {
      pInf,
      aInf,
      owner: t.owner,
      annexed: t.owner && t.claimedBy && t.claimedBy !== t.owner,
    };
  }

  function calculateNetworks(territories, owner) {
    const owned = territories.filter((t) => t.owner === owner);
    const ownedSet = new Set(owned.map((t) => t.id));
    const visited = new Set();
    const networks = [];
    for (const t of owned) {
      if (visited.has(t.id)) continue;
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
      if (chain.length >= 3) networks.push(chain);
    }
    return networks;
  }

  function calculateScores() {
    let pTP = 0,
      aTP = 0,
      pAnn = 0,
      aAnn = 0;
    for (const t of state.territories) {
      if (t.owner === "player") pTP += t.value;
      else if (t.owner === "ai") aTP += t.value;
      if (t.owner === "player" && t.claimedBy === "ai") pAnn++;
      if (t.owner === "ai" && t.claimedBy === "player") aAnn++;
    }
    const pNets = calculateNetworks(state.territories, "player");
    const aNets = calculateNetworks(state.territories, "ai");
    let pNP = 0;
    for (const n of pNets) pNP += getNetworkBonus(n.length);
    let aNP = 0;
    for (const n of aNets) aNP += getNetworkBonus(n.length);
    const pTotal = pTP + pNP,
      aTotal = aTP + aNP;
    let winner;
    if (pTotal > aTotal) winner = "player";
    else if (aTotal > pTotal) winner = "ai";
    else if (pAnn > aAnn) winner = "player";
    else if (aAnn > pAnn) winner = "ai";
    else winner = "draw";

    return {
      player: pTotal,
      ai: aTotal,
      playerTerritoryPts: pTP,
      aiTerritoryPts: aTP,
      playerNetworkPts: pNP,
      aiNetworkPts: aNP,
      playerAnnexations: pAnn,
      aiAnnexations: aAnn,
      playerNetworks: pNets,
      aiNetworks: aNets,
      playerTerritoryCount: state.territories.filter(
        (t) => t.owner === "player",
      ).length,
      aiTerritoryCount: state.territories.filter((t) => t.owner === "ai")
        .length,
      winner,
    };
  }

  // --------------------------------------------------------
  // DOM Helpers
  // --------------------------------------------------------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function showScreen(id) {
    $$(".screen").forEach((s) => s.classList.remove("active"));
    $(id).classList.add("active");
  }
  function showOverlay(id) {
    $(id).classList.add("active");
  }
  function hideOverlay(id) {
    $(id).classList.remove("active");
  }

  function notify(text, type) {
    const area = $("#notification-area");
    const el = document.createElement("div");
    el.className = "notification " + (type || "");
    el.textContent = text;
    area.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function logAction(text, type) {
    if (!state) return;
    state.actionLog.push({ text, type, turn: state.turnNumber });
    renderActionLog();
  }

  function renderActionLog() {
    const container = $("#action-log-entries");
    if (!container) return;
    container.innerHTML = "";
    const recent = state.actionLog.slice(-8);
    for (const entry of recent) {
      const el = document.createElement("div");
      el.className = "log-entry log-" + (entry.type || "neutral");
      el.textContent = entry.text;
      container.appendChild(el);
    }
    container.scrollTop = container.scrollHeight;
  }

  // --------------------------------------------------------
  // Canvas Rendering
  // --------------------------------------------------------
  let resizeHandler = null;

  function initCanvas() {
    const canvas = $("#game-canvas");
    const container = $("#map-container");
    state.canvas = canvas;
    state.ctx = canvas.getContext("2d");
    state.dpr = window.devicePixelRatio || 1;

    if (resizeHandler) window.removeEventListener("resize", resizeHandler);
    resizeHandler = () => {
      const rect = container.getBoundingClientRect();
      state.width = rect.width;
      state.height = rect.height;
      canvas.width = rect.width * state.dpr;
      canvas.height = rect.height * state.dpr;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    };
    resizeHandler();
    window.addEventListener("resize", resizeHandler);
  }

  function toScreen(t) {
    const padX = 80,
      padY = 60;
    return {
      x: padX + t.x * (state.width - 2 * padX),
      y: padY + t.y * (state.height - 2 * padY),
    };
  }

  function getTerritoryAt(mx, my) {
    for (const t of state.territories) {
      const s = toScreen(t);
      if (Math.hypot(mx - s.x, my - s.y) < 38) return t;
    }
    return null;
  }

  const C = {
    player: "#2563eb",
    playerLight: "#60a5fa",
    playerBg: "rgba(37,99,235,0.18)",
    playerGlow: "rgba(37,99,235,0.5)",
    ai: "#d97706",
    aiLight: "#fbbf24",
    aiBg: "rgba(217,119,6,0.18)",
    aiGlow: "rgba(217,119,6,0.5)",
    neutral: "#3a3f54",
    contested: "#e879f9",
    edge: "rgba(255,255,255,0.06)",
    edgeOwned: "rgba(255,255,255,0.2)",
    text: "#e8eaed",
    textDim: "#8b8fa3",
    textMuted: "#5a5e72",
    surface: "#181a24",
    surface2: "#1e2130",
    surface3: "#262a3a",
    accent: "#a78bfa",
    accentGlow: "rgba(167,139,250,0.5)",
    success: "#22c55e",
  };

  function drawMap() {
    const ctx = state.ctx;
    ctx.clearRect(0, 0, state.width, state.height);

    const inResolution =
      state.phase === "resolution" || state.phase === "resolution-networks";
    const isPostResolution = inResolution || state.phase === "gameover";
    const focusId = state.resolutionFocusTerritory;
    const resolvedIds = state.resolutionResolvedIds;
    const highlightChain = state.resolutionHighlightChain || [];

    // --- Dim non-focus territories during resolution ---
    function getTerritoryAlpha(t) {
      if (!inResolution) return 1;
      if (focusId === t.id) return 1;
      if (highlightChain.length > 0 && highlightChain.includes(t.id)) return 1;
      if (resolvedIds.has(t.id)) return 0.55;
      return 0.25;
    }

    // --- Draw edges ---
    for (const [a, b] of state.edges) {
      const sa = toScreen(state.territories[a]);
      const sb = toScreen(state.territories[b]);
      const ta = state.territories[a];
      const tb = state.territories[b];

      const sameOwner = isPostResolution && ta.owner && ta.owner === tb.owner;
      const sameClaim = ta.claimedBy && ta.claimedBy === tb.claimedBy;

      // Network chain highlight
      const bothInChain =
        highlightChain.includes(a) &&
        highlightChain.includes(b) &&
        ta.owner &&
        ta.owner === tb.owner;

      ctx.save();

      // Edge alpha during resolution
      if (inResolution) {
        const edgeAlpha = Math.max(
          getTerritoryAlpha(ta),
          getTerritoryAlpha(tb),
        );
        ctx.globalAlpha = edgeAlpha;
      }

      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);

      if (bothInChain) {
        ctx.strokeStyle = ta.owner === "player" ? C.playerLight : C.aiLight;
        ctx.lineWidth = 4;
        ctx.shadowColor = ta.owner === "player" ? C.playerGlow : C.aiGlow;
        ctx.shadowBlur = 12;
      } else if (sameOwner) {
        ctx.strokeStyle = ta.owner === "player" ? C.playerGlow : C.aiGlow;
        ctx.lineWidth = 3.5;
      } else if (sameClaim) {
        const col =
          ta.claimedBy === "player"
            ? "rgba(37,99,235,0.12)"
            : "rgba(217,119,6,0.12)";
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
      } else {
        ctx.strokeStyle = C.edge;
        ctx.lineWidth = 1.5;
      }
      ctx.stroke();
      ctx.restore();
    }

    // --- Draw territories ---
    for (const t of state.territories) {
      const s = toScreen(t);
      const hovered = state.hoveredTerritory === t.id;
      const highlighted = state.highlightedTerritories.includes(t.id);
      const isCardTarget =
        state.selectedCard && state.selectedAction === "fortify";
      const isFocus = inResolution && focusId === t.id;
      const isResolved = resolvedIds.has(t.id);
      const isChainHighlight = highlightChain.includes(t.id);
      const alpha = getTerritoryAlpha(t);

      const R = 36;
      const r = isFocus ? 44 : hovered ? 40 : R;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Focus glow ring during resolution
      if (isFocus) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 12, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(167, 139, 250, 0.2)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 7, 0, Math.PI * 2);
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Chain glow ring
      if (
        isChainHighlight &&
        !isFocus &&
        state.phase === "resolution-networks"
      ) {
        const chainOwner = t.owner;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 8, 0, Math.PI * 2);
        ctx.fillStyle =
          chainOwner === "player"
            ? "rgba(37,99,235,0.2)"
            : "rgba(217,119,6,0.2)";
        ctx.fill();
      }

      // Glow ring for highlighted (valid fortify target)
      if (isCardTarget && hovered) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 8, 0, Math.PI * 2);
        ctx.fillStyle = C.accentGlow;
        ctx.fill();
      }

      // Main circle
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);

      if (
        isPostResolution &&
        (isResolved ||
          state.phase === "gameover" ||
          state.phase === "resolution-networks") &&
        t.owner
      ) {
        ctx.fillStyle = t.owner === "player" ? C.player : C.ai;
      } else if (isFocus && t.owner) {
        // Just resolved: show owner color
        ctx.fillStyle = t.owner === "player" ? C.player : C.ai;
      } else if (t.claimedBy) {
        ctx.fillStyle = t.claimedBy === "player" ? C.playerBg : C.aiBg;
      } else {
        ctx.fillStyle = C.surface2;
      }
      ctx.fill();

      // Border
      ctx.lineWidth = 2.5;
      if (isFocus) {
        ctx.strokeStyle = C.accent;
        ctx.shadowColor = C.accentGlow;
        ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (hovered && state.selectedAction === "claim" && !t.claimedBy) {
        ctx.strokeStyle = C.playerLight;
        ctx.shadowColor = C.playerGlow;
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (t.claimedBy === "player") {
        ctx.strokeStyle = C.player;
        ctx.stroke();
      } else if (t.claimedBy === "ai") {
        ctx.strokeStyle = C.ai;
        ctx.stroke();
      } else if (hovered) {
        ctx.strokeStyle = C.textDim;
        ctx.stroke();
      } else {
        ctx.strokeStyle = C.neutral;
        ctx.stroke();
      }

      // Contested dashed ring (only during action phase)
      if (!isPostResolution) {
        const pCards = t.cardsPlayed.filter((c) => c.owner === "player").length;
        const aCards = t.cardsPlayed.filter((c) => c.owner === "ai").length;
        const contested =
          (t.claimedBy === "player" && aCards > 0) ||
          (t.claimedBy === "ai" && pCards > 0) ||
          (pCards > 0 && aCards > 0);

        if (contested) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, r + 5, 0, Math.PI * 2);
          ctx.lineWidth = 2;
          ctx.strokeStyle = C.contested;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // --- Value badge (top-right) ---
      const badgeX = s.x + r * 0.6;
      const badgeY = s.y - r * 0.6;
      const badgeR = 12;
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
      const isOwned =
        (isResolved ||
          isFocus ||
          state.phase === "gameover" ||
          state.phase === "resolution-networks") &&
        t.owner;
      ctx.fillStyle = isOwned
        ? t.owner === "player"
          ? "#1d4ed8"
          : "#b45309"
        : C.surface3;
      ctx.fill();
      ctx.fillStyle = isOwned ? "#fff" : C.aiLight;
      ctx.font = "bold 12px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(t.value, badgeX, badgeY + 0.5);

      // --- Territory name ---
      ctx.fillStyle = isOwned ? "#fff" : C.text;
      ctx.font = (isFocus ? "bold 15px" : "bold 13px") + " 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(t.name, s.x, s.y - 4);

      // --- Status line under name ---
      let statusText = "";
      if (isOwned) {
        statusText = t.owner === "player" ? "YOURS" : "AI";
      } else if (!t.claimedBy && !isPostResolution) {
        statusText = "unclaimed";
      }
      if (statusText) {
        ctx.fillStyle = isOwned ? "rgba(255,255,255,0.7)" : C.textMuted;
        ctx.font = "600 9px 'Inter', sans-serif";
        ctx.fillText(statusText, s.x, s.y + 10);
      }

      // --- Card indicators (only during action, or during resolution focus for all cards revealed) ---
      if (isFocus) {
        // Show ALL cards revealed on the focus territory
        const cards = t.cardsPlayed;
        if (cards.length > 0) {
          const totalW = cards.length * 18 - 2;
          const startX = s.x - totalW / 2;
          const cy = s.y + r + 12;
          for (let ci = 0; ci < cards.length; ci++) {
            const card = cards[ci];
            const cx = startX + ci * 18;
            ctx.fillStyle = card.owner === "player" ? C.player : C.ai;
            ctx.beginPath();
            ctx.arc(cx + 7, cy, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.font = "bold 9px 'JetBrains Mono', monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(card.strength, cx + 7, cy + 0.5);
          }
        }
      } else if (!isPostResolution && t.cardsPlayed.length > 0) {
        const cards = t.cardsPlayed;
        const totalW = cards.length * 14 - 2;
        const startX = s.x - totalW / 2;
        const cy = s.y + r + 10;
        for (let ci = 0; ci < cards.length; ci++) {
          const card = cards[ci];
          const cx = startX + ci * 14;
          ctx.fillStyle = card.owner === "player" ? C.player : C.ai;
          ctx.beginPath();
          ctx.arc(cx + 5, cy, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.font = "bold 7px 'JetBrains Mono', monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            card.owner === "player" ? card.strength : "?",
            cx + 5,
            cy + 0.5,
          );
        }
      }

      // --- Claim flag icon ---
      if (t.claimedBy && !isPostResolution) {
        const fx = s.x - r * 0.6;
        const fy = s.y - r * 0.6;
        ctx.beginPath();
        ctx.arc(fx, fy, 8, 0, Math.PI * 2);
        ctx.fillStyle = t.claimedBy === "player" ? C.player : C.ai;
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("⚑", fx, fy + 1);
      }

      ctx.restore();
    }
  }

  function renderLoop() {
    if (!state || !state.ctx) return;
    drawMap();
    state.animFrame = requestAnimationFrame(renderLoop);
  }

  // --------------------------------------------------------
  // UI Update
  // --------------------------------------------------------
  function updateUI() {
    if (!state) return;

    const inResolution =
      state.phase === "resolution" ||
      state.phase === "resolution-networks" ||
      state.phase === "gameover";

    // Turn indicator
    const turnEl = $("#turn-indicator");
    if (state.phase === "action") {
      if (state.currentTurn === "player") {
        turnEl.textContent = "⬤ Your Turn";
        turnEl.className = "turn-indicator your-turn";
      } else {
        turnEl.textContent = "◯ AI Thinking...";
        turnEl.className = "turn-indicator ai-turn";
      }
    } else if (state.phase === "planning") {
      turnEl.textContent = "Review your hand";
      turnEl.className = "turn-indicator";
    } else if (inResolution) {
      turnEl.textContent = "";
      turnEl.className = "turn-indicator";
    } else {
      turnEl.textContent = "";
      turnEl.className = "turn-indicator";
    }

    // Cards remaining
    const pCards = state.playerHand.filter((c) => c.state === "hand").length;
    const aCards = state.aiHand.filter((c) => c.state === "hand").length;
    $("#player-cards-remaining").textContent =
      pCards + " card" + (pCards !== 1 ? "s" : "");
    $("#ai-cards-remaining").textContent =
      aCards + " card" + (aCards !== 1 ? "s" : "");

    // Phase
    const phaseEl = $("#phase-indicator");
    if (state.phase === "planning") {
      phaseEl.textContent = "PLANNING";
      phaseEl.className = "phase-indicator";
    } else if (state.phase === "action") {
      phaseEl.textContent = "TURN " + state.turnNumber;
      phaseEl.className = "phase-indicator";
    } else if (
      state.phase === "resolution" ||
      state.phase === "resolution-networks"
    ) {
      phaseEl.textContent = "RESOLUTION";
      phaseEl.className = "phase-indicator resolution-phase";
    } else if (state.phase === "gameover") {
      phaseEl.textContent = "GAME OVER";
      phaseEl.className = "phase-indicator resolution-phase";
    }

    // Action buttons
    const isPlayerTurn =
      state.currentTurn === "player" && state.phase === "action";
    const unclaimedExist = state.territories.some((t) => !t.claimedBy);
    const hasCards = state.playerHand.some((c) => c.state === "hand");

    $("#btn-claim").disabled = !(isPlayerTurn && unclaimedExist);
    $("#btn-fortify").disabled = !(isPlayerTurn && hasCards);
    $("#btn-pass").disabled = !(isPlayerTurn && !unclaimedExist);

    $("#btn-claim").classList.toggle(
      "active-action",
      state.selectedAction === "claim",
    );
    $("#btn-fortify").classList.toggle(
      "active-action",
      state.selectedAction === "fortify",
    );

    // Planning phase elements
    const planningPanel = $("#planning-panel");
    if (planningPanel) {
      planningPanel.style.display =
        state.phase === "planning" ? "flex" : "none";
    }
    const actionPanel = $("#action-panel");
    if (actionPanel) {
      actionPanel.style.display = state.phase === "action" ? "flex" : "none";
    }

    if (!inResolution) {
      renderHand();
    }
    updateInfoPanel();
  }

  function updateInfoPanel() {
    // Score projection or territory summary
    const infoEl = $("#info-summary");
    if (!infoEl) return;

    const pClaimed = state.territories.filter(
      (t) => t.claimedBy === "player",
    ).length;
    const aClaimed = state.territories.filter(
      (t) => t.claimedBy === "ai",
    ).length;
    const unclaimed = 9 - pClaimed - aClaimed;
    const pCards = state.playerHand.filter((c) => c.state === "hand").length;
    const aCards = state.aiHand.filter((c) => c.state === "hand").length;

    let contested = 0;
    for (const t of state.territories) {
      const pc = t.cardsPlayed.filter((c) => c.owner === "player").length;
      const ac = t.cardsPlayed.filter((c) => c.owner === "ai").length;
      if (
        (t.claimedBy === "player" && ac > 0) ||
        (t.claimedBy === "ai" && pc > 0) ||
        (pc > 0 && ac > 0)
      )
        contested++;
    }

    infoEl.innerHTML = `
      <div class="info-row"><span class="info-label">Territories</span><span class="info-vals"><span class="info-blue">${pClaimed}</span> / <span class="info-amber">${aClaimed}</span> / <span class="info-muted">${unclaimed} open</span></span></div>
      <div class="info-row"><span class="info-label">Cards Left</span><span class="info-vals"><span class="info-blue">${pCards}</span> / <span class="info-amber">${aCards}</span></span></div>
      ${contested > 0 ? `<div class="info-row"><span class="info-label">Contested</span><span class="info-vals"><span class="info-contested">${contested} territor${contested > 1 ? "ies" : "y"}</span></span></div>` : ""}
    `;
  }

  function renderHand() {
    const container = $("#hand-cards");
    if (!container) return;
    container.innerHTML = "";

    for (const card of state.playerHand) {
      const el = document.createElement("div");
      el.className = "card strength-" + card.strength;
      if (card.state !== "hand") el.classList.add("played");
      if (state.selectedCard && state.selectedCard.id === card.id)
        el.classList.add("selected");

      const dots = "●".repeat(card.strength) + "○".repeat(4 - card.strength);

      if (card.state === "hand") {
        el.innerHTML = `
          <div class="card-strength-pips">${dots}</div>
          <div class="card-strength-num">${card.strength}</div>
          <div class="card-strength-label">INFLUENCE</div>
        `;
        el.addEventListener("click", () => {
          if (state.currentTurn !== "player" || state.phase !== "action")
            return;
          selectCard(card);
        });
      } else {
        const tName =
          card.playedOnTerritory != null
            ? state.territories[card.playedOnTerritory].name
            : "?";
        el.innerHTML = `
          <div class="card-played-label">PLAYED</div>
          <div class="card-played-target">${tName}</div>
          <div class="card-strength-num played-num">${card.strength}</div>
        `;
      }
      container.appendChild(el);
    }
  }

  function selectCard(card) {
    if (state.selectedCard && state.selectedCard.id === card.id) {
      state.selectedCard = null;
      state.selectedAction = null;
    } else {
      state.selectedCard = card;
      state.selectedAction = "fortify";
    }
    updateUI();
  }

  // --------------------------------------------------------
  // Actions
  // --------------------------------------------------------
  function playerClaim(tId) {
    const t = state.territories[tId];
    if (!t || t.claimedBy) return false;
    if (state.currentTurn !== "player" || state.phase !== "action")
      return false;

    t.claimedBy = "player";
    state.selectedAction = null;
    state.selectedCard = null;
    state.consecutivePasses = 0;
    logAction("You claimed " + t.name + " (" + t.value + "pt)", "player");
    notify("You claimed " + t.name, "blue");
    endTurn();
    return true;
  }

  function playerFortify(card, tId) {
    if (!card || card.state !== "hand") return false;
    if (state.currentTurn !== "player" || state.phase !== "action")
      return false;

    const t = state.territories[tId];
    card.state = "played";
    card.playedOnTerritory = tId;
    t.cardsPlayed.push(card);
    state.selectedAction = null;
    state.selectedCard = null;
    state.consecutivePasses = 0;
    logAction(
      "You fortified " + t.name + " (str " + card.strength + ")",
      "player",
    );
    notify("Fortified " + t.name, "blue");
    endTurn();
    return true;
  }

  function playerPass() {
    if (state.currentTurn !== "player" || state.phase !== "action")
      return false;
    for (const c of state.playerHand) {
      if (c.state === "hand") c.state = "forfeited";
    }
    state.consecutivePasses++;
    state.selectedAction = null;
    state.selectedCard = null;
    logAction("You passed", "player");
    notify("You passed", "blue");
    endTurn();
    return true;
  }

  function aiTurn() {
    if (!state || state.phase !== "action") return;

    const playable = state.aiHand.filter((c) => c.state === "hand");
    const unclaimed = state.territories.some((t) => !t.claimedBy);

    if (!unclaimed && playable.length === 0) {
      state.consecutivePasses++;
      logAction("AI passed", "ai");
      notify("AI passed", "amber");
      endTurn();
      return;
    }

    const decision = aiDecide(state);

    if (decision.action === "claim") {
      const t = state.territories[decision.territoryId];
      if (t && !t.claimedBy) {
        t.claimedBy = "ai";
        state.consecutivePasses = 0;
        logAction("AI claimed " + t.name + " (" + t.value + "pt)", "ai");
        notify("AI claimed " + t.name, "amber");
      } else {
        const fallback = state.territories.find((t2) => !t2.claimedBy);
        if (fallback) {
          fallback.claimedBy = "ai";
          state.consecutivePasses = 0;
          logAction("AI claimed " + fallback.name, "ai");
          notify("AI claimed " + fallback.name, "amber");
        } else {
          state.consecutivePasses++;
        }
      }
    } else if (decision.action === "fortify" && decision.card) {
      const card = decision.card;
      const t = state.territories[decision.territoryId];
      card.state = "played";
      card.playedOnTerritory = decision.territoryId;
      t.cardsPlayed.push(card);
      state.consecutivePasses = 0;
      logAction("AI fortified " + t.name, "ai");
      notify("AI fortified " + t.name, "amber");
    } else {
      for (const c of state.aiHand) {
        if (c.state === "hand") c.state = "forfeited";
      }
      state.consecutivePasses++;
      logAction("AI passed", "ai");
      notify("AI passed", "amber");
    }
    endTurn();
  }

  function endTurn() {
    state.turnNumber++;
    const pCards = state.playerHand.filter((c) => c.state === "hand").length;
    const aCards = state.aiHand.filter((c) => c.state === "hand").length;
    const unclaimed = state.territories.some((t) => !t.claimedBy);
    const pCan = unclaimed || pCards > 0;
    const aCan = unclaimed || aCards > 0;

    if ((!pCan && !aCan) || state.consecutivePasses >= 2) {
      startResolution();
      return;
    }

    state.currentTurn = state.currentTurn === "player" ? "ai" : "player";

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

    updateUI();
    if (state.currentTurn === "ai") {
      setTimeout(aiTurn, 700 + Math.random() * 500);
    }
  }

  // --------------------------------------------------------
  // Resolution
  // --------------------------------------------------------
  function startResolution() {
    state.phase = "resolution";
    state.currentTurn = null;

    const order = [...state.territories].sort((a, b) => a.value - b.value);
    state.resolutionOrder = order;
    state.resolutionIndex = 0;
    state.resolutionFocusTerritory = null;
    state.resolutionResolvedIds = new Set();
    state.resolutionRunningPlayer = 0;
    state.resolutionRunningAI = 0;
    state.resolutionHighlightChain = [];

    // Resolve all territories (compute influence totals + owners)
    for (const t of state.territories) resolveTerritory(t);
    state.breakdown = calculateScores();
    state.scores = { player: state.breakdown.player, ai: state.breakdown.ai };

    // Hide action panel, show tally
    const actionPanel = $("#action-panel");
    if (actionPanel) actionPanel.style.display = "none";
    const planningPanel = $("#planning-panel");
    if (planningPanel) planningPanel.style.display = "none";

    // Show the resolution tally bar
    const tally = $("#resolution-tally");
    tally.classList.remove("hidden");
    $("#res-tally-player-pts").textContent = "0";
    $("#res-tally-ai-pts").textContent = "0";
    $("#res-tally-sub").textContent =
      "Territories scored: 0 / " + state.territories.length;

    // Update phase indicator
    const phaseEl = $("#phase-indicator");
    if (phaseEl) {
      phaseEl.textContent = "RESOLUTION";
      phaseEl.className = "phase-indicator resolution-phase";
    }

    updateUI();

    // Brief pause then start stepping
    setTimeout(() => showResolutionStep(), 600);
  }

  function showResolutionStep() {
    if (!state || state.phase !== "resolution") return;

    if (state.resolutionIndex >= state.resolutionOrder.length) {
      // Done with territories — move to network phase
      state.resolutionFocusTerritory = null;
      setTimeout(showNetworkPhase, 400);
      return;
    }

    const t = state.resolutionOrder[state.resolutionIndex];
    state.resolutionFocusTerritory = t.id;

    // Show the detail panel
    const panel = $("#res-detail-panel");
    panel.classList.remove("hidden");

    // Territory name and value
    $("#res-detail-name").textContent = t.name;
    $("#res-detail-value").textContent =
      t.value + " pt" + (t.value !== 1 ? "s" : "");

    // Build influence component tags
    const pCards = t.cardsPlayed.filter((c) => c.owner === "player");
    const aCards = t.cardsPlayed.filter((c) => c.owner === "ai");

    const pCompEl = $("#res-detail-player-components");
    const aCompEl = $("#res-detail-ai-components");
    pCompEl.innerHTML = "";
    aCompEl.innerHTML = "";

    // Player components
    const pParts = [];
    if (t.claimedBy === "player")
      pParts.push('<span class="res-comp-tag tag-claim">Flag +2</span>');
    for (const c of pCards)
      pParts.push(
        '<span class="res-comp-tag tag-card">Card +' + c.strength + "</span>",
      );
    pCompEl.innerHTML =
      pParts.length > 0
        ? pParts.join("")
        : '<span style="color:var(--text-muted)">—</span>';

    // AI components
    const aParts = [];
    if (t.claimedBy === "ai")
      aParts.push('<span class="res-comp-tag tag-claim">Flag +2</span>');
    for (const c of aCards)
      aParts.push(
        '<span class="res-comp-tag tag-card">Card +' + c.strength + "</span>",
      );
    aCompEl.innerHTML =
      aParts.length > 0
        ? aParts.join("")
        : '<span style="color:var(--text-muted)">—</span>';

    // Reset bars
    $("#res-detail-player-bar").style.width = "0%";
    $("#res-detail-ai-bar").style.width = "0%";
    $("#res-detail-player-total").textContent = "0";
    $("#res-detail-ai-total").textContent = "0";
    $("#res-detail-result").textContent = "";
    $("#res-detail-result").className = "res-detail-result";

    // Animate bars after a beat
    const maxInf = Math.max(t.playerInfluence, t.aiInfluence, 1);
    setTimeout(() => {
      if (!state || state.phase !== "resolution") return;
      $("#res-detail-player-bar").style.width =
        (t.playerInfluence / (maxInf + 1)) * 100 + "%";
      $("#res-detail-ai-bar").style.width =
        (t.aiInfluence / (maxInf + 1)) * 100 + "%";
      $("#res-detail-player-total").textContent = t.playerInfluence;
      $("#res-detail-ai-total").textContent = t.aiInfluence;
    }, 200);

    // Show result after bars animate
    setTimeout(() => {
      if (!state || state.phase !== "resolution") return;
      const annexed = t.owner && t.claimedBy && t.claimedBy !== t.owner;
      const resEl = $("#res-detail-result");
      if (t.owner === "player") {
        resEl.textContent = annexed
          ? "⚡ ANNEXED — You seized it! (+" + t.value + "pt)"
          : "You hold this territory (+" + t.value + "pt)";
        resEl.className =
          "res-detail-result player-wins" + (annexed ? " annexation" : "");
      } else if (t.owner === "ai") {
        resEl.textContent = annexed
          ? "⚡ ANNEXED — AI seized it! (+" + t.value + "pt)"
          : "AI holds this territory (+" + t.value + "pt)";
        resEl.className =
          "res-detail-result ai-wins" + (annexed ? " annexation" : "");
      } else {
        resEl.textContent = "Neutral — no points";
        resEl.className = "res-detail-result neutral-result";
      }
    }, 650);

    // Update button text
    const btn = $("#btn-res-next");
    btn.innerHTML =
      state.resolutionIndex >= state.resolutionOrder.length - 1
        ? "Network Bonuses &rarr;"
        : "Next Territory &rarr;";
  }

  function advanceResolution() {
    if (!state) return;

    const t = state.resolutionOrder[state.resolutionIndex];

    // Add to resolved set and update running score
    state.resolutionResolvedIds.add(t.id);
    if (t.owner === "player") state.resolutionRunningPlayer += t.value;
    if (t.owner === "ai") state.resolutionRunningAI += t.value;

    // Animate the tally update
    const pPtsEl = $("#res-tally-player-pts");
    const aPtsEl = $("#res-tally-ai-pts");
    pPtsEl.textContent = state.resolutionRunningPlayer;
    aPtsEl.textContent = state.resolutionRunningAI;
    pPtsEl.classList.remove("pts-bump");
    aPtsEl.classList.remove("pts-bump");
    void pPtsEl.offsetWidth; // force reflow
    if (t.owner === "player") pPtsEl.classList.add("pts-bump");
    if (t.owner === "ai") aPtsEl.classList.add("pts-bump");

    // Update sub-tally text
    const done = state.resolutionResolvedIds.size;
    $("#res-tally-sub").textContent =
      "Territories scored: " + done + " / " + state.territories.length;

    // Move to next
    state.resolutionIndex++;
    state.resolutionFocusTerritory = null;

    // Brief pause to see the territory color in before moving on
    setTimeout(() => showResolutionStep(), 350);
  }

  // --------------------------------------------------------
  // Network Bonus Phase
  // --------------------------------------------------------
  function showNetworkPhase() {
    if (!state) return;

    state.phase = "resolution-networks";
    state.resolutionFocusTerritory = null;

    // Hide territory detail panel
    $("#res-detail-panel").classList.add("hidden");

    const b = state.breakdown;
    const allNetworks = [];
    for (const net of b.playerNetworks) {
      allNetworks.push({
        owner: "player",
        chain: net,
        bonus: getNetworkBonus(net.length),
      });
    }
    for (const net of b.aiNetworks) {
      allNetworks.push({
        owner: "ai",
        chain: net,
        bonus: getNetworkBonus(net.length),
      });
    }

    // Build the network panel content
    const listEl = $("#res-network-list");
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
        el.innerHTML =
          '<span class="res-network-chain">' +
          ownerLabel +
          ": " +
          names.join(" → ") +
          " (" +
          net.chain.length +
          "-chain)</span>" +
          '<span class="res-network-bonus">+' +
          net.bonus +
          "</span>";
        listEl.appendChild(el);

        // Highlight chains on hover
        el.addEventListener("mouseenter", () => {
          state.resolutionHighlightChain = net.chain;
        });
        el.addEventListener("mouseleave", () => {
          state.resolutionHighlightChain = [];
        });
      }
    }

    // Highlight all chains at once initially
    const allChainIds = [];
    for (const net of allNetworks) allChainIds.push(...net.chain);
    state.resolutionHighlightChain = allChainIds;

    // Update running tally with network bonuses
    const finalPlayer = state.resolutionRunningPlayer + b.playerNetworkPts;
    const finalAI = state.resolutionRunningAI + b.aiNetworkPts;

    // Animate tally to include network pts
    setTimeout(() => {
      if (!state) return;
      const pPtsEl = $("#res-tally-player-pts");
      const aPtsEl = $("#res-tally-ai-pts");
      if (b.playerNetworkPts > 0) {
        pPtsEl.textContent = finalPlayer;
        pPtsEl.classList.remove("pts-bump");
        void pPtsEl.offsetWidth;
        pPtsEl.classList.add("pts-bump");
      }
      if (b.aiNetworkPts > 0) {
        aPtsEl.textContent = finalAI;
        aPtsEl.classList.remove("pts-bump");
        void aPtsEl.offsetWidth;
        aPtsEl.classList.add("pts-bump");
      }
      state.resolutionRunningPlayer = finalPlayer;
      state.resolutionRunningAI = finalAI;
      $("#res-tally-sub").textContent =
        b.playerNetworkPts > 0 || b.aiNetworkPts > 0
          ? "Network bonuses applied"
          : "No network bonuses";
    }, 400);

    // Show network panel
    const netPanel = $("#res-network-panel");
    netPanel.classList.remove("hidden");

    // Wire the button
    const btn = $("#btn-res-network-next");
    btn.onclick = () => {
      state.resolutionHighlightChain = [];
      netPanel.classList.add("hidden");
      showGameOver();
    };
  }

  // --------------------------------------------------------
  // Game Over — Integrated on map
  // --------------------------------------------------------
  function showGameOver() {
    state.phase = "gameover";
    state.resolutionFocusTerritory = null;
    state.resolutionHighlightChain = [];

    const b = state.breakdown;

    // Hide network panel if visible
    $("#res-network-panel").classList.add("hidden");
    // Hide detail panel if visible
    $("#res-detail-panel").classList.add("hidden");

    // Update tally to final
    $("#res-tally-player-pts").textContent = b.player;
    $("#res-tally-ai-pts").textContent = b.ai;
    $("#res-tally-sub").textContent =
      b.winner === "player"
        ? "You win!"
        : b.winner === "ai"
          ? "AI wins"
          : "Draw";

    // Show final panel
    const panel = $("#res-final-panel");
    panel.classList.remove("hidden");

    const titleEl = $("#res-final-title");
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

    $("#res-final-player-pts").textContent = b.player;
    $("#res-final-ai-pts").textContent = b.ai;

    $("#res-final-breakdown").innerHTML = `
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
          <span class="res-final-row-blue">${b.playerNetworks.length > 0 ? b.playerNetworks.map((n) => n.length + "-chain").join(", ") : "none"}</span>
          <span class="res-final-row-amber">${b.aiNetworks.length > 0 ? b.aiNetworks.map((n) => n.length + "-chain").join(", ") : "none"}</span>
        </span>
      </div>
    `;

    updateUI();
  }

  function resetResolutionUI() {
    // Clean up all resolution UI elements
    $("#resolution-tally").classList.add("hidden");
    $("#res-detail-panel").classList.add("hidden");
    $("#res-network-panel").classList.add("hidden");
    $("#res-final-panel").classList.add("hidden");
  }

  // --------------------------------------------------------
  // Canvas Input
  // --------------------------------------------------------
  function setupCanvasInput() {
    const canvas = state.canvas;

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const t = getTerritoryAt(mx, my);
      state.hoveredTerritory = t ? t.id : null;

      // Tooltip — hide during resolution/gameover phases
      const tip = $("#territory-tooltip");
      const inResPhase =
        state.phase === "resolution" ||
        state.phase === "resolution-networks" ||
        state.phase === "gameover";
      if (inResPhase) {
        tip.classList.add("hidden");
        return;
      }
      if (t) {
        tip.querySelector(".tooltip-name").textContent = t.name;
        tip.querySelector(".tooltip-value").textContent =
          t.value + " point" + (t.value !== 1 ? "s" : "");

        let statusText = "";
        if (t.claimedBy === "player")
          statusText = "🔵 Claimed by You (+2 base influence)";
        else if (t.claimedBy === "ai")
          statusText = "🟠 Claimed by AI (+2 base influence)";
        else statusText = "Unclaimed — click to claim on your turn";
        tip.querySelector(".tooltip-status").textContent = statusText;

        const pCards = t.cardsPlayed.filter((c) => c.owner === "player");
        const aCards = t.cardsPlayed.filter((c) => c.owner === "ai");
        const parts = [];
        if (pCards.length)
          parts.push(
            "Your cards: " + pCards.map((c) => "str " + c.strength).join(", "),
          );
        if (aCards.length) parts.push("AI cards: " + aCards.length + " hidden");
        const tipInf = tip.querySelector(".tooltip-influence");
        tipInf.textContent = parts.join("  ·  ") || "";
        tipInf.style.display = parts.length ? "block" : "none";

        // Connections info
        const tipConn = tip.querySelector(".tooltip-connections");
        if (tipConn) {
          const connNames = t.connections.map(
            (id) => state.territories[id].name,
          );
          tipConn.textContent = "Connects to: " + connNames.join(", ");
        }

        tip.classList.remove("hidden");
        let tx = e.clientX + 16,
          ty = e.clientY - 10;
        if (tx + 240 > window.innerWidth) tx = e.clientX - 240;
        if (ty + 120 > window.innerHeight) ty = e.clientY - 120;
        tip.style.left = tx + "px";
        tip.style.top = ty + "px";
      } else {
        tip.classList.add("hidden");
      }
    });

    canvas.addEventListener("mouseleave", () => {
      state.hoveredTerritory = null;
      $("#territory-tooltip").classList.add("hidden");
    });

    canvas.addEventListener("click", (e) => {
      if (state.phase === "planning") return; // ignore during planning
      if (state.currentTurn !== "player" || state.phase !== "action") return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const t = getTerritoryAt(mx, my);

      if (!t) {
        state.selectedAction = null;
        state.selectedCard = null;
        updateUI();
        return;
      }

      // --- Fortify: card selected, click any territory ---
      if (state.selectedAction === "fortify" && state.selectedCard) {
        playerFortify(state.selectedCard, t.id);
        return;
      }

      // --- Claim: click unclaimed territory ---
      if (state.selectedAction === "claim") {
        if (!t.claimedBy) {
          playerClaim(t.id);
        } else {
          notify("Already claimed", "contested");
        }
        return;
      }

      // --- No action selected: auto-claim if unclaimed ---
      if (!t.claimedBy && state.territories.some((t2) => !t2.claimedBy)) {
        playerClaim(t.id);
      }
    });

    // Touch
    canvas.addEventListener("touchend", (e) => {
      if (e.changedTouches.length === 0) return;
      const touch = e.changedTouches[0];
      canvas.dispatchEvent(
        new MouseEvent("click", {
          clientX: touch.clientX,
          clientY: touch.clientY,
        }),
      );
      e.preventDefault();
    });
  }

  // --------------------------------------------------------
  // Button Wiring
  // --------------------------------------------------------
  function setupButtons() {
    $("#btn-play").addEventListener("click", startGame);
    $("#btn-how-to-play").addEventListener("click", () =>
      showScreen("#screen-how-to-play"),
    );
    $("#btn-back-title").addEventListener("click", () =>
      showScreen("#screen-title"),
    );

    $("#btn-claim").addEventListener("click", () => {
      if (state.selectedAction === "claim") {
        state.selectedAction = null;
      } else {
        state.selectedAction = "claim";
        state.selectedCard = null;
      }
      updateUI();
    });

    $("#btn-fortify").addEventListener("click", () => {
      if (state.selectedAction === "fortify") {
        state.selectedAction = null;
        state.selectedCard = null;
      } else {
        state.selectedAction = "fortify";
        if (!state.selectedCard) {
          const first = state.playerHand.find((c) => c.state === "hand");
          if (first) state.selectedCard = first;
        }
      }
      updateUI();
    });

    $("#btn-pass").addEventListener("click", () => playerPass());

    $("#btn-res-next").addEventListener("click", advanceResolution);

    $("#btn-play-again").addEventListener("click", () => {
      resetResolutionUI();
      startGame();
    });

    $("#btn-main-menu").addEventListener("click", () => {
      resetResolutionUI();
      if (state && state.animFrame) cancelAnimationFrame(state.animFrame);
      showScreen("#screen-title");
    });

    // Planning "Start" button
    const btnStart = $("#btn-start-game");
    if (btnStart) {
      btnStart.addEventListener("click", () => {
        state.phase = "action";
        updateUI();
        if (state.currentTurn === "ai") {
          notify("AI goes first", "amber");
          setTimeout(aiTurn, 800);
        } else {
          notify("You go first — claim a territory!", "blue");
        }
      });
    }
  }

  // --------------------------------------------------------
  // Game Start
  // --------------------------------------------------------
  function startGame() {
    if (state && state.animFrame) cancelAnimationFrame(state.animFrame);

    resetResolutionUI();
    newGame();
    showScreen("#screen-game");
    initCanvas();
    setupCanvasInput();
    renderLoop();
    updateUI();

    // Show the planning view — let player see their hand + the map
    logAction("New game — 9 territories, 5 cards each", "neutral");
    logAction("Claim territories. Fortify with cards. Bluff.", "neutral");
  }

  // --------------------------------------------------------
  // Keyboard Shortcuts
  // --------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (!state) return;

    // Planning phase — Enter to start
    if (state.phase === "planning" && (e.key === "Enter" || e.key === " ")) {
      const btn = $("#btn-start-game");
      if (btn) btn.click();
      return;
    }

    if (state.phase !== "action" || state.currentTurn !== "player") {
      // Resolution: space/enter to advance territory steps
      if (
        state.phase === "resolution" &&
        (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")
      ) {
        advanceResolution();
      }
      // Resolution-networks: space/enter to go to final
      if (
        state.phase === "resolution-networks" &&
        (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")
      ) {
        const btn = $("#btn-res-network-next");
        if (btn) btn.click();
      }
      return;
    }

    if (e.key === "c" || e.key === "C") {
      if (state.selectedAction === "claim") state.selectedAction = null;
      else {
        state.selectedAction = "claim";
        state.selectedCard = null;
      }
      updateUI();
    } else if (e.key === "f" || e.key === "F") {
      if (state.selectedAction === "fortify") {
        state.selectedAction = null;
        state.selectedCard = null;
      } else {
        state.selectedAction = "fortify";
        if (!state.selectedCard) {
          const first = state.playerHand.find((c) => c.state === "hand");
          if (first) state.selectedCard = first;
        }
      }
      updateUI();
    } else if (e.key >= "1" && e.key <= "5") {
      const idx = parseInt(e.key) - 1;
      const avail = state.playerHand.filter((c) => c.state === "hand");
      if (idx < avail.length) selectCard(avail[idx]);
    } else if (e.key === "Escape") {
      state.selectedAction = null;
      state.selectedCard = null;
      updateUI();
    } else if (e.key === "p" || e.key === "P") {
      if (!state.territories.some((t) => !t.claimedBy)) playerPass();
    }
  });

  // --------------------------------------------------------
  // Init
  // --------------------------------------------------------
  setupButtons();
})();
