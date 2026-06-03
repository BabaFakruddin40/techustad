# TechUstad Web Platform

A containerized Node.js web application with NGINX reverse proxy and HTTPS termination.

## Repository Overview

This repository contains:
- A Node.js Express web app in `src/`
- A multi-stage Docker build for production
- Docker Compose setup with 3 app replicas
- NGINX load balancing and TLS configuration
- Security-focused `.gitignore` rules for secrets/certs

## Project Directory Structure

```text
techustad/
├── .gitignore
├── README.md
├── Dockerfile
├── compose.yaml
├── nginx.conf
├── certs/
│   ├── techustad.crt
│   └── techustad.key
└── src/
    ├── index.html
    ├── package.json
    ├── server.js
    └── node_modules/   (local dependency folder)
```

## Application Components

### 1) Node.js App (`src/server.js`)
- Express static file server for `index.html`
- Health endpoint: `/health`
- SPA fallback route for all paths
- Runtime port from `PORT` environment variable

### 2) Docker Image (`Dockerfile`)
- Multi-stage build using `node:20-alpine`
- Installs production dependencies only
- Runs app as non-root `node` user

### 3) Multi-Container Runtime (`compose.yaml`)
- 3 app containers:
  - `techustad-web-1` on port 3001
  - `techustad-web-2` on port 3002
  - `techustad-web-3` on port 3003
- 1 NGINX container for reverse proxy
- Health checks configured for each app container

### 4) Reverse Proxy & TLS (`nginx.conf`)
- HTTP (80) redirects to HTTPS (443)
- TLS cert/key loaded from `certs/`
- Upstream load balancing across all app replicas
- Security headers enabled (HSTS, X-Frame-Options, etc.)

## Architecture Diagram

```mermaid
flowchart LR
  U[User Browser] -->|HTTPS 443| N[NGINX Reverse Proxy]
  U -->|HTTP 80| N
  N --> A1[techustad-web-1:3001]
  N --> A2[techustad-web-2:3002]
  N --> A3[techustad-web-3:3003]

  A1 --> H1[/health]
  A2 --> H2[/health]
  A3 --> H3[/health]

  C[(certs/techustad.crt + certs/techustad.key)] --> N
```

## Run Locally (Node)

1. Install dependencies:

```bash
cd src
npm install
```

2. Start server:

```bash
npm start
```

3. Open:
- `http://localhost:3000`
- Health check: `http://localhost:3000/health`

## Run with Docker Compose

From repository root:

```bash
docker compose -f compose.yaml up --build -d
```

Access:
- `https://localhost`
- Health check through NGINX: `https://localhost/health`

To stop:

```bash
docker compose -f compose.yaml down
```

## Security Notes

- Certificate and secret-like files are ignored by `.gitignore`.
- `certs/` is kept for local/runtime TLS material and should not be committed.
- Environment and sensitive files (`.env*`, keys, tfvars, etc.) are ignored.

## Git Ignore Coverage

The `.gitignore` includes rules for:
- Security and secret files
- Terraform state and sensitive variables
- Docker local override artifacts
- Node.js dependencies and build outputs

