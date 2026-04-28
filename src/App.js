import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell
} from "recharts";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, onSnapshot,
  addDoc, deleteDoc, doc, query, orderBy, setDoc, getDocs
} from "firebase/firestore";

// ─── 🔥 FIREBASE CONFIG ───────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDnqYQjMNMI2UCEDi0FHPv9UTzrm_zju_8",
  authDomain: "ipl-friends-league.firebaseapp.com",
  projectId: "ipl-friends-league",
  storageBucket: "ipl-friends-league.firebasestorage.app",
  messagingSenderId: "1074393387493",
  appId: "1:1074393387493:web:e75bf9888e9310d3af9f0c"
};

// ─── ☁️ CLOUDINARY CONFIG ─────────────────────────────────────────────────────
const CLOUDINARY_CLOUD = "dfy5pxrzy";
const CLOUDINARY_PRESET = "ml_default";
const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ─── Constants ────────────────────────────────────────────────────────────────
const PLAYERS = ["Chandan Bhai", "Kalki", "Aswani Bhai", "Sagar Bhai", "Silu Bhai", "Sai Bhai"];
const RANK_POINTS = { 1: 100, 2: 75, 3: 50, 4: -50, 5: -75, 6: -100, NA: 0 };
const RANK_LABELS = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th" };
const COLORS  = ["#f59e0b", "#3b82f6", "#10b981", "#ec4899", "#8b5cf6", "#f97316"];
const EMOJIS  = ["🦁", "🐯", "🦊", "🐺", "🦅", "🐉"];

// IPL Player master list for autocomplete + fuzzy matching
const IPL_PLAYERS = [
  "Rohit Sharma","Virat Kohli","MS Dhoni","Jasprit Bumrah","Hardik Pandya",
  "Suryakumar Yadav","Ruturaj Gaikwad","Shubman Gill","Yashasvi Jaiswal",
  "KL Rahul","Sanju Samson","Jos Buttler","Rishabh Pant","Ishan Kishan",
  "Ravindra Jadeja","Axar Patel","Sunil Narine","Andre Russell","Glenn Maxwell",
  "David Miller","Rashid Khan","Yuzvendra Chahal","Mohammed Shami","Mohammed Siraj",
  "Bhuvneshwar Kumar","Trent Boult","Arshdeep Singh","Deepak Chahar","Pat Cummins",
  "Mitchell Marsh","Faf du Plessis","David Warner","Quinton de Kock","Travis Head",
  "Heinrich Klaasen","Abhishek Sharma","Tilak Varma","Shivam Dube","Nitish Rana",
  "Shreyas Iyer","Varun Chakravarthy","Ravi Bishnoi","Liam Livingstone","Nicholas Pooran",
  "Phil Salt","Wriddhiman Saha","Jonny Bairstow","Moeen Ali","Ravichandran Ashwin",
  "Mayank Agarwal","Prithvi Shaw","Devdutt Padikkal","Rinku Singh","Shivam Mavi",
  "Naman Dhir","Akash Madhwal","Gerald Coetzee","Alzarri Joseph","Romario Shepherd",
  "Mark Wood","Matheesha Pathirana","Tushar Deshpande","Shardul Thakur","Washington Sundar",
  "Rahul Tewatia","Sai Kishore","Vijay Shankar","Wanidu Hasaranga","Lockie Ferguson",
  "Adam Zampa","Josh Hazlewood","Cameron Green","Ben Stokes","Sam Curran",
  "Lalit Yadav","Kuldeep Yadav","Anrich Nortje","Mukesh Kumar","Harshit Rana",
  "Yash Dayal","Suyash Sharma","Ramandeep Singh","Shashank Singh","Rajat Patidar",
  "Anuj Rawat","Dinesh Karthik","Ambati Rayudu","Ajinkya Rahane","Manish Pandey",
];

// ─── Utilities ────────────────────────────────────────────────────────────────
const getPts = (rank) => (rank === "NA" ? 0 : (RANK_POINTS[rank] ?? 0));

const getBoard = (matches) => {
  const t = {};
  PLAYERS.forEach((p) => (t[p] = 0));
  matches.forEach((m) => PLAYERS.forEach((p) => (t[p] += getPts(m.ranks[p]))));
  return PLAYERS.map((name, i) => ({ name, total: t[name], color: COLORS[i], emoji: EMOJIS[i] }))
    .sort((a, b) => b.total - a.total)
    .map((p, i) => ({ ...p, rank: i + 1 }));
};

const getLineData = (matches) => {
  const run = {};
  PLAYERS.forEach((p) => (run[p] = 0));
  return matches.map((m, i) => {
    const pt = { label: `M${i + 1}` };
    PLAYERS.forEach((p) => { run[p] += getPts(m.ranks[p]); pt[p] = run[p]; });
    return pt;
  });
};

// ─── Simple fuzzy match against IPL player list ───────────────────────────────
function fuzzyMatch(raw) {
  if (!raw || raw.length < 3) return null;
  const lower = raw.toLowerCase().replace(/[^a-z\s]/g, "").trim();
  // exact match first
  const exact = IPL_PLAYERS.find(p => p.toLowerCase() === lower);
  if (exact) return exact;
  // partial match — check if any word in raw matches any word in player name
  const words = lower.split(" ").filter(w => w.length > 3);
  let best = null, bestScore = 0;
  for (const player of IPL_PLAYERS) {
    const pLower = player.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (pLower.includes(w)) score += w.length;
    }
    if (score > bestScore) { bestScore = score; best = player; }
  }
  return bestScore >= 4 ? best : null;
}

