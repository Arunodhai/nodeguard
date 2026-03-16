# ── Kind Cluster ──────────────────────────────────────────────────────────────
resource "kind_cluster" "nodeguard" {
  name           = var.cluster_name
  node_image     = "kindest/node:${var.kubernetes_version}"
  wait_for_ready = true

  kind_config {
    kind        = "Cluster"
    api_version = "kind.x-k8s.io/v1alpha4"

    # Control plane node — also handles ingress
    node {
      role = "control-plane"
      kubeadm_config_patches = [
        <<-PATCH
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
        PATCH
      ]
      extra_port_mappings {
        container_port = 80
        host_port      = 8081
        protocol       = "TCP"
      }
      extra_port_mappings {
        container_port = 443
        host_port      = 8443
        protocol       = "TCP"
      }
      extra_port_mappings {
        container_port = 3847
        host_port      = 3847
        protocol       = "TCP"
      }
    }

    # Worker nodes
    dynamic "node" {
      for_each = range(var.worker_nodes)
      content {
        role = "worker"
      }
    }
  }
}

# ── Namespaces ─────────────────────────────────────────────────────────────────
resource "kubernetes_namespace" "nodeguard" {
  metadata {
    name = "nodeguard"
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }
  depends_on = [kind_cluster.nodeguard]
}

resource "kubernetes_namespace" "monitoring" {
  metadata {
    name = "monitoring"
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }
  depends_on = [kind_cluster.nodeguard]
}

resource "kubernetes_namespace" "argocd" {
  metadata {
    name = "argocd"
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }
  depends_on = [kind_cluster.nodeguard]
}

# ── nginx Ingress Controller (via Helm) ────────────────────────────────────────
resource "helm_release" "ingress_nginx" {
  name       = "ingress-nginx"
  repository = "https://kubernetes.github.io/ingress-nginx"
  chart      = "ingress-nginx"
  version    = "4.10.0"
  namespace  = "ingress-nginx"

  create_namespace = true
  wait             = true
  timeout          = 300

  set {
    name  = "controller.service.type"
    value = "NodePort"
  }
  set {
    name  = "controller.hostPort.enabled"
    value = "true"
  }
  set {
    name  = "controller.nodeSelector.ingress-ready"
    value = "true"
    type  = "string"
  }
  set {
    name  = "controller.tolerations[0].key"
    value = "node-role.kubernetes.io/control-plane"
  }
  set {
    name  = "controller.tolerations[0].operator"
    value = "Exists"
  }
  set {
    name  = "controller.tolerations[0].effect"
    value = "NoSchedule"
  }

  depends_on = [kind_cluster.nodeguard]
}
