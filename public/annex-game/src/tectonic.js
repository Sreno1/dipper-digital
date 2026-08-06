// ============================================================
// ANNEX — tectonic.js
// Tectonic shift generation, telegraphing, and execution.
// Used only in Extraction mode.
// ============================================================

import {
  TERRAIN, MIN_CONNECTIONS, MAX_CONNECTIONS,
  TECTONIC_WARNING_TURNS,
} from "./constants.js";
import { edgeKey, randPick, clamp, getComponents } from "./utils.js";
import { hasEdge, removeEdge, findPotentialEdges, buildEdgeSet } from "./map.js";

// --------------------------------------------------------
// Shift turn calculation
// --------------------------------------------------------

/**
 * Calculate the turn on which the tectonic shift should occur.
 * Approximately 60% of the way through the expected total turns.
 *
 * For a 9-territory map with 6-card hands:
 *   ~9 claims + ~12 card plays = ~21 total actions
 *   ~21 * 0.6 ≈ 13, so the shift occurs around turn 13.
 *
 * We clamp to at least turn 4 and at most totalExpected - 2 to
 * avoid shifts that are too early or too late.
 *
 * @param {number} territoryCount
 * @param {number} handSize - cards per player
 * @returns {number} the turn number on which the shift triggers
 */
export function calculateShiftTurn(territoryCount, handSize) {
  const totalExpected = territoryCount + (handSize * 2);
  const shiftTurn = Math.floor(totalExpected * 0.6);
  return clamp(shiftTurn, 4, Math.max(4, totalExpected - 2));
}

// --------------------------------------------------------
// Shift data generation
// --------------------------------------------------------

/**
 * Generate the full tectonic shift data at match start.
 * The data is hidden from players unless they claim an Observatory.
 *
 * A shift consists of:
 *   1. Edge Mutation — one edge removed, one new edge added
 *   2. Value Drift — one territory's value goes up by 1, another goes down by 1
 *   3. Aftershock (50% chance) — a Plains territory adjacent to a mutated edge
 *      becomes Scorched Earth
 *
 * All changes respect graph constraints:
 *   - Cannot disconnect the graph
 *   - Cannot drop any territory below MIN_CONNECTIONS
 *   - Cannot exceed MAX_CONNECTIONS
 *   - Value stays within 1-5
 *
 * @param {object[]} territories
 * @param {number[][]} edges
 * @param {Set} edgeSet
 * @returns {object|null} shift data, or null if no valid shift could be generated
 */
export function generateShiftData(territories, edges, edgeSet) {
  const removeResult = pickEdgeToRemove(territories, edges, edgeSet);
  const addResult = pickEdgeToAdd(territories, edges, edgeSet, removeResult);
  const valueDrift = pickValueDrift(territories);
  const aftershock = pickAftershock(territories, removeResult, addResult);

  // If we couldn't find a valid edge mutation, return a minimal shift
  // (value drift + possible aftershock only)
  if (!removeResult && !addResult) {
    if (!valueDrift) return null;
    return {
      removeEdge: null,
      addEdge: null,
      valueUp: valueDrift.valueUp,
      valueDown: valueDrift.valueDown,
      aftershock,
      affectedTerritories: getAffectedTerritories(null, null, valueDrift, aftershock),
    };
  }

  return {
    removeEdge: removeResult,   // { a, b } or null
    addEdge: addResult,         // { a, b } or null
    valueUp: valueDrift ? valueDrift.valueUp : null,    // { territoryId, delta: +1 }
    valueDown: valueDrift ? valueDrift.valueDown : null, // { territoryId, delta: -1 }
    aftershock,                 // { territoryId } or null
    affectedTerritories: getAffectedTerritories(removeResult, addResult, valueDrift, aftershock),
  };
}

// --------------------------------------------------------
// Edge removal candidate selection
// --------------------------------------------------------

/**
 * Find a valid edge to remove.
 * Requirements:
 *   - Neither endpoint drops below MIN_CONNECTIONS after removal
 *   - Removing the edge does not disconnect the graph
 *
 * @param {object[]} territories
 * @param {number[][]} edges
 * @param {Set} edgeSet
 * @returns {{ a: number, b: number }|null}
 */
function pickEdgeToRemove(territories, edges, edgeSet) {
  // Shuffle edges to randomize selection
  const candidates = [...edges].sort(() => Math.random() - 0.5);

  for (const [a, b] of candidates) {
    // Check connection counts after removal
    if (territories[a].connections.length <= MIN_CONNECTIONS) continue;
    if (territories[b].connections.length <= MIN_CONNECTIONS) continue;

    // Check if removing this edge would disconnect the graph
    if (wouldDisconnectOnRemove(territories, a, b)) continue;

    return { a, b };
  }

  return null;
}

