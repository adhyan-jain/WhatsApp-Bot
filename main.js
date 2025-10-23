const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { google } = require("googleapis");
require('dotenv').config();

if (fs.existsSync(path.join(__dirname, '.env'))) {
  require('dotenv').config();
  console.log("Loaded environment from .env file");
} else {
  console.log("No .env file found, using environment variables from system");
}

console.log("Environment check:");
console.log("- OWNER_NUMBER:", process.env.OWNER_NUMBER ? "Set" : "Missing");
console.log("- GOOGLE_SHEET_ID:", process.env.GOOGLE_SHEET_ID ? "Set" : "Missing");
console.log("- GOOGLE_SERVICE_ACCOUNT_EMAIL:", process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? "Set" : "Missing");
console.log("- GOOGLE_PRIVATE_KEY:", process.env.GOOGLE_PRIVATE_KEY ? "Set (length: " + process.env.GOOGLE_PRIVATE_KEY?.length + ")" : "Missing");

const isRender = process.env.RENDER === "true";
const PORT = process.env.PORT || 3000;
const OWNER_NUMBER = process.env.OWNER_NUMBER;

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (OWNER_NUMBER && !OWNER_NUMBER.includes("@c.us")) {
  console.warn("OWNER_NUMBER should be in format: [country_code][number]@c.us");
  console.warn("   Example: 13105551234@c.us");
}

const app = express();

// Health check and status endpoints
app.get("/", (req, res) => {
  res.send("WhatsApp Bot is running. Check /health for status.");
});

app.get("/health", (req, res) => {
  const status = {
    status: "running",
    whatsappReady: client && client.info ? true : false,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    memoryUsage: process.memoryUsage(),
    environment: isRender ? "render" : "local",
    googleSheetsConfigured: !!(GOOGLE_SHEET_ID && GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY),
  };
  res.json(status);
});

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

let sheetsAPI = null;

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

async function initGoogleSheets() {
  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.warn("Google Sheets credentials not configured. Using local JSON storage.");
    return null;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY,
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    
    await ensureSheetsExist(sheets);
    
    console.log("Google Sheets API initialized successfully");
    return sheets;
  } catch (error) {
    console.error("Failed to initialize Google Sheets:", error.message);
    console.warn("Falling back to local JSON storage.");
    return null;
  }
}

