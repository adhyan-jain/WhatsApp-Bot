# GitHub → WhatsApp Relay Bot

This bot listens for GitHub repository activity and relays key events to a WhatsApp group in real time. It runs on Node.js, authenticates to WhatsApp Web with `whatsapp-web.js`, and exposes a webhook endpoint for GitHub to call.

## What It Does

- 📬 Sends a WhatsApp message when an issue is opened.
- 👥 Notifies the group when an issue is assigned or unassigned.
- 🚀 Announces new pull requests.
- ✅ Celebrates pull requests that get merged.

Only GitHub events are handled—the previous in-chat issue tracker commands have been removed so the bot can focus on repository updates.

## Requirements

- Node.js 20+
- A phone number that can stay logged in to WhatsApp Web
- A GitHub repository where you can configure webhooks

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `WHATSAPP_GROUP_ID` | ✅ | Target WhatsApp group chat ID (format usually ends with `@g.us`). |
| `GITHUB_WEBHOOK_SECRET` | ✅ | Secret shared with the GitHub webhook for HMAC verification. |
| `GITHUB_REPO` | ➖ | Optional filter in the form `owner/name`. Events from other repos are ignored. |
| `PORT` | ➖ | HTTP port for the Express server (default: `3000`). |
| `RENDER` | ➖ | Set to `true` when running on Render to use the system Chromium binary. |

Create a `.env` file (or configure environment variables in your hosting platform):

```env
WHATSAPP_GROUP_ID=1234567890-123456789@g.us
GITHUB_WEBHOOK_SECRET=super-secret-value
GITHUB_REPO=your-org/your-repo
PORT=3000
RENDER=false
```

## Local Setup

1. Install dependencies: `npm install`
2. Start the bot: `npm start`
3. Watch the console, scan the WhatsApp QR code when it appears.
4. Keep the terminal running to maintain the session.

## Configuring the GitHub Webhook

1. Go to **Settings → Webhooks** in your GitHub repository.
2. Click **Add webhook**.
3. Payload URL: `https://<your-hostname>/github/webhook`
4. Content type: `application/json`
5. Secret: use the same value as `GITHUB_WEBHOOK_SECRET`
6. Select **Let me select individual events** and choose **Issues** and **Pull requests**.
7. Save the webhook and send a test delivery to confirm you see "Accepted" in the response.

The bot validates the signature (`X-Hub-Signature-256`) before processing an event. Invalid signatures are rejected with HTTP 401.

## Health Checks

- `GET /` – simple status message.
- `GET /health` – JSON with WhatsApp readiness, queued message count, and timestamp.

## Deployment Notes

- When containerising, persist the `.wwebjs_auth` directory so the WhatsApp session survives restarts.
- On Render, mount a disk at `/app/.wwebjs_auth` and set `RENDER=true` so Puppeteer uses the platform Chromium.

## Testing Webhooks Locally

Use `curl` to simulate a GitHub event:

```bash
BODY='{"action":"opened","issue":{"number":1,"title":"Example bug","html_url":"https://github.com/your-org/your-repo/issues/1"},"repository":{"full_name":"your-org/your-repo"},"sender":{"login":"octocat"}}'
SIGNATURE="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" | cut -d' ' -f2)"
curl -H "Content-Type: application/json" \
     -H "X-GitHub-Event: issues" \
     -H "X-GitHub-Delivery: test" \
     -H "X-Hub-Signature-256: $SIGNATURE" \
     --data "$BODY" \
     http://localhost:3000/github/webhook
```

Queued messages are delivered once the WhatsApp client reports as ready. You can trigger deliveries by opening/assigning issues or creating/merging PRs in the configured repository.
