#!/usr/bin/env bash
# Install ArgoCD into the cluster and expose the UI locally
set -euo pipefail

NAMESPACE="argocd"
VERSION="${ARGOCD_VERSION:-v2.10.0}"

echo "▶ Installing ArgoCD ${VERSION} into namespace '${NAMESPACE}'..."
kubectl apply -n "${NAMESPACE}" -f \
  "https://raw.githubusercontent.com/argoproj/argo-cd/${VERSION}/manifests/install.yaml"

echo "▶ Waiting for ArgoCD server to be ready..."
kubectl rollout status deployment/argocd-server -n "${NAMESPACE}" --timeout=120s

echo "▶ Patching argocd-server service to NodePort (for local kind access)..."
kubectl patch svc argocd-server -n "${NAMESPACE}" \
  -p '{"spec":{"type":"NodePort"}}'

echo ""
echo "✅ ArgoCD installed."
echo ""
echo "  Get the initial admin password:"
echo "    kubectl -n argocd get secret argocd-initial-admin-secret \\"
echo "      -o jsonpath='{.data.password}' | base64 -d && echo"
echo ""
echo "  Port-forward the UI (run in a separate terminal):"
echo "    kubectl port-forward svc/argocd-server -n argocd 8090:443"
echo ""
echo "  Then open: https://localhost:8090  (user: admin)"