async function ensureSheetsExist(sheets) {
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID,
    });

    const sheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
    const requiredSheets = ["Open Issues", "Closed Issues"];

    for (const sheetName of requiredSheets) {
      if (!sheetNames.includes(sheetName)) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: GOOGLE_SHEET_ID,
          resource: {
            requests: [
              {
                addSheet: {
                  properties: { title: sheetName },
                },
              },
            ],
          },
        });
        console.log(`Created sheet: ${sheetName}`);
      }
    }

    for (const sheetName of requiredSheets) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetName}!A1:E1`,
      });

      if (!response.data.values || response.data.values.length === 0) {
        const headers = ["ID", "Issue", "Assigned To", "Created At", "Deadline"];
        
        await sheets.spreadsheets.values.update({
          spreadsheetId: GOOGLE_SHEET_ID,
          range: `${sheetName}!A1:E1`,
          valueInputOption: "RAW",
          resource: { values: [headers] },
        });
        console.log(`Initialized headers for: ${sheetName}`);
      }
    }
  } catch (error) {
    console.error("Error ensuring sheets exist:", error.message);
    throw error;
  }
}

// Improved Puppeteer configuration for Render
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
    "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  ],
};

if (isRender || process.env.DOCKER) {
  puppeteerConfig.executablePath = "/usr/bin/chromium";
  console.log("Using system Chromium");
}

console.log("Initializing WhatsApp client...");

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "./.wwebjs_auth",
  }),
  puppeteer: puppeteerConfig,
  webVersionCache: {
    type: "remote",
    remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
  },
  // Add these options to improve stability
  qrMaxRetries: 5,
  restartOnAuthFail: true,
  takeoverOnConflict: true,
  takeoverTimeoutMs: 0,
});

let initAttempts = 0;
const maxAttempts = 3;
let isReconnecting = false;

async function initializeClient() {
  try {
    initAttempts++;
    console.log(`Initialization attempt ${initAttempts}/${maxAttempts}`);
    
    sheetsAPI = await initGoogleSheets();
    
    await initializeDataStore();
    
    await client.initialize();
  } catch (err) {
    console.error("Failed to initialize client:", err.message);
    
    if (initAttempts < maxAttempts) {
      console.log(`Retrying in 5 seconds...`);
      setTimeout(() => initializeClient(), 5000);
    } else {
      console.error("Max initialization attempts reached. Exiting...");
      process.exit(1);
    }
  }
}

initializeClient();

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

client.on("ready", () => {
  console.log("=".repeat(50));
  console.log("WhatsApp client is ready!");
  console.log(`Your number: ${client.info.wid._serialized}`);
  console.log(`Your name: ${client.info.pushname}`);
  console.log(`Storage: ${sheetsAPI ? 'Google Sheets' : 'Local JSON'}`);
  console.log("=".repeat(50));
  isReconnecting = false;
});

client.on("loading_screen", (percent, message) => {
  console.log(`Loading: ${percent}% - ${message}`);
});

// Improved disconnect handler with better cleanup
client.on("disconnected", async (reason) => {
  console.log("Client disconnected:", reason);
  
  if (isReconnecting) {
    console.log("Already reconnecting, ignoring duplicate disconnect event");
    return;
  }
  
  isReconnecting = true;
  
  if (reason === "LOGOUT") {
    console.log("Session logged out - clearing auth data safely...");
    await cleanAuthDirectory();
    console.log("Auth data cleared. Please scan QR code again on next startup.");
    console.log("Restarting in 5 seconds...");
    setTimeout(() => {
      process.exit(0); // Let Render restart the service
    }, 5000);
    return;
  }
  
  if (reason === "NAVIGATION") {
    console.log("Navigation error detected, attempting immediate reconnect...");
    setTimeout(() => {
      client.initialize().catch(err => {
        console.error("Reconnection failed:", err.message);
        isReconnecting = false;
      });
    }, 3000);
    return;
  }
  
  console.log("Attempting to reconnect in 10 seconds...");
  setTimeout(() => {
    client.initialize().catch(err => {
      console.error("Reconnection failed:", err.message);
      isReconnecting = false;
    });
  }, 10000);
});

// Safe directory cleanup function
async function cleanAuthDirectory() {
  const authPath = path.join(__dirname, ".wwebjs_auth");
  
  if (!fs.existsSync(authPath)) {
    console.log("Auth directory doesn't exist, nothing to clean");
    return;
  }
  
  try {
    // Use recursive force removal with error handling
    await new Promise((resolve, reject) => {
      const removeDir = (dir) => {
        if (!fs.existsSync(dir)) return;
        
        const files = fs.readdirSync(dir);
        
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          
          if (stat.isDirectory()) {
            removeDir(filePath);
          } else {
            try {
              fs.unlinkSync(filePath);
            } catch (e) {
              console.warn(`Could not delete file ${filePath}:`, e.message);
            }
          }
        }
        
        try {
          fs.rmdirSync(dir);
        } catch (e) {
          console.warn(`Could not delete directory ${dir}:`, e.message);
        }
      };
      
      try {
        removeDir(authPath);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    
    console.log("Successfully cleaned auth directory");
  } catch (error) {
    console.error("Error cleaning auth directory:", error.message);
    // Don't throw, just log - we'll try to continue anyway
  }
}

client.on("message_create", async (msg) => {
  if (msg.from === "status@broadcast") return;

  console.log(
    `From: ${msg.from} | Body: ${msg.body.substring(0, 50)}${
      msg.body.length > 50 ? "..." : ""
    }`
  );
  
  if (msg.body === "$help") {
    const helpText = `*Issue Tracker Commands*

