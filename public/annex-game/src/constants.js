// ============================================================
// ANNEX — constants.js
// Shared constants, terrain definitions, ability/tool catalogs,
// network bonuses, curated map presets
// ============================================================

export const VERSION = "0.5";

// --------------------------------------------------------
// Territory Names
// --------------------------------------------------------
export const TERRITORY_NAMES = [
  "Kessler", "Voss", "Maren", "Dahl", "Oren",
  "Thane", "Liora", "Calix", "Selene",
];

// --------------------------------------------------------
// Network Bonuses
// --------------------------------------------------------
export const NETWORK_BONUS = { 3: 3, 4: 5, 5: 8, 6: 12, 7: 15 };

export function getNetworkBonus(len) {
  if (len < 3) return 0;
  if (len <= 7) return NETWORK_BONUS[len];
  return 15 + (len - 7) * 3;
}

// --------------------------------------------------------
// Hand Strengths
// --------------------------------------------------------
export const RANKED_HAND_STRENGTHS = [4, 3, 2, 1, 1];
export const EXTRACTION_HAND_STRENGTHS = [4, 3, 2, 2, 1, 1];
export const WILD_CARD_CHANCE = 0.10;

// --------------------------------------------------------
// Terrain Types
// --------------------------------------------------------
export const TERRAIN = {
  PLAINS:        "plains",
  HIGH_GROUND:   "high_ground",
  FOG:           "fog",
  OBSERVATORY:   "observatory",
  CHOKEPOINT:    "chokepoint",
  SCORCHED_EARTH:"scorched_earth",
};

export const TERRAIN_META = {
  [TERRAIN.PLAINS]: {
    label: "Plains",
    icon: "",
    description: "No modifier. Standard territory.",
  },
  [TERRAIN.HIGH_GROUND]: {
    label: "High Ground",
    icon: "▲",
    description: "Defender (claimer) gets +1 influence.",
  },
  [TERRAIN.FOG]: {
    label: "Fog",
    icon: "◌",
    description: "Card placements here are hidden from the opponent.",
  },
  [TERRAIN.OBSERVATORY]: {
    label: "Observatory",
    icon: "◎",
    description: "Claimer gains secret intel.",
  },
  [TERRAIN.CHOKEPOINT]: {
    label: "Chokepoint",
    icon: "◆",
    description: "Counts double for network chain length.",
  },
  [TERRAIN.SCORCHED_EARTH]: {
    label: "Scorched Earth",
    icon: "✕",
    description: "Annexed territory is worth 0 points to the annexer.",
  },
};

// Minimum percentage of territories that must be plains
export const MIN_PLAINS_RATIO = 0.5;

// --------------------------------------------------------
// Abilities (Extraction Mode)
// --------------------------------------------------------
export const ABILITY = {
  INTERCEPT: "intercept",
  REDIRECT:  "redirect",
  SPLIT:     "split",
  REINFORCE: "reinforce",
  DECOY:     "decoy",
  SABOTAGE:  "sabotage",
  ENTRENCH:  "entrench",
  RECALL:    "recall",
};

export const ABILITY_META = {
  [ABILITY.INTERCEPT]: {
    label: "Intercept",
    icon: "👁",
    cost: 80,
    description: "Reveal the strength of one opponent card. They are notified.",
    targeting: "opponent_card", // click an opponent face-down card
  },
  [ABILITY.REDIRECT]: {
    label: "Redirect",
    icon: "↪",
    cost: 100,
    description: "Move your played card to adjacent territory. Strength −1 (min 1).",
    targeting: "own_card_then_adjacent", // click own card, then adjacent territory
  },
  [ABILITY.SPLIT]: {
    label: "Split",
    icon: "✂",
    cost: 120,
    description: "Discard a hand card (str 3+), get two half-strength cards.",
    targeting: "hand_card", // click a hand card with strength >= 3
  },
  [ABILITY.REINFORCE]: {
    label: "Reinforce",
    icon: "🛡",
    cost: 60,
    description: "Add +1 strength to one of your played cards (max 5).",
    targeting: "own_card", // click own face-down card on board
  },
  [ABILITY.DECOY]: {
    label: "Decoy",
    icon: "🎭",
    cost: 40,
    description: "Place a fake card (strength 0) on any territory.",
    targeting: "any_territory", // click any territory
  },
  [ABILITY.SABOTAGE]: {
    label: "Sabotage",
    icon: "💣",
    cost: 150,
    description: "Remove an opponent's card from the board. Returns to their hand.",
    targeting: "opponent_card", // click an opponent face-down card
  },
  [ABILITY.ENTRENCH]: {
    label: "Entrench",
    icon: "🏰",
    cost: 70,
    description: "Your claimed territory gets +2 defender bonus. Stacks with High Ground.",
    targeting: "own_claimed", // click a territory you claimed
  },
  [ABILITY.RECALL]: {
    label: "Recall",
    icon: "↩",
    cost: 90,
    description: "Pick up one of your played cards and return it to hand.",
    targeting: "own_card", // click own face-down card on board
  },
};

