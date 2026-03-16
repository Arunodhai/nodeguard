# NodeGuard — Project Context for Claude

## What This Project Is
NodeGuard is a TypeScript CLI + Web UI that scans Node.js dependencies for vulnerabilities via OSV.dev and auto-creates GitHub PRs with fixes.

## Tech Stack
- **Runtime**: Node.js 20, TypeScript (compiled with tsup)
- **Web server**: Fastify v5
- **Testing**: Vitest v3 with v8 coverage (lcov format)
- **Metrics**: prom-client
- **GitHub API**: @octokit/rest

## Project Structure
```
src/
  cli.ts              # Entry point — commander CLI (scan, serve, --ui)
  server/index.ts     # Fastify server — all API endpoints + full HTML dashboard
  metrics.ts          # Prometheus metrics (5 counters/gauges/histograms)
  types.ts            # Shared TypeScript types (VulnMatch)
  input/resolver.ts   # Resolves local path or GitHub URL → lockfile + manifest
  parser/lockfile.ts  # Parses package-lock.json v2/v3 → dep map
  semver/matcher.ts   # Matches OSV results to installed versions
  vuln/querier.ts     # Queries OSV.dev batch API
  github/pr.ts        # Creates fix PRs via GitHub API, bumps package.json
  report/             # CLI table + JSON output formatters

infra/terraform/      # kind cluster + namespaces + nginx ingress
helm/nodeguard/       # Helm chart (Deployment, Service, Ingress, HPA, etc.)
argocd/               # ArgoCD GitOps application + install script
grafana/              # Grafana dashboard JSON
.github/workflows/    # CI pipeline (test → sonar → docker)
```

## Key Conventions
- **ES modules**: `"type": "module"` in package.json — always use `.js` extensions in imports
- **SSE streaming**: Use `reply.hijack()` + `reply.raw.write()` in Fastify v5 (not readable streams)
- **Server state**: `currentVulns`, `currentTarget`, `currentManifest`, `currentRepoUrl` are `let` variables — updated by scan endpoint
- **Filter logic**: AND between groups (severity/type/fix), OR within groups
- **Port binding**: `HOST=0.0.0.0` in Docker, defaults to `127.0.0.1` locally

## Running Locally
```bash
npm run dev          # run CLI directly with tsx
npm run build        # compile TypeScript → dist/
npm start            # run compiled server (node dist/cli.js serve)
npm test             # vitest run --coverage (generates coverage/lcov.info)
```

## Docker
```bash
docker build -t nodeguard:local .
docker run -p 3847:3847 -e GITHUB_TOKEN=xxx nodeguard:local
# UI at http://localhost:3847
```

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Liveness probe — returns `{status, uptime, timestamp}` |
| GET | /metrics | Prometheus metrics (prom-client) |
| GET | /api/vulns | Current scan results |
| GET | /api/status | Token/repo/PR count status |
| GET | /api/prs | NodeGuard PRs (GitHub API or session fallback) |
| POST | /api/fix | SSE stream — creates fix PRs |
| POST | /api/scan | SSE stream — runs full scan pipeline |

## CI/CD Pipeline (GitHub Actions)
Four jobs on every push to `master`:
1. **Test** — `npm ci && npm run build && npm test` — generates coverage
2. **SonarCloud** — uploads coverage to sonarcloud.io (requires `SONAR_TOKEN` secret)
3. **Docker Build & Scan** — builds image, Trivy scans (report-only), pushes to Docker Hub on master (requires `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN` secrets). After push, updates `helm/nodeguard/values.yaml` with the commit SHA tag and pushes back to git with `[skip ci]` to complete the GitOps loop.

## GitOps Loop (how auto-deploy works)
1. Push code to master
2. CI builds + pushes `arunodhai/nodeguard:<sha>` and `latest` to Docker Hub
3. CI updates `helm/nodeguard/values.yaml` `image.tag` to `<sha>`, commits `[skip ci]`, pushes
4. ArgoCD detects the `helm/nodeguard/values.yaml` change → syncs → Kubernetes rolls out new pod

