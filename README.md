# To-Do List

A simple to-do list app. Vanilla HTML, CSS, and JavaScript — no framework, no build step, no dependencies.

## Run it

```bash
npm run dev        # or: node server.js
```

Then open <http://localhost:3000>. Edit any file and the browser reloads itself.

Use a different port with `node server.js --port 4000`.

You can also just open `index.html` directly in a browser — the app works fine over `file://`. The dev server only adds live reload and realistic HTTP behavior.

## Test it

```bash
npm test           # dev server must be running
```

Drives the real app in headless Chrome over the DevTools protocol and checks 18 behaviors: adding, toggling, editing, deleting, filtering, the task count, persistence across reload, HTML escaping, and recovery from corrupted storage.

## Features

- Add tasks, check them off, delete them
- Double-click a task to edit — <kbd>Enter</kbd> saves, <kbd>Esc</kbd> cancels, saving an empty title deletes it
- Filter by All / Active / Done, with a live count of remaining tasks
- "Clear completed" removes all finished tasks at once
- Light and dark theme, following your OS setting
- Tasks persist across refreshes

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup |
| `styles.css` | Styling and theming |
| `app.js` | All app behavior |
| `server.js` | Dev server with live reload (dev only) |
| `smoke-test.mjs` | End-to-end browser test |

## Where the data lives

Tasks are stored in the browser's `localStorage` under the key `todos`. There is no database and no backend — `server.js` only serves static files and never sees your tasks.

That means tasks are **per-browser and per-machine**. They survive refreshes and restarts, but they don't sync between devices and they disappear if you clear site data.

A database would only become necessary to support:

- the same list on multiple devices
- multiple users or accounts
- data that outlives the browser profile

Any of those needs a real backend: an HTTP API plus a datastore (SQLite is plenty), with `app.js` calling that API instead of `localStorage`. Until then, `localStorage` does the job in one line.

## Notes

`server.js` is a development tool. It disables caching, serves everything from this directory, and has no authentication — don't expose it to a network you don't control.
