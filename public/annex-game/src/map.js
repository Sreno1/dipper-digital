// ============================================================
// ANNEX — map.js
// Map generation: random maps, preset maps, terrain assignment,
// edge management, and graph validation
// ============================================================

import {
  TERRAIN, MIN_PLAINS_RATIO, TERRITORY_NAMES, TERRITORY_COUNT,
  RANDOM_LAYOUTS, RANDOM_VALUES, MIN_CONNECTIONS, MAX_CONNECTIONS,
  MAP_PRESETS, MODE,
} from "./constants.js";
import { shuffle, dist, edgeKey, getComponents, randPick } from "./utils.js";

// --------------------------------------------------------
// Territory factory
// --------------------------------------------------------

/**
 * Create a single territory object with all required properties.
 * @param {number} id
 * @param {string} name
 * @param {number} x - normalized 0-1
 * @param {number} y - normalized 0-1
 * @param {number} value - point value 1-5
 * @param {string} terrain - one of TERRAIN.*
 * @returns {object}
 */
function createTerritory(id, name, x, y, value, terrain = TERRAIN.PLAINS) {
  return {
    id,
    name,
    x,
    y,
    value,
    originalValue: value,
    terrain,
    connections: [],
    claimedBy: null,
    cardsPlayed: [],
    owner: null,
    playerInfluence: 0,
    aiInfluence: 0,
    entrenched: false,       // true if Entrench ability was used here
    entrenchBonus: 0,        // +2 from Entrench
  };
}

// --------------------------------------------------------
// Edge helpers
// --------------------------------------------------------

/**
 * Add an edge between two territories if it doesn't already exist
 * and neither would exceed MAX_CONNECTIONS.
 * @param {object[]} territories
 * @param {Array[]} edges - array of [a, b] pairs
 * @param {Set} edgeSet - set of "a,b" keys
 * @param {number} a - territory index
 * @param {number} b - territory index
 * @returns {boolean} true if edge was added
 */
function addEdge(territories, edges, edgeSet, a, b) {
  const key = edgeKey(a, b);
  if (edgeSet.has(key)) return false;
  if (territories[a].connections.length >= MAX_CONNECTIONS) return false;
  if (territories[b].connections.length >= MAX_CONNECTIONS) return false;
  edgeSet.add(key);
  edges.push([a, b]);
  territories[a].connections.push(b);
  territories[b].connections.push(a);
  return true;
}

/**
 * Remove an edge between two territories.
 * @param {object[]} territories
 * @param {Array[]} edges
 * @param {Set} edgeSet
 * @param {number} a
 * @param {number} b
 * @returns {boolean} true if edge was removed
 */
export function removeEdge(territories, edges, edgeSet, a, b) {
  const key = edgeKey(a, b);
  if (!edgeSet.has(key)) return false;
  edgeSet.delete(key);

  // Remove from edges array
  const idx = edges.findIndex(
    e => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a)
  );
  if (idx !== -1) edges.splice(idx, 1);

  // Remove from connections
  territories[a].connections = territories[a].connections.filter(c => c !== b);
  territories[b].connections = territories[b].connections.filter(c => c !== a);
  return true;
}

/**
 * Build an edge set from an edges array.
 * @param {Array[]} edges
 * @returns {Set}
 */
export function buildEdgeSet(edges) {
  const set = new Set();
  for (const [a, b] of edges) {
    set.add(edgeKey(a, b));
  }
  return set;
}

/**
 * Check if an edge exists.
 * @param {Set} edgeSet
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
export function hasEdge(edgeSet, a, b) {
  return edgeSet.has(edgeKey(a, b));
}

/**
 * Find all node pairs within 2 hops that don't already have a direct edge.
 * @param {object[]} territories
 * @param {Set} edgeSet
 * @returns {Array<[number, number]>}
 */
