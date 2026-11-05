{{- define "payrekha.name" -}}{{ .Chart.Name }}{{- end -}}
{{- define "payrekha.fullname" -}}{{ printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}{{- end -}}
{{- define "payrekha.labels" -}}
app.kubernetes.io/name: {{ include "payrekha.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}
{{- define "payrekha.selector" -}}
app.kubernetes.io/name: {{ include "payrekha.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
