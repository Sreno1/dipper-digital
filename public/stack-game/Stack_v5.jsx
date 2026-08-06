import { useState, useEffect, useCallback, useRef } from "react";

const COLORS = ["Red", "Blue", "Yellow"];
const CM = {
  Red: { bg: "#E94560", glow: "rgba(233,69,96,0.5)", text: "#fff" },
  Blue: { bg: "#0EA5E9", glow: "rgba(14,165,233,0.5)", text: "#fff" },
  Yellow: { bg: "#FBBF24", glow: "rgba(251,191,36,0.5)", text: "#1a1a2e" },
};
const FLIP_MS = 10000;
const COIN_MS = 2200;
const START_POOL = 20;
const WOBBLE_START = 4;          // tower height at which instability begins
const WOBBLE_ADD_RATE = 0.07;    // base collapse chance per instability point when a card is added
const WOBBLE_BID_RATE = 0.025;   // collapse chance per instability point per bid spent
const RELOAD_COOLDOWN_CARDS = 4; // can't reload again for this many cards

function buildDeck() {
  const d = [];
  for (let v = 1; v <= 6; v++) for (const c of COLORS) d.push({ value: v, color: c });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function getStreak(tower) {
  if (!tower.length) return { count: 0, color: null };
  const top = tower[tower.length - 1].color;
  let n = 0;
  for (let i = tower.length - 1; i >= 0; i--) { if (tower[i].color === top) n++; else break; }
  return { count: n, color: top };
}
function getValueStreak(tower) {
  if (!tower.length) return { count: 0, value: null };
  const top = tower[tower.length - 1].value;
  let n = 0;
  for (let i = tower.length - 1; i >= 0; i--) { if (tower[i].value === top) n++; else break; }
  return { count: n, value: top };
}
function wouldCoin(tower, card) {
  const colorS = getStreak(tower);
  if (colorS.count >= 2 && colorS.color === card.color) return { triggers: true, type: "color", matchVal: card.color };
  const valS = getValueStreak(tower);
  if (valS.count >= 2 && valS.value === card.value) return { triggers: true, type: "value", matchVal: card.value };
  return { triggers: false };
}
// Returns instability level (0 = stable). Stabilized towers have instability 0 regardless of height.
function getInstability(tower, stabilized) {
  if (stabilized) return 0;
  return Math.max(0, tower.length - WOBBLE_START);
}
// Returns true if a wobble collapse fires
function rollWobbleAdd(instability) {
  if (instability <= 0) return false;
  return Math.random() < instability * WOBBLE_ADD_RATE;
}
function rollWobbleBid(instability, bidsSpent) {
  if (instability <= 0 || bidsSpent <= 0) return false;
  return Math.random() < instability * WOBBLE_BID_RATE * bidsSpent;
}
function resolveActions(p1a, p1b, p2a, p2b) {
  const r = { p1Gets: false, p2Gets: false, p1Forced: false, p2Forced: false, p1Spent: 0, p2Spent: 0, desc: "", tie: false, contested: false, tieCollapse: false };
  if (p1a === "pass" && p2a === "pass") { r.desc = "Both passed"; return r; }
  if (p1a !== "pass" && p2a === "pass") {
    r.p1Spent = p1b;
    if (p1a === "take") { r.p1Gets = true; r.desc = `You took it (bid ${p1b})`; }
    else { r.p2Forced = true; r.desc = `You forced opponent (bid ${p1b})`; }
    return r;
  }
  if (p1a === "pass" && p2a !== "pass") {
    r.p2Spent = p2b;
    if (p2a === "take") { r.p2Gets = true; r.desc = `Opponent took it (bid ${p2b})`; }
    else { r.p1Forced = true; r.desc = `Opponent forced you (bid ${p2b})`; }
    return r;
  }
  r.p1Spent = p1b; r.p2Spent = p2b; r.contested = true;
  if (p1b === p2b) {
    r.tie = true; r.tieCollapse = true;
    r.desc = `Tie at ${p1b}! Card destroyed — coin flip risk!`;
    return r;
  }
  if (p1b > p2b) {
    if (p1a === "take") { r.p1Gets = true; r.desc = `You won ${p1b} vs ${p2b}`; }
    else { r.p2Forced = true; r.desc = `You forced them! ${p1b} vs ${p2b}`; }
  } else {
    if (p2a === "take") { r.p2Gets = true; r.desc = `Opponent won ${p2b} vs ${p1b}`; }
    else { r.p1Forced = true; r.desc = `Forced on you! ${p2b} vs ${p1b}`; }
  }
  return r;
}
function aiDecide(aT, card, aPool, pT, pPool, aUn, pUn, aInstability, pInstability, aStable, pStable) {
  const theirS = getStreak(pT);
  const myFlip = wouldCoin(aT, card);
  const theirFlip = wouldCoin(pT, card);
  const max = Math.min(5, aPool);
  if (max <= 0) return { action: "pass", bid: 0 };

  // If player's tower is unstable, aggressively force cards onto it
  const pEffectiveInstability = getInstability(pT, pStable);
  const forceWobbleBonus = pEffectiveInstability >= 3 && !pStable;

  if (theirFlip.triggers && aPool >= 2) {
    if (Math.random() < (card.value >= 4 ? 0.75 : 0.55)) return { action: "force", bid: Math.min(max, card.value >= 5 ? 4 : 3) };
  }
  // Opportunistically force onto an unstable player tower even without a coin flip
  if (forceWobbleBonus && aPool >= 2 && card.value >= 2 && Math.random() < 0.5) {
    return { action: "force", bid: Math.min(max, 2) };
  }
  if (myFlip.triggers) {
    // If AI tower is unstable too, avoid making it worse — lean toward taking or passing with caution
    if (aInstability >= 3 && !aStable) {
      if (card.value >= 4 && Math.random() < 0.3) return { action: "take", bid: 1 }; // risky but tempting
      return { action: "pass", bid: 0 };
    }
    if (aPool <= 4 && aUn >= 8 && card.value >= 4 && Math.random() < 0.4) return { action: "take", bid: Math.min(max, 2) };
    if (theirS.count >= 1 && theirS.color === card.color && Math.random() < 0.35) return { action: "force", bid: Math.min(max, 2) };
    return { action: "pass", bid: 0 };
  }
  if (aPool <= 5) {
    if (card.value >= 5) return { action: "take", bid: Math.min(max, 2) };
    if (card.value >= 3 && Math.random() < 0.4) return { action: "take", bid: 1 };
    return { action: "pass", bid: 0 };
  }
  if (pPool <= 6 && card.value >= 3 && Math.random() < 0.3) return { action: "force", bid: Math.min(max, 2) };
  if (card.value >= 5) return { action: "take", bid: Math.min(max, Math.random() < 0.4 ? 4 : 3) };
  if (card.value >= 3) return { action: "take", bid: Math.min(max, 2) };
  if (card.value >= 1 && Math.random() < 0.45) return { action: "take", bid: 1 };
  return { action: "pass", bid: 0 };
}

// ─── Components ───
function CardC({ card, size = "normal", doubled = false, dimmed = false }) {
  const c = CM[card.color];
  const sz = size === "large" ? 68 : size === "tower" ? 30 : 42;
  const fs = size === "large" ? 26 : size === "tower" ? 12 : 16;
  return (
    <div style={{
      width: sz, height: sz * 1.35, borderRadius: 7, background: c.bg, color: c.text,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'JetBrains Mono',monospace", fontSize: fs, fontWeight: 800,
      boxShadow: doubled ? `0 0 14px ${c.glow},0 0 26px ${c.glow}` : dimmed ? "none" : `0 2px 10px ${c.glow}`,
      opacity: dimmed ? 0.3 : 1, position: "relative",
      border: doubled ? "2px solid #fff" : "2px solid rgba(255,255,255,0.15)",
      transition: "all 0.3s",
    }}>
      <span style={{ position: "relative", zIndex: 2 }}>{card.value}</span>
      {doubled && <span style={{ position: "absolute", top: 0, right: 2, fontSize: sz * 0.22, fontWeight: 900, color: "rgba(255,255,255,0.9)" }}>x2</span>}
    </div>
  );
}

function PoolBar({ pool, maxPool = START_POOL, justReloaded }) {
  const pct = Math.max(0, Math.min(100, (pool / maxPool) * 100));
  const color = pool <= 3 ? "#E94560" : pool <= 8 ? "#FBBF24" : "#0EA5E9";
  return (
    <div style={{ width: "100%", height: 6, borderRadius: 3, background: "rgba(255,255,255,.06)", overflow: "hidden", position: "relative" }}>
      <div style={{
        height: "100%", borderRadius: 3, width: `${pct}%`,
        background: color,
        transition: "width 0.5s ease, background 0.3s",
        boxShadow: justReloaded ? `0 0 12px ${color}` : pool <= 3 ? `0 0 8px ${color}` : "none",
      }} />
    </div>
  );
}

function TowerC({ tower, label, pool, unlocked, isPlayer, streak, collapsed, justReloaded, survivedSet, reloadCd, instability, stable }) {
  const danger = streak.count >= 2 ? 2 : streak.count >= 1 ? 1 : 0;
  const dc = streak.color ? CM[streak.color]?.glow : "transparent";
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 2px" }}>
      <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 11, fontWeight: 700, color: "#8892b0", textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>{label}</div>
      <div style={{
        fontSize: 28, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace",
        color: pool <= 3 ? "#E94560" : pool <= 8 ? "#FBBF24" : "#0EA5E9",
        textShadow: justReloaded ? "0 0 20px rgba(14,165,233,0.8)" : pool <= 3 ? "0 0 12px rgba(233,69,96,0.4)" : "none",
        transition: "all 0.5s", animation: pool <= 3 ? "blink 1.5s ease-in-out infinite" : "none",
        lineHeight: 1,
      }}>{pool}</div>
      <div style={{ fontSize: 8, color: "#3e4a5c", fontFamily: "'Space Mono',monospace", letterSpacing: 1, marginBottom: 2 }}>BIDS</div>
      <div style={{ width: "80%", marginBottom: 6 }}>
        <PoolBar pool={pool} justReloaded={justReloaded} />
      </div>

      {unlocked > 0 && (
        <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "#FBBF24", marginBottom: 2 }}>
          🗼 {unlocked}
        </div>
      )}
      {instability > 0 && !stable && (
        <div style={{ fontSize: 8, fontWeight: 700, fontFamily: "'Space Mono',monospace", color: "#FBBF24", marginBottom: 2, letterSpacing: 1, animation: instability >= 4 ? "blink 1.2s ease-in-out infinite" : "none" }}>🌀{instability}</div>
      )}
      {instability > 0 && stable && (
        <div style={{ fontSize: 8, fontWeight: 700, fontFamily: "'Space Mono',monospace", color: "#10B981", marginBottom: 2, letterSpacing: 1 }}>🛡{instability}</div>
      )}
      {isPlayer && reloadCd > 0 && (
        <div style={{ fontSize: 8, fontFamily: "'Space Mono',monospace", color: "#475569", marginBottom: 2 }}>reload in {reloadCd}</div>
      )}

      <div style={{
        flex: 1, display: "flex", flexDirection: "column-reverse", alignItems: "center",
        gap: 2, padding: 4, minHeight: 100, width: "100%", maxWidth: 72,
        borderRadius: 8, position: "relative",
        background: danger >= 2 ? `radial-gradient(ellipse at bottom,${dc} 0%,transparent 70%)` : "transparent",
        transition: "background 0.5s",
      }}>
        {collapsed && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, pointerEvents: "none" }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#E94560", fontFamily: "'Space Mono',monospace", textTransform: "uppercase", letterSpacing: 2, textShadow: "0 0 25px rgba(233,69,96,0.8)", animation: "collapseShake 0.4s ease" }}>COLLAPSE</div>
          </div>
        )}
        {tower.length === 0 && !collapsed && <div style={{ fontSize: 9, color: "#2d3748", fontFamily: "'Space Mono',monospace" }}>Empty</div>}
        {tower.map((card, i) => <div key={i}><CardC card={card} size="tower" dimmed={!isPlayer && i < tower.length - 1} doubled={survivedSet.has(i)} /></div>)}
      </div>
      {danger >= 2 && <div style={{ marginTop: 2, fontSize: 8, fontWeight: 700, color: CM[streak.color]?.bg, fontFamily: "'Space Mono',monospace", textTransform: "uppercase", letterSpacing: 1, animation: "blink 1s ease-in-out infinite" }}>⚠ 2x {streak.color} ⚠</div>}
    </div>
  );
}