export function findPotentialEdges(territories, edgeSet) {
  const candidates = [];
  for (let i = 0; i < territories.length; i++) {
    for (const nb of territories[i].connections) {
      for (const nb2 of territories[nb].connections) {
        if (nb2 !== i && !hasEdge(edgeSet, i, nb2)) {
          if (
            territories[i].connections.length < MAX_CONNECTIONS &&
            territories[nb2].connections.length < MAX_CONNECTIONS
          ) {
            const key = edgeKey(i, nb2);
            if (!candidates.some(c => edgeKey(c[0], c[1]) === key)) {
              candidates.push([i, nb2]);
            }
          }
        }
      }
    }
  }
  return candidates;
}

// --------------------------------------------------------
// Connectivity enforcement
// --------------------------------------------------------

/**
 * Ensure the graph is fully connected by adding edges between
 * closest nodes of disconnected components.
 * @param {object[]} territories
 * @param {Array[]} edges
 * @param {Set} edgeSet
 */
function ensureConnected(territories, edges, edgeSet) {
  let components = getComponents(territories);
  while (components.length > 1) {
    let bestD = Infinity;
    let bestA = -1;
    let bestB = -1;
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
    addEdge(territories, edges, edgeSet, bestA, bestB);
    components = getComponents(territories);
  }
}

/**
 * Ensure every territory has at least MIN_CONNECTIONS connections.
 * @param {object[]} territories
 * @param {Array[]} edges
 * @param {Set} edgeSet
 */
function ensureMinConnections(territories, edges, edgeSet) {
  for (let i = 0; i < territories.length; i++) {
    while (territories[i].connections.length < MIN_CONNECTIONS) {
      const dists = [];
      for (let j = 0; j < territories.length; j++) {
        if (j === i) continue;
        if (territories[i].connections.includes(j)) continue;
        if (territories[j].connections.length >= MAX_CONNECTIONS) continue;
        dists.push({ j, d: dist(territories[i], territories[j]) });
      }
      dists.sort((a, b) => a.d - b.d);
      if (dists.length === 0) break;
      addEdge(territories, edges, edgeSet, i, dists[0].j);
    }
  }
}

// --------------------------------------------------------
// Random terrain assignment
// --------------------------------------------------------

/**
 * Assign terrain types to territories randomly, respecting all constraints.
 * Used for Extraction mode's randomly generated maps.
 *
 * Constraints:
 *   - At least MIN_PLAINS_RATIO of territories must be Plains
 *   - No two Fog territories may be adjacent
 *   - At most 1 Observatory per map
 *   - Chokepoint only on territories with exactly 2 connections
 *   - Scorched Earth only on territories with value >= 2
 *   - Terrain types are always visible
 *
 * @param {object[]} territories
 */