export const MAX_ABILITIES_PER_LOADOUT = 3;

// --------------------------------------------------------
// Terraforming Tools (Extraction Mode)
// --------------------------------------------------------
export const TOOL = {
  FORTIFICATION_KIT: "fortification_kit",
  FOG_MACHINE:       "fog_machine",
  WATCHTOWER:        "watchtower",
  CHOKEPOINT_CHARGE: "chokepoint_charge",
  SALT_THE_EARTH:    "salt_the_earth",
  DEMOLITION_CHARGE: "demolition_charge",
  BRIDGE_BUILDER:    "bridge_builder",
};

export const TOOL_META = {
  [TOOL.FORTIFICATION_KIT]: {
    label: "Fortification Kit",
    icon: "▲",
    cost: 100,
    description: "Convert Plains → High Ground.",
    targetConstraint: "plains",
  },
  [TOOL.FOG_MACHINE]: {
    label: "Fog Machine",
    icon: "◌",
    cost: 120,
    description: "Convert Plains → Fog. Must not be adjacent to existing Fog.",
    targetConstraint: "plains_no_adjacent_fog",
  },
  [TOOL.WATCHTOWER]: {
    label: "Watchtower",
    icon: "◎",
    cost: 150,
    description: "Convert Plains → Observatory. Max 1 per player per match.",
    targetConstraint: "plains_observatory_limit",
  },
  [TOOL.CHOKEPOINT_CHARGE]: {
    label: "Chokepoint Charge",
    icon: "◆",
    cost: 80,
    description: "Convert Plains → Chokepoint. Territory must have exactly 2 connections.",
    targetConstraint: "plains_2_connections",
  },
  [TOOL.SALT_THE_EARTH]: {
    label: "Salt the Earth",
    icon: "✕",
    cost: 90,
    description: "Convert Plains → Scorched Earth. Territory must have value ≥ 2.",
    targetConstraint: "plains_value_2_plus",
  },
  [TOOL.DEMOLITION_CHARGE]: {
    label: "Demolition Charge",
    icon: "💥",
    cost: 200,
    description: "Remove one edge. Cannot disconnect graph or drop below 2 connections.",
    targetConstraint: "edge_removable",
  },
  [TOOL.BRIDGE_BUILDER]: {
    label: "Bridge Builder",
    icon: "🌉",
    cost: 200,
    description: "Add edge between two territories within 2 hops. Max 4 connections each.",
    targetConstraint: "edge_addable",
  },
};

export const MAX_TOOLS_PER_LOADOUT = 2;

// --------------------------------------------------------
// Wager Tiers (Extraction Mode)
// --------------------------------------------------------
export const WAGER_TIERS = [
  { name: "Scrap",    min: 50,  max: 149 },
  { name: "Skirmish", min: 150, max: 299 },
  { name: "Siege",    min: 300, max: 499 },
  { name: "All In",   min: 500, max: Infinity },
];

export const MIN_WAGER = 50;
export const BASE_WIN_REWARD = 100;
export const MARGIN_BONUS_PER_POINT = 10;
export const RELIEF_PACKAGE = 200;
export const STARTING_SALVAGE = 500;
export const SEASON_CARRYOVER_RATIO = 0.5;
export const SEASON_FLOOR_BONUS = 200;

// --------------------------------------------------------
// Timing
// --------------------------------------------------------
export const AI_TURN_DELAY_MIN = 700;
export const AI_TURN_DELAY_MAX = 1200;
export const RESOLUTION_STEP_DELAY = 350;
export const RESOLUTION_BAR_DELAY = 200;
export const RESOLUTION_RESULT_DELAY = 650;
export const TECTONIC_WARNING_TURNS = 2;

