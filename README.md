# Naymspace Claude Marketplace

A collection of Claude Code plugins maintained by Naymspace.

## Available Plugins

| Plugin | Description |
|--------|-------------|
| **elixir-genius** | Elixir/Phoenix/LiveView best practices, architecture patterns, and OTP guidance |

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

### `.claude-plugin/plugin.json`

Defines plugin metadata:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What the plugin does",
  "author": { "name": "Your Name" }
}
```

### `skills/<skill-name>/SKILL.md`

Contains the skill definition with frontmatter and instructions:

```markdown
---
name: my-skill
description: When to activate this skill
---

# My Skill

Instructions and patterns for Claude to follow...
```

### Directory Structure

```
plugins/
  my-plugin/
    .claude-plugin/
      plugin.json
    skills/
      my-skill/
        SKILL.md
```

## Publishing an Update

To release a new version of an existing plugin:

1. **Update the plugin files** — Edit files under `plugins/<plugin-name>/`
2. **Bump the version** in `.claude-plugin/plugin.json` (e.g. `"version": "1.0.0"` → `"version": "1.1.0"`)
3. **Commit and push** to `main`
