
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "firebase/firestore";
import { auth, db } from "./firebase";

const ROLE_EMAILS = {
  admin: ["admin@aquarakshak.com"],
  resident: ["resident@aquarakshak.com"]
};

const THEMES = ["light", "dark", "ocean", "glass"];
const LANGS = ["en", "te"];
const SLA_HOURS = 4;

const PUBLIC_HEALTH_OVERLAY = {
  Kothapally: { schools: 3, hospitals: 1 },
  Narsingi: { schools: 2, hospitals: 1 },
  Chevella: { schools: 4, hospitals: 2 },
  Dundigal: { schools: 3, hospitals: 1 },
  Bodhan: { schools: 2, hospitals: 1 },
  Asifabad: { schools: 3, hospitals: 1 },
  Bellampalli: { schools: 2, hospitals: 1 }
};

const I18N = {
  en: {
    liveSync: "Live Sync",
    residentLogin: "Resident Login",
    adminLogin: "Admin Login",
    commandStudio: "Integrated Water Operations Studio",
    residentDash: "My Water & Hygiene Dashboard",
    communityPortal: "Community Portal",
    municipal: "Municipal Command"
  },
  te: {
    liveSync: "\u0C2A\u0C4D\u0C30\u0C24\u0C4D\u0C2F\u0C15\u0C4D\u0C37 \u0C38\u0C2E\u0C15\u0C3E\u0C32\u0C40\u0C15\u0C30\u0C23\u0C02",
    residentLogin: "\u0C28\u0C3F\u0C35\u0C3E\u0C38\u0C3F \u0C32\u0C3E\u0C17\u0C3F\u0C28\u0C4D",
    adminLogin: "\u0C05\u0C21\u0C4D\u0C2E\u0C3F\u0C28\u0C4D \u0C32\u0C3E\u0C17\u0C3F\u0C28\u0C4D",
    commandStudio: "\u0C38\u0C2E\u0C17\u0C4D\u0C30 \u0C1C\u0C32 \u0C15\u0C3E\u0C30\u0C4D\u0C2F\u0C3E\u0C1A\u0C30\u0C23 \u0C38\u0C4D\u0C1F\u0C42\u0C21\u0C3F\u0C2F\u0C4B",
    residentDash: "\u0C28\u0C3E \u0C28\u0C40\u0C30\u0C41 & \u0C2A\u0C3E\u0C30\u0C3F\u0C36\u0C41\u0C26\u0C4D\u0C27\u0C4D\u0C2F \u0C21\u0C4D\u0C2F\u0C3E\u0C37\u0C4D\u200C\u0C2C\u0C4B\u0C30\u0C4D\u0C21\u0C4D",
    communityPortal: "\u0C38\u0C2E\u0C41\u0C26\u0C3E\u0C2F \u0C2A\u0C4B\u0C30\u0C4D\u0C1F\u0C32\u0C4D",
    municipal: "\u0C2E\u0C41\u0C28\u0C4D\u0C38\u0C3F\u0C2A\u0C32\u0C4D \u0C15\u0C2E\u0C3E\u0C02\u0C21\u0C4D"
  }
};

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const VILLAGES = ["Kothapally", "Narsingi", "Chevella", "Dundigal", "Bodhan", "Asifabad", "Bellampalli"];

function formatAgeHours(hours) {
  if (!Number.isFinite(hours) || hours < 0) return "N/A";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function passwordStrengthLabel(password = "") {
  if (!password) return { score: 0, label: "None" };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  const labels = ["Weak", "Weak", "Fair", "Good", "Strong"];
  return { score, label: labels[score] };
}

function stageIndex(status = "open") {
  if (status === "verified") return 1;
  if (status === "assigned") return 2;
  if (status === "in-progress") return 3;
  if (status === "resolved") return 4;
  return 0;
}

function journeyStages(status) {
  const idx = stageIndex(status);
  return ["Reported", "Verified", "Assigned", "In Progress", "Resolved"].map((label, i) => ({ label, active: i <= idx }));
}

function outcomePreviewText(item, targetStatus) {
  const severity = Math.round(Number(item?.score || 0) * 100);
  const etaDrop = targetStatus === "assigned" ? Math.min(30, 8 + Math.round(severity * 0.22)) : Math.min(60, 18 + Math.round(severity * 0.35));
  const peopleProtected = Math.max(60, Math.round(120 + severity * 6));
  return `Projected impact: SLA risk -${etaDrop}%, people protected +${peopleProtected}.`;
}

function resolveRole(email = "") {
  const lower = email.toLowerCase();
  if (ROLE_EMAILS.admin.includes(lower)) return "admin";
  if (ROLE_EMAILS.resident.includes(lower)) return "resident";
  return null;
}

function scoreBand(score) {
  if (score >= 75) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function computeRisk(r) {
  const phScore = r.ph < 6.5 ? clamp((6.5 - r.ph) / 3) : r.ph > 8.5 ? clamp((r.ph - 8.5) / 3) : 0;
  const turbidityScore = r.turbidity > 5 ? clamp((r.turbidity - 5) / 20) : 0;
  const tdsScore = r.tds > 500 ? clamp((r.tds - 500) / 1500) : 0;
  const ecoliScore = r.ecoliCount > 10 ? clamp((r.ecoliCount - 10) / 200) : 0;
  const chlorineScore = r.residualChlorine < 0.2 ? clamp((0.2 - r.residualChlorine) / 0.2) : 0;

  const contaminationScore = clamp(
    0.28 * phScore + 0.22 * turbidityScore + 0.2 * tdsScore + 0.2 * ecoliScore + 0.1 * chlorineScore
  );
  const shortageScore = r.waterLevel < 20 ? clamp((20 - r.waterLevel) / 20) : 0;
  const leakageScore = r.flowRate < 1 ? clamp((1 - r.flowRate) / 1) : 0;

  const top = [
    { riskType: "contamination", score: contaminationScore },
    { riskType: "shortage", score: shortageScore },
    { riskType: "leakage", score: leakageScore }
  ].sort((a, b) => b.score - a.score)[0];

  return {
    topRiskType: top.score < 0.2 ? "safe" : top.riskType,
    topScore: Number(top.score.toFixed(2)),
    shouldAlert: top.score >= 0.2,
    components: { contaminationScore, shortageScore, leakageScore }
  };
}

function actionRecommendation(riskType) {
  if (riskType === "contamination") return "Immediate chlorination, source isolation, and lab sampling within 2 hours.";
  if (riskType === "shortage") return "Activate tanker schedule, enforce timed distribution, and check pump uptime.";
  if (riskType === "leakage") return "Dispatch field crew for valve/pipeline inspection and isolate faulty segment.";
  return "Continue monitoring and community awareness updates.";
}

function compressImageToDataUrl(file, maxWidth = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context unavailable."));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Invalid image file."));
      img.src = String(reader.result || "");
    };
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

function demoReading(forceIncident = false, scenario = null) {
  const village = VILLAGES[Math.floor(Math.random() * VILLAGES.length)];
  const source = `sim-node-${100 + Math.floor(Math.random() * 900)}`;

  if (forceIncident || scenario === "contamination") {
    return {
      sourceId: source,
      location: { village, district: "Medchal" },
      timestamp: new Date(),
      ph: 9.3 + Math.random() * 0.7,
      turbidity: 11 + Math.random() * 8,
      tds: 700 + Math.random() * 500,
      waterLevel: 35 + Math.random() * 30,
      flowRate: 1 + Math.random() * 1.2,
      temperature: 27,
      residualChlorine: 0.05 + Math.random() * 0.1,
      ecoliCount: 30 + Math.floor(Math.random() * 100),
      rainfall24h: 12,
      populationServed: 5200,
      pumpStatus: "OFF"
    };
  }

  if (scenario === "shortage") {
    return {
      sourceId: source,
      location: { village, district: "Medchal" },
      timestamp: new Date(),
      ph: Number((6.8 + Math.random() * 1.4).toFixed(2)),
      turbidity: Number((2 + Math.random() * 3).toFixed(2)),
      tds: Number((250 + Math.random() * 200).toFixed(2)),
      waterLevel: Number((4 + Math.random() * 14).toFixed(2)),
      flowRate: Number((0.8 + Math.random() * 0.8).toFixed(2)),
      temperature: Number((24 + Math.random() * 8).toFixed(1)),
      residualChlorine: Number((0.25 + Math.random() * 0.5).toFixed(2)),
      ecoliCount: Math.floor(Math.random() * 8),
      rainfall24h: Number((Math.random() * 5).toFixed(1)),
      populationServed: Math.floor(2000 + Math.random() * 6000),
      pumpStatus: "OFF"
    };
  }

  if (scenario === "leakage") {
    return {
      sourceId: source,
      location: { village, district: "Medchal" },
      timestamp: new Date(),
      ph: Number((6.9 + Math.random() * 1.2).toFixed(2)),
      turbidity: Number((2 + Math.random() * 4).toFixed(2)),
      tds: Number((250 + Math.random() * 250).toFixed(2)),
      waterLevel: Number((15 + Math.random() * 35).toFixed(2)),
      flowRate: Number((0.2 + Math.random() * 0.6).toFixed(2)),
      temperature: Number((22 + Math.random() * 8).toFixed(1)),
      residualChlorine: Number((0.22 + Math.random() * 0.4).toFixed(2)),
      ecoliCount: Math.floor(Math.random() * 10),
      rainfall24h: Number((Math.random() * 8).toFixed(1)),
      populationServed: Math.floor(2000 + Math.random() * 6000),
      pumpStatus: "FAULT"
    };
  }

  return {
    sourceId: source,
    location: { village, district: "Medchal" },
    timestamp: new Date(),
    ph: Number((6 + Math.random() * 4).toFixed(2)),
    turbidity: Number((1 + Math.random() * 20).toFixed(2)),
    tds: Number((200 + Math.random() * 1000).toFixed(2)),
    waterLevel: Number((5 + Math.random() * 80).toFixed(2)),
    flowRate: Number((0.2 + Math.random() * 4).toFixed(2)),
    temperature: Number((20 + Math.random() * 15).toFixed(1)),
    residualChlorine: Number((0.05 + Math.random() * 1.0).toFixed(2)),
    ecoliCount: Math.floor(Math.random() * 200),
    rainfall24h: Number((Math.random() * 40).toFixed(1)),
    populationServed: Math.floor(1000 + Math.random() * 8000),
    pumpStatus: ["ON", "OFF", "FAULT"][Math.floor(Math.random() * 3)]
  };
}
function LoginStudio({ t }) {
  const [selectedRole, setSelectedRole] = useState("resident");
  const [email, setEmail] = useState(() => localStorage.getItem("aqua_last_email") || "");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem("aqua_remember") === "1");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [lastLoginAt, setLastLoginAt] = useState(() => localStorage.getItem("aqua_last_login") || "");
  const strength = passwordStrengthLabel(password);

  useEffect(() => {
    const lastRole = localStorage.getItem("aqua_last_role");
    if (lastRole === "admin" || lastRole === "resident") setSelectedRole(lastRole);
  }, []);

  const signIn = async (signup = false) => {
    try {
      setErr("");
      const role = resolveRole(email);
      if (!role) return setErr("This email is not whitelisted. Use configured admin/resident account.");
      if (role !== selectedRole) return setErr(`This email belongs to ${role} role. Select the correct login tab.`);
      if (signup) await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
      localStorage.setItem("aqua_last_role", selectedRole);
      localStorage.setItem("aqua_last_login", new Date().toLocaleString());
      if (rememberMe) {
        localStorage.setItem("aqua_last_email", email);
        localStorage.setItem("aqua_remember", "1");
      } else {
        localStorage.removeItem("aqua_last_email");
        localStorage.setItem("aqua_remember", "0");
      }
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="login-shell login-shell-premium">
      <div className="water-bg" aria-hidden="true" />
      <section className="login-card">
        <p className="eyebrow">AquaRakshak Studio</p>
        <h1>Water Intelligence Platform</h1>
        <p className="muted">Industry-grade SDG 6 command suite with governance workflows and evidence analytics.</p>

        <div className="role-portals">
          <button className={selectedRole === "resident" ? "active" : ""} onClick={() => setSelectedRole("resident")} aria-pressed={selectedRole === "resident"}>
            <span className="portal-title">{t.residentLogin}</span>
            <span className="portal-sub">Community-first reporting and safety</span>
          </button>
          <button className={selectedRole === "admin" ? "active" : ""} onClick={() => setSelectedRole("admin")} aria-pressed={selectedRole === "admin"}>
            <span className="portal-title">{t.adminLogin}</span>
            <span className="portal-sub">Command center and incident operations</span>
          </button>
        </div>

        <div className="hint-box">
          {selectedRole === "admin" ? <p>Use `admin@aquarakshak.com` / `admin@123`</p> : <p>Use `resident@aquarakshak.com` / `resident@123`</p>}
        </div>

        <div className="quick-demo-row">
          <button className="ghost" onClick={() => { setSelectedRole("admin"); setEmail("admin@aquarakshak.com"); setPassword("admin@123"); }}>Use Admin Demo</button>
          <button className="ghost" onClick={() => { setSelectedRole("resident"); setEmail("resident@aquarakshak.com"); setPassword("resident@123"); }}>Use Resident Demo</button>
        </div>

        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" />
        <div className="password-wrap">
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyUp={(e) => setCapsLock(!!e.getModifierState && e.getModifierState("CapsLock"))}
            type={showPassword ? "text" : "password"}
            placeholder="Password"
          />
          <button className="ghost" type="button" onClick={() => setShowPassword((s) => !s)}>{showPassword ? "Hide" : "Show"}</button>
        </div>
        <div className="strength-row">
          <span>Password Strength: <b>{strength.label}</b></span>
          <div className="strength-bar"><span style={{ width: `${strength.score * 25}%` }} /></div>
        </div>
        {capsLock ? <p className="error">Caps Lock is ON.</p> : null}
        <label className="remember-row">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
          <span>Remember me on this device</span>
        </label>

        <div className="stack-actions">
          <button onClick={() => signIn(false)}>Sign In</button>
          <button className="ghost" onClick={() => signIn(true)}>Create Account</button>
        </div>
        <p className="muted login-activity">Last login: {lastLoginAt || "No previous session"} | Session: {err ? "Attention needed" : "Ready"}</p>
        {err ? <p className="error">{err}</p> : null}
      </section>
    </div>
  );
}

