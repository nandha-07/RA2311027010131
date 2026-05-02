const express = require("express");
const axios = require("axios");
const { Log, setToken } = require("../logging_middleware/index");
require("dotenv").config();

const app = express();
app.use(express.json());

let currentToken = null;

// ─── Auto-refresh Token ───────────────────────────────────────────────────────
async function refreshToken() {
  try {
    const res = await axios.post(
      "http://20.207.122.201/evaluation-service/auth",
      {
        email: "nk8291@srmist.edu.in",
        name: "Nandha Kumar K",
        rollNo: "RA2311027010131",
        accessCode: "QkbpxH",
        clientID: "885ce191-ab7a-4205-85e0-a46888dc58dd",
        clientSecret: "VjccZWwgGcaMZbfz",
      }
    );
    currentToken = res.data.access_token;
    setToken(currentToken);
    console.log("[Auth] Token refreshed successfully");
    setTimeout(refreshToken, 10 * 60 * 1000);
  } catch (err) {
    console.error("[Auth] Token refresh failed:", err.message);
    setTimeout(refreshToken, 60 * 1000);
  }
}

// ─── Fetch Depots from Test Server ───────────────────────────────────────────
async function fetchDepots() {
  const res = await axios.get(
    "http://20.207.122.201/evaluation-service/depots",
    { headers: { Authorization: `Bearer ${currentToken}` } }
  );
  return res.data.depots;
}

// ─── Fetch Vehicles from Test Server ─────────────────────────────────────────
async function fetchVehicles() {
  const res = await axios.get(
    "http://20.207.122.201/evaluation-service/vehicles",
    { headers: { Authorization: `Bearer ${currentToken}` } }
  );
  return res.data.vehicles;
}

// ─── 0/1 Knapsack Algorithm ───────────────────────────────────────────────────
function knapsack(vehicles, capacity) {
  const n = vehicles.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const { Duration, Impact } = vehicles[i - 1];
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (Duration <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - Duration] + Impact);
      }
    }
  }

  // Traceback selected vehicles
  const selected = [];
  let w = capacity;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(vehicles[i - 1]);
      w -= vehicles[i - 1].Duration;
    }
  }

  return { maxImpact: dp[n][capacity], selectedVehicles: selected };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /depots
app.get("/depots", async (req, res) => {
  try {
    await Log("backend", "info", "route", "Fetching depots from test server");
    const depots = await fetchDepots();
    await Log("backend", "info", "service", `Fetched ${depots.length} depots`);
    res.json({ depots });
  } catch (err) {
    await Log("backend", "error", "service", `Failed to fetch depots: ${err.message}`);
    res.status(500).json({ message: "Failed to fetch depots", error: err.message });
  }
});

// GET /vehicles
app.get("/vehicles", async (req, res) => {
  try {
    await Log("backend", "info", "route", "Fetching vehicles from test server");
    const vehicles = await fetchVehicles();
    await Log("backend", "info", "service", `Fetched ${vehicles.length} vehicles`);
    res.json({ vehicles });
  } catch (err) {
    await Log("backend", "error", "service", `Failed to fetch vehicles: ${err.message}`);
    res.status(500).json({ message: "Failed to fetch vehicles", error: err.message });
  }
});

// GET /schedule - optimize all depots
app.get("/schedule", async (req, res) => {
  try {
    await Log("backend", "info", "route", "Starting schedule optimization for all depots");
    const [depots, vehicles] = await Promise.all([fetchDepots(), fetchVehicles()]);
    await Log("backend", "info", "service", `Loaded ${depots.length} depots and ${vehicles.length} vehicles`);

    const results = depots.map((depot) => {
      const { maxImpact, selectedVehicles } = knapsack(vehicles, depot.MechanicHours);
      return {
        depotID: depot.ID,
        mechanicHours: depot.MechanicHours,
        maxImpact,
        totalDuration: selectedVehicles.reduce((sum, v) => sum + v.Duration, 0),
        selectedVehicles: selectedVehicles.map((v) => v.TaskID),
        count: selectedVehicles.length,
      };
    });

    await Log("backend", "info", "service", `Optimization complete for ${results.length} depots`);
    res.json({ schedule: results });
  } catch (err) {
    await Log("backend", "fatal", "service", `Schedule optimization failed: ${err.message}`);
    res.status(500).json({ message: "Optimization failed", error: err.message });
  }
});

// GET /schedule/:depotId - optimize one depot
app.get("/schedule/:depotId", async (req, res) => {
  try {
    const depotId = parseInt(req.params.depotId);
    await Log("backend", "info", "route", `Fetching schedule for depot ${depotId}`);
    const [depots, vehicles] = await Promise.all([fetchDepots(), fetchVehicles()]);
    const depot = depots.find((d) => d.ID === depotId);

    if (!depot) {
      await Log("backend", "error", "controller", `Depot ${depotId} not found`);
      return res.status(404).json({ message: "Depot not found" });
    }

    const { maxImpact, selectedVehicles } = knapsack(vehicles, depot.MechanicHours);
    await Log("backend", "info", "service", `Depot ${depotId}: max impact ${maxImpact} using ${selectedVehicles.length} vehicles`);

    res.json({
      depotID: depot.ID,
      mechanicHours: depot.MechanicHours,
      maxImpact,
      totalDuration: selectedVehicles.reduce((sum, v) => sum + v.Duration, 0),
      selectedVehicles: selectedVehicles.map((v) => v.TaskID),
      count: selectedVehicles.length,
    });
  } catch (err) {
    await Log("backend", "error", "handler", `Error scheduling depot: ${err.message}`);
    res.status(500).json({ message: "Error", error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

refreshToken().then(() => {
  app.listen(PORT, async () => {
    await Log("backend", "info", "middleware", `Vehicle Maintenance Scheduler running on port ${PORT}`);
    console.log(`Server running on port ${PORT}`);
  });
});