const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

require("dotenv").config();

// Environment configuration
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

// Ensure auth directory exists
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
  res.send("WhatsApp Bot with GitHub integration is online. POST GitHub events to /github/webhook.");
});

app.get("/health", (_req, res) => {
  res.json({
    status: "running",
    whatsappReady: clientReady,
    queuedMessages: pendingMessages.length,
    targetConfigured: !!WHATSAPP_GROUP_ID,
    openIssues: issuesStore.open.length,
    closedIssues: issuesStore.closed.length,
    timestamp: new Date().toISOString(),
  });
});

// GitHub webhook signature verification
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

// GitHub webhook endpoint
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
        await handleGitHubIssueEvent(payload);
        break;
      case "pull_request":
        await handlePullRequestEvent(payload);
        break;
      case "issue_comment":
        await handleIssueCommentEvent(payload);
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

// Message queue system
const pendingMessages = [];
let clientReady = false;
let flushTimer = null;
const RETRY_DELAY_MS = 5000;

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
    scheduleFlush();
  }
}

async function flushPendingMessages() {
  if (!clientReady || pendingMessages.length === 0) {
    if (pendingMessages.length === 0 && flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
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
      scheduleFlush();
      break;
    }
  }
}

function scheduleFlush() {
  if (flushTimer || pendingMessages.length === 0) {
    return;
  }

  flushTimer = setTimeout(async () => {
    flushTimer = null;
    try {
      await flushPendingMessages();
    } catch (err) {
      console.error("Error while flushing queued messages:", err.message);
      scheduleFlush();
    }
  }, RETRY_DELAY_MS);
}

// GitHub event formatters
function formatGitHubIssueMessage(action, payload) {
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
      return `*🆕 GitHub Issue Opened* ${repo}#${number}\n• Title: ${title}\n• By: ${actor}\n🔗 ${issueUrl}`;
    case "assigned": {
      const assignee = payload.assignee?.login || "unknown";
      return `*👥 GitHub Issue Assigned* ${repo}#${number}\n• Title: ${title}\n• Assigned to: ${assignee}\n• By: ${actor}\n🔗 ${issueUrl}`;
    }
    case "unassigned": {
      const assignee = payload.assignee?.login || "someone";
      return `*♻️ GitHub Issue Unassigned* ${repo}#${number}\n• Title: ${title}\n• Removed: ${assignee}\n• By: ${actor}\n🔗 ${issueUrl}`;
    }
    case "closed": {
      const resolution = issue.state_reason || "closed";
      return `*✅ GitHub Issue ${resolution.charAt(0).toUpperCase() + resolution.slice(1)}* ${repo}#${number}\n• Title: ${title}\n• By: ${actor}\n🔗 ${issueUrl}`;
    }
    case "reopened": {
      return `*♻️ GitHub Issue Reopened* ${repo}#${number}\n• Title: ${title}\n• By: ${actor}\n🔗 ${issueUrl}`;
    }
    case "edited": {
      return `*✏️ GitHub Issue Edited* ${repo}#${number}\n• Title: ${title}\n• By: ${actor}\n🔗 ${issueUrl}`;
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
    case "edited": {
      return `*✏️ PR Edited* ${repo}#${number}\n• Title: ${title}\n• By: ${actor}\n🔗 ${prUrl}`;
    }
    case "review_requested": {
      const reviewer = payload.requested_reviewer?.login || "someone";
      return `*👀 PR Review Requested* ${repo}#${number}\n• Title: ${title}\n• Reviewer: ${reviewer}\n• By: ${actor}\n🔗 ${prUrl}`;
    }
    default:
      return null;
  }
}

function formatIssueCommentMessage(action, payload) {
  const issue = payload.issue;
  const comment = payload.comment;
  if (!issue || !comment) {
    return null;
  }

  const repo = payload.repository?.full_name || "unknown repo";
  const issueNumber = issue.number;
  const issueTitle = issue.title;
  const commentAuthor = comment.user?.login || "someone";
  const actor = payload.sender?.login || commentAuthor;
  const commentUrl = comment.html_url;

  const baseLines = [
    `*💬 Issue Comment* ${repo}#${issueNumber}`,
    `• Title: ${issueTitle}`,
    `• Comment by: ${commentAuthor}`,
    `• Triggered by: ${actor}`,
    `🔗 ${commentUrl}`,
  ];

  if (action === "created") {
    const snippet = comment.body?.trim().split("\n").slice(0, 3).join("\n");
    if (snippet) {
      baseLines.splice(4, 0, `• Preview: ${snippet.length > 200 ? `${snippet.slice(0, 197)}...` : snippet}`);
    }
    return baseLines.join("\n");
  }

  if (action === "edited") {
    baseLines.splice(4, 0, "• Comment was edited");
    return baseLines.join("\n");
  }

  if (action === "deleted") {
    return `*🗑️ Issue Comment Deleted* ${repo}#${issueNumber}\n• Deleted by: ${actor}\n🔗 ${commentUrl}`;
  }

  return null;
}