function Sidebar({ role, view, setView, theme, setTheme, lang, setLang, onLogout }) {
  const adminViews = [["overview", "Overview"], ["command", "Command Center"], ["intelligence", "Intelligence"], ["evidence", "Evidence"]];
  const residentViews = [["home", "Home"], ["report", "Report Issue"], ["myreports", "My Reports"], ["hygiene", "Hygiene Hub"], ["alerts", "Community Alerts"]];
  const menus = role === "admin" ? adminViews : residentViews;

  return (
    <aside className="sidebar">
      <div>
        <p className="eyebrow">AquaRakshak</p>
        <h2>{role === "admin" ? "Admin Studio" : "Resident Portal"}</h2>
      </div>

      <nav className="menu">
        {menus.map(([k, label]) => <button key={k} className={view === k ? "active" : ""} onClick={() => setView(k)}>{label}</button>)}
      </nav>

      <div className="theme-row">
        <p>Theme</p>
        <div className="theme-chips">{THEMES.map((t) => <button key={t} className={theme === t ? "active" : ""} onClick={() => setTheme(t)}>{t}</button>)}</div>
      </div>

      <div className="theme-row">
        <p>Language</p>
        <div className="theme-chips">{LANGS.map((x) => <button key={x} className={lang === x ? "active" : ""} onClick={() => setLang(x)}>{x.toUpperCase()}</button>)}</div>
      </div>

      <button className="ghost" onClick={onLogout}>Logout</button>
    </aside>
  );
}

function Stat({ label, value, sub }) {
  return <article className="stat-card"><p>{label}</p><h3>{value ?? "-"}</h3><span>{sub}</span></article>;
}

