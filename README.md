# "Cloudboy Color"

The Cloudflare Gameboy Agent!

https://github.com/user-attachments/assets/ad65df1b-3e96-4a65-a94b-ff95f32aa65f

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rorz/cloudflare-gameboy-agent)

[READ MY BLOG ARTICLE ABOUT THIS](https://rorz.io/writing/playing-a-gameboy-with-cloudflare-agents)

A browser-based Game Boy Color emulator which is controlled by Cloudflare Agents. Load a ROM, and play it yourself with the keyboard or on-screen controls, or hand the game over to a Cloudflare Agents instance.

Runs mGBA in WebAssembly.

## Run locally

```sh
bun install
bunx wrangler login
bun run dev
```

You need a ROM downloaded on your system -- or a URL to one -- in order to actually use the emulator. In the interest of copyright, I'm not going to point you to one here.

The Worker uses the `default` AI Gateway. To use Cloudflare-managed credentials, add Unified Billing credits to your Cloudflare account. [AI Gateway billing setup](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)

Set `AI_GATEWAY_ID` in `.dev.vars` to use another gateway. If Wrangler has multiple accounts, set `CLOUDFLARE_ACCOUNT_ID` in `.env.local`.

Local development only. [Public deployment notes](docs/agent-production.md)

## Licence

The project code is licensed under MIT. Third-party components retain their own licences. [MIT licence text](LICENSE)
