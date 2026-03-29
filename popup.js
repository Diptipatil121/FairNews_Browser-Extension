const BASE_URL =
  "https://twiki-risks-ids-spyware.trycloudflare.com"; // change if tunnel changes

const button = document.getElementById("analyzeBtn");

const statusCard = document.getElementById("statusCard");
const resultCard = document.getElementById("resultCard");

const statusText = document.getElementById("status");
const statusDetail = document.getElementById("statusDetail");
const spinnerEl = document.getElementById("spinner");
const biasScoreEl = document.getElementById("biasScore");
const biasPercentEl = document.getElementById("biasPercent");
const biasTextEl = document.getElementById("biasText");
const gaugeNeedleEl = document.getElementById("gaugeNeedle");
const biasLabelEl = document.getElementById("biasLabel");
const errorEl = document.getElementById("error");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// POST /api/pipeline  → create job
async function createJob(url) {
  const response = await fetch(`${BASE_URL}/api/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }), // ✅ SEND URL, NOT TEXT
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Create job failed: ${response.status} ${errText}`);
  }

  return await response.json();
}

// GET /api/pipeline/jobs/{job_id}
async function getJobStatus(jobId) {
  const response = await fetch(
    `${BASE_URL}/api/pipeline/${encodeURIComponent(jobId)}`
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Status fetch failed: ${response.status} ${errText}`);
  }

  return await response.json();
}

async function pollJob(jobId) {
  const timeoutMs = 300000;
  const intervalMs = 3000;
  const start = Date.now();

  while (true) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Polling timed out");
    }

    const data = await getJobStatus(jobId);

    statusCard.style.display = "block";
    statusText.textContent = `${data.status} (${data.step || "processing"})`;
    statusDetail.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;

    if (data.status === "completed") {
      return data.result;
    }

    if (data.status === "failed") {
      throw new Error(data.error || "Job failed");
    }

    await sleep(intervalMs);
  }
}

function renderGaugeTicks() {
  const ticksContainer = document.getElementById("gaugeTicks");
  if (!ticksContainer) return;

  const centerX = 70;
  const centerY = 70;
  const radius = 60;
  const tickLength = 6;

  for (let value = -10; value <= 10; value += 1) {
    // keep only -10, 0, 10 labels
    if (value !== -10 && value !== 0 && value !== 10) continue;

    const angle = (180 - (value + 10) * 9) * (Math.PI / 180);
    const xOuter = centerX + Math.cos(angle) * radius;
    const yOuter = centerY - Math.sin(angle) * radius;
    const xInner = centerX + Math.cos(angle) * (radius - tickLength);
    const yInner = centerY - Math.sin(angle) * (radius - tickLength);

    const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tick.setAttribute("x1", xOuter.toString());
    tick.setAttribute("y1", yOuter.toString());
    tick.setAttribute("x2", xInner.toString());
    tick.setAttribute("y2", yInner.toString());
    tick.setAttribute("stroke", "rgba(15, 23, 42, 0.15)");
    tick.setAttribute("stroke-width", "2");
    ticksContainer.appendChild(tick);

    // only show labels for allowed values and avoid duplication if needed
    if (value % 2 !== 0) continue;

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const labelRadius = radius - 20;
    const xLabel = centerX + Math.cos(angle) * labelRadius;
    const yLabel = centerY - Math.sin(angle) * labelRadius;

    label.setAttribute("x", xLabel.toString());
    label.setAttribute("y", yLabel.toString());
    label.setAttribute("class", "gauge-label");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "central");
    label.textContent = String(value);
    ticksContainer.appendChild(label);
  }
}

function formatLegalScore(score) {
  if (score == null || Number.isNaN(score)) return "N/A";
  const num = Number(score);
  if (Math.abs(num) <= 10) {
    return Number.isFinite(num) ? num.toFixed(2) : "N/A";
  }
  return "N/A";
}

function getBiasCategory(score) {
  if (score == null || Number.isNaN(score)) return "Unknown";
  if (score <= -6) return "Strongly Liberal";
  if (score < -2) return "Moderately Liberal";
  if (score <= 2) return "Balanced";
  if (score < 6) return "Moderately Conservative";
  return "Strongly Conservative";
}

function formatPercent(score) {
  if (score == null || Number.isNaN(score)) return "—";
  const n = Number(score);
  return `${n > 0 ? "+" : ""}${n}%`;
}

function updateGauge(score) {
  if (!gaugeNeedleEl) return;

  const max = 10;
  const min = -10;

  if (score == null || Number.isNaN(score)) {
    const resetAngle = 90;
    gaugeNeedleEl.style.setProperty("--target-angle", `${resetAngle}deg`);
    gaugeNeedleEl.style.setProperty("--last-angle", `${resetAngle}deg`);
    gaugeNeedleEl.classList.add("small-bump");
    gaugeNeedleEl.style.transform = `rotate(${resetAngle}deg)`;
    gaugeNeedleEl.style.stroke = "rgba(15, 23, 42, 0.6)";
    setTimeout(() => gaugeNeedleEl.classList.remove("small-bump"), 900);
    return;
  }

  const clamped = Math.max(min, Math.min(max, Number(score)));

  // Needle starts pointing straight up (0). Negative scores move left, positive scores move right.
  // We map -10..10 to -90..90 degrees from vertical.
  const angle = (clamped / max) * 90;

  const lastAngle = gaugeNeedleEl._lastAngle ?? 0;
  gaugeNeedleEl.style.setProperty("--target-angle", `${angle}deg`);
  gaugeNeedleEl.style.setProperty("--last-angle", `${lastAngle}deg`);

  gaugeNeedleEl._lastAngle = angle;

  gaugeNeedleEl.classList.add("small-bump");
  setTimeout(() => gaugeNeedleEl.classList.remove("small-bump"), 900);

  gaugeNeedleEl.style.transform = `rotate(${angle}deg)`;
  gaugeNeedleEl.style.stroke = clamped >= 0 ? "rgba(34, 197, 94, 0.85)" : "rgba(239, 68, 68, 0.85)";
}

// Render numeric ticks once on load (0..10 and 0..-10)
renderGaugeTicks();

button.addEventListener("click", async () => {
  errorEl.textContent = "";
  statusDetail.textContent = "Ready to analyze";
  resultCard.style.display = "none";
  statusCard.style.display = "block";
  statusText.textContent = "Getting page URL...";
  button.disabled = true;

  try {
    // show spinner while work is in progress
    spinnerEl.classList.add("active");
    updateGauge(null);

    // ✅ Get current tab URL (NOT page text)
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    const currentUrl = tab.url;

    if (!currentUrl) {
      throw new Error("Could not detect page URL.");
    }

    statusText.textContent = "Creating analysis job...";

    const job = await createJob(currentUrl);

    statusText.textContent = `Job created (${job.status})`;

    const finalResult = await pollJob(job.job_id);

    // ✅ Show result
    resultCard.style.display = "block";

    // Display the score exactly as received from the backend (no percent conversion)
    const score = finalResult?.aggregate_score ?? null;
    const label = finalResult?.aggregate_label || "Unknown";

    biasScoreEl.textContent = formatLegalScore(score);
    biasPercentEl.textContent = formatPercent(score);
    biasTextEl.textContent = getBiasCategory(score);

    biasLabelEl.textContent = label;
    biasLabelEl.classList.toggle("unknown", label === "Unknown");

    updateGauge(score);

    statusText.textContent = "Completed";
    statusCard.style.display = "none";
  } catch (error) {
    statusText.textContent = "Failed";
    errorEl.textContent =
      error.message || "Something went wrong";
    biasPercentEl.textContent = "—";
    biasTextEl.textContent = "Unknown";
    biasScoreEl.textContent = "N/A";
    biasLabelEl.textContent = "Unknown";
    biasLabelEl.classList.add("unknown");
    updateGauge(null);
    // keep status visible on failure, hide only when success provides final results
  } finally {
    button.disabled = false;
    spinnerEl.classList.remove("active");
  }
});