// --------------------------------------------------------
// Rendering Colors
// --------------------------------------------------------
export const COLORS = {
  player:      "#2563eb",
  playerLight: "#60a5fa",
  playerBg:    "rgba(37,99,235,0.18)",
  playerGlow:  "rgba(37,99,235,0.5)",
  ai:          "#d97706",
  aiLight:     "#fbbf24",
  aiBg:        "rgba(217,119,6,0.18)",
  aiGlow:      "rgba(217,119,6,0.5)",
  neutral:     "#3a3f54",
  contested:   "#e879f9",
  edge:        "rgba(255,255,255,0.06)",
  edgeOwned:   "rgba(255,255,255,0.2)",
  text:        "#e8eaed",
  textDim:     "#8b8fa3",
  textMuted:   "#5a5e72",
  surface:     "#181a24",
  surface2:    "#1e2130",
  surface3:    "#262a3a",
  accent:      "#a78bfa",
  accentGlow:  "rgba(167,139,250,0.5)",
  accentLight: "#c4b5fd",
  success:     "#22c55e",

  // Terrain-specific
  highGround:    "#4ade80",
  fog:           "#94a3b8",
  observatory:   "#facc15",
  chokepoint:    "#f472b6",
  scorchedEarth: "#ef4444",
};

// --------------------------------------------------------
// Canvas geometry
// --------------------------------------------------------
export const NODE_RADIUS = 36;
export const NODE_RADIUS_HOVERED = 40;
export const NODE_RADIUS_FOCUS = 44;
export const HIT_RADIUS = 38;
export const PAD_X = 80;
export const PAD_Y = 60;

// --------------------------------------------------------
// Curated Map Presets (Ranked Mode)
// --------------------------------------------------------
// Each preset defines: name, positions (0-1 normalized), edges,
// point values, and terrain assignments.
//
// Maps are split 50/50:
//   Conservative (3): Basin, Ridgeline, Lattice
//   Terrain-heavy (3): Ashlands, Blackout, Fortress

