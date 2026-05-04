# Obscura Binary Bump + Accessibility Tool Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Bump Obscura binary from v0.1.1 → v0.1.2, add `browse_accessibility` tool, fix out-of-sync metadata, clean up artifacts.

**Architecture:** One-line binary version change in install-obscura.js. Add a new MCP tool that exposes Obscura v0.1.2's new `Accessibility.getFullAXTree` CDP method. Fix server.json version to match package.json. Remove artifact file.

**Tech Stack:** Node.js, MCP SDK, CDP (Chrome DevTools Protocol), Obscura v0.1.2

---

## Test Results (v0.1.2)

| Feature | Status |
|---------|--------|
| Binary download | ✅ v0.1.2 assets exist for all platforms |
| CDP server start | ✅ Port 9222 |
| Existing tools | ✅ All 12 work unchanged |
| `Page.captureScreenshot` | ❌ Not implemented in Obscura |
| `LP.getScreenshot` | ❌ Not implemented |
| `Accessibility.getFullAXTree` | ✅ **New!** Returns accessibility tree |
| `LP.getMarkdown` | ✅ Unchanged |
| `Page.printToPDF` | ❌ Not implemented |

---

### Task 1: Clean up artifact

**Objective:** Remove `scripts/patch_clarify_telegram.py` from the repo — it's unrelated to obscura-mcp.

**Files:**
- Remove: `scripts/patch_clarify_telegram.py`

**Step 1: Remove the file**

```bash
git rm scripts/patch_clarify_telegram.py
```

**Step 2: Commit**

```bash
git commit -m "chore: remove unrelated clarify patch artifact"
```

---

### Task 2: Bump Obscura binary version

**Objective:** Change the downloaded Obscura binary version from v0.1.1 to v0.1.2.

**Files:**
- Modify: `scripts/install-obscura.js:32`

**Step 1: Edit version string**

```js
// Line 32: v0.1.1 → v0.1.2
const OBSCURA_VERSION = "v0.1.2";
```

**Step 2: Verify no other references to the old version**

```bash
grep -r "v0.1.1" scripts/ --include="*.js" --include="*.json"
```

Expected: Only `install-obscura.js:32` matched (before change) or zero matches (after change).

**Step 3: Commit**

```bash
git add scripts/install-obscura.js
git commit -m "chore: bump obscura binary to v0.1.2"
```

---

### Task 3: Add `browse_accessibility` tool

**Objective:** Expose Obscura v0.1.2's new `Accessibility.getFullAXTree` CDP method as an MCP tool. Returns the page's accessibility tree — useful for AI agents that need semantic page structure.

**Files:**
- Modify: `index.js` (add method + tool handler + tool schema)

**Step 1: Add the `browseAccessibility` method to `ObscuraServer` class**

Insert after the `pageToMarkdown` method (after line 496) or before `browseClick`:

```js
async browseAccessibility(args = {}) {
    const url = this.validateUrl(args.url);
    const cookies = Array.isArray(args.cookies) ? args.cookies : [];

    return await this.withPage(url, async (sessionId) => {
      const result = await this.cdp.send("Accessibility.getFullAXTree", {}, sessionId);
      const nodes = result?.nodes || [];
      if (nodes.length === 0) {
        return "No accessibility tree available for this page.";
      }

      // Format the tree as readable text
      return nodes
        .map((n) => {
          const role = n.role?.value || "unknown";
          const name = n.name?.value || "";
          const value = n.value?.value || "";
          const desc = n.description?.value || "";
          const parts = [`[${role}]`];
          if (name) parts.push(`name="${name}"`);
          if (value) parts.push(`value="${value}"`);
          if (desc) parts.push(`desc="${desc}"`);
          return parts.join(" ");
        })
        .join("\n");
    }, cookies);
}
```

**Step 2: Register the tool in `setupTools()`**

In the `tools` array in `setupTools()` (after `page_to_markdown` entry, around line 815), add:

