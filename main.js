const { Client, LocalAuth } = require("whatsapp-web.js");
const puppeteer = require("puppeteer");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const express = require("express");

const isRender = process.env.RENDER === "true";
const PORT = process.env.PORT || 3000;

const OWNER_NUMBER = process.env.OWNER_NUMBER;

const app = express();

app.get("/", (req, res) => {
  res.send("WhatsApp Bot is running!");
});

app.get("/health", (req, res) => {
  const status = {
    status: "running",
    whatsappReady: client.info ? true : false,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
  res.json(status);
});

app.get("/qr", (req, res) => {
  res.send("Check logs for QR code or use /health to see status");
});

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
  console.log(`Visit: https://your-app-name.onrender.com to keep alive`);
});


const clientConfig = {
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: '/usr/bin/chromium-browser', // Render system Chrome
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions'
    ],
  },
};


if (isRender) {
  try {
    const puppeteerPath = require('puppeteer').executablePath();
    clientConfig.puppeteer.executablePath = puppeteerPath;
  } catch (e) {
    console.log("Puppeteer chrome not found, will try to download");
  }
  clientConfig.puppeteer.args.push("--no-zygote", "--single-process");
  clientConfig.puppeteer.ignoreHTTPSErrors = true;
  clientConfig.puppeteer.timeout = 0;
}

const client = new Client(clientConfig);
client.initialize().catch((err) => {
  console.error("Failed to initialize client:", err);
  process.exit(1);
});

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
    if (e.message && e.message.includes("Target closed")) {
      console.error("Browser connection lost, skipping contact fetch");
      return null;
    }
    console.error(`Failed to get contact ${id}:`, e.message || e);
  }
  return null;
}

client.on("qr", (qr) => {
  console.log("Scan this QR code to log in:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("WhatsApp client is ready!");
  console.log("Your number:", client.info.wid._serialized);
});

client.on("message_create", async (msg) => {
  console.log("From:", msg.from, "Body:", msg.body);

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
$everyone jc - Mention all non admin members
$everyone sc - Mention all admin members

*Examples:*
$issue add Fix login bug
$issue assign 3 self
$issue assign 5 @Adhyan @Krishang
$issue unassign 5 @Adhyan
$issue complete 2`;

    const chat = await msg.getChat();
    await chat.sendMessage(helpText);
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
      console.log("Sender ID:", senderId);
      console.log("Owner Number:", OWNER_NUMBER);

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

        const newIssue = addLocalIssue(title, creator);
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
        const ok = deleteLocalIssue(id);
        if (ok) await chat.sendMessage(`Deleted issue #${id}`);
        else await chat.sendMessage(`Issue #${id} not found`);
      } else if (sub === "list") {
        const list = listLocalIssues();
        if (list.length === 0) {
          await chat.sendMessage("No open issues");
        } else {
          let lines = "*Open Issues:*\n\n";
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
        const list = listClosedIssues();
        if (list.length === 0) {
          await chat.sendMessage("No closed issues");
        } else {
          let lines = "*Closed Issues:*\n\n";
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
        const items = getIssuesAssignedTo(senderId);
        if (items.length === 0) {
          await chat.sendMessage("You have no assigned issues");
        } else {
          let lines = "*Your Assigned Issues:*\n\n";
          items.forEach((i) => {
            lines += `#${i.id}: ${i.title}\n`;
          });
          await chat.sendMessage(lines);
        }
      } else if (sub === "assign") {
        const id = parts[2];
        if (!id) {
          await chat.sendMessage(
            "Usage: $issue assign <id> self OR $issue assign <id> @mention1 @mention2"
          );
          return;
        }

        const senderId = msg.author || msg.from;

        if (parts[3] === "self") {
          const ok = assignLocalIssue(id, [senderId]);
          if (ok) {
            await chat.sendMessage(`Assigned issue #${id} to you`);
          } else {
            await chat.sendMessage(`Issue #${id} not found`);
          }
        } else if (msg.mentionedIds && msg.mentionedIds.length > 0) {
          const ok = assignLocalIssue(id, msg.mentionedIds);
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
            "Please use: $issue assign <id> self OR $issue assign <id> @mention1 @mention2"
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
          const ok = unassignSpecificPeople(id, msg.mentionedIds);
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
          const ok = unassignLocalIssue(id);
          if (ok)
            await chat.sendMessage(`Unassigned all people from issue #${id}`);
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

        const ok = closeLocalIssue(id, closerId);
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
      `Loaded ${issuesStore.open.length} open issues and ${issuesStore.closed.length} closed issues`
    );
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

function saveLocalIssues() {
  try {
    fs.writeFileSync(issuesFile, JSON.stringify(issuesStore, null, 2));
  } catch (e) {
    console.error("Error saving issues:", e);
  }
}

function computeNextId() {
  let max = 0;
  const scan = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((i) => {
      const n = parseInt(i.id, 10);
      if (!isNaN(n) && n > max) max = n;
    });
  };
  scan(issuesStore.open);
  scan(issuesStore.closed);
  return max + 1;
}

function generateId() {
  const id = issuesStore.nextId || computeNextId();
  issuesStore.nextId = Number(id) + 1;
  return String(id);
}

function addLocalIssue(title, creator) {
  const issue = {
    id: generateId(),
    title,
    assignedIds: [],
    createdAt: new Date().toISOString(),
    creator: creator || null,
  };
  issuesStore.open.push(issue);
  saveLocalIssues();
  return issue;
}

function deleteLocalIssue(id) {
  let idx = issuesStore.open.findIndex((i) => i.id === id);
  if (idx !== -1) {
    issuesStore.open.splice(idx, 1);
    saveLocalIssues();
    return true;
  }
  idx = issuesStore.closed.findIndex((i) => i.id === id);
  if (idx !== -1) {
    issuesStore.closed.splice(idx, 1);
    saveLocalIssues();
    return true;
  }
  return false;
}

function listLocalIssues() {
  return issuesStore.open;
}

function listClosedIssues() {
  return issuesStore.closed;
}

function assignLocalIssue(id, assignedIds) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;

  const existingIds = new Set(issue.assignedIds || []);
  assignedIds.forEach((id) => existingIds.add(id));
  issue.assignedIds = Array.from(existingIds);

  saveLocalIssues();
  return true;
}

function unassignLocalIssue(id) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;
  issue.assignedIds = [];
  saveLocalIssues();
  return true;
}

function unassignSpecificPeople(id, peopleIds) {
  const issue = issuesStore.open.find((i) => i.id === id);
  if (!issue) return false;

  issue.assignedIds = (issue.assignedIds || []).filter(
    (assignedId) => !peopleIds.includes(assignedId)
  );

  saveLocalIssues();
  return true;
}

function getIssuesAssignedTo(whatsappId) {
  return issuesStore.open.filter(
    (i) => i.assignedIds && i.assignedIds.includes(whatsappId)
  );
}

function closeLocalIssue(id, closerId) {
  const idx = issuesStore.open.findIndex((i) => i.id === id);
  if (idx === -1) return false;
  const issue = issuesStore.open.splice(idx, 1)[0];
  issue.closedAt = new Date().toISOString();
  issue.closedBy = closerId || null;
  issuesStore.closed.push(issue);
  saveLocalIssues();
  return true;
}
