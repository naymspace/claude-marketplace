# timy

timy shows you how much time you spend per project in your Claude sessions. It is meant for yourself, not as a timesheet and not for control: the data stays on your machine and timy sends nothing anywhere.

Above the prompt there is a band with the project, today's time and the day against your target. With `/timy` you open the pane with today, the week and the month (keys `1`, `2`, `3`). In the desktop app you can switch between a chart and a table (`g`, `t`), the terminal shows the table. The interface is in German, the pictures show demo data plus the session that took them.

![The band above the prompt](docs/band.png)

| Today | A week |
|---|---|
| ![Today as a timeline per project](docs/today-chart.png) | ![Active time per day in a week](docs/week.png) |

## How it counts

timy keeps a few events per session, so when you open it, type, send something and when Claude is done. Three times come out of that: `Aktiv` keeps counting for up to `idle_minutes` after each event and, while Claude works, until Claude is done (at most 2 hours). `Tippen` is the time in the prompt, `Claude` the time Claude works. The project is the path from the git remote, for example `firma/shop`. Without a remote it is the folder name of the repository, outside a git repository `ohne Projekt`. A day starts at 4 am.

## Where the data lives

One file per session and day under `~/.claude/timy`, one line per event:

```json
{"t":"2026-10-15T09:24:00.000Z","type":"submit","project":"firma/shop","session":"3f2a9c1e-5b7d-4e8a-9c21-6d0f4b8a7e13","branch":"feature/12-login","title":"#12 Login page"}
```

Prompts or answers are not in there. If you want to start over, delete the folder.

## Install

1. Add the marketplace: `/plugin marketplace add https://github.com/naymspace/claude-marketplace.git`
2. Install timy: `/plugin install timy@naymspace-marketplace`
3. Run `/reload-plugins`

timy works without any setup.

## Settings

| Option | Default | What it does |
|---|---|---|
| `idle_minutes` | `5` | Minutes without input after which `Aktiv` stops counting |
| `data_dir` | `~/.claude/timy` | Folder for the data |
| `hours_per_weekday` | no target | Your target Monday to Sunday, for example `8,8,8,8,8`. An add-on like `timy-moco` can replace it |

## Add-ons

timy itself talks to no other service. If you use MOCO or mite, you can install `timy-moco` or `timy-mite` on top, they add their part at the bottom of the pane.
