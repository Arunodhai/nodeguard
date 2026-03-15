terraform {
  required_version = ">= 1.6.0"

  required_providers {
    kind = {
      source  = "tehcyx/kind"
      version = "~> 0.4"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.27"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }
  }
}

provider "kind" {}

provider "kubernetes" {
  config_path    = kind_cluster.nodeguard.kubeconfig_path
  config_context = "kind-${var.cluster_name}"
}

provider "helm" {
  kubernetes {
    config_path    = kind_cluster.nodeguard.kubeconfig_path
    config_context = "kind-${var.cluster_name}"
  }
}