```js
{
    name: "browse_accessibility",
    description:
        "Navigate to a URL and retrieve the page's accessibility tree. Returns structured info about roles, names, values, and descriptions of elements. Useful for understanding page layout and interactive elements without rendering.",
    inputSchema: {
        type: "object",
        properties: {
            url: {
                type: "string",
                description: "The URL to visit",
            },
            cookies: {
                type: "array",
                description:
                    "Optional cookies to inject before navigation. An array of objects with at least name and value.",
                items: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        value: { type: "string" },
                        domain: { type: "string" },
                        path: { type: "string" },
                        secure: { type: "boolean" },
                        httpOnly: { type: "boolean" },
                        sameSite: { type: "string" },
                        expires: { type: "number" },
                    },
                    required: ["name", "value"],
                },
            },
            stealth: {
                type: "boolean",
                default: true,
                description:
                    "Accepted for compatibility. Stealth behavior is controlled by the Obscura server.",
            },
        },
        required: ["url"],
    },
},
```

**Step 3: Add handler in `CallToolRequestSchema`**

In the tool dispatch block (after `page_to_markdown` handler, around line 1012), add:

```js
if (name === "browse_accessibility") {
    const output = await this.browseAccessibility(args);
    return {
        content: [{ type: "text", text: output }],
    };
}
```

**Step 4: Update tool count in README.md**

Line 38: `## Tools — 12 total` → `## Tools — 13 total`

And add the tool to the table above session tools:

```markdown
| `browse_accessibility` | Navigate to a URL and retrieve the page's accessibility tree. |
```

**Step 5: Update server.json tool list**

Add to the `tools` array:

```json
{
    "name": "browse_accessibility",
    "description": "Navigate to a URL and retrieve the page's accessibility tree."
}
```

**Step 6: Commit**

```bash
git add index.js README.md server.json
git commit -m "feat: add browse_accessibility tool exposing AXTree"
```

---

### Task 4: Fix server.json version

**Objective:** server.json has `"version": "0.1.2"` but the npm package is on `0.1.3` — fix to keep in sync.

**Files:**
- Modify: `server.json:10` and `server.json:15`

**Step 1: Edit version fields**

```json
// Line 10
"version": "0.1.3"

// Line 15
"version": "0.1.3"
```

**Step 2: Commit**

```bash
git add server.json
git commit -m "chore: sync server.json version with package.json"
```

---

### Task 5: Update npm version to 0.1.4 and publish

**Objective:** Bump npm version from 0.1.3 → 0.1.4, publish to npm.

**Files:**
- Modify: `package.json:3`

**Step 1: Bump version**

```json
// Line 3
"version": "0.1.4"
```

**Step 2: Run final checks**

```bash
# Clean install test
cd /tmp && rm -rf test-install && mkdir test-install && cd test-install
npm init -y
npm install /root/obscura-mcp
node -e "require('obscura-mcp')"
```

**Step 3: Publish to npm**

```bash
cd /root/obscura-mcp
npm pack
npm publish --registry=https://registry.npmjs.org/
```

**Step 4: Create git tag and push**

```bash
git add package.json
git commit -m "feat: bump v0.1.4, add browse_accessibility, bump obscura binary to v0.1.2"
git tag v0.1.4
git push origin main --tags
```

---

## Verification

After all tasks:

```bash
# 1. Verify binary is downloaded
obscura-mcp install

# 2. Verify tools list includes browse_accessibility
# (start server and check tool list)

# 3. Test the new tool
# Call browse_accessibility(url: "https://example.com")
# Expected: returns structured accessibility tree text

# 4. Verify server.json is in sync
grep '"version"' server.json
# Expected: "0.1.3" in both places

# 5. Verify no v0.1.1 references remain
grep -r "v0.1.1" scripts/ --include="*.js"
# Expected: no matches
```

## Rollback

If publish fails:
1. `npm unpublish obscura-mcp@0.1.4` (within 72h)
2. Revert the last commit: `git revert HEAD`
3. Fix the issue and retry