$issue add <title> - Create a new issue
$issue list - List all open issues
$issue closed - List all closed issues
$issue my - List your assigned issues
$issue assign <id> self - Assign issue to yourself
$issue assign <id> @mention - Assign to mentioned person
$issue unassign <id> - Remove all assignments from issue
$issue update <id> <new title> - Update issue title
$issue deadline <id> <YYYY-MM-DD> - Set or update issue deadline
$issue deadline <id> remove - Remove issue deadline
$issue complete <id> - Mark issue as complete
$issue reopen <id> - Reopen a closed issue
$issue delete <id> - Delete an issue

$everyone - Mention all group members (admin only)
$everyone sc - Mention all admins only (admin only)
$everyone jc - Mention all non-admins only (admin only)`;

    try {
      const chat = await msg.getChat();
      await chat.sendMessage(helpText);
    } catch (err) {
      console.error("Error sending help:", err);
    }
    return;
  }

  if (msg.body && msg.body.startsWith("$everyone")) {
    try {
      const chat = await msg.getChat();

      if (!chat.isGroup) {
        await msg.reply("This command only works in groups.");
        return;
      }

      const parts = msg.body.trim().split(/\s+/);
      let mode = "all";
      if (parts.length >= 2) {
        if (parts[1].toLowerCase() === "jc") mode = "nonadmin";
        else if (parts[1].toLowerCase() === "sc") mode = "admin";
        else if (parts[1].toLowerCase() !== "all") {
          await chat.sendMessage("Usage: $everyone [jc|sc] - jc = non-admins, sc = admins");
          return;
        }
      }

      let senderId = msg.author || msg.from;

      if (!OWNER_NUMBER) {
        await msg.reply("OWNER_NUMBER not configured. Admin commands disabled.");
        return;
      }

      if (senderId !== OWNER_NUMBER && !msg.fromMe) {
        await msg.reply("Only the bot owner can use this command.");
        return;
      }

      const toMention = [];
      for (const p of chat.participants) {
        const isAdmin = !!(p.isAdmin || p.isSuperAdmin);
        if (
          mode === "all" ||
          (mode === "admin" && isAdmin) ||
          (mode === "nonadmin" && !isAdmin)
        ) {
          const id = p.id && p.id._serialized ? p.id._serialized : p.id;
          if (id) toMention.push(id);
        }
      }

      if (toMention.length === 0) {
        await chat.sendMessage("No members matched that filter.");
        return;
      }

      const mentionContacts = [];
      for (const id of toMention) {
        try {
          const contact = await client.getContactById(id);
          if (contact) mentionContacts.push(contact);
        } catch (e) {
          console.error(`Failed to get contact ${id}:`, e.message);
        }
      }

      if (mentionContacts.length === 0) {
        await chat.sendMessage("Could not resolve any contacts.");
        return;
      }

      let mentionText = "";
      mentionContacts.forEach((contact) => {
        mentionText += `@${contact.number || contact.id} `;
      });

      await chat.sendMessage(mentionText, { mentions: mentionContacts });
      console.log(`Successfully mentioned ${mode} members (${mentionContacts.length})`);
    } catch (err) {
      console.error("Error in $everyone command:", err);
      try {
        const chat = await msg.getChat();
        await chat.sendMessage("An error occurred while processing the command");
      } catch (e) {
        console.error("Failed to send error message:", e);
      }
    }
    return;
  }

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

        const newIssue = await addLocalIssue(title);
        await chat.sendMessage(`Created issue #${newIssue.id}: ${newIssue.title}`);
      } else if (sub === "delete") {
        const id = parts[2];
        if (!id) {
          await chat.sendMessage("Usage: $issue delete <id>");
          return;
        }
        const ok = await deleteLocalIssue(id);
        if (ok) await chat.sendMessage(`Deleted issue #${id}`);
        else await chat.sendMessage(`Issue #${id} not found`);
      } else if (sub === "list") {
        const list = await listLocalIssues();
        if (list.length === 0) {
          await chat.sendMessage("No open issues");
        } else {
          let lines = `*Open Issues (${list.length}):*\n\n`;

          for (const i of list) {
            let assigned = "\nUnassigned";
            let deadline = "";

            if (i.assignedNames && i.assignedNames.length > 0) {
              assigned = `\nAssigned to: ${i.assignedNames.join(", ")}`;
            }

            if (i.deadline) {
              deadline = `\nDeadline: ${i.deadline}`;
            }

            lines += `#${i.id}: ${i.title}${assigned}${deadline}\n\n`;
          }

          await chat.sendMessage(lines);
        }
      } else if (sub === "closed") {
        const list = await listClosedIssues();
        if (list.length === 0) {
          await chat.sendMessage("No closed issues");
        } else {
          let lines = `*Closed Issues (${list.length}):*\n\n`;

          for (const i of list) {
            let assigned = "";

            if (i.assignedNames && i.assignedNames.length > 0) {
              assigned = `\nWas assigned to: ${i.assignedNames.join(", ")}`;
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
          await chat.sendMessage("You have no assigned issues");
        } else {
          let lines = `*Your Assigned Issues (${items.length}):*\n\n`;
          items.forEach((i) => {
            const deadlineText = i.deadline ? `\nDeadline: ${i.deadline}` : "";
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
          const ok = await assignLocalIssue(id, [senderName]);
          if (ok) {
            await chat.sendMessage(`Assigned issue #${id} to ${senderName}`);
          } else {
            await chat.sendMessage(`Issue #${id} not found`);
          }
        } else if (msg.mentionedIds && msg.mentionedIds.length > 0) {
          const names = [];
          for (const mentionedId of msg.mentionedIds) {
            const name = await getDisplayName(mentionedId);
            names.push(name);
          }

          const ok = await assignLocalIssue(id, names);
          if (ok) {
            await chat.sendMessage(`Assigned issue #${id} to ${names.join(", ")}`);
          } else {
            await chat.sendMessage(`Issue #${id} not found`);
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

        const ok = await unassignLocalIssue(id);
        if (ok) await chat.sendMessage(`Unassigned all people from issue #${id}`);
        else await chat.sendMessage(`Issue #${id} not found`);
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
        const ok = await updateLocalIssue(id, newTitle);
        if (ok) await chat.sendMessage(`Updated issue #${id} to: ${newTitle}`);
        else await chat.sendMessage(`Issue #${id} not found`);
      } else if (sub === "deadline") {
        const id = parts[2];
        const deadline = parts[3];
        if (!id) {
          await chat.sendMessage("Usage: $issue deadline <id> <YYYY-MM-DD> OR $issue deadline <id> remove");
          return;
        }
        
        if (deadline && deadline.toLowerCase() === "remove") {
          const ok = await setDeadline(id, "");
          if (ok) await chat.sendMessage(`Removed deadline from issue #${id}`);
          else await chat.sendMessage(`Issue #${id} not found`);
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
        if (ok) await chat.sendMessage(`Set deadline for issue #${id} to ${deadline}`);
        else await chat.sendMessage(`Issue #${id} not found`);
      } else if (sub === "complete") {
        const id = parts[2];
        if (!id) {
          await chat.sendMessage("Usage: $issue complete <id>");
          return;
        }

        const ok = await closeLocalIssue(id);
        if (ok) await chat.sendMessage(`Completed issue #${id}`);
        else await chat.sendMessage(`Issue #${id} not found`);
      } else if (sub === "reopen") {
        const id = parts[2];
        if (!id) {
          await chat.sendMessage("Usage: $issue reopen <id>");
          return;
        }

        const ok = await reopenLocalIssue(id);
        if (ok) await chat.sendMessage(`Reopened issue #${id}`);
        else await chat.sendMessage(`Issue #${id} not found in closed issues`);
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

// Data storage implementation
const issuesFile = path.join(__dirname, "data", "issues.json");
const dataDir = path.join(__dirname, "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log("Created data directory");
}

let issuesStore = { open: [], closed: [], nextId: 1 };

try {
  if (fs.existsSync(issuesFile)) {
    const raw = fs.readFileSync(issuesFile, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      issuesStore.open = parsed;
      issuesStore.closed = [];
      issuesStore.nextId = computeNextId();
    } else {
      issuesStore.open = parsed.open || [];
      issuesStore.closed = parsed.closed || [];
      issuesStore.nextId = parsed.nextId || computeNextId();
    }
    console.log(
      `Loaded ${issuesStore.open.length} open issues and ${issuesStore.closed.length} closed issues from JSON`
    );
  } else {
    console.log("No existing issues found, starting fresh");
  }
} catch (e) {
  console.error("Error loading issues:", e);
  issuesStore = { open: [], closed: [], nextId: 1 };
}

function computeNextId() {
  const allIds = [
    ...issuesStore.open.map((i) => parseInt(i.id)),
    ...issuesStore.closed.map((i) => parseInt(i.id)),
  ];
  return allIds.length > 0 ? Math.max(...allIds) + 1 : 1;
}

async function saveToGoogleSheets() {
  if (!sheetsAPI) {
    console.log("sheetsAPI not initialized, skipping");
    return false;
  }

  try {
    console.log("Starting save to Google Sheets...");
    const openRows = [["ID", "Issue", "Assigned To", "Created At", "Deadline"]];
    issuesStore.open.forEach((issue) => {
      openRows.push([
        issue.id,
        issue.title,
        (issue.assignedNames || []).join(", "),
        issue.createdAt || "",
        issue.deadline || "",
      ]);
    });

    await sheetsAPI.spreadsheets.values.clear({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Open Issues!A:E",
    });

    await sheetsAPI.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Open Issues!A1",
      valueInputOption: "RAW",
      resource: { values: openRows },
    });

    const closedRows = [["ID", "Issue", "Assigned To", "Created At", "Deadline"]];
    issuesStore.closed.forEach((issue) => {
      closedRows.push([
        issue.id,
        issue.title,
        (issue.assignedNames || []).join(", "),
        issue.createdAt || "",
        issue.deadline || "",
      ]);
    });

    await sheetsAPI.spreadsheets.values.clear({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Closed Issues!A:E",
    });

    await sheetsAPI.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Closed Issues!A1",
      valueInputOption: "RAW",
      resource: { values: closedRows },
    });

    console.log("Successfully saved to Google Sheets");
    return true;
  } catch (error) {
    console.error("Error saving to Google Sheets:", error.message);
    return false;
  }
}

async function loadFromGoogleSheets() {
  if (!sheetsAPI) return false;

  try {
    const openResponse = await sheetsAPI.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Open Issues!A2:E",
    });

    const openRows = openResponse.data.values || [];
    issuesStore.open = openRows.map((row) => ({
      id: row[0] || "",
      title: row[1] || "",
      assignedNames: row[2] ? row[2].split(", ").filter(x => x) : [],
      createdAt: row[3] || "",
      deadline: row[4] || "",
    }));

    const closedResponse = await sheetsAPI.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Closed Issues!A2:E",
    });

    const closedRows = closedResponse.data.values || [];
    issuesStore.closed = closedRows.map((row) => ({
      id: row[0] || "",
      title: row[1] || "",
      assignedNames: row[2] ? row[2].split(", ").filter(x => x) : [],
      createdAt: row[3] || "",
      deadline: row[4] || "",
    }));

    issuesStore.nextId = computeNextId();

    console.log(
      `Loaded ${issuesStore.open.length} open and ${issuesStore.closed.length} closed issues from Google Sheets`
    );
    return true;
  } catch (error) {
    console.error("Error loading from Google Sheets:", error.message);
    return false;
  }
}

