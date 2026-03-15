variable "cluster_name" {
  description = "Name of the kind cluster"
  type        = string
  default     = "nodeguard"
}

variable "kubernetes_version" {
  description = "Kubernetes node image version"
  type        = string
  default     = "v1.29.2"
}

variable "worker_nodes" {
  description = "Number of worker nodes"
  type        = number
  default     = 2
}