// ─── Parse OCR text into structured team ─────────────────────────────────────
function parseOCRText(rawText) {
  const lines = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 2);
  let captain = null, viceCaptain = null;
  const players = [];
  const used = new Set();

  for (const line of lines) {
    const isCaptain = /\b(C|2x|\(C\))\b/i.test(line);
    const isVC      = /\b(VC|1\.5x|\(VC\))\b/i.test(line);

    const rawName = line
      .replace(/\b(VC|1\.5x|\(VC\)|C|2x|\(C\))\b/gi, "")
      .replace(/[^a-zA-Z\s'.]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (rawName.length < 3) continue;

    const matched = fuzzyMatch(rawName);
    if (!matched || used.has(matched)) continue;
    used.add(matched);

    if (isCaptain)  captain     = matched;
    if (isVC)       viceCaptain = matched;

    players.push({ name: matched, rawName, isCaptain, isViceCaptain: isVC });

    if (players.length === 11) break;
  }

  return {
    players, captain, viceCaptain,
    detectedCount: players.length,
    confidence: players.length >= 9 ? "high" : players.length >= 6 ? "medium" : "low",
  };
}

// ─── Upload image to Cloudinary ───────────────────────────────────────────────
async function uploadToCloudinary(file) {
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", CLOUDINARY_PRESET);
  const res  = await fetch(CLOUDINARY_URL, { method: "POST", body: form });
  const data = await res.json();
  if (!data.secure_url) throw new Error("Cloudinary upload failed");
  return data.secure_url;
}

// ─── Run OCR using Tesseract (loaded from CDN) ────────────────────────────────
async function runOCR(file, onProgress) {
  // Dynamically load Tesseract.js from CDN if not already loaded
  if (!window.Tesseract) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const worker = await window.Tesseract.createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });
  const { data: { text } } = await worker.recognize(file);
  await worker.terminate();
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── PlayerCard ───────────────────────────────────────────────────────────────
function PlayerCard({ player, rank }) {
  const [hov, setHov] = useState(false);
  const isFirst = rank === 1, isLast = rank === 6;
  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: isFirst ? "linear-gradient(135deg,#1a1200,#2a1f00)" : isLast ? "linear-gradient(135deg,#1a0000,#2a0808)" : "linear-gradient(135deg,#111827,#1f2937)",
        border: `1px solid ${isFirst ? "#f59e0b55" : isLast ? "#ef444455" : "#ffffff11"}`,
        borderRadius: 16, padding: "18px 12px", textAlign: "center", position: "relative",
        transition: "transform .2s,box-shadow .2s", cursor: "default",
        transform: hov ? "translateY(-5px)" : "translateY(0)",
        boxShadow: hov ? (isFirst ? "0 12px 36px #f59e0b55" : isLast ? "0 12px 36px #ef444455" : "0 12px 28px #00000099") : (isFirst ? "0 4px 20px #f59e0b33" : isLast ? "0 4px 20px #ef444433" : "0 2px 12px #00000066"),
      }}
    >
      {isFirst && <div style={{ position: "absolute", top: 7, right: 9, fontSize: 16 }}>👑</div>}
      {isLast  && <div style={{ position: "absolute", top: 7, right: 9, fontSize: 16 }}>🔻</div>}
      <div style={{ fontSize: 30, marginBottom: 4 }}>{player.emoji}</div>
      <div style={{ color: player.color, fontWeight: 700, fontSize: 12, marginBottom: 6 }}>
        <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: player.color, boxShadow: `0 0 5px ${player.color}`, marginRight: 5 }} />
        {player.name}
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color: isFirst ? "#f59e0b" : isLast ? "#ef4444" : "#f1f5f9", fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 1 }}>
        {player.total > 0 ? "+" : ""}{player.total}
      </div>
      <div style={{ color: "#64748b", fontSize: 11, marginTop: 2, letterSpacing: 2 }}>{RANK_LABELS[rank]}</div>
    </div>
  );
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
function Leaderboard({ board }) {
  return (
    <div style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", border: "1px solid #ffffff11", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 24px #00000066" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #ffffff11", color: "#94a3b8", fontWeight: 700, letterSpacing: 2, fontSize: 11 }}>🏆 LEADERBOARD</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#ffffff08" }}>
            {["#", "Player", "Points", ""].map((h) => (
              <th key={h} style={{ padding: "9px 14px", textAlign: h === "Points" ? "right" : "left", color: "#64748b", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {board.map((p, i) => (
            <tr key={p.name} style={{ background: p.rank === 1 ? "#f59e0b08" : p.rank === 6 ? "#ef44440a" : i % 2 === 0 ? "#ffffff03" : "transparent", borderBottom: "1px solid #ffffff06" }}>
              <td style={{ padding: "11px 14px", color: "#64748b", fontWeight: 700 }}>{p.rank}</td>
              <td style={{ padding: "11px 14px" }}>
                <span style={{ fontSize: 18, marginRight: 7 }}>{p.emoji}</span>
                <span style={{ color: p.color, fontWeight: 600, fontSize: 13 }}>{p.name}</span>
              </td>
              <td style={{ padding: "11px 14px", textAlign: "right" }}>
                <span style={{ color: p.total >= 0 ? "#10b981" : "#ef4444", fontWeight: 800, fontSize: 15, fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 1 }}>
                  {p.total > 0 ? "+" : ""}{p.total}
                </span>
              </td>
              <td style={{ padding: "11px 14px" }}>{p.rank === 1 ? "👑" : p.rank === 6 ? "🔻" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── MatchForm ────────────────────────────────────────────────────────────────
function MatchForm({ onAdd }) {
  const init = () => { const r = {}; PLAYERS.forEach((p) => (r[p] = "")); return r; };
  const [form, setForm] = useState({ matchNumber: "", date: new Date().toISOString().slice(0, 10), match: "", ranks: init() });
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    if (!form.matchNumber || !form.date || !form.match) return "Fill all match details.";
    const numbers = PLAYERS.filter((p) => form.ranks[p] !== "NA").map((p) => parseInt(form.ranks[p]));
    if (numbers.some((x) => isNaN(x) || x < 1 || x > 6)) return "Ranks must be between 1–6 or N/A.";
    if (new Set(numbers).size !== numbers.length) return "Duplicate ranks not allowed.";
    return "";
  };

  const submit = async () => {
    const e = validate();
    if (e) { setErr(e); return; }
    setErr("");
    setSubmitting(true);
    const ranks = {};
    PLAYERS.forEach((p) => { ranks[p] = form.ranks[p] === "NA" ? "NA" : parseInt(form.ranks[p]); });
    await onAdd({ ...form, matchNumber: parseInt(form.matchNumber), ranks });
    setForm({ matchNumber: "", date: new Date().toISOString().slice(0, 10), match: "", ranks: init() });
    setSubmitting(false);
  };

  const inp = { background: "#0a0f1a", border: "1px solid #ffffff22", borderRadius: 8, padding: "8px 11px", color: "#f1f5f9", fontSize: 13, width: "100%" };

  return (
    <div style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", border: "1px solid #ffffff11", borderRadius: 16, padding: 22, boxShadow: "0 4px 24px #00000066" }}>
      <div style={{ color: "#94a3b8", fontWeight: 700, letterSpacing: 2, fontSize: 11, marginBottom: 18 }}>⚡ ADD MATCH RESULT</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 18 }}>
        {[["Match #", "matchNumber", "number", "12"], ["Date", "date", "date", ""], ["Teams", "match", "text", "MI vs CSK"]].map(([label, key, type, ph]) => (
          <div key={key}>
            <label style={{ color: "#64748b", fontSize: 10, letterSpacing: 1, display: "block", marginBottom: 3 }}>{label}</label>
            <input type={type} placeholder={ph} value={form[key]} onChange={(ev) => setForm((f) => ({ ...f, [key]: ev.target.value }))} style={inp} />
          </div>
        ))}
      </div>
      <div style={{ color: "#64748b", fontSize: 10, letterSpacing: 1, marginBottom: 9 }}>ASSIGN RANKS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 9, marginBottom: 18 }}>
        {PLAYERS.map((p, i) => (
          <div key={p} style={{ display: "flex", alignItems: "center", gap: 7, background: "#ffffff05", borderRadius: 8, padding: "7px 10px" }}>
            <span style={{ fontSize: 16 }}>{EMOJIS[i]}</span>
            <span style={{ color: COLORS[i], fontSize: 11, fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
            <select value={form.ranks[p]} onChange={(ev) => setForm((f) => ({ ...f, ranks: { ...f.ranks, [p]: ev.target.value } }))} style={{ background: "#0a0f1a", border: "1px solid #ffffff22", borderRadius: 6, padding: "5px 7px", color: "#f1f5f9", fontSize: 12 }}>
              <option value="">–</option>
              <option value="NA">N/A</option>
              {[1, 2, 3, 4, 5, 6].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        ))}
      </div>
      {err && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 11, padding: "7px 11px", background: "#ef444411", borderRadius: 8 }}>⚠ {err}</div>}
      <button onClick={submit} disabled={submitting} style={{ background: submitting ? "#334155" : "linear-gradient(135deg,#f59e0b,#d97706)", border: "none", borderRadius: 10, padding: "11px 24px", color: submitting ? "#94a3b8" : "#000", fontWeight: 800, fontSize: 13, cursor: submitting ? "not-allowed" : "pointer", letterSpacing: 1, boxShadow: "0 4px 14px #f59e0b55" }}>
        {submitting ? "Saving to Firebase..." : "+ SUBMIT RESULT"}
      </button>
    </div>
  );
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function Charts({ matches, board }) {
  const barData  = board.map((p) => ({ name: p.name.split(" ")[0], Points: p.total, color: p.color }));
  const lineData = getLineData(matches);

  function CBar({ active, payload, label }) {
    if (!active || !payload || payload.length === 0) return null;
    const val = payload[0].value;
    return (
      <div style={{ background: "#1e293b", border: "1px solid #ffffff22", borderRadius: 8, padding: "9px 13px" }}>
        <div style={{ color: "#94a3b8", fontSize: 11 }}>{label}</div>
        <div style={{ color: val >= 0 ? "#10b981" : "#ef4444", fontWeight: 800, fontSize: 17, fontFamily: "'Bebas Neue',sans-serif" }}>{val > 0 ? "+" : ""}{val}</div>
      </div>
    );
  }

  function CLine({ active, payload, label }) {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div style={{ background: "#1e293b", border: "1px solid #ffffff22", borderRadius: 8, padding: "9px 13px" }}>
        <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 5 }}>{label}</div>
        {payload.map((e) => (
          <div key={e.name} style={{ color: e.color, fontSize: 12, fontWeight: 600 }}>
            {e.name.split(" ")[0]}: {e.value > 0 ? "+" : ""}{e.value}
          </div>
        ))}
      </div>
    );
  }

  const wrap = (title, child) => (
    <div style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", border: "1px solid #ffffff11", borderRadius: 16, padding: 22, boxShadow: "0 4px 24px #00000066" }}>
      <div style={{ color: "#94a3b8", fontWeight: 700, letterSpacing: 2, fontSize: 11, marginBottom: 18 }}>{title}</div>
      {child}
    </div>
  );

  if (!matches.length) return wrap("📊 CHARTS", <div style={{ textAlign: "center", color: "#334155", padding: "40px 0" }}>Add matches to see charts 📊</div>);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      {wrap("📊 TOTAL POINTS",
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ top: 0, right: 0, bottom: 0, left: -14 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
            <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 10 }} />
            <YAxis tick={{ fill: "#64748b", fontSize: 10 }} />
            <Tooltip content={<CBar />} cursor={{ fill: "#ffffff08" }} />
            <Bar dataKey="Points" radius={[6, 6, 0, 0]}>
              {barData.map((e, i) => <Cell key={i} fill={e.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {wrap("📈 PERFORMANCE OVER TIME",
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={lineData} margin={{ top: 0, right: 0, bottom: 0, left: -14 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
            <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} />
            <YAxis tick={{ fill: "#64748b", fontSize: 10 }} />
            <Tooltip content={<CLine />} />
            <Legend wrapperStyle={{ color: "#64748b", fontSize: 10 }} formatter={(v) => v.split(" ")[0]} />
            {PLAYERS.map((p, i) => (
              <Line key={p} type="monotone" dataKey={p} stroke={COLORS[i]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ─── Match History ────────────────────────────────────────────────────────────
function History({ matches, onDelete }) {
  if (!matches.length) return (
    <div style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", border: "1px solid #ffffff11", borderRadius: 16, padding: 36, textAlign: "center", color: "#334155", boxShadow: "0 4px 24px #00000066" }}>
      No matches yet — add your first! 🏏
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {[...matches].reverse().map((m) => (
        <div key={m.id} style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", border: "1px solid #ffffff11", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 24px #00000066" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #ffffff11", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ color: "#f59e0b", fontWeight: 700, fontSize: 13, marginRight: 10 }}>M{m.matchNumber}</span>
              <span style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600 }}>{m.match}</span>
              <span style={{ color: "#475569", fontSize: 11, marginLeft: 10 }}>{m.date}</span>
            </div>
            <button onClick={() => onDelete(m.id)} style={{ background: "#ef444411", border: "1px solid #ef444433", borderRadius: 7, padding: "4px 10px", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>🗑 Delete</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)" }}>
            {PLAYERS.map((p, i) => {
              const pts = getPts(m.ranks[p]);
              const isNA = m.ranks[p] === "NA";
              return (
                <div key={p} style={{ padding: "10px 14px", borderRight: i % 3 !== 2 ? "1px solid #ffffff06" : "none", borderBottom: "1px solid #ffffff06" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 14 }}>{EMOJIS[i]}</span>
                    <span style={{ color: COLORS[i], fontSize: 11, fontWeight: 700 }}>{p.split(" ")[0]}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#64748b", fontSize: 11 }}>{isNA ? "N/A" : RANK_LABELS[m.ranks[p]]}</span>
                    <span style={{ color: isNA ? "#64748b" : pts > 0 ? "#10b981" : "#ef4444", fontWeight: 800, fontSize: 14, fontFamily: "'Bebas Neue',sans-serif" }}>
                      {isNA ? "–" : (pts > 0 ? "+" : "") + pts}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function Banner({ matches }) {
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  const activePlayers = PLAYERS.filter((p) => last.ranks[p] !== "NA" && last.ranks[p] !== "");
  if (!activePlayers.length) return null;
  const winner = activePlayers.reduce((b, p) => Number(last.ranks[p]) < Number(last.ranks[b]) ? p : b, activePlayers[0]);
  const idx = PLAYERS.indexOf(winner);
  return (
    <div style={{ background: "linear-gradient(135deg,#1a1200,#2a1f00)", border: "1px solid #f59e0b44", borderRadius: 16, padding: "14px 22px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 4px 22px #f59e0b22" }}>
      <div style={{ fontSize: 30 }}>🏆</div>
      <div>
        <div style={{ color: "#f59e0b", fontWeight: 700, letterSpacing: 2, fontSize: 10 }}>TOP PERFORMER — MATCH {last.matchNumber}</div>
        <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 17, marginTop: 2 }}>
          {EMOJIS[idx]} {winner}
          <span style={{ color: "#64748b", fontWeight: 400, fontSize: 12, marginLeft: 8 }}>{last.match}</span>
        </div>
      </div>
      <div style={{ marginLeft: "auto" }}>
        <div style={{ color: "#10b981", fontSize: 11, fontWeight: 700 }}>🔴 LIVE</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEAMS FEATURE
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Single player team uploader ──────────────────────────────────────────────
function TeamUploader({ friendName, friendIdx, matchId, existingTeam, onSaved }) {
  const [phase, setPhase]       = useState("idle"); // idle|preview|ocr|parsing|editing|saved
  const [preview, setPreview]   = useState(existingTeam?.screenshotUrl || null);
  const [file, setFile]         = useState(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [players, setPlayers]   = useState(existingTeam?.players || []);
  const [captain, setCaptain]   = useState(existingTeam?.captain || "");
  const [vc, setVc]             = useState(existingTeam?.viceCaptain || "");
  const [confidence, setConf]   = useState("");
  const [detected, setDetected] = useState(0);
  const [error, setError]       = useState("");
  const [saving, setSaving]     = useState(false);
  const inputRef = useRef();

  const color = COLORS[friendIdx];
  const emoji = EMOJIS[friendIdx];

  // If team already saved, start in editing mode
  useEffect(() => {
    if (existingTeam && existingTeam.players && existingTeam.players.length > 0) {
      setPhase("editing");
    }
  }, [existingTeam]);

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setPhase("preview");
    setError("");
  };

  const handleScan = async () => {
    if (!file) return;
    try {
      // Step 1: OCR
      setPhase("ocr");
      setOcrProgress(0);
      const rawText = await runOCR(file, setOcrProgress);

      // Step 2: Parse
      setPhase("parsing");
      const parsed = parseOCRText(rawText);
      setPlayers(parsed.players.length > 0 ? parsed.players : []);
      setCaptain(parsed.captain || "");
      setVc(parsed.viceCaptain || "");
      setConf(parsed.confidence);
      setDetected(parsed.detectedCount);
      setPhase("editing");
    } catch (err) {
      setError("OCR failed: " + err.message);
      setPhase("preview");
    }
  };

  const updatePlayerName = (idx, val) => {
    setPlayers(prev => prev.map((p, i) => i === idx ? { ...p, name: val } : p));
  };

  const removePlayer = (idx) => {
    setPlayers(prev => prev.filter((_, i) => i !== idx));
  };

  const addPlayer = () => {
    if (players.length >= 11) return;
    setPlayers(prev => [...prev, { name: "", rawName: "", isCaptain: false, isViceCaptain: false }]);
  };

  const handleSave = async () => {
    if (players.length !== 11) { setError("Need exactly 11 players"); return; }
    if (!captain)               { setError("Select captain"); return; }
    if (!vc)                    { setError("Select vice-captain"); return; }
    if (captain === vc)         { setError("C and VC can't be the same"); return; }

    setSaving(true);
    setError("");
    try {
      // Upload image to Cloudinary if new file selected
      let screenshotUrl = existingTeam?.screenshotUrl || "";
      if (file) {
        screenshotUrl = await uploadToCloudinary(file);
      }

      const finalPlayers = players.map(p => ({
        ...p,
        isCaptain:     p.name === captain,
        isViceCaptain: p.name === vc,
      }));

      // Save to Firestore: teams/{matchId}_{friendName}
      const docId = `${matchId}_${friendName.replace(/\s/g, "_")}`;
      await setDoc(doc(db, "teams", docId), {
        matchId,
        friendName,
        players: finalPlayers,
        captain,
        viceCaptain: vc,
        screenshotUrl,
        savedAt: new Date().toISOString(),
      });

      setPhase("saved");
      onSaved();
    } catch (err) {
      setError("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const confColor = { high: "#10b981", medium: "#f59e0b", low: "#ef4444" }[confidence] || "#64748b";

  return (
    <div style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", border: `1px solid ${color}33`, borderRadius: 16, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Friend header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 24 }}>{emoji}</span>
        <span style={{ color, fontWeight: 800, fontSize: 15 }}>{friendName}</span>
        {phase === "saved" && <span style={{ marginLeft: "auto", color: "#10b981", fontSize: 12, fontWeight: 700 }}>✅ Saved</span>}
        {existingTeam && phase !== "saved" && <span style={{ marginLeft: "auto", color: "#f59e0b", fontSize: 11 }}>📝 Edit team</span>}
      </div>

      {/* PHASE: idle — show upload button */}
      {phase === "idle" && (
        <>
          <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
          <button onClick={() => inputRef.current.click()} style={{ background: `linear-gradient(135deg,${color},${color}bb)`, border: "none", borderRadius: 10, padding: "10px", color: "#000", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            📸 Upload My11Circle Screenshot
          </button>
        </>
      )}

      {/* PHASE: preview — show image + scan button */}
      {phase === "preview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <img src={preview} alt="preview" style={{ width: "100%", maxHeight: 300, objectFit: "contain", borderRadius: 10, border: "1px solid #ffffff11" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleScan} style={{ flex: 1, background: "linear-gradient(135deg,#f59e0b,#d97706)", border: "none", borderRadius: 8, padding: "10px", color: "#000", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
              🔍 Scan & Extract Players
            </button>
            <button onClick={() => { setPhase("idle"); setPreview(null); setFile(null); }} style={{ background: "#ef444422", border: "1px solid #ef444444", borderRadius: 8, padding: "10px 14px", color: "#ef4444", cursor: "pointer", fontWeight: 700 }}>✕</button>
          </div>
        </div>
      )}

      {/* PHASE: OCR scanning */}
      {phase === "ocr" && (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ color: "#f59e0b", fontWeight: 700, fontSize: 14, marginBottom: 12 }}>🔍 Reading screenshot... {ocrProgress}%</div>
          <div style={{ height: 8, background: "#ffffff11", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${ocrProgress}%`, background: "linear-gradient(90deg,#f59e0b,#f97316)", borderRadius: 4, transition: "width 0.3s" }} />
          </div>
          <div style={{ color: "#475569", fontSize: 11, marginTop: 8 }}>This may take 15–30 seconds on first run</div>
        </div>
      )}

      {/* PHASE: parsing */}
      {phase === "parsing" && (
        <div style={{ textAlign: "center", padding: "20px 0", color: "#94a3b8" }}>
          ⚙️ Matching player names...
        </div>
      )}

      {/* PHASE: editing — show detected players for correction */}
      {phase === "editing" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Screenshot thumbnail if available */}
          {preview && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <img src={preview} alt="thumb" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid #ffffff11", cursor: "pointer" }} onClick={() => window.open(preview, "_blank")} />
              <div style={{ flex: 1 }}>
                {confidence && (
                  <div style={{ background: confColor + "22", border: `1px solid ${confColor}44`, borderRadius: 6, padding: "4px 10px", fontSize: 11, color: confColor, fontWeight: 700, display: "inline-block", marginBottom: 6 }}>
                    OCR {confidence.toUpperCase()} · {detected} players detected
                  </div>
                )}
                <div style={{ color: "#64748b", fontSize: 11 }}>
                  Click image to view full screenshot. Fix any wrong names below.
                </div>
              </div>
            </div>
          )}

          {/* Change screenshot */}
          <div>
            <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
            <button onClick={() => inputRef.current.click()} style={{ background: "#ffffff08", border: "1px solid #ffffff11", borderRadius: 8, padding: "6px 12px", color: "#64748b", fontSize: 11, cursor: "pointer" }}>
              🔄 Change screenshot
            </button>
          </div>

          {/* C / VC selectors */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[["👑 Captain (2x)", captain, setCaptain], ["⭐ Vice Captain (1.5x)", vc, setVc]].map(([label, val, setter]) => (
              <div key={label}>
                <label style={{ color: "#64748b", fontSize: 10, letterSpacing: 1, display: "block", marginBottom: 3 }}>{label}</label>
                <select value={val} onChange={e => setter(e.target.value)} style={{ width: "100%", background: "#0a0f1a", border: "1px solid #ffffff22", borderRadius: 8, padding: "7px 10px", color: "#f1f5f9", fontSize: 12 }}>
                  <option value="">— Select —</option>
                  {players.map((p, i) => p.name && <option key={i} value={p.name}>{p.name}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Player list */}
          <div>
            <div style={{ color: "#64748b", fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>
              PLAYERS ({players.length}/11) — Edit names if OCR made mistakes
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {players.map((p, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: p.name === captain ? "#f59e0b11" : p.name === vc ? "#8b5cf611" : "#ffffff06",
                  border: p.name === captain ? "1px solid #f59e0b33" : p.name === vc ? "1px solid #8b5cf633" : "1px solid transparent",
                  borderRadius: 8, padding: "7px 10px",
                }}>
                  <span style={{ color: "#475569", fontSize: 10, width: 16, flexShrink: 0 }}>{i + 1}</span>
                  <input
                    list="ipl-names"
                    value={p.name}
                    onChange={e => updatePlayerName(i, e.target.value)}
                    placeholder="Player name..."
                    style={{ flex: 1, background: "transparent", border: "none", color: "#f1f5f9", fontSize: 12, fontWeight: 600, outline: "none", minWidth: 0 }}
                  />
                  <datalist id="ipl-names">
                    {IPL_PLAYERS.map(n => <option key={n} value={n} />)}
                  </datalist>
                  {p.rawName && p.rawName !== p.name && (
                    <span style={{ color: "#334155", fontSize: 9, fontStyle: "italic", whiteSpace: "nowrap", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis" }} title={`OCR: ${p.rawName}`}>
                      ← {p.rawName}
                    </span>
                  )}
                  {p.name === captain && <span title="Captain">👑</span>}
                  {p.name === vc      && <span title="VC">⭐</span>}
                  <button onClick={() => removePlayer(i)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 13, padding: 0, flexShrink: 0 }}>✕</button>
                </div>
              ))}
              {players.length < 11 && (
                <button onClick={addPlayer} style={{ background: "#ffffff08", border: "1px dashed #ffffff22", borderRadius: 8, padding: "8px", color: "#64748b", fontSize: 12, cursor: "pointer" }}>
                  + Add missing player ({11 - players.length} remaining)
                </button>
              )}
            </div>
          </div>

          {error && <div style={{ color: "#ef4444", fontSize: 12, padding: "7px 11px", background: "#ef444411", borderRadius: 8 }}>⚠ {error}</div>}

          <button onClick={handleSave} disabled={saving} style={{ background: saving ? "#334155" : "linear-gradient(135deg,#10b981,#059669)", border: "none", borderRadius: 10, padding: "11px", color: "#fff", fontWeight: 800, fontSize: 13, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Uploading & Saving..." : "✅ Save Team"}
          </button>
        </div>
      )}

      {/* PHASE: saved */}
      {phase === "saved" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {players.map((p, i) => (
              <span key={i} style={{
                background: p.isCaptain ? "#f59e0b22" : p.isViceCaptain ? "#8b5cf622" : "#ffffff08",
                border: p.isCaptain ? "1px solid #f59e0b55" : p.isViceCaptain ? "1px solid #8b5cf655" : "1px solid #ffffff11",
                borderRadius: 6, padding: "3px 9px", fontSize: 11, color: p.isCaptain ? "#f59e0b" : p.isViceCaptain ? "#8b5cf6" : "#94a3b8", fontWeight: p.isCaptain || p.isViceCaptain ? 700 : 400,
              }}>
                {p.isCaptain ? "👑 " : p.isViceCaptain ? "⭐ " : ""}{p.name}
              </span>
            ))}
          </div>
          <button onClick={() => setPhase("editing")} style={{ background: "#ffffff08", border: "1px solid #ffffff11", borderRadius: 8, padding: "7px", color: "#64748b", fontSize: 11, cursor: "pointer" }}>
            ✏️ Edit team
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Teams Tab (all 6 friends for a match) ────────────────────────────────────
function TeamsTab({ matches }) {
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [teams, setTeams]                     = useState({});
  const [loadingTeams, setLoadingTeams]        = useState(false);
  const [view, setView]                        = useState("upload"); // upload | analysis

  const selectedMatch = matches.find(m => m.id === selectedMatchId);

  // Load existing teams whenever match changes
  useEffect(() => {
    if (!selectedMatchId) return;
    setLoadingTeams(true);
    const fetchTeams = async () => {
      const snap = await getDocs(query(collection(db, "teams")));
      const all  = {};
      snap.forEach(d => {
        const data = d.data();
        if (data.matchId === selectedMatchId) {
          all[data.friendName] = { id: d.id, ...data };
        }
      });
      setTeams(all);
      setLoadingTeams(false);
    };
    fetchTeams();
  }, [selectedMatchId]);

  const refreshTeams = async () => {
    if (!selectedMatchId) return;
    const snap = await getDocs(query(collection(db, "teams")));
    const all  = {};
    snap.forEach(d => {
      const data = d.data();
      if (data.matchId === selectedMatchId) all[data.friendName] = { id: d.id, ...data };
    });
    setTeams(all);
  };

  // Analysis computation
  const savedTeams   = Object.values(teams).filter(t => t.players && t.players.length === 11);
  const playerCount  = {};
  const captainCount = {};
  const vcCount      = {};
  savedTeams.forEach(t => {
    t.players.forEach(p => { playerCount[p.name] = (playerCount[p.name] || 0) + 1; });
    if (t.captain)     captainCount[t.captain]     = (captainCount[t.captain]     || 0) + 1;
    if (t.viceCaptain) vcCount[t.viceCaptain]       = (vcCount[t.viceCaptain]      || 0) + 1;
  });
  const total        = savedTeams.length;
  const commonPlayers = Object.entries(playerCount).filter(([, c]) => c === total).map(([n]) => n);
  const uniquePlayers  = Object.entries(playerCount).filter(([, c]) => c === 1).map(([n]) => n);
  const popularity   = Object.entries(playerCount).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count, pct: Math.round(count / total * 100) }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Match selector */}
      <div style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", border: "1px solid #ffffff11", borderRadius: 16, padding: 20 }}>
        <label style={{ color: "#64748b", fontSize: 10, letterSpacing: 1, display: "block", marginBottom: 6 }}>SELECT MATCH TO UPLOAD TEAMS FOR</label>
        <select
          value={selectedMatchId}
          onChange={e => { setSelectedMatchId(e.target.value); setView("upload"); }}
          style={{ width: "100%", background: "#0a0f1a", border: "1px solid #ffffff22", borderRadius: 10, padding: "10px 14px", color: "#f1f5f9", fontSize: 14, fontWeight: 600 }}
        >
          <option value="">— Choose a match —</option>
          {[...matches].sort((a, b) => b.matchNumber - a.matchNumber).map(m => (
            <option key={m.id} value={m.id}>
              Match {m.matchNumber} · {m.match} · {m.date} ({Object.keys(teams).length}/6 uploaded)
            </option>
          ))}
        </select>
      </div>

      {selectedMatch && (
        <>
          {/* View toggle */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setView("upload")} style={{ background: view === "upload" ? "linear-gradient(135deg,#f59e0b,#d97706)" : "#ffffff08", border: "none", borderRadius: 9, padding: "8px 18px", color: view === "upload" ? "#000" : "#94a3b8", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              📸 Upload Teams ({savedTeams.length}/6)
            </button>
            <button onClick={() => setView("analysis")} disabled={savedTeams.length < 2} style={{ background: view === "analysis" ? "linear-gradient(135deg,#3b82f6,#2563eb)" : "#ffffff08", border: "none", borderRadius: 9, padding: "8px 18px", color: view === "analysis" ? "#fff" : savedTeams.length < 2 ? "#334155" : "#94a3b8", fontWeight: 700, fontSize: 12, cursor: savedTeams.length < 2 ? "not-allowed" : "pointer" }}>
              📊 Analysis {savedTeams.length < 2 ? "(need 2+ teams)" : ""}
            </button>
            <button onClick={() => setView("compare")} disabled={savedTeams.length < 2} style={{ background: view === "compare" ? "linear-gradient(135deg,#10b981,#059669)" : "#ffffff08", border: "none", borderRadius: 9, padding: "8px 18px", color: view === "compare" ? "#fff" : savedTeams.length < 2 ? "#334155" : "#94a3b8", fontWeight: 700, fontSize: 12, cursor: savedTeams.length < 2 ? "not-allowed" : "pointer" }}>
              👥 Compare Teams
            </button>
          </div>

          {loadingTeams && (
            <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>Loading saved teams...</div>
          )}

          {/* UPLOAD VIEW — 6 friend uploaders */}
          {!loadingTeams && view === "upload" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
              {PLAYERS.map((name, i) => (
                <TeamUploader
                  key={name}
                  friendName={name}
                  friendIdx={i}
                  matchId={selectedMatchId}
                  existingTeam={teams[name] || null}
                  onSaved={refreshTeams}
                />
              ))}
            </div>
          )}

          {/* ANALYSIS VIEW */}
          {!loadingTeams && view === "analysis" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Common players */}
              <AnalysisSection title="🤝 In ALL teams" color="#10b981">
                {commonPlayers.length === 0
                  ? <span style={{ color: "#475569", fontSize: 13 }}>No player is in all {total} teams</span>
                  : commonPlayers.map(n => <Tag key={n} label={n} color="#10b981" />)
                }
              </AnalysisSection>

              {/* Popularity bar chart */}
              <AnalysisSection title="📊 Player Popularity" color="#3b82f6">
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                  {popularity.map(p => (
                    <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ color: "#f1f5f9", fontSize: 12, width: 180, flexShrink: 0 }}>{p.name}</span>
                      <div style={{ flex: 1, background: "#ffffff11", borderRadius: 4, height: 8 }}>
                        <div style={{ width: `${p.pct}%`, height: "100%", background: "#3b82f6", borderRadius: 4 }} />
                      </div>
                      <span style={{ color: "#64748b", fontSize: 11, width: 70, textAlign: "right" }}>{p.count}/{total} ({p.pct}%)</span>
                    </div>
                  ))}
                </div>
              </AnalysisSection>

              {/* Captain choices */}
              <AnalysisSection title="👑 Captain Choices" color="#f59e0b">
                {Object.entries(captainCount).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                  <Tag key={name} label={`${name} · ${count} team${count > 1 ? "s" : ""}`} color="#f59e0b" />
                ))}
              </AnalysisSection>

              {/* VC choices */}
              <AnalysisSection title="⭐ Vice-Captain Choices" color="#8b5cf6">
                {Object.entries(vcCount).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                  <Tag key={name} label={`${name} · ${count} team${count > 1 ? "s" : ""}`} color="#8b5cf6" />
                ))}
              </AnalysisSection>

              {/* Unique picks */}
              <AnalysisSection title="🎯 Unique Picks (only 1 team)" color="#ec4899">
                {uniquePlayers.length === 0
                  ? <span style={{ color: "#475569", fontSize: 13 }}>No unique picks</span>
                  : uniquePlayers.map(n => <Tag key={n} label={n} color="#ec4899" />)
                }
              </AnalysisSection>
            </div>
          )}

          {/* COMPARE VIEW — side by side teams */}
          {!loadingTeams && view === "compare" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
              {savedTeams.map((team, ti) => {
                const idx = PLAYERS.indexOf(team.friendName);
                const col = COLORS[idx] || "#94a3b8";
                const emo = EMOJIS[idx] || "🏏";
                return (
                  <div key={ti} style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", border: `1px solid ${col}33`, borderRadius: 14, overflow: "hidden" }}>
                    {/* Header */}
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid #ffffff11", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 20 }}>{emo}</span>
                      <span style={{ color: col, fontWeight: 700, fontSize: 13 }}>{team.friendName}</span>
                      {team.screenshotUrl && (
                        <img src={team.screenshotUrl} alt="" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 6, marginLeft: "auto", cursor: "pointer" }} onClick={() => window.open(team.screenshotUrl, "_blank")} />
                      )}
                    </div>
                    {/* Players */}
                    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                      {team.players.map((p, pi) => (
                        <div key={pi} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", background: p.isCaptain ? "#f59e0b11" : p.isViceCaptain ? "#8b5cf611" : "transparent", borderRadius: 6 }}>
                          <span style={{ color: "#475569", fontSize: 10, width: 14 }}>{pi + 1}</span>
                          <span style={{ flex: 1, color: p.isCaptain ? "#f59e0b" : p.isViceCaptain ? "#8b5cf6" : "#e2e8f0", fontSize: 12, fontWeight: p.isCaptain || p.isViceCaptain ? 700 : 400 }}>
                            {p.name}
                          </span>
                          {p.isCaptain     && <span style={{ fontSize: 12 }}>👑</span>}
                          {p.isViceCaptain && <span style={{ fontSize: 12 }}>⭐</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {!selectedMatchId && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#334155" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏏</div>
          <div style={{ fontSize: 14 }}>Select a match above to upload & view teams</div>
        </div>
      )}
    </div>
  );
}

function AnalysisSection({ title, color, children }) {
  return (
    <div style={{ background: "linear-gradient(135deg,#0f172a,#1e293b)", border: `1px solid ${color}22`, borderRadius: 14, padding: 18 }}>
      <div style={{ color, fontWeight: 700, letterSpacing: 1, fontSize: 12, marginBottom: 12 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{children}</div>
    </div>
  );
}

function Tag({ label, color }) {
  return (
    <span style={{ background: color + "22", color, border: `1px solid ${color}44`, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>
      {label}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState("dashboard");

  useEffect(() => {
    const q = query(collection(db, "matches"), orderBy("matchNumber", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setMatches(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleAdd = useCallback(async (match) => {
    await addDoc(collection(db, "matches"), match);
  }, []);

  const handleDelete = useCallback(async (id) => {
    await deleteDoc(doc(db, "matches", id));
  }, []);

  const board = getBoard(matches);

  const tabs = [
    ["dashboard", "🏏 Dashboard"],
    ["add",       "⚡ Add Match"],
    ["teams",     "📸 Teams"],
    ["charts",    "📊 Charts"],
    ["history",   "📋 History"],
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;600;700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background:#060b14;font-family:'DM Sans',sans-serif;color:#f1f5f9;min-height:100vh}
        input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(1)}
        select option{background:#1e293b}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#0f172a}
        ::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}
        @keyframes spin{to{transform:rotate(360deg)}}
        input::placeholder{color:#334155}
      `}</style>

      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "radial-gradient(ellipse at 20% 10%,#f59e0b08 0%,transparent 50%),radial-gradient(ellipse at 80% 80%,#3b82f608 0%,transparent 50%)" }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", padding: "0 14px 60px" }}>

        {/* Header */}
        <div style={{ paddingTop: 28, paddingBottom: 20, textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 28 }}>🏏</span>
            <h1 style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: "clamp(28px,5vw,46px)", letterSpacing: 4, background: "linear-gradient(135deg,#f59e0b,#fbbf24,#f97316)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              IPL FRIENDS LEAGUE
            </h1>
          </div>
          <div style={{ color: "#475569", fontSize: 11, letterSpacing: 3 }}>
            PRIVATE FANTASY TRACKER • {loading ? "Connecting..." : `${matches.length} MATCHES`}
            {!loading && <span style={{ marginLeft: 10, color: "#10b981" }}>🔴 LIVE</span>}
          </div>
        </div>

        {/* Nav */}
        <div style={{ display: "flex", gap: 7, marginBottom: 24, flexWrap: "wrap" }}>
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ background: tab === id ? "linear-gradient(135deg,#f59e0b,#d97706)" : "#ffffff08", border: tab === id ? "none" : "1px solid #ffffff11", borderRadius: 9, padding: "8px 16px", color: tab === id ? "#000" : "#94a3b8", fontWeight: 700, fontSize: 12, cursor: "pointer", letterSpacing: 0.5, transition: "all .15s", boxShadow: tab === id ? "0 4px 14px #f59e0b44" : "none" }}>
              {label}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ width: 40, height: 40, border: "3px solid #ffffff11", borderTop: "3px solid #f59e0b", borderRadius: "50%", margin: "0 auto 16px", animation: "spin 0.8s linear infinite" }} />
            <div style={{ color: "#475569", fontSize: 13 }}>Connecting to Firebase...</div>
          </div>
        ) : (
          <>
            {tab === "dashboard" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <Banner matches={matches} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12 }}>
                  {board.map((p) => <PlayerCard key={p.name} player={p} rank={p.rank} />)}
                </div>
                <Leaderboard board={board} />
              </div>
            )}
            {tab === "add" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <MatchForm onAdd={handleAdd} />
                <div style={{ color: "#475569", fontSize: 11, letterSpacing: 1, padding: "10px 14px", background: "#ffffff05", borderRadius: 10, border: "1px solid #ffffff08" }}>
                  POINTS GUIDE: 1st = +100 · 2nd = +75 · 3rd = +50 · 4th = −50 · 5th = −75 · 6th = −100 · N/A = 0
                </div>
              </div>
            )}
            {tab === "teams" && <TeamsTab matches={matches} />}
            {tab === "charts" && <Charts matches={matches} board={board} />}
            {tab === "history" && <History matches={matches} onDelete={handleDelete} />}
          </>
        )}
      </div>
    </>
  );
}
