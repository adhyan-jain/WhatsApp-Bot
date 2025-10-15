# WhatsApp Bot

A small WhatsApp bot using whatsapp-web.js.

## Requirements

- Node.js (v16+ recommended)
- npm or yarn

## Install

Run in the project root:

```bash
npm install
```

## Run

Start the bot and scan the QR code with your phone (first run):

```bash
node main.js
```

Notes

- The bot uses `LocalAuth` to persist session data. If you send messages from the same account the bot is logged into, some libraries mark those messages as `fromMe` (self-sent) and behavior can differ. If you want the bot to respond to messages you send from the same account, inspect `msg.fromMe` / `msg.author` fields in the message handler and adjust logic accordingly.

Environment variable

- Set your owner number in the environment so the bot can recognize owner-only commands. The variable name is `OWNER_NUMBER` and should be your phone number with or without the `@c.us` suffix. Examples:

```bash
# Unix / macOS
export OWNER_NUMBER=9112345678

# Windows (PowerShell)
$env:OWNER_NUMBER = '9112345678@c.us'
```

When `main.js` runs it will normalize the value to the internal WhatsApp ID form (append `@c.us` if missing).
