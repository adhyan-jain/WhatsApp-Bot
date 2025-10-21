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

// Then verify the variables are loaded
console.log("Environment check:");
console.log("- OWNER_NUMBER:", process.env.OWNER_NUMBER ? "✓ Set" : "✗ Missing");
console.log("- GOOGLE_SHEET_ID:", process.env.GOOGLE_SHEET_ID ? "✓ Set" : "✗ Missing");
console.log("- GOOGLE_SERVICE_ACCOUNT_EMAIL:", process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? "✓ Set" : "✗ Missing");
console.log("- GOOGLE_PRIVATE_KEY:", process.env.GOOGLE_PRIVATE_KEY ? "✓ Set (length: " + process.env.GOOGLE_PRIVATE_KEY?.length + ")" : "✗ Missing");




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

app.get("/", (req, res) => {
  res.send("WhatsApp Bot is running. Check /health for status.");
});

app.get("/health", (req, res) => {
  const status = {
    status: "running",
    whatsappReady: client.info ? true : false,
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
        range: `${sheetName}!A1:G1`,
      });

      if (!response.data.values || response.data.values.length === 0) {
        const headers = sheetName === "Open Issues" 
          ? ["ID", "Title", "Assigned To", "Created At", "Creator"]
          : ["ID", "Title", "Assigned To", "Created At", "Creator", "Closed At", "Closed By"];
        
        await sheets.spreadsheets.values.update({
          spreadsheetId: GOOGLE_SHEET_ID,
          range: `${sheetName}!A1:G1`,
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
    "--disable-renderer-backgrounding"
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
});

let initAttempts = 0;
const maxAttempts = 3;

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

const contactCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;

async function getCachedContact(id) {
  const now = Date.now();
  const cached = contactCache.get(id);

  if (cached && now - cached.timestamp < CACHE_DURATION) {
    return cached.contact;
  }

  try {
    const contact = await client.getContactById(id);
    if (contact) {
      contactCache.set(id, { contact, timestamp: now });
      return contact;
    }
  } catch (e) {
    console.error(`Failed to get contact ${id}:`, e.message || e);
  }
  return null;
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
});

client.on("disconnected", (reason) => {
  console.log("Client disconnected:", reason);
  console.log("Attempting to reconnect...");
});

client.on("loading_screen", (percent, message) => {
  console.log(`Loading: ${percent}% - ${message}`);
});

client.on("message_create", async (msg) => {
  if (msg.from === "status@broadcast") return;

  console.log(
    `From: ${msg.from} | Body: ${msg.body.substring(0, 50)}${
      msg.body.length > 50 ? "..." : ""
    }`
  );
  
  if (msg.body === "$help") {
    const helpText = `*Issue Tracker Commands*

*Creating Issues:*
$issue add title here - Create a new issue

*Viewing Issues:*
$issue list - List all open issues
$issue closed - List all closed issues
$issue my - List your assigned issues

*Managing Issues:*
$issue assign <id> self - Assign issue to yourself
$issue assign <id> @mention1 @mention2 - Assign to multiple people
$issue unassign <id> - Remove all assignments from issue
$issue unassign <id> @mention - Remove specific person from issue
$issue complete <id> - Mark issue as complete
$issue close <id> - Mark issue as complete (alias)
$issue delete <id> - Delete an issue

*Admin Only:*
$everyone - Mention all group members
$everyone jc - Mention all non-admin members
$everyone sc - Mention all admin members

*Examples:*
$issue add Fix login bug
$issue assign 3 self
$issue assign 5 @Adhyan @Krishang
$issue unassign 5 @Adhyan
$issue complete 2`;

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
        else {
          await chat.sendMessage(
            "Usage: $everyone [jc|sc] - jc = non-admins, sc = admins"
          );
          return;
        }
      }

      let senderId = msg.author || msg.from;

      if (!OWNER_NUMBER) {
        await msg.reply(
          "OWNER_NUMBER not configured. Admin commands disabled."
        );
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

      const mentionContacts = await Promise.all(
        toMention.map((id) => getCachedContact(id))
      );

      const validContacts = mentionContacts.filter((c) => c !== null);

      if (validContacts.length === 0) {
        await chat.sendMessage("Could not resolve any contacts.");
        return;
      }

      let mentionText = "";
      validContacts.forEach((contact) => {
        mentionText += `@${
          contact.number || (contact.id && contact.id.user) || contact.id
        } `;
      });

      await chat.sendMessage(mentionText, { mentions: validContacts });
      console.log(
        `Successfully mentioned ${mode} members (${validContacts.length})`
      );
    } catch (err) {
      console.error("Error in $everyone command:", err);
      try {
        const chat = await msg.getChat();
        await chat.sendMessage(
          "An error occurred while processing the command"
        );
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
          await chat.sendMessage("Usage: $issue add title here");
          return;
        }

        const creator = msg.author || msg.from;
        const contact = await msg.getContact();

        const newIssue = await addLocalIssue(title, creator);
        await chat.sendMessage(
          `Created issue #${newIssue.id}: ${newIssue.title}\nCreated by: @${contact.number}`,
          {
            mentions: [contact],
          }
        );
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
          const mentions = [];
          const mentionIds = new Set();

          const allContactIds = new Set();
          for (const i of list) {
            if (i.assignedIds && i.assignedIds.length > 0) {
              i.assignedIds.forEach((id) => allContactIds.add(id));
            }
            if (i.creator) allContactIds.add(i.creator);
          }

          const contactMap = new Map();
          const contactPromises = Array.from(allContactIds).map(async (id) => {
            const contact = await getCachedContact(id);
            if (contact) contactMap.set(id, contact);
          });
          await Promise.all(contactPromises);

          for (const i of list) {
            let assigned = "\nUnassigned";
            let creator = "";

            if (i.assignedIds && i.assignedIds.length > 0) {
              const assignedNames = [];
              for (const assignedId of i.assignedIds) {
                const contact = contactMap.get(assignedId);
                if (contact) {
                  assignedNames.push(`@${contact.number}`);
                  if (!mentionIds.has(assignedId)) {
                    mentions.push(contact);
                    mentionIds.add(assignedId);
                  }
                } else {
                  assignedNames.push(assignedId);
                }
              }
              assigned = `\nAssigned to: ${assignedNames.join(", ")}`;
            }

            if (i.creator) {
              const contact = contactMap.get(i.creator);
              if (contact) {
                creator = `\nCreated by: @${contact.number}`;
                if (!mentionIds.has(i.creator)) {
                  mentions.push(contact);
                  mentionIds.add(i.creator);
                }
              } else {
                creator = `\nCreated by: ${i.creator}`;
              }
            }

            lines += `#${i.id}: ${i.title}${assigned}${creator}\n\n`;
          }

          await chat.sendMessage(lines, { mentions });
        }
      } else if (sub === "closed") {
        const list = await listClosedIssues();
        if (list.length === 0) {
          await chat.sendMessage("No closed issues");
        } else {
          let lines = `*Closed Issues (${list.length}):*\n\n`;
          const mentions = [];
          const mentionIds = new Set();

          const allContactIds = new Set();
          for (const i of list) {
            if (i.closedBy) allContactIds.add(i.closedBy);
            if (i.assignedIds && i.assignedIds.length > 0) {
              i.assignedIds.forEach((id) => allContactIds.add(id));
            }
          }

          const contactMap = new Map();
          const contactPromises = Array.from(allContactIds).map(async (id) => {
            const contact = await getCachedContact(id);
            if (contact) contactMap.set(id, contact);
          });
          await Promise.all(contactPromises);

          for (const i of list) {
            let completedBy = "";
            let assigned = "";

            if (i.closedBy) {
              const contact = contactMap.get(i.closedBy);
              if (contact) {
                completedBy = `\nCompleted by: @${contact.number}`;
                if (!mentionIds.has(i.closedBy)) {
                  mentions.push(contact);
                  mentionIds.add(i.closedBy);
                }
              } else {
                completedBy = `\nCompleted by: ${i.closedBy}`;
              }
            }

            if (i.assignedIds && i.assignedIds.length > 0) {
              const assignedNames = [];
              for (const assignedId of i.assignedIds) {
                const contact = contactMap.get(assignedId);
                if (contact) {
                  assignedNames.push(`@${contact.number}`);
                  if (!mentionIds.has(assignedId)) {
                    mentions.push(contact);
                    mentionIds.add(assignedId);
                  }
                } else {
                  assignedNames.push(assignedId);
                }
              }
              assigned = `\nWas assigned to: ${assignedNames.join(", ")}`;
            }

            lines += `#${i.id}: ${i.title}${completedBy}${assigned}\n\n`;
          }

          await chat.sendMessage(lines, { mentions });
        }
      } else if (sub === "my") {
        const senderId = msg.author || msg.from;
        const items = await getIssuesAssignedTo(senderId);
        if (items.length === 0) {
          await chat.sendMessage("You have no assigned issues");
        } else {
          let lines = `*Your Assigned Issues (${items.length}):*\n\n`;
          items.forEach((i) => {
            lines += `#${i.id}: ${i.title}\n`;
          });
          await chat.sendMessage(lines);
        }
      } else if (sub === "assign") {
        const id = parts[2];
        if (!id) {
          await chat.sendMessage(
            "Usage: $issue assign <id> self OR $issue assign <id> @mention1 @mention2 OR $issue assign <id> lid:123@lid"
          );
          return;
        }

        const senderId = msg.author || msg.from;

        if (parts[3] && parts[3].toLowerCase() === "self") {
          const ok = await assignLocalIssue(id, lidIds);
          if (ok) {
            const contact = await msg.getContact();
            await chat.sendMessage(`Assigned issue #${id} to @${contact.number}`, {
              mentions: [contact]
            });
          } else {
            await chat.sendMessage(`Issue #${id} not found`);
          }
        } else if (parts[3] && (parts[3].startsWith("lid:") || parts[3].includes("@lid"))) {
          const lidIds = parts.slice(3).map(p => {
            let lid = p.replace(/^lid:/, "");
            if (!lid.includes("@lid")) {
              lid = `${lid}@lid`;
            }
            return lid;
          });
          
          const ok = await assignIssue(id, lidIds);
          if (ok) {
            await chat.sendMessage(`Assigned issue #${id} to ${lidIds.join(", ")}`);
          } else {
            await chat.sendMessage(`Issue #${id} not found`);
          }
        } else if (msg.mentionedIds && msg.mentionedIds.length > 0) {
          const ok = await assignIssue(id, msg.mentionedIds);
          if (ok) {
            const contacts = await Promise.all(
              msg.mentionedIds.map((id) => getCachedContact(id))
            );

            const validContacts = contacts.filter((c) => c !== null);
            const names = validContacts.map((c) => `@${c.number}`);

            await chat.sendMessage(
              `Assigned issue #${id} to ${names.join(", ")}`,
              {
                mentions: validContacts,
              }
            );
          } else {
            await chat.sendMessage(`Issue #${id} not found`);
          }
        } else {
          await chat.sendMessage(
            "Please use: $issue assign <id> self OR $issue assign <id> @mention1 @mention2 OR $issue assign <id> lid:123@lid"
          );
        }
      } else if (sub === "unassign") {
        const id = parts[2];
        if (!id) {
          await chat.sendMessage(
            "Usage: $issue unassign <id> OR $issue unassign <id> @mention"
          );
          return;
        }

        if (msg.mentionedIds && msg.mentionedIds.length > 0) {
          const ok = await unassignSpecificPeople(id, msg.mentionedIds);
          if (ok) {
            const contacts = await Promise.all(
              msg.mentionedIds.map((id) => getCachedContact(id))
            );

            const validContacts = contacts.filter((c) => c !== null);
            const names = validContacts.map((c) => `@${c.number}`);

            await chat.sendMessage(
              `Removed ${names.join(", ")} from issue #${id}`,
              {
                mentions: validContacts,
              }
            );
          } else {
            await chat.sendMessage(
              `Issue #${id} not found or person(s) not assigned`
            );
          }
        } else {
          const ok = await unassignLocalIssue(id);
          if (ok)
            await chat.sendMessage(
              `Unassigned all people from issue #${id}`
            );
          else await chat.sendMessage(`Issue #${id} not found`);
        }
      } else if (sub === "complete" || sub === "close") {
        const id = parts[2];
        if (!id) {
          await chat.sendMessage(
            "Usage: $issue complete <id> OR $issue close <id>"
          );
          return;
        }
        const closerId = msg.author || msg.from;

        const ok = await closeLocalIssue(id, closerId);
        if (ok) await chat.sendMessage(`Completed issue #${id}`);
        else await chat.sendMessage(`Issue #${id} not found`);
      } else {
        await chat.sendMessage(
          "Unknown command. Use $help to see all commands."
        );
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
      issuesStore.open = parsed.map(migrateIssue);
      issuesStore.closed = [];
      issuesStore.nextId = computeNextId();
    } else {
      issuesStore.open = (parsed.open || []).map(migrateIssue);
      issuesStore.closed = (parsed.closed || []).map(migrateIssue);
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

function migrateIssue(issue) {
  if (issue.assignedId && !issue.assignedIds) {
    issue.assignedIds = [issue.assignedId];
    delete issue.assignedId;
  } else if (!issue.assignedIds) {
    issue.assignedIds = [];
  }
  return issue;
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
    console.log("[SHEETS] sheetsAPI not initialized, skipping");
    return false;
  }

  try {
    console.log("[SHEETS] Starting save to Google Sheets...");
    const openRows = [["ID", "Title", "Assigned To", "Created At", "Creator"]];
    issuesStore.open.forEach((issue) => {
      openRows.push([
        issue.id,
        issue.title,
        (issue.assignedIds || []).join(", "),
        issue.createdAt || "",
        issue.creator || "",
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

    const closedRows = [["ID", "Title", "Assigned To", "Created At", "Creator", "Closed At", "Closed By"]];
    issuesStore.closed.forEach((issue) => {
      closedRows.push([
        issue.id,
        issue.title,
        (issue.assignedIds || []).join(", "),
        issue.createdAt || "",
        issue.creator || "",
        issue.closedAt || "",
        issue.closedBy || "",
      ]);
    });

    await sheetsAPI.spreadsheets.values.clear({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Closed Issues!A:G",
    });

    await sheetsAPI.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Closed Issues!A1",
      valueInputOption: "RAW",
      resource: { values: closedRows },
    });

    console.log("[SHEETS] Successfully saved to Google Sheets");
    return true;
  } catch (error) {
    console.error("[SHEETS] Error saving to Google Sheets:", error.message);
    console.error("[SHEETS] Full error:", error);
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
      assignedIds: row[2] ? row[2].split(", ").filter(x => x) : [],
      createdAt: row[3] || "",
      creator: row[4] || "",
    }));

    const closedResponse = await sheetsAPI.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Closed Issues!A2:G",
    });

    const closedRows = closedResponse.data.values || [];
    issuesStore.closed = closedRows.map((row) => ({
      id: row[0] || "",
      title: row[1] || "",
      assignedIds: row[2] ? row[2].split(", ").filter(x => x) : [],
      createdAt: row[3] || "",
      creator: row[4] || "",
      closedAt: row[5] || "",
      closedBy: row[6] || "",
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
  console.log(`[SAVE] Starting save process...`);
  console.log(`[SAVE] sheetsAPI initialized: ${!!sheetsAPI}`);
  console.log(`[SAVE] Open issues: ${issuesStore.open.length}, Closed: ${issuesStore.closed.length}`);
  
  const sheetsSaved = await saveToGoogleSheets();
  
  try {
    const jsonData = JSON.stringify(issuesStore, null, 2);
    fs.writeFileSync(issuesFile, jsonData);
    console.log(`[SAVE] JSON file written to: ${issuesFile}`);
    console.log(`[SAVE] Complete: ${sheetsSaved ? 'Google Sheets and JSON' : 'JSON only'}`);
  } catch (e) {
    console.error("[SAVE] Error saving issues to JSON:", e);
  }
}

// Replace the initializeDataStore function in your main.js with this:

async function initializeDataStore() {
  console.log("[INIT] Starting data store initialization...");
  console.log(`[INIT] sheetsAPI available: ${!!sheetsAPI}`);
  
  if (sheetsAPI) {
    console.log("[INIT] Attempting to load from Google Sheets...");
    const loaded = await loadFromGoogleSheets();
    console.log(`[INIT] Load from Sheets result: ${loaded}`);
    
    const sheetsHasData = issuesStore.open.length > 0 || issuesStore.closed.length > 0;
    
    if (!loaded || !sheetsHasData) {
      // Check if JSON file exists with data
      if (fs.existsSync(issuesFile)) {
        console.log("[INIT] ⚠️  JSON file detected!");
        
        // Load from JSON
        try {
          const raw = fs.readFileSync(issuesFile, "utf8");
          const parsed = JSON.parse(raw);
          
          // Handle both old and new JSON formats
          if (Array.isArray(parsed)) {
            issuesStore.open = parsed.map(migrateIssue);
            issuesStore.closed = [];
            issuesStore.nextId = computeNextId();
          } else {
            issuesStore.open = (parsed.open || []).map(migrateIssue);
            issuesStore.closed = (parsed.closed || []).map(migrateIssue);
            issuesStore.nextId = parsed.nextId || computeNextId();
          }
          
          const totalIssues = issuesStore.open.length + issuesStore.closed.length;
          
          if (totalIssues > 0) {
            console.log(`[INIT] 📦 Found ${issuesStore.open.length} open and ${issuesStore.closed.length} closed issues in JSON`);
            console.log("[INIT] 🔄 Migrating JSON data to Google Sheets...");
            
            const synced = await saveToGoogleSheets();
            
            if (synced) {
              console.log("[INIT] ✅ Successfully migrated all data to Google Sheets!");
              console.log("[INIT] 📝 You can now safely delete the data/issues.json file");
              console.log("[INIT] 🗑️  After deletion, remove the JSON migration code from initializeDataStore()");
            } else {
              console.log("[INIT] ❌ Failed to migrate to Google Sheets, keeping JSON as backup");
            }
          } else {
            console.log("[INIT] JSON file exists but is empty");
          }
        } catch (e) {
          console.error("[INIT] Error reading JSON file:", e.message);
        }
      } else {
        console.log("[INIT] No existing data found (neither Sheets nor JSON)");
      }
    } else {
      console.log(`[INIT] ✅ Loaded ${issuesStore.open.length} open and ${issuesStore.closed.length} closed issues from Google Sheets`);
    }
  } else {
    console.log("[INIT] Google Sheets not configured, using JSON only");
  }
}

async function addLocalIssue(title, creator) {
  console.log(`[ADD] Creating issue: "${title}" by ${creator}`);
  const newIssue = {
    id: String(issuesStore.nextId++),
    title,
    assignedIds: [],
    createdAt: new Date().toISOString(),
    creator,
  };
  issuesStore.open.push(newIssue);
  console.log(`[ADD] Issue created with ID: ${newIssue.id}`);
  console.log(`[ADD] Current open issues count: ${issuesStore.open.length}`);
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

async function getIssuesAssignedTo(userId) {
  return issuesStore.open.filter(
    (i) => i.assignedIds && i.assignedIds.includes(userId)
  );
}

async function assignLocalIssue(id, userIds) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;
  
  userIds.forEach((userId) => {
    if (!issue.assignedIds.includes(userId)) {
      issue.assignedIds.push(userId);
    }
  });
  
  await saveLocalIssues();
  return true;
}

async function unassignLocalIssue(id) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;
  issue.assignedIds = [];
  await saveLocalIssues();
  return true;
}

async function unassignSpecificPeople(id, userIds) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;
  
  const hadAny = issue.assignedIds.some((id) => userIds.includes(id));
  issue.assignedIds = issue.assignedIds.filter((id) => !userIds.includes(id));
  
  if (hadAny) {
    await saveLocalIssues();
    return true;
  }
  return false;
}

async function closeLocalIssue(id, closerId) {
  const idx = issuesStore.open.findIndex((i) => i.id === id);
  if (idx === -1) return false;
  
  const issue = issuesStore.open.splice(idx, 1)[0];
  issue.closedAt = new Date().toISOString();
  issue.closedBy = closerId;
  issuesStore.closed.push(issue);
  
  await saveLocalIssues();
  return true;
}