async function saveLocalIssues() {
  console.log("Starting save process...");
  console.log(`sheetsAPI initialized: ${!!sheetsAPI}`);
  console.log(`Open issues: ${issuesStore.open.length}, Closed: ${issuesStore.closed.length}`);
  
  const sheetsSaved = await saveToGoogleSheets();
  
  try {
    const jsonData = JSON.stringify(issuesStore, null, 2);
    fs.writeFileSync(issuesFile, jsonData);
    console.log(`JSON file written to: ${issuesFile}`);
    console.log(`Complete: ${sheetsSaved ? 'Google Sheets and JSON' : 'JSON only'}`);
  } catch (e) {
    console.error("Error saving issues to JSON:", e);
  }
}

async function initializeDataStore() {
  console.log("Starting data store initialization...");
  console.log(`sheetsAPI available: ${!!sheetsAPI}`);
  
  if (sheetsAPI) {
    console.log("Attempting to load from Google Sheets...");
    const loaded = await loadFromGoogleSheets();
    console.log(`Load from Sheets result: ${loaded}`);
    
    const sheetsHasData = issuesStore.open.length > 0 || issuesStore.closed.length > 0;
    
    if (!loaded || !sheetsHasData) {
      if (fs.existsSync(issuesFile)) {
        console.log("JSON file detected");
        
        try {
          const raw = fs.readFileSync(issuesFile, "utf8");
          const parsed = JSON.parse(raw);
          
          if (Array.isArray(parsed)) {
            issuesStore.open = parsed;
            issuesStore.closed = [];
            issuesStore.nextId = computeNextId();
          } else {
            issuesStore.open = parsed.open || [];
            issuesStore.closed = parsed.closed || [];
            issuesStore.nextId = parsed.nextId || computeNextId();
          }
          
          const totalIssues = issuesStore.open.length + issuesStore.closed.length;
          
          if (totalIssues > 0) {
            console.log(`Found ${issuesStore.open.length} open and ${issuesStore.closed.length} closed issues in JSON`);
            console.log("Migrating JSON data to Google Sheets...");
            
            const synced = await saveToGoogleSheets();
            
            if (synced) {
              console.log("Successfully migrated all data to Google Sheets");
            } else {
              console.log("Failed to migrate to Google Sheets, keeping JSON as backup");
            }
          } else {
            console.log("JSON file exists but is empty");
          }
        } catch (e) {
          console.error("Error reading JSON file:", e.message);
        }
      } else {
        console.log("No existing data found (neither Sheets nor JSON)");
      }
    } else {
      console.log(`Loaded ${issuesStore.open.length} open and ${issuesStore.closed.length} closed issues from Google Sheets`);
    }
  } else {
    console.log("Google Sheets not configured, using JSON only");
  }
}