/**
 * BFS-based disconnection check for edge removal.
 * Returns true if removing edge a-b would disconnect the graph.
 *
 * @param {object[]} territories
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
function wouldDisconnectOnRemove(territories, a, b) {
  // BFS from a to b, skipping the direct a-b edge
  const visited = new Set();
  const queue = [a];
  visited.add(a);

  while (queue.length) {
    const cur = queue.shift();
    for (const nb of territories[cur].connections) {
      if (visited.has(nb)) continue;
      // Skip the direct edge being "removed"
      if ((cur === a && nb === b) || (cur === b && nb === a)) continue;
      if (nb === b) return false; // b is reachable without direct edge
      visited.add(nb);
      queue.push(nb);
    }
  }

  return !visited.has(b);
}

// --------------------------------------------------------
// Edge addition candidate selection
// --------------------------------------------------------

/**
 * Find a valid edge to add.
 * Requirements:
 *   - The two territories are within 2 hops of each other
 *   - Neither endpoint would exceed MAX_CONNECTIONS
 *   - The edge does not already exist
 *
 * Prefers adding an edge that involves a territory affected by
 * the removal (if any) to create a coherent shift narrative.
 *
 * @param {object[]} territories
 * @param {number[][]} edges
 * @param {Set} edgeSet
 * @param {{ a: number, b: number }|null} removedEdge
 * @returns {{ a: number, b: number }|null}
 */
function pickEdgeToAdd(territories, edges, edgeSet, removedEdge) {
  const potentials = findPotentialEdges(territories, edgeSet);
  if (potentials.length === 0) return null;

  // If we removed an edge, prefer adding one that involves an affected territory
  if (removedEdge) {
    const preferred = potentials.filter(
      ([a, b]) => a === removedEdge.a || a === removedEdge.b ||
                  b === removedEdge.a || b === removedEdge.b
    );
    if (preferred.length > 0) {
      const pick = randPick(preferred);
      return { a: pick[0], b: pick[1] };
    }
  }

  // Otherwise, pick randomly
  const pick = randPick(potentials);
  return { a: pick[0], b: pick[1] };
}

// --------------------------------------------------------
// Value drift selection
// --------------------------------------------------------

/**
 * Pick two different territories: one to increase by 1, one to decrease by 1.
 * Value stays clamped within [1, 5].
 *
 * @param {object[]} territories
 * @returns {{ valueUp: { territoryId: number, delta: number }, valueDown: { territoryId: number, delta: number } }|null}
 */
function pickValueDrift(territories) {
  // Candidates that can go up (value < 5)
  const canGoUp = territories.filter(t => t.value < 5).map(t => t.id);
  // Candidates that can go down (value > 1)
  const canGoDown = territories.filter(t => t.value > 1).map(t => t.id);

  if (canGoUp.length === 0 || canGoDown.length === 0) return null;

  const upId = randPick(canGoUp);
  // Ensure we pick a different territory for down
  const downCandidates = canGoDown.filter(id => id !== upId);
  if (downCandidates.length === 0) return null;

  const downId = randPick(downCandidates);

  return {
    valueUp: { territoryId: upId, delta: 1 },
    valueDown: { territoryId: downId, delta: -1 },
  };
}

// --------------------------------------------------------
// Aftershock selection
// --------------------------------------------------------

/**
 * 50% chance of an aftershock: a Plains territory adjacent to one of the
 * mutated edges becomes Scorched Earth.
 *
 * @param {object[]} territories
 * @param {{ a: number, b: number }|null} removedEdge
 * @param {{ a: number, b: number }|null} addedEdge
 * @returns {{ territoryId: number }|null}
 */
function pickAftershock(territories, removedEdge, addedEdge) {
  if (Math.random() >= 0.5) return null;

  // Collect territory IDs adjacent to the mutated edges
  const affectedIds = new Set();
  if (removedEdge) {
    affectedIds.add(removedEdge.a);
    affectedIds.add(removedEdge.b);
    for (const nb of territories[removedEdge.a].connections) affectedIds.add(nb);
    for (const nb of territories[removedEdge.b].connections) affectedIds.add(nb);
  }
  if (addedEdge) {
    affectedIds.add(addedEdge.a);
    affectedIds.add(addedEdge.b);
    for (const nb of territories[addedEdge.a].connections) affectedIds.add(nb);
    for (const nb of territories[addedEdge.b].connections) affectedIds.add(nb);
  }

  // Filter to Plains territories only (and value >= 2 — scorched earth constraint)
  const candidates = [...affectedIds].filter(id => {
    const t = territories[id];
    return t.terrain === TERRAIN.PLAINS && t.value >= 2;
  });

  if (candidates.length === 0) return null;

  return { territoryId: randPick(candidates) };
}

