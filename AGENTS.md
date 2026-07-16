<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Graphify (codebase knowledge graph)

`graphify` (installed via `uv tool install graphifyy`) generates a local, tree-sitter-based
knowledge graph of this repo — no code leaves the machine. Useful before large refactors or
when exploring unfamiliar parts of the codebase.

- Regenerate: `graphify extract . --code-only --no-cluster` (writes `graphify-out/graph.json`,
  gitignored — regenerate on demand rather than trusting a stale copy).
- Query it: `graphify query "<question>" --graph graphify-out/graph.json`,
  `graphify affected "<symbol>"`, `graphify explain "<symbol>"`.
- A copy of `graphify-out/graph.json` is published as a CI artifact on every push to `main`
  (see `.github/workflows/ci.yml`) and rendered at `/graph` in the dashboard for browsing
  without running the CLI locally.
