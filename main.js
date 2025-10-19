const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

let OWNER_NUMBER = process.env.OWNER_NUMBER;

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: false,
    executablePath:
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-software-rasterizer",
    ],
  },
});

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
          await chat.sendMessage('Usage: $everyone [jc|sc] - jc = non-admins, sc = admins');
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
        if (mode === "all" || (mode === "admin" && isAdmin) || (mode === "nonadmin" && !isAdmin)) {
          const id = p.id && p.id._serialized ? p.id._serialized : p.id;
          if (id) toMention.push(id);
        }
      }

      if (toMention.length === 0) {
        await chat.sendMessage('No members matched that filter.');
        return;
      }

      const mentionContacts = [];
      for (const id of toMention) {
        try {
          const contact = await client.getContactById(id);
          mentionContacts.push(contact);
        } catch (e) {
          console.error(`Failed to get contact for ${id}:`, e);
        }
      }

      if (mentionContacts.length === 0) {
        await chat.sendMessage('Could not resolve any contacts.');
        return;
      }

      let mentionText = "";
      mentionContacts.forEach((contact) => {
        mentionText += `@${contact.number || (contact.id && contact.id.user) || contact.id} `;
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
  }
});

client.initialize();