export function assignRandomTerrain(territories) {
  const count = territories.length;
  const maxNonPlains = Math.floor(count * (1 - MIN_PLAINS_RATIO));

  // Start with everything as plains
  for (const t of territories) {
    t.terrain = TERRAIN.PLAINS;
  }

  // Track assignments
  let assigned = 0;
  const fogIds = new Set();

  // Shuffle territory indices for random assignment order
  const indices = shuffle(territories.map((_, i) => i));

  // 1. Observatory — one random territory (if map has 7+ territories)
  if (count >= 7 && assigned < maxNonPlains) {
    const obsIdx = indices.find(i => territories[i].terrain === TERRAIN.PLAINS);
    if (obsIdx !== undefined) {
      territories[obsIdx].terrain = TERRAIN.OBSERVATORY;
      assigned++;
    }
  }

  // 2. Chokepoint — 0-2 eligible territories (exactly 2 connections)
  const chokeCandidates = indices.filter(
    i => territories[i].terrain === TERRAIN.PLAINS &&
         territories[i].connections.length === 2
  );
  const chokeCount = Math.min(
    Math.floor(Math.random() * 3), // 0, 1, or 2
    chokeCandidates.length,
    maxNonPlains - assigned
  );
  for (let c = 0; c < chokeCount; c++) {
    territories[chokeCandidates[c]].terrain = TERRAIN.CHOKEPOINT;
    assigned++;
  }

  // 3. High Ground — 1-2 random unassigned territories
  const highGroundCount = Math.min(
    1 + Math.floor(Math.random() * 2), // 1 or 2
    maxNonPlains - assigned
  );
  let hgAssigned = 0;
  for (const i of indices) {
    if (hgAssigned >= highGroundCount) break;
    if (territories[i].terrain !== TERRAIN.PLAINS) continue;
    territories[i].terrain = TERRAIN.HIGH_GROUND;
    assigned++;
    hgAssigned++;
  }

  // 4. Scorched Earth — 0-1 territories with value >= 2
  if (assigned < maxNonPlains && Math.random() < 0.6) {
    const seCandidate = indices.find(
      i => territories[i].terrain === TERRAIN.PLAINS &&
           territories[i].value >= 2
    );
    if (seCandidate !== undefined) {
      territories[seCandidate].terrain = TERRAIN.SCORCHED_EARTH;
      assigned++;
    }
  }

  // 5. Fog — 1-2 territories, not adjacent to each other or existing fog
  const fogCount = Math.min(
    1 + Math.floor(Math.random() * 2),
    maxNonPlains - assigned
  );
  let fAssigned = 0;
  for (const i of indices) {
    if (fAssigned >= fogCount) break;
    if (territories[i].terrain !== TERRAIN.PLAINS) continue;
    // Check adjacency constraint
    const adjacentToFog = territories[i].connections.some(nb => fogIds.has(nb));
    if (adjacentToFog) continue;
    territories[i].terrain = TERRAIN.FOG;
    fogIds.add(i);
    assigned++;
    fAssigned++;
  }

  // 6. Final validation — ensure at least MIN_PLAINS_RATIO plains
  const plainsCount = territories.filter(t => t.terrain === TERRAIN.PLAINS).length;
  const minPlains = Math.ceil(count * MIN_PLAINS_RATIO);
  if (plainsCount < minPlains) {
    // Revert the most recently assigned non-plains (reverse order)
    const nonPlains = territories
      .map((t, i) => ({ i, t }))
      .filter(({ t }) => t.terrain !== TERRAIN.PLAINS);
    // Revert from the end until we meet the quota
    for (let k = nonPlains.length - 1; k >= 0; k--) {
      if (territories.filter(t => t.terrain === TERRAIN.PLAINS).length >= minPlains) break;
      territories[nonPlains[k].i].terrain = TERRAIN.PLAINS;
    }
  }
}

// --------------------------------------------------------
// Map generation — random
// --------------------------------------------------------

/**
 * Generate a random map for Extraction mode or unranked play.
 * @param {object} [options]
 * @param {boolean} [options.assignTerrain=true] - whether to assign random terrain
 * @returns {{ territories: object[], edges: Array[], edgeSet: Set }}
 */
export function generateRandomMap(options = {}) {
  const assignTerr = options.assignTerrain !== false;

  // Pick a random layout
  const layout = randPick(RANDOM_LAYOUTS);
  const names = shuffle(TERRITORY_NAMES);
  const values = shuffle([...RANDOM_VALUES]);

  // Create territories
  const territories = layout.map((pos, i) =>
    createTerritory(i, names[i], pos.x, pos.y, values[i])
  );

  // Build edges by connecting each node to nearest 2-3 neighbors
  const edges = [];
  const edgeSet = new Set();

  for (let i = 0; i < TERRITORY_COUNT; i++) {
    const dists = [];
    for (let j = 0; j < TERRITORY_COUNT; j++) {
      if (i === j) continue;
      dists.push({ j, d: dist(territories[i], territories[j]) });
    }
    dists.sort((a, b) => a.d - b.d);
    const count = MIN_CONNECTIONS + (Math.random() < 0.5 ? 1 : 0);
    for (let k = 0; k < Math.min(count, dists.length); k++) {
      addEdge(territories, edges, edgeSet, i, dists[k].j);
    }
  }

  // Ensure connectivity and minimum connections
  ensureConnected(territories, edges, edgeSet);
  ensureMinConnections(territories, edges, edgeSet);

  // Assign terrain
  if (assignTerr) {
    assignRandomTerrain(territories);
  }

  return { territories, edges, edgeSet };
}

// --------------------------------------------------------
// Map generation — preset
// --------------------------------------------------------

/**
 * Generate a map from a curated preset.
 * @param {string} presetKey - key into MAP_PRESETS
 * @returns {{ territories: object[], edges: Array[], edgeSet: Set }}
 */
