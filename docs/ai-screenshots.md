# AI screenshot creation

Screenshot Studio includes a local MCP server and an agent skill. Ask an agent to turn your app's captures and feature brief into an editable screenshot story. The agent can create projects, write copy, arrange layers, import real screenshots and generated illustrations, and inspect rendered previews. The server uses the existing document host for atomic saves, revision conflict detection, backups, media validation and frozen exports.

The server does not call an AI provider itself or need credentials. The connected agent supplies the AI and may use its image-generation tools for artwork. It uses the [official MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) with stdio transport. There is no persistent HTTP listener. The Mac app renders through its private protocol in a hidden Chromium window; source-only rendering invokes the CLI’s temporary loopback server and Chrome process.

## Connect from the Mac app

Download Screenshot Studio, move it to Applications and open **Help → MCP and Skills Guide** (or **? → Connect MCP**). The app bundles the skill, stdio MCP server, Node runtime and hidden Chromium renderer. The app stays open while the agent’s stdio process forwards tool calls to its active document over a private local socket. No source checkout, npm install, separate Node or Chrome is needed.

1. Choose **Codex** or **Claude Code**. The app shows the actual skill and configuration destinations.
2. Open the `.sss` project you want to work on in Screenshot Studio. The setup view shows the active project; no separate workspace selection is needed.
3. Click **Install skill**. An existing skill is backed up before updating; installing the same version is a no-op.
4. Click **Set up MCP**. The app tests the bundled executable, preserves other client settings and saves a revision-checked configuration with a backup.
5. Reload or restart your AI client. Confirm Screenshot Studio appears in its tools and ask it to call `read_project` without a project argument.

**Test MCP** checks the bundled server and running app without changing client configuration. A successful test or config save does not attach an already running conversation. Existing conversations may need a reconnect or a new session.

Codex uses `~/.codex/config.toml` (or `CODEX_HOME/config.toml`) and installs the skill under `~/.agents/skills/screenshot-studio`. Claude Code uses `~/.claude.json` and `~/.claude/skills/screenshot-studio`. Backups of replaced skills live outside skill discovery under Screenshot Studio’s Application Support folder. Config backups sit beside the client config. Configurations containing unsupported inline Screenshot Studio TOML entries remain untouched; the guide shows the connection to use for a manual edit.

Keep the app in a stable location. If you move or rename it, rerun setup to update the executable path. Setup configures the executable with `--screenshot-studio-mcp --active-app --app-data <app data directory>`. The stdio process connects to the running GUI over a private authenticated Unix socket; it does not open a second editor window or a listening HTTP server.

The connection follows the currently open project on every call. Opening another document or using Save As changes its target without reconfiguring MCP. Going to Welcome clears the target, and closing the app makes editing unavailable. Pending editor saves must be acknowledged before a tool reads or writes. Agent changes notify the editor so previews and revisions refresh. Writes and exports require the `projectSession` from the latest `read_project`; a switch rejects old sessions even if two documents have identical content hashes.

In this app-connected mode, `create_project` is omitted: create or open a document in the app. Image tools can access files inside the active `.sss` package or an `inputs/` folder beside it. Exports are stored in the document’s `export/` folder. Other project packages and arbitrary neighboring files are outside this connection’s scope. The standalone `--workspace` mode remains available for unattended document creation.

If an earlier installation used a fixed workspace, click **Update MCP connection** once and reload the AI client. Subsequent project switches are automatic.

