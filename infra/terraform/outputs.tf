output "cluster_name" {
  description = "Name of the kind cluster"
  value       = kind_cluster.nodeguard.name
}

output "kubeconfig_path" {
  description = "Path to the kubeconfig file for this cluster"
  value       = kind_cluster.nodeguard.kubeconfig_path
}

output "nodeguard_namespace" {
  description = "Kubernetes namespace for the NodeGuard app"
  value       = kubernetes_namespace.nodeguard.metadata[0].name
}

output "app_url" {
  description = "Local URL to access NodeGuard after deployment"
  value       = "http://nodeguard.local (add to /etc/hosts: 127.0.0.1 nodeguard.local)"
}