// --------------------------------------------------------
// Affected territories helper
// --------------------------------------------------------

/**
 * Compile a list of all territory IDs that are affected by the shift.
 * Used for telegraphing (highlighting) before the shift occurs.
 *
 * @param {{ a: number, b: number }|null} removedEdge
 * @param {{ a: number, b: number }|null} addedEdge
 * @param {object|null} valueDrift - { valueUp, valueDown }
 * @param {{ territoryId: number }|null} aftershock
 * @returns {number[]}
 */
function getAffectedTerritories(removedEdge, addedEdge, valueDrift, aftershock) {
  const ids = new Set();

  if (removedEdge) {
    ids.add(removedEdge.a);
    ids.add(removedEdge.b);
  }
  if (addedEdge) {
    ids.add(addedEdge.a);
    ids.add(addedEdge.b);
  }
  if (valueDrift) {
    if (valueDrift.valueUp) ids.add(valueDrift.valueUp.territoryId);
    if (valueDrift.valueDown) ids.add(valueDrift.valueDown.territoryId);
  }
  if (aftershock) {
    ids.add(aftershock.territoryId);
  }

  return [...ids];
}

// --------------------------------------------------------
// Shift execution
// --------------------------------------------------------

/**
 * Apply a tectonic shift to the game state. Mutates territories, edges,
 * and edgeSet in place.
 *
 * Should be called exactly once when the shift turn is reached.
 *
 * @param {object} shiftData - the shift data generated at match start
 * @param {object[]} territories
 * @param {number[][]} edges
 * @param {Set} edgeSet
 * @returns {{ changes: object[] }} a list of changes for the UI to animate
 */
export function applyShift(shiftData, territories, edges, edgeSet) {
  const changes = [];

  // 1. Remove edge
  if (shiftData.removeEdge) {
    const { a, b } = shiftData.removeEdge;
    removeEdge(territories, edges, edgeSet, a, b);
    changes.push({
      type: "edge_removed",
      a,
      b,
      nameA: territories[a].name,
      nameB: territories[b].name,
    });
  }

  // 2. Add edge
  if (shiftData.addEdge) {
    const { a, b } = shiftData.addEdge;
    const key = edgeKey(a, b);
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push([a, b]);
      territories[a].connections.push(b);
      territories[b].connections.push(a);
    }
    changes.push({
      type: "edge_added",
      a,
      b,
      nameA: territories[a].name,
      nameB: territories[b].name,
    });
  }

  // 3. Value drift
  if (shiftData.valueUp) {
    const t = territories[shiftData.valueUp.territoryId];
    const oldValue = t.value;
    t.value = clamp(t.value + shiftData.valueUp.delta, 1, 5);
    changes.push({
      type: "value_up",
      territoryId: t.id,
      name: t.name,
      oldValue,
      newValue: t.value,
    });
  }
  if (shiftData.valueDown) {
    const t = territories[shiftData.valueDown.territoryId];
    const oldValue = t.value;
    t.value = clamp(t.value + shiftData.valueDown.delta, 1, 5);
    changes.push({
      type: "value_down",
      territoryId: t.id,
      name: t.name,
      oldValue,
      newValue: t.value,
    });
  }

  // 4. Aftershock
  if (shiftData.aftershock) {
    const t = territories[shiftData.aftershock.territoryId];
    const oldTerrain = t.terrain;
    t.terrain = TERRAIN.SCORCHED_EARTH;
    changes.push({
      type: "aftershock",
      territoryId: t.id,
      name: t.name,
      oldTerrain,
      newTerrain: TERRAIN.SCORCHED_EARTH,
    });
  }

  return { changes };
}

// --------------------------------------------------------
// Telegraphing helpers
// --------------------------------------------------------

/**
 * Determine the warning state for the tectonic shift based on the current turn.
 *
 * @param {number} currentTurn
 * @param {number} shiftTurn
 * @returns {{ active: boolean, turnsUntil: number, phase: "none"|"warning"|"imminent"|"occurred" }}
 */
export function getShiftWarningState(currentTurn, shiftTurn) {
  if (currentTurn > shiftTurn) {
    return { active: false, turnsUntil: 0, phase: "occurred" };
  }

  const turnsUntil = shiftTurn - currentTurn;

  if (turnsUntil <= 0) {
    return { active: true, turnsUntil: 0, phase: "imminent" };
  }

  if (turnsUntil <= TECTONIC_WARNING_TURNS) {
    return { active: true, turnsUntil, phase: "warning" };
  }

  return { active: false, turnsUntil, phase: "none" };
}