**Apple Silicon caveat**: CI builds amd64-only images. The local Kind cluster needs a locally-built arm64 image loaded in. The `argocd/application.yaml` overrides `image.tag=local` and `image.pullPolicy=Never` for local Kind. The GitOps SHA update still runs in CI for verification but the local cluster won't pull from Docker Hub.

## GitHub Secrets Required
| Secret | Used by |
|--------|---------|
| `DOCKERHUB_USERNAME` | Docker push |
| `DOCKERHUB_TOKEN` | Docker push |
| `SONAR_TOKEN` | SonarCloud scan |

## Infrastructure
- **Step 3 — Terraform** ✅: `infra/terraform/` — two-stage apply (`-target=kind_cluster.nodeguard` first, then full apply). Kind cluster: 1 control-plane + 2 workers. Port 8080 is taken by Java (Jenkins) on this machine — host port for HTTP is **8081** (container port 80 → host port 8081).
- **Step 4 — Helm** ✅: CI image is amd64-only; on Apple Silicon build locally and load into kind: `docker build -t arunodhai/nodeguard:local . && kind load docker-image arunodhai/nodeguard:local --name nodeguard`, then `helm upgrade --install nodeguard ./helm/nodeguard --namespace nodeguard --set image.tag=local --set image.pullPolicy=Never`. App at **http://nodeguard.local:8081** (add `127.0.0.1 nodeguard.local` to `/etc/hosts`). Note: once ArgoCD is installed, do NOT run `helm upgrade` manually — ArgoCD owns the release.
- **Step 5 — ArgoCD** ✅: Install via `kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml` then `kubectl apply -f argocd/application.yaml`. UI via `kubectl port-forward svc/argocd-server -n argocd 8090:443` → **https://localhost:8090** (admin / iaENIUS5mCr0iyST). Watches `helm/nodeguard` path on GitHub, auto-deploys on every push. `argocd/application.yaml` overrides `image.tag=local` and `image.pullPolicy=Never` for local Kind (Apple Silicon).
- **Step 6 — Observability** ✅: kube-prometheus-stack installed in `monitoring` namespace. Grafana at `kubectl port-forward svc/prometheus-grafana -n monitoring 3000:80` → **http://localhost:3000** (admin / admin). NodeGuard dashboard at `/d/nodeguard-v1/nodeguard`. ServiceMonitor enabled via ArgoCD parameter.

## SonarCloud Config
- Project key: `Arunodhai_nodeguard`
- Organization: `arunodhai`
- Coverage report: `coverage/lcov.info`
- Config file: `sonar-project.properties`

## Docker Hub
- Image: `DOCKERHUB_USERNAME/nodeguard`
- Tags: `latest` + commit SHA on every master push

## Rebuilding from Scratch (after cluster wipe)
```bash
cd infra/terraform
terraform state rm kind_cluster.nodeguard   # if stale state exists
terraform apply -target=kind_cluster.nodeguard -auto-approve
terraform apply -auto-approve
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl wait --for=condition=available --timeout=120s deployment/argocd-server -n argocd
kubectl apply -f argocd/application.yaml
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring --set grafana.adminPassword=admin \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false --wait
# Apple Silicon: build + load local image
docker build -t arunodhai/nodeguard:local .
kind load docker-image arunodhai/nodeguard:local --name nodeguard
```

## What NOT to Do
- Do not use port 8080 for Kind HTTP host port — Java (Jenkins) occupies it on this machine; use 8081
- Do not run `helm upgrade` manually after ArgoCD is installed — ArgoCD owns the release; update `argocd/application.yaml` parameters instead
- Do not leave `YOUR_DOCKERHUB_USERNAME` placeholder in `helm/nodeguard/values.yaml` — must be `arunodhai/nodeguard`
- Do not use `npm install` in CI — always `npm ci`
- Do not bind server to `127.0.0.1` in Docker — use `HOST=0.0.0.0`
- Do not use `@vitest/coverage-v8` v4.x — project uses vitest v3, requires `@vitest/coverage-v8@^3.x`
- Do not add `exit-code: 1` to Trivy without updating `.trivyignore` — base image has unfixable CVEs
- Do not use readable streams for SSE in Fastify v5 — use `reply.hijack()` pattern