export const MAP_PRESETS = {
  basin: {
    name: "Basin",
    description: "Simple layout. High Ground anchors the center.",
    category: "conservative",
    positions: [
      { x: 0.20, y: 0.18 }, // 0
      { x: 0.50, y: 0.15 }, // 1
      { x: 0.80, y: 0.18 }, // 2
      { x: 0.12, y: 0.50 }, // 3
      { x: 0.50, y: 0.50 }, // 4 — center
      { x: 0.88, y: 0.50 }, // 5
      { x: 0.20, y: 0.82 }, // 6
      { x: 0.50, y: 0.85 }, // 7
      { x: 0.80, y: 0.82 }, // 8
    ],
    edges: [
      [0,1],[1,2],[0,3],[1,4],[2,5],
      [3,4],[4,5],[3,6],[4,7],[5,8],
      [6,7],[7,8],[0,4],[4,8],
    ],
    values: [2, 3, 2, 3, 5, 3, 1, 4, 4],
    terrain: [
      TERRAIN.PLAINS,        // 0
      TERRAIN.PLAINS,        // 1
      TERRAIN.PLAINS,        // 2
      TERRAIN.PLAINS,        // 3
      TERRAIN.HIGH_GROUND,   // 4 — center high ground
      TERRAIN.PLAINS,        // 5
      TERRAIN.CHOKEPOINT,    // 6 — 2 connections: 3,7
      TERRAIN.PLAINS,        // 7
      TERRAIN.PLAINS,        // 8
    ],
  },

  ridgeline: {
    name: "Ridgeline",
    description: "Linear topology. Fog on a wing, Scorched Earth on a prize.",
    category: "conservative",
    positions: [
      { x: 0.10, y: 0.40 }, // 0 — left end
      { x: 0.25, y: 0.25 }, // 1
      { x: 0.25, y: 0.60 }, // 2
      { x: 0.45, y: 0.40 }, // 3
      { x: 0.55, y: 0.65 }, // 4
      { x: 0.65, y: 0.30 }, // 5
      { x: 0.75, y: 0.55 }, // 6
      { x: 0.85, y: 0.25 }, // 7
      { x: 0.90, y: 0.55 }, // 8 — right end
    ],
    edges: [
      [0,1],[0,2],[1,2],[1,3],[2,3],
      [3,4],[3,5],[4,5],[4,6],[5,6],
      [5,7],[6,7],[6,8],[7,8],
    ],
    values: [2, 3, 1, 4, 3, 5, 2, 3, 4],
    terrain: [
      TERRAIN.PLAINS,         // 0
      TERRAIN.PLAINS,         // 1
      TERRAIN.FOG,            // 2 — fog on a wing
      TERRAIN.PLAINS,         // 3
      TERRAIN.PLAINS,         // 4
      TERRAIN.SCORCHED_EARTH, // 5 — high value, scorched
      TERRAIN.HIGH_GROUND,    // 6
      TERRAIN.PLAINS,         // 7
      TERRAIN.PLAINS,         // 8
    ],
  },

  lattice: {
    name: "Lattice",
    description: "High connectivity. Observatory provides info edge.",
    category: "conservative",
    positions: [
      { x: 0.20, y: 0.15 }, // 0
      { x: 0.50, y: 0.10 }, // 1
      { x: 0.80, y: 0.15 }, // 2
      { x: 0.15, y: 0.50 }, // 3
      { x: 0.50, y: 0.48 }, // 4
      { x: 0.85, y: 0.50 }, // 5
      { x: 0.20, y: 0.85 }, // 6
      { x: 0.50, y: 0.88 }, // 7
      { x: 0.80, y: 0.85 }, // 8
    ],
    edges: [
      [0,1],[1,2],[0,3],[1,4],[2,5],
      [3,4],[4,5],[3,6],[4,7],[5,8],
      [6,7],[7,8],[0,4],[2,4],[6,4],[8,4],
    ],
    values: [3, 2, 3, 4, 3, 4, 2, 5, 1],
    terrain: [
      TERRAIN.PLAINS,       // 0
      TERRAIN.OBSERVATORY,  // 1 — observatory
      TERRAIN.PLAINS,       // 2
      TERRAIN.PLAINS,       // 3
      TERRAIN.PLAINS,       // 4
      TERRAIN.PLAINS,       // 5
      TERRAIN.CHOKEPOINT,   // 6 — only 2 connections: 3,7
      TERRAIN.PLAINS,       // 7
      TERRAIN.PLAINS,       // 8
    ],
  },

  ashlands: {
    name: "Ashlands",
    description: "Diverse terrain. Every type except Observatory represented.",
    category: "terrain-heavy",
    positions: [
      { x: 0.50, y: 0.08 }, // 0 — top
      { x: 0.22, y: 0.28 }, // 1
      { x: 0.78, y: 0.28 }, // 2
      { x: 0.10, y: 0.55 }, // 3
      { x: 0.50, y: 0.48 }, // 4 — center
      { x: 0.90, y: 0.55 }, // 5
      { x: 0.25, y: 0.80 }, // 6
      { x: 0.55, y: 0.82 }, // 7
      { x: 0.80, y: 0.80 }, // 8
    ],
    edges: [
      [0,1],[0,2],[1,2],[1,3],[1,4],
      [2,4],[2,5],[3,4],[4,5],[3,6],
      [4,7],[5,8],[6,7],[7,8],
    ],
    values: [4, 2, 2, 3, 5, 3, 1, 4, 3],
    terrain: [
      TERRAIN.SCORCHED_EARTH, // 0 — high value scorched
      TERRAIN.FOG,            // 1
      TERRAIN.PLAINS,         // 2
      TERRAIN.CHOKEPOINT,     // 3 — connections: 1,4,6 → actually 3, but we accept for variety
      TERRAIN.HIGH_GROUND,    // 4 — center high ground
      TERRAIN.PLAINS,         // 5
      TERRAIN.PLAINS,         // 6
      TERRAIN.PLAINS,         // 7
      TERRAIN.PLAINS,         // 8
    ],
  },

  blackout: {
    name: "Blackout",
    description: "Information denial. Two Fog zones make card counting near-impossible.",
    category: "terrain-heavy",
    positions: [
      { x: 0.15, y: 0.20 }, // 0
      { x: 0.45, y: 0.12 }, // 1
      { x: 0.75, y: 0.18 }, // 2
      { x: 0.08, y: 0.55 }, // 3
      { x: 0.40, y: 0.50 }, // 4
      { x: 0.72, y: 0.50 }, // 5
      { x: 0.20, y: 0.82 }, // 6
      { x: 0.55, y: 0.85 }, // 7
      { x: 0.85, y: 0.78 }, // 8
    ],
    edges: [
      [0,1],[1,2],[0,3],[0,4],[1,4],
      [2,5],[3,4],[4,5],[3,6],[4,7],
      [5,8],[6,7],[7,8],
    ],
    values: [3, 4, 2, 1, 3, 4, 3, 5, 2],
    terrain: [
      TERRAIN.FOG,           // 0 — fog zone 1
      TERRAIN.PLAINS,        // 1 — buffer (not adjacent to 6)
      TERRAIN.PLAINS,        // 2
      TERRAIN.PLAINS,        // 3
      TERRAIN.OBSERVATORY,   // 4 — counter to the fog
      TERRAIN.HIGH_GROUND,   // 5
      TERRAIN.FOG,           // 6 — fog zone 2 (not adjacent to 0)
      TERRAIN.PLAINS,        // 7
      TERRAIN.PLAINS,        // 8
    ],
  },

  fortress: {
    name: "Fortress",
    description: "Defensive map. Annexation is costly. Only 4 Plains territories.",
    category: "terrain-heavy",
    positions: [
      { x: 0.50, y: 0.08 }, // 0 — top
      { x: 0.20, y: 0.30 }, // 1
      { x: 0.80, y: 0.30 }, // 2
      { x: 0.10, y: 0.58 }, // 3
      { x: 0.50, y: 0.50 }, // 4 — center
      { x: 0.90, y: 0.58 }, // 5
      { x: 0.25, y: 0.82 }, // 6
      { x: 0.50, y: 0.90 }, // 7
      { x: 0.75, y: 0.82 }, // 8
    ],
    edges: [
      [0,1],[0,2],[1,2],[1,3],[1,4],
      [2,4],[2,5],[3,4],[4,5],[3,6],
      [6,7],[7,8],[5,8],[4,7],
    ],
    values: [3, 4, 4, 2, 5, 2, 3, 3, 1],
    terrain: [
      TERRAIN.SCORCHED_EARTH, // 0 — scorched at top
      TERRAIN.HIGH_GROUND,    // 1 — defensive anchor left
      TERRAIN.HIGH_GROUND,    // 2 — defensive anchor right
      TERRAIN.PLAINS,         // 3
      TERRAIN.FOG,            // 4 — fog center
      TERRAIN.PLAINS,         // 5
      TERRAIN.PLAINS,         // 6
      TERRAIN.CHOKEPOINT,     // 7 — connections: 6,8,4 → bridge territory
      TERRAIN.PLAINS,         // 8
    ],
  },
};

