const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");


let OWNER_NUMBER = process.env.OWNER_NUMBER;

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: false,
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
  console.log("From:", msg.from, "Body:", msg.body, "fromMe:", msg.fromMe);
  if (msg.body === "!everyone") {
    try {
      const chat = await msg.getChat();

      if (!chat.isGroup) {
        await msg.reply("This command only works in groups.");
        return;
      }

      if (!msg.fromMe) {
        let senderId = msg.author || msg.from;
        if (senderId !== OWNER_NUMBER) {
          await msg.reply("Only the bot owner can use this command.");
          return;
        }
      }

      const mentions = await Promise.all(
        chat.participants.map((p) =>
          client.getContactById(p.id._serialized)
        )
      );

      let mentionText = "";
      mentions.forEach((contact) => {
        mentionText += `@${contact.number || contact.id.user} `;
      });

      await chat.sendMessage(mentionText, { mentions });
      console.log("Successfully mentioned everyone!");
    } catch (err) {
      console.error("Error:", err);
    }
  }
});

client.initialize();