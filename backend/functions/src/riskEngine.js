const BANDS = {
  ph: { min: 6.5, max: 8.5 },
  turbidity: { max: 5 },
  tds: { max: 500 },
  waterLevel: { min: 20 },
  flowRate: { min: 1 }
};

const ALERT_THRESHOLD = 0.62;

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

const scorePH = (ph) => {
  if (ph == null) return 0;
  if (ph >= BANDS.ph.min && ph <= BANDS.ph.max) return 0;
  const d = ph < BANDS.ph.min ? BANDS.ph.min - ph : ph - BANDS.ph.max;
  return clamp(d / 3);
};

const scoreTurbidity = (t) => (t > BANDS.turbidity.max ? clamp((t - BANDS.turbidity.max) / 20) : 0);
const scoreTds = (tds) => (tds > BANDS.tds.max ? clamp((tds - BANDS.tds.max) / 1500) : 0);
const scoreShortage = (level) => (level < BANDS.waterLevel.min ? clamp((BANDS.waterLevel.min - level) / BANDS.waterLevel.min) : 0);

function scoreLeakage(flowRate, levelDrop) {
  let s = 0;
  if (flowRate != null && flowRate < BANDS.flowRate.min) s += clamp((BANDS.flowRate.min - flowRate) / BANDS.flowRate.min) * 0.5;
  if (levelDrop != null && levelDrop > 2.5) s += clamp((levelDrop - 2.5) / 6) * 0.5;
  return clamp(s);
}

export function computeRisk(current, history = []) {
  const contamination = clamp(scorePH(current.ph) * 0.4 + scoreTurbidity(current.turbidity) * 0.35 + scoreTds(current.tds) * 0.25);
  const shortage = scoreShortage(current.waterLevel);
  const prev = history[0];
  const levelDrop = prev?.waterLevel != null ? prev.waterLevel - current.waterLevel : 0;
  const leakage = scoreLeakage(current.flowRate, levelDrop);

  const candidates = [
    { riskType: "contamination", score: contamination },
    { riskType: "shortage", score: shortage },
    { riskType: "leakage", score: leakage }
  ].sort((a, b) => b.score - a.score);

  const top = candidates[0];
  return {
    topRiskType: top.riskType,
    topScore: Number(top.score.toFixed(3)),
    shouldAlert: top.score >= ALERT_THRESHOLD,
    components: {
      contamination: Number(contamination.toFixed(3)),
      shortage: Number(shortage.toFixed(3)),
      leakage: Number(leakage.toFixed(3))
    }
  };
}