function CoinFlipC({ result, color, flipType, matchVal, who, onComplete }) {
  const [stage, setStage] = useState("spin");
  const c = color ? CM[color] : { bg: "#FBBF24", glow: "rgba(251,191,36,0.5)", text: "#1a1a2e" };
  const label = flipType === "value"
    ? `${who === "player" ? "Your" : "Opponent's"} 3rd ${matchVal} — Coin Flip!`
    : `${who === "player" ? "Your" : "Opponent's"} 3rd ${color} — Coin Flip!`;
  useEffect(() => {
    const t1 = setTimeout(() => setStage("land"), COIN_MS * 0.55);
    const t2 = setTimeout(() => setStage("result"), COIN_MS * 0.7);
    const t3 = setTimeout(onComplete, COIN_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.92)", backdropFilter: "blur(12px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, animation: "fadeIn 0.2s ease" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: c.bg, fontFamily: "'Space Mono',monospace", textTransform: "uppercase", letterSpacing: 3 }}>
        {label}
      </div>
      <div style={{
        width: 100, height: 100, borderRadius: "50%",
        background: stage === "result"
          ? (result === "survive" ? "linear-gradient(135deg,#10B981,#059669)" : "linear-gradient(135deg,#E94560,#c2213e)")
          : `linear-gradient(135deg,${c.bg},#1a1a2e)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: stage === "spin" ? "coinSpin 0.15s linear infinite" : stage === "land" ? "coinBounce 0.5s ease" : "coinReveal 0.3s ease",
        boxShadow: stage === "result"
          ? (result === "survive" ? "0 0 60px rgba(16,185,129,0.7)" : "0 0 60px rgba(233,69,96,0.7)")
          : `0 0 40px ${c.glow}`,
        border: "3px solid rgba(255,255,255,0.3)",
        transition: "background 0.3s",
      }}>
        {stage === "result" && <span style={{ fontSize: 42, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace", color: "#fff" }}>{result === "survive" ? "✓" : "✕"}</span>}
      </div>
      {stage === "result" && (
        <div style={{
          fontSize: 20, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace",
          letterSpacing: 6, color: result === "survive" ? "#10B981" : "#E94560",
          textShadow: `0 0 25px ${result === "survive" ? "rgba(16,185,129,0.6)" : "rgba(233,69,96,0.6)"}`,
          animation: "slideUp 0.3s ease",
        }}>{result === "survive" ? "SURVIVED — 2x!" : "COLLAPSED!"}</div>
      )}
    </div>
  );
}

function FlatlineScreen({ onDone }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 400);
    const t2 = setTimeout(() => setStage(2), 1000);
    const t3 = setTimeout(() => setStage(3), 1600);
    const t4 = setTimeout(onDone, 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, []);
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 150,
      background: stage >= 1 ? "rgba(0,0,0,0.95)" : "rgba(0,0,0,0.6)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      transition: "background 0.5s ease",
    }}>
      {/* Flatline bar */}
      <div style={{ width: "80%", maxWidth: 400, height: 3, background: "rgba(255,255,255,.1)", borderRadius: 2, overflow: "hidden", position: "relative" }}>
        <div style={{
          position: "absolute", top: 0, left: 0, height: "100%",
          width: stage >= 1 ? "100%" : "60%",
          background: stage >= 2 ? "#E94560" : "#FBBF24",
          transition: "width 0.6s ease, background 0.3s",
          boxShadow: stage >= 2 ? "0 0 20px rgba(233,69,96,0.6)" : "none",
        }} />
      </div>
      {stage >= 2 && (
        <div style={{
          marginTop: 24, fontSize: 14, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace",
          color: "#E94560", letterSpacing: 6, textTransform: "uppercase",
          animation: "flatlinePulse 0.6s ease", textShadow: "0 0 30px rgba(233,69,96,0.6)",
        }}>BIDS DEPLETED</div>
      )}
      {stage >= 3 && (
        <div style={{
          width: "80%", maxWidth: 400, height: 2, marginTop: 16,
          background: "#E94560", borderRadius: 1,
          boxShadow: "0 0 30px rgba(233,69,96,0.5)",
          animation: "flatlineExpand 0.4s ease",
        }} />
      )}
    </div>
  );
}

function DeathScreen({ winner, pPool, aPool, cause, onRestart }) {
  const [show, setShow] = useState(false);
  useEffect(() => { setTimeout(() => setShow(true), 100); }, []);
  const causeText = {
    "bid_depleted_self": "You ran out of bid points.",
    "bid_depleted_opp": "Your opponent ran out of bid points.",
    "bid_contest_self": "A contested bid drained your last points.",
    "bid_contest_opp": "A contested bid drained your opponent's last points.",
    "collapse_starve_self": "Your tower collapsed, leaving you with no bids to recover.",
    "collapse_starve_opp": "Opponent's tower collapsed, leaving them with no bids.",
    "deck_empty": "The deck ran out. Final score: bids + tower value.",
    "draw": "The deck ran out and you tied. Nobody wins.",
  };
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.95)", backdropFilter: "blur(14px)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
      opacity: show ? 1 : 0, transition: "opacity 0.5s ease",
    }}>
      <div style={{
        fontSize: 48, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 10,
        color: winner === "player" ? "#10B981" : winner === "draw" ? "#FBBF24" : "#E94560",
        textShadow: `0 0 40px ${winner === "player" ? "rgba(16,185,129,0.4)" : winner === "draw" ? "rgba(251,191,36,0.4)" : "rgba(233,69,96,0.4)"}`,
        animation: "slideUp 0.5s ease",
      }}>
        {winner === "player" ? "VICTORY" : winner === "draw" ? "DRAW" : "DEFEAT"}
      </div>

      <div style={{
        maxWidth: 340, textAlign: "center", padding: "12px 20px",
        borderRadius: 8, background: "rgba(255,255,255,.03)",
        border: "1px solid rgba(255,255,255,.06)",
        animation: "slideUp 0.6s ease",
      }}>
        <div style={{ fontSize: 11, color: "#8892b0", fontFamily: "'Space Mono',monospace", lineHeight: 1.6 }}>
          {causeText[cause] || "Game over."}
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, marginTop: 4, animation: "slideUp 0.7s ease" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#475569", fontFamily: "'Space Mono',monospace", letterSpacing: 1 }}>YOUR BIDS</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", color: pPool <= 0 ? "#E94560" : "#10B981" }}>{pPool}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#475569", fontFamily: "'Space Mono',monospace", letterSpacing: 1 }}>OPP BIDS</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", color: aPool <= 0 ? "#E94560" : "#10B981" }}>{aPool}</div>
        </div>
      </div>

      <button onClick={onRestart} style={{
        marginTop: 14, padding: "13px 44px", fontSize: 14, fontWeight: 700,
        fontFamily: "'JetBrains Mono',monospace", letterSpacing: 4,
        background: "linear-gradient(135deg,#E94560,#c2213e)", color: "#fff",
        border: "none", borderRadius: 9, cursor: "pointer",
        boxShadow: "0 4px 20px rgba(233,69,96,0.4)",
        animation: "slideUp 0.8s ease",
      }}>PLAY AGAIN</button>
    </div>
  );
}

// ─── MAIN ───
export default function StackGame() {
  const [phase, setPhase] = useState("menu");
  const [deck, setDeck] = useState([]);
  const [ci, setCi] = useState(0);
  const [pT, setPT] = useState([]);
  const [aT, setAT] = useState([]);
  const [pPool, setPPool] = useState(START_POOL);
  const [aPool, setAPool] = useState(START_POOL);
  const [pSurv, setPSurv] = useState(new Set());
  const [aSurv, setASurv] = useState(new Set());
  const [pBon, setPBon] = useState(0);
  const [aBon, setABon] = useState(0);
  const [tmr, setTmr] = useState(100);
  const [resData, setResData] = useState(null);
  const [pColl, setPColl] = useState(false);
  const [aColl, setAColl] = useState(false);
  const [pReload, setPReload] = useState(false);
  const [aReload, setAReload] = useState(false);
  const [pReloadCd, setPReloadCd] = useState(0); // cards remaining before player can reload
  const [aReloadCd, setAReloadCd] = useState(0); // cards remaining before AI can reload
  const [pStable, setPStable] = useState(false);  // player tower stabilized by 3-of-a-kind
  const [aStable, setAStable] = useState(false);  // ai tower stabilized by 3-of-a-kind
  const [coin, setCoin] = useState(null);
  const [log, setLog] = useState([]);
  const [cd, setCd] = useState(3);
  const [winner, setWinner] = useState(null);
  const [deathCause, setDeathCause] = useState(null);
  const [flatline, setFlatline] = useState(null); // "player"|"ai"|null
  const tRef = useRef(null);
  const fRef = useRef(null);
  const cqRef = useRef([]);

  const card = deck[ci] || null;
  const pUn = pT.reduce((s, c) => s + c.value, 0) + pBon;
  const aUn = aT.reduce((s, c) => s + c.value, 0) + aBon;
  const pStr = getStreak(pT);
  const aStr = getStreak(aT);
  const rem = deck.length - ci;
  const mx = Math.min(5, pPool);
  const pInstability = getInstability(pT, pStable);
  const aInstability = getInstability(aT, aStable);

  const addLog = useCallback((m) => setLog(p => [m, ...p].slice(0, 30)), []);

  const triggerDeath = useCallback((w, cause, pp, ap) => {
    const who = w === "player" ? "ai" : "player"; // who flatlines
    setFlatline(who);
    // Flatline animation plays, then shows death screen
    setTimeout(() => {
      setFlatline(null);
      setWinner(w);
      setDeathCause(cause);
      setPhase("dead");
    }, 2400);
  }, []);

  const checkDeath = useCallback((pp, ap, context = "bid") => {
    if (pp <= 0) {
      const cause = context === "collapse" ? "collapse_starve_self" : context === "contest" ? "bid_contest_self" : "bid_depleted_self";
      triggerDeath("ai", cause, pp, ap);
      return true;
    }
    if (ap <= 0) {
      const cause = context === "collapse" ? "collapse_starve_opp" : context === "contest" ? "bid_contest_opp" : "bid_depleted_opp";
      triggerDeath("player", cause, pp, ap);
      return true;
    }
    return false;
  }, [triggerDeath]);

  const startGame = useCallback(() => {
    setDeck(buildDeck()); setCi(0);
    setPT([]); setAT([]);
    setPPool(START_POOL); setAPool(START_POOL);
    setPSurv(new Set()); setASurv(new Set());
    setPBon(0); setABon(0);
    setResData(null); setPColl(false); setAColl(false);
    setPReload(false); setAReload(false);
    setPReloadCd(0); setAReloadCd(0);
    setPStable(false); setAStable(false);
    setCoin(null); setLog([]); setWinner(null); setDeathCause(null); setFlatline(null);
    cqRef.current = [];
    setCd(3); setPhase("countdown");
  }, []);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (cd <= 0) { setPhase("playing"); setTmr(100); return; }
    const t = setTimeout(() => setCd(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, cd]);

  useEffect(() => {
    if (phase !== "playing") return;
    if (ci >= deck.length) {
      const pF = pPool + pUn, aF = aPool + aUn;
      if (pF === aF) { setWinner("draw"); setDeathCause("draw"); }
      else if (pF > aF) { setWinner("player"); setDeathCause("deck_empty"); }
      else { setWinner("ai"); setDeathCause("deck_empty"); }
      setPhase("dead");
      addLog(pF > aF ? "🏆 Deck empty — You win!" : pF < aF ? "💀 Deck empty — You lose!" : "🤝 Draw!");
      return;
    }
    setResData(null); setPColl(false); setAColl(false);
    // Tick down reload cooldowns
    setPReloadCd(c => Math.max(0, c - 1));
    setAReloadCd(c => Math.max(0, c - 1));
    const start = Date.now();
    tRef.current = setInterval(() => setTmr(Math.max(0, 100 - ((Date.now() - start) / FLIP_MS) * 100)), 60);
    fRef.current = setTimeout(() => submitChoice("pass", 0), FLIP_MS - 200);
    return () => { clearInterval(tRef.current); clearTimeout(fRef.current); };
  }, [phase, ci, deck.length]);

  const advance = useCallback(() => {
    setTimeout(() => { setCi(i => i + 1); setPhase("playing"); }, 400);
  }, []);

  const processCoinQ = useCallback(() => {
    if (cqRef.current.length === 0) { advance(); return; }
    setCoin(cqRef.current.shift());
  }, [advance]);

  const onCoinDone = useCallback(() => {
    const f = coin;
    setCoin(null);
    if (!f) { processCoinQ(); return; }

    if (f.who === "player") {
      if (f.result === "survive") {
        setPT(prev => {
          // Match streak by color or by value depending on flip type
          const sc = [];
          for (let i = prev.length - 1; i >= 0; i--) {
            const matches = f.flipType === "value" ? prev[i].value === f.matchVal : prev[i].color === f.color;
            if (matches) sc.push(prev[i]); else break;
          }
          const b = sc.reduce((s, c) => s + c.value, 0);
          setPBon(old => old + b);
          const ns = new Set(pSurv);
          for (let j = prev.length - sc.length; j < prev.length; j++) ns.add(j);
          setPSurv(ns);
          const label = f.flipType === "value" ? `3x ${f.matchVal}s` : `${sc.length} ${f.color}s`;
          addLog(`✨ Survived! ${label} doubled (+${b}) — tower stabilized`);
          setPStable(true); // 3-of-a-kind survive stabilizes the tower
          return prev;
        });
      } else {
        const lost = pUn;
        setPT([]); setPBon(0); setPSurv(new Set()); setPColl(true); setPStable(false);
        addLog(`💥 Tower collapsed! Lost ${lost} reload potential`);
        setTimeout(() => checkDeath(pPool, aPool, "collapse"), 500);
      }
    } else {
      if (f.result === "survive") {
        setAT(prev => {
          const sc = [];
          for (let i = prev.length - 1; i >= 0; i--) {
            const matches = f.flipType === "value" ? prev[i].value === f.matchVal : prev[i].color === f.color;
            if (matches) sc.push(prev[i]); else break;
          }
          const b = sc.reduce((s, c) => s + c.value, 0);
          setABon(old => old + b);
          const ns = new Set(aSurv);
          for (let j = prev.length - sc.length; j < prev.length; j++) ns.add(j);
          setASurv(ns);
          addLog(`✨ Opponent survived! Doubled (+${b}) — stabilized`);
          setAStable(true);
          return prev;
        });
      } else {
        setAT([]); setABon(0); setASurv(new Set()); setAColl(true); setAStable(false);
        addLog(`💥 Opponent collapsed!`);
        setTimeout(() => checkDeath(pPool, aPool, "collapse"), 500);
      }
    }
    setTimeout(processCoinQ, 500);
  }, [coin, pSurv, aSurv, pUn, pPool, aPool, addLog, processCoinQ, checkDeath]);

  const submitChoice = useCallback((pAct, pBid) => {
    clearInterval(tRef.current); clearTimeout(fRef.current);
    const c = deck[ci]; if (!c) return;
    setPhase("resolving");

    const ai = aiDecide(aT, c, aPool, pT, pPool, aUn, pUn, aInstability, pInstability, aStable, pStable);
    const res = resolveActions(pAct, pBid, ai.action, ai.bid);

    const newPP = pPool - res.p1Spent;
    const newAP = aPool - res.p2Spent;
    setPPool(newPP);
    setAPool(newAP);

    setResData({ pAction: pAct, pBid, aAction: ai.action, aBid: ai.bid, ...res });
    addLog(res.desc);

    setTimeout(() => {
      if (checkDeath(newPP, newAP, res.contested ? "contest" : "bid")) return;

      const queue = [];

      // Wobble-on-bid-spend: unstable towers can spontaneously collapse from the act of spending bids
      const pBidWobble = !res.tieCollapse && pT.length > 0 && rollWobbleBid(pInstability, res.p1Spent);
      const aBidWobble = !res.tieCollapse && aT.length > 0 && rollWobbleBid(aInstability, res.p2Spent);
      if (pBidWobble) { addLog(`🌀 Your tower wobbled from the bid strain!`); queue.push({ who: "player", result: "collapse", color: pT[pT.length - 1].color, flipType: "wobble", matchVal: null }); }
      if (aBidWobble) { addLog(`🌀 Opponent's tower wobbled!`); queue.push({ who: "ai", result: "collapse", color: aT[aT.length - 1].color, flipType: "wobble", matchVal: null }); }

      // Contested collapse: tie bid triggers 50/50 on both towers if they have cards
      if (res.tieCollapse) {
        if (pT.length > 0) queue.push({ who: "player", result: Math.random() < 0.5 ? "survive" : "collapse", color: pT[pT.length - 1].color, flipType: "contest", matchVal: null });
        if (aT.length > 0) queue.push({ who: "ai", result: Math.random() < 0.5 ? "survive" : "collapse", color: aT[aT.length - 1].color, flipType: "contest", matchVal: null });
      }

      if (res.p1Gets || res.p1Forced) {
        const tc = wouldCoin(pT, c);
        // Adding a new card: if it doesn't continue the stabilizing streak, clear stability
        const continuesStreak = pStable && (
          (pStr.color === c.color) || (pT[pT.length - 1]?.value === c.value)
        );
        if (pStable && !continuesStreak) setPStable(false);
        // Wobble-on-add (only if not already triggering a coin flip, and no bid wobble)
        const newTowerLen = pT.length + 1;
        const addInstability = getInstability({ length: newTowerLen }, pStable && continuesStreak);
        const addWobble = !tc.triggers && !pBidWobble && rollWobbleAdd(addInstability);
        setPT(prev => [...prev, c]);
        if (res.p1Forced) addLog(`⚡ ${c.color} ${c.value} forced into your tower!`);
        else addLog(`📥 Took ${c.color} ${c.value}`);
        if (tc.triggers) {
          queue.push({ who: "player", result: Math.random() < 0.5 ? "survive" : "collapse", color: c.color, flipType: tc.type, matchVal: tc.matchVal });
        } else if (addWobble) {
          addLog(`🌀 Tower groaned under the weight! (${newTowerLen} cards)`);
          queue.push({ who: "player", result: "collapse", color: c.color, flipType: "wobble", matchVal: null });
        }
      }

      if (res.p2Gets || res.p2Forced) {
        const tc = wouldCoin(aT, c);
        const continuesAStreak = aStable && (
          (aStr.color === c.color) || (aT[aT.length - 1]?.value === c.value)
        );
        if (aStable && !continuesAStreak) setAStable(false);
        const newATowerLen = aT.length + 1;
        const addAInstability = getInstability({ length: newATowerLen }, aStable && continuesAStreak);
        const addAWobble = !tc.triggers && !aBidWobble && rollWobbleAdd(addAInstability);
        setAT(prev => {
          const nt = [...prev, c];
          if (!tc.triggers && !addAWobble && ai.action === "take" && aReloadCd <= 0) {
            const newUn = nt.reduce((s, x) => s + x.value, 0) + aBon;
            const shouldReload = (newAP <= 6 && newUn >= 5) || (newUn >= 15 && Math.random() < 0.5) || (newAP <= 3);
            if (shouldReload && newUn > 0) {
              setAPool(p => p + newUn);
              setABon(0); setASurv(new Set()); setAStable(false);
              setAReload(true); setTimeout(() => setAReload(false), 1500);
              setAReloadCd(RELOAD_COOLDOWN_CARDS);
              addLog(`🔄 Opponent reloaded +${newUn} bids!`);
              return [];
            }
          }
          return nt;
        });
        if (res.p2Forced) addLog(`⚡ ${c.color} ${c.value} forced onto opponent!`);
        if (tc.triggers) {
          queue.push({ who: "ai", result: Math.random() < 0.5 ? "survive" : "collapse", color: c.color, flipType: tc.type, matchVal: tc.matchVal });
        } else if (addAWobble) {
          addLog(`🌀 Opponent's tower groaned! (${newATowerLen} cards)`);
          queue.push({ who: "ai", result: "collapse", color: c.color, flipType: "wobble", matchVal: null });
        }
      }

      cqRef.current = queue;
      setTimeout(processCoinQ, queue.length > 0 ? 600 : 250);
    }, 700);
  }, [deck, ci, pT, aT, pPool, aPool, pUn, aUn, aBon, aReloadCd, pStable, aStable, pInstability, aInstability, pStr, aStr, addLog, processCoinQ, checkDeath]);

  const handleLock = useCallback(() => {
    if (pT.length === 0 || phase === "resolving" || pReloadCd > 0) return;
    setPPool(p => p + pUn);
    setPT([]); setPBon(0); setPSurv(new Set());
    setPReload(true); setTimeout(() => setPReload(false), 1500);
    setPReloadCd(RELOAD_COOLDOWN_CARDS);
    addLog(`🔄 Reloaded +${pUn} bids! (cooldown: ${RELOAD_COOLDOWN_CARDS} cards)`);
  }, [pT, pUn, phase, pReloadCd, addLog]);

  // Button danger analysis
  const pCoinRisk = card && wouldCoin(pT, card);   // { triggers, type, matchVal } or { triggers: false }
  const aCoinRisk = card && wouldCoin(aT, card);

  function bidBtnStyle(action, n, avail) {
    const isLethal = avail && (pPool - n <= 0);
    const triggersCoin = action === "take" && pCoinRisk?.triggers;
    const forcesFlip = action === "force" && aCoinRisk?.triggers;
    const baseColor = action === "take" ? "#10B981" : "#E94560";

    if (!avail) return {
      background: "#0b0f18", color: "#1a1e2e",
      border: "2px solid rgba(255,255,255,.02)",
      cursor: "default", animation: "none",
    };
    if (isLethal && triggersCoin) return {
      background: "rgba(233,69,96,0.25)", color: "#E94560",
      border: "2px solid rgba(233,69,96,0.5)",
      cursor: "pointer", animation: "dangerPulse 1s ease-in-out infinite",
    };
    if (isLethal) return {
      background: "rgba(233,69,96,0.15)", color: "#E94560",
      border: "2px solid rgba(233,69,96,0.35)",
      cursor: "pointer", animation: "dangerPulse 1.5s ease-in-out infinite",
    };
    if (triggersCoin) return {
      background: "rgba(251,191,36,0.15)", color: "#FBBF24",
      border: "2px solid rgba(251,191,36,0.35)",
      cursor: "pointer", animation: "coinGlow 1.2s ease-in-out infinite",
    };
    if (forcesFlip) return {
      background: "rgba(233,69,96,0.2)", color: "#ff6b81",
      border: "2px solid rgba(233,69,96,0.4)",
      cursor: "pointer", animation: "forceGlow 1s ease-in-out infinite",
    };
    return {
      background: `rgba(${action === "take" ? "16,185,129" : "233,69,96"},0.1)`,
      color: baseColor,
      border: `2px solid rgba(${action === "take" ? "16,185,129" : "233,69,96"},0.2)`,
      cursor: "pointer", animation: "none",
    };
  }

  function bidBtnLabel(action, n) {
    const isLethal = pPool - n <= 0;
    const triggersCoin = action === "take" && pCoinRisk?.triggers;
    if (isLethal && triggersCoin) return "☠";
    if (isLethal) return `${n}!`;
    if (triggersCoin) return `${n}⚡`;
    return n;
  }

  return (
    <div style={{ width: "100%", minHeight: "100vh", background: "linear-gradient(145deg,#06060f 0%,#0f1729 40%,#0a0f1e 100%)", color: "#e2e8f0", fontFamily: "'Space Mono',monospace", display: "flex", flexDirection: "column", alignItems: "center", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=JetBrains+Mono:wght@400;700;800&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes pulse{0%{transform:scale(1)}50%{transform:scale(1.15)}100%{transform:scale(1)}}
        @keyframes slideUp{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes cardFlip{from{transform:rotateY(90deg) scale(.8)}to{transform:rotateY(0) scale(1)}}
        @keyframes coinSpin{0%{transform:rotateY(0) scale(1)}100%{transform:rotateY(360deg) scale(1)}}
        @keyframes coinBounce{0%{transform:scale(1) rotateY(180deg)}40%{transform:scale(1.2) rotateY(200deg)}70%{transform:scale(0.95)}100%{transform:scale(1) rotateY(180deg)}}
        @keyframes coinReveal{0%{transform:scale(0.9);opacity:0.5}100%{transform:scale(1);opacity:1}}
        @keyframes coinLand{0%{transform:scale(1.3)}60%{transform:scale(.9)}100%{transform:scale(1)}}
        @keyframes collapseShake{0%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}100%{transform:translateX(0)}}
        @keyframes dangerPulse{0%,100%{opacity:1;box-shadow:0 0 4px rgba(233,69,96,0.3)}50%{opacity:0.7;box-shadow:0 0 12px rgba(233,69,96,0.5)}}
        @keyframes coinGlow{0%,100%{box-shadow:0 0 4px rgba(251,191,36,0.2)}50%{box-shadow:0 0 14px rgba(251,191,36,0.5)}}
        @keyframes forceGlow{0%,100%{box-shadow:0 0 4px rgba(233,69,96,0.2)}50%{box-shadow:0 0 14px rgba(233,69,96,0.5)}}
        @keyframes flatlinePulse{0%{transform:scale(0.8);opacity:0}50%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
        @keyframes flatlineExpand{from{width:0}to{width:80%}}
        .lk{transition:all .2s}
        .lk:hover:not(:disabled){transform:scale(1.04);box-shadow:0 0 28px rgba(14,165,233,.4)!important}
        .lk:active:not(:disabled){animation:lockSlam .3s ease}
        @keyframes lockSlam{0%{transform:scale(1)}20%{transform:scale(.92)}50%{transform:scale(1.08)}100%{transform:scale(1)}}
        .ab{transition:all .12s}
        .ab:hover:not(:disabled){transform:translateY(-1px);filter:brightness(1.2)}
        .ab:active:not(:disabled){transform:translateY(1px) scale(0.97)}
      `}</style>

      {coin && <CoinFlipC result={coin.result} color={coin.color} flipType={coin.flipType} matchVal={coin.matchVal} who={coin.who} onComplete={onCoinDone} />}
      {flatline && <FlatlineScreen onDone={() => {}} />}
      {phase === "dead" && !flatline && <DeathScreen winner={winner} pPool={pPool} aPool={aPool} cause={deathCause} onRestart={startGame} />}

      {/* Header */}
      <div style={{ width: "100%", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
        <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: 6, fontFamily: "'JetBrains Mono',monospace", color: "#E94560" }}>STACK</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {phase !== "menu" && phase !== "countdown" && <div style={{ fontSize: 10, color: "#3e4a5c", letterSpacing: 1 }}>{rem} LEFT</div>}
          {phase !== "menu" && phase !== "countdown" && <button onClick={startGame} style={{ background: "transparent", border: "1px solid rgba(255,255,255,.06)", color: "#4a5568", padding: "3px 8px", borderRadius: 4, cursor: "pointer", fontSize: 9, fontFamily: "'Space Mono',monospace" }}>NEW</button>}
        </div>
      </div>

      {/* Menu */}
      {phase === "menu" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: 14, fontFamily: "'JetBrains Mono',monospace", color: "#E94560" }}>STACK</div>
          <div style={{ fontSize: 12, color: "#64748b", maxWidth: 380, lineHeight: 1.8 }}>
            Bid to take cards. Bid to force cards onto your opponent. Run out of bids and you're dead.
          </div>
          <div style={{ fontSize: 11, color: "#475569", maxWidth: 380, lineHeight: 1.8, padding: "12px 16px", borderRadius: 8, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.05)", textAlign: "left" }}>
            <div style={{ marginBottom: 6, textAlign: "center" }}><strong style={{ color: "#8892b0" }}>How It Works</strong></div>
            <div><strong style={{ color: "#10B981" }}>Take 1–5</strong> — bid to add a card to your tower</div>
            <div><strong style={{ color: "#E94560" }}>Force 1–5</strong> — bid to shove it onto your opponent</div>
            <div><strong style={{ color: "#6366F1" }}>Pass</strong> — free, costs nothing</div>
            <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,.05)", paddingTop: 8 }}>
              <div>3 same-color <strong style={{ color: "#ffffff" }}>or</strong> same-number in a row → <strong style={{ color: "#FBBF24" }}>50/50 coin flip</strong></div>
              <div>Survive → those cards <strong style={{ color: "#10B981" }}>score double</strong></div>
              <div>Fail → tower <strong style={{ color: "#E94560" }}>collapses</strong></div>
              <div style={{ marginTop: 4 }}>Tied bids → <strong style={{ color: "#FBBF24" }}>both towers flip</strong></div>
            </div>
            <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,.05)", paddingTop: 8 }}>
              <div><strong style={{ color: "#0EA5E9" }}>Reload</strong> = cash tower into bids (cooldown: {RELOAD_COOLDOWN_CARDS} cards)</div>
              <div><strong style={{ color: "#E94560" }}>Tower 5+ cards</strong> = bleeds bids each round</div>
              <div><strong style={{ color: "#E94560" }}>Bids hit 0 = you lose</strong></div>
            </div>
            <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,.05)", paddingTop: 8, fontSize: 10, color: "#3e4a5c" }}>
              <div>⚡ = coin flip risk &nbsp; <span style={{ color: "#E94560" }}>!</span> = would empty your bids &nbsp; ☠ = both</div>
            </div>
          </div>
          <button onClick={startGame} style={{ marginTop: 8, padding: "13px 48px", fontSize: 15, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 4, background: "linear-gradient(135deg,#E94560,#c2213e)", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", boxShadow: "0 4px 22px rgba(233,69,96,.4)" }}>PLAY</button>
        </div>
      )}

      {phase === "countdown" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 96, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", color: "#E94560", animation: "pulse .8s ease-in-out infinite" }}>{cd || "GO"}</div>
        </div>
      )}

      {/* Game */}
      {(phase === "playing" || phase === "resolving") && (
        <div style={{ flex: 1, width: "100%", maxWidth: 580, display: "flex", flexDirection: "column", padding: "2px 4px", overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 2, flex: 1, minHeight: 0 }}>
            <TowerC tower={pT} label="You" pool={pPool} unlocked={pUn} isPlayer={true} streak={pStr} collapsed={pColl} justReloaded={pReload} survivedSet={pSurv} reloadCd={pReloadCd} instability={pInstability} stable={pStable} />

            <div style={{ flex: 1.5, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7, padding: "0 4px" }}>
              {phase === "playing" && (
                <div style={{ width: "100%", height: 3, borderRadius: 2, background: "rgba(255,255,255,.04)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 2, width: `${tmr}%`, background: tmr < 25 ? "#E94560" : tmr < 55 ? "#FBBF24" : "#10B981", transition: "width .1s linear,background .3s" }} />
                </div>
              )}

              {card && (
                <div style={{ animation: phase === "playing" && !resData ? "cardFlip .35s ease" : "none", position: "relative" }}>
                  <CardC card={card} size="large" />
                  {pCoinRisk?.triggers && phase === "playing" && <div style={{ position: "absolute", top: -15, left: "50%", transform: "translateX(-50%)", fontSize: 8, fontWeight: 700, color: "#FBBF24", fontFamily: "'Space Mono',monospace", whiteSpace: "nowrap", letterSpacing: 1, animation: "blink .8s ease-in-out infinite" }}>{pCoinRisk.type === "value" ? `⚡ 3x${pCoinRisk.matchVal}` : "⚡ COIN FLIP"}</div>}
                  {aCoinRisk?.triggers && phase === "playing" && <div style={{ position: "absolute", bottom: -15, left: "50%", transform: "translateX(-50%)", fontSize: 8, fontWeight: 700, color: "#E94560", fontFamily: "'Space Mono',monospace", whiteSpace: "nowrap", letterSpacing: 1, animation: "blink 1s ease-in-out infinite" }}>{aCoinRisk.type === "value" ? `FORCE=⚡3x${aCoinRisk.matchVal}` : "FORCE = ⚡"}</div>}
                </div>
              )}

              {resData && (
                <div style={{ animation: "slideUp .2s ease", textAlign: "center", padding: "5px 8px", borderRadius: 7, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.04)", width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 3 }}>
                    <div>
                      <div style={{ fontSize: 7, color: "#3e4a5c", letterSpacing: 1 }}>YOU</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: resData.pAction === "take" ? "#10B981" : resData.pAction === "force" ? "#E94560" : "#6366F1" }}>
                        {resData.pAction.toUpperCase()}{resData.pBid > 0 ? ` ${resData.pBid}` : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "#1e293b", alignSelf: "center" }}>vs</div>
                    <div>
                      <div style={{ fontSize: 7, color: "#3e4a5c", letterSpacing: 1 }}>OPP</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: resData.aAction === "take" ? "#10B981" : resData.aAction === "force" ? "#E94560" : "#6366F1" }}>
                        {resData.aAction.toUpperCase()}{resData.aBid > 0 ? ` ${resData.aBid}` : ""}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 9, color: resData.tie ? "#FBBF24" : "#64748b" }}>{resData.desc}</div>
                </div>
              )}

              {/* Controls — one tap */}
              {phase === "playing" && (
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
                  {/* TAKE row */}
                  <div style={{ display: "flex", gap: 3, alignItems: "stretch" }}>
                    <div style={{ width: 48, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, color: pPool > 0 ? "#10B981" : "#2d3748" }}>TAKE</div>
                    <div style={{ flex: 1, display: "flex", gap: 3 }}>
                      {[1, 2, 3, 4, 5].map(n => {
                        const avail = n <= mx && pPool > 0;
                        const s = bidBtnStyle("take", n, avail);
                        return (
                          <button key={n} className="ab" disabled={!avail} onClick={() => avail && submitChoice("take", n)}
                            style={{ flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", borderRadius: 6, transition: "all .12s", ...s }}>
                            {bidBtnLabel("take", n)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* FORCE row */}
                  <div style={{ display: "flex", gap: 3, alignItems: "stretch" }}>
                    <div style={{ width: 48, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, color: pPool > 0 ? "#E94560" : "#2d3748" }}>FORCE</div>
                    <div style={{ flex: 1, display: "flex", gap: 3 }}>
                      {[1, 2, 3, 4, 5].map(n => {
                        const avail = n <= mx && pPool > 0;
                        const s = bidBtnStyle("force", n, avail);
                        return (
                          <button key={n} className="ab" disabled={!avail} onClick={() => avail && submitChoice("force", n)}
                            style={{ flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", borderRadius: 6, transition: "all .12s", ...s }}>
                            {n}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* PASS */}
                  <button className="ab" onClick={() => submitChoice("pass", 0)}
                    style={{ padding: "8px 0", fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 3, background: "rgba(99,102,241,0.08)", color: "#6366F1", border: "2px solid rgba(99,102,241,0.15)", borderRadius: 6, cursor: "pointer", width: "100%" }}>
                    PASS — FREE
                  </button>
                </div>
              )}

              {/* Reload */}
              {(phase === "playing" || phase === "resolving") && (
                <button className="lk" onClick={handleLock} disabled={pT.length === 0 || phase === "resolving" || pReloadCd > 0}
                  style={{
                    width: "100%", padding: "10px 0", fontSize: 12, fontWeight: 800,
                    fontFamily: "'JetBrains Mono',monospace", letterSpacing: 3,
                    background: (pT.length === 0 || phase === "resolving" || pReloadCd > 0) ? "#111827" : "linear-gradient(135deg,#0EA5E9,#0369a1)",
                    color: (pT.length === 0 || phase === "resolving" || pReloadCd > 0) ? "#2d3748" : "#fff",
                    border: (pT.length === 0 || phase === "resolving" || pReloadCd > 0) ? "2px solid #111827" : "2px solid rgba(14,165,233,.3)",
                    borderRadius: 8, cursor: (pT.length === 0 || phase === "resolving" || pReloadCd > 0) ? "default" : "pointer",
                    boxShadow: (pT.length === 0 || phase === "resolving" || pReloadCd > 0) ? "none" : "0 4px 16px rgba(14,165,233,.2)",
                   }}>{pReloadCd > 0 ? `🔄 RELOAD (${pReloadCd})` : `🔄 RELOAD${pUn > 0 ? ` +${pUn}` : ""}`}</button>
              )}
            </div>

            <TowerC tower={aT} label="Opponent" pool={aPool} unlocked={aUn} isPlayer={false} streak={aStr} collapsed={aColl} justReloaded={aReload} survivedSet={aSurv} instability={aInstability} stable={aStable} />
          </div>

          {/* Log */}
          <div style={{ marginTop: 3, padding: "4px 6px", maxHeight: 56, overflowY: "auto", background: "rgba(0,0,0,.25)", borderRadius: 6, border: "1px solid rgba(255,255,255,.02)" }}>
            {log.slice(0, 5).map((m, i) => <div key={i} style={{ fontSize: 9, color: i === 0 ? "#8892b0" : "#2d3748", fontFamily: "'Space Mono',monospace", padding: "1px 0" }}>{m}</div>)}
            {log.length === 0 && <div style={{ fontSize: 9, color: "#2d3748", fontFamily: "'Space Mono',monospace" }}>Events appear here...</div>}
          </div>
        </div>
      )}
    </div>
  );
}
