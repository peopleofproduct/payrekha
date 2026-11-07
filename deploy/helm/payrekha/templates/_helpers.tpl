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

{{/*
A gateway Deployment. Used by the primary and (optionally) the standby —
identical pod spec; only name, component label and replica count differ.
Args: { root: ., component: "primary"|"standby", replicas: int }
*/}}
{{- define "payrekha.deployment" -}}
{{- $root := .root -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "payrekha.fullname" $root }}{{ if ne .component "primary" }}-{{ .component }}{{ end }}
  labels:
    {{- include "payrekha.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ .component }}
spec:
  replicas: {{ .replicas }}
  {{- if eq $root.Values.topology "activeActive" }}
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }   # never dip below count — PDB backs this
  {{- else }}
  strategy: { type: Recreate }   # never two writers during a rollout
  {{- end }}
  selector:
    matchLabels:
      {{- include "payrekha.selector" $root | nindent 6 }}
      app.kubernetes.io/component: {{ .component }}
  template:
    metadata:
      labels:
        {{- include "payrekha.selector" $root | nindent 8 }}
        app.kubernetes.io/component: {{ .component }}
      annotations:
        checksum/config: {{ include (print $root.Template.BasePath "/configmap.yaml") $root | sha256sum }}
        {{- with $root.Values.podAnnotations }}{{ toYaml . | nindent 8 }}{{ end }}
    spec:
      automountServiceAccountToken: false
      enableServiceLinks: false
      {{- with $root.Values.priorityClassName }}
      priorityClassName: {{ . }}
      {{- end }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        seccompProfile: { type: RuntimeDefault }
      terminationGracePeriodSeconds: 30   # state is saved on SIGTERM
      containers:
        - name: payrekha
          image: "{{ $root.Values.image.repository }}:{{ $root.Values.image.tag | default $root.Chart.AppVersion }}"
          imagePullPolicy: {{ $root.Values.image.pullPolicy }}
          ports: [{ name: http, containerPort: 8080 }]
          envFrom: [{ secretRef: { name: {{ required "existingSecret is required" $root.Values.existingSecret }} } }]
          env:
            - { name: PAYREKHA_CONFIG, value: /etc/payrekha/payrekha.json }
            - { name: PAYREKHA_STATE_INTERVAL_MS, value: {{ $root.Values.state.saveIntervalMs | quote }} }
            {{- if eq $root.Values.state.type "file" }}
            - { name: PAYREKHA_STATE_FILE, value: /var/lib/payrekha/state.json }
            {{- else }}
            - { name: PAYREKHA_STATE_PG_TABLE, value: {{ $root.Values.state.postgres.table | quote }} }
            - { name: PAYREKHA_STATE_NAME, value: {{ $root.Values.state.postgres.name | quote }} }
            {{- end }}
            {{- if $root.Values.decisionLog.enabled }}
            - { name: PAYREKHA_DECISION_LOG, value: /var/lib/payrekha/decisions.jsonl }
            - { name: PAYREKHA_LOG_FORMAT, value: {{ $root.Values.decisionLog.format | quote }} }
            {{- end }}
          securityContext:
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities: { drop: [ALL] }
          readinessProbe: { httpGet: { path: /readyz, port: http }, periodSeconds: 5 }
          livenessProbe: { httpGet: { path: /healthz, port: http }, periodSeconds: 10 }
          resources: {{- toYaml $root.Values.resources | nindent 12 }}
          volumeMounts:
            - { name: config, mountPath: /etc/payrekha, readOnly: true }
            - { name: data, mountPath: /var/lib/payrekha }
      volumes:
        - name: config
          configMap: { name: {{ include "payrekha.fullname" $root }} }
        - name: data
          {{- if eq $root.Values.state.type "file" }}
          persistentVolumeClaim: { claimName: {{ include "payrekha.fullname" $root }}-state }
          {{- else }}
          emptyDir: { sizeLimit: 1Gi }
          {{- end }}
      {{- with $root.Values.nodeSelector }}
      nodeSelector: {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $root.Values.tolerations }}
      tolerations: {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $root.Values.affinity }}
      affinity: {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end -}}
