# "Cloudboy Color"

The Cloudflare Gameboy Agent!

https://github.com/user-attachments/assets/ad65df1b-3e96-4a65-a94b-ff95f32aa65f

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rorz/cloudflare-gameboy-agent)

[READ MY BLOG ARTICLE ABOUT THIS](https://rorz.io/writing/playing-a-gameboy-with-cloudflare-agents)

Cloudboy Color is a browser-based Game Boy and Game Boy Color emulator in a translucent orange shell. Play with the keyboard or on-screen controls, or hand the game over to a Cloudflare Agent.

The demo runs mGBA in WebAssembly. On each turn, the agent gives Claude Sonnet 5.5 the current screen, cartridge title and last ten button moves and outcomes via Workers AI. It groups consecutive waits into a single count. The model chooses which buttons to press or when to wait. The side panel shows its decisions and how the game responds.

## Run locally

```sh
bun install
bunx wrangler login
bun run dev
```

Open the URL Vite prints and load your own ROM from a file or direct download URL. ROMs and saves stay in the browser. Select **Connect to Agent** to let the agent play. Press a game control or select **Disconnect** to take over.

The Worker uses the `default` AI Gateway. To use Cloudflare-managed credentials, add Unified Billing credits to your Cloudflare account. [AI Gateway billing setup](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)

Set `AI_GATEWAY_ID` in `.dev.vars` to use another gateway. If Wrangler has multiple accounts, set `CLOUDFLARE_ACCOUNT_ID` in `.env.local`.

Use **Copy diagnostics** in the agent pane after a slow or failed turn. The copied request IDs and timings match the Worker's terminal logs.

The agent route is enabled for local development only. [Public deployment notes](docs/agent-production.md)

## Licence

The project code is licensed under MIT. Third-party components retain their own licences. [MIT licence text](LICENSE)
