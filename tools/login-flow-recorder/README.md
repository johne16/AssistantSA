# login-flow-recorder

Records a utility provider's login-and-scrape flow and writes a per-site
`<site_id>.js` scrape script for the WebView scrape-runner.

## Install

```
python -m venv .venv
.venv\Scripts\activate            # Windows; source .venv/bin/activate on Linux
pip install -r requirements.txt
playwright install chromium
```

## Run

Copy `.env.example` to `.env` and set the Anthropic key:

```
ANTHROPIC_API_KEY=...
```

Then run:

```
python recorder.py
```

You are prompted to pick the site from a numbered menu (currently `cps` and
`att`); the start URL is fixed per site. Enter the site login credentials at the
next prompts. When the recorder reaches the bill, it prints the extracted values
and asks you to confirm they match the bill on screen before the extraction is
recorded.

Add `--headed` to watch the browser. The script is written to `out/<site_id>.js`.