export function generatePresetMap(presetKey) {
  const preset = MAP_PRESETS[presetKey];
  if (!preset) {
    throw new Error(`Unknown map preset: ${presetKey}`);
  }

  const names = shuffle(TERRITORY_NAMES);

  // Create territories with preset positions, values, and terrain
  const territories = preset.positions.map((pos, i) =>
    createTerritory(i, names[i], pos.x, pos.y, preset.values[i], preset.terrain[i])
  );

  // Build edges from preset
  const edges = [];
  const edgeSet = new Set();
  for (const [a, b] of preset.edges) {
    addEdge(territories, edges, edgeSet, a, b);
  }

  return { territories, edges, edgeSet };
}

// --------------------------------------------------------
// Main entry point
// --------------------------------------------------------

/**
 * Generate a map based on mode and options.
 * @param {object} options
 * @param {string} options.mode - MODE.RANKED or MODE.EXTRACTION
 * @param {string} [options.mapPreset] - preset key for ranked mode
 * @returns {{ territories: object[], edges: Array[], edgeSet: Set }}
 */
export function generateMap(options = {}) {
  if (options.mode === MODE.RANKED && options.mapPreset) {
    return generatePresetMap(options.mapPreset);
  }
  // Extraction or unranked — random map with terrain
  return generateRandomMap({ assignTerrain: true });
}

// --------------------------------------------------------
// Terraforming helpers (Extraction mode)
// --------------------------------------------------------

/**
 * Validate whether a terraforming tool can be applied to a given target.
 * @param {string} toolType - TOOL.* value
 * @param {object[]} territories
 * @param {Array[]} edges
 * @param {Set} edgeSet
 * @param {number} targetId - territory index (for terrain tools) or -1 for edge tools
 * @param {number} [targetId2] - second target for Bridge Builder
 * @param {string} [playerOwner] - "player" or "ai" for Observatory limit tracking
 * @param {object} state - full game state for checking Observatory counts
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateTerraform(toolType, territories, edges, edgeSet, targetId, targetId2, playerOwner, state) {
  const t = targetId >= 0 ? territories[targetId] : null;

  switch (toolType) {
    case "fortification_kit":
      if (!t || t.terrain !== TERRAIN.PLAINS) return { valid: false, reason: "Target must be Plains." };
      return { valid: true };

    case "fog_machine": {
      if (!t || t.terrain !== TERRAIN.PLAINS) return { valid: false, reason: "Target must be Plains." };
      const adjacentFog = t.connections.some(nb => territories[nb].terrain === TERRAIN.FOG);
      if (adjacentFog) return { valid: false, reason: "Cannot place Fog adjacent to existing Fog." };
      return { valid: true };
    }

    case "watchtower": {
      if (!t || t.terrain !== TERRAIN.PLAINS) return { valid: false, reason: "Target must be Plains." };
      // Check per-player observatory limit: max 1 Observatory placed by this player
      // Also check total map limit (max 2 observatories total)
      const existingObs = territories.filter(t2 => t2.terrain === TERRAIN.OBSERVATORY).length;
      if (existingObs >= 2) return { valid: false, reason: "Max 2 Observatories per map." };
      // Check if this player already placed one
      const playerObsCount = (state && state._terraformHistory)
        ? state._terraformHistory.filter(h => h.tool === "watchtower" && h.player === playerOwner).length
        : 0;
      if (playerObsCount >= 1) return { valid: false, reason: "Max 1 Observatory per player." };
      return { valid: true };
    }

    case "chokepoint_charge":
      if (!t || t.terrain !== TERRAIN.PLAINS) return { valid: false, reason: "Target must be Plains." };
      if (t.connections.length !== 2) return { valid: false, reason: "Territory must have exactly 2 connections." };
      return { valid: true };

    case "salt_the_earth":
      if (!t || t.terrain !== TERRAIN.PLAINS) return { valid: false, reason: "Target must be Plains." };
      if (t.value < 2) return { valid: false, reason: "Territory must have value ≥ 2." };
      return { valid: true };

    case "demolition_charge": {
      if (targetId < 0 || targetId2 === undefined) return { valid: false, reason: "Select an edge to remove." };
      if (!hasEdge(edgeSet, targetId, targetId2)) return { valid: false, reason: "No edge exists between these territories." };
      if (territories[targetId].connections.length <= MIN_CONNECTIONS) {
        return { valid: false, reason: `${territories[targetId].name} would drop below ${MIN_CONNECTIONS} connections.` };
      }
      if (territories[targetId2].connections.length <= MIN_CONNECTIONS) {
        return { valid: false, reason: `${territories[targetId2].name} would drop below ${MIN_CONNECTIONS} connections.` };
      }
      // Check disconnect
      const { wouldDisconnect } = await_free_wouldDisconnect(territories, targetId, targetId2);
      if (wouldDisconnect) return { valid: false, reason: "Removing this edge would disconnect the graph." };
      return { valid: true };
    }

    case "bridge_builder": {
      if (targetId < 0 || targetId2 === undefined) return { valid: false, reason: "Select two territories to connect." };
      if (targetId === targetId2) return { valid: false, reason: "Cannot connect a territory to itself." };
      if (hasEdge(edgeSet, targetId, targetId2)) return { valid: false, reason: "Edge already exists." };
      if (territories[targetId].connections.length >= MAX_CONNECTIONS) {
        return { valid: false, reason: `${territories[targetId].name} already has ${MAX_CONNECTIONS} connections.` };
      }
      if (territories[targetId2].connections.length >= MAX_CONNECTIONS) {
        return { valid: false, reason: `${territories[targetId2].name} already has ${MAX_CONNECTIONS} connections.` };
      }
      // Check within 2 hops
      const within2 = territories[targetId].connections.some(
        nb => nb === targetId2 || territories[nb].connections.includes(targetId2)
      );
      if (!within2) return { valid: false, reason: "Territories must be within 2 hops of each other." };
      return { valid: true };
    }

    default:
      return { valid: false, reason: "Unknown tool type." };
  }
}

/**
 * Synchronous graph disconnection check — avoids dynamic import.
 * Uses BFS from `a` to `b` without the direct a-b edge.
 */