// --------------------------------------------------------
// Random Map Layouts (used when not using a preset)
// --------------------------------------------------------
export const RANDOM_LAYOUTS = [
  // Layout: 3-3-3 hex rows
  [
    { x: 0.20, y: 0.18 }, { x: 0.50, y: 0.15 }, { x: 0.80, y: 0.18 },
    { x: 0.12, y: 0.50 }, { x: 0.50, y: 0.50 }, { x: 0.88, y: 0.50 },
    { x: 0.20, y: 0.82 }, { x: 0.50, y: 0.85 }, { x: 0.80, y: 0.82 },
  ],
  // Layout: diamond-ish
  [
    { x: 0.50, y: 0.10 }, { x: 0.25, y: 0.28 }, { x: 0.75, y: 0.28 },
    { x: 0.10, y: 0.50 }, { x: 0.50, y: 0.50 }, { x: 0.90, y: 0.50 },
    { x: 0.25, y: 0.72 }, { x: 0.75, y: 0.72 }, { x: 0.50, y: 0.90 },
  ],
  // Layout: cross-ish
  [
    { x: 0.50, y: 0.10 }, { x: 0.25, y: 0.30 }, { x: 0.50, y: 0.33 },
    { x: 0.75, y: 0.30 }, { x: 0.15, y: 0.55 }, { x: 0.50, y: 0.58 },
    { x: 0.85, y: 0.55 }, { x: 0.35, y: 0.82 }, { x: 0.65, y: 0.82 },
  ],
];

export const RANDOM_VALUES = [5, 4, 4, 3, 3, 3, 2, 2, 1];
export const TERRITORY_COUNT = 9;
export const MIN_CONNECTIONS = 2;
export const MAX_CONNECTIONS = 4;

// --------------------------------------------------------
// Game Phases
// --------------------------------------------------------
export const PHASE = {
  PLANNING:             "planning",
  TERRAFORMING:         "terraforming",
  ACTION:               "action",
  TECTONIC_SHIFT:       "tectonic-shift",
  RESOLUTION:           "resolution",
  RESOLUTION_NETWORKS:  "resolution-networks",
  GAMEOVER:             "gameover",
};

// --------------------------------------------------------
// Game Modes
// --------------------------------------------------------
export const MODE = {
  RANKED:     "ranked",
  EXTRACTION: "extraction",
};
