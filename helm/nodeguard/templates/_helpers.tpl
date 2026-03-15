{{/*
Expand the name of the chart.
*/}}
{{- define "nodeguard.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "nodeguard.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/name: {{ include "nodeguard.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "nodeguard.selectorLabels" -}}
app.kubernetes.io/name: {{ include "nodeguard.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