function await_free_wouldDisconnect(territories, a, b) {
  const visited = new Set();
  const queue = [a];
  visited.add(a);
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of territories[cur].connections) {
      if (visited.has(nb)) continue;
      if ((cur === a && nb === b) || (cur === b && nb === a)) continue;
      if (nb === b) return { wouldDisconnect: false };
      visited.add(nb);
      queue.push(nb);
    }
  }
  return { wouldDisconnect: !visited.has(b) };
}

/**
 * Apply a terraforming tool to the map. Mutates territories/edges/edgeSet in place.
 * Assumes validation has already passed.
 * @param {string} toolType
 * @param {object[]} territories
 * @param {Array[]} edges
 * @param {Set} edgeSet
 * @param {number} targetId
 * @param {number} [targetId2]
 */
export function applyTerraform(toolType, territories, edges, edgeSet, targetId, targetId2) {
  switch (toolType) {
    case "fortification_kit":
      territories[targetId].terrain = TERRAIN.HIGH_GROUND;
      break;
    case "fog_machine":
      territories[targetId].terrain = TERRAIN.FOG;
      break;
    case "watchtower":
      territories[targetId].terrain = TERRAIN.OBSERVATORY;
      break;
    case "chokepoint_charge":
      territories[targetId].terrain = TERRAIN.CHOKEPOINT;
      break;
    case "salt_the_earth":
      territories[targetId].terrain = TERRAIN.SCORCHED_EARTH;
      break;
    case "demolition_charge":
      removeEdge(territories, edges, edgeSet, targetId, targetId2);
      break;
    case "bridge_builder":
      addEdge(territories, edges, edgeSet, targetId, targetId2);
      break;
  }
}

// --------------------------------------------------------
// Observatory finder
// --------------------------------------------------------

/**
 * Find the observatory territory id on the map, or null if none exists.
 * @param {object[]} territories
 * @returns {number|null}
 */
export function findObservatoryId(territories) {
  const obs = territories.find(t => t.terrain === TERRAIN.OBSERVATORY);
  return obs ? obs.id : null;
}