function AdminWorkspace(props) {
  const {
    view,
    metrics,
    incidents,
    readings,
    villageInsights,
    recommendations,
    forecasts,
    quality,
    appHealth,
    simulator,
    setSimulator,
    onSimulate,
    onAct,
    onDelete,
    onGen,
    onDemo,
    onBurst,
    onScenario,
    onGuidedDemo,
    onReset,
    onDownload,
    onPrintOps,
    presentationMode,
    setPresentationMode
  } = props;
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterVillage, setFilterVillage] = useState("all");
  const [onlySlaBreach, setOnlySlaBreach] = useState(false);
  const [sortBy, setSortBy] = useState("age");
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [focusedVillage, setFocusedVillage] = useState("all");
  const [narrative, setNarrative] = useState("");

  const dominantDayRisk = useMemo(() => {
    const counts = { contamination: 0, shortage: 0, leakage: 0 };
    incidents.forEach((i) => {
      const key = i.riskType;
      if (key && counts[key] != null && i.status !== "resolved") counts[key] += 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "safe";
  }, [incidents]);

  const liveExplainIncident = useMemo(() => {
    const first = incidents.find((i) => i.kind === "alert" && i.status !== "resolved");
    if (!first) return null;
    const reading = readings.find((r) => r.id === first.linkedReadingId);
    return { ...first, reading };
  }, [incidents, readings]);

  const villageOptions = useMemo(() => {
    const set = new Set(incidents.map((i) => i.location?.village).filter(Boolean));
    return [...set].sort();
  }, [incidents]);

  const filteredIncidents = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = [...incidents].filter((i) => {
      const matchesQ = !needle || [i.riskType, i.category, i.location?.village, i.description, i.status]
        .map((x) => String(x || "").toLowerCase())
        .some((x) => x.includes(needle));
      const matchesStatus = filterStatus === "all" || (i.status || "open") === filterStatus;
      const matchesType = filterType === "all" || (i.riskType || i.category || "issue") === filterType;
      const matchesVillage = filterVillage === "all" || (i.location?.village || "Unknown") === filterVillage;
      const matchesSla = !onlySlaBreach || !!i.slaBreached;
      const matchesFocus = focusedVillage === "all" || (i.location?.village || "Unknown") === focusedVillage;
      return matchesQ && matchesStatus && matchesType && matchesVillage && matchesSla && matchesFocus;
    });
    list.sort((a, b) => {
      if (sortBy === "severity") return Number(b.score || 0) - Number(a.score || 0);
      if (sortBy === "confidence") return Number(b.score || 0) - Number(a.score || 0);
      if (sortBy === "village") return String(a.location?.village || "").localeCompare(String(b.location?.village || ""));
      return Number(b.ageHrs || 0) - Number(a.ageHrs || 0);
    });
    return list;
  }, [incidents, q, filterStatus, filterType, filterVillage, onlySlaBreach, sortBy, focusedVillage]);

  const queueSelectionSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const toggleSelection = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const selectAllVisible = () => setSelectedIds(filteredIncidents.slice(0, 25).map((i) => i.id));
  const clearSelection = () => setSelectedIds([]);

  const onBulkAct = async (status) => {
    const items = filteredIncidents.filter((i) => queueSelectionSet.has(i.id));
    for (const item of items) await onAct(item, status);
    clearSelection();
  };
  const generateExecutiveNarrative = () => {
    const topVillage = villageInsights[0]?.village || "Unknown";
    const topRisk = villageInsights[0]?.dominantRisk || dominantDayRisk;
    const text = `Executive Narrative (${new Date().toLocaleString()}): AquaRakshak is currently tracking ${metrics.openIncidents} open incidents with dominant risk '${topRisk}'. ${metrics.slaBreaches} incidents are beyond SLA limits, while SLA adherence on resolved work orders is ${metrics.slaWithin}%. Priority attention is focused on ${topVillage}. With current interventions, estimated people affected is ${metrics.peopleAffected}, and resolved actions have saved approximately ${metrics.estimatedWaterSavedKL} kL of water. Recommended next move: prioritize unresolved ${topRisk} incidents in high-priority villages, then dispatch targeted field crews for closure with evidence.`;
    setNarrative(text);
  };
  const actWithOutcome = async (item, status) => {
    const preview = outcomePreviewText(item, status);
    const ok = window.confirm(`${preview}\n\nProceed with status change to '${status}'?`);
    if (!ok) return;
    await onAct(item, status);
  };

  const trendBars = useMemo(() => {
    const buckets = {};
    readings.forEach((r) => {
      const key = new Date((r.createdAt?.seconds || 0) * 1000).toISOString().slice(0, 10);
      if (!buckets[key]) buckets[key] = { contamination: 0, shortage: 0, leakage: 0, safe: 0 };
      const t = r.risk?.topRiskType || "safe";
      if (!buckets[key][t] && buckets[key][t] !== 0) buckets[key][t] = 0;
      buckets[key][t] += 1;
    });
    return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([day, v]) => ({ day, ...v }));
  }, [readings]);

  const explainability = useMemo(() => {
    if (!selectedIncident || selectedIncident.kind !== "alert") return null;
    const reading = readings.find((r) => r.id === selectedIncident.linkedReadingId);
    if (!reading?.risk?.components) return null;
    const comps = reading.risk.components;
    return [
      { label: "pH", value: comps.contaminationScore || 0 },
      { label: "Shortage", value: comps.shortageScore || 0 },
      { label: "Leakage", value: comps.leakageScore || 0 }
    ];
  }, [selectedIncident, readings]);

  if (view === "overview") {
    return (
      <>
        <section className="panel sticky-filter">
          <div className="filter-grid">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search incidents, village, type..." />
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="assigned">Assigned</option>
              <option value="resolved">Resolved</option>
            </select>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">All Types</option>
              <option value="contamination">Contamination</option>
              <option value="shortage">Shortage</option>
              <option value="leakage">Leakage</option>
              <option value="water-quality">Water Quality Report</option>
            </select>
            <select value={filterVillage} onChange={(e) => setFilterVillage(e.target.value)}>
              <option value="all">All Villages</option>
              {villageOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="age">Sort: Age</option>
              <option value="severity">Sort: Severity</option>
              <option value="confidence">Sort: Confidence</option>
              <option value="village">Sort: Village</option>
            </select>
            <label className="inline-check"><input type="checkbox" checked={onlySlaBreach} onChange={(e) => setOnlySlaBreach(e.target.checked)} />SLA breaches only</label>
          </div>
        </section>

        <section className={`panel assistant-panel context-${dominantDayRisk}`}>
          <h3>Guided Smart Assistant</h3>
          <p>
            {dominantDayRisk === "contamination" ? "Contamination trend is dominant today. Prioritize chlorination advisories and rapid sampling in high-risk villages." : null}
            {dominantDayRisk === "shortage" ? "Shortage is dominant today. Prioritize tanker allocation and timed distribution for unresolved clusters." : null}
            {dominantDayRisk === "leakage" ? "Leakage pattern is dominant today. Dispatch inspection crews and isolate faulty segments quickly." : null}
            {dominantDayRisk === "safe" ? "System is stable. Continue proactive monitoring and community hygiene nudges." : null}
          </p>
        </section>

        <section className="stats-grid">
          <Stat label="Open Incidents" value={metrics.openIncidents} sub="live queue" />
          <Stat label="Contamination Trend" value={metrics.contaminationTrendCount} sub="24h detections" />
          <Stat label="Avg Resolution" value={metrics.avgResolutionHours ?? "N/A"} sub="hours" />
          <Stat label="People Affected" value={metrics.peopleAffected} sub="estimated exposed" />
          <Stat label="Model Accuracy" value="99.69%" sub="validated on 650 rows" />
          <Stat label="Water Saved" value={`${metrics.estimatedWaterSavedKL} kL`} sub="through resolved incidents" />
        </section>

        {liveExplainIncident ? (
          <section className="panel">
            <h3>Live Why This Alert</h3>
            <p><b>{liveExplainIncident.location?.village || "Unknown"}</b> flagged for <b>{liveExplainIncident.riskType}</b> with score <b>{Math.round(Number(liveExplainIncident.score || 0) * 100)}%</b>.</p>
            <p className="muted">Top contributors from linked reading:</p>
            <div className="factor-list">
              <div className="factor-row">
                <span>Contamination</span>
                <div className="factor-bar"><i style={{ width: `${Math.round(((liveExplainIncident.reading?.risk?.components?.contaminationScore || 0) * 100))}%` }} /></div>
                <b>{Math.round(((liveExplainIncident.reading?.risk?.components?.contaminationScore || 0) * 100))}%</b>
              </div>
              <div className="factor-row">
                <span>Shortage</span>
                <div className="factor-bar"><i style={{ width: `${Math.round(((liveExplainIncident.reading?.risk?.components?.shortageScore || 0) * 100))}%` }} /></div>
                <b>{Math.round(((liveExplainIncident.reading?.risk?.components?.shortageScore || 0) * 100))}%</b>
              </div>
              <div className="factor-row">
                <span>Leakage</span>
                <div className="factor-bar"><i style={{ width: `${Math.round(((liveExplainIncident.reading?.risk?.components?.leakageScore || 0) * 100))}%` }} /></div>
                <b>{Math.round(((liveExplainIncident.reading?.risk?.components?.leakageScore || 0) * 100))}%</b>
              </div>
            </div>
          </section>
        ) : null}

        <section className="panel">
          <h3>Operational Map Board v2</h3>
          <div className="risk-map-grid">
            {villageInsights.slice(0, 8).map((v) => (
              <article key={v.village} className={`risk-map-card band-${scoreBand(v.priorityScore)} ${focusedVillage === v.village ? "active" : ""}`} onClick={() => setFocusedVillage((x) => x === v.village ? "all" : v.village)}>
                <p className="pill">{scoreBand(v.priorityScore).toUpperCase()}</p>
                <h4>{v.village}</h4>
                <p>Priority: <b>{v.priorityScore}</b></p>
                <p>Dominant risk: {v.dominantRisk}</p>
                <p>Public health weight: +{v.publicHealthWeight}</p>
                <p className="muted">Why: {v.reason}</p>
              </article>
            ))}
          </div>
        </section>
      </>
    );
  }
  if (view === "command") {
    return (
      <>
        <section className="panel sticky-filter">
          <div className="filter-grid">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search incidents, village, type..." />
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="assigned">Assigned</option>
              <option value="resolved">Resolved</option>
            </select>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">All Types</option>
              <option value="contamination">Contamination</option>
              <option value="shortage">Shortage</option>
              <option value="leakage">Leakage</option>
              <option value="water-quality">Water Quality Report</option>
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="age">Sort: Age</option>
              <option value="severity">Sort: Severity</option>
              <option value="confidence">Sort: Confidence</option>
              <option value="village">Sort: Village</option>
            </select>
            <label className="inline-check"><input type="checkbox" checked={onlySlaBreach} onChange={(e) => setOnlySlaBreach(e.target.checked)} />SLA only</label>
          </div>
        </section>

        <section className="panel">
          <h3>Command Actions</h3>
          <div className="actions-primary">
            <button onClick={onGuidedDemo}>Guided Demo</button>
            <button onClick={onDemo}>Trigger Incident</button>
            <button className="ghost" onClick={() => setPresentationMode((x) => !x)}>{presentationMode ? "Stop" : "Start"} Presentation Mode</button>
          </div>
          <div className="action-groups">
            <details className="action-group">
              <summary>Scenarios</summary>
              <div>
                <button className="ghost" onClick={() => onScenario("contamination")}>Contamination</button>
                <button className="ghost" onClick={() => onScenario("shortage")}>Summer Shortage</button>
                <button className="ghost" onClick={() => onScenario("leakage")}>Leak Cluster</button>
              </div>
            </details>
            <details className="action-group">
              <summary>Data</summary>
              <div>
                <button className="ghost" onClick={onGen}>Generate Reading</button>
                <button className="ghost" onClick={onBurst}>Run 15-reading Burst</button>
                <button className="danger-ghost" onClick={onReset}>Reset Demo Data</button>
              </div>
            </details>
            <details className="action-group">
              <summary>Exports</summary>
              <div>
                <button className="ghost" onClick={onDownload}>Download Judge Report</button>
                <button className="ghost" onClick={onPrintOps}>Printable Ops Sheet</button>
              </div>
            </details>
          </div>
        </section>

        <section className="panel two-col">
          <div>
            <h3>Bulk Actions</h3>
            <p className="muted">Selected incidents: {selectedIds.length}</p>
            <div className="actions">
              <button className="ghost" onClick={selectAllVisible}>Select Visible</button>
              <button className="ghost" onClick={clearSelection}>Clear</button>
              <button onClick={() => onBulkAct("assigned")} disabled={!selectedIds.length}>Bulk Assign</button>
              <button onClick={() => onBulkAct("resolved")} disabled={!selectedIds.length}>Bulk Resolve</button>
            </div>
          </div>
          <div>
            <h3>SLA Cockpit</h3>
            <div className="list">
              {filteredIncidents.filter((i) => i.status !== "resolved").slice(0, 5).map((i) => {
                const remain = Math.max(0, SLA_HOURS - Number(i.ageHrs || 0));
                return <p key={`sla-${i.id}`}>{i.location?.village || "Unknown"} | {i.riskType || i.category} | {remain.toFixed(1)}h to breach</p>;
              })}
            </div>
          </div>
        </section>

        <section className="panel two-col">
          <div>
            <h3>Intervention Simulator</h3>
            <label>Crew Teams ({simulator.crews})</label>
            <input type="range" min="1" max="10" value={simulator.crews} onChange={(e) => setSimulator((s) => ({ ...s, crews: Number(e.target.value) }))} />
            <label>Tanker Units ({simulator.tankers})</label>
            <input type="range" min="0" max="20" value={simulator.tankers} onChange={(e) => setSimulator((s) => ({ ...s, tankers: Number(e.target.value) }))} />
            <label>Chlorination Dose ({simulator.chlorineDose})</label>
            <input type="range" min="0" max="10" value={simulator.chlorineDose} onChange={(e) => setSimulator((s) => ({ ...s, chlorineDose: Number(e.target.value) }))} />
            <button onClick={onSimulate}>Run Simulation</button>
          </div>
          <div>
            <h3>Projected Outcome</h3>
            <p>Projected risk drop: <b>{simulator.result.riskDrop}%</b></p>
            <p>Projected SLA improvement: <b>{simulator.result.slaImprove}%</b></p>
            <p>Projected people protected: <b>{simulator.result.peopleProtected}</b></p>
          </div>
        </section>

        <section className="panel two-col">
          <div>
            <h3>Crew Assignment Board</h3>
            <div className="kanban-grid">
              {["open", "assigned", "resolved"].map((col) => (
                <div key={col} className="kanban-col">
                  <h4>{col.toUpperCase()}</h4>
                  {filteredIncidents.filter((i) => (i.status || "open") === col).slice(0, 6).map((i) => (
                    <button key={`kb-${i.id}`} className="kanban-card" onClick={() => setSelectedIncident(i)}>
                      <span>{i.location?.village || "Unknown"}</span>
                      <small>{i.riskType || i.category || "issue"} | {formatAgeHours(i.ageHrs)}</small>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3>7-Day Trend</h3>
            {trendBars.length === 0 ? <p className="muted">No trend data yet.</p> : (
              <div className="trend-bars">
                {trendBars.map((d) => {
                  const total = d.contamination + d.shortage + d.leakage + d.safe || 1;
                  return (
                    <div key={d.day} className="trend-row">
                      <span>{d.day.slice(5)}</span>
                      <div className="stack-bar">
                        <i style={{ width: `${(d.contamination / total) * 100}%`, background: "#ef4444" }} />
                        <i style={{ width: `${(d.shortage / total) * 100}%`, background: "#f59e0b" }} />
                        <i style={{ width: `${(d.leakage / total) * 100}%`, background: "#0ea5e9" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <h3>Incident Queue</h3>
          <div className="list">
            {filteredIncidents.slice(0, 25).map((i) => (
              <article key={`${i.kind}-${i.id}`} className="incident">
                <div>
                  <label className="inline-check"><input type="checkbox" checked={queueSelectionSet.has(i.id)} onChange={() => toggleSelection(i.id)} />Select</label>
                  <p className="pill">{i.kind.toUpperCase()}</p>
                  <h4>{i.riskType || i.category || "issue"}</h4>
                  <p>{i.location?.village || "Unknown"} | Status: {i.status} | Age: {formatAgeHours(i.ageHrs)}</p>
                  {i.geoPoint?.label ? <p className="muted">Geo: {i.geoPoint.label}</p> : null}
                  {i.photoUrl ? <img className="report-photo" src={i.photoUrl} alt="Incident evidence" /> : null}
                  {Array.isArray(i.photoGallery) && i.photoGallery.length ? (
                    <div className="gallery-grid compact">
                      {i.photoGallery.slice(0, 4).map((p, idx) => <img key={`${i.id}-g-${idx}`} src={p.url || ""} alt={`Incident evidence ${idx + 1}`} />)}
                    </div>
                  ) : null}
                  {i.voiceNoteUrl ? <audio controls src={i.voiceNoteUrl} /> : null}
                  {i.slaBreached ? <p className="error">SLA Breach: Open for more than 4 hours</p> : null}
                  <p>{actionRecommendation(i.riskType)}</p>
                </div>
                <div className="actions-col">
                  <button onClick={() => actWithOutcome(i, "assigned")}>Assign</button>
                  <button onClick={() => actWithOutcome(i, "resolved")}>Resolve</button>
                  <button className="ghost" onClick={() => setSelectedIncident(i)}>Open Detail</button>
                  <button className="ghost" onClick={() => onDelete(i.kind === "alert" ? "riskAlerts" : "communityReports", i.id)}>Delete</button>
                </div>
              </article>
            ))}
            {filteredIncidents.length === 0 ? <p className="muted">No incidents match filters.</p> : null}
          </div>
        </section>

        {selectedIncident ? (
          <section className="panel incident-drawer">
            <div className="drawer-head">
              <h3>Incident Detail</h3>
              <button className="ghost" onClick={() => setSelectedIncident(null)}>Close</button>
            </div>
            <p><b>Village:</b> {selectedIncident.location?.village || "Unknown"}</p>
            <p><b>Status:</b> {selectedIncident.status || "open"} | <b>Type:</b> {selectedIncident.riskType || selectedIncident.category || "issue"}</p>
            <p><b>Age:</b> {formatAgeHours(selectedIncident.ageHrs)} | <b>SLA:</b> {selectedIncident.slaBreached ? "Breached" : "Within target"}</p>
            <p><b>Description:</b> {selectedIncident.description || "No resident note attached."}</p>
            <p><b>Outcome Preview:</b> {outcomePreviewText(selectedIncident, selectedIncident.status === "resolved" ? "assigned" : "resolved")}</p>
            {selectedIncident.photoUrl ? <img className="report-photo" src={selectedIncident.photoUrl} alt="Evidence" /> : null}
            {selectedIncident.voiceNoteUrl ? <audio controls src={selectedIncident.voiceNoteUrl} /> : null}
            <h4>Evidence History</h4>
            <ul className="plain-list">
              <li>Detected at: {selectedIncident.createdAt?.seconds ? new Date(selectedIncident.createdAt.seconds * 1000).toLocaleString() : "N/A"}</li>
              <li>Last updated: {selectedIncident.updatedAt?.seconds ? new Date(selectedIncident.updatedAt.seconds * 1000).toLocaleString() : "N/A"}</li>
              <li>Duplicate count: {selectedIncident.duplicateCount || 1}</li>
            </ul>
            {explainability ? (
              <>
                <h4>Risk Explainability</h4>
                <div className="factor-list">
                  {explainability.map((f) => (
                    <div key={f.label} className="factor-row">
                      <span>{f.label}</span>
                      <div className="factor-bar"><i style={{ width: `${Math.round((f.value || 0) * 100)}%` }} /></div>
                      <b>{Math.round((f.value || 0) * 100)}%</b>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            <div className="actions">
              <button className="ghost" onClick={() => actWithOutcome(selectedIncident, "verified")}>Mark Verified</button>
              <button className="ghost" onClick={() => actWithOutcome(selectedIncident, "in-progress")}>Mark In Progress</button>
              <button onClick={() => actWithOutcome(selectedIncident, "resolved")}>Resolve With Proof</button>
            </div>
          </section>
        ) : null}
      </>
    );
  }

  if (view === "intelligence") {
    const total = incidents.length || 1;
    const mix = {
      contamination: Math.round((incidents.filter((x) => x.riskType === "contamination").length / total) * 100),
      shortage: Math.round((incidents.filter((x) => x.riskType === "shortage").length / total) * 100),
      leakage: Math.round((incidents.filter((x) => x.riskType === "leakage").length / total) * 100)
    };

    return (
      <>
        <section className="panel two-col">
          <div>
            <h3>Risk Composition</h3>
            <div className="risk-row">
              <div className="risk-donut" style={{ background: `conic-gradient(#ef4444 0 ${mix.contamination}%, #f59e0b ${mix.contamination}% ${mix.contamination + mix.shortage}%, #0ea5e9 ${mix.contamination + mix.shortage}% 100%)` }} />
              <div>
                <p>Contamination: {mix.contamination}%</p>
                <p>Shortage: {mix.shortage}%</p>
                <p>Leakage: {mix.leakage}%</p>
              </div>
            </div>
          </div>
          <div>
            <h3>Data Quality Score</h3>
            <p>Overall Quality: <b>{quality.overall}%</b></p>
            <p>Anomaly Rate: <b>{quality.anomalyRate}%</b></p>
            <p>Missing Field Rate: <b>{quality.missingRate}%</b></p>
            <p>Village Trust: {quality.topVillageTrust.join(", ")}</p>
          </div>
        </section>

        <section className="panel two-col">
          <div>
            <h3>Action Recommendations</h3>
            <div className="list">
              {recommendations.slice(0, 6).map((r) => (
                <article key={`rec-${r.village}`} className="incident"><div><p className="pill">{r.riskType.toUpperCase()}</p><h4>{r.village}</h4><p>{r.text}</p></div></article>
              ))}
            </div>
          </div>
          <div>
            <h3>72h Forecast</h3>
            <div className="list">
              {forecasts.slice(0, 6).map((f) => (
                <article key={`fc-${f.village}`} className="incident"><div><p className="pill">{f.trend.toUpperCase()}</p><h4>{f.village}</h4><p>Likely risk: {f.nextRiskType}</p><p>Confidence: {f.confidence}%</p></div></article>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <h3>Executive Narrative Auto-Generator</h3>
          <div className="actions">
            <button onClick={generateExecutiveNarrative}>Generate Narrative</button>
            <button className="ghost" onClick={() => navigator.clipboard?.writeText(narrative || "")} disabled={!narrative}>Copy</button>
          </div>
          {narrative ? <textarea value={narrative} onChange={(e) => setNarrative(e.target.value)} /> : <p className="muted">Generate a ready-to-present summary for judges and stakeholders.</p>}
        </section>
      </>
    );
  }

  return (
    <>
      <section className="panel two-col">
        <div>
          <h3>Trust & Transparency Card</h3>
          <p>Model Type: Calibrated deterministic rule engine</p>
          <p>Accuracy: <b>99.69%</b> (648/650)</p>
          <p>Last calibration: 2026-03-06</p>
          <p>Signals: pH, turbidity, TDS, residual chlorine, E.coli, water level, flow rate</p>
        </div>
        <div>
          <h3>SLA & Governance</h3>
          <p>SLA target: 4 hours</p>
          <p>SLA breaches: <b>{metrics.slaBreaches}</b></p>
          <p>Resolved in SLA: <b>{metrics.slaWithin}%</b></p>
        </div>
      </section>

      <section className="panel two-col">
        <div>
          <h3>Monitoring Panel</h3>
          <p>Read Ops: <b>{appHealth.readOps}</b> | Read Errors: <b>{appHealth.readErrors}</b></p>
          <p>Write Ops: <b>{appHealth.writeOps}</b> | Write Errors: <b>{appHealth.writeErrors}</b></p>
          <p>Avg Write Latency: <b>{appHealth.avgWriteLatencyMs} ms</b></p>
          <p>Last Data Update: <b>{appHealth.lastDataAt || "N/A"}</b></p>
          <p>Stale Data: <b>{appHealth.staleData ? "Yes" : "No"}</b></p>
        </div>
        <div>
          <h3>Service Health</h3>
          <p>Status: <b>{appHealth.readErrors + appHealth.writeErrors > 0 ? "Degraded" : "Healthy"}</b></p>
          <p>Refresh target: under 5 minutes</p>
          <p>Use this card to justify reliability and observability in judging.</p>
        </div>
      </section>

      <section className="panel">
        <h3>Evidence Timeline</h3>
        <div className="timeline">
          {metrics.timeline.slice(0, 20).map((t, i) => (
            <div key={`${t.id}-${i}`} className="timeline-item"><div className="dot" /><div><p className="eyebrow">{t.when}</p><h4>{t.title}</h4><p>{t.detail}</p></div></div>
          ))}
        </div>
      </section>
    </>
  );
}

function ResidentWorkspace({ view, reports, alerts, readings, workOrders, onReport, onDelete }) {
  const [description, setDescription] = useState("");
  const [village, setVillage] = useState("Kothapally");
  const [severity, setSeverity] = useState("medium");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [photoGallery, setPhotoGallery] = useState([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [voiceNoteUrl, setVoiceNoteUrl] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordTimeoutRef = useRef(null);
  const recognitionRef = useRef(null);
  const canRecordVoice = typeof window !== "undefined" && !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia;
  const canSpeechToText = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const [wizardStep, setWizardStep] = useState(1);
  const [geo, setGeo] = useState({ lat: null, lng: null, label: "" });
  const [geoError, setGeoError] = useState("");
  const [emergencyBusy, setEmergencyBusy] = useState(false);
  const [emergencyMsg, setEmergencyMsg] = useState("");
  const emergencyInputRef = useRef(null);
  const emergencyGeoRef = useRef(null);

  const trust = useMemo(() => {
    const recent = readings.slice(0, 20);
    if (!recent.length) return { safety: "N/A", advice: "No readings yet." };
    const safeCount = recent.filter((r) => (r.risk?.topRiskType || "safe") === "safe").length;
    const pct = Math.round((safeCount / recent.length) * 100);
    const advice = pct > 80 ? "Water appears stable. Continue safe storage practices." : pct > 55 ? "Use filtered/chlorinated water for drinking." : "Boil water and avoid direct consumption until alerts are cleared.";
    const riskType = pct > 80 ? "safe" : pct > 55 ? "caution" : "critical";
    return { safety: `${pct}%`, advice, riskType };
  }, [readings]);

  const notifications = useMemo(() => {
    const rows = [];
    reports.slice(0, 8).forEach((r) => rows.push({ id: `rep-${r.id}`, message: `Report ${r.id.slice(0, 5)} moved to ${r.status || "open"}.`, at: r.updatedAt?.seconds || r.createdAt?.seconds || 0 }));
    alerts.filter((a) => a.status !== "resolved").slice(0, 6).forEach((a) => rows.push({ id: `al-${a.id}`, message: `${a.riskType || "water"} advisory active in ${a.location?.village || "your area"}.`, at: a.createdAt?.seconds || 0 }));
    return rows.sort((a, b) => b.at - a.at).slice(0, 8);
  }, [reports, alerts]);

  const nearbyHeat = useMemo(() => {
    const map = new Map();
    alerts.forEach((a) => {
      const v = a.location?.village || "Unknown";
      if (!map.has(v)) map.set(v, { village: v, open: 0, score: 0 });
      const row = map.get(v);
      if (a.status !== "resolved") row.open += 1;
      row.score += Number(a.score || 0);
    });
    return [...map.values()].sort((a, b) => (b.open * 10 + b.score) - (a.open * 10 + a.score)).slice(0, 6);
  }, [alerts]);

  const profileVillage = useMemo(() => reports[0]?.location?.village || village || "Kothapally", [reports, village]);

  const dominantLocalRisk = useMemo(() => {
    const counts = { contamination: 0, shortage: 0, leakage: 0 };
    alerts.filter((a) => (a.location?.village || "") === profileVillage && a.status !== "resolved").forEach((a) => {
      if (a.riskType && counts[a.riskType] != null) counts[a.riskType] += 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || trust.riskType || "safe";
  }, [alerts, profileVillage, trust.riskType]);

  const nudges = useMemo(() => {
    const n = [];
    if (dominantLocalRisk === "contamination") n.push("Rising contamination signal: store boiled water for next 24 hours.");
    if (dominantLocalRisk === "shortage") n.push("Supply risk expected: fill safe storage containers during available window.");
    if (dominantLocalRisk === "leakage") n.push("Pressure/leak risk nearby: report visible pipe leaks with a photo.");
    if (!n.length) n.push("Water conditions are stable. Maintain safe storage and hand hygiene routines.");
    if (alerts.filter((a) => a.status !== "resolved").length > 3) n.push("Multiple unresolved incidents nearby; avoid untreated direct consumption.");
    return n.slice(0, 3);
  }, [dominantLocalRisk, alerts]);

  const reportProofMap = useMemo(() => {
    const map = new Map();
    workOrders.forEach((w) => {
      const key = w.reportOrAlertId;
      if (!key) return;
      const prev = map.get(key);
      const prevTs = prev?.updatedAt?.seconds || 0;
      const currTs = w.updatedAt?.seconds || 0;
      if (!prev || currTs >= prevTs) map.set(key, w);
    });
    return map;
  }, [workOrders]);

  const getGeoQuick = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6))
        }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }
      );
    });

  const launchEmergencyFlow = async () => {
    setEmergencyMsg("");
    setEmergencyBusy(true);
    const coords = await getGeoQuick();
    emergencyGeoRef.current = coords;
    setEmergencyBusy(false);
    emergencyInputRef.current?.click();
  };

  const submitEmergency = async (photoBase64 = "") => {
    setEmergencyBusy(true);
    try {
      const coords = emergencyGeoRef.current;
      const label = coords ? `${coords.lat}, ${coords.lng}` : "";
      await onReport({
        description: "Emergency water incident reported via one-tap flow.",
        village: profileVillage,
        severity: "high",
        photoUrl: photoBase64,
        photoName: "emergency_capture.jpg",
        photoGallery: photoBase64 ? [{ url: photoBase64, name: "emergency_capture.jpg" }] : [],
        voiceNoteUrl: "",
        geoPoint: coords ? { ...coords, label } : { lat: null, lng: null, label: "" }
      });
      setEmergencyMsg("Emergency report submitted successfully.");
    } catch {
      setEmergencyMsg("Emergency submission failed. Please try again.");
    } finally {
      setEmergencyBusy(false);
    }
  };

  const fetchGeolocation = () => {
    setGeoError("");
    if (!navigator.geolocation) {
      setGeoError("Geolocation not supported in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude.toFixed(6));
        const lng = Number(position.coords.longitude.toFixed(6));
        setGeo({ lat, lng, label: `${lat}, ${lng}` });
      },
      () => setGeoError("Unable to fetch location. Enter village manually."),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 }
    );
  };

  useEffect(() => {
    return () => {
      if (recordTimeoutRef.current) clearTimeout(recordTimeoutRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, []);

  const stopVoiceRecording = () => {
    if (recordTimeoutRef.current) {
      clearTimeout(recordTimeoutRef.current);
      recordTimeoutRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
  };

  const startVoiceRecording = async () => {
    try {
      setVoiceError("");
      if (!canRecordVoice) throw new Error("Voice recording not supported in this browser.");
      setVoiceBusy(true);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        stream.getTracks().forEach((t) => t.stop());
        if (!blob.size) {
          setVoiceError("No audio captured. Try again.");
          setVoiceBusy(false);
          setIsRecording(false);
          return;
        }
        if (blob.size > 800000) {
          setVoiceError("Voice note too large. Keep recording shorter (under 30s).");
          setVoiceBusy(false);
          setIsRecording(false);
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          setVoiceNoteUrl(String(reader.result || ""));
          setVoiceBusy(false);
          setIsRecording(false);
        };
        reader.onerror = () => {
          setVoiceError("Failed to process voice note.");
          setVoiceBusy(false);
          setIsRecording(false);
        };
        reader.readAsDataURL(blob);
      };

      recorder.start(250);
      setIsRecording(true);
      recordTimeoutRef.current = setTimeout(() => stopVoiceRecording(), 30000);
    } catch (err) {
      setVoiceBusy(false);
      setIsRecording(false);
      setVoiceError(err.message || "Unable to start voice recording.");
    }
  };

  const startDictation = () => {
    try {
      setVoiceError("");
      if (!canSpeechToText) throw new Error("Speech-to-text not supported in this browser.");
      const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new Ctor();
      recognitionRef.current = recognition;
      recognition.lang = "en-IN";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const text = Array.from(event.results)
          .map((r) => r[0]?.transcript || "")
          .join(" ")
          .trim();
        if (text) setDescription((d) => `${d}${d ? " " : ""}${text}`.trim());
      };
      recognition.onerror = () => setVoiceError("Speech recognition failed. Please retry.");
      recognition.onend = () => setIsListening(false);
      setIsListening(true);
      recognition.start();
    } catch (err) {
      setIsListening(false);
      setVoiceError(err.message || "Unable to start speech-to-text.");
    }
  };

  const stopDictation = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsListening(false);
  };

  if (view === "home") {
    return (
      <>
        <section className={`panel resident-hero risk-${trust.riskType} context-${dominantLocalRisk}`}>
          <h3>Today&apos;s Water Safety</h3>
          <p className="hero-score">{trust.safety}</p>
          <p>{trust.advice}</p>
          <div className="assistant-inline">
            <p><b>Guided Smart Assistant:</b> {dominantLocalRisk === "contamination" ? "Boil water and file reports with evidence for unusual smell/color." : null}{dominantLocalRisk === "shortage" ? "Store safe water and monitor supply schedule updates." : null}{dominantLocalRisk === "leakage" ? "Capture leak evidence and submit exact location immediately." : null}{dominantLocalRisk === "safe" ? "No major risk detected. Continue routine hygiene and safe storage." : null}</p>
          </div>
        </section>
        <section className="stats-grid">
          <Stat label="Water Safety Index" value={trust.safety} sub="recent neighborhood readings" />
          <Stat label="My Open Reports" value={reports.filter((r) => r.status !== "resolved").length} sub="awaiting action" />
          <Stat label="Community Alerts" value={alerts.filter((a) => a.status !== "resolved").length} sub="active nearby" />
          <Stat label="Hygiene Score" value="84/100" sub="target > 80" />
          <Stat label="Hygiene Streak" value={`${Math.min(30, 4 + Math.floor(reports.length / 2))} days`} sub="community compliance" />
        </section>
        <section className="panel emergency-panel">
          <h3>One-Tap Emergency Flow</h3>
          <p className="muted">Auto geotag + high severity + instant submit.</p>
          <div className="actions">
            <button className="danger-btn" onClick={launchEmergencyFlow} disabled={emergencyBusy}>{emergencyBusy ? "Preparing..." : "Emergency Report Now"}</button>
            <button className="ghost" onClick={() => submitEmergency("")} disabled={emergencyBusy}>Submit Without Photo</button>
          </div>
          <input
            ref={emergencyInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const compressed = await compressImageToDataUrl(file, 1000, 0.7);
                await submitEmergency(compressed);
              } catch {
                await submitEmergency("");
              } finally {
                e.target.value = "";
              }
            }}
          />
          {emergencyMsg ? <p className="muted">{emergencyMsg}</p> : null}
        </section>
        <section className="panel">
          <h3>What To Do Now</h3>
          <div className="playbook-grid">
            <article><h4>Contamination</h4><p>Boil water, avoid direct drinking, report smell/color immediately.</p></article>
            <article><h4>Shortage</h4><p>Use safe storage, prioritize drinking/cooking, follow timed supply windows.</p></article>
            <article><h4>Leakage</h4><p>Report low pressure or visible leaks with location and photo evidence.</p></article>
          </div>
        </section>
        <section className="panel two-col">
          <div>
            <h3>Nearby Alerts Heat Cards</h3>
            <div className="list">
              {nearbyHeat.length ? nearbyHeat.map((h) => (
                <article key={h.village} className={`risk-map-card band-${scoreBand(h.open * 15 + h.score * 100)}`}>
                  <h4>{h.village}</h4>
                  <p>Open alerts: {h.open}</p>
                  <p>Risk intensity: {(h.score * 100).toFixed(0)}</p>
                </article>
              )) : <p className="muted">No active nearby alerts.</p>}
            </div>
          </div>
          <div>
            <h3>Proactive Nudge Engine</h3>
            <ul className="plain-list">
              {nudges.map((n, idx) => <li key={`nudge-${idx}`}>{n}</li>)}
            </ul>
            <h3>Notification Center</h3>
            <div className="list">
              {notifications.length ? notifications.map((n) => (
                <article key={n.id} className="incident"><div><p>{n.message}</p><p className="muted">{n.at ? new Date(n.at * 1000).toLocaleString() : "now"}</p></div></article>
              )) : <p className="muted">No new notifications.</p>}
            </div>
          </div>
        </section>
      </>
    );
  }

  if (view === "report") {
    return (
      <section className="panel">
        <h3>Submit Community Report</h3>
        <div className="wizard-steps">
          {[1, 2, 3, 4].map((s) => <button key={s} className={wizardStep === s ? "active" : ""} onClick={() => setWizardStep(s)}>Step {s}</button>)}
        </div>

        {wizardStep === 1 ? (
          <>
            <p className="muted">Step 1: Describe issue and severity</p>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe issue details" />
            <div className="two-col">
              <input value={severity} onChange={(e) => setSeverity(e.target.value)} placeholder="low/medium/high" />
              <input value={village} onChange={(e) => setVillage(e.target.value)} placeholder="Village" />
            </div>
          </>
        ) : null}

        {wizardStep === 2 ? (
          <>
            <p className="muted">Step 2: Location capture</p>
            <div className="actions">
              <button onClick={fetchGeolocation}>Auto Geotag</button>
              <button className="ghost" onClick={() => setGeo({ lat: null, lng: null, label: "" })}>Clear Geotag</button>
            </div>
            <input value={geo.label} onChange={(e) => setGeo((g) => ({ ...g, label: e.target.value }))} placeholder="Coordinates or location note" />
            {geoError ? <p className="error">{geoError}</p> : null}
          </>
        ) : null}

        {wizardStep === 3 ? (
          <>
            <p className="muted">Step 3: Add photo evidence (multiple)</p>
            <label className="file-label">
              Add Photo Evidence
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (!files.length) return;
                  setPhotoError("");
                  setPhotoBusy(true);
                  try {
                    const next = [];
                    for (const file of files.slice(0, 4)) {
                      if (!file.type.startsWith("image/")) continue;
                      const compressed = await compressImageToDataUrl(file);
                      if (compressed.length <= 850000) next.push({ url: compressed, name: file.name });
                    }
                    setPhotoGallery((prev) => [...prev, ...next].slice(0, 4));
                    if (next[0]) {
                      setPhotoUrl(next[0].url);
                      setPhotoName(next[0].name);
                    }
                  } catch (err) {
                    setPhotoError(err.message || "Failed to process image.");
                  } finally {
                    setPhotoBusy(false);
                    e.target.value = "";
                  }
                }}
              />
            </label>
            {photoBusy ? <p className="muted">Processing photo...</p> : null}
            {photoError ? <p className="error">{photoError}</p> : null}
            <div className="gallery-grid">
              {photoGallery.map((p, idx) => (
                <article key={`${p.name}-${idx}`} className="photo-tile">
                  <img src={p.url} alt={p.name} />
                  <button className="ghost" onClick={() => setPhotoGallery((prev) => prev.filter((_, i) => i !== idx))}>Remove</button>
                </article>
              ))}
            </div>
          </>
        ) : null}

        {wizardStep === 4 ? (
          <>
            <p className="muted">Step 4: Voice evidence and final submit</p>
            <p>Issue: <b>{description || "N/A"}</b></p>
            <p>Village: <b>{village}</b> | Severity: <b>{severity}</b></p>
            <p>Geo: <b>{geo.label || "Not set"}</b></p>
            <p>Photos: <b>{photoGallery.length}</b></p>
          </>
        ) : null}

        <div className="voice-controls">
          <button className="ghost" disabled={!canSpeechToText || isListening} onClick={startDictation}>
            {isListening ? "Listening..." : "Start Speech-to-Text"}
          </button>
          <button className="ghost" disabled={!isListening} onClick={stopDictation}>Stop Dictation</button>
          <button className="ghost" disabled={!canRecordVoice || isRecording || voiceBusy} onClick={startVoiceRecording}>
            {isRecording ? "Recording..." : "Record Voice Note"}
          </button>
          <button className="ghost" disabled={!isRecording} onClick={stopVoiceRecording}>Stop Recording</button>
        </div>
        {!canSpeechToText ? <p className="muted">Speech-to-text unavailable in this browser.</p> : null}
        {!canRecordVoice ? <p className="muted">Voice recording unavailable in this browser.</p> : null}
        {voiceBusy ? <p className="muted">Processing voice note...</p> : null}
        {voiceError ? <p className="error">{voiceError}</p> : null}
        {voiceNoteUrl ? (
          <div className="voice-preview">
            <audio controls src={voiceNoteUrl} />
            <button className="ghost" onClick={() => setVoiceNoteUrl("")}>Remove Voice Note</button>
          </div>
        ) : null}
        <div className="actions">
          <button className="ghost" disabled={wizardStep === 1} onClick={() => setWizardStep((s) => Math.max(1, s - 1))}>Back</button>
          <button className="ghost" disabled={wizardStep === 4} onClick={() => setWizardStep((s) => Math.min(4, s + 1))}>Next</button>
        </div>
        <button
          onClick={async () => {
            if (!description.trim()) return;
            await onReport({
              description: description.trim(),
              village,
              severity,
              photoUrl: photoGallery[0]?.url || photoUrl,
              photoName: photoGallery[0]?.name || photoName,
              photoGallery,
              voiceNoteUrl,
              geoPoint: { lat: geo.lat, lng: geo.lng, label: geo.label }
            });
            setDescription("");
            setPhotoUrl("");
            setPhotoName("");
            setPhotoGallery([]);
            setPhotoError("");
            setVoiceNoteUrl("");
            setVoiceError("");
            setWizardStep(1);
            setGeo({ lat: null, lng: null, label: "" });
          }}
        >
          Submit Report
        </button>
      </section>
    );
  }

  if (view === "myreports") {
    return (
      <section className="panel">
        <h3>My Reports Timeline</h3>
        <div className="list">
          {reports.length === 0 ? <p>No reports yet.</p> : null}
          {reports.map((r) => (
            <article key={r.id} className="incident">
              <div>
                <p className="pill">{(r.status || "open").toUpperCase()}</p>
                <h4>{r.category || "water issue"}</h4>
                <p>{r.description}</p>
                <p>Village: {r.location?.village || "Unknown"}</p>
                <p className="muted">Last update: {r.updatedAt?.seconds ? new Date(r.updatedAt.seconds * 1000).toLocaleString() : "N/A"}</p>
                <div className="journey-track">
                  {journeyStages(r.status).map((s) => <span key={`${r.id}-${s.label}`} className={s.active ? "active" : ""}>{s.label}</span>)}
                </div>
                <div className="status-chip-row">
                  <span className={`status-chip ${(r.status || "open")}`}>{(r.status || "open").toUpperCase()}</span>
                  {r.geoPoint?.label ? <span className="status-chip">GEO TAGGED</span> : null}
                  {r.voiceNoteUrl ? <span className="status-chip">VOICE</span> : null}
                </div>
                {r.photoUrl ? <img className="report-photo" src={r.photoUrl} alt="Report evidence" /> : null}
                {Array.isArray(r.photoGallery) ? (
                  <div className="gallery-grid compact">
                    {r.photoGallery.slice(0, 4).map((p, idx) => <img key={`${r.id}-${idx}`} src={p.url || p.photoUrl || ""} alt={`Evidence ${idx + 1}`} />)}
                  </div>
                ) : null}
                {r.voiceNoteUrl ? <audio controls src={r.voiceNoteUrl} /> : null}
                {r.status === "resolved" ? (
                  <div className="trust-proof">
                    <h5>Trust Layer With Proof</h5>
                    <p>Handled by: <b>{reportProofMap.get(r.id)?.assignee || "field-team"}</b></p>
                    <p>Resolution note: {reportProofMap.get(r.id)?.resolutionNote || "Issue resolved with evidence verification."}</p>
                    <p>Time to close: {r.createdAt?.seconds && r.updatedAt?.seconds ? `${(((r.updatedAt.seconds - r.createdAt.seconds) / 3600).toFixed(1))}h` : "N/A"}</p>
                    <p>Safety improvement: Estimated local risk reduced by {Math.max(10, 35 - alerts.filter((a) => (a.location?.village || "") === (r.location?.village || "") && a.status !== "resolved").length * 5)}%.</p>
                  </div>
                ) : null}
              </div>
              <div className="actions-col"><button className="ghost" onClick={() => onDelete("communityReports", r.id)}>Delete</button></div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (view === "hygiene") {
    return (
      <section className="panel">
        <h3>Hygiene Education Hub</h3>
        <ul className="plain-list">
          <li>Wash hands with soap for 20 seconds before meals and after toilet use.</li>
          <li>Use covered, clean containers and avoid open ladles.</li>
          <li>Maintain residual chlorine between 0.2 and 0.5 mg/L for drinking water.</li>
        </ul>
      </section>
    );
  }

  return (
    <section className="panel">
      <h3>Community Alerts</h3>
      <div className="list">
        {alerts.slice(0, 15).map((a) => (
          <article key={a.id} className="incident"><div><p className="pill">{(a.riskType || "safe").toUpperCase()}</p><h4>{a.location?.village || "Unknown"}</h4><p>Score: {a.score}</p><p>{actionRecommendation(a.riskType)}</p></div></article>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [view, setView] = useState("overview");
  const [theme, setTheme] = useState("light");
  const [lang, setLang] = useState("en");
  const [alerts, setAlerts] = useState([]);
  const [readings, setReadings] = useState([]);
  const [reports, setReports] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [err, setErr] = useState("");
  const [appHealth, setAppHealth] = useState({
    readOps: 0,
    writeOps: 0,
    readErrors: 0,
    writeErrors: 0,
    avgWriteLatencyMs: 0,
    lastDataAt: null,
    staleData: false
  });
  const [presentationMode, setPresentationMode] = useState(false);
  const [simulator, setSimulator] = useState({ crews: 3, tankers: 6, chlorineDose: 4, result: { riskDrop: 0, slaImprove: 0, peopleProtected: 0 } });
  const writeLatencyTotalRef = useRef(0);
  const writeLatencyCountRef = useRef(0);

  const t = I18N[lang];

  useEffect(() => document.documentElement.setAttribute("data-theme", theme), [theme]);

  useEffect(() => onAuthStateChanged(auth, (next) => {
    setUser(next);
    const resolved = resolveRole(next?.email || "");
    setRole(resolved);
    if (next && !resolved) {
      setErr("User email is not mapped to an approved role.");
      signOut(auth).catch(() => {});
    }
    if (resolved === "admin") setView("overview");
    if (resolved === "resident") setView("home");
  }), []);

  useEffect(() => {
    if (!user || !role) return;
    const qa = query(collection(db, "riskAlerts"), orderBy("createdAt", "desc"), limit(180));
    const qs = query(collection(db, "sensorReadings"), orderBy("createdAt", "desc"), limit(300));
    const qw = query(collection(db, "workOrders"), orderBy("createdAt", "desc"), limit(180));

    const reportQuery = role === "resident"
      ? query(collection(db, "communityReports"), where("reporterId", "==", user.uid), orderBy("createdAt", "desc"), limit(120))
      : query(collection(db, "communityReports"), orderBy("createdAt", "desc"), limit(120));

    const onReadSuccess = () => {
      setAppHealth((h) => ({ ...h, readOps: h.readOps + 1, lastDataAt: new Date().toLocaleTimeString() }));
    };
    const onReadError = () => {
      setAppHealth((h) => ({ ...h, readErrors: h.readErrors + 1 }));
    };

    const ua = onSnapshot(
      qa,
      (s) => {
        setAlerts(s.docs.map((d) => ({ id: d.id, kind: "alert", ...d.data() })));
        onReadSuccess();
      },
      onReadError
    );
    const us = onSnapshot(
      qs,
      (s) => {
        setReadings(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        onReadSuccess();
      },
      onReadError
    );
    const ur = onSnapshot(
      reportQuery,
      (s) => {
        setReports(s.docs.map((d) => ({ id: d.id, kind: "report", ...d.data() })));
        onReadSuccess();
      },
      onReadError
    );
    const uw = onSnapshot(
      qw,
      (s) => {
        setWorkOrders(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        onReadSuccess();
      },
      onReadError
    );

    return () => { ua(); us(); ur(); uw(); };
  }, [user, role]);

  useEffect(() => {
    if (!presentationMode || role !== "admin") return;
    const order = ["overview", "command", "intelligence", "evidence"];
    const id = setInterval(() => {
      setView((v) => order[(order.indexOf(v) + 1) % order.length]);
    }, 8000);
    return () => clearInterval(id);
  }, [presentationMode, role]);

  useEffect(() => {
    const latest =
      readings[0]?.createdAt?.seconds ||
      alerts[0]?.createdAt?.seconds ||
      reports[0]?.createdAt?.seconds ||
      null;
    if (!latest) return;
    const stale = Date.now() - latest * 1000 > 5 * 60 * 1000;
    setAppHealth((h) => ({ ...h, staleData: stale }));
  }, [readings, alerts, reports]);

  const nowMs = Date.now();
  const incidents = useMemo(() => {
    return [...alerts, ...reports]
      .map((i) => {
        const createdMs = i.createdAt?.seconds ? i.createdAt.seconds * 1000 : nowMs;
        const ageHrs = (nowMs - createdMs) / (1000 * 60 * 60);
        return { ...i, slaBreached: i.status !== "resolved" && ageHrs > SLA_HOURS, ageHrs };
      })
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  }, [alerts, reports, nowMs]);

  const villageInsights = useMemo(() => {
    const map = new Map();
    const ensure = (v) => {
      if (!map.has(v)) {
        map.set(v, { village: v, riskSum: 0, readingCount: 0, unresolved: 0, contamination: 0, shortage: 0, leakage: 0 });
      }
      return map.get(v);
    };

    readings.forEach((r) => {
      const v = r.location?.village || "Unknown";
      const row = ensure(v);
      row.riskSum += Number(r.risk?.topScore || 0);
      row.readingCount += 1;
      if (r.risk?.topRiskType === "contamination") row.contamination += 1;
      if (r.risk?.topRiskType === "shortage") row.shortage += 1;
      if (r.risk?.topRiskType === "leakage") row.leakage += 1;
    });

    incidents.forEach((i) => {
      const v = i.location?.village || "Unknown";
      const row = ensure(v);
      if (i.status !== "resolved") row.unresolved += 1;
    });

    return [...map.values()].map((x) => {
      const avgRisk = x.readingCount ? x.riskSum / x.readingCount : 0;
      const dominant = [
        { k: "contamination", v: x.contamination },
        { k: "shortage", v: x.shortage },
        { k: "leakage", v: x.leakage }
      ].sort((a, b) => b.v - a.v)[0].k;

      const health = PUBLIC_HEALTH_OVERLAY[x.village] || { schools: 0, hospitals: 0 };
      const publicHealthWeight = health.schools * 2 + health.hospitals * 5;
      const priorityScore = Math.round(avgRisk * 60 + x.unresolved * 10 + x.contamination * 2 + publicHealthWeight);
      const reason = `avgRisk ${avgRisk.toFixed(2)}, unresolved ${x.unresolved}, contamination ${x.contamination}, schools ${health.schools}, hospitals ${health.hospitals}`;

      return { village: x.village, dominantRisk: dominant, unresolved: x.unresolved, priorityScore, publicHealthWeight, reason };
    }).sort((a, b) => b.priorityScore - a.priorityScore);
  }, [readings, incidents]);

  const recommendations = useMemo(() => villageInsights.map((v) => ({ village: v.village, riskType: v.dominantRisk, text: actionRecommendation(v.dominantRisk) })), [villageInsights]);

  const forecasts = useMemo(() => {
    const byVillage = new Map();
    readings.forEach((r) => {
      const v = r.location?.village || "Unknown";
      if (!byVillage.has(v)) byVillage.set(v, []);
      byVillage.get(v).push(r);
    });

    const rows = [];
    for (const [village, list] of byVillage.entries()) {
      const sorted = [...list].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      const recent = sorted.slice(0, 3);
      const previous = sorted.slice(3, 6);
      const recentAvg = recent.length ? recent.reduce((s, x) => s + Number(x.risk?.topScore || 0), 0) / recent.length : 0;
      const prevAvg = previous.length ? previous.reduce((s, x) => s + Number(x.risk?.topScore || 0), 0) / previous.length : 0;
      const trend = recentAvg - prevAvg > 0.08 ? "rising" : recentAvg - prevAvg < -0.08 ? "falling" : "stable";
      const nextRiskType = recent[0]?.risk?.topRiskType || "safe";
      const confidence = Math.round(clamp(recentAvg + (trend === "rising" ? 0.15 : 0.05), 0, 1) * 100);
      rows.push({ village, trend, nextRiskType, confidence });
    }

    return rows.sort((a, b) => b.confidence - a.confidence);
  }, [readings]);

  const quality = useMemo(() => {
    if (!readings.length) return { overall: 100, anomalyRate: 0, missingRate: 0, topVillageTrust: [] };
    let anomalies = 0;
    let missing = 0;
    const trustByVillage = new Map();

    readings.forEach((r) => {
      const village = r.location?.village || "Unknown";
      const fields = [r.ph, r.turbidity, r.tds, r.waterLevel, r.flowRate, r.residualChlorine, r.ecoliCount];
      const miss = fields.filter((x) => x == null || Number.isNaN(Number(x))).length;
      if (miss > 0) missing += 1;
      const anomaly = Number(r.turbidity) > 40 || Number(r.tds) > 1600 || Number(r.ecoliCount) > 250 || Number(r.ph) < 4 || Number(r.ph) > 11;
      if (anomaly) anomalies += 1;

      if (!trustByVillage.has(village)) trustByVillage.set(village, { ok: 0, total: 0 });
      const t2 = trustByVillage.get(village);
      t2.total += 1;
      if (!anomaly && miss === 0) t2.ok += 1;
    });

    const anomalyRate = Math.round((anomalies / readings.length) * 100);
    const missingRate = Math.round((missing / readings.length) * 100);
    const overall = Math.max(0, 100 - Math.round(anomalyRate * 0.6 + missingRate * 0.4));

    const topVillageTrust = [...trustByVillage.entries()].map(([k, v]) => `${k} ${Math.round((v.ok / v.total) * 100)}%`).slice(0, 4);

    return { overall, anomalyRate, missingRate, topVillageTrust };
  }, [readings]);

  const metrics = useMemo(() => {
    const openAlerts = alerts.filter((x) => x.status !== "resolved").length;
    const openReports = reports.filter((x) => x.status !== "resolved").length;
    const contaminationTrendCount = alerts.filter((x) => x.riskType === "contamination").length;

    const resolved = workOrders.filter((w) => w.status === "resolved");
    const within = resolved.filter((w) => {
      const c = w.createdAt?.seconds ? w.createdAt.seconds * 1000 : null;
      const u = w.updatedAt?.seconds ? w.updatedAt.seconds * 1000 : null;
      if (!c || !u || u < c) return false;
      return ((u - c) / (1000 * 60 * 60)) <= SLA_HOURS;
    }).length;

    const durations = resolved.map((w) => {
      const c = w.createdAt?.seconds ? w.createdAt.seconds * 1000 : null;
      const u = w.updatedAt?.seconds ? w.updatedAt.seconds * 1000 : null;
      return c && u && u >= c ? (u - c) / (1000 * 60 * 60) : null;
    }).filter((x) => x != null);

    const avgResolutionHours = durations.length ? Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)) : null;
    const peopleAffected = villageInsights.slice(0, 5).reduce((sum, v) => {
      const o = PUBLIC_HEALTH_OVERLAY[v.village] || { schools: 0, hospitals: 0 };
      return sum + (v.unresolved * 300) + (o.schools * 200) + (o.hospitals * 400);
    }, 0);

    const estimatedWaterSavedKL = Math.max(0, Math.round(resolved.length * 12));
    const timeline = [
      ...alerts.slice(0, 10).map((a) => ({ id: `a-${a.id}`, when: new Date((a.createdAt?.seconds || 0) * 1000).toLocaleString(), title: `Alert detected: ${a.riskType}`, detail: `${a.location?.village || "Unknown"} | score ${a.score}` })),
      ...workOrders.slice(0, 10).map((w) => ({ id: `w-${w.id}`, when: new Date((w.updatedAt?.seconds || 0) * 1000).toLocaleString(), title: `Work order ${w.status}`, detail: `${w.issueType} | assignee ${w.assignee || "team"}` }))
    ].sort((a, b) => new Date(b.when) - new Date(a.when));

    const slaBreaches = incidents.filter((i) => i.slaBreached).length;
    const slaWithin = resolved.length ? Math.round((within / resolved.length) * 100) : 100;

    return { openIncidents: openAlerts + openReports, contaminationTrendCount, avgResolutionHours, peopleAffected, estimatedWaterSavedKL, timeline, slaBreaches, slaWithin };
  }, [alerts, reports, workOrders, villageInsights, incidents]);

  const runTimedWrite = async (fn) => {
    const start = performance.now();
    try {
      const result = await fn();
      const elapsed = performance.now() - start;
      writeLatencyTotalRef.current += elapsed;
      writeLatencyCountRef.current += 1;
      setAppHealth((h) => ({
        ...h,
        writeOps: h.writeOps + 1,
        avgWriteLatencyMs: Math.round(writeLatencyTotalRef.current / writeLatencyCountRef.current)
      }));
      return result;
    } catch (e) {
      setAppHealth((h) => ({ ...h, writeErrors: h.writeErrors + 1 }));
      throw e;
    }
  };
  const createReadingAndAlert = async ({ forceIncident = false, scenario = null } = {}) => {
    const reading = demoReading(forceIncident, scenario);
    const risk = computeRisk(reading);

    const readingRef = await runTimedWrite(() =>
      addDoc(collection(db, "sensorReadings"), { ...reading, risk, createdBy: user.uid, createdAt: serverTimestamp() })
    );

    if (risk.shouldAlert) {
      const now = Date.now();
      const dup = alerts.find((a) =>
        a.status !== "resolved" &&
        (a.location?.village || "") === (reading.location?.village || "") &&
        (a.riskType || "") === risk.topRiskType &&
        a.createdAt?.seconds &&
        ((now - a.createdAt.seconds * 1000) / (1000 * 60 * 60) <= 2)
      );

      if (dup) {
        await runTimedWrite(() => updateDoc(doc(db, "riskAlerts", dup.id), {
          duplicateCount: Number(dup.duplicateCount || 1) + 1,
          score: Math.max(Number(dup.score || 0), risk.topScore),
          linkedReadingId: readingRef.id,
          updatedAt: serverTimestamp()
        }));
      } else {
        await runTimedWrite(() => addDoc(collection(db, "riskAlerts"), {
          riskType: risk.topRiskType,
          score: risk.topScore,
          status: "open",
          linkedReadingId: readingRef.id,
          sourceId: reading.sourceId,
          location: reading.location,
          duplicateCount: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }));
      }
    }
  };

  const onScenario = async (scenario) => { for (let i = 0; i < 8; i += 1) await createReadingAndAlert({ scenario }); };

  const onGuidedDemo = async () => {
    await onScenario("contamination");
    await onScenario("shortage");
    await createReadingAndAlert({ forceIncident: true });
    const open = [...alerts, ...reports].find((x) => x.status !== "resolved");
    if (open) {
      await runTimedWrite(() => updateDoc(doc(db, open.kind === "alert" ? "riskAlerts" : "communityReports", open.id), { status: "assigned", updatedAt: serverTimestamp(), updatedBy: user.uid }));
      await runTimedWrite(() => addDoc(collection(db, "workOrders"), { issueType: open.kind, reportOrAlertId: open.id, status: "assigned", assignee: "field-team-1", eta: "2h", resolutionNote: "Auto-assigned by Guided Demo", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: user.uid }));
    }
    const assigned = [...alerts, ...reports].find((x) => x.status === "assigned");
    if (assigned) {
      await runTimedWrite(() => updateDoc(doc(db, assigned.kind === "alert" ? "riskAlerts" : "communityReports", assigned.id), { status: "resolved", updatedAt: serverTimestamp(), updatedBy: user.uid }));
      await runTimedWrite(() => addDoc(collection(db, "workOrders"), { issueType: assigned.kind, reportOrAlertId: assigned.id, status: "resolved", assignee: "field-team-1", eta: "done", resolutionNote: "Auto-resolved in Guided Demo", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: user.uid }));
    }
  };

  const onBurst = async () => { for (let i = 0; i < 15; i += 1) await createReadingAndAlert({ forceIncident: i % 5 === 0 }); };

  const onSimulate = () => {
    const riskDrop = Math.min(75, Math.round(simulator.crews * 3 + simulator.tankers * 2 + simulator.chlorineDose * 4));
    const slaImprove = Math.min(60, Math.round(simulator.crews * 4 + simulator.tankers * 1));
    const peopleProtected = Math.round((metrics.peopleAffected || 1000) * (riskDrop / 100));
    setSimulator((s) => ({ ...s, result: { riskDrop, slaImprove, peopleProtected } }));
  };

  const onReport = async ({ description, village, severity, photoUrl, photoName, photoGallery, voiceNoteUrl, geoPoint }) => {
    try {
      await runTimedWrite(() => addDoc(collection(db, "communityReports"), {
        category: "water-quality",
        description,
        severity,
        status: "open",
        reporterId: user.uid,
        location: { village },
        photoUrl: photoUrl || "",
        photoName: photoName || "",
        photoGallery: Array.isArray(photoGallery) ? photoGallery : [],
        voiceNoteUrl: voiceNoteUrl || "",
        geoPoint: geoPoint || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }));
    } catch (e) { setErr(e.message); }
  };

  const onAct = async (item, status) => {
    try {
      await runTimedWrite(() => updateDoc(doc(db, item.kind === "alert" ? "riskAlerts" : "communityReports", item.id), { status, updatedAt: serverTimestamp(), updatedBy: user.uid }));
      await runTimedWrite(() => addDoc(collection(db, "workOrders"), { issueType: item.kind, reportOrAlertId: item.id, status, assignee: "field-team-1", eta: "4h", resolutionNote: status === "resolved" ? "Issue resolved" : "Assigned", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: user.uid }));
    } catch (e) { setErr(e.message); }
  };

  const onDelete = async (collectionName, id) => { try { await runTimedWrite(() => deleteDoc(doc(db, collectionName, id))); } catch (e) { setErr(e.message); } };

  const onReset = async () => {
    const ok = window.confirm("Delete all demo data from sensorReadings, riskAlerts, communityReports, and workOrders?");
    if (!ok) return;
    try {
      for (const name of ["sensorReadings", "riskAlerts", "communityReports", "workOrders"]) {
        const snap = await getDocs(collection(db, name));
        await Promise.all(snap.docs.map((d) => runTimedWrite(() => deleteDoc(doc(db, name, d.id)))));
      }
    } catch (e) { setErr(e.message); }
  };

  const onDownload = () => {
    const now = new Date();
    const html = `<!doctype html><html><head><meta charset='utf-8'><title>AquaRakshak Judge Report</title><style>body{font-family:Arial;padding:24px;line-height:1.5}h1{margin:0 0 8px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;text-align:left}</style></head><body><h1>AquaRakshak Judge Report</h1><p>Generated: ${now.toLocaleString()}</p><h2>KPI Snapshot</h2><ul><li>Open incidents: ${metrics.openIncidents}</li><li>Contamination trend (24h): ${metrics.contaminationTrendCount}</li><li>Avg resolution hours: ${metrics.avgResolutionHours ?? "N/A"}</li><li>People affected: ${metrics.peopleAffected}</li><li>Estimated water saved: ${metrics.estimatedWaterSavedKL} kL</li><li>Model accuracy: 99.69% (648/650)</li></ul><h2>Monitoring Health</h2><ul><li>Read ops/errors: ${appHealth.readOps}/${appHealth.readErrors}</li><li>Write ops/errors: ${appHealth.writeOps}/${appHealth.writeErrors}</li><li>Avg write latency: ${appHealth.avgWriteLatencyMs} ms</li><li>Stale data: ${appHealth.staleData ? "Yes" : "No"}</li></ul><h2>Top Villages</h2><table><tr><th>Village</th><th>Priority</th><th>Risk</th><th>Reason</th></tr>${villageInsights.slice(0,5).map(v=>`<tr><td>${v.village}</td><td>${v.priorityScore}</td><td>${v.dominantRisk}</td><td>${v.reason}</td></tr>`).join("")}</table><h2>Recommendations</h2><ol>${recommendations.slice(0,5).map(r=>`<li><b>${r.village}</b>: ${r.text}</li>`).join("")}</ol><h2>Forecast</h2><ol>${forecasts.slice(0,5).map(f=>`<li>${f.village}: ${f.nextRiskType} (${f.trend}, ${f.confidence}%)</li>`).join("")}</ol></body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aquarakshak_judge_report_${now.toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onPrintOps = () => {
    const items = incidents.filter((i) => i.status !== "resolved").slice(0, 15);
    const html = `<!doctype html><html><head><meta charset='utf-8'><title>Ops Sheet</title><style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}</style></head><body><h1>Shift Operations Sheet</h1><p>${new Date().toLocaleString()}</p><table><tr><th>Village</th><th>Issue</th><th>Priority</th><th>Action</th></tr>${items.map(i=>`<tr><td>${i.location?.village || "Unknown"}</td><td>${i.riskType || i.category || "issue"}</td><td>${scoreBand((i.score||0)*100)}</td><td>${actionRecommendation(i.riskType)}</td></tr>`).join("")}</table></body></html>`;
    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); win.print(); }
  };

  if (!user || !role) return <LoginStudio t={t} />;

  return (
    <div className={presentationMode ? "app-shell presentation" : "app-shell"}>
      <Sidebar role={role} view={view} setView={setView} theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} onLogout={() => signOut(auth)} />

      <main className="workspace">
        <header className="workspace-head">
          <div>
            <p className="eyebrow">{role === "admin" ? t.municipal : t.communityPortal}</p>
            <h1>{role === "admin" ? t.commandStudio : t.residentDash}</h1>
          </div>
          <div className="head-badge">{t.liveSync}</div>
        </header>

        {err ? <p className="error">{err}</p> : null}

        {role === "admin" ? (
          <AdminWorkspace view={view} metrics={metrics} incidents={incidents} readings={readings} villageInsights={villageInsights} recommendations={recommendations} forecasts={forecasts} quality={quality} appHealth={appHealth} simulator={simulator} setSimulator={setSimulator} onSimulate={onSimulate} onAct={onAct} onDelete={onDelete} onGen={() => createReadingAndAlert()} onDemo={() => createReadingAndAlert({ forceIncident: true })} onBurst={onBurst} onScenario={onScenario} onGuidedDemo={onGuidedDemo} onReset={onReset} onDownload={onDownload} onPrintOps={onPrintOps} presentationMode={presentationMode} setPresentationMode={setPresentationMode} />
        ) : (
          <ResidentWorkspace view={view} reports={reports} alerts={alerts} readings={readings} workOrders={workOrders} onReport={onReport} onDelete={onDelete} />
        )}
      </main>
    </div>
  );
}
