const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { google } = require("googleapis");
require('dotenv').config();

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

let sheetsAPI = null;
let client = null;

async function initGoogleSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

async function initWhatsApp() {
  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: "./.wwebjs_auth",
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  return new Promise((resolve, reject) => {
    client.on("qr", (qr) => {
      console.log("Scan QR code:");
      qrcode.generate(qr, { small: true });
    });

    client.on("ready", () => {
      console.log("WhatsApp client ready");
      resolve();
    });

    client.on("auth_failure", reject);

    client.initialize();
  });
}

async function getPushName(contactId) {
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const contact = await client.getContactById(contactId);
    
    console.log(`Debug ${contactId}:`, {
      pushname: contact.pushname,
      name: contact.name,
      verifiedName: contact.verifiedName,
      shortName: contact.shortName,
      number: contact.number
    });

    console.log(contact);
    
    if (contact.pushname) return contact.pushname;
    if (contact.verifiedName) return contact.verifiedName;
    if (contact.shortName) return contact.shortName;
    if (contact.name && !contact.name.includes('+') && !contact.name.match(/^\d+$/)) {
      return contact.name;
    }
    
    return contact.number || contactId;
  } catch (e) {
    console.error(`Error getting contact ${contactId}:`, e.message);
    return contactId;
  }
}

async function updateAssignedNames() {
  console.log("Loading issues from Google Sheets...");

  const openResponse = await sheetsAPI.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Open Issues!A2:E",
  });

  const closedResponse = await sheetsAPI.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Closed Issues!A2:G",
  });

  const openRows = openResponse.data.values || [];
  const closedRows = closedResponse.data.values || [];

  console.log(`Found ${openRows.length} open issues and ${closedRows.length} closed issues`);

  const updatedOpenRows = [["ID", "Title", "Assigned To", "Created At", "Creator"]];
  
  for (const row of openRows) {
    const assignedIds = row[2] ? row[2].split(", ").filter(x => x) : [];
    const assignedNames = [];

    for (const id of assignedIds) {
      const name = await getPushName(id);
      assignedNames.push(name);
      console.log(`Final: ${id} -> ${name}`);
    }

    updatedOpenRows.push([
      row[0],
      row[1],
      assignedNames.join(", "),
      row[3],
      row[4],
    ]);
  }

  const updatedClosedRows = [["ID", "Title", "Assigned To", "Created At", "Creator", "Closed At", "Closed By"]];
  
  for (const row of closedRows) {
    const assignedIds = row[2] ? row[2].split(", ").filter(x => x) : [];
    const assignedNames = [];

    for (const id of assignedIds) {
      const name = await getPushName(id);
      assignedNames.push(name);
      console.log(`Final: ${id} -> ${name}`);
    }

    updatedClosedRows.push([
      row[0],
      row[1],
      assignedNames.join(", "),
      row[3],
      row[4],
      row[5],
      row[6],
    ]);
  }

  console.log("Updating Google Sheets...");

  await sheetsAPI.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Open Issues!A:E",
  });

  await sheetsAPI.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Open Issues!A1",
    valueInputOption: "RAW",
    resource: { values: updatedOpenRows },
  });

  await sheetsAPI.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Closed Issues!A:G",
  });

  await sheetsAPI.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Closed Issues!A1",
    valueInputOption: "RAW",
    resource: { values: updatedClosedRows },
  });

  console.log("Update complete!");
}

async function main() {
  console.log("Initializing Google Sheets...");
  sheetsAPI = await initGoogleSheets();

  console.log("Initializing WhatsApp...");
  await initWhatsApp();

  await updateAssignedNames();

  console.log("Closing...");
  await client.destroy();
  process.exit(0);
}

main().catch(console.error);