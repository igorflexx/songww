# songww

Portfolio project with a small Python backend and static frontend assets.

## Project structure

- `backend/` - FastAPI application and Python dependencies
- `frontend/` - HTML, CSS, JavaScript, images, audio, and SVG assets
- `run.command` - starts the backend locally and opens a public tunnel through `localhost.run`
- `run-local.command` - starts the backend only on `http://127.0.0.1:8000`
- `kill.command` - stops the backend and also closes public tunnel processes
- `kill-local.command` - stops only the local backend processes

## Run scripts

### `run.command`

Use this when you want to open the project publicly for testing or sharing.

What it does:

- starts `uvicorn` from `.venv`
- waits until the app is available on port `8000`
- opens a public SSH tunnel through `localhost.run`
- prints a public URL that can be shared

Default mode is public:

```bash
./run.command
```

### `run-local.command`

Use this when you only need the project on your own machine.

What it does:

- stops an older process on port `8000` if needed
- starts `uvicorn` with reload on `127.0.0.1:8000`

Run it with:

```bash
./run-local.command
```

### Stop scripts

To stop everything including the public tunnel:

```bash
./kill.command
```

To stop only the local backend:

```bash
./kill-local.command
```
