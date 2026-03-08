import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

function mkReading(i) {
  const anomaly = i % 6 === 0;
  return {
    sourceId: "sim-node-001",
    location: { village: "Kothapally", district: "Demo" },
    timestamp: new Date(Date.now() - (80 - i) * 60000),
    ph: anomaly ? 9.2 : 7 + Math.random() * 0.8,
    turbidity: anomaly ? 12 + Math.random() * 4 : 2 + Math.random() * 2,
    tds: anomaly ? 780 + Math.random() * 80 : 280 + Math.random() * 120,
    waterLevel: anomaly ? 18 + Math.random() * 4 : 40 + Math.random() * 20,
    flowRate: anomaly ? 0.6 + Math.random() * 0.4 : 1.2 + Math.random() * 1.5
  };
}

async function seed() {
  for (let i = 0; i < 80; i++) {
    await db.collection("sensorReadings").add(mkReading(i));
  }
  console.log("Seeded 80 sensor readings.");
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
