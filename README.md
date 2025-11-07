# Microsoft 365 Agent (Teams) — Local Development Guide

This repository contains a Microsoft 365 / Teams agent built with the Microsoft 365 Agents Toolkit. The instructions below explain how to set up the project locally, add your JIRA credentials, install dependencies, and run the agent from VS Code (Run & Debug) or using the provided VS Code tasks.

## Quick overview
- Install dependencies
- Add your JIRA credentials to the environment file
- Launch the agent using VS Code Run & Debug or Tasks

## Prerequisites
- Node.js (recommended versions: Node 20 or 22)
- npm (comes with Node.js)
- VS Code with the Microsoft 365 Agents Toolkit extension (Teams Toolkit)
- A JIRA (Atlassian) Cloud account and an API token

## 1) Install dependencies
Open a terminal in the project root and run:

```bash
npm install
```

This installs runtime dependencies and type packages. If you add or update packages, re-run `npm install`.

## 2) Add JIRA credentials (local env)
The project reads environment variables from `env/.env.dev` (used for local development) — add your JIRA details there.

Open `env/.env.dev` and set the following values (do NOT commit production secrets):

```bash
# JIRA configuration (example)
JIRA_BASE_URL=rishi1729.atlassian.net    # or https://your-domain.atlassian.net
JIRA_API_TOKEN=<your-atlassian-api-token>
JIRA_EMAIL=you@example.com
JIRA_PROJECT=YOUR_PROJECT_KEY
```

Notes:
- You can generate an Atlassian API token from https://id.atlassian.com/manage-profile/security/api-tokens
- Keep `env/.env.dev` out of version control (the repo currently contains one for demo/testing). If you accidentally committed secrets, rotate the API token immediately and remove the file from Git history.

If you want to test against the Microsoft 365 Agents Playground, also check `env/.env.playground.user`.

## 3) Launching the agent (two options)

Option A — Use the Teams Toolkit / VS Code Tasks (recommended for local dev):

1. Open the Command Palette (Cmd+Shift+P / Ctrl+Shift+P)
2. Run `Tasks: Run Task`
3. Choose `Start Agent Locally` to run the full local workflow (validate prerequisites, local tunnel, provision (local), deploy, start the app).

There are several other tasks available in `.vscode/tasks.json`, for example:
- `Start local tunnel` — opens the dev tunnel used by the bot endpoint
- `Provision` / `Deploy` — local provisioning and deploy steps
- `Start application` — runs `npm run dev:teamsfx` (starts the agent process)

Option B — Run the dev script directly

```bash
# start the local Teams agent and related dev servers
npm run dev:teamsfx
```

Both options will open the Microsoft 365 Agents Playground or make the bot available for testing in Teams. The app's Teams app id appears in `env/.env.dev` (set during provisioning) as `TEAMS_APP_ID` and is used for launching the app in Teams.

## 4) Test JIRA integration
Once the agent is running, you can interact with it via the Playground or Teams. Example messages to test:

- `/fetchAC <JIRA_ID>` — fetch acceptance criteria from a JIRA issue
- `/scoreSC <JIRA_ID>` — fetch and score the acceptance criteria
- `/scoreThisAC <acceptance criteria text>` — score a provided AC text
- `/reviseAC <JIRA_ID>` — fetch and return a revised AC
- `/scoreBulk` — score ACs from an Excel file (requires uploading/processing)

The agent will call the configured JIRA instance using the credentials you added to `env/.env.dev`.

## 5) Implementation details & AC scoring logic
The AC scoring uses 4 dimensions (each scored 1..5):

1. Clarity — how clear, unambiguous, and easy to understand the AC is
2. Structure — whether it follows Given/When/Then or other agreed conventions
3. Relevance — how well the AC maps to the story summary/description
4. Testability — how easy it is to verify (clear test steps or acceptance conditions)

Overall score = average of the four category scores. Pass when average >= 4, otherwise Fail.

The agent exposes commands that let users fetch and score AC from JIRA or submit AC text directly for scoring.

## 6) Troubleshooting
- If the agent complains about missing env vars (e.g. `TEAMS_APP_ID`), ensure `env/.env.dev` has those values or run the toolkit `Provision` / `Start Agent Locally` tasks which populate them during debug/provisioning.
- If JIRA connection fails:
  - Confirm `JIRA_EMAIL`, `JIRA_API_TOKEN`, and `JIRA_PROJECT` are correct.
  - Verify you can call the JIRA API directly using curl (example):

```bash
curl -u you@example.com:<api_token> -X GET "https://your-domain.atlassian.net/rest/api/3/myself"
```

## 7) Security note
- Do not commit real API tokens to source control. If a secret is accidentally committed, rotate the token immediately.
- Consider adding `env/.env.dev` to `.gitignore` and store secrets in environment variables or a secrets manager.

## 8) Want me to help?
- I can: remove `env/.env.dev` from Git and replace it with `env/.env.example`; help you add a `.env.example`; or add a README section with troubleshooting logs. Tell me which you'd like me to do next.

---

Last updated: November 2025
Temporary placeholder
