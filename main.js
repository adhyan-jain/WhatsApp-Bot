const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

require("dotenv").config();

const isRender = process.env.RENDER === "true";
const PORT = process.env.PORT || 3000;
const WHATSAPP_GROUP_ID = process.env.WHATSAPP_GROUP_ID;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const GITHUB_REPO = process.env.GITHUB_REPO;

console.log("Environment check:");
console.log(`- WHATSAPP_GROUP_ID: ${WHATSAPP_GROUP_ID ? "Set" : "Missing"}`);
console.log(`- GITHUB_WEBHOOK_SECRET: ${GITHUB_WEBHOOK_SECRET ? "Set" : "Missing"}`);
console.log(`- GITHUB_REPO filter: ${GITHUB_REPO || "Not configured"}`);
console.log(`- Render deployment: ${isRender ? "Yes" : "No"}`);

if (WHATSAPP_GROUP_ID && !WHATSAPP_GROUP_ID.endsWith("@g.us")) {
  console.warn("WHATSAPP_GROUP_ID usually ends with '@g.us' for groups. Double check your value.");
}

// Ensure auth directory exists so LocalAuth can bootstrap cleanly
const authDir = path.join(__dirname, ".wwebjs_auth");
if (!fs.existsSync(authDir)) {
  fs.mkdirSync(authDir, { recursive: true });
  console.log("Created .wwebjs_auth directory for session storage");
}

const app = express();

// Capture raw body for GitHub signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/", (_req, res) => {
  res.send("GitHub → WhatsApp relay is online. POST GitHub events to /github/webhook.");
});

app.get("/health", (_req, res) => {
  res.json({
    status: "running",
    whatsappReady: clientReady,
    queuedMessages: pendingMessages.length,
    targetConfigured: !!WHATSAPP_GROUP_ID,
    timestamp: new Date().toISOString(),
  });
});