See the official [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Codex skill locations](https://learn.chatgpt.com/docs/build-skills), [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp) and [Claude Code skills](https://code.claude.com/docs/en/skills).

## Connect from source (development)

Requires Node.js 22.12+, this repository with `npm ci`, and Google Chrome or `CHROME_PATH` for the source CLI’s renderer. Create a dedicated screenshot workspace and add the server below to your MCP client, substituting absolute paths:

```json
{
  "mcpServers": {
    "screenshot-studio": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/ScreenshotStudio/tools/mcp/server.mjs", "--workspace", "/absolute/path/to/screenshot-workspace"]
    }
  }
}
```

Use Node directly rather than npm, which may write non-protocol output to stdout. Copy `skills/screenshot-studio` into your agent’s skills directory and reload the client. The standalone server uses the official MCP SDK and stdio transport; packaged rendering uses the app’s private protocol, while the source CLI uses a temporary loopback server and Chrome.

Example request:

> Use Screenshot Studio to make four iPhone screenshots for my habit tracker. The captures are in the configured workspace's inputs folder. Lead with daily progress, use a warm cream palette and keep the copy short. Save an editable project and inspect a draft before the final export.

## Available tools

| Tool | Purpose |
| --- | --- |
| `catalog` | Active project/workspace, store canvases, store image sets and upload workflow, starter designs and palettes |
| `create_project` | Standalone mode: new clean `.sss` document; never replaces a document |
| `read_project` | Editable document, copy, media inventory and revision hashes |
| `add_store_images` | App Store search + header pair or Google Play feature graphic; keeps existing artwork |
| `save_document` | Complete studio JSON with expected revision and backup |
| `save_copy` | Locale text with expected revision; AI copy remains draft |
| `apply_design` | Built-in editable layout on selected canvases |
| `import_media` | New PNG capture or supported image artwork from the workspace |
| `export_project` | Draft or strict final RGB PNGs, report and manifest |
| `read_image` | Native MCP image content for visual inspection |

Changes are acknowledged after saving. If a revision changed, reread and reconcile before retrying. Captures import under a new name, preserving existing files. Artwork imports return a content-addressed filename for an art layer's `src`. New projects contain no captures. Machine-written translations require native review, which the agent cannot approve through these tools.

Add languages through document metadata and copy saves. Remove languages in the Mac app, which archives their files in `_removed`; generic MCP document saves reject language removal.

Exports are placed in a separate invocation directory with the app's dated run and manifest. App-connected MCP exports are discovered in the project’s saved export list, including after reopening the document. Draft exports can explicitly allow placeholders. Final exports require preflight to pass and publish no completed run on failure. A full multilingual export can take several minutes; configure your client's tool timeout accordingly or preview one screen first. Open the `.sss` document in the Mac app to continue editing and review copy. App Store uploads run in the Mac app: choose the saved export in **Upload**, review the app, editable iOS version, language and creative placement, and start the upload there. The MCP prepares the images and export; it does not upload or submit for review.

Run `npm run test:mcp` for protocol, filesystem and editing tests. Set `STUDIO_MCP_RENDER_TEST=1` to include real rendering and final rejection tests.

## Store artwork through MCP

`catalog.storeImages` describes the supported sets and the upload handoff. Call `add_store_images` with `store: "app-store"` to add a Search result image and Header image, or `store: "google-play"` for a 1024 × 500 feature graphic. Pass `revision` from `read_project.revisions.studio`, and `projectSession` in active-app mode. Optional `sizes` uses target IDs from `catalog.targets`; `afterSlide` chooses the insertion point.

```json
{
  "store": "app-store",
  "sizes": {"app-store-search": [1920, 1280], "app-store-header": [3840, 1646]},
  "revision": "<revisions.studio>",
  "projectSession": "<current projectSession>"
}
```

The result includes `images: [{deviceId, slideId}, …]` and the saved revision. Reread the project, import decorative artwork with `import_media`, and save editable layers in each assigned canvas. Save localized text through `save_copy`. Repeated additions preserve existing images and their sizes. The `.sss` document uses `slide.canvasIds` and `device.screenScope: "store-image"` to keep these images separate from screenshot screens; preserve those fields. Export filters automatically select only matching screen/canvas pairs.

Search and header exports retain their target in the manifest, so Upload routes them to Apple's creative asset category and their respective placements. Apple's live catalog determines which placements, dimensions and limits are available for the selected app/version. Google Play feature graphics remain Google Play exports and do not appear in the App Store Connect upload selection.
