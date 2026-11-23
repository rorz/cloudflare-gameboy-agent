# Cloudboy Color

Run `bun install` and `bun run dev`. Load a Game Boy or Game Boy Color ROM, then use **Connect to Agent** to hand over the controls. Disconnect or press a game control to take back over. The model sees the current frame and the last six decisions and outcomes. It can wait and watch the screen between inputs, and stops after three button decisions without progress.

Qwen makes each gameplay decision from the moment you connect, using the current LCD frame, cartridge header title, and recent input outcomes. Run `bunx wrangler login` before starting Vite to enable Workers AI. If Wrangler has multiple accounts, set `CLOUDFLARE_ACCOUNT_ID` in an ignored `.env.local` file. Bring your own ROM. Cartridge files and saves stay in the browser.

See [production rate limiting](docs/agent-production.md) for the work needed to enable the gameplay route on a public deployment.

The app is available under the [MIT License](LICENSE). Third-party components follow their respective licenses.

## React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