async function addLocalIssue(title) {
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
  await saveLocalIssues();
  return newIssue;
}

async function deleteLocalIssue(id) {
  const idx = issuesStore.open.findIndex((i) => i.id === id);
  if (idx !== -1) {
    issuesStore.open.splice(idx, 1);
    await saveLocalIssues();
    return true;
  }
  const idx2 = issuesStore.closed.findIndex((i) => i.id === id);
  if (idx2 !== -1) {
    issuesStore.closed.splice(idx2, 1);
    await saveLocalIssues();
    return true;
  }
  return false;
}

async function listLocalIssues() {
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

async function assignLocalIssue(id, userNames) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;
  
  userNames.forEach((userName) => {
    if (!issue.assignedNames.includes(userName)) {
      issue.assignedNames.push(userName);
    }
  });
  
  await saveLocalIssues();
  return true;
}

async function unassignLocalIssue(id) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;
  issue.assignedNames = [];
  await saveLocalIssues();
  return true;
}

async function updateLocalIssue(id, newTitle) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;
  issue.title = newTitle;
  await saveLocalIssues();
  return true;
}

async function setDeadline(id, deadline) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;
  issue.deadline = deadline;
  await saveLocalIssues();
  return true;
}

async function closeLocalIssue(id) {
  const idx = issuesStore.open.findIndex((i) => i.id === id);
  if (idx === -1) return false;
  
  const issue = issuesStore.open.splice(idx, 1)[0];
  issuesStore.closed.push(issue);
  
  await saveLocalIssues();
  return true;
}

async function reopenLocalIssue(id) {
  const idx = issuesStore.closed.findIndex((i) => i.id === id);
  if (idx === -1) return false;
  
  const issue = issuesStore.closed.splice(idx, 1)[0];
  issuesStore.open.push(issue);
  
  await saveLocalIssues();
  return true;
}