/**
 * Build a human-readable summary of the tectonic shift for the
 * Observatory intel overlay.
 *
 * @param {object} shiftData
 * @param {object[]} territories
 * @returns {string[]} array of description lines
 */
export function getShiftIntelSummary(shiftData, territories) {
  const lines = [];

  if (shiftData.removeEdge) {
    const { a, b } = shiftData.removeEdge;
    lines.push(`Edge removed: ${territories[a].name} ↔ ${territories[b].name}`);
  }

  if (shiftData.addEdge) {
    const { a, b } = shiftData.addEdge;
    lines.push(`Edge added: ${territories[a].name} ↔ ${territories[b].name}`);
  }

  if (shiftData.valueUp) {
    const t = territories[shiftData.valueUp.territoryId];
    lines.push(`${t.name}: value ${t.value} → ${clamp(t.value + 1, 1, 5)}`);
  }

  if (shiftData.valueDown) {
    const t = territories[shiftData.valueDown.territoryId];
    lines.push(`${t.name}: value ${t.value} → ${clamp(t.value - 1, 1, 5)}`);
  }

  if (shiftData.aftershock) {
    const t = territories[shiftData.aftershock.territoryId];
    lines.push(`Aftershock: ${t.name} becomes Scorched Earth`);
  } else {
    lines.push("No aftershock expected.");
  }

  return lines;
}

/**
 * Build a short notification summary of the shift after it occurs,
 * suitable for the action log and toast notification.
 *
 * @param {{ changes: object[] }} result - from applyShift()
 * @returns {string}
 */
export function getShiftNotificationSummary(result) {
  const parts = [];

  for (const change of result.changes) {
    switch (change.type) {
      case "edge_removed":
        parts.push(`${change.nameA}–${change.nameB} disconnected`);
        break;
      case "edge_added":
        parts.push(`${change.nameA}–${change.nameB} connected`);
        break;
      case "value_up":
        parts.push(`${change.name} ↑${change.newValue}`);
        break;
      case "value_down":
        parts.push(`${change.name} ↓${change.newValue}`);
        break;
      case "aftershock":
        parts.push(`${change.name} scorched`);
        break;
    }
  }

  return "⚡ TECTONIC SHIFT — " + parts.join(", ");
}

// --------------------------------------------------------
// Shift validation
// --------------------------------------------------------

/**
 * Validate that a generated shift is still safe to apply.
 * This should be called immediately before applyShift() in case
 * terraforming has changed the map since generation.
 *
 * @param {object} shiftData
 * @param {object[]} territories
 * @param {number[][]} edges
 * @param {Set} edgeSet
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateShift(shiftData, territories, edges, edgeSet) {
  // Validate edge removal
  if (shiftData.removeEdge) {
    const { a, b } = shiftData.removeEdge;
    if (!hasEdge(edgeSet, a, b)) {
      return { valid: false, reason: `Edge ${a}-${b} no longer exists (already removed by terraforming).` };
    }
    if (territories[a].connections.length <= MIN_CONNECTIONS) {
      return { valid: false, reason: `${territories[a].name} would drop below ${MIN_CONNECTIONS} connections.` };
    }
    if (territories[b].connections.length <= MIN_CONNECTIONS) {
      return { valid: false, reason: `${territories[b].name} would drop below ${MIN_CONNECTIONS} connections.` };
    }
    if (wouldDisconnectOnRemove(territories, a, b)) {
      return { valid: false, reason: "Edge removal would disconnect the graph." };
    }
  }

  // Validate edge addition
  if (shiftData.addEdge) {
    const { a, b } = shiftData.addEdge;
    if (hasEdge(edgeSet, a, b)) {
      // Edge already exists — skip it but don't fail the whole shift
      shiftData.addEdge = null;
    } else {
      if (territories[a].connections.length >= MAX_CONNECTIONS) {
        shiftData.addEdge = null; // Skip rather than fail
      }
      if (territories[b].connections.length >= MAX_CONNECTIONS) {
        shiftData.addEdge = null; // Skip rather than fail
      }
    }
  }

  // Validate value drift — just clamp, always valid
  // Validate aftershock — check that the target is still Plains
  if (shiftData.aftershock) {
    const t = territories[shiftData.aftershock.territoryId];
    if (t.terrain !== TERRAIN.PLAINS) {
      shiftData.aftershock = null; // No longer eligible
    }
  }

  return { valid: true };
}
