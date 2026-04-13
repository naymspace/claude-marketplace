# Naymspace Claude Marketplace

A collection of Claude Code plugins maintained by Naymspace.

## Available Plugins

| Plugin | Description |
|--------|-------------|
| **elixir-genius** | Elixir/Phoenix/LiveView best practices, architecture patterns, and OTP guidance |
| **workflows** | Development workflow skills |

## Usage

### Adding the Marketplace

Register this marketplace in Claude Code:

```
/plugin marketplace add https://gitlab.naymspace.de/claude/marketplace.git
```

### Installing a Plugin

Install a plugin from this marketplace:

```
/plugin install <plugin-name>@naymspace-marketplace
```

For example, to install the Elixir Genius plugin:

```
/plugin install elixir-genius@naymspace-marketplace
```

After installation, run `/reload-plugins` to apply the changes.

### Listing Installed Plugins

```
/plugin list
```

### Removing a Plugin

```
/plugin uninstall <plugin-name>
```

## Creating a Plugin

Each plugin lives in its own directory under `plugins/` and needs two files:

### `plugin.json`

Defines plugin metadata:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What the plugin does",
  "author": { "name": "Your Name" },
  "skills": ["./"]
}
```

### `SKILL.md`

Contains the skill definition with frontmatter and instructions:

```markdown
---
name: my-plugin
description: When to activate this skill
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# My Plugin

Instructions and patterns for Claude to follow...
```

### Directory Structure

```
plugins/
  my-plugin/
    plugin.json
    SKILL.md
```

## Publishing an Update

To release a new version of an existing plugin:

1. **Update the plugin files** — Edit `SKILL.md` and/or `plugin.json` under `plugins/<plugin-name>/`
2. **Bump the version** in `plugin.json` (e.g. `"version": "1.0.0"` → `"version": "1.1.0"`)
3. **Commit and push** to `main`