function signaturesMatch(signatureHeader, rawBody) {
  if (!GITHUB_WEBHOOK_SECRET) {
    return true;
  }

  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const bodyBuffer = rawBody || Buffer.alloc(0);

  let received;
  try {
    received = Buffer.from(signatureHeader.replace("sha256=", ""), "hex");
  } catch (err) {
    console.warn("Invalid signature encoding:", err.message);
    return false;
  }

  const expected = Buffer.from(
    crypto.createHmac("sha256", GITHUB_WEBHOOK_SECRET).update(bodyBuffer).digest("hex"),
    "hex"
  );

  if (received.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(received, expected);
}

app.post("/github/webhook", async (req, res) => {
  if (!signaturesMatch(req.get("X-Hub-Signature-256"), req.rawBody)) {
    console.warn("Rejected webhook: signature mismatch");
    return res.status(401).send("Signature mismatch");
  }

  const event = req.get("X-GitHub-Event");
  const deliveryId = req.get("X-GitHub-Delivery");
  const payload = req.body;

  if (!event || !payload || !payload.repository) {
    console.warn("Rejected webhook: missing event metadata");
    return res.status(400).send("Missing event metadata");
  }

  if (GITHUB_REPO && payload.repository.full_name !== GITHUB_REPO) {
    console.log(
      `Ignoring event ${deliveryId} for ${payload.repository.full_name}; filtered by ${GITHUB_REPO}`
    );
    return res.status(202).json({ ignored: true });
  }

  console.log(`Received ${event} event (${deliveryId}) for ${payload.repository.full_name}`);

  try {
    switch (event) {
      case "issues":
        await handleIssueEvent(payload);
        break;
      case "pull_request":
        await handlePullRequestEvent(payload);
        break;
      default:
        console.log(`Event ${event} not handled; ignoring.`);
    }
  } catch (err) {
    console.error(`Failed processing ${event} event:`, err);
    return res.status(500).json({ error: "Failed to process event" });
  }

  return res.status(202).json({ ok: true });
});

const pendingMessages = [];
let clientReady = false;

async function sendMessageToGroup(message) {
  if (!message) {
    return;
  }

  try {
    if (!WHATSAPP_GROUP_ID) {
      throw new Error("WHATSAPP_GROUP_ID is not configured");
    }

    await client.sendMessage(WHATSAPP_GROUP_ID, message);
    console.log("Delivered WhatsApp notification to target group");
  } catch (err) {
    console.error("Failed to deliver WhatsApp notification:", err.message);
    throw err;
  }
}

async function queueOrSend(message) {
  if (!WHATSAPP_GROUP_ID) {
    console.warn("Cannot queue message: WHATSAPP_GROUP_ID missing");
    return;
  }

  try {
    await sendMessageToGroup(message);
  } catch (err) {
    pendingMessages.push(message);
    const reason = clientReady ? "send failure" : "client not ready";
    console.log(`Queued message due to ${reason}; will retry when possible`);
  }
}

async function flushPendingMessages() {
  if (!clientReady || pendingMessages.length === 0) {
    return;
  }

  console.log(`Flushing ${pendingMessages.length} queued messages`);
  const toDeliver = pendingMessages.splice(0, pendingMessages.length);

  for (const message of toDeliver) {
    try {
      await sendMessageToGroup(message);
    } catch (err) {
      console.error("Failed delivering queued message, re-queuing", err.message);
      pendingMessages.unshift(message);
      break;
    }
  }
}

function formatIssueMessage(action, payload) {
  const issue = payload.issue;
  if (!issue) {
    return null;
  }

  const repo = payload.repository?.full_name || "unknown repo";
  const issueUrl = issue.html_url;
  const title = issue.title;
  const number = issue.number;
  const actor = payload.sender?.login || "someone";

  switch (action) {
    case "opened":
      return `*🆕 Issue Opened* ${repo}#${number}\n• Title: ${title}\n• By: ${actor}\n🔗 ${issueUrl}`;
    case "assigned": {
      const assignee = payload.assignee?.login || "unknown";
      return `*👥 Issue Assigned* ${repo}#${number}\n• Title: ${title}\n• Assigned to: ${assignee}\n• By: ${actor}\n🔗 ${issueUrl}`;
    }
    case "unassigned": {
      const assignee = payload.assignee?.login || "someone";
      return `*♻️ Issue Unassigned* ${repo}#${number}\n• Title: ${title}\n• Removed: ${assignee}\n• By: ${actor}\n🔗 ${issueUrl}`;
    }
    case "closed": {
      const resolution = issue.state_reason || "closed";
      return `*✅ Issue ${resolution.charAt(0).toUpperCase() + resolution.slice(1)}* ${repo}#${number}\n• Title: ${title}\n• By: ${actor}\n🔗 ${issueUrl}`;
    }
    default:
      return null;
  }
}

function formatPullRequestMessage(action, payload) {
  const pr = payload.pull_request;
  if (!pr) {
    return null;
  }

  const repo = payload.repository?.full_name || "unknown repo";
  const prUrl = pr.html_url;
  const title = pr.title;
  const number = pr.number;
  const actor = payload.sender?.login || "someone";
  const branchInfo = pr.head?.ref && pr.base?.ref ? `${pr.head.ref} → ${pr.base.ref}` : null;

  switch (action) {
    case "opened": {
      const lines = [
        `*🚀 PR Opened* ${repo}#${number}`,
        `• Title: ${title}`,
        branchInfo ? `• Branches: ${branchInfo}` : null,
        `• By: ${actor}`,
        `🔗 ${prUrl}`,
      ].filter(Boolean);
      return lines.join("\n");
    }
    case "reopened": {
      return `*♻️ PR Reopened* ${repo}#${number}\n• Title: ${title}\n• By: ${actor}\n🔗 ${prUrl}`;
    }
    case "closed": {
      if (pr.merged) {
        const merger = pr.merged_by?.login || actor;
        const lines = [
          `*✅ PR Merged* ${repo}#${number}`,
          `• Title: ${title}`,
          branchInfo ? `• Branches: ${branchInfo}` : null,
          `• By: ${merger}`,
          `🔗 ${prUrl}`,
        ].filter(Boolean);
        return lines.join("\n");
      }

      return `*🛑 PR Closed* ${repo}#${number}\n• Title: ${title}\n• By: ${actor}\n🔗 ${prUrl}`;
    }
    default:
      return null;
  }
}

async function handleIssueEvent(payload) {
  const action = payload.action;
  if (!action) {
    return;
  }

  const message = formatIssueMessage(action, payload);

  if (message) {
    const issueNumber = payload.issue?.number;
    console.log(
      `Queueing WhatsApp notification for issue #${issueNumber ?? "unknown"} (${action})`
    );
    await queueOrSend(message);
  } else {
    console.log(`No WhatsApp notification for issue action '${action}', ignoring.`);
  }
}

async function handlePullRequestEvent(payload) {
  const action = payload.action;
  if (!action) {
    return;
  }

  const message = formatPullRequestMessage(action, payload);

  if (message) {
    const prNumber = payload.pull_request?.number;
    console.log(`Queueing WhatsApp notification for PR #${prNumber ?? "unknown"} (${action})`);
    await queueOrSend(message);
  } else {
    console.log(`No WhatsApp notification for PR action '${action}', ignoring.`);
  }
}

const puppeteerConfig = {
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--disable-gpu",
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-blink-features=AutomationControlled",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ],
};

if (isRender || process.env.DOCKER) {
  puppeteerConfig.executablePath = "/usr/bin/chromium";
  console.log("Using system Chromium");
}

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "./.wwebjs_auth",
  }),
  puppeteer: puppeteerConfig,
  webVersionCache: {
    type: "remote",
    remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
  },
  qrMaxRetries: 5,
  restartOnAuthFail: true,
  takeoverOnConflict: true,
  takeoverTimeoutMs: 0,
});

client.on("qr", (qr) => {
  console.log("\nScan this QR code to log in:");
  console.log("=".repeat(50));
  qrcode.generate(qr, { small: true });
  console.log("=".repeat(50));
  console.log("\nWaiting for QR code scan...\n");
});

client.on("authenticated", () => {
  console.log("Authentication successful!");
});

client.on("auth_failure", (msg) => {
  console.error("Authentication failure:", msg);
});

client.on("ready", async () => {
  console.log("=".repeat(50));
  console.log("WhatsApp client is ready!");
  console.log(`Your number: ${client.info.wid._serialized}`);
  console.log(`Your name: ${client.info.pushname}`);
  console.log("=".repeat(50));
  clientReady = true;

  await flushPendingMessages();
});

client.on("disconnected", (reason) => {
  console.warn("WhatsApp client disconnected:", reason);
  clientReady = false;
});

client.on("loading_screen", (percent, message) => {
  console.log(`Loading: ${percent}% - ${message}`);
});

client.initialize().catch((err) => {
  console.error("Failed to initialize WhatsApp client:", err);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, destroying client...");
  try {
    await client.destroy();
  } catch (err) {
    console.error("Error destroying client:", err);
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, destroying client...");
  try {
    await client.destroy();
  } catch (err) {
    console.error("Error destroying client:", err);
  }
  process.exit(0);
});