// GitHub event handlers
async function handleGitHubIssueEvent(payload) {
  const action = payload.action;
  if (!action) {
    return;
  }

  const message = formatGitHubIssueMessage(action, payload);

  if (message) {
    const issueNumber = payload.issue?.number;
    console.log(
      `Queueing WhatsApp notification for GitHub issue #${issueNumber ?? "unknown"} (${action})`
    );
    await queueOrSend(message);
    scheduleFlush();
    
    // Auto-create local issue when GitHub issue is opened
    if (action === "opened" && payload.issue) {
      const title = `[GitHub #${payload.issue.number}] ${payload.issue.title}`;
      await addIssue(title);
      console.log(`Auto-created local issue from GitHub issue #${payload.issue.number}`);
    }
    
    // Auto-close local issue when GitHub issue is closed
    if (action === "closed" && payload.issue) {
      const githubIssueNumber = payload.issue.number;
      const localIssue = issuesStore.open.find(i => i.title.includes(`[GitHub #${githubIssueNumber}]`));
      if (localIssue) {
        await closeIssue(localIssue.id);
        console.log(`Auto-closed local issue #${localIssue.id} from GitHub issue #${githubIssueNumber}`);
      }
    }
    
    // Auto-reopen local issue when GitHub issue is reopened
    if (action === "reopened" && payload.issue) {
      const githubIssueNumber = payload.issue.number;
      const localIssue = issuesStore.closed.find(i => i.title.includes(`[GitHub #${githubIssueNumber}]`));
      if (localIssue) {
        await reopenIssue(localIssue.id);
        console.log(`Auto-reopened local issue #${localIssue.id} from GitHub issue #${githubIssueNumber}`);
      }
    }
  } else {
    console.log(`No WhatsApp notification for GitHub issue action '${action}', ignoring.`);
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
    scheduleFlush();
  } else {
    console.log(`No WhatsApp notification for PR action '${action}', ignoring.`);
  }
}

async function handleIssueCommentEvent(payload) {
  const action = payload.action;
  if (!action) {
    return;
  }

  const message = formatIssueCommentMessage(action, payload);

  if (message) {
    const issueNumber = payload.issue?.number;
    console.log(
      `Queueing WhatsApp notification for issue comment on #${issueNumber ?? "unknown"} (${action})`
    );
    await queueOrSend(message);
    scheduleFlush();
  } else {
    console.log(`No WhatsApp notification for issue_comment action '${action}', ignoring.`);
  }
}

// Puppeteer configuration
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

// WhatsApp client event handlers
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
  console.log(`Storage: In-Memory (non-persistent)`);
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

async function getDisplayName(id) {
  try {
    const contact = await client.getContactById(id);
    if (contact) {
      return contact.pushname || contact.number || id;
    }
  } catch (e) {
    console.error(`Error getting display name for ${id}:`, e);
  }
  return id;
}

function formatTimestamp(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// In-memory data storage
let issuesStore = { open: [], closed: [], nextId: 1 };

// Issue management functions
async function addIssue(title) {
  console.log(`Creating issue: "${title}"`);
  const newIssue = {
    id: String(issuesStore.nextId++),
    title,
    assignedNames: [],
    createdAt: formatTimestamp(new Date()),
    deadline: "",
  };
  issuesStore.open.push(newIssue);
  console.log(`Issue created with ID: ${newIssue.id}`);
  console.log(`Current open issues count: ${issuesStore.open.length}`);
  return newIssue;
}

async function listIssues() {
  return issuesStore.open;
}

async function listClosedIssues() {
  return issuesStore.closed;
}

async function getIssuesAssignedTo(userName) {
  return issuesStore.open.filter(
    (i) => i.assignedNames && i.assignedNames.includes(userName)
  );
}

async function assignIssue(id, userNames) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;
  
  userNames.forEach((userName) => {
    if (!issue.assignedNames.includes(userName)) {
      issue.assignedNames.push(userName);
    }
  });
  
  return true;
}

async function unassignIssue(id) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;
  issue.assignedNames = [];
  return true;
}

async function updateIssue(id, newTitle) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;
  issue.title = newTitle;
  return true;
}

async function setDeadline(id, deadline) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;
  issue.deadline = deadline;
  return true;
}

