import { randomUUID } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, serverTimestamp } from "./firebase.js";
import { computeRisk } from "./riskEngine.js";

function mustAuth(req) {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required");
}

function mustAdmin(req) {
  mustAuth(req);
  if (req.auth.token?.role !== "admin") throw new HttpsError("permission-denied", "Admin required");
}

async function recentBySource(sourceId, n = 10) {
  const snap = await db.collection("sensorReadings").where("sourceId", "==", sourceId).orderBy("timestamp", "desc").limit(n).get();
  return snap.docs.map((d) => d.data());
}

async function ingestCore(payload, uid) {
  if (!payload?.sourceId || !payload?.location) {
    throw new HttpsError("invalid-argument", "sourceId and location required");
  }

  const reading = {
    sourceId: payload.sourceId,
    location: payload.location,
    timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date(),
    ph: Number(payload.ph),
    turbidity: Number(payload.turbidity),
    tds: Number(payload.tds),
    waterLevel: Number(payload.waterLevel),
    flowRate: Number(payload.flowRate),
    createdBy: uid,
    createdAt: serverTimestamp()
  };

  const hist = await recentBySource(reading.sourceId);
  const risk = computeRisk(reading, hist);

  const readingRef = await db.collection("sensorReadings").add({ ...reading, risk });
  let alertDocId = null;

  if (risk.shouldAlert) {
    const alertRef = await db.collection("riskAlerts").add({
      alertId: randomUUID(),
      riskType: risk.topRiskType,
      score: risk.topScore,
      status: "open",
      sourceId: reading.sourceId,
      linkedReadingId: readingRef.id,
      location: reading.location,
      components: risk.components,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    alertDocId = alertRef.id;
  }

  return { readingDocId: readingRef.id, alertDocId, risk };
}

export const ingestSensorReading = onCall(async (req) => {
  mustAdmin(req);
  return ingestCore(req.data, req.auth.uid);
});

export const createCommunityReport = onCall(async (req) => {
  mustAuth(req);
  const d = req.data || {};
  if (!d.description?.trim()) throw new HttpsError("invalid-argument", "description required");

  const payload = {
    reportId: randomUUID(),
    category: d.category || "water-quality",
    description: d.description.trim(),
    photoUrl: d.photoUrl || null,
    geoPoint: d.geoPoint || null,
    severity: d.severity || "medium",
    status: "open",
    reporterId: req.auth.uid,
    location: d.location || { village: "Unknown" },
    linkedAlertId: d.linkedAlertId || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const ref = await db.collection("communityReports").add(payload);
  return { reportDocId: ref.id, reportId: payload.reportId, status: payload.status };
});

export const updateIssueStatus = onCall(async (req) => {
  mustAdmin(req);
  const d = req.data || {};
  if (!d.issueType || !d.docId || !d.status) throw new HttpsError("invalid-argument", "issueType/docId/status required");

  const col = d.issueType === "alert" ? "riskAlerts" : "communityReports";
  await db.collection(col).doc(d.docId).update({
    status: d.status,
    assignee: d.assignee || null,
    eta: d.eta || null,
    resolutionNote: d.note || null,
    proofPhoto: d.proofPhoto || null,
    updatedAt: serverTimestamp(),
    updatedBy: req.auth.uid
  });

  await db.collection("workOrders").add({
    workOrderId: randomUUID(),
    reportOrAlertId: d.docId,
    issueType: d.issueType,
    assignee: d.assignee || "field-team",
    eta: d.eta || null,
    status: d.status,
    resolutionNote: d.note || null,
    proofPhoto: d.proofPhoto || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: req.auth.uid
  });

  return { ok: true };
});

export const getDashboardMetrics = onCall(async (req) => {
  mustAuth(req);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [a, r, s, w] = await Promise.all([
    db.collection("riskAlerts").where("createdAt", ">=", since).get(),
    db.collection("communityReports").where("createdAt", ">=", since).get(),
    db.collection("sensorReadings").where("timestamp", ">=", since).get(),
    db.collection("workOrders").where("status", "==", "resolved").get()
  ]);

  const openAlerts = a.docs.filter((d) => d.data().status !== "resolved").length;
  const openReports = r.docs.filter((d) => d.data().status !== "resolved").length;
  const contaminationTrendCount = s.docs.map((d) => d.data()).filter((x) => x.risk?.topRiskType === "contamination").length;

  const durs = w.docs.map((d) => d.data()).map((x) => {
    const c = x.createdAt?.toDate?.()?.getTime();
    const u = x.updatedAt?.toDate?.()?.getTime();
    return c && u && u >= c ? (u - c) / (1000 * 60 * 60) : null;
  }).filter((x) => x != null);

  const avgResolutionHours = durs.length ? Number((durs.reduce((m, n) => m + n, 0) / durs.length).toFixed(2)) : null;

  return {
    period: "24h",
    openIncidents: openAlerts + openReports,
    openAlerts,
    openReports,
    contaminationTrendCount,
    avgResolutionHours
  };
});

export const generateSimulatedReading = onCall(async (req) => {
  mustAdmin(req);
  const d = req.data || {};
  const reading = {
    sourceId: d.sourceId || "sim-node-001",
    location: d.location || { village: "Kothapally", district: "Demo" },
    timestamp: new Date().toISOString(),
    ph: Number((6.8 + Math.random() * 2.6).toFixed(2)),
    turbidity: Number((2 + Math.random() * 16).toFixed(2)),
    tds: Number((250 + Math.random() * 760).toFixed(2)),
    waterLevel: Number((10 + Math.random() * 70).toFixed(2)),
    flowRate: Number((0.2 + Math.random() * 4).toFixed(2))
  };

  const result = await ingestCore(reading, req.auth.uid);
  return { generated: reading, ...result };
});

export const triggerDemoIncident = onCall(async (req) => {
  mustAdmin(req);
  const reading = {
    sourceId: "sim-node-001",
    location: { village: "Kothapally", district: "Demo" },
    timestamp: new Date().toISOString(),
    ph: 9.7,
    turbidity: 14,
    tds: 860,
    waterLevel: 24,
    flowRate: 1.1
  };
  return ingestCore(reading, req.auth.uid);
});