async function closeIssue(id) {
  const idx = issuesStore.open.findIndex((i) => i.id === id);
  if (idx === -1) return false;
  
  const issue = issuesStore.open.splice(idx, 1)[0];
  issuesStore.closed.push(issue);
  
  return true;
}

async function reopenIssue(id) {
  const idx = issuesStore.closed.findIndex((i) => i.id === id);
  if (idx === -1) return false;
  
  const issue = issuesStore.closed.splice(idx, 1)[0];
  issuesStore.open.push(issue);
  
  return true;
}

// Message handler
client.on("message_create", async (msg) => {
  if (msg.from === "status@broadcast") return;

  console.log(
    `From: ${msg.from} | Body: ${msg.body.substring(0, 50)}${
      msg.body.length > 50 ? "..." : ""
    }`
  );
  
  if (msg.body === "$help") {
    const helpText = `*Bot Commands*

📋 *Issue Tracker:*
$issue add <title> - Create a new issue
$issue list - List all open issues
$issue closed - List all closed issues
$issue my - List your assigned issues
$issue assign <id> self - Assign issue to yourself
$issue assign <id> @mention - Assign to mentioned person
$issue unassign <id> - Remove all assignments
$issue update <id> <new title> - Update issue title
$issue deadline <id> <YYYY-MM-DD> - Set deadline
$issue deadline <id> remove - Remove deadline
$issue complete <id> - Mark issue as complete
$issue reopen <id> - Reopen a closed issue

🔔 *GitHub Integration:*
GitHub events are automatically posted when configured:
- Issue opened/closed/assigned/reopened
- Pull request opened/merged/closed
- Issue comments created/edited/deleted
- GitHub issues auto-sync with local tracker

⚠️ *Note:* All data is stored in memory and will be lost on restart`;

    try {
      const chat = await msg.getChat();
      await chat.sendMessage(helpText);
    } catch (err) {
      console.error("Error sending help:", err);
    }
    return;
  }

  // $issue commands
  if (msg.body && msg.body.startsWith("$issue")) {
    try {
      const chat = await msg.getChat();
      const parts = msg.body.split(" ");
      const sub = parts[1];

      if (sub === "add") {
        const title = msg.body.substring("$issue add".length).trim();
        if (!title) {
          await chat.sendMessage("Usage: $issue add <title>");
          return;
        }

        const newIssue = await addIssue(title);
        await chat.sendMessage(`✅ Created issue #${newIssue.id}: ${newIssue.title}`);
      } else if (sub === "list") {
        const list = await listIssues();
        if (list.length === 0) {
          await chat.sendMessage("📋 No open issues");
        } else {
          let lines = `*📋 Open Issues (${list.length}):*\n\n`;

          for (const i of list) {
            let assigned = "\n❌ Unassigned";
            let deadline = "";

            if (i.assignedNames && i.assignedNames.length > 0) {
              assigned = `\n👤 Assigned to: ${i.assignedNames.join(", ")}`;
            }

            if (i.deadline) {
              deadline = `\n⏰ Deadline: ${i.deadline}`;
            }

            lines += `#${i.id}: ${i.title}${assigned}${deadline}\n\n`;
          }

          await chat.sendMessage(lines);
        }
      } else if (sub === "closed") {
        const list = await listClosedIssues();
        if (list.length === 0) {
          await chat.sendMessage("📋 No closed issues");
        } else {
          let lines = `*✅ Closed Issues (${list.length}):*\n\n`;

          for (const i of list) {
            let assigned = "";

            if (i.assignedNames && i.assignedNames.length > 0) {
              assigned = `\n👤 Was assigned to: ${i.assignedNames.join(", ")}`;
            }

            lines += `#${i.id}: ${i.title}${assigned}\n\n`;
          }

          await chat.sendMessage(lines);
        }
      } else if (sub === "my") {
        const senderId = msg.author || msg.from;
        const senderName = await getDisplayName(senderId);
        const items = await getIssuesAssignedTo(senderName);
        if (items.length === 0) {
          await chat.sendMessage("📋 You have no assigned issues");
        } else {
          let lines = `*📋 Your Assigned Issues (${items.length}):*\n\n`;
          items.forEach((i) => {
            const deadlineText = i.deadline ? `\n⏰ Deadline: ${i.deadline}` : "";
            lines += `#${i.id}: ${i.title}${deadlineText}\n\n`;
          });
          await chat.sendMessage(lines);
        }
      } else if (sub === "assign") {
        const id = parts[2];
        if (!id) {
          await chat.sendMessage("Usage: $issue assign <id> self OR $issue assign <id> @mention");
          return;
        }

        const senderId = msg.author || msg.from;
        const senderName = await getDisplayName(senderId);

        if (parts[3] && parts[3].toLowerCase() === "self") {
          const ok = await assignIssue(id, [senderName]);
          if (ok) {
            await chat.sendMessage(`👤 Assigned issue #${id} to ${senderName}`);
          } else {
            await chat.sendMessage(`❌ Issue #${id} not found`);
          }
        } else if (msg.mentionedIds && msg.mentionedIds.length > 0) {
          const names = [];
          for (const mentionedId of msg.mentionedIds) {
            const name = await getDisplayName(mentionedId);
            names.push(name);
          }

          const ok = await assignIssue(id, names);
          if (ok) {
            await chat.sendMessage(`👤 Assigned issue #${id} to ${names.join(", ")}`);
          } else {
            await chat.sendMessage(`❌ Issue #${id} not found`);
          }
        } else {
          await chat.sendMessage("Please use: $issue assign <id> self OR $issue assign <id> @mention");
        }
      } else if (sub === "unassign") {
        const id = parts[2];
        if (!id) {
          await chat.sendMessage("Usage: $issue unassign <id>");
          return;
        }

        const ok = await unassignIssue(id);
        if (ok) await chat.sendMessage(`♻️ Unassigned all people from issue #${id}`);
        else await chat.sendMessage(`❌ Issue #${id} not found`);
      } else if (sub === "update") {
        const id = parts[2];
        if (!id) {
          await chat.sendMessage("Usage: $issue update <id> <new title>");
          return;
        }
        const newTitle = msg.body.substring(`$issue update ${id}`.length).trim();
        if (!newTitle) {
          await chat.sendMessage("Usage: $issue update <id> <new title>");
          return;
        }
        const ok = await updateIssue(id, newTitle);
        if (ok) await chat.sendMessage(`✏️ Updated issue #${id} to: ${newTitle}`);
        else await chat.sendMessage(`❌ Issue #${id} not found`);
      } else if (sub === "deadline") {
        const id = parts[2];
        const deadline = parts[3];
        if (!id) {
          await chat.sendMessage("Usage: $issue deadline <id> <YYYY-MM-DD> OR $issue deadline <id> remove");
          return;
        }
        
        if (deadline && deadline.toLowerCase() === "remove") {
          const ok = await setDeadline(id, "");
          if (ok) await chat.sendMessage(`🗑️ Removed deadline from issue #${id}`);
          else await chat.sendMessage(`❌ Issue #${id} not found`);
          return;
        }
        
        if (!deadline) {
          await chat.sendMessage("Usage: $issue deadline <id> <YYYY-MM-DD> OR $issue deadline <id> remove");
          return;
        }
        
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(deadline)) {
          await chat.sendMessage("Invalid date format. Use YYYY-MM-DD (e.g., 2025-10-22)");
          return;
        }
        
        const ok = await setDeadline(id, deadline);
        if (ok) await chat.sendMessage(`⏰ Set deadline for issue #${id} to ${deadline}`);
        else await chat.sendMessage(`❌ Issue #${id} not found`);
      } else if (sub === "complete") {
        const id = parts[2];
        if (!id) {
          await chat.sendMessage("Usage: $issue complete <id>");
          return;
        }

        const ok = await closeIssue(id);
        if (ok) await chat.sendMessage(`✅ Completed issue #${id}`);
        else await chat.sendMessage(`❌ Issue #${id} not found`);
      } else if (sub === "reopen") {
        const id = parts[2];
        if (!id) {
          await chat.sendMessage("Usage: $issue reopen <id>");
          return;
        }

        const ok = await reopenIssue(id);
        if (ok) await chat.sendMessage(`♻️ Reopened issue #${id}`);
        else await chat.sendMessage(`❌ Issue #${id} not found in closed issues`);
      } else {
        await chat.sendMessage("Unknown command. Use $help to see all commands.");
      }
    } catch (err) {
      console.error("Issue command error:", err);
      try {
        const chat = await msg.getChat();
        await chat.sendMessage("An error occurred processing your command");
      } catch (e) {
        console.error("Failed to send error message:", e);
      }
    }
  }
});

// Initialize the application
async function initializeApp() {
  try {
    console.log("Initializing application...");
    console.log("In-memory storage initialized");
    
    await client.initialize();
  } catch (err) {
    console.error("Failed to initialize application:", err.message);
    process.exit(1);
  }
}

initializeApp();

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// Process handlers
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, destroying client...');
  try {
    await client.destroy();
  } catch (e) {
    console.error('Error destroying client:', e);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, destroying client...');
  try {
    await client.destroy();
  } catch (e) {
    console.error('Error destroying client:', e);
  }
  process.exit(0